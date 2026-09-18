import { Pool, RowDataPacket } from "mysql2/promise";

/** How many entries the "most" lists carry: people competed with, venues and cities. */
const TOP_LIST_SIZE = 10;

export interface PersonalBestResult {
  result: number;
  world_rank: number;
  continent_rank: number;
  country_rank: number;
}

export interface PersonalBest {
  event_id: string;
  event_name: string;
  single: PersonalBestResult | null;
  average: PersonalBestResult | null;
}

export interface PersonCompetition {
  id: string;
  name: string;
  start_date: string;
  city_name: string;
  venue: string;
  country_id: string;
  country_name: string;
  events: number;
  solves: number;
  attempts: number;
}

export interface PersonProfile {
  person: {
    wca_id: string;
    name: string;
    country_id: string;
    country_name: string;
    continent_name: string;
  };
  totals: {
    competitions: number;
    countries: number;
    events: number;
    solves: number;
    attempts: number;
    first_competition_date: string | null;
    last_competition_date: string | null;
    gold: number;
    silver: number;
    bronze: number;
    world_records: number;
    continental_records: number;
    national_records: number;
  };
  personal_bests: PersonalBest[];
  competitions: PersonCompetition[];
  competitors: { wca_id: string; name: string; competitions: number }[];
  venues: {
    venue: string;
    city_name: string;
    country_name: string;
    competitions: number;
  }[];
  cities: { city_name: string; country_name: string; competitions: number }[];
  countries: { country_id: string; country_name: string; competitions: number }[];
  years: { year: number; competitions: number }[];
}

interface PersonRow extends RowDataPacket {
  wca_id: string;
  name: string;
  country_id: string;
  country_name: string;
  continent_name: string;
}

interface PersonalBestRow extends RowDataPacket {
  event_id: string;
  event_name: string;
  single: number | null;
  single_world_rank: number | null;
  single_continent_rank: number | null;
  single_country_rank: number | null;
  average: number | null;
  average_world_rank: number | null;
  average_continent_rank: number | null;
  average_country_rank: number | null;
}

interface CompetitionRow extends RowDataPacket {
  id: string;
  name: string;
  start_date: string;
  city_name: string;
  venue: string;
  country_id: string;
  country_name: string;
  events: number;
  solves: string;
  attempts: string;
}

interface EntryTotalsRow extends RowDataPacket {
  events: number;
  solves: string | null;
  attempts: string | null;
}

interface ResultTotalsRow extends RowDataPacket {
  gold: string;
  silver: string;
  bronze: string;
  world_records: string;
  continental_records: string;
  national_records: string;
}

interface CompetitorRow extends RowDataPacket {
  wca_id: string;
  name: string;
  competitions: number;
}

/** A venue is stored as free text carrying markdown links; the link labels are its name. */
const MARKDOWN_LINK = /\[([^\]]*)\]\s*\([^)]*\)/g;

function venueName(venue: string): string {
  return venue.replace(MARKDOWN_LINK, "$1").trim();
}

/**
 * Groups the competitor's own competitions, which the profile already carries in full, and
 * orders the groups by size. Ties keep the order of the list, so the most recent wins.
 */
function groupCompetitions<T>(
  competitions: PersonCompetition[],
  keyOf: (competition: PersonCompetition) => string,
  valueOf: (competition: PersonCompetition, count: number) => T,
): T[] {
  const groups = new Map<string, { first: PersonCompetition; count: number }>();
  for (const competition of competitions) {
    const group = groups.get(keyOf(competition));
    if (group) group.count++;
    else groups.set(keyOf(competition), { first: competition, count: 1 });
  }
  return [...groups.values()]
    .sort((a, b) => b.count - a.count)
    .map(({ first, count }) => valueOf(first, count));
}

function rankedResult(
  result: number | null,
  worldRank: number | null,
  continentRank: number | null,
  countryRank: number | null,
): PersonalBestResult | null {
  if (result == null) return null;
  return {
    result,
    world_rank: Number(worldRank),
    continent_rank: Number(continentRank),
    country_rank: Number(countryRank),
  };
}

