export type RegistrationStatus = "not_open" | "open" | "full" | "closed";

export interface UpcomingCompetition {
  id: string;
  name: string;
  city: string;
  country_id: string;
  country_name: string;
  start_date: string;
  end_date: string;
  latitude: number | null;
  longitude: number | null;
  competitor_limit: number | null;
  accepted_registrations: number;
  registration_open: string | null;
  registration_close: string | null;
  registration_status: RegistrationStatus;
  distance_km: number | null;
  championships: { type: string; name: string }[];
  events: string[];
}

export interface UpcomingCompetitionsResult {
  competitions: UpcomingCompetition[];
  total: number;
  viewer_wca_id: string | null;
  competed_countries: number | null;
}

export interface UpcomingCompetitionsOptions {
  regions: { id: string; name: string; kind: "world" | "continent" | "country" }[];
  events: { id: string; name: string }[];
}

export const REGISTRATION_STATUSES: {
  id: RegistrationStatus;
  label: string;
  badge: string;
  color: string;
}[] = [
  { id: "not_open", label: "Not open yet", badge: "bg-sky-100 text-sky-800", color: "#0284c7" },
  { id: "open", label: "Open", badge: "bg-green-100 text-green-800", color: "#16a34a" },
  { id: "full", label: "Full", badge: "bg-amber-100 text-amber-800", color: "#d97706" },
  { id: "closed", label: "Closed", badge: "bg-gray-200 text-gray-700", color: "#6b7280" },
];

export const statusInfo = (status: RegistrationStatus) =>
  REGISTRATION_STATUSES.find((s) => s.id === status)!;

export const WCA_ORIGIN = "https://www.worldcubeassociation.org";

const DATE_TIME = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** What a competition's registration status means for it, with the date it changes next. */
export function registrationDetail(competition: UpcomingCompetition): string {
  const { registration_status: status, registration_open: open, registration_close: close } = competition;
  if (status === "not_open" && open) return `Opens ${DATE_TIME.format(new Date(open))}`;
  if ((status === "open" || status === "full") && close) return `Closes ${DATE_TIME.format(new Date(close))}`;
  return "";
}

export function competitorsLabel(competition: UpcomingCompetition): string {
  return competition.competitor_limit === null
    ? `${competition.accepted_registrations} / no limit`
    : `${competition.accepted_registrations} / ${competition.competitor_limit}`;
}
