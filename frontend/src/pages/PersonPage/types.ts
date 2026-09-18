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
  solves: number;
  attempts: number;
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
  };
  personal_bests: PersonalBest[];
  competitions: PersonCompetition[];
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
