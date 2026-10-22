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
// One competition's lists hold up to a few hundred thousand competitors per event. Custom
// requirement sets share the same slots.
const CACHED_COMPUTATIONS = 5;
// A custom set holds at most one requirement per event, and there are fewer events than this.
export const MAX_CUSTOM_REQUIREMENTS = 20;
// Who competed since a date is one set per date; a few dates cover the presets people use.
const CACHED_COMPETED_SINCE = 4;
// An attempt result is a signed 32-bit integer in the export.
const MAX_LEVEL = 2147483647;

export type RequirementType = "attemptResult" | "ranking" | "anyResult";
export type ResultType = "single" | "average";

export interface Requirement {
  type: RequirementType;
  result_type: ResultType;
  /** The deadline; a custom requirement may have none, and then every result counts. */
  when_date: string | null;
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

/** The logged-in competitor's own row in the selected list, when they are in it. */
export interface ViewerQualification<T> {
  /** Their place in the list as filtered, counting from 1. */
  position: number;
  qualifier: T;
}

export interface QualificationsResult {
  /** The competition whose requirements these are, or null for custom requirements. */
  competition: {
    id: string;
    name: string;
    start_date: string;
    end_date: string;
    country_id: string;
  } | null;
  events: EventRequirement[];
  /** Competitors who meet at least one checked requirement. */
  unique_count: number;
  /** World, a continent or a country id, matched against current nationality. */
  region: string;
  /** Only competitors with a result at a competition ending on or after this date, if set. */
  competed_since: string | null;
  list: string;
  page: number;
  page_size: number;
  qualifiers: EventQualifier[] | UniqueQualifier[];
  /** The logged-in competitor's WCA ID, whether or not they are in the list. */
  viewer_wca_id: string | null;
  /** Their name as the persons table has it, or the WCA ID when it does not have them yet. */
  viewer_name: string | null;
  /** The viewer's row, whichever page it is on, or null when they are not in the list. */
  viewer: ViewerQualification<EventQualifier> | ViewerQualification<UniqueQualifier> | null;
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

interface EventRow extends RowDataPacket {
  id: string;
  name: string;
}

/** One event's requirement, as both competitions and custom sets hand it to the computation. */
interface EventEntry {
  event_id: string;
  event_name: string;
  requirement: Requirement;
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

/** Filters that narrow every list and count, as a request names them. */
export interface QualificationFilters {
  /** The logged-in competitor's WCA ID, whose own row is returned apart from the page. */
  viewer?: string | null;
  /** World by default, a continent or a country. */
  region?: string;
  /** A date written as YYYY-MM-DD. */
  competed_since?: string | null;
}

/** The filters checked and ready to apply. */
interface ResolvedFilters {
  /** The logged-in competitor's WCA ID, if they have one, to find their own row. */
  viewer: string | null;
  regionId: string;
  region: Region;
  competedSince: string | null;
  /** Everyone with a result since competedSince, or null when it is not set. */
  competed: Set<string> | null;
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

/** Everything a competition's or custom set's pages are served from, computed once per export. */
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
  // Without a deadline every result counts, and the index alone answers the statement.
  let deadline = "";
  let join = "";
  if (requirement.when_date !== null) {
    join = "STRAIGHT_JOIN competitions c ON c.id = r.competition_id";
    deadline = "AND c.end_date <= ?";
    params.push(requirement.when_date);
  }
  return {
    sql: `SET STATEMENT max_statement_time=${QUALIFICATION_TIMEOUT_SECONDS} FOR
          SELECT r.person_id, MIN(r.${column}) AS value
          FROM results r FORCE INDEX (${index})
          ${join}
          WHERE r.event_id = ? AND r.${column} > 0 ${limit} ${deadline}
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

async function computeCompetition(
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
  return computeLists(
    pool,
    {
      id: competition.id,
      name: competition.name,
      start_date: competition.start_date,
      end_date: competition.end_date,
      country_id: competition.country_id,
    },
    parsed.map(({ row, requirement }) => ({
      event_id: row.event_id,
      event_name: row.event_name,
      requirement,
    })),
  );
}

/**
 * Lists everyone who meets each checked requirement, and everyone who meets at least one.
 * Requirements that are not checked are kept so they can be shown, with no count.
 */
async function computeLists(
  pool: Pool,
  competition: QualificationsResult["competition"],
  entries: EventEntry[],
): Promise<ComputedQualifications> {
  const checked = entries.filter((entry) => isChecked(entry.requirement));

  // The same competitor recurs in most lists; one string each keeps a cached competition small.
  const interned = new Map<string, string>();
  const intern = (id: string) => {
    const existing = interned.get(id);
    if (existing) return existing;
    interned.set(id, id);
    return id;
  };
  const qualifierRows = await mapConcurrently(checked, EVENT_CONCURRENCY, async (entry) => {
    const { sql, params } = qualifiersStatement(entry.event_id, entry.requirement);
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
    lists.set(entry.event_id, {
      persons: rows.map((row) => row.person_id),
      values: Int32Array.from(rows, (row) => row.value),
    });
    for (const row of rows) {
      const events = metBy.get(row.person_id);
      if (events) events.push(entry.event_id);
      else metBy.set(row.person_id, [entry.event_id]);
    }
  });
  const uniquePersons = [...metBy.keys()].sort(
    (a, b) => metBy.get(b)!.length - metBy.get(a)!.length || byName(a, b),
  );

  return {
    competition,
    events: entries.map((entry) => ({
      ...entry,
      count: lists.get(entry.event_id)?.persons.length ?? null,
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
     WHERE r.event_id = ? AND r.${column} IN (?) AND r.person_id IN (?)
       ${requirement.when_date === null ? "" : "AND c.end_date <= ?"}
     ORDER BY c.end_date, c.id`,
    [
      eventId,
      [...new Set(values)],
      persons,
      ...(requirement.when_date === null ? [] : [requirement.when_date]),
    ],
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
 * One page of a list, filtered. The cached lists hold everyone, so the region and the
 * competed-since filter narrow them here: a few hundred thousand lookups per list,
 * milliseconds next to computing them.
 */
async function servePage(
  pool: Pool,
  computed: ComputedQualifications,
  list: string,
  page: number,
  filters: ResolvedFilters,
): Promise<QualificationsResult> {
  const start = (page - 1) * QUALIFIERS_PAGE_SIZE;
  const end = start + QUALIFIERS_PAGE_SIZE;
  const inRegion = regionFilter(computed, filters.region);
  const competed = filters.competed;
  const kept = competed
    ? (person: string) => competed.has(person) && inRegion(person)
    : inRegion;
  // Named world for the unfiltered case, which skips filtering altogether.
  const world = filters.region.kind === "world" && competed === null;
  const unique = world ? null : positionsIn(computed.unique.persons, kept);
  const base = {
    competition: computed.competition,
    events: computed.events.map((event) => {
      const qualifiers = computed.lists.get(event.event_id);
      if (!qualifiers || world) return event;
      return { ...event, count: qualifiers.persons.filter(kept).length };
    }),
    unique_count: unique ? unique.length : computed.unique.persons.length,
    region: filters.regionId,
    competed_since: filters.competedSince,
    viewer_wca_id: filters.viewer,
    list,
    page,
    page_size: QUALIFIERS_PAGE_SIZE,
  };

  // The viewer's own row is looked up across the whole filtered list, not just this page, so
  // it can be shown above any page with the place it holds.
  const findViewer = (persons: string[], positions: number[]) => {
    if (filters.viewer === null) return -1;
    const index = persons.indexOf(filters.viewer);
    return index === -1 ? -1 : positions.indexOf(index);
  };
  // A viewer in the list has their name in their row; one who is not is named apart.
  const nameViewer = async (row: Competitor | undefined) => {
    if (row) return row.name;
    if (filters.viewer === null) return null;
    return (await competitors(pool, [filters.viewer])).get(filters.viewer)!.name;
  };

  if (list === UNIQUE_LIST) {
    const all = unique ?? computed.unique.persons.map((_, index) => index);
    const viewerAt = findViewer(computed.unique.persons, all);
    const positions = all.slice(start, end);
    const pageSize = positions.length;
    if (viewerAt !== -1 && !positions.includes(all[viewerAt])) positions.push(all[viewerAt]);
    const persons = positions.map((position) => computed.unique.persons[position]);
    const details = await competitors(pool, persons);
    const rows = persons.map((person, index) => ({
      ...details.get(person)!,
      events: computed.unique.events[positions[index]],
    }));
    return {
      ...base,
      qualifiers: rows.slice(0, pageSize),
      viewer_name: await nameViewer(
        viewerAt === -1 ? undefined : rows[positions.indexOf(all[viewerAt])],
      ),
      viewer:
        viewerAt === -1
          ? null
          : { position: viewerAt + 1, qualifier: rows[positions.indexOf(all[viewerAt])] },
    };
  }

  const qualifiers = computed.lists.get(list)!;
  const requirement = computed.events.find((event) => event.event_id === list)!.requirement;
  const all = world
    ? qualifiers.persons.map((_, index) => index)
    : positionsIn(qualifiers.persons, kept);
  const viewerAt = findViewer(qualifiers.persons, all);
  const positions = all.slice(start, end);
  const pageSize = positions.length;
  // The viewer's row is fetched with the page's, in the same two lookups.
  if (viewerAt !== -1 && !positions.includes(all[viewerAt])) positions.push(all[viewerAt]);
  const persons = positions.map((position) => qualifiers.persons[position]);
  const values = positions.map((position) => qualifiers.values[position]);
  const [details, achieved] = await Promise.all([
    competitors(pool, persons),
    achievedAt(pool, list, requirement, persons, values),
  ]);
  const rows = persons.map((person, index) => ({
    ...details.get(person)!,
    result: values[index],
    competition_id: achieved.get(person)?.competition_id ?? "",
    competition_name: achieved.get(person)?.competition_name ?? "",
  }));
  return {
    ...base,
    qualifiers: rows.slice(0, pageSize),
    viewer_name: await nameViewer(
      viewerAt === -1 ? undefined : rows[positions.indexOf(all[viewerAt])],
    ),
    viewer:
      viewerAt === -1
        ? null
        : { position: viewerAt + 1, qualifier: rows[positions.indexOf(all[viewerAt])] },
  };
}

const CUSTOM_REQUIREMENT_RE = /^([a-z0-9]{2,6}):(single|average):(any|[1-9][0-9]{0,9})$/;

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * Reads a custom requirement set: comma-separated `event:single|average:level`, where the
 * level is an encoded attempt result the result must be strictly better than, or `any` for
 * any successful result. One deadline, or none, applies to every event. Top N cannot be asked
 * for, since who meets it depends on registrations. Event names are checked by the caller.
 */
export function parseCustomRequirements(
  spec: string,
  deadline: string | null,
): { event_id: string; requirement: Requirement }[] {
  if (deadline !== null && !isIsoDate(deadline)) {
    throw new QualificationInputError("deadline must be a date written as YYYY-MM-DD");
  }
  const parts = spec.split(",").filter((part) => part !== "");
  if (parts.length === 0) {
    throw new QualificationInputError("requirements must name at least one event");
  }
  if (parts.length > MAX_CUSTOM_REQUIREMENTS) {
    throw new QualificationInputError(
      `requirements can name at most ${MAX_CUSTOM_REQUIREMENTS} events`,
    );
  }
  const seen = new Set<string>();
  return parts.map((part) => {
    const match = CUSTOM_REQUIREMENT_RE.exec(part);
    if (!match) {
      throw new QualificationInputError(
        `"${part}" is not a requirement; expected event:single|average:limit or event:single|average:any`,
      );
    }
    const [, eventId, resultType, level] = match;
    if (seen.has(eventId)) {
      throw new QualificationInputError(`${eventId} has more than one requirement`);
    }
    seen.add(eventId);
    if (level !== "any" && Number(level) > MAX_LEVEL) {
      throw new QualificationInputError(`the limit for ${eventId} is not an attempt result`);
    }
    return {
      event_id: eventId,
      requirement: {
        type: level === "any" ? "anyResult" : "attemptResult",
        result_type: resultType as ResultType,
        when_date: deadline,
        level: level === "any" ? null : Number(level),
      },
    };
  });
}

/** Names the events of a custom set, in event order, or rejects an event the export lacks. */
async function computeCustom(
  pool: Pool,
  requirements: { event_id: string; requirement: Requirement }[],
): Promise<ComputedQualifications> {
  const [rows] = await pool.query<EventRow[]>(
    "SELECT id, name FROM events WHERE id IN (?) ORDER BY `rank`",
    [requirements.map((entry) => entry.event_id)],
  );
  const missing = requirements.find((entry) => !rows.some((row) => row.id === entry.event_id));
  if (missing) throw new QualificationInputError(`Unknown event ${missing.event_id}`);
  const byEvent = new Map(requirements.map((entry) => [entry.event_id, entry.requirement]));
  return computeLists(
    pool,
    null,
    rows.map((row) => ({
      event_id: row.id,
      event_name: row.name,
      requirement: byEvent.get(row.id)!,
    })),
  );
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
 * so each competition or custom set is computed once per export and its pages are served
 * from memory; the few most recently viewed are kept. Concurrent requests for one share the work.
 */
export function createQualificationsService(pool: Pool) {
  const cache = new Map<string, ComputedQualifications | null>();
  const pending = new Map<string, Promise<ComputedQualifications | null>>();

  const computed = async (
    identity: unknown[],
    compute: () => Promise<ComputedQualifications | null>,
  ) => {
    const [[metadata]] = await pool.query<RowDataPacket[]>(
      "SELECT value FROM wca_statistics_metadata WHERE field = 'export_timestamp' LIMIT 1",
    );
    const key = JSON.stringify([metadata?.value ?? null, ...identity]);
    if (cache.has(key)) {
      const hit = cache.get(key)!;
      cache.delete(key);
      cache.set(key, hit);
      return hit;
    }
    let work = pending.get(key);
    if (!work) {
      work = compute()
        .then((value) => {
          // Without an export timestamp nothing says when the data changes, so keep nothing.
          if (metadata?.value) {
            cache.set(key, value);
            while (cache.size > CACHED_COMPUTATIONS) cache.delete(cache.keys().next().value!);
          }
          return value;
        })
        .finally(() => pending.delete(key));
      pending.set(key, work);
    }
    return work;
  };

  const competedSets = new Map<string, Promise<Set<string>>>();
  /**
   * Everyone with a result at a competition that ended on or after the date. The competitions
   * index on end date leads, and results are read by competition through a covering index, so
   * a year of competitions costs about a second; the set is kept per export and date.
   */
  const competedSince = async (date: string) => {
    const [[metadata]] = await pool.query<RowDataPacket[]>(
      "SELECT value FROM wca_statistics_metadata WHERE field = 'export_timestamp' LIMIT 1",
    );
    const key = JSON.stringify([metadata?.value ?? null, date]);
    let work = competedSets.get(key);
    if (work) {
      competedSets.delete(key);
      competedSets.set(key, work);
      return work;
    }
    work = pool
      .query<RowDataPacket[]>(
        `SET STATEMENT max_statement_time=${QUALIFICATION_TIMEOUT_SECONDS} FOR
         SELECT DISTINCT r.person_id
         FROM competitions c
         JOIN results r ON r.competition_id = c.id
         WHERE c.end_date >= ?`,
        [date],
      )
      .then(([rows]) => new Set(rows.map((row) => row.person_id as string)));
    // A failed computation is not kept, so the next request tries again.
    work.catch(() => competedSets.delete(key));
    if (metadata?.value) {
      competedSets.set(key, work);
      while (competedSets.size > CACHED_COMPETED_SINCE) {
        competedSets.delete(competedSets.keys().next().value!);
      }
    }
    return work;
  };

  const resolveFilters = async (filters: QualificationFilters): Promise<ResolvedFilters> => {
    const regionId = filters.region ?? WORLD;
    const region = await resolveRegion(pool, regionId);
    if (!region) {
      throw new QualificationInputError("region must be World, a continent or a country");
    }
    const since = filters.competed_since ?? null;
    if (since !== null && !isIsoDate(since)) {
      throw new QualificationInputError("competed_since must be a date written as YYYY-MM-DD");
    }
    return {
      viewer: filters.viewer ?? null,
      regionId,
      region,
      competedSince: since,
      competed: since === null ? null : await competedSince(since),
    };
  };

  const page = (
    result: ComputedQualifications,
    list: string,
    pageNumber: number,
    filters: ResolvedFilters,
  ) => {
    if (list !== UNIQUE_LIST && !result.lists.has(list)) {
      throw new QualificationInputError(
        "list must be unique or an event with a checked requirement",
      );
    }
    return servePage(pool, result, list, pageNumber, filters);
  };

  return {
    /** A competition's own requirements, or null when there is no such competition. */
    async get(
      competitionId: string,
      list: string,
      pageNumber: number,
      filters: QualificationFilters = {},
    ) {
      const resolved = await resolveFilters(filters);
      const result = await computed(["competition", competitionId.toLowerCase()], () =>
        computeCompetition(pool, competitionId),
      );
      if (!result) return null;
      return page(result, list, pageNumber, resolved);
    },

    /** Requirements the user sets; see parseCustomRequirements for the format. */
    async getCustom(
      spec: string,
      deadline: string | null,
      list: string,
      pageNumber: number,
      filters: QualificationFilters = {},
    ) {
      const requirements = parseCustomRequirements(spec, deadline);
      const resolved = await resolveFilters(filters);
      // The same set written in another order is the same computation.
      const identity = [
        "custom",
        deadline,
        [...requirements]
          .sort((a, b) => a.event_id.localeCompare(b.event_id))
          .map(({ event_id, requirement }) => [event_id, requirement.result_type, requirement.level]),
      ];
      const result = await computed(identity, () => computeCustom(pool, requirements));
      return page(result!, list, pageNumber, resolved);
    },
  };
}
