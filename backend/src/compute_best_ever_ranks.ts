import * as dotenv from "dotenv";
dotenv.config();
import mysql, { Connection, RowDataPacket } from "mysql2";

/**
 * Best ever ranks: for every competitor, the best rank they ever held in the world,
 * continental and national rankings, for every event, single and average.
 *
 * A competitor's rank can only get worse between their own personal bests, because
 * everybody else's results only ever improve. So the best rank they ever held is
 * always reached right after one of their own PBs, and it is enough to evaluate ranks
 * at those moments instead of re-ranking everybody on every day of WCA history.
 *
 * One chronological pass per event feeds a Fenwick tree per region holding the current
 * PB of every competitor, which answers "how many people are faster than this" in
 * O(log n). A second Fenwick tree per region tracks the competitors who are currently
 * holding their best ever rank, so we can find out on which day they lost it.
 *
 * Days are the finest granularity the export gives us (competition start dates), so all
 * results of a day are applied before anybody is ranked, matching the behaviour of the
 * official statistic.
 */

const TABLE = "best_ever_ranks";
const BUILD_TABLE = "best_ever_ranks_new";
const OLD_TABLE = "best_ever_ranks_old";

const PERSON_SPACE = 1_000_000;
const CONTINENT_OFFSET = 1;
const COUNTRY_OFFSET = 100;
const INSERT_CHUNK = 2000;

const RESULT_TYPES = ["single", "average"] as const;
type ResultType = (typeof RESULT_TYPES)[number];

function fenwickAdd(tree: Int32Array, index: number, delta: number): void {
  for (let i = index + 1; i < tree.length; i += i & -i) tree[i] += delta;
}

/** Number of entries with a value index <= index. */
function fenwickPrefix(tree: Int32Array, index: number): number {
  let sum = 0;
  for (let i = index + 1; i > 0; i -= i & -i) sum += tree[i];
  return sum;
}

/** Smallest value index whose prefix count reaches k (k >= 1). */
function fenwickFindKth(tree: Int32Array, k: number): number {
  let position = 0;
  let step = 1;
  while (step * 2 < tree.length) step *= 2;
  for (; step > 0; step >>= 1) {
    const next = position + step;
    if (next < tree.length && tree[next] < k) {
      position = next;
      k -= tree[position];
    }
  }
  return position;
}

function toEpochDay(date: string): number {
  return Math.floor(
    Date.UTC(
      Number(date.slice(0, 4)),
      Number(date.slice(5, 7)) - 1,
      Number(date.slice(8, 10))
    ) / 86400000
  );
}

function fromEpochDay(day: number): string {
  return new Date(day * 86400000).toISOString().slice(0, 10);
}

/**
 * Column store for the competitors of one event and one result type. A slot is one
 * (region, competitor) pair: somebody who changed country holds a slot in each of the
 * countries they competed for, exactly like the official statistic does.
 */
class Slots {
  size = 0;
  private capacity: number;
  region: Int32Array;
  person: Int32Array;
  /** Current PB as a value index + 1, 0 when the competitor has no result yet. */
  current: Int32Array;
  currentCompetition: Int32Array;
  bestRank: Int32Array;
  bestValue: Int32Array;
  bestCompetition: Int32Array;
  bestStart: Int32Array;
  /** Epoch day on which the best ever rank was lost, 0 while it is still held. */
  bestEnd: Int32Array;
  /** Value index + 1 this slot is registered under in the reign buckets, 0 when absent. */
  reignValue: Int32Array;

  constructor(capacity = 1024) {
    this.capacity = capacity;
    this.region = new Int32Array(capacity);
    this.person = new Int32Array(capacity);
    this.current = new Int32Array(capacity);
    this.currentCompetition = new Int32Array(capacity);
    this.bestRank = new Int32Array(capacity);
    this.bestValue = new Int32Array(capacity);
    this.bestCompetition = new Int32Array(capacity);
    this.bestStart = new Int32Array(capacity);
    this.bestEnd = new Int32Array(capacity);
    this.reignValue = new Int32Array(capacity);
  }

  allocate(region: number, person: number): number {
    if (this.size === this.capacity) this.grow();
    const slot = this.size++;
    this.region[slot] = region;
    this.person[slot] = person;
    return slot;
  }

