# Person

The **Person** navigation tab (`/person`) takes a WCA ID and shows what one competitor’s results say about them: their personal bests with world, continental and national ranks; every competition they have results from; the competitors they have shared the most competitions with; their most visited venues and cities; every country they have competed in; and their competitions per year. Alongside those it counts competitions, countries, events, successful and attempted solves, finals medals, records by scope, and their longest streak of competitions with a personal record.

## How results are counted

Medals count official finals whose single was successful, so a final nobody solved is not a podium; a round won before the final is not a medal either. Records count the world, continental and national markers on both the single and the average of a result. Venue names are the labels of the links the export stores, so the same hall groups together whatever the link says. Competitions are those with results — an upcoming registration is not one. The competition table shows events and rounds as competed in / total at the competition, counting recorded results (including DNF/DNS). Each distinct event and round-type pair counts as one round, regardless of how many people entered it. Attendance shared with another competitor counts competitions, not results. Each competition also counts the personal records it set: an event's single or average counts when its best there beats every earlier competition, a competitor's first valid result included, and at most once per competition however many rounds improved it. The longest PR streak is the most consecutive competitions that each set at least one.

## API

The API exposes an authenticated `GET /api/person?wca_id=…`, which answers the whole page in one response: an unknown ID returns 404, a malformed one 400.

## Performance

It reads `statistics_entries` for attendance and solves, so it returns 503 naming the script to run until that table exists. The heaviest competitor in the export, with more than four hundred competitions, costs a few hundred milliseconds: every query is keyed by the competitor, and the shared-competition count reads the entry table competition-first, which its primary key orders.
