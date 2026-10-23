# Nemeses

The **Nemeses** navigation tab (`/nemeses`) takes a WCA ID and lists every competitor who holds a better official world rank than them in every single and every average they hold a rank in, the definition [Nemesizer](https://www.nemesizer.com/) uses. An event the competitor has no average in asks only for a better single. An equal rank is an equal result, so a tie is not a nemesis. Ranks come from the official `ranks_single` and `ranks_average` tables, so deprecated events a competitor still holds a rank in count too. The region switch limits the list to nemeses from the competitor's current continent or country and shows the count for each.

## API

The API exposes an authenticated `GET /api/nemeses?wca_id=…&region=world|continent|country&page=…`, returning 100 nemeses a page ordered by name, with the counts for all three regions. An unknown ID returns 404; a malformed ID, region or page returns 400.

## Performance

The query starts from the competitor's best world rank, which caps the candidates at that many people, and checks each candidate's other ranks by person. A world-class competitor costs milliseconds; a beginner, with nemeses numbering in the hundreds of thousands, costs about a second. Both read `rank_indexes.sql`, which orders each rank table by event and world rank. The import builds those indexes, and every deploy runs the file too. It is idempotent, so it only does work on a database imported before the indexes existed. The ranks export can be newer than the developer dump, so a nemesis without a person row yet is listed under the world by WCA ID.
