import { Pool, RowDataPacket } from "mysql2/promise";

export const NEMESIS_REGIONS = ["world", "continent", "country"] as const;
export type NemesisRegion = (typeof NEMESIS_REGIONS)[number];

export const NEMESES_PAGE_SIZE = 100;

// A beginner's nemeses are most of the export, and the statement joins each of them to
// persons; a stalled one must free its connection rather than hold it.
const NEMESES_TIMEOUT_SECONDS = 30;

export interface Nemesis {
  wca_id: string;
  name: string;
  country_id: string | null;
  country_name: string | null;
}

export interface NemesesResult {
  person: {
    wca_id: string;
    name: string;
    country_id: string;
    country_name: string;
    continent_id: string;
    continent_name: string;
  };
  /** How many single and average ranks the competitor holds, each of which a nemesis beats. */
  ranks: number;
  counts: Record<NemesisRegion, number>;
  region: NemesisRegion;
  page: number;
  page_size: number;
  nemeses: Nemesis[];
}

interface PersonRow extends RowDataPacket {
  wca_id: string;
  name: string;
  country_id: string;
  country_name: string;
  continent_id: string;
  continent_name: string;
}

interface RankRow extends RowDataPacket {
  rank_table: "ranks_single" | "ranks_average";
  event_id: string;
  world_rank: number;
}

interface CountsRow extends RowDataPacket {
  world: number;
  continent: string | null;
  country: string | null;
}

/**
 * The statement that selects everyone who holds a strictly better world rank than the
 * competitor in every single and every average they hold a rank in. An equal rank is an
 * equal result, so a tie is not a nemesis, and the competitor never is one of their own.
 *
 * It starts from the competitor's best world rank, which bounds the candidates to at most
 * that many people, and checks each candidate's other ranks by person. A world-class
 * competitor therefore costs a handful of rows; a beginner, whose best rank is in the
 * hundreds of thousands, costs one index range over them.
 */
function nemesesStatement(ranks: RankRow[]): { sql: string; params: unknown[] } {
  const [driver, ...others] = [...ranks].sort((a, b) => a.world_rank - b.world_rank);
  const params: unknown[] = [driver.event_id, driver.world_rank];
  const checks = others.map((rank) => {
    params.push(rank.event_id, rank.world_rank);
    return `AND EXISTS (SELECT 1 FROM ${rank.rank_table} other
                        WHERE other.person_id = candidate.person_id
                          AND other.event_id = ? AND other.world_rank < ?)`;
  });
  return {
    sql: `SELECT candidate.person_id
          FROM ${driver.rank_table} candidate
          WHERE candidate.event_id = ? AND candidate.world_rank < ?
          ${checks.join("\n")}`,
    params,
  };
}

// The ranks export can be a day or two newer than the developer dump, so a nemesis can be
// someone the dump has no person row for yet. They still count, under the world only.
const NEMESES_WITH_PERSONS = `
  FROM nemeses n
  LEFT JOIN persons p ON p.wca_id = n.person_id AND p.sub_id = 1
  LEFT JOIN countries country ON country.id = p.country_id`;

function withTimeout(sql: string): string {
  return `SET STATEMENT max_statement_time=${NEMESES_TIMEOUT_SECONDS} FOR ${sql}`;
}

export async function getNemeses(
  pool: Pool,
  wcaId: string,
  region: NemesisRegion,
  page: number,
): Promise<NemesesResult | null> {
  const [[person]] = await pool.query<PersonRow[]>(
    `SELECT p.wca_id, p.name, p.country_id, country.name AS country_name,
            country.continent_id, continent.name AS continent_name
     FROM persons p
     JOIN countries country ON country.id = p.country_id
     JOIN continents continent ON continent.id = country.continent_id
     WHERE p.wca_id = ? AND p.sub_id = 1`,
    [wcaId],
  );
  if (!person) return null;

  const [ranks] = await pool.query<RankRow[]>(
    `SELECT 'ranks_single' AS rank_table, event_id, world_rank
     FROM ranks_single WHERE person_id = ?
     UNION ALL
     SELECT 'ranks_average', event_id, world_rank
     FROM ranks_average WHERE person_id = ?`,
    [wcaId, wcaId],
  );

  const result: NemesesResult = {
    person: {
      wca_id: person.wca_id,
      name: person.name,
      country_id: person.country_id,
      country_name: person.country_name,
      continent_id: person.continent_id,
      continent_name: person.continent_name,
    },
    ranks: ranks.length,
    counts: { world: 0, continent: 0, country: 0 },
    region,
    page,
    page_size: NEMESES_PAGE_SIZE,
    nemeses: [],
  };
  // Nobody can be better at nothing: a competitor without a rank has no nemeses.
  if (ranks.length === 0) return result;

  const nemeses = nemesesStatement(ranks);
  const regionFilter =
    region === "country"
      ? { sql: "WHERE p.country_id = ?", params: [person.country_id] }
      : region === "continent"
        ? { sql: "WHERE country.continent_id = ?", params: [person.continent_id] }
        : { sql: "", params: [] };

  const [[[counts]], [rows]] = await Promise.all([
    pool.query<CountsRow[]>(
      withTimeout(
        `WITH nemeses AS (${nemeses.sql})
         SELECT COUNT(*) AS world,
                SUM(country.continent_id = ?) AS continent,
                SUM(p.country_id = ?) AS country
         ${NEMESES_WITH_PERSONS}`,
      ),
      [...nemeses.params, person.continent_id, person.country_id],
    ),
    pool.query<(Nemesis & RowDataPacket)[]>(
      withTimeout(
        `WITH nemeses AS (${nemeses.sql})
         SELECT n.person_id AS wca_id, COALESCE(p.name, n.person_id) AS name,
                p.country_id, country.name AS country_name
         ${NEMESES_WITH_PERSONS}
         ${regionFilter.sql}
         ORDER BY p.name IS NULL, name, n.person_id
         LIMIT ? OFFSET ?`,
      ),
      [
        ...nemeses.params,
        ...regionFilter.params,
        NEMESES_PAGE_SIZE,
        (page - 1) * NEMESES_PAGE_SIZE,
      ],
    ),
  ]);

  result.counts = {
    world: Number(counts.world),
    continent: Number(counts.continent ?? 0),
    country: Number(counts.country ?? 0),
  };
  result.nemeses = rows.map((row) => ({
    wca_id: row.wca_id,
    name: row.name,
    country_id: row.country_id,
    country_name: row.country_name,
  }));
  return result;
}
