import { Pool, RowDataPacket } from "mysql2/promise";
import { STATISTICS } from "./statistics_catalog";

export class StatisticsInputError extends Error {}
function statementTimeout() {
  return Math.max(
    1,
    Math.min(300, Number(process.env.QUERY_TIMEOUT_SECONDS) || 60),
  );
}
export interface StatisticsOptions {
  statistics: typeof STATISTICS;
  regions: { id: string; name: string; kind: string }[];
  events: { id: string; name: string; has_average: boolean }[];
  years: number[];
  export_timestamp: string | null;
}
export interface Column {
  key: string;
  label: string;
  format?: "person" | "competition" | "result" | "date" | "podium" | "attempts";
}
export interface StatisticsFilters {
  statistic: string;
  region: string;
  gender: string;
  year: number | null;
  events: string[];
  type: "single" | "average";
  pos: number;
  include_dnf: boolean;
  page: number;
  page_size: number;
}

export async function getStatisticsOptions(
  pool: Pool,
): Promise<StatisticsOptions> {
  const queries = [
    "SELECT id, name FROM countries ORDER BY name",
    "SELECT id, name FROM continents ORDER BY name",
    "SELECT e.id, e.name, EXISTS(SELECT 1 FROM ranks_average ra WHERE ra.event_id=e.id LIMIT 1) AS has_average FROM events e WHERE e.`rank` < 900 ORDER BY e.`rank`",
    "SELECT DISTINCT YEAR(c.start_date) AS year FROM competitions c WHERE EXISTS(SELECT 1 FROM results r WHERE r.competition_id=c.id) ORDER BY year DESC",
    "SELECT value FROM wca_statistics_metadata WHERE field='export_timestamp' LIMIT 1",
  ];
  const results = await Promise.all(
    queries.map((sql) =>
      pool.query<RowDataPacket[]>(
        `SET STATEMENT max_statement_time=${statementTimeout()} FOR ${sql}`,
      ),
    ),
  );
  return {
    statistics: STATISTICS,
    regions: [
      { id: "World", name: "World", kind: "world" },
      ...results[1][0].map((r) => ({
        id: r.id,
        name: r.name,
        kind: "continent",
      })),
      ...results[0][0].map((r) => ({
        id: r.id,
        name: r.name,
        kind: "country",
      })),
    ],
    events: results[2][0].map((r) => ({
      id: r.id,
      name: r.name,
      has_average: Boolean(r.has_average),
    })),
    years: results[3][0].map((r) => Number(r.year)),
    export_timestamp: results[4][0][0]?.value ?? null,
  };
}

export function parseStatisticsFilters(
  query: Record<string, unknown>,
  options: StatisticsOptions,
): StatisticsFilters {
  const scalar = (key: string, fallback: string) => {
    const value = query[key];
    if (value === undefined) return fallback;
    if (typeof value !== "string")
      throw new StatisticsInputError(`Invalid ${key}`);
    return value;
  };
  const integer = (key: string, fallback: number, min: number, max: number) => {
    const value = scalar(key, String(fallback));
    if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max)
      throw new StatisticsInputError(`Invalid ${key}`);
    return Number(value);
  };
  const statistic = scalar("statistic", "most-competitions");
  const definition = STATISTICS.find((s) => s.id === statistic);
  if (!definition) throw new StatisticsInputError("Unknown statistic");
  const allowed: string[] = [
    "statistic",
    "page",
    "page_size",
    ...definition.filters,
  ];
  for (const key of Object.keys(query))
    if (!allowed.includes(key))
      throw new StatisticsInputError(
        `Filter ${key} is not supported for this statistic`,
      );
  const region = scalar("region", "World");
  if (!options.regions.some((r) => r.id === region))
    throw new StatisticsInputError("Unknown region");
  const gender = scalar("gender", "all");
  if (!["all", "m", "f", "o"].includes(gender))
    throw new StatisticsInputError("Invalid gender");
  const yearValue = scalar("year", "all");
  const year = yearValue === "all" ? null : Number(yearValue);
  if (
    year !== null &&
    (!/^\d{4}$/.test(yearValue) || !options.years.includes(year))
  )
    throw new StatisticsInputError("Unknown year");
  const type = scalar("type", "single");
  if (type !== "single" && type !== "average")
    throw new StatisticsInputError("Invalid result type");
  const eventValue = scalar("event", "333");
  const eventsValue = scalar("events", "");
  const supportedFilters: string[] = definition.filters;
  const requestedEvents = supportedFilters.includes("event")
    ? [eventValue]
    : [...new Set(eventsValue.split(",").filter(Boolean))];
  if (requestedEvents.some((id) => !options.events.some((e) => e.id === id)))
    throw new StatisticsInputError("Unknown event");
  const events = options.events
    .filter((event) => requestedEvents.includes(event.id))
    .map((event) => event.id);
  if (
    supportedFilters.includes("type") &&
    type === "average" &&
    events.some((id) => !options.events.find((e) => e.id === id)?.has_average)
  )
    throw new StatisticsInputError("Selected event has no average rankings");
  const pos = integer("pos", 2, 2, 4);
  if (![2, 4].includes(pos))
    throw new StatisticsInputError("Position must be 2 or 4");
  const includeDnf = scalar("include_dnf", "0");
  if (!["0", "1"].includes(includeDnf))
    throw new StatisticsInputError("Invalid include_dnf");
  return {
    statistic,
    region,
    gender,
    year,
    events,
    type,
    pos,
    include_dnf: includeDnf === "1",
    page: integer("page", 1, 1, 1000000),
    page_size: integer("page_size", 50, 1, 100),
  };
}

