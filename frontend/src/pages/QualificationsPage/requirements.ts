import { formatResult } from "../../utils/results";

export const UNIQUE_LIST = "unique";
export const WORLD = "World";

export interface Competition {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  country_id: string;
}

export interface Region {
  id: string;
  name: string;
  kind: string;
}

export interface EventOption {
  id: string;
  name: string;
  has_average: boolean;
}

export type ResultType = "single" | "average";

export interface Requirement {
  type: "attemptResult" | "ranking" | "anyResult";
  result_type: ResultType;
  when_date: string | null;
  level: number | null;
}

export interface EventRequirement {
  event_id: string;
  event_name: string;
  requirement: Requirement;
  count: number | null;
}

export interface Competitor {
  wca_id: string;
  name: string;
  country_id: string | null;
  country_name: string | null;
}

export interface EventQualifier extends Competitor {
  result: number;
  competition_id: string;
  competition_name: string;
}

export interface UniqueQualifier extends Competitor {
  events: string[];
}

export interface QualificationsResult {
  competition: Competition | null;
  events: EventRequirement[];
  unique_count: number;
  region: string;
  competed_since: string | null;
  list: string;
  page: number;
  page_size: number;
  qualifiers: EventQualifier[] | UniqueQualifier[];
}

const MULTI_BLIND_POINTS = 10000000;

/** The requirement as the WCA words it on a competition's events page. */
export function describeRequirement(eventId: string, requirement: Requirement): string {
  const kind = requirement.result_type === "single" ? "Single" : "Average";
  const level = requirement.level ?? 0;
  if (requirement.type === "ranking") {
    return `Top ${level} registered competitors by ${requirement.result_type}`;
  }
  if (requirement.type === "anyResult") {
    return `Any successful ${requirement.result_type}`;
  }
  if (eventId === "333mbf") {
    // A limit on a whole number of points reads exactly; the WCA's own limits also carry a
    // time, so they read the way the WCA words them.
    if (level % MULTI_BLIND_POINTS === 0) {
      const points = 100 - level / MULTI_BLIND_POINTS;
      return `${kind} of at least ${points} ${points === 1 ? "point" : "points"}`;
    }
    const points = 99 - Math.floor(level / MULTI_BLIND_POINTS);
    return `${kind} over ${points} ${points === 1 ? "point" : "points"}`;
  }
  if (eventId === "333fm") {
    return `${kind} under ${formatResult(level, eventId, requirement.result_type)} moves`;
  }
  return `${kind} under ${formatResult(level, eventId, requirement.result_type)}`;
}

/** Whether a limit is a time, typed the way WCA Live takes one. */
export function isTimed(eventId: string): boolean {
  return eventId !== "333fm" && eventId !== "333mbf";
}

/**
 * WCA Live's time entry (EditResult/WCALive/AttemptResultField/TimeField.js): only digits are
 * kept, read from the right as hh mm ss cc, up to eight of them, without leading zeros. So
 * typing 750 shows 7.50 and 12345 shows 1:23.45.
 */
export function reformatTimeInput(input: string): string {
  const number = Number(input.replace(/\D/g, "").slice(0, 8)) || 0;
  if (number === 0) return "";
  const [, hh, mm, ss, cc] = /(\d\d)(\d\d)(\d\d)(\d\d)$/.exec(String(number).padStart(8, "0"))!;
  return `${hh}:${mm}:${ss}.${cc}`.replace(/^[0:]*(?!\.)/g, "");
}

/** What a custom limit is typed in, for the field's placeholder and hint. */
export function limitHint(eventId: string, resultType: ResultType): string {
  if (eventId === "333mbf") return "points, e.g. 5";
  if (eventId === "333fm") return resultType === "single" ? "moves, e.g. 30" : "moves, e.g. 32.67";
  return "time, e.g. 105 for 1.05";
}

/**
 * Turns a typed limit into the attempt result a qualifying result must be strictly better
 * than, or returns null when it is not one. Multi-blind takes the fewest points that qualify.
 */
export function parseLimit(eventId: string, resultType: ResultType, input: string): number | null {
  const value = input.trim();
  if (eventId === "333mbf") {
    if (!/^\d{1,2}$/.test(value)) return null;
    const points = Number(value);
    return points >= 1 && points <= 99 ? (100 - points) * MULTI_BLIND_POINTS : null;
  }
  if (eventId === "333fm") {
    if (resultType === "single") {
      return /^\d{1,3}$/.test(value) && Number(value) > 0 ? Number(value) : null;
    }
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(value)) return null;
    const moves = Math.round(Number(value) * 100);
    return moves > 0 ? moves : null;
  }
  const match = /^(?:(?:(\d+):)?(\d{1,2}):)?(\d{1,2})(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return null;
  const [, hours = "0", minutes = "0", seconds, fraction = "0"] = match;
  const centiseconds =
    ((Number(hours) * 60 + Number(minutes)) * 60 + Number(seconds)) * 100 +
    Number(fraction.padEnd(2, "0"));
  return centiseconds > 0 ? centiseconds : null;
}

/** Writes a stored limit back the way it is typed, so a shared link fills the form again. */
export function formatLimit(eventId: string, resultType: ResultType, level: number): string {
  if (eventId === "333mbf") return String(100 - Math.floor(level / MULTI_BLIND_POINTS));
  return formatResult(level, eventId, resultType);
}

export interface CustomRequirement {
  eventId: string;
  resultType: ResultType;
  /** Null for any successful result. */
  level: number | null;
}

/** The URL and API form: comma-separated `event:single|average:level|any`. */
export function encodeCustom(requirements: CustomRequirement[]): string {
  return requirements
    .map(({ eventId, resultType, level }) => `${eventId}:${resultType}:${level ?? "any"}`)
    .join(",");
}

export function decodeCustom(spec: string): CustomRequirement[] {
  return spec
    .split(",")
    .map((part) => /^([a-z0-9]+):(single|average):(any|\d+)$/.exec(part))
    .filter((match): match is RegExpExecArray => match !== null)
    .map(([, eventId, resultType, level]) => ({
      eventId,
      resultType: resultType as ResultType,
      level: level === "any" ? null : Number(level),
    }));
}

/**
 * The competed-since filter as the URL and saved views keep it: a preset that stays relative to
 * today, or a fixed date. "this-year" saved in one year still means the current one in the next.
 */
export const COMPETED_PRESETS = [
  { id: "this-year", label: "This year" },
  { id: "12-months", label: "In the last 12 months" },
  { id: "24-months", label: "In the last 2 years" },
] as const;

const isoDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/** The date a competed filter starts from, or null for any time or something unreadable. */
export function competedSinceDate(competed: string, today = new Date()): string | null {
  if (competed === "this-year") return `${today.getFullYear()}-01-01`;
  const months = { "12-months": 12, "24-months": 24 }[competed];
  if (months) {
    const since = new Date(today);
    since.setMonth(since.getMonth() - months);
    return isoDay(since);
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(competed) ? competed : null;
}

/**
 * The parameters that make up a view: which requirements, and how they are filtered. The list
 * and page being looked at are not part of it, so a view opens on its unique list.
 */
export function viewParams(searchParams: URLSearchParams): string {
  const params = new URLSearchParams();
  for (const key of ["mode", "competition_id", "requirements", "deadline", "region", "competed"]) {
    const value = searchParams.get(key);
    if (value) params.set(key, value);
  }
  return params.toString();
}
