import { Pool, RowDataPacket } from "mysql2/promise";

export class QualificationInputError extends Error {}

export const QUALIFIERS_PAGE_SIZE = 100;
export const UNIQUE_LIST = "unique";
export const WORLD = "World";

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
   * How many competitors meet it, or null when it is not checked: a top N requirement depends
   * on who registers, and a malformed requirement cannot be checked at all.
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
  /** World, a continent or a country id, matched against current nationality. */
  region: string;
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
  country_id: string;
  continent_id: string | null;
}

interface RegionRow extends RowDataPacket {
  kind: "continent" | "country";
}

/** Which competitors a list keeps: everyone, or those currently from a continent or country. */
type Region =
  | { kind: "world" }
  | { kind: "continent" | "country"; id: string };

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
  /** Current nationality of every listed competitor the persons table has. */
  nationality: Map<string, { country_id: string; continent_id: string | null }>;
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
 * A top N requirement is not: it admits the N best of the competitors who register, by their
 * single or average, so who meets it depends on the registrations rather than on results alone.
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

  // Names order the lists and nationality filters them by region. Reading every current
  // competitor once is cheaper than joining them to a few hundred thousand grouped rows per
  // event; the names are dropped once sorted, and the few distinct regions are shared.
  const names = new Map<string, string>();
  const nationality = new Map<string, { country_id: string; continent_id: string | null }>();
  const regions = new Map<string, { country_id: string; continent_id: string | null }>();
  if (interned.size > 0) {
    const [nameRows] = await pool.query<NameRow[]>(
      `SELECT p.wca_id, p.name, p.country_id, co.continent_id
       FROM persons p
       LEFT JOIN countries co ON co.id = p.country_id
       WHERE p.sub_id = 1`,
    );
    for (const row of nameRows) {
      const person = interned.get(row.wca_id);
      if (!person) continue;
      names.set(person, row.name);
      let region = regions.get(row.country_id);
      if (!region) {
        region = { country_id: row.country_id, continent_id: row.continent_id };
        regions.set(row.country_id, region);
      }
      nationality.set(person, region);
    }
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
    nationality,
  };
}

/**
 * Reads a region the way the statistics name them: World, a continent id or a country id.
 * Returns null for anything else.
 */
async function resolveRegion(pool: Pool, id: string): Promise<Region | null> {
  if (id === WORLD) return { kind: "world" };
  const [[row]] = await pool.query<RegionRow[]>(
    `SELECT 'continent' AS kind FROM continents WHERE id = ?
     UNION ALL
     SELECT 'country' AS kind FROM countries WHERE id = ?
     LIMIT 1`,
    [id, id],
  );
  return row ? { kind: row.kind, id } : null;
}

/**
 * Whether a competitor belongs to the region by their current nationality. Someone the persons
 * table does not have yet has no nationality, so they are only listed for the world.
 */
function regionFilter(computed: ComputedQualifications, region: Region) {
  if (region.kind === "world") return () => true;
  const key = region.kind === "continent" ? "continent_id" : "country_id";
  return (person: string) => computed.nationality.get(person)?.[key] === region.id;
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

/** Positions in a list of the competitors who belong to the region, in list order. */
function positionsIn(persons: string[], inRegion: (person: string) => boolean): number[] {
  const positions: number[] = [];
  persons.forEach((person, index) => {
    if (inRegion(person)) positions.push(index);
  });
  return positions;
}

/**
 * One page of a list for a region. The cached lists hold the world, so a region filters them
 * here: a few hundred thousand map lookups per list, milliseconds next to computing them.
 */
async function servePage(
  pool: Pool,
  computed: ComputedQualifications,
  list: string,
  page: number,
  regionId: string,
  region: Region,
): Promise<QualificationsResult> {
  const start = (page - 1) * QUALIFIERS_PAGE_SIZE;
  const end = start + QUALIFIERS_PAGE_SIZE;
  const inRegion = regionFilter(computed, region);
  const world = region.kind === "world";
  const unique = world ? null : positionsIn(computed.unique.persons, inRegion);
  const base = {
    competition: computed.competition,
    events: computed.events.map((event) => {
      const qualifiers = computed.lists.get(event.event_id);
      if (!qualifiers || world) return event;
      return { ...event, count: qualifiers.persons.filter(inRegion).length };
    }),
    unique_count: unique ? unique.length : computed.unique.persons.length,
    region: regionId,
    list,
    page,
    page_size: QUALIFIERS_PAGE_SIZE,
  };

  if (list === UNIQUE_LIST) {
    const positions = (unique ?? computed.unique.persons.map((_, index) => index)).slice(
      start,
      end,
    );
    const persons = positions.map((position) => computed.unique.persons[position]);
    const details = await competitors(pool, persons);
    return {
      ...base,
      qualifiers: persons.map((person, index) => ({
        ...details.get(person)!,
        events: computed.unique.events[positions[index]],
      })),
    };
  }

  const qualifiers = computed.lists.get(list)!;
  const requirement = computed.events.find((event) => event.event_id === list)!.requirement;
  const positions = (
    world
      ? qualifiers.persons.map((_, index) => index)
      : positionsIn(qualifiers.persons, inRegion)
  ).slice(start, end);
  const persons = positions.map((position) => qualifiers.persons[position]);
  const values = positions.map((position) => qualifiers.values[position]);
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
    async get(competitionId: string, list: string, page: number, regionId: string = WORLD) {
      const region = await resolveRegion(pool, regionId);
      if (!region) {
        throw new QualificationInputError("region must be World, a continent or a country");
      }
      const result = await computed(competitionId);
      if (!result) return null;
      if (list !== UNIQUE_LIST && !result.lists.has(list)) {
        throw new QualificationInputError(
          "list must be unique or an event with a checked requirement at this competition",
        );
      }
      return servePage(pool, result, list, page, regionId, region);
    },
  };
}
