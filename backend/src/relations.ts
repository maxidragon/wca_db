import mysql, { Pool, RowDataPacket } from "mysql2/promise";

interface BFSTree {
  degrees: Record<string, number>;
  parent: Record<string, string | null>;
  frontier: string[];
}

async function getLinkingsBatch(
  pool: Pool,
  wcaIds: string[]
): Promise<Record<string, string[]>> {
  if (wcaIds.length === 0) return {};
  const placeholders = wcaIds.map(() => "?").join(",");
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT wca_id, wca_ids FROM linkings WHERE wca_id IN (${placeholders})`,
    wcaIds
  );
  const result: Record<string, string[]> = {};
  for (const row of rows) {
    result[row.wca_id] = row.wca_ids ? row.wca_ids.split(",") : [];
  }
  return result;
}

function reconstructPath(
  wcaId: string,
  parent: Record<string, string | null>
): string[] {
  const path: string[] = [];
  let current: string | null = wcaId;
  while (current !== null) {
    path.push(current);
    current = parent[current] ?? null;
  }
  return path.reverse();
}

const MAX_DEGREE = 8;

export async function getChain(
  pool: Pool,
  wcaId1: string,
  wcaId2: string
): Promise<string[]> {
  if (wcaId1 === wcaId2) return [wcaId1];

  const left: BFSTree = {
    degrees: { [wcaId1]: 0 },
    parent: { [wcaId1]: null },
    frontier: [wcaId1],
  };
  const right: BFSTree = {
    degrees: { [wcaId2]: 0 },
    parent: { [wcaId2]: null },
    frontier: [wcaId2],
  };

  let expandLeft = true;

  while (left.frontier.length > 0 || right.frontier.length > 0) {
    const [cur, other] = expandLeft ? [left, right] : [right, left];

    if (cur.frontier.length === 0) {
      expandLeft = !expandLeft;
      continue;
    }

    // Stop if we've gone too deep
    const curDegree = cur.degrees[cur.frontier[0]];
    if (curDegree >= MAX_DEGREE) return [];

    const linkings = await getLinkingsBatch(pool, cur.frontier);
    const newFrontier: string[] = [];
    let meeting: string | null = null;

    outer: for (const wcaId of cur.frontier) {
      for (const related of linkings[wcaId] || []) {
        if (cur.degrees.hasOwnProperty(related)) continue;
        cur.degrees[related] = cur.degrees[wcaId] + 1;
        cur.parent[related] = wcaId;
        newFrontier.push(related);
        if (other.degrees.hasOwnProperty(related)) {
          meeting = related;
          break outer;
        }
      }
    }

    cur.frontier = newFrontier;

    if (meeting !== null) {
      const leftPath = reconstructPath(meeting, left.parent);
      const rightPath = reconstructPath(meeting, right.parent);
      return [...leftPath.slice(0, -1), ...rightPath.reverse()];
    }

    expandLeft = !expandLeft;
  }

  return [];
}

export async function competitionsTogether(
  pool: Pool,
  wcaId1: string,
  wcaId2: string
): Promise<{ id: string; name: string }[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT r1.competition_id AS id, c.name
     FROM results r1
     JOIN results r2 ON r1.competition_id = r2.competition_id
     JOIN competitions c ON r1.competition_id = c.id
     WHERE r1.person_id = ? AND r2.person_id = ?`,
    [wcaId1, wcaId2]
  );
  return rows as { id: string; name: string }[];
}
