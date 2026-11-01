# Competitions Together

The **Competitions Together** navigation tab (`/competitions-together`) takes two WCA IDs and lists, newest first, every competition both competitors have results from, every podium they stood on together, and every competition both delegated or both organized.

A podium together is a final round of one event where both placed in the top three with a successful single, the same rule the Person page uses for medals. A top-three place without a successful result is not a podium.

Delegated and organized together come from the competition's assignments, not its results, so two people can share these lists without ever competing together. Both must hold the same role: one delegating and the other organizing is not a match. Cancelled competitions and those that have not started yet do not count. The page always shows all four tabs, with their counts, so these lists are reachable when the competitions list is empty.

Unlike Relations, every competition counts here, including those held in several places at once.

## API

`GET /api/competitions-together?wca_id1=…&wca_id2=…` (authenticated) returns `person1` and `person2` with their names, `competitions` (`id`, `name`, `start_date`), and `podiums` (`competition_id`, `competition_name`, `start_date`, `event_id`, `event_name`, and each one's place as `pos1` and `pos2`), and `delegated` and `organized` (`id`, `name`, `start_date`). A missing or malformed WCA ID returns 400, an unknown one 404.

Dates leave the database already formatted as `YYYY-MM-DD`. The driver would otherwise turn a `DATE` into local midnight, which serialises as the previous day east of UTC.
