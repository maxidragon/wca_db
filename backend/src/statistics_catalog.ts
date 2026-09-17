export type Filter =
  | "region"
  | "gender"
  | "year"
  | "events"
  | "event"
  | "type"
  | "pos"
  | "include_dnf";

export const STATISTICS = [
  {
    id: "sum-of-ranks",
    name: "Sum of ranks",
    description:
      "Add regional ranks across selected events. Missing events receive the last regional rank plus one. Gender filters the leaderboard without recalculating event ranks.",
    filters: ["region", "gender", "events", "type"],
  },
  {
    id: "sum-of-country-ranks",
    name: "Sum of country ranks",
    description:
      "Rank countries by the sum of their best competitor’s world rank in each selected event. Missing events receive the last world rank plus one.",
    filters: ["gender", "events", "type"],
  },
  {
    id: "medal-collection",
    name: "Medal collection",
    description:
      "Final-round medals, ordered by gold, then silver, then bronze. Select one event for the per-event collection.",
    filters: ["region", "gender", "year", "events"],
  },
  {
    id: "top-100",
    name: "Top 100 results",
    description:
      "The fastest 100 individual attempts or round averages, including ties at 100th place and repeated results by the same person.",
    filters: ["region", "gender", "year", "event", "type"],
  },
  {
    id: "top-100-appearances",
    name: "Top 100 appearances",
    description:
      "Count each competitor’s appearances among the top 100 results, including ties at the cutoff.",
    filters: ["region", "gender", "year", "event", "type"],
  },
  {
    id: "best-podiums",
    name: "Best podiums",
    description:
      "Rank official final-round podiums by combined results in the event’s preferred format. Region refers to the competition location. Fewest Moves uses successful-attempt means; Multi-Blind also displays points.",
    filters: ["region", "year", "event"],
  },
  {
    id: "records-person",
    name: "Records set by competitors",
    description:
      "Count official single and average record flags. Score: world record 10, continental record 5, national record 1.",
    filters: ["region", "gender", "year", "events"],
  },
  {
    id: "records-competition",
    name: "Records set at competitions",
    description:
      "Count official record flags at competitions in the selected region. Score: WR 10, CR 5, NR 1.",
    filters: ["region", "gender", "year", "events"],
  },
  {
    id: "oldest-standing-records",
    name: "Oldest standing records",
    description:
      "Current regional records, ordered by when each holder first achieved the result. Gender filters record holders without redefining regional records. Age is measured at the database export date.",
    filters: ["region", "gender", "events", "type"],
  },
  {
    id: "most-competitions",
    name: "Most competitions",
    description:
      "Distinct competitions attended, including unsuccessful results. Region uses the competitor’s country at the time of the result.",
    filters: ["region", "gender", "year", "events"],
  },
  {
    id: "most-persons",
    name: "Most persons in a competition",
    description:
      "Distinct competitors with results at each competition. Region refers to the competition location.",
    filters: ["region", "gender", "year", "events"],
  },
  {
    id: "most-solves",
    name: "Most personal solves",
    description:
      "Successful individual attempts, with fewer attempts breaking ties. Choose a year for the yearly leaderboard; DNF and DNS count as attempts.",
    filters: ["region", "gender", "year", "events"],
  },
  {
    id: "most-solves-person-competition",
    name: "Most personal solves in one competition",
    description:
      "Each competitor’s highest successful solve count at one competition, with fewer attempts breaking ties.",
    filters: ["region", "gender", "year", "events"],
  },
  {
    id: "most-solves-competition",
    name: "Most solves in one competition",
    description:
      "Successful individual attempts by all competitors at each competition. Region refers to the competition location.",
    filters: ["region", "gender", "year", "events"],
  },
  {
    id: "uncrowned-kings",
    name: "Uncrowned kings",
    description:
      "Best competitors who have never won a successful final in this event and region, ranked in the event’s preferred format.",
    filters: ["region", "gender", "event"],
  },
  {
    id: "podium-missers",
    name: "Podium missers",
    description:
      "Best competitors who have never earned a successful final podium in this event and region, ranked in the event’s preferred format.",
    filters: ["region", "gender", "event"],
  },
  {
    id: "record-missers",
    name: "Record missers",
    description:
      "Best competitors who have never set an official record of the selected result type in this event and region.",
    filters: ["region", "gender", "event", "type"],
  },
  {
    id: "all-events-achiever",
    name: "All events achiever",
    description:
      "Competitors with a successful single and every available average in all current events, ranked by days from first competition to completion.",
    filters: ["region", "gender"],
  },
  {
    id: "most-pos",
    name: "Most nth place",
    description:
      "Count second or fourth places across all rounds. Select one event for per-event standings; optionally include unsuccessful rounds.",
    filters: ["region", "gender", "year", "events", "pos", "include_dnf"],
  },
] satisfies {
  id: string;
  name: string;
  description: string;
  filters: Filter[];
}[];