  private grow(): void {
    this.capacity *= 2;
    const columns: (keyof Slots)[] = [
      "region", "person", "current", "currentCompetition", "bestRank",
      "bestValue", "bestCompetition", "bestStart", "bestEnd", "reignValue",
    ];
    for (const column of columns) {
      const grown = new Int32Array(this.capacity);
      grown.set(this[column] as Int32Array);
      (this as Record<string, unknown>)[column] = grown;
    }
  }
}

/** Everything we track for one event and one result type. */
class Scope {
  readonly slots = new Slots();
  readonly slotOf = new Map<number, number>();
  readonly ranks: Int32Array[] = [];
  readonly reigns: Int32Array[] = [];
  readonly buckets = new Map<number, number[]>();
  readonly pendingValue = new Map<number, number>();
  readonly pendingCompetition = new Map<number, number>();

  constructor(
    readonly type: ResultType,
    readonly valueIndex: Map<number, number>,
    readonly values: Int32Array
  ) {}

  get size(): number {
    return this.values.length;
  }

  rankTree(region: number): Int32Array {
    return (this.ranks[region] ||= new Int32Array(this.size + 2));
  }

  private reignTree(region: number): Int32Array {
    return (this.reigns[region] ||= new Int32Array(this.size + 2));
  }

  addReign(region: number, slot: number, valueIdx: number): void {
    fenwickAdd(this.reignTree(region), valueIdx, 1);
    const key = region * this.size + valueIdx;
    const bucket = this.buckets.get(key);
    if (bucket) bucket.push(slot);
    else this.buckets.set(key, [slot]);
    this.slots.reignValue[slot] = valueIdx + 1;
  }

  removeReign(region: number, slot: number): void {
    const valueIdx = this.slots.reignValue[slot] - 1;
    if (valueIdx < 0) return;
    fenwickAdd(this.reignTree(region), valueIdx, -1);
    const key = region * this.size + valueIdx;
    const bucket = this.buckets.get(key);
    if (bucket) {
      const position = bucket.indexOf(slot);
      if (position !== -1) bucket.splice(position, 1);
      if (bucket.length === 0) this.buckets.delete(key);
    }
    this.slots.reignValue[slot] = 0;
  }

  /**
   * Somebody moved from `previousIdx` to `newIdx` in this region, so everybody holding a
   * best ever rank with a result in between just dropped one place and lost it.
   */
  endReignsBetween(region: number, newIdx: number, previousIdx: number, endDay: number): void {
    const tree = this.reigns[region];
    if (!tree) return;
    const below = newIdx >= 0 ? fenwickPrefix(tree, newIdx) : 0;
    while (fenwickPrefix(tree, previousIdx) > below) {
      const valueIdx = fenwickFindKth(tree, below + 1);
      const key = region * this.size + valueIdx;
      const bucket = this.buckets.get(key);
      if (!bucket || bucket.length === 0) {
        this.buckets.delete(key);
        return;
      }
      for (const slot of bucket) {
        this.slots.bestEnd[slot] = endDay;
        this.slots.reignValue[slot] = 0;
      }
      fenwickAdd(tree, valueIdx, -bucket.length);
      this.buckets.delete(key);
    }
  }
}

function query<T extends RowDataPacket[] = RowDataPacket[]>(
  connection: Connection,
  sql: string,
  values: unknown[] = []
): Promise<T> {
  return new Promise((resolve, reject) =>
    connection.query(sql, values, (error, rows) =>
      error ? reject(error) : resolve(rows as T)
    )
  );
}

async function loadValueDomain(
  connection: Connection,
  eventId: string,
  column: "best" | "average"
): Promise<{ index: Map<number, number>; values: Int32Array }> {
  const rows = await query(
    connection,
    `SELECT DISTINCT ${column} AS value FROM results
     WHERE event_id = ? AND ${column} > 0 ORDER BY ${column}`,
    [eventId]
  );
  const index = new Map<number, number>();
  const values = new Int32Array(rows.length);
  rows.forEach((row, position) => {
    index.set(row.value, position);
    values[position] = row.value;
  });
  return { index, values };
}

