# Achievements

The **Achievements** navigation tab (`/achievements`) takes a competition, found by searching its name or ID, and lists the milestones people reach there:

- **Competitions attended:** competitors attending their 100th, 150th, 200th, … up to 400th competition.
- **Competitions delegated:** Delegates of this competition delegating their 100th, 150th, … up to 400th.
- **Successful attempts:** competitors whose career count of successful attempts crosses 1,000, 2,137, 5,000, 10,000, 15,000, 20,000, 21,370 or 25,000 during the competition.
- **Competitions together:** pairs of competitors reaching their 100th, 150th or 200th shared competition.

The competition is kept in the URL as `competition_id`, so a page can be linked.

## Finished and upcoming competitions

For a competition that has ended, everything comes from published results and Delegate assignments. Competitions are ordered by start date, and by ID within a day, so two competitions on the same day count in a fixed order. Cancelled competitions are never counted.

For a competition that has not ended yet (including one in progress), the page projects: "Likely to attend" and "Likely to delegate". The roster is its accepted, competing registrations. A competitor's count adds every other accepted registration for a competition that has not ended and starts before this one. Successful attempts are estimated: each registered event contributes its first round's number of attempts, times the competitor's historical share of successful attempts, so these milestones are marked as estimates.

## API

`GET /api/competitions/search?q=…` (authenticated) returns up to 20 announced competitions whose ID or name contains the term, exact and prefix ID matches first, then those closest to today. The term must be 2–100 characters, otherwise 400. `with_qualifications=1` limits it to competitions with qualification requirements; the Qualifications page uses it.

`GET /api/achievements?competition_id=…` (authenticated) returns `competition`, whether the result is `projected`, `roster_size`, the four milestone lists (`competition_milestones`, `delegate_milestones`, `successful_attempt_milestones` with the count before and after and whether it is `estimated`, and `together_milestones`), and a `methodology` sentence describing how it was computed. A missing ID, or one over 32 characters, returns 400; an unknown competition 404.

## Performance

Everything is computed on request from `results`, `result_attempts`, `registrations` and `competition_delegates`, without a derived table. Only the competition's own roster is counted, and pairs are only looked for among roster members with at least 100 competitions, since nobody else can reach a together milestone.
