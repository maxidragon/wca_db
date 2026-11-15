# Upcoming Competitions

The **Upcoming** item in the Competitions menu (`/upcoming-competitions`) lists every announced competition that has not ended yet, including those in progress, as a table or on an OpenStreetMap map. Cancelled competitions are left out. Every filter is kept in the URL, so a view can be shared, and applies as soon as it changes.

## Filters

- **Search:** a part of the competition's name or city.
- **Region:** World, a continent or a country, as on the other pages. A multi-location competition (country `XE`, `XA`, …) belongs to its continent.
- **Starting from / until:** the competition's start date falls within the range.
- **Length:** single-day or multi-day competitions.
- **Weekend:** only on a weekend, where every day of the competition is a Saturday or a Sunday, so a Friday-to-Sunday competition is left out; or includes a weekend day, where at least one day is, so Friday-to-Sunday and Sunday-to-Monday competitions count but a Friday-only one does not.
- **Distance from:** a point, taken from the browser's location or a click on the map, with an optional radius in kilometres and a sort by distance. Distances are great-circle distances to the venue. A venue without coordinates has no distance: a radius leaves it out, and the distance sort puts it last. The point is rounded to three decimals (about 100 m) before it goes into the URL, so a shared link does not give away anyone's exact location.
- **Events:** the competition holds every selected event.
- **Championships:** include them (default), exclude them, or show only them. A championship is any row in `championships`: world, continental, national or a group of countries such as Greater China.
- **Competitor limit:** a minimum and a maximum for the limit. A competition without a limit has no number to compare, so either bound leaves it out.
- **Registration:** any of not open yet, open, full and closed. None selected means any.
- **My registrations:** show all, only those the viewer is registered for, or hide them. A registration counts while it is accepted, pending or on the waiting list, so cancelled and rejected ones do not. Registrations belong to the WCA account rather than the WCA ID, so a newcomer without a WCA ID can use this too. Whatever the filter, the viewer's registrations are marked: a badge in the list, and a blue ring and a line in the popup on the map. Like the counts, they are as old as the export.
- **Only countries I have not competed in:** shown to a competitor with a WCA ID. It leaves out every country they have a result in, judged by where the competition was held, and multi-location competitions, which are not in one country.

## Registration status

The status is worked out the way the WCA website does it, in its order: before `registration_open` it is not open yet, after `registration_close` it is closed, then it is full when the accepted, competing registrations reach the competitor limit, and otherwise open. The export does not say who is waiting to pay, so full counts accepted registrations only, and the counts are as old as the export: up to a day. The times come from the export in UTC and are shown in the viewer's time zone.

## Map

The map uses Leaflet with OpenStreetMap tiles, loaded only when the map is opened. A marker's colour is its registration status, and a championship gets a dark ring. It zooms to the competitions shown whenever the filters change them. Clicking the map, anywhere but a marker, sets the point distances are measured from; the point and the radius are drawn on the map, and the map stays when nothing matches, so another point can be picked. A competition whose venue has no coordinates (stored as 0, 0) is only in the list, and the map says how many.

## API

`GET /api/upcoming-competitions/options` (authenticated) returns `regions` (World, continents, countries without the multi-country regions) and `events` (current events, in order).

`GET /api/upcoming-competitions` (authenticated) takes `q` (at most 100 characters), `region`, `from` and `to` (`YYYY-MM-DD`), `events` (comma-separated, all required), `championships` (`include`, `exclude` or `only`), `min_limit` and `max_limit` (whole numbers), `registration` (comma-separated `not_open`, `open`, `full`, `closed`), `new_countries=1`, `duration` (`any`, `single` or `multi`), `weekend` (`any`, `only` or `includes`; the old `0` and `1` still mean `any` and `only`), `near` (`latitude,longitude` in degrees), `radius_km` (1–20038, needs `near`), `sort` (`date`, or `distance`, which needs `near`) and `registered` (`all`, `only` or `hide`). With `near`, each competition carries `distance_km`, rounded to whole kilometres, or null without a venue. It returns every match ordered by start date, or by distance, without pagination, as `competitions` with `total`, `viewer_wca_id`, and `competed_countries` (how many countries the viewer has competed in, when `new_countries=1`). A malformed or unknown value returns 400, and so does `new_countries=1` from an account without a WCA ID, or `registered=only|hide` without a WCA account; the service token has neither. Each competition carries `my_registration` (`accepted`, `pending`, `waiting_list` or null), and `can_filter_registrations` says whether the viewer has a WCA account.

## Performance

Upcoming competitions are a few thousand rows at most. They are read once per export and day, with their events, accepted registration counts and championships, in four queries, and every filter is applied in memory; the status is worked out per request, so it follows the clock between imports. The countries a competitor has competed in are one read of their results by `person_id`, and the viewer's registrations one read of `registrations` by its `user_id` index, on every request.