export async function computeBestEverRanks(connection: Connection): Promise<number> {
  const started = Date.now();
  const elapsed = () => `${((Date.now() - started) / 1000).toFixed(1)}s`;

  const countryRows = await query<RowDataPacket[]>(
    connection,
    "SELECT id, continent_id FROM countries"
  );
  const countryIndex = new Map<string, number>();
  const countryIds: string[] = [];
  const continentIndex = new Map<string, number>();
  const continentIds: string[] = [];
  const continentOfCountry: number[] = [];
  for (const row of countryRows) {
    let continent = continentIndex.get(row.continent_id);
    if (continent === undefined) {
      continent = continentIds.length;
      continentIndex.set(row.continent_id, continent);
      continentIds.push(row.continent_id);
    }
    continentOfCountry.push(continent);
    countryIndex.set(row.id, countryIds.length);
    countryIds.push(row.id);
  }

  const regionId = (region: number): string => {
    if (region === 0) return "world";
    if (region < COUNTRY_OFFSET) return continentIds[region - CONTINENT_OFFSET];
    return countryIds[region - COUNTRY_OFFSET];
  };
  const regionType = (region: number): string => {
    if (region === 0) return "world";
    if (region < COUNTRY_OFFSET) return "continent";
    return "country";
  };

  const persons = new Map<string, number>();
  const personIds: string[] = [];
  const competitions = new Map<string, number>();
  const competitionIds: string[] = [];

  await query(connection, `DROP TABLE IF EXISTS ${BUILD_TABLE}`);
  await query(
    connection,
    `CREATE TABLE ${BUILD_TABLE} (
       person_id VARCHAR(10) NOT NULL,
       event_id VARCHAR(6) NOT NULL,
       result_type VARCHAR(7) NOT NULL,
       region_type VARCHAR(9) NOT NULL,
       region_id VARCHAR(50) NOT NULL,
       best_rank INT NOT NULL,
       result INT NOT NULL,
       competition_id VARCHAR(32) NOT NULL,
       start_date DATE NOT NULL,
       end_date DATE NULL,
       PRIMARY KEY (person_id, event_id, result_type, region_type, region_id)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );

  const eventRows = await query<RowDataPacket[]>(
    connection,
    "SELECT DISTINCT event_id FROM results ORDER BY event_id"
  );
  let written = 0;

  for (const { event_id: eventId } of eventRows) {
    const eventStarted = Date.now();
    const singles = await loadValueDomain(connection, eventId, "best");
    if (singles.values.length === 0) continue;
    const averages = await loadValueDomain(connection, eventId, "average");

    const scopes: Scope[] = [
      new Scope("single", singles.index, singles.values),
      new Scope("average", averages.index, averages.values),
    ];

    let day = 0;
    let dayCount = 0;

    const flush = (): void => {
      for (const scope of scopes) {
        if (scope.pendingValue.size === 0) continue;
        const { slots } = scope;
        const improved: number[] = [];
        const transitions: number[] = [];

        for (const [key, value] of scope.pendingValue) {
          const region = Math.floor(key / PERSON_SPACE);
          const person = key % PERSON_SPACE;
          const valueIdx = scope.valueIndex.get(value)!;

          let slot = scope.slotOf.get(key);
          if (slot === undefined) {
            slot = slots.allocate(region, person);
            scope.slotOf.set(key, slot);
          }
          const previous = slots.current[slot];
          if (previous !== 0 && valueIdx >= previous - 1) continue;

          const tree = scope.rankTree(region);
          if (previous !== 0) fenwickAdd(tree, previous - 1, -1);
          fenwickAdd(tree, valueIdx, 1);
          slots.current[slot] = valueIdx + 1;
          slots.currentCompetition[slot] = scope.pendingCompetition.get(key)! + 1;

          // Their own rank is re-evaluated below, so keep them out of the sweep.
          if (slots.reignValue[slot] !== 0) scope.removeReign(region, slot);

          transitions.push(region, valueIdx, previous === 0 ? scope.size - 1 : previous - 1);
          improved.push(slot);
        }

        for (let i = 0; i < transitions.length; i += 3) {
          scope.endReignsBetween(transitions[i], transitions[i + 1], transitions[i + 2], day - 1);
        }

        for (const slot of improved) {
          const region = slots.region[slot];
          const valueIdx = slots.current[slot] - 1;
          const tree = scope.ranks[region];
          const rank = (valueIdx === 0 ? 0 : fenwickPrefix(tree, valueIdx - 1)) + 1;

          if (slots.bestRank[slot] === 0 || rank < slots.bestRank[slot]) {
            slots.bestRank[slot] = rank;
            slots.bestValue[slot] = valueIdx + 1;
            slots.bestCompetition[slot] = slots.currentCompetition[slot];
            slots.bestStart[slot] = day;
            slots.bestEnd[slot] = 0;
            scope.addReign(region, slot, valueIdx);
          } else if (slots.bestEnd[slot] === 0) {
            // Still holding the same rank, now with a better result.
            if (rank === slots.bestRank[slot]) scope.addReign(region, slot, valueIdx);
            else slots.bestEnd[slot] = day - 1;
          }
        }

        scope.pendingValue.clear();
        scope.pendingCompetition.clear();
      }
    };

    const stream = connection
      .query(
        `SELECT r.person_id, r.country_id, r.competition_id, r.best, r.average, c.start_date
         FROM results r
         JOIN competitions c ON c.id = r.competition_id
         WHERE r.event_id = ? AND r.best > 0
         ORDER BY c.start_date`,
        [eventId]
      )
      .stream();

    let currentDate: string | null = null;
    for await (const row of stream as AsyncIterable<RowDataPacket>) {
      if (row.start_date !== currentDate) {
        if (currentDate !== null) flush();
        currentDate = row.start_date;
        day = toEpochDay(currentDate as string);
        dayCount++;
      }

      let person = persons.get(row.person_id);
      if (person === undefined) {
        person = personIds.length;
        persons.set(row.person_id, person);
        personIds.push(row.person_id);
      }
      let competition = competitions.get(row.competition_id);
      if (competition === undefined) {
        competition = competitionIds.length;
        competitions.set(row.competition_id, competition);
        competitionIds.push(row.competition_id);
      }

      const country = countryIndex.get(row.country_id);
      if (country === undefined) continue;
      const regions = [0, CONTINENT_OFFSET + continentOfCountry[country], COUNTRY_OFFSET + country];

      for (const region of regions) {
        const key = region * PERSON_SPACE + person;
        for (const scope of scopes) {
          const value = scope.type === "single" ? row.best : row.average;
          if (value <= 0) continue;
          const pending = scope.pendingValue.get(key);
          if (pending === undefined || value < pending) {
            scope.pendingValue.set(key, value);
            scope.pendingCompetition.set(key, competition);
          }
        }
      }
    }
    flush();

    let rows: unknown[][] = [];
    for (const scope of scopes) {
      const { slots } = scope;
      for (let slot = 0; slot < slots.size; slot++) {
        if (slots.bestRank[slot] === 0) continue;
        const region = slots.region[slot];
        rows.push([
          personIds[slots.person[slot]],
          eventId,
          scope.type,
          regionType(region),
          regionId(region),
          slots.bestRank[slot],
          scope.values[slots.bestValue[slot] - 1],
          competitionIds[slots.bestCompetition[slot] - 1],
          fromEpochDay(slots.bestStart[slot]),
          slots.bestEnd[slot] === 0 ? null : fromEpochDay(slots.bestEnd[slot]),
        ]);
        if (rows.length === INSERT_CHUNK) {
          await query(connection, `INSERT INTO ${BUILD_TABLE} VALUES ?`, [rows]);
          written += rows.length;
          rows = [];
        }
      }
    }
    if (rows.length > 0) {
      await query(connection, `INSERT INTO ${BUILD_TABLE} VALUES ?`, [rows]);
      written += rows.length;
    }

    console.log(
      `[${elapsed()}] ${eventId}: ${dayCount} days, ${written} ranks so far ` +
        `(${((Date.now() - eventStarted) / 1000).toFixed(1)}s)`
    );
  }

  // Swap the finished table in, so the API keeps serving the previous one until now.
  await query(connection, `DROP TABLE IF EXISTS ${OLD_TABLE}`);
  const existing = await query(connection, `SHOW TABLES LIKE '${TABLE}'`);
  await query(
    connection,
    existing.length > 0
      ? `RENAME TABLE ${TABLE} TO ${OLD_TABLE}, ${BUILD_TABLE} TO ${TABLE}`
      : `RENAME TABLE ${BUILD_TABLE} TO ${TABLE}`
  );
  await query(connection, `DROP TABLE IF EXISTS ${OLD_TABLE}`);

  console.log(`[${elapsed()}] Done, ${written} best ever ranks stored in ${TABLE}.`);
  return written;
}

async function main(): Promise<void> {
  const connection = mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASS || "",
    database: process.env.DB_NAME || "wca",
    dateStrings: true,
  });
  try {
    await computeBestEverRanks(connection);
  } finally {
    connection.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
