import { Pool, RowDataPacket } from "mysql2/promise";

export interface BestEverRankRow extends RowDataPacket {
  event_id: string;
  event_name: string;
  result_type: "single" | "average";
  region_type: "world" | "continent" | "country";
  region_id: string;
  region_name: string;
  best_rank: number;
  result: number;
  competition_id: string;
  competition_name: string;
  start_date: string;
  end_date: string | null;
}

export async function bestEverRanksReady(pool: Pool): Promise<boolean> {
  try {
    const [[row]] = await pool.query<RowDataPacket[]>(
      "SELECT 1 AS ok FROM best_ever_ranks LIMIT 1"
    );
    return !!row;
  } catch {
    return false;
  }
}

export async function getBestEverRanks(pool: Pool, wcaId: string) {
  const [[person]] = await pool.query<RowDataPacket[]>(
    "SELECT wca_id, name, country_id FROM persons WHERE wca_id = ? AND sub_id = 1",
    [wcaId]
  );
  if (!person) return null;

  const [ranks] = await pool.query<BestEverRankRow[]>(
    `SELECT ber.event_id, e.name AS event_name,
            ber.result_type, ber.region_type, ber.region_id,
            COALESCE(country.name, continent.name, 'World') AS region_name,
            ber.best_rank, ber.result,
            ber.competition_id, c.name AS competition_name,
            DATE_FORMAT(ber.start_date, '%Y-%m-%d') AS start_date,
            DATE_FORMAT(ber.end_date, '%Y-%m-%d') AS end_date
     FROM best_ever_ranks ber
     JOIN events e ON e.id = ber.event_id
     LEFT JOIN competitions c ON c.id = ber.competition_id
     LEFT JOIN countries country
       ON ber.region_type = 'country' AND country.id = ber.region_id
     LEFT JOIN continents continent
       ON ber.region_type = 'continent' AND continent.id = ber.region_id
     WHERE ber.person_id = ?
     ORDER BY e.rank,
              ber.result_type DESC,
              FIELD(ber.region_type, 'world', 'continent', 'country'),
              ber.best_rank`,
    [wcaId]
  );

  return {
    person: { wca_id: person.wca_id, name: person.name },
    ranks,
  };
}