async function getPersonalBests(pool: Pool, wcaId: string): Promise<PersonalBest[]> {
  const [rows] = await pool.query<PersonalBestRow[]>(
    `SELECT e.id AS event_id, e.name AS event_name,
            s.best AS single, s.world_rank AS single_world_rank,
            s.continent_rank AS single_continent_rank, s.country_rank AS single_country_rank,
            a.best AS average, a.world_rank AS average_world_rank,
            a.continent_rank AS average_continent_rank, a.country_rank AS average_country_rank
     FROM events e
     LEFT JOIN ranks_single s ON s.event_id = e.id AND s.person_id = ?
     LEFT JOIN ranks_average a ON a.event_id = e.id AND a.person_id = ?
     WHERE s.person_id IS NOT NULL OR a.person_id IS NOT NULL
     ORDER BY e.rank`,
    [wcaId, wcaId],
  );
  return rows.map((row) => ({
    event_id: row.event_id,
    event_name: row.event_name,
    single: rankedResult(
      row.single,
      row.single_world_rank,
      row.single_continent_rank,
      row.single_country_rank,
    ),
    average: rankedResult(
      row.average,
      row.average_world_rank,
      row.average_continent_rank,
      row.average_country_rank,
    ),
  }));
}

async function getCompetitions(pool: Pool, wcaId: string): Promise<PersonCompetition[]> {
  const [rows] = await pool.query<CompetitionRow[]>(
    `SELECT c.id, c.name, DATE_FORMAT(c.start_date, '%Y-%m-%d') AS start_date,
            c.city_name, c.venue, c.country_id, co.name AS country_name,
            COUNT(DISTINCT e.event_id) AS events,
            SUM(e.solves) AS solves, SUM(e.attempts) AS attempts
     FROM statistics_entries e
     JOIN competitions c ON c.id = e.competition_id
     JOIN countries co ON co.id = c.country_id
     WHERE e.person_id = ?
     GROUP BY c.id
     ORDER BY c.start_date DESC, c.id`,
    [wcaId],
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    start_date: row.start_date,
    city_name: row.city_name,
    venue: venueName(row.venue),
    country_id: row.country_id,
    country_name: row.country_name,
    events: Number(row.events),
    solves: Number(row.solves),
    attempts: Number(row.attempts),
  }));
}

/**
 * Everyone who attended one of this competitor's competitions, by how many they shared. The
 * entry table is read competition-first here, which its primary key orders, so each shared
 * competition costs the rows of that competition alone.
 */
async function getCompetitors(
  pool: Pool,
  wcaId: string,
): Promise<PersonProfile["competitors"]> {
  const [rows] = await pool.query<CompetitorRow[]>(
    `WITH mine AS (
       SELECT DISTINCT competition_id FROM statistics_entries WHERE person_id = ?
     ),
     together AS (
       SELECT o.person_id, COUNT(DISTINCT o.competition_id) AS competitions
       FROM mine
       JOIN statistics_entries o ON o.competition_id = mine.competition_id
       WHERE o.person_id <> ?
       GROUP BY o.person_id
       ORDER BY competitions DESC
       LIMIT ${TOP_LIST_SIZE}
     )
     SELECT t.person_id AS wca_id, p.name, t.competitions
     FROM together t
     JOIN persons p ON p.wca_id = t.person_id AND p.sub_id = 1
     ORDER BY t.competitions DESC, p.name`,
    [wcaId, wcaId],
  );
  return rows.map((row) => ({ ...row, competitions: Number(row.competitions) }));
}

