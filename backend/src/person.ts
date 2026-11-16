import { Pool, RowDataPacket } from "mysql2/promise";
import { STAFF_ASSIGNMENTS } from "./relations";

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
  total_events: number;
  rounds: number;
  total_rounds: number;
  competitors: number;
  solves: number;
  attempts: number;
  personal_records: number;
  /** Which of the person's competitions this was, counting from the first. */
  number: number;
}

export interface StaffedCompetition {
  id: string;
  name: string;
  start_date: string;
  city_name: string;
  country_id: string;
  country_name: string;
  /** Which of the person's delegated or organized competitions this was, from the first. */
  number: number;
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
    longest_personal_record_streak: number;
  };
  personal_bests: PersonalBest[];
  competitions: PersonCompetition[];
  delegated: StaffedCompetition[];
  organized: StaffedCompetition[];
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
  total_events: number;
  rounds: number;
  total_rounds: number;
  competitors: number;
  solves: string;
  attempts: string;
}

interface PersonResultRow extends RowDataPacket {
  competition_id: string;
  event_id: string;
  best: number;
  average: number;
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

/**
 * Counts the personal records each competition brought, oldest first. A competition sets a
 * record for an event's single or average when its best beats every earlier competition's,
 * the first result counting as a record of its own. Each event and kind counts once per
 * competition, however many rounds improved on it.
 */
function countPersonalRecords(
  competitionIds: string[],
  results: PersonResultRow[],
): Map<string, number> {
  const resultsByCompetition = new Map<string, PersonResultRow[]>();
  for (const result of results) {
    const group = resultsByCompetition.get(result.competition_id);
    if (group) group.push(result);
    else resultsByCompetition.set(result.competition_id, [result]);
  }

  const bestSoFar = new Map<string, number>();
  const records = new Map<string, number>();
  for (const competitionId of competitionIds) {
    const bestHere = new Map<string, number>();
    for (const result of resultsByCompetition.get(competitionId) ?? []) {
      for (const [kind, value] of [
        ["single", result.best],
        ["average", result.average],
      ] as const) {
        if (value <= 0) continue;
        const key = `${result.event_id}\u0000${kind}`;
        bestHere.set(key, Math.min(value, bestHere.get(key) ?? Infinity));
      }
    }
    let count = 0;
    for (const [key, value] of bestHere) {
      if (value < (bestSoFar.get(key) ?? Infinity)) {
        bestSoFar.set(key, value);
        count++;
      }
    }
    records.set(competitionId, count);
  }
  return records;
}

/** The most competitions in a row, oldest first, that each set a personal record. */
function longestPersonalRecordStreak(competitions: PersonCompetition[]): number {
  let longest = 0;
  let current = 0;
  for (const competition of [...competitions].reverse()) {
    current = competition.personal_records > 0 ? current + 1 : 0;
    longest = Math.max(longest, current);
  }
  return longest;
}

async function getCompetitions(pool: Pool, wcaId: string): Promise<PersonCompetition[]> {
  // Aggregate the person's solves before joining all results at their competitions.
  // A round is an event/round-type pair, counted once regardless of entrant count.
  const [[rows], [results]] = await Promise.all([
    pool.query<CompetitionRow[]>(
      `WITH mine AS (
       SELECT competition_id, COUNT(DISTINCT event_id) AS events,
              SUM(solves) AS solves, SUM(attempts) AS attempts
       FROM statistics_entries
       WHERE person_id = ?
       GROUP BY competition_id
     )
     SELECT c.id, c.name, DATE_FORMAT(c.start_date, '%Y-%m-%d') AS start_date,
            c.city_name, c.venue, c.country_id, co.name AS country_name,
            e.events, e.solves, e.attempts,
            COUNT(DISTINCT r.event_id) AS total_events,
            COUNT(DISTINCT CASE WHEN r.person_id = ? THEN r.event_id END,
                           r.round_type_id) AS rounds,
            COUNT(DISTINCT r.event_id, r.round_type_id) AS total_rounds,
            COUNT(DISTINCT r.person_id) AS competitors
     FROM mine e
     JOIN competitions c ON c.id = e.competition_id
     JOIN countries co ON co.id = c.country_id
     JOIN results r ON r.competition_id = c.id
     GROUP BY c.id
     ORDER BY c.start_date DESC, c.id DESC`,
      [wcaId, wcaId],
    ),
    pool.query<PersonResultRow[]>(
      `SELECT competition_id, event_id, best, average FROM results WHERE person_id = ?`,
      [wcaId],
    ),
  ]);
  // The list runs newest first, so it is walked backwards to see each record in turn.
  const personalRecords = countPersonalRecords(
    rows.map((row) => row.id).reverse(),
    results,
  );
  // Numbered oldest first, and by ID within a day, as the Achievements milestones count them.
  return rows.map((row, index) => ({
    id: row.id,
    name: row.name,
    start_date: row.start_date,
    city_name: row.city_name,
    venue: venueName(row.venue),
    country_id: row.country_id,
    country_name: row.country_name,
    events: Number(row.events),
    total_events: Number(row.total_events),
    rounds: Number(row.rounds),
    total_rounds: Number(row.total_rounds),
    competitors: Number(row.competitors),
    solves: Number(row.solves),
    attempts: Number(row.attempts),
    personal_records: personalRecords.get(row.id) ?? 0,
    number: rows.length - index,
  }));
}

/**
 * Every competition this person delegated or organized, newest first. Assignments come from
 * the WCA account linked to the WCA ID, not from results, so they exist long before the
 * competition is held: cancelled ones and those yet to start do not count.
 */
async function getStaffedCompetitions(
  pool: Pool,
  role: keyof typeof STAFF_ASSIGNMENTS,
  wcaId: string,
): Promise<StaffedCompetition[]> {
  const { table, userColumn } = STAFF_ASSIGNMENTS[role];
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT c.id, c.name, DATE_FORMAT(c.start_date, '%Y-%m-%d') AS start_date,
            c.city_name, c.country_id, co.name AS country_name
     FROM users u
     JOIN ${table} a ON a.${userColumn} = u.id
     JOIN competitions c ON c.id = a.competition_id
     JOIN countries co ON co.id = c.country_id
     WHERE u.wca_id = ? AND c.cancelled_at IS NULL AND c.start_date <= CURDATE()
     ORDER BY start_date DESC, c.id DESC`,
    [wcaId],
  );
  return rows.map((row, index) => ({
    ...(row as Omit<StaffedCompetition, "number">),
    number: rows.length - index,
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

  const [
    personalBests,
    competitions,
    delegated,
    organized,
    competitors,
    [[entryTotals]],
    [[resultTotals]],
  ] = await Promise.all([
    getPersonalBests(pool, wcaId),
    getCompetitions(pool, wcaId),
    getStaffedCompetitions(pool, "delegated", wcaId),
    getStaffedCompetitions(pool, "organized", wcaId),
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
      longest_personal_record_streak: longestPersonalRecordStreak(competitions),
    },
    personal_bests: personalBests,
    competitions,
    delegated,
    organized,
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

/**
 * The order rounds run in within one event at one competition. Cutoff rounds ('d', 'e',
 * 'g', 'c', 'h') sit beside their plain counterparts; the B final runs before the final.
 */
const ROUND_ORDER: Record<string, number> = {
  "0": 0,
  h: 0,
  "1": 1,
  d: 1,
  "2": 2,
  e: 2,
  "3": 3,
  g: 3,
  b: 4,
  c: 5,
  f: 5,
};

export interface PersonResult {
  competition_id: string;
  competition_name: string;
  start_date: string;
  country_name: string;
  event_id: string;
  event_name: string;
  /** The event's place in the official order. */
  event_rank: number;
  round_type_id: string;
  /** The round's place in its event's sequence at the competition, first round lowest. */
  round_order: number;
  pos: number;
  best: number;
  average: number;
  attempts: number[];
  single_record: string;
  average_record: string;
  /** Whether the single or average beat every earlier one; the first valid one counts. */
  single_pr: boolean;
  average_pr: boolean;
}

interface PersonResultDetailRow extends RowDataPacket {
  id: number;
  competition_id: string;
  competition_name: string;
  start_date: string;
  country_name: string;
  event_id: string;
  event_name: string;
  event_rank: number;
  round_type_id: string;
  pos: number;
  best: number;
  average: number;
  single_record: string | null;
  average_record: string | null;
}

interface AttemptRow extends RowDataPacket {
  result_id: number;
  value: number;
}

/**
 * Every result of the competitor, newest competition first, then by event and with the
 * final before the rounds leading to it. Personal records are marked walking the results
 * oldest first, so a round improving on an earlier round of the same competition is one.
 * Returns null for an unknown WCA ID.
 */
export async function getPersonResults(
  pool: Pool,
  wcaId: string,
): Promise<PersonResult[] | null> {
  const [[[person]], [rows], [attempts]] = await Promise.all([
    pool.query<RowDataPacket[]>(
      "SELECT 1 FROM persons WHERE wca_id = ? AND sub_id = 1",
      [wcaId],
    ),
    pool.query<PersonResultDetailRow[]>(
      `SELECT r.id, r.competition_id, c.name AS competition_name,
              DATE_FORMAT(c.start_date, '%Y-%m-%d') AS start_date,
              co.name AS country_name, r.event_id, e.name AS event_name,
              e.rank AS event_rank, r.round_type_id, r.pos, r.best, r.average,
              r.regional_single_record AS single_record,
              r.regional_average_record AS average_record
       FROM results r
       JOIN competitions c ON c.id = r.competition_id
       JOIN countries co ON co.id = c.country_id
       JOIN events e ON e.id = r.event_id
       WHERE r.person_id = ?`,
      [wcaId],
    ),
    pool.query<AttemptRow[]>(
      `SELECT a.result_id, a.value
       FROM results r
       JOIN result_attempts a ON a.result_id = r.id
       WHERE r.person_id = ?
       ORDER BY a.result_id, a.attempt_number`,
      [wcaId],
    ),
  ]);
  if (!person) return null;

  const attemptsByResult = new Map<number, number[]>();
  for (const { result_id, value } of attempts) {
    const values = attemptsByResult.get(result_id);
    if (values) values.push(value);
    else attemptsByResult.set(result_id, [value]);
  }

  // Oldest first: by date, by ID within a day as the competitions are numbered, then the
  // rounds of each event in the order they ran.
  const roundOrder = (row: PersonResultDetailRow) => ROUND_ORDER[row.round_type_id] ?? 0;
  const chronological = [...rows].sort(
    (a, b) =>
      a.start_date.localeCompare(b.start_date) ||
      a.competition_id.localeCompare(b.competition_id) ||
      a.event_rank - b.event_rank ||
      roundOrder(a) - roundOrder(b),
  );

  const bestSoFar = new Map<string, number>();
  const isRecord = (key: string, value: number) => {
    if (value <= 0 || value >= (bestSoFar.get(key) ?? Infinity)) return false;
    bestSoFar.set(key, value);
    return true;
  };
  const results = chronological.map(
    (row): PersonResult => ({
      competition_id: row.competition_id,
      competition_name: row.competition_name,
      start_date: row.start_date,
      country_name: row.country_name,
      event_id: row.event_id,
      event_name: row.event_name,
      event_rank: Number(row.event_rank),
      round_type_id: row.round_type_id,
      round_order: roundOrder(row),
      pos: Number(row.pos),
      best: Number(row.best),
      average: Number(row.average),
      attempts: attemptsByResult.get(row.id) ?? [],
      single_record: row.single_record ?? "",
      average_record: row.average_record ?? "",
      single_pr: isRecord(`${row.event_id}\u0000single`, Number(row.best)),
      average_pr: isRecord(`${row.event_id}\u0000average`, Number(row.average)),
    }),
  );

  // Newest competition first; within it the events keep their order, final first.
  const competitionIndex = new Map<string, number>();
  for (const result of results)
    if (!competitionIndex.has(result.competition_id))
      competitionIndex.set(result.competition_id, competitionIndex.size);
  return results.sort(
    (a, b) =>
      competitionIndex.get(b.competition_id)! - competitionIndex.get(a.competition_id)! ||
      a.event_rank - b.event_rank ||
      b.round_order - a.round_order,
  );
}
