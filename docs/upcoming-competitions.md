# Upcoming Competitions

The **Upcoming** item in the Competitions menu (`/upcoming-competitions`) lists every announced competition that has not ended yet, including those in progress, as a table or on an OpenStreetMap map. Cancelled competitions are left out. Every filter is kept in the URL, so a view can be shared, and applies as soon as it changes.

## Filters

- **Search:** a part of the competition's name or city.
- **Region:** World, a continent or a country, as on the other pages. A multi-location competition (country `XE`, `XA`, …) belongs to its continent.
- **Starting from / until:** the competition's start date falls within the range.
- **Events:** the competition holds every selected event.
- **Championships:** include them (default), exclude them, or show only them. A championship is any row in `championships`: world, continental, national or a group of countries such as Greater China.
- **Competitor limit:** a minimum and a maximum for the limit. A competition without a limit has no number to compare, so either bound leaves it out.
- **Registration:** any of not open yet, open, full and closed. None selected means any.
- **Only countries I have not competed in:** shown to a competitor with a WCA ID. It leaves out every country they have a result in, judged by where the competition was held, and multi-location competitions, which are not in one country.

## Registration status

The status is worked out the way the WCA website does it, in its order: before `registration_open` it is not open yet, after `registration_close` it is closed, then it is full when the accepted, competing registrations reach the competitor limit, and otherwise open. The export does not say who is waiting to pay, so full counts accepted registrations only, and the counts are as old as the export: up to a day. The times come from the export in UTC and are shown in the viewer's time zone.

## Map

The map uses Leaflet with OpenStreetMap tiles, loaded only when the map is opened. A marker's colour is its registration status, and a championship gets a dark ring. It zooms to the competitions shown whenever the filters change them. A competition whose venue has no coordinates (stored as 0, 0) is only in the list, and the map says how many.

## API

`GET /api/upcoming-competitions/options` (authenticated) returns `regions` (World, continents, countries without the multi-country regions) and `events` (current events, in order).

`GET /api/upcoming-competitions` (authenticated) takes `q` (at most 100 characters), `region`, `from` and `to` (`YYYY-MM-DD`), `events` (comma-separated, all required), `championships` (`include`, `exclude` or `only`), `min_limit` and `max_limit` (whole numbers), `registration` (comma-separated `not_open`, `open`, `full`, `closed`) and `new_countries=1`. It returns every match ordered by start date, without pagination, as `competitions` with `total`, `viewer_wca_id`, and `competed_countries` (how many countries the viewer has competed in, when `new_countries=1`). A malformed or unknown value returns 400, and so does `new_countries=1` from an account without a WCA ID, such as the service token.

## Performance

Upcoming competitions are a few thousand rows at most. They are read once per export and day, with their events, accepted registration counts and championships, in four queries, and every filter is applied in memory; the status is worked out per request, so it follows the clock between imports. The countries a competitor has competed in are one read of their results by `person_id`.