export async function getPersonProfile(
  pool: Pool,
  wcaId: string,
): Promise<PersonProfile | null> {
  const [[person]] = await pool.query<PersonRow[]>(
    `SELECT p.wca_id, p.name, p.country_id, co.name AS country_name,
            ci.name AS continent_name
     FROM persons p
     JOIN countries co ON co.id = p.country_id
     JOIN continents ci ON ci.id = co.continent_id
     WHERE p.wca_id = ? AND p.sub_id = 1`,
    [wcaId],
  );
  if (!person) return null;

  const [personalBests, competitions, competitors, [[entryTotals]], [[resultTotals]]] =
    await Promise.all([
      getPersonalBests(pool, wcaId),
      getCompetitions(pool, wcaId),
      getCompetitors(pool, wcaId),
      pool.query<EntryTotalsRow[]>(
        `SELECT COUNT(DISTINCT event_id) AS events,
                SUM(solves) AS solves, SUM(attempts) AS attempts
         FROM statistics_entries WHERE person_id = ?`,
        [wcaId],
      ),
      // A record marker is 'WR', 'NR' or one of the six continental ones, and a result can
      // carry one for its single and one for its average, so the two columns are summed.
      pool.query<ResultTotalsRow[]>(
        `SELECT SUM(r.round_type_id IN ('c','f') AND r.best > 0 AND r.pos = 1) AS gold,
                SUM(r.round_type_id IN ('c','f') AND r.best > 0 AND r.pos = 2) AS silver,
                SUM(r.round_type_id IN ('c','f') AND r.best > 0 AND r.pos = 3) AS bronze,
                SUM(COALESCE(r.regional_single_record,'') = 'WR')
                  + SUM(COALESCE(r.regional_average_record,'') = 'WR') AS world_records,
                SUM(COALESCE(r.regional_single_record,'') NOT IN ('','WR','NR'))
                  + SUM(COALESCE(r.regional_average_record,'') NOT IN ('','WR','NR'))
                  AS continental_records,
                SUM(COALESCE(r.regional_single_record,'') = 'NR')
                  + SUM(COALESCE(r.regional_average_record,'') = 'NR') AS national_records
         FROM results r WHERE r.person_id = ?`,
        [wcaId],
      ),
    ]);

  const countries = groupCompetitions(
    competitions,
    (competition) => competition.country_id,
    (competition, count) => ({
      country_id: competition.country_id,
      country_name: competition.country_name,
      competitions: count,
    }),
  );

  return {
    person: {
      wca_id: person.wca_id,
      name: person.name,
      country_id: person.country_id,
      country_name: person.country_name,
      continent_name: person.continent_name,
    },
    totals: {
      competitions: competitions.length,
      countries: countries.length,
      events: Number(entryTotals.events),
      solves: Number(entryTotals.solves ?? 0),
      attempts: Number(entryTotals.attempts ?? 0),
      first_competition_date:
        competitions[competitions.length - 1]?.start_date ?? null,
      last_competition_date: competitions[0]?.start_date ?? null,
      gold: Number(resultTotals.gold ?? 0),
      silver: Number(resultTotals.silver ?? 0),
      bronze: Number(resultTotals.bronze ?? 0),
      world_records: Number(resultTotals.world_records ?? 0),
      continental_records: Number(resultTotals.continental_records ?? 0),
      national_records: Number(resultTotals.national_records ?? 0),
    },
    personal_bests: personalBests,
    competitions,
    competitors,
    venues: groupCompetitions(
      competitions,
      (competition) =>
        `${competition.venue}\u0000${competition.city_name}\u0000${competition.country_id}`,
      (competition, count) => ({
        venue: competition.venue,
        city_name: competition.city_name,
        country_name: competition.country_name,
        competitions: count,
      }),
    ).slice(0, TOP_LIST_SIZE),
    cities: groupCompetitions(
      competitions,
      (competition) => `${competition.city_name}\u0000${competition.country_id}`,
      (competition, count) => ({
        city_name: competition.city_name,
        country_name: competition.country_name,
        competitions: count,
      }),
    ).slice(0, TOP_LIST_SIZE),
    countries,
    years: groupCompetitions(
      competitions,
      (competition) => competition.start_date.slice(0, 4),
      (competition, count) => ({
        year: Number(competition.start_date.slice(0, 4)),
        competitions: count,
      }),
    ).sort((a, b) => b.year - a.year),
  };
}
