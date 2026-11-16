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
  number: number;
}

export interface StaffedCompetition {
  id: string;
  name: string;
  start_date: string;
  city_name: string;
  country_id: string;
  country_name: string;
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

export interface PersonResult {
  competition_id: string;
  competition_name: string;
  start_date: string;
  country_name: string;
  event_id: string;
  event_name: string;
  event_rank: number;
  round_type_id: string;
  round_order: number;
  pos: number;
  best: number;
  average: number;
  attempts: number[];
  single_record: string;
  average_record: string;
  single_pr: boolean;
  average_pr: boolean;
}

export const RESULT_GROUPINGS = ["event", "competition"] as const;
export type ResultGrouping = (typeof RESULT_GROUPINGS)[number];

/** The results list is loaded on demand: null until it arrives or fails. */
export interface ResultsState {
  results: PersonResult[] | null;
  error: string | null;
}
