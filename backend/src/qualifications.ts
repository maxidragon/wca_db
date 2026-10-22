import { Pool, RowDataPacket } from "mysql2/promise";

export class QualificationInputError extends Error {}

export const QUALIFIERS_PAGE_SIZE = 100;
export const UNIQUE_LIST = "unique";

// A lenient requirement in a popular event is met by a couple of hundred thousand competitors,
// which takes the covering index a few seconds; a stalled one must still free its connection.
const QUALIFICATION_TIMEOUT_SECONDS = 60;
// Events are aggregated a few at a time, so a championship with a dozen requirements neither
// waits for them one by one nor takes every connection the other pages share.
const EVENT_CONCURRENCY = 3;
// One competition's lists hold up to a few hundred thousand competitors per event.
const CACHED_COMPETITIONS = 5;

export type RequirementType = "attemptResult" | "ranking" | "anyResult";
export type ResultType = "single" | "average";

export interface Requirement {
  type: RequirementType;
  result_type: ResultType;
  when_date: string;
  level: number | null;
}

export interface EventRequirement {
  event_id: string;
  event_name: string;
  requirement: Requirement;
  /**
   * How many competitors meet it, or null when it is not checked: a top-N ranking is left to
   * the organisers, and a malformed requirement cannot be checked at all.
   */
  count: number | null;
}

export interface Competitor {
  wca_id: string;
  name: string;
  country_id: string | null;
  country_name: string | null;
}

export interface EventQualifier extends Competitor {
  /** Their best result in the event on or before the deadline. */
  result: number;
  /** Where they first achieved it. */
  competition_id: string;
  competition_name: string;
}

export interface UniqueQualifier extends Competitor {
  /** The checked events they qualify for, in event order. */
  events: string[];
}

export interface QualificationsResult {
  competition: {
    id: string;
    name: string;
    start_date: string;
    end_date: string;
    country_id: string;
  };
  events: EventRequirement[];
  /** Competitors who meet at least one checked requirement. */
  unique_count: number;
  list: string;
  page: number;
  page_size: number;
  qualifiers: EventQualifier[] | UniqueQualifier[];
}

interface CompetitionRow extends RowDataPacket {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  country_id: string;
}

interface CompetitionEventRow extends RowDataPacket {
  event_id: string;
  event_name: string;
  qualification: string;
}

interface QualifierRow extends RowDataPacket {
  person_id: string;
  value: number;
}

interface NameRow extends RowDataPacket {
  wca_id: string;
  name: string;
}

interface CompetitorRow extends RowDataPacket {
  wca_id: string;
  name: string;
  country_id: string | null;
  country_name: string | null;
}

interface AchievedRow extends RowDataPacket {
  person_id: string;
  value: number;
  competition_id: string;
  competition_name: string;
}

/** Everything a competition's pages are served from, computed once per export. */
interface ComputedQualifications {
  competition: QualificationsResult["competition"];
  events: EventRequirement[];
  /** Per checked event, its qualifiers ordered by result and then name. */
  lists: Map<string, { persons: string[]; values: Int32Array }>;
  /** Everyone who meets a checked requirement, by events met and then name. */
  unique: { persons: string[]; events: string[][] };
}

/**
 * Reads a requirement the way the WCA does (lib/qualification.rb), or returns null when the
 * stored JSON is not one, so a malformed requirement is shown as unchecked rather than failing
 * the whole competition.
 */
export function parseRequirement(json: string | null): Requirement | null {
  if (!json) return null;
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const { type, resultType, whenDate, level } = value as Record<string, unknown>;
  if (type !== "attemptResult" && type !== "ranking" && type !== "anyResult") return null;
  if (resultType !== "single" && resultType !== "average") return null;
  if (typeof whenDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(whenDate)) return null;
  return {
    type,
    result_type: resultType,
    when_date: whenDate,
    level: typeof level === "number" ? level : null,
  };
}

/**
 * A requirement this view checks: a result better than a limit, or any successful result.
 * A top-N ranking is not, because the WCA admits anyone with a result and leaves the cut to
 * the organisers, so no list here would match the one they publish.
 */
function isChecked(requirement: Requirement | null): requirement is Requirement {
  if (!requirement) return false;
  if (requirement.type === "anyResult") return true;
  return (
    requirement.type === "attemptResult" &&
    Number.isInteger(requirement.level) &&
    requirement.level! > 0
  );
}

/**
 * Everyone with a qualifying result in the event from a competition that ended on or before
 * the deadline, with their best such result. This is the WCA's own check: a successful result
 * for anyResult, and one strictly better than the level for attemptResult, so a result equal
 * to the limit does not qualify. Lower is better in every encoding, multi-blind included.
 *
 * Results lead the join through the covering index, so the event's range is read once and
 * each row looks up only its competition's end date.
 */
