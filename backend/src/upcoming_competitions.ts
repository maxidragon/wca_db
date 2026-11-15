import { Pool, RowDataPacket } from "mysql2/promise";

export class UpcomingCompetitionsInputError extends Error {}

export const REGISTRATION_STATUSES = ["not_open", "open", "full", "closed"] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

export const CHAMPIONSHIP_MODES = ["include", "exclude", "only"] as const;
export type ChampionshipMode = (typeof CHAMPIONSHIP_MODES)[number];

const WORLD = "World";

export interface Championship {
  type: string;
  name: string;
}

/** A competition as read from the export; the registration status depends on the time asked. */
export interface UpcomingCompetition {
  id: string;
  name: string;
  city: string;
  country_id: string;
  country_name: string;
  country_iso2: string | null;
  continent_id: string;
  start_date: string;
  end_date: string;
  latitude: number | null;
  longitude: number | null;
  competitor_limit: number | null;
  accepted_registrations: number;
  registration_open: string | null;
  registration_close: string | null;
  championships: Championship[];
  events: string[];
}

export interface UpcomingCompetitionsOptions {
  regions: { id: string; name: string; kind: "world" | "continent" | "country" }[];
  events: { id: string; name: string }[];
}

export interface UpcomingCompetitionsFilters {
  q: string;
  region: string;
  from: string | null;
  to: string | null;
  events: string[];
  championships: ChampionshipMode;
  min_limit: number | null;
  max_limit: number | null;
  registration: RegistrationStatus[];
  new_countries: boolean;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LIMIT_FILTER = 100000;

function isValidDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function list(value: unknown): string[] {
  if (value === undefined || value === "") return [];
  if (typeof value !== "string") throw new UpcomingCompetitionsInputError("Malformed filter");
  return [...new Set(value.split(",").map((part) => part.trim()).filter(Boolean))];
}

function scalar(query: Record<string, unknown>, key: string): string {
  const value = query[key];
  if (value === undefined) return "";
  if (typeof value !== "string") throw new UpcomingCompetitionsInputError(`Malformed ${key}`);
  return value.trim();
}

function limitBound(query: Record<string, unknown>, key: string): number | null {
  const value = scalar(query, key);
  if (!value) return null;
  if (!/^\d+$/.test(value) || Number(value) > MAX_LIMIT_FILTER) {
    throw new UpcomingCompetitionsInputError(`${key} must be a whole number of competitors`);
  }
  return Number(value);
}

/** Reads the filters from a query string, rejecting anything the options do not know. */
export function parseUpcomingCompetitionsFilters(
  query: Record<string, unknown>,
  options: UpcomingCompetitionsOptions,
): UpcomingCompetitionsFilters {
  const q = scalar(query, "q");
  if (q.length > 100) throw new UpcomingCompetitionsInputError("Search must be at most 100 characters");

  const region = scalar(query, "region") || WORLD;
  if (!options.regions.some((r) => r.id === region)) {
    throw new UpcomingCompetitionsInputError("Unknown region");
  }

  const from = scalar(query, "from") || null;
  const to = scalar(query, "to") || null;
  for (const [key, value] of [["from", from], ["to", to]] as const) {
    if (value !== null && !isValidDate(value)) {
      throw new UpcomingCompetitionsInputError(`${key} must be a date (YYYY-MM-DD)`);
    }
  }
  if (from && to && from > to) throw new UpcomingCompetitionsInputError("from must not be after to");

  const events = list(query.events);
  if (events.some((id) => !options.events.some((e) => e.id === id))) {
    throw new UpcomingCompetitionsInputError("Unknown event");
  }

  const championships = (scalar(query, "championships") || "include") as ChampionshipMode;
  if (!CHAMPIONSHIP_MODES.includes(championships)) {
    throw new UpcomingCompetitionsInputError("championships must be one of include, exclude, only");
  }

  const min_limit = limitBound(query, "min_limit");
  const max_limit = limitBound(query, "max_limit");
  if (min_limit !== null && max_limit !== null && min_limit > max_limit) {
    throw new UpcomingCompetitionsInputError("min_limit must not be above max_limit");
  }

  const registration = list(query.registration) as RegistrationStatus[];
  if (registration.some((status) => !REGISTRATION_STATUSES.includes(status))) {
    throw new UpcomingCompetitionsInputError(
      `registration must be a list of ${REGISTRATION_STATUSES.join(", ")}`,
    );
  }

  const newCountries = scalar(query, "new_countries");
  if (newCountries !== "" && newCountries !== "0" && newCountries !== "1") {
    throw new UpcomingCompetitionsInputError("new_countries must be 0 or 1");
  }

  return {
    q,
    region,
    from,
    to,
    events,
    championships,
    min_limit,
    max_limit,
    registration,
    new_countries: newCountries === "1",
  };
}

/**
 * The status the WCA website shows, in its order: before opening, after closing, full, open.
 * Full counts accepted registrations only; the export does not say who is waiting to pay.
 */
export function registrationStatus(
  competition: Pick<
    UpcomingCompetition,
    "registration_open" | "registration_close" | "competitor_limit" | "accepted_registrations"
  >,
  now: Date,
): RegistrationStatus {
  if (competition.registration_open && now < new Date(competition.registration_open)) return "not_open";
  if (competition.registration_close && new Date(competition.registration_close) < now) return "closed";
  if (
    competition.competitor_limit !== null &&
    competition.accepted_registrations >= competition.competitor_limit
  ) {
    return "full";
  }
  return "open";
}

// Multi-location competitions have a region instead of a country (XE, XA, …).
const isMultiCountryRegion = (countryId: string) => countryId.startsWith("X");

export function filterUpcomingCompetitions(
  competitions: UpcomingCompetition[],
  filters: UpcomingCompetitionsFilters,
  context: {
    now: Date;
    regionKind: "world" | "continent" | "country";
    competedCountries: Set<string> | null;
  },
) {
  const term = filters.q.toLowerCase();
  return competitions
    .map((competition) => ({
      ...competition,
      registration_status: registrationStatus(competition, context.now),
    }))
    .filter((c) => {
      if (term && !c.name.toLowerCase().includes(term) && !c.city.toLowerCase().includes(term)) {
        return false;
      }
      if (context.regionKind === "continent" && c.continent_id !== filters.region) return false;
      if (context.regionKind === "country" && c.country_id !== filters.region) return false;
      if (filters.from && c.start_date < filters.from) return false;
      if (filters.to && c.start_date > filters.to) return false;
      if (filters.events.some((id) => !c.events.includes(id))) return false;
      if (filters.championships === "exclude" && c.championships.length > 0) return false;
      if (filters.championships === "only" && c.championships.length === 0) return false;
      // A competition without a limit has no number to compare, so a bound leaves it out.
      if (filters.min_limit !== null || filters.max_limit !== null) {
        if (c.competitor_limit === null) return false;
        if (filters.min_limit !== null && c.competitor_limit < filters.min_limit) return false;
        if (filters.max_limit !== null && c.competitor_limit > filters.max_limit) return false;
      }
      if (filters.registration.length > 0 && !filters.registration.includes(c.registration_status)) {
        return false;
      }
      if (context.competedCountries) {
        if (isMultiCountryRegion(c.country_id)) return false;
        if (context.competedCountries.has(c.country_id)) return false;
      }
      return true;
    });
}

function isoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// The website stores registration times in UTC; formatting them in SQL keeps the session's
// time zone out of it.
const UTC_TIMESTAMP = "%Y-%m-%dT%H:%i:%sZ";

/**
 * Every announced, not cancelled competition that has not ended by `today`, with what the
 * filters read. Coordinates are stored as millionths of a degree.
 */
export async function loadUpcomingCompetitions(pool: Pool, today: string): Promise<UpcomingCompetition[]> {
  const upcoming = `SELECT id FROM competitions
                    WHERE announced_at IS NOT NULL AND cancelled_at IS NULL AND end_date >= ?`;
  const [[competitions], [events], [registrations], [championships]] = await Promise.all([
    pool.query<RowDataPacket[]>(
      `SELECT c.id, c.name, c.city_name AS city, c.country_id,
              co.name AS country_name, co.iso2 AS country_iso2, co.continent_id,
              DATE_FORMAT(c.start_date, '%Y-%m-%d') AS start_date,
              DATE_FORMAT(c.end_date, '%Y-%m-%d') AS end_date,
              c.latitude, c.longitude, c.competitor_limit_enabled, c.competitor_limit,
              DATE_FORMAT(c.registration_open, '${UTC_TIMESTAMP}') AS registration_open,
              DATE_FORMAT(c.registration_close, '${UTC_TIMESTAMP}') AS registration_close
       FROM competitions c
       JOIN countries co ON co.id = c.country_id
       WHERE c.announced_at IS NOT NULL AND c.cancelled_at IS NULL AND c.end_date >= ?
       ORDER BY c.start_date, c.name`,
      [today],
    ),
    pool.query<RowDataPacket[]>(
      `SELECT ce.competition_id, ce.event_id
       FROM competition_events ce
       JOIN events e ON e.id = ce.event_id
       WHERE ce.competition_id IN (${upcoming})
       ORDER BY e.\`rank\``,
      [today],
    ),
    pool.query<RowDataPacket[]>(
      `SELECT competition_id, COUNT(*) AS accepted
       FROM registrations
       WHERE competing_status = 'accepted' AND is_competing = 1 AND deleted_at IS NULL
         AND competition_id IN (${upcoming})
       GROUP BY competition_id`,
      [today],
    ),
    // A championship type is "world", a continent ID, a country's ISO code, or a group of
    // countries such as "greater_china".
    pool.query<RowDataPacket[]>(
      `SELECT ch.competition_id, ch.championship_type AS type,
              ct.name AS continent_name, cn.name AS country_name
       FROM championships ch
       LEFT JOIN continents ct ON ct.id = ch.championship_type
       LEFT JOIN countries cn ON cn.iso2 = ch.championship_type
       WHERE ch.competition_id IN (${upcoming})
       ORDER BY ch.id`,
      [today],
    ),
  ]);

  const eventsBy = new Map<string, string[]>();
  for (const row of events) {
    const ids = eventsBy.get(row.competition_id) ?? [];
    ids.push(row.event_id);
    eventsBy.set(row.competition_id, ids);
  }
  const acceptedBy = new Map<string, number>(
    registrations.map((row) => [row.competition_id, Number(row.accepted)]),
  );
  const championshipsBy = new Map<string, Championship[]>();
  for (const row of championships) {
    const list = championshipsBy.get(row.competition_id) ?? [];
    list.push({ type: row.type, name: championshipName(row) });
    championshipsBy.set(row.competition_id, list);
  }

  return competitions.map((row) => ({
    id: row.id,
    name: row.name,
    city: row.city ?? "",
    country_id: row.country_id,
    country_name: row.country_name,
    country_iso2: row.country_iso2 ?? null,
    continent_id: row.continent_id,
    start_date: row.start_date,
    end_date: row.end_date,
    latitude: coordinate(row.latitude),
    longitude: coordinate(row.longitude),
    competitor_limit:
      row.competitor_limit_enabled && row.competitor_limit ? Number(row.competitor_limit) : null,
    accepted_registrations: acceptedBy.get(row.id) ?? 0,
    registration_open: row.registration_open ?? null,
    registration_close: row.registration_close ?? null,
    championships: championshipsBy.get(row.id) ?? [],
    events: eventsBy.get(row.id) ?? [],
  }));
}

function championshipName(row: RowDataPacket): string {
  if (row.type === "world") return "World";
  if (row.continent_name) return row.continent_name;
  if (row.country_name) return row.country_name;
  return String(row.type)
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// A venue nobody placed is stored as 0, 0; that is in the Gulf of Guinea, not a venue.
function coordinate(value: unknown): number | null {
  if (value === null || value === undefined || Number(value) === 0) return null;
  return Number(value) / 1e6;
}

export async function loadUpcomingCompetitionsOptions(pool: Pool): Promise<UpcomingCompetitionsOptions> {
  const [[continents], [countries], [events]] = await Promise.all([
    pool.query<RowDataPacket[]>("SELECT id, name FROM continents ORDER BY name"),
    pool.query<RowDataPacket[]>(
      "SELECT id, name FROM countries WHERE id NOT LIKE 'X%' ORDER BY name",
    ),
    pool.query<RowDataPacket[]>("SELECT id, name FROM events WHERE `rank` < 900 ORDER BY `rank`"),
  ]);
  return {
    regions: [
      { id: WORLD, name: "World", kind: "world" },
      ...continents.map((r) => ({ id: r.id as string, name: r.name as string, kind: "continent" as const })),
      ...countries.map((r) => ({ id: r.id as string, name: r.name as string, kind: "country" as const })),
    ],
    events: events.map((r) => ({ id: r.id, name: r.name })),
  };
}

/** Countries of every competition the competitor has a result from. */
export async function competedCountries(pool: Pool, wcaId: string): Promise<Set<string>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT c.country_id
     FROM results r
     JOIN competitions c ON c.id = r.competition_id
     WHERE r.person_id = ?`,
    [wcaId],
  );
  return new Set(rows.map((row) => row.country_id as string));
}

/**
 * Serves the upcoming competitions. They are a few thousand rows at most, so they are read
 * once per export and day, and every filter is applied in memory.
 */
export function createUpcomingCompetitionsService(pool: Pool) {
  let cached: { key: string; work: Promise<[UpcomingCompetition[], UpcomingCompetitionsOptions]> } | null =
    null;

  const load = async () => {
    const [[metadata]] = await pool.query<RowDataPacket[]>(
      "SELECT value FROM wca_statistics_metadata WHERE field = 'export_timestamp' LIMIT 1",
    );
    const today = isoDate(new Date());
    const key = JSON.stringify([metadata?.value ?? null, today]);
    // Without an export timestamp nothing says when the data changes, so keep nothing.
    if (cached?.key === key && metadata?.value) return cached.work;
    const work = Promise.all([
      loadUpcomingCompetitions(pool, today),
      loadUpcomingCompetitionsOptions(pool),
    ]);
    cached = { key, work };
    work.catch(() => {
      if (cached?.work === work) cached = null;
    });
    return work;
  };

  return {
    async options() {
      return (await load())[1];
    },
    async get(query: Record<string, unknown>, viewerWcaId: string | null) {
      const [competitions, options] = await load();
      const filters = parseUpcomingCompetitionsFilters(query, options);
      if (filters.new_countries && !viewerWcaId) {
        throw new UpcomingCompetitionsInputError(
          "Filtering by countries you have not competed in needs an account with a WCA ID",
        );
      }
      const competed = filters.new_countries ? await competedCountries(pool, viewerWcaId!) : null;
      const regionKind = options.regions.find((r) => r.id === filters.region)!.kind;
      const matches = filterUpcomingCompetitions(competitions, filters, {
        now: new Date(),
        regionKind,
        competedCountries: competed,
      });
      return {
        competitions: matches,
        total: matches.length,
        viewer_wca_id: viewerWcaId,
        competed_countries: competed
          ? [...competed].filter((id) => !isMultiCountryRegion(id)).length
          : null,
      };
    },
  };
}