const personColumn: Column = {
  key: "person_name",
  label: "Person",
  format: "person",
};
const competitionColumn: Column = {
  key: "competition_name",
  label: "Competition",
  format: "competition",
};
const countryColumn: Column = { key: "country_name", label: "Region" };
const resultColumn: Column = {
  key: "value",
  label: "Result",
  format: "result",
};
const countColumn: Column = { key: "count", label: "Count" };
const finalCondition = "r.round_type_id IN ('c','f') AND r.best>0";
const currentJoins =
  "JOIN persons p ON p.wca_id=r.person_id AND p.sub_id=1 JOIN countries pc ON pc.id=p.country_id";
const personSelect =
  "r.person_id, MAX(p.name) AS person_name, MAX(pc.name) AS country_name";
const competitionSelect =
  "r.competition_id, MAX(c.name) AS competition_name, MAX(c.start_date) AS date";
const preferredType = (event: string): "single" | "average" =>
  ["333bf", "444bf", "555bf", "333mbf"].includes(event) ? "single" : "average";

export function buildStatisticsQuery(
  f: StatisticsFilters,
  options: StatisticsOptions,
) {
  const params: (string | number)[] = [];
  // Keep unused country joins out of the plan: MariaDB can otherwise start with
  // every historical country and scan all results before filtering current nationality.
  const historicalRegion = [
    "most-competitions",
    "most-pos",
    "top-100",
    "top-100-appearances",
    "records-person",
    "uncrowned-kings",
    "podium-missers",
    "record-missers",
  ].includes(f.statistic);
  const competitionRegion = [
    "most-persons",
    "best-podiums",
    "records-competition",
    "most-solves-competition",
  ].includes(f.statistic);
  const needsHistoricalCountry =
    historicalRegion &&
    (f.region !== "World" || f.statistic.startsWith("top-100"));
  const resultJoins = `${currentJoins} JOIN competitions c ON c.id=r.competition_id${needsHistoricalCountry ? " JOIN countries rc ON rc.id=r.country_id" : ""}${competitionRegion && f.region !== "World" ? " JOIN countries cc ON cc.id=c.country_id" : ""}`;
  const regionInfo = options.regions.find((r) => r.id === f.region)!;
  const regionCondition = (countryAlias: string) => {
    if (regionInfo.kind === "world") return "1=1";
    params.push(f.region);
    return `${countryAlias}.${regionInfo.kind === "continent" ? "continent_id" : "id"}=?`;
  };
  const conditions = (
    regionAlias = "pc",
    extras: string[] = [],
    useYear = true,
    useEvents = true,
  ) => {
    const parts = [regionCondition(regionAlias), ...extras];
    if (f.gender !== "all") {
      parts.push("p.gender=?");
      params.push(f.gender);
    }
    if (useYear && f.year !== null) {
      parts.push("c.start_date>=? AND c.start_date<?");
      params.push(`${f.year}-01-01`, `${f.year + 1}-01-01`);
    }
    if (useEvents && f.events.length) {
      parts.push(`r.event_id IN (${f.events.map(() => "?").join(",")})`);
      params.push(...f.events);
    }
    return parts.join(" AND ");
  };
  let sql = "";
  let order = "count DESC";
  let columns: Column[] = [personColumn, countryColumn, countColumn];
  let resultType = f.type;
  const eventIds = f.events.length
    ? f.events
    : options.events
        .filter((e) => f.type === "single" || e.has_average)
        .map((e) => e.id);
  const rankField =
    regionInfo.kind === "world"
      ? "world_rank"
      : regionInfo.kind === "continent"
        ? "continent_rank"
        : "country_rank";

  switch (f.statistic) {
    case "sum-of-ranks":
    case "sum-of-country-ranks": {
      const country = f.statistic === "sum-of-country-ranks";
      const field = country ? "world_rank" : rankField;
      const regional = country ? "1=1" : regionCondition("pc");
      const ids = eventIds.map(() => "?").join(",");
      params.push(...eventIds);
      const genderCondition = f.gender === "all" ? "1=1" : "p.gender=?";
      if (f.gender !== "all") params.push(f.gender);
      const perEvent = eventIds.map(
        (id) =>
          `MAX(CASE WHEN event_id='${id}' THEN event_rank END) AS \`${id}\``,
      );
      const penaltyColumns = eventIds.map(
        (id) =>
          `MAX(CASE WHEN event_id='${id}' THEN penalty END) AS penalty_${id}`,
      );
      const regionalJoins =
        !country && regionInfo.kind !== "world" ? currentJoins : "";
      // Aggregate numeric ranks before attaching names. Materialize the penalty vector
      // once, instead of repeating regional scans for every event and every competitor.
      sql = `WITH regional AS (
        SELECT r.person_id,r.event_id,r.${field} AS event_rank,r.country_rank
        FROM ranks_${f.type} r ${regionalJoins}
        WHERE ${regional} AND r.event_id IN (${ids}) AND r.${field}>0
      ), penalties AS (
        SELECT event_id, MAX(event_rank)+1 AS penalty FROM regional GROUP BY event_id
      ), penalty_totals AS (
        SELECT SUM(penalty) AS total,${penaltyColumns.join(",")} FROM penalties
      ), entries AS (
        ${
          country
            ? `SELECT p.country_id AS entity_id,r.event_id,MIN(r.event_rank) AS event_rank
             FROM regional r JOIN persons p ON p.wca_id=r.person_id AND p.sub_id=1
             WHERE ${genderCondition}${f.gender === "all" ? " AND r.country_rank=1" : ""}
             GROUP BY p.country_id,r.event_id`
            : "SELECT person_id AS entity_id,event_id,event_rank FROM regional"
        }
      ), sums AS (
        SELECT entity_id AS ${country ? "country_id" : "person_id"},
          MAX(pt.total)+SUM(event_rank-penalty) AS sum,${perEvent.join(",")},
          ${eventIds.map((id) => `MAX(pt.penalty_${id}) AS penalty_${id}`).join(",")}
        FROM entries JOIN penalties USING(event_id) CROSS JOIN penalty_totals pt GROUP BY entity_id
      ) SELECT r.*,${country ? "pc.name AS country_name FROM sums r JOIN countries pc ON pc.id=r.country_id" : `p.name AS person_name,pc.name AS country_name FROM sums r ${currentJoins} WHERE ${genderCondition}`}`;
      columns = [
        ...(country ? [countryColumn] : [personColumn, countryColumn]),
        { key: "sum", label: "Sum" },
        ...eventIds.map((id) => ({
          key: id,
          label: options.events.find((e) => e.id === id)!.name,
        })),
      ];
      order = "sum ASC";
      break;
    }
    case "most-competitions":
    case "most-persons": {
      const competition = f.statistic === "most-persons";
      sql = `SELECT ${competition ? competitionSelect : personSelect}, COUNT(DISTINCT r.${competition ? "person_id" : "competition_id"}) AS count FROM results r ${resultJoins} WHERE ${conditions(competition ? "cc" : "rc")} GROUP BY r.${competition ? "competition_id" : "person_id"}`;
      if (competition)
        columns = [
          competitionColumn,
          { key: "date", label: "Date", format: "date" },
          countColumn,
        ];
      break;
    }
    case "most-solves":
    case "most-solves-person-competition":
    case "most-solves-competition": {
      const competition = f.statistic === "most-solves-competition";
      const personalCompetition =
        f.statistic === "most-solves-person-competition";
      sql = `SELECT ${competition ? competitionSelect : personSelect}${personalCompetition ? ", MAX(c.name) AS competition_name, r.competition_id" : ""}, SUM(a.value>0) AS solves, SUM(a.value<>0) AS attempts FROM results r ${resultJoins} JOIN result_attempts a ON a.result_id=r.id WHERE ${conditions(competition ? "cc" : "pc")} GROUP BY r.${competition ? "competition_id" : "person_id"}${personalCompetition ? ",r.competition_id" : ""}`;
      if (personalCompetition)
        sql = `WITH counts AS (${sql}), best AS (SELECT counts.*, ROW_NUMBER() OVER (PARTITION BY person_id ORDER BY solves DESC, attempts ASC, competition_id) AS personal_rank FROM counts) SELECT * FROM best WHERE personal_rank=1`;
      columns = [
        competition ? competitionColumn : personColumn,
        ...(competition ? [] : [countryColumn]),
        { key: "solves", label: "Solves" },
        { key: "attempts", label: "Attempts" },
        ...(personalCompetition ? [competitionColumn] : []),
      ];
      order = "solves DESC, attempts ASC";
      break;
    }
    case "medal-collection":
      sql = `SELECT ${personSelect}, SUM(r.pos=1) AS gold, SUM(r.pos=2) AS silver, SUM(r.pos=3) AS bronze, COUNT(*) AS count FROM results r ${resultJoins} WHERE ${conditions("pc", [finalCondition, "r.pos<=3"])} GROUP BY r.person_id`;
      columns = [
        personColumn,
        countryColumn,
        ...["gold", "silver", "bronze"].map((key) => ({
          key,
          label: key[0].toUpperCase() + key.slice(1),
        })),
        { key: "count", label: "Total" },
      ];
      order = "gold DESC, silver DESC, bronze DESC";
      break;
    case "most-pos":
      sql = `SELECT ${personSelect}, COUNT(*) AS count FROM results r ${resultJoins} WHERE ${conditions("rc", [`r.pos=${f.pos}`, ...(f.include_dnf ? [] : ["r.best>0"])])} GROUP BY r.person_id`;
      break;
    case "top-100":
    case "top-100-appearances": {
      const roundValue = f.type === "single" ? "r.best" : "r.average";
      const indexedOrder =
        f.region === "World" && f.gender === "all" && f.year === null
          ? "STRAIGHT_JOIN "
          : "";
      const roundJoins = indexedOrder
        ? resultJoins.replace(/\bJOIN\b/g, "STRAIGHT_JOIN")
        : resultJoins;
      const rounds = `SELECT r.id AS result_id, r.person_id, p.name AS person_name, rc.name AS country_name, r.competition_id, c.name AS competition_name, r.event_id, ${roundValue} AS round_value FROM results r ${roundJoins} WHERE ${conditions("rc", [`${roundValue}>0`])}`;
      // Every successful round supplies at least one attempt equal to its best.
      // The 100th round best is therefore a safe upper bound on the 100th attempt.
      // Use indexed round results to restrict the attempt sort, retaining all cutoff ties.
      sql = `WITH eligible_rounds AS (${rounds}), cutoff AS (
        SELECT MAX(round_value) AS value FROM (SELECT round_value FROM eligible_rounds ORDER BY round_value LIMIT 100) fastest_rounds
      ), eligible AS (
        SELECT er.*, ${f.type === "single" ? "a.value, a.attempt_number" : "er.round_value AS value"}
        FROM eligible_rounds er ${f.type === "single" ? "JOIN result_attempts a ON a.result_id=er.result_id" : ""}
        WHERE er.round_value<=(SELECT value FROM cutoff)${f.type === "single" ? " AND a.value>0 AND a.value<=(SELECT value FROM cutoff)" : ""}
      ), top_results AS (SELECT eligible.*, RANK() OVER (ORDER BY value) AS result_rank FROM eligible)
      SELECT * FROM top_results WHERE result_rank<=100`;
      if (f.statistic === "top-100-appearances") {
        sql = `WITH top_results AS (${sql}) SELECT person_id, MAX(person_name) AS person_name, MAX(country_name) AS country_name, COUNT(*) AS count FROM top_results GROUP BY person_id`;
      } else {
        if (f.type === "average") {
          sql = `WITH top_results AS (${sql}) SELECT top_results.*, (SELECT JSON_ARRAYAGG(a.value ORDER BY a.attempt_number) FROM result_attempts a WHERE a.result_id=top_results.result_id) AS attempts_detail FROM top_results`;
        }
        columns = [
          personColumn,
          countryColumn,
          resultColumn,
          competitionColumn,
          ...(f.type === "average"
            ? [
                {
                  key: "attempts_detail",
                  label: "Attempts",
                  format: "attempts" as const,
                },
              ]
            : []),
        ];
        order = "value ASC";
      }
      break;
    }
    case "uncrowned-kings":
    case "podium-missers":
    case "record-missers": {
      resultType =
        f.statistic === "record-missers" ? f.type : preferredType(f.events[0]);
      const value = resultType === "single" ? "best" : "average";
      const excluded =
        f.statistic === "record-missers"
          ? `COALESCE(x.regional_${resultType}_record,'')<>''`
          : `x.round_type_id IN ('c','f') AND x.best>0 AND x.pos<=${f.statistic === "uncrowned-kings" ? 1 : 3}`;
      const where = conditions("rc", [`r.${value}>0`], false);
      const excludedRegion = regionCondition("xc");
      sql = `SELECT ${personSelect}, MAX(r.event_id) AS event_id, MIN(r.${value}) AS value FROM results r ${resultJoins} WHERE ${where} AND NOT EXISTS(SELECT 1 FROM results x JOIN countries xc ON xc.id=x.country_id WHERE x.person_id=r.person_id AND x.event_id=r.event_id AND ${excluded} AND ${excludedRegion}) GROUP BY r.person_id`;
      columns = [personColumn, countryColumn, resultColumn];
      order = "value ASC";
      break;
    }
    case "records-person":
    case "records-competition": {
      const competition = f.statistic === "records-competition";
      const recordSum = (condition: string) =>
        ["single", "average"]
          .map(
            (type) =>
              `SUM(CASE WHEN COALESCE(r.regional_${type}_record,'') ${condition} THEN 1 ELSE 0 END)`,
          )
          .join("+");
      sql = `WITH records AS (SELECT ${competition ? competitionSelect : personSelect}, ${recordSum("='WR'")} AS wr, ${recordSum("NOT IN ('','WR','NR')")} AS cr, ${recordSum("='NR'")} AS nr FROM results r ${resultJoins} WHERE ${conditions(competition ? "cc" : "rc", ["(r.regional_single_record<>'' OR r.regional_average_record<>'')"])} GROUP BY r.${competition ? "competition_id" : "person_id"}) SELECT records.*, wr*10+cr*5+nr AS score FROM records WHERE wr+cr+nr>0`;
      columns = [
        competition ? competitionColumn : personColumn,
        ...["score", "wr", "cr", "nr"].map((key) => ({
          key,
          label: key.toUpperCase(),
        })),
      ];
      order = "score DESC, wr DESC, cr DESC, nr DESC";
      break;
    }
    case "oldest-standing-records": {
      const value = f.type === "single" ? "best" : "average";
      const regional = regionCondition("pc");
      const ids = eventIds.map(() => "?").join(",");
      params.push(...eventIds);
      const recordResults = `SELECT r.person_id, p.name AS person_name, pc.name AS country_name, r.event_id, r.best AS value, rs.competition_id, c.name AS competition_name, c.start_date AS date, ROW_NUMBER() OVER (PARTITION BY r.person_id,r.event_id ORDER BY c.start_date, c.id, rs.id) AS first_achievement FROM ranks_${f.type} r ${currentJoins} JOIN results rs ON rs.person_id=r.person_id AND rs.event_id=r.event_id AND rs.${value}=r.best JOIN competitions c ON c.id=rs.competition_id JOIN countries rc ON rc.id=rs.country_id WHERE ${regional} AND r.${rankField}=1 AND r.event_id IN (${ids}) AND ${regionCondition("rc")}${f.gender === "all" ? "" : " AND p.gender=?"}`;
      if (f.gender !== "all") params.push(f.gender);
      params.push(
        options.export_timestamp?.slice(0, 10) ||
          new Date().toISOString().slice(0, 10),
      );
      sql = `WITH achievements AS (${recordResults}) SELECT achievements.*, DATEDIFF(?,date) AS days FROM achievements WHERE first_achievement=1`;
      columns = [
        personColumn,
        countryColumn,
        { key: "event_name", label: "Event" },
        resultColumn,
        { key: "days", label: "Days" },
        { key: "date", label: "Set", format: "date" },
        competitionColumn,
      ];
      order = "date ASC";
      break;
    }
    case "all-events-achiever": {
      const where = conditions("pc", [], false, false);
      sql = `WITH requirements AS (
        SELECT e.id AS event_id, 'single' AS type FROM events e WHERE e.\`rank\`<900
        UNION ALL SELECT e.id,'average' FROM events e WHERE e.\`rank\`<900 AND e.id IN (${
          options.events
            .filter((e) => e.has_average)
            .map((e) => `'${e.id}'`)
            .join(",") || "NULL"
        })
      ), single_counts AS (
        SELECT r.person_id,COUNT(DISTINCT r.event_id) AS singles FROM ranks_single r
        JOIN events e ON e.id=r.event_id WHERE e.\`rank\`<900 GROUP BY r.person_id
      ), average_counts AS (
        SELECT r.person_id,COUNT(DISTINCT r.event_id) AS averages FROM ranks_average r
        JOIN events e ON e.id=r.event_id WHERE e.\`rank\`<900 GROUP BY r.person_id
      ), candidates AS (
        SELECT r.person_id FROM single_counts r ${currentJoins}
        LEFT JOIN average_counts a ON a.person_id=r.person_id WHERE ${where}
        AND r.singles=${options.events.length} AND COALESCE(a.averages,0)=${options.events.filter((e) => e.has_average).length}
      ), first_results AS (
        SELECT STRAIGHT_JOIN r.person_id,r.event_id,q.type,MIN(c.end_date) AS date FROM candidates t
        JOIN results r ON r.person_id=t.person_id JOIN competitions c ON c.id=r.competition_id
        JOIN requirements q ON q.event_id=r.event_id AND ((q.type='single' AND r.best>0) OR (q.type='average' AND r.average>0))
        GROUP BY r.person_id,r.event_id,q.type
      ), completed AS (
        SELECT person_id,MAX(date) AS finish_date FROM first_results GROUP BY person_id
      ) SELECT STRAIGHT_JOIN t.person_id,MAX(p.name) AS person_name,MAX(pc.name) AS country_name,
        MIN(c.start_date) AS start_date,t.finish_date,DATEDIFF(t.finish_date,MIN(c.start_date))+1 AS days,
        COUNT(DISTINCT CASE WHEN c.end_date<=t.finish_date THEN c.id END) AS competitions
        FROM completed t JOIN results r ON r.person_id=t.person_id ${resultJoins} GROUP BY t.person_id,t.finish_date`;
      columns = [
        personColumn,
        countryColumn,
        { key: "days", label: "Days" },
        { key: "start_date", label: "First competition", format: "date" },
        { key: "finish_date", label: "Completed", format: "date" },
        { key: "competitions", label: "Competitions" },
      ];
      order = "days ASC";
      break;
    }
    case "best-podiums": {
      const event = f.events[0];
      resultType = preferredType(event);
      const fm = event === "333fm";
      const multi = event === "333mbf";
      if (fm) resultType = "average";
      const value = fm
        ? "COALESCE(a.moves/a.solves*100,r.best*100)"
        : resultType === "single"
          ? "r.best"
          : "r.average";
      const where = conditions("cc", [
        finalCondition,
        "r.pos<=3",
        ...(fm ? [] : [`${value}>0`]),
      ]);
      sql = `WITH podium AS (SELECT r.competition_id,c.name AS competition_name,c.start_date AS date,r.person_id,p.name AS person_name,r.event_id,r.pos,${value} AS value${fm ? ", COALESCE(a.moves,r.best) AS moves, COALESCE(a.solves,1) AS solves" : ""} FROM results r ${resultJoins} ${fm ? "LEFT JOIN (SELECT a.result_id,SUM(CASE WHEN a.value>0 THEN a.value ELSE 0 END) AS moves,SUM(a.value>0) AS solves FROM result_attempts a JOIN results fm ON fm.id=a.result_id WHERE fm.event_id='333fm' AND fm.round_type_id IN ('c','f') AND fm.pos<=3 GROUP BY a.result_id HAVING solves>0) a ON a.result_id=r.id" : ""} WHERE ${where}) SELECT competition_id,MAX(competition_name) AS competition_name,MAX(date) AS date,MAX(event_id) AS event_id, ${fm ? "CASE WHEN COUNT(*)>3 THEN SUM(DISTINCT value)/3 ELSE SUM(moves)*100/SUM(solves) END" : "CASE WHEN COUNT(*)>3 THEN SUM(DISTINCT value) ELSE SUM(value) END"} AS score, ${multi ? "SUM(99-FLOOR(value/10000000))" : fm ? "CASE WHEN COUNT(*)>3 THEN SUM(DISTINCT value) ELSE SUM(moves)*300/SUM(solves) END" : "CASE WHEN COUNT(*)>3 THEN SUM(DISTINCT value) ELSE SUM(value) END"} AS value,JSON_ARRAYAGG(JSON_OBJECT('person_id',person_id,'person_name',person_name,'pos',pos,'value',value)) AS podium FROM podium GROUP BY competition_id HAVING COUNT(*)>=3 AND COUNT(DISTINCT pos)<=3`;
      columns = [
        competitionColumn,
        { key: "date", label: "Date", format: "date" },
        {
          key: "value",
          label: multi ? "Total points" : "Sum",
          ...(multi ? {} : { format: "result" as const }),
        },
        {
          key: "mean",
          label: multi ? "Mean points" : "Mean",
          ...(multi ? {} : { format: "result" as const }),
        },
        { key: "podium", label: "Podium", format: "podium" },
      ];
      order = "score ASC";
      break;
    }
    default:
      throw new StatisticsInputError("Unknown statistic");
  }
  // Rank before pagination so ties, including ties across page boundaries, stay correct.
  const stableOrder =
    f.statistic === "sum-of-country-ranks"
      ? "country_name, country_id"
      : "person_name, person_id";
  const fallbackOrder =
    columns.some((c) => c.format === "competition") &&
    !columns.some((c) => c.format === "person")
      ? "competition_id"
      : stableOrder;
  const rowOrder =
    f.statistic === "top-100"
      ? `${fallbackOrder}, result_id${f.type === "single" ? ", attempt_number" : ""}`
      : f.statistic === "oldest-standing-records"
        ? `${fallbackOrder}, event_id`
        : fallbackOrder;
  const ranked = `WITH standings AS (${sql}) SELECT standings.*, RANK() OVER (ORDER BY ${order}) AS rank, COUNT(*) OVER () AS total FROM standings`;
  return {
    sql: `${ranked} ORDER BY ${order}, ${rowOrder} LIMIT ? OFFSET ?`,
    params: [...params, f.page_size, (f.page - 1) * f.page_size],
    columns,
    resultType,
    countSql: `WITH standings AS (${sql}) SELECT COUNT(*) AS total FROM standings`,
    countParams: params,
  };
}