function qualifiersStatement(eventId: string, requirement: Requirement) {
  const column = requirement.result_type === "single" ? "best" : "average";
  const index =
    column === "best"
      ? "index_results_on_event_best_qualification"
      : "index_results_on_event_average_qualification";
  const params: unknown[] = [eventId];
  let limit = "";
  if (requirement.type === "attemptResult") {
    limit = `AND r.${column} < ?`;
    params.push(requirement.level);
  }
  params.push(requirement.when_date);
  return {
    sql: `SET STATEMENT max_statement_time=${QUALIFICATION_TIMEOUT_SECONDS} FOR
          SELECT r.person_id, MIN(r.${column}) AS value
          FROM results r FORCE INDEX (${index})
          STRAIGHT_JOIN competitions c ON c.id = r.competition_id
          WHERE r.event_id = ? AND r.${column} > 0 ${limit} AND c.end_date <= ?
          GROUP BY r.person_id`,
    params,
  };
}

async function mapConcurrently<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function computeQualifications(
  pool: Pool,
  competitionId: string,
): Promise<ComputedQualifications | null> {
  const [[competition]] = await pool.query<CompetitionRow[]>(
    `SELECT id, name,
            DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date,
            DATE_FORMAT(end_date, '%Y-%m-%d') AS end_date,
            country_id
     FROM competitions WHERE id = ? LIMIT 1`,
    [competitionId],
  );
  if (!competition) return null;

  const [eventRows] = await pool.query<CompetitionEventRow[]>(
    `SELECT ce.event_id, e.name AS event_name, ce.qualification
     FROM competition_events ce
     JOIN events e ON e.id = ce.event_id
     WHERE ce.competition_id = ? AND ce.qualification IS NOT NULL
     ORDER BY e.\`rank\``,
    [competition.id],
  );
  const parsed = eventRows
    .map((row) => ({ row, requirement: parseRequirement(row.qualification) }))
    .filter((entry): entry is { row: CompetitionEventRow; requirement: Requirement } =>
      entry.requirement !== null,
    );
  const checked = parsed.filter((entry) => isChecked(entry.requirement));

  // The same competitor recurs in most lists; one string each keeps a cached competition small.
  const interned = new Map<string, string>();
  const intern = (id: string) => {
    const existing = interned.get(id);
    if (existing) return existing;
    interned.set(id, id);
    return id;
  };
  const qualifierRows = await mapConcurrently(checked, EVENT_CONCURRENCY, async (entry) => {
    const { sql, params } = qualifiersStatement(entry.row.event_id, entry.requirement);
    const [rows] = await pool.query<QualifierRow[]>(sql, params);
    return rows.map((row) => ({ person_id: intern(row.person_id), value: Number(row.value) }));
  });

  // Names order the lists. Reading every current name once is cheaper than joining them to a
  // few hundred thousand grouped rows per event, and they are dropped once sorted.
  const names = new Map<string, string>();
  if (interned.size > 0) {
    const [nameRows] = await pool.query<NameRow[]>(
      "SELECT wca_id, name FROM persons WHERE sub_id = 1",
    );
    for (const row of nameRows) if (interned.has(row.wca_id)) names.set(row.wca_id, row.name);
  }
  const byName = (a: string, b: string) =>
    (names.get(a) ?? a).localeCompare(names.get(b) ?? b) || a.localeCompare(b);

  const lists = new Map<string, { persons: string[]; values: Int32Array }>();
  const metBy = new Map<string, string[]>();
  checked.forEach((entry, index) => {
    const rows = qualifierRows[index].sort(
      (a, b) => a.value - b.value || byName(a.person_id, b.person_id),
    );
    lists.set(entry.row.event_id, {
      persons: rows.map((row) => row.person_id),
      values: Int32Array.from(rows, (row) => row.value),
    });
    for (const row of rows) {
      const events = metBy.get(row.person_id);
      if (events) events.push(entry.row.event_id);
      else metBy.set(row.person_id, [entry.row.event_id]);
    }
  });
  const uniquePersons = [...metBy.keys()].sort(
    (a, b) => metBy.get(b)!.length - metBy.get(a)!.length || byName(a, b),
  );

  return {
    competition: {
      id: competition.id,
      name: competition.name,
      start_date: competition.start_date,
      end_date: competition.end_date,
      country_id: competition.country_id,
    },
    events: parsed.map(({ row, requirement }) => ({
      event_id: row.event_id,
      event_name: row.event_name,
      requirement,
      count: lists.get(row.event_id)?.persons.length ?? null,
    })),
    lists,
    unique: {
      persons: uniquePersons,
      events: uniquePersons.map((person) => metBy.get(person)!),
    },
  };
}

async function competitors(pool: Pool, ids: string[]): Promise<Map<string, Competitor>> {
  if (ids.length === 0) return new Map();
  const [rows] = await pool.query<CompetitorRow[]>(
    `SELECT p.wca_id, p.name, p.country_id, co.name AS country_name
     FROM persons p
     LEFT JOIN countries co ON co.id = p.country_id
     WHERE p.sub_id = 1 AND p.wca_id IN (?)`,
    [ids],
  );
  const found = new Map(rows.map((row) => [row.wca_id, { ...row } as Competitor]));
  // A result can name a competitor the persons table does not have yet; show them by ID.
  return new Map(
    ids.map((id) => [
      id,
      found.get(id) ?? { wca_id: id, name: id, country_id: null, country_name: null },
    ]),
  );
}

