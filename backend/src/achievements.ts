import { Pool, RowDataPacket } from "mysql2/promise";

const COMPETITION_MILESTONES = [100, 150, 200, 250, 300, 350, 400];
const DELEGATE_MILESTONES = [100, 150, 200, 250, 300, 350, 400];
const ATTEMPT_MILESTONES = [
  1000,
  2137,
  5000,
  10000,
  15000,
  20000,
  21370,
  25000,
];
const TOGETHER_MILESTONES = [100, 150, 200];

interface CompetitionRow extends RowDataPacket {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  country_id: string;
}

interface PersonCountRow extends RowDataPacket {
  wca_id: string;
  name: string;
  competition_count: number;
}

interface AttemptRow extends RowDataPacket {
  wca_id: string;
  successful_before: number;
  successful_at_competition: number;
  historical_successes: number;
  historical_attempts: number;
}

interface AttemptSlotRow extends RowDataPacket {
  wca_id: string;
  competition_id: string;
  start_date: string;
  attempt_slots: number;
}

function isoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function acceptedRegistrationAttendance(today: string, audience: string): string {
  return `
    SELECT u.wca_id AS person_id, reg.competition_id
    FROM registrations reg
    JOIN users u ON u.id = reg.user_id
    JOIN ${audience} audience ON audience.wca_id = u.wca_id
    JOIN competitions future_comp ON future_comp.id = reg.competition_id
    WHERE reg.competing_status = 'accepted'
      AND reg.is_competing = 1
      AND reg.deleted_at IS NULL
      AND u.wca_id IS NOT NULL
      AND future_comp.end_date >= '${today}'
      AND future_comp.cancelled_at IS NULL
  `;
}

function attendanceCte(today: string, audience: string): string {
  return `
    attendance AS (
      SELECT r.person_id, r.competition_id
      FROM results r
      JOIN ${audience} audience ON audience.wca_id = r.person_id
      UNION
      ${acceptedRegistrationAttendance(today, audience)}
    )
  `;
}

function beforeOrAtCondition(alias: string): string {
  return `(${alias}.start_date < ? OR (${alias}.start_date = ? AND ${alias}.id <= ?))`;
}

function strictlyBeforeCondition(alias: string): string {
  return `(${alias}.start_date < ? OR (${alias}.start_date = ? AND ${alias}.id < ?))`;
}

function rosterSql(projected: boolean): string {
  if (!projected) {
    return "SELECT DISTINCT person_id AS wca_id FROM results WHERE competition_id = ?";
  }
  return `
    SELECT DISTINCT u.wca_id
    FROM registrations reg
    JOIN users u ON u.id = reg.user_id
    WHERE reg.competition_id = ?
      AND reg.competing_status = 'accepted'
      AND reg.is_competing = 1
      AND reg.deleted_at IS NULL
      AND u.wca_id IS NOT NULL
  `;
}