export async function getStatistics(
  pool: Pool,
  filters: StatisticsFilters,
  options: StatisticsOptions,
) {
  const query = buildStatisticsQuery(filters, options);
  const timeout = statementTimeout();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SET STATEMENT max_statement_time=${timeout} FOR ${query.sql}`,
    query.params,
  );
  let total = Number(rows[0]?.total || 0);
  if (!rows.length && filters.page > 1) {
    const [[count]] = await pool.query<RowDataPacket[]>(
      `SET STATEMENT max_statement_time=${timeout} FOR ${query.countSql}`,
      query.countParams,
    );
    total = Number(count.total);
  }
  return {
    filters,
    columns: query.columns,
    rows: rows.map((row) => {
      const result: Record<string, unknown> = { ...row };
      delete result.total;
      if (row.event_id)
        result.event_name =
          options.events.find((e) => e.id === row.event_id)?.name ||
          row.event_id;
      if (row.podium) {
        result.podium =
          typeof row.podium === "string" ? JSON.parse(row.podium) : row.podium;
        result.mean = Number(row.value) / 3;
      }
      if (row.attempts_detail)
        result.attempts_detail =
          typeof row.attempts_detail === "string"
            ? JSON.parse(row.attempts_detail)
            : row.attempts_detail;
      for (const id of Object.keys(row).filter((k) =>
        k.startsWith("penalty_"),
      )) {
        const event = id.slice(8);
        if (row[event] === null) result[event] = row[id];
        delete result[id];
      }
      return result;
    }),
    total,
    page: filters.page,
    page_size: filters.page_size,
    result_type: query.resultType,
    export_timestamp: options.export_timestamp,
  };
}

// Results are immutable within a WCA export. Cache ten adjacent pages per query,
// bounded by row count, and share their computation across concurrent requests.
export function createStatisticsService(pool: Pool) {
  type Result = Awaited<ReturnType<typeof getStatistics>>;
  let optionsCache: { value: StatisticsOptions; expires: number } | undefined;
  let pendingOptions: Promise<StatisticsOptions> | undefined;
  const cache = new Map<string, Result>();
  const pending = new Map<string, Promise<Result>>();
  const chunks = new Map<string, { value: Result; expires: number }>();
  const pendingChunks = new Map<string, Promise<Result>>();
  let cachedRows = 0;
  const options = async () => {
    if (optionsCache && optionsCache.expires > Date.now())
      return optionsCache.value;
    if (!pendingOptions) {
      pendingOptions = (async () => {
        if (optionsCache?.value.export_timestamp) {
          const [[row]] = await pool.query<RowDataPacket[]>(
            `SET STATEMENT max_statement_time=${statementTimeout()} FOR SELECT value FROM wca_statistics_metadata WHERE field='export_timestamp' LIMIT 1`,
          );
          if (row?.value === optionsCache.value.export_timestamp) {
            optionsCache.expires = Date.now() + 60000;
            return optionsCache.value;
          }
        }
        const value = await getStatisticsOptions(pool);
        // Drop references to previous exports instead of waiting for eviction.
        cache.clear();
        chunks.clear();
        cachedRows = 0;
        optionsCache = { value, expires: Date.now() + 60000 };
        return value;
      })().finally(() => {
        pendingOptions = undefined;
      });
    }
    return pendingOptions;
  };
  const getChunk = async (
    filters: StatisticsFilters,
    metadata: StatisticsOptions,
  ) => {
    const chunkFilters = {
      ...filters,
      page: Math.floor((filters.page - 1) / 10) + 1,
      page_size: filters.page_size * 10,
    };
    const key = JSON.stringify([metadata.export_timestamp, chunkFilters]);
    const hit = chunks.get(key);
    if (hit && hit.expires > Date.now()) {
      chunks.delete(key);
      chunks.set(key, hit);
      return hit.value;
    }
    if (hit) {
      chunks.delete(key);
      cachedRows -= hit.value.rows.length;
    }
    if (pendingChunks.has(key)) return pendingChunks.get(key)!;
    const task = getStatistics(pool, chunkFilters, metadata)
      .then((value) => {
        // An older in-flight export must not repopulate the cache after a refresh.
        if (optionsCache?.value !== metadata) return value;
        while (
          chunks.size &&
          (chunks.size >= 100 || cachedRows + value.rows.length > 10000)
        ) {
          const oldest = chunks.keys().next().value!;
          cachedRows -= chunks.get(oldest)!.value.rows.length;
          chunks.delete(oldest);
        }
        chunks.set(key, {
          value,
          expires: metadata.export_timestamp ? Infinity : Date.now() + 300000,
        });
        cachedRows += value.rows.length;
        return value;
      })
      .finally(() => {
        pendingChunks.delete(key);
      });
    pendingChunks.set(key, task);
    return task;
  };
  return {
    options,
    async get(query: Record<string, unknown>) {
      const metadata = await options();
      const filters = parseStatisticsFilters(query, metadata);
      const key = JSON.stringify([metadata.export_timestamp, filters]);
      // Without export metadata, use the finite chunk lifetime rather than page caching.
      if (metadata.export_timestamp && cache.has(key)) return cache.get(key)!;
      if (pending.has(key)) return pending.get(key)!;
      const task = getChunk(filters, metadata)
        .then((chunk) => {
          const offset = ((filters.page - 1) % 10) * filters.page_size;
          const value = {
            ...chunk,
            filters,
            page: filters.page,
            page_size: filters.page_size,
            rows: chunk.rows.slice(offset, offset + filters.page_size),
          };
          if (optionsCache?.value === metadata && metadata.export_timestamp) {
            if (cache.size >= 100) cache.delete(cache.keys().next().value!);
            cache.set(key, value);
          }
          return value;
        })
        .finally(() => {
          pending.delete(key);
        });
      pending.set(key, task);
      return task;
    },
  };
}