/**
 * The earliest competition, by end date, where each competitor achieved their listed result.
 * It looks the results up by value through the covering index rather than by competitor: the
 * best in an event have thousands of results each, but few results share one exact value.
 */
async function achievedAt(
  pool: Pool,
  eventId: string,
  requirement: Requirement,
  persons: string[],
  values: number[],
): Promise<Map<string, { competition_id: string; competition_name: string }>> {
  if (persons.length === 0) return new Map();
  const column = requirement.result_type === "single" ? "best" : "average";
  const index =
    column === "best"
      ? "index_results_on_event_best_qualification"
      : "index_results_on_event_average_qualification";
  const [rows] = await pool.query<AchievedRow[]>(
    `SELECT r.person_id, r.${column} AS value, r.competition_id, c.name AS competition_name
     FROM results r FORCE INDEX (${index})
     STRAIGHT_JOIN competitions c ON c.id = r.competition_id
     WHERE r.event_id = ? AND r.${column} IN (?) AND r.person_id IN (?) AND c.end_date <= ?
     ORDER BY c.end_date, c.id`,
    [eventId, [...new Set(values)], persons, requirement.when_date],
  );
  const listed = new Map(persons.map((person, index) => [person, values[index]]));
  const achieved = new Map<string, { competition_id: string; competition_name: string }>();
  for (const row of rows) {
    if (row.value === listed.get(row.person_id) && !achieved.has(row.person_id)) {
      achieved.set(row.person_id, {
        competition_id: row.competition_id,
        competition_name: row.competition_name,
      });
    }
  }
  return achieved;
}

async function servePage(
  pool: Pool,
  computed: ComputedQualifications,
  list: string,
  page: number,
): Promise<QualificationsResult> {
  const start = (page - 1) * QUALIFIERS_PAGE_SIZE;
  const end = start + QUALIFIERS_PAGE_SIZE;
  const base = {
    competition: computed.competition,
    events: computed.events,
    unique_count: computed.unique.persons.length,
    list,
    page,
    page_size: QUALIFIERS_PAGE_SIZE,
  };

  if (list === UNIQUE_LIST) {
    const persons = computed.unique.persons.slice(start, end);
    const details = await competitors(pool, persons);
    return {
      ...base,
      qualifiers: persons.map((person, index) => ({
        ...details.get(person)!,
        events: computed.unique.events[start + index],
      })),
    };
  }

  const qualifiers = computed.lists.get(list)!;
  const requirement = computed.events.find((event) => event.event_id === list)!.requirement;
  const persons = qualifiers.persons.slice(start, end);
  const values = Array.from(qualifiers.values.subarray(start, end));
  const [details, achieved] = await Promise.all([
    competitors(pool, persons),
    achievedAt(pool, list, requirement, persons, values),
  ]);
  return {
    ...base,
    qualifiers: persons.map((person, index) => ({
      ...details.get(person)!,
      result: values[index],
      competition_id: achieved.get(person)?.competition_id ?? "",
      competition_name: achieved.get(person)?.competition_name ?? "",
    })),
  };
}

export async function qualificationIndexesReady(pool: Pool): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT index_name FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND table_name = 'results'
       AND index_name IN ('index_results_on_event_best_qualification',
                          'index_results_on_event_average_qualification')`,
  );
  return rows.length === 2;
}

/**
 * Serves a competition's qualification lists. Computing them reads every qualifying result,
 * so each competition is computed once per export and its pages are served from memory; the
 * few most recently viewed are kept. Concurrent requests for one competition share the work.
 */
export function createQualificationsService(pool: Pool) {
  const cache = new Map<string, ComputedQualifications | null>();
  const pending = new Map<string, Promise<ComputedQualifications | null>>();

  const computed = async (competitionId: string) => {
    const [[metadata]] = await pool.query<RowDataPacket[]>(
      "SELECT value FROM wca_statistics_metadata WHERE field = 'export_timestamp' LIMIT 1",
    );
    const key = JSON.stringify([metadata?.value ?? null, competitionId.toLowerCase()]);
    if (cache.has(key)) {
      const hit = cache.get(key)!;
      cache.delete(key);
      cache.set(key, hit);
      return hit;
    }
    let work = pending.get(key);
    if (!work) {
      work = computeQualifications(pool, competitionId)
        .then((value) => {
          // Without an export timestamp nothing says when the data changes, so keep nothing.
          if (metadata?.value) {
            cache.set(key, value);
            while (cache.size > CACHED_COMPETITIONS) cache.delete(cache.keys().next().value!);
          }
          return value;
        })
        .finally(() => pending.delete(key));
      pending.set(key, work);
    }
    return work;
  };

  return {
    async get(competitionId: string, list: string, page: number) {
      const result = await computed(competitionId);
      if (!result) return null;
      if (list !== UNIQUE_LIST && !result.lists.has(list)) {
        throw new QualificationInputError(
          "list must be unique or an event with a checked requirement at this competition",
        );
      }
      return servePage(pool, result, list, page);
    },
  };
}
