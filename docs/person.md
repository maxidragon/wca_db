# Person

The **Person** navigation tab (`/person`) takes a WCA ID and shows what one competitor’s results say about them: their personal bests with world, continental and national ranks; every result they have, by event or by competition; every competition they have results from; every competition they have delegated or organized; the competitors they have shared the most competitions with; their most visited venues and cities; every country they have competed in; and their competitions per year. Alongside those it counts competitions, countries, events, successful and attempted solves, finals medals, records by scope, and their longest streak of competitions with a personal record.

## How results are counted

Medals count official finals whose single was successful, so a final nobody solved is not a podium; a round won before the final is not a medal either. Records count the world, continental and national markers on both the single and the average of a result. Venue names are the labels of the links the export stores, so the same hall groups together whatever the link says. Competitions are those with results — an upcoming registration is not one. The competition table shows events and rounds as competed in / total at the competition, counting recorded results (including DNF/DNS). Each distinct event and round-type pair counts as one round, regardless of how many people entered it. Attendance shared with another competitor counts competitions, not results. Each competition also counts the personal records it set: an event's single or average counts when its best there beats every earlier competition, a competitor's first valid result included, and at most once per competition however many rounds improved it. The longest PR streak is the most consecutive competitions that each set at least one.

## Layout

The counts sit above five tabs, the open one kept in the URL as `tab=…` and left out for the first:

- **Overview**: personal bests, then the competitors met most, competitions per year, the most visited venues and cities, and the countries competed in.
- **Results** (`tab=results`): every result, grouped by event (the default) or by competition (`by=competition`), optionally narrowed to one event (`event=333`). Each row shows the round, place, single, average and every attempt. A single or average is bold when it was a personal record when set: it beat every earlier one, an earlier round of the same competition included, and a competitor's first valid result counts. Official record markers appear beside the result. The list is loaded the first time the tab opens, not with the profile.
- **Competitions**, **Delegated** and **Organized** (`tab=competitions`, `tab=delegated`, `tab=organized`): the three competition lists, each with its count.

## Competition lists

Every row in the Competitions, Delegated and Organized tabs carries its number in that list, counted oldest first and by ID within a day, the order the Achievements page counts milestones in. Delegated and organized competitions come from the assignments of the WCA account linked to the WCA ID, not from results, so someone who never competed there still has them listed. Cancelled competitions and those that have not started yet do not count, as on Competitions Together.

## API

The API exposes an authenticated `GET /api/person?wca_id=…`, which answers everything but the Results tab in one response: an unknown ID returns 404, a malformed one 400. Each of `competitions` carries its `number`, and `delegated` and `organized` list `id`, `name`, `start_date`, `city_name`, `country_id`, `country_name` and `number`, newest first.

`GET /api/person/results?wca_id=…` answers the Results tab as `{ results }`, with the same 400 and 404. Results run newest competition first, then in the official event order, the final before the rounds leading to it. Each result carries its competition (`competition_id`, `competition_name`, `start_date`, `country_name`), its event (`event_id`, `event_name`, `event_rank`), `round_type_id`, `round_order` (qualification 0 to final 5), `pos`, `best`, `average`, `attempts`, `single_record`, `average_record`, `single_pr` and `average_pr`.

## Performance

The profile reads `statistics_entries` for attendance and solves, so it returns 503 naming the script to run until that table exists. The heaviest competitor in the export, with more than four hundred competitions, costs a few hundred milliseconds: every query is keyed by the competitor, and the shared-competition count reads the entry table competition-first, which its primary key orders. The results endpoint does not read `statistics_entries`: it reads the competitor's results and their attempts by person, and needs no 503.