export async function searchCompetitions(pool: Pool, query: string) {
  const term = query.trim();
  const like = `%${term}%`;
  const prefix = `${term}%`;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, name,
            DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date,
            DATE_FORMAT(end_date, '%Y-%m-%d') AS end_date,
            country_id
     FROM competitions
     WHERE announced_at IS NOT NULL AND (id LIKE ? OR name LIKE ?)
     ORDER BY
       CASE WHEN id = ? THEN 0 WHEN id LIKE ? THEN 1 WHEN name LIKE ? THEN 2 ELSE 3 END,
       ABS(DATEDIFF(start_date, CURDATE())), start_date DESC
     LIMIT 20`,
    [like, like, term, prefix, prefix]
  );
  return rows;
}

export async function getCompetitionAchievements(
  pool: Pool,
  competitionId: string,
  now = new Date()
) {
  const [[competition]] = await pool.query<CompetitionRow[]>(
    `SELECT id, name,
            DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date,
            DATE_FORMAT(end_date, '%Y-%m-%d') AS end_date,
            country_id
     FROM competitions WHERE id = ? LIMIT 1`,
    [competitionId]
  );
  if (!competition) return null;

  const today = isoDate(now);
  const startDate = competition.start_date;
  const endDate = competition.end_date;
  const projected = endDate >= today;
  const sequenceParams = [startDate, startDate, competition.id];
  const roster = rosterSql(projected);

  const [competitionCountRows] = await pool.query<PersonCountRow[]>(
    `WITH selected_people AS (${roster}),
     ${attendanceCte(today, "selected_people")}
     SELECT selected.wca_id, p.name,
            COUNT(DISTINCT attended_comp.id) AS competition_count
     FROM selected_people selected
     JOIN persons p ON p.wca_id = selected.wca_id AND p.sub_id = 1
     LEFT JOIN attendance attended ON attended.person_id = selected.wca_id
     LEFT JOIN competitions attended_comp
       ON attended_comp.id = attended.competition_id
      AND ${beforeOrAtCondition("attended_comp")}
     GROUP BY selected.wca_id, p.name`,
    [competition.id, ...sequenceParams]
  );

  const competitionMilestones = competitionCountRows
    .filter((row) => COMPETITION_MILESTONES.includes(Number(row.competition_count)))
    .map((row) => ({
      wca_id: row.wca_id,
      name: row.name,
      milestone: Number(row.competition_count),
    }));

  const [delegateRows] = await pool.query<PersonCountRow[]>(
    `WITH selected_delegates AS (
       SELECT DISTINCT u.wca_id
     FROM competition_delegates selected_assignment
     JOIN users u ON u.id = selected_assignment.delegate_id
       JOIN competitions selected_comp ON selected_comp.id = selected_assignment.competition_id
       WHERE selected_assignment.competition_id = ?
         AND selected_comp.cancelled_at IS NULL
         AND u.wca_id IS NOT NULL
     )
     SELECT selected.wca_id, p.name,
            COUNT(DISTINCT assignment.competition_id) AS competition_count
     FROM selected_delegates selected
     JOIN persons p ON p.wca_id = selected.wca_id AND p.sub_id = 1
     JOIN users u ON u.wca_id = selected.wca_id
     JOIN competition_delegates assignment ON assignment.delegate_id = u.id
     JOIN competitions delegated_comp ON delegated_comp.id = assignment.competition_id
     WHERE delegated_comp.cancelled_at IS NULL
       AND ${beforeOrAtCondition("delegated_comp")}
     GROUP BY selected.wca_id, p.name`,
    [competition.id, ...sequenceParams]
  );

  const delegateMilestones = delegateRows
    .filter((row) => DELEGATE_MILESTONES.includes(Number(row.competition_count)))
    .map((row) => ({
      wca_id: row.wca_id,
      name: row.name,
      milestone: Number(row.competition_count),
    }));

  const rosterIds = competitionCountRows.map((row) => row.wca_id);
  const nameById = new Map(competitionCountRows.map((row) => [row.wca_id, row.name]));
  const successfulAttemptMilestones: Array<{
    wca_id: string;
    name: string;
    milestone: number;
    count_before: number;
    count_after: number;
    estimated: boolean;
  }> = [];

  if (rosterIds.length > 0) {
    const placeholders = rosterIds.map(() => "?").join(",");
    const [attemptRows] = await pool.query<AttemptRow[]>(
      `SELECT r.person_id AS wca_id,
              SUM(CASE WHEN ra.value > 0 AND ${strictlyBeforeCondition("attempt_comp")} THEN 1 ELSE 0 END) AS successful_before,
              SUM(CASE WHEN ra.value > 0 AND r.competition_id = ? THEN 1 ELSE 0 END) AS successful_at_competition,
              SUM(CASE WHEN ra.value > 0 AND attempt_comp.end_date < ? THEN 1 ELSE 0 END) AS historical_successes,
              SUM(CASE WHEN ra.value <> 0 AND attempt_comp.end_date < ? THEN 1 ELSE 0 END) AS historical_attempts
       FROM results r
       JOIN result_attempts ra ON ra.result_id = r.id
       JOIN competitions attempt_comp ON attempt_comp.id = r.competition_id
       WHERE r.person_id IN (${placeholders})
       GROUP BY r.person_id`,
      [...sequenceParams, competition.id, today, today, ...rosterIds]
    );
    const attemptsById = new Map(attemptRows.map((row) => [row.wca_id, row]));

    if (!projected) {
      for (const wcaId of rosterIds) {
        const row = attemptsById.get(wcaId);
        const before = Number(row?.successful_before || 0);
        const after = before + Number(row?.successful_at_competition || 0);
        for (const milestone of ATTEMPT_MILESTONES) {
          if (before < milestone && after >= milestone) {
            successfulAttemptMilestones.push({
              wca_id: wcaId,
              name: nameById.get(wcaId) || wcaId,
              milestone,
              count_before: before,
              count_after: after,
              estimated: false,
            });
          }
        }
      }
    } else {
      const [slotRows] = await pool.query<AttemptSlotRow[]>(
        `SELECT u.wca_id, reg.competition_id, future_comp.start_date,
                SUM(format.expected_solve_count) AS attempt_slots
         FROM registrations reg
         JOIN users u ON u.id = reg.user_id
         JOIN competitions future_comp ON future_comp.id = reg.competition_id
         JOIN registration_competition_events registered_event
           ON registered_event.registration_id = reg.id
         JOIN rounds first_round
           ON first_round.competition_event_id = registered_event.competition_event_id
          AND first_round.number = 1
         JOIN formats format ON format.id = first_round.format_id
         WHERE u.wca_id IN (${placeholders})
           AND reg.competing_status = 'accepted'
           AND reg.is_competing = 1
           AND reg.deleted_at IS NULL
           AND future_comp.end_date >= ?
           AND ${beforeOrAtCondition("future_comp")}
         GROUP BY u.wca_id, reg.competition_id, future_comp.start_date
         ORDER BY future_comp.start_date, reg.competition_id`,
        [...rosterIds, today, ...sequenceParams]
      );

      const slotsById = new Map<string, AttemptSlotRow[]>();
      for (const row of slotRows) {
        const rows = slotsById.get(row.wca_id) || [];
        rows.push(row);
        slotsById.set(row.wca_id, rows);
      }

      for (const wcaId of rosterIds) {
        const actual = attemptsById.get(wcaId);
        const historicalSuccesses = Number(actual?.historical_successes || 0);
        const historicalAttempts = Number(actual?.historical_attempts || 0);
        const successRate = historicalAttempts > 0
          ? historicalSuccesses / historicalAttempts
          : 1;
        let running = historicalSuccesses;
        let before = running;
        let after = running;
        for (const slot of slotsById.get(wcaId) || []) {
          const expectedSuccesses = Math.round(Number(slot.attempt_slots) * successRate);
          if (slot.competition_id === competition.id) {
            before = running;
            after = running + expectedSuccesses;
          }
          running += expectedSuccesses;
        }
        for (const milestone of ATTEMPT_MILESTONES) {
          if (before < milestone && after >= milestone) {
            successfulAttemptMilestones.push({
              wca_id: wcaId,
              name: nameById.get(wcaId) || wcaId,
              milestone,
              count_before: before,
              count_after: after,
              estimated: true,
            });
          }
        }
      }
    }
  }

  const togetherMilestones: Array<{
    person1: { wca_id: string; name: string };
    person2: { wca_id: string; name: string };
    milestone: number;
  }> = [];
  const veteranIds = competitionCountRows
    .filter((row) => Number(row.competition_count) >= TOGETHER_MILESTONES[0])
    .map((row) => row.wca_id);

  if (veteranIds.length >= 2) {
    const placeholders = veteranIds.map(() => "?").join(",");
    const [pairRows] = await pool.query<RowDataPacket[]>(
      `WITH veterans AS (
         SELECT wca_id FROM persons WHERE sub_id = 1 AND wca_id IN (${placeholders})
       ),
       ${attendanceCte(today, "veterans")},
       veteran_attendance AS (
         SELECT attended.person_id, attended.competition_id
         FROM attendance attended
         JOIN competitions attended_comp ON attended_comp.id = attended.competition_id
         WHERE ${beforeOrAtCondition("attended_comp")}
       )
       SELECT first_person.person_id AS person1_id,
              second_person.person_id AS person2_id,
              COUNT(DISTINCT first_person.competition_id) AS competition_count
       FROM veteran_attendance first_person
       JOIN veteran_attendance second_person
         ON second_person.competition_id = first_person.competition_id
        AND second_person.person_id > first_person.person_id
       GROUP BY first_person.person_id, second_person.person_id
       HAVING competition_count IN (${TOGETHER_MILESTONES.join(",")})`,
      [...veteranIds, ...sequenceParams]
    );
    for (const row of pairRows) {
      togetherMilestones.push({
        person1: {
          wca_id: row.person1_id,
          name: nameById.get(row.person1_id) || row.person1_id,
        },
        person2: {
          wca_id: row.person2_id,
          name: nameById.get(row.person2_id) || row.person2_id,
        },
        milestone: Number(row.competition_count),
      });
    }
  }

  return {
    competition,
    projected,
    roster_size: competitionCountRows.length,
    competition_milestones: competitionMilestones,
    delegate_milestones: delegateMilestones,
    successful_attempt_milestones: successfulAttemptMilestones,
    together_milestones: togetherMilestones,
    methodology: projected
      ? "Competition projections include all accepted, non-cancelled registrations for each competitor up to this competition, deduplicated by competition ID. Attempt projections use first-round attempt slots adjusted by each competitor's historical successful-attempt rate."
      : "Completed achievements use published results and delegate assignments.",
  };
}
