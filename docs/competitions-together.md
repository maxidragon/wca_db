# Competitions Together

The **Competitions Together** navigation tab (`/competitions-together`) takes two WCA IDs and lists every competition both competitors have results from, newest first, and every podium they stood on together.

A podium together is a final round of one event where both placed in the top three with a successful single, the same rule the Person page uses for medals. A top-three place without a successful result is not a podium.

Unlike Relations, every competition counts here, including those held in several places at once.

## API

`GET /api/competitions-together?wca_id1=…&wca_id2=…` (authenticated) returns `person1` and `person2` with their names, `competitions` (`id`, `name`, `start_date`), and `podiums` (`competition_id`, `competition_name`, `start_date`, `event_id`, `event_name`, and each one's place as `pos1` and `pos2`). A missing or malformed WCA ID returns 400, an unknown one 404.

Dates leave the database already formatted as `YYYY-MM-DD`. The driver would otherwise turn a `DATE` into local midnight, which serialises as the previous day east of UTC.
