# ADDON-5b / 5c: series recent episodes

Branch `addon-5b`, from `main` at 10833c6. Unit-tested against a mocked TMDB plus one real build to a scratch directory. Not deployed. Not pushed.

## Problem

`tc-new` for series was ordered by first air date, so a show with a new season airing now stayed buried (ADDON-5a: Harlan Coben's Final Twist at rank 108, Toxic at 174). The pool came only from discover sorted by first air date, so such shows could also be missing.

## Change (5b; parts superseded, see the 5c section: tc-new sort reverted, window 90 days)

- `src/tvdates.js` (new): `/tv/{id}` lookup and cache in `data/tvdates.json` (`first_air_date`, `last_air_date`, `status`, `checkedAt`). Ended and Canceled are cached for good, other statuses and missing entries are fetched every build. A failed lookup keeps the cached entry or none; it never throws.
- `src/universe.js`: `buildRecentPass` (tv only): `air_date.gte` = today minus 120 days, same genre/keyword sets, popularity, 3 pages per query. `unionById`. The pass is not part of the Trending union.
- `src/lists.js`: `buildNew` sorts by `sortDate` when present, else `date`. Ties by popularity. Movies have no `sortDate`, so they are unchanged.
- `src/build.js`: wires the pass, lookup and `sortDate` (last air date, else first air date) for series only; `status.json` gets `seriesNew`; the New contribution count gets a `Recent` key (series only).
- `.github/workflows/build.yml`: the "Commit caches" step commits `data/idmap.json` and `data/tvdates.json`.
- `package.json` 0.1.2 to 0.1.3 (the only place; the manifest reads it).
- `item.date` and every card field are unchanged. Paging files and names are unchanged.

## Side effect to know about

The recent pass also pulls in long-running series (news magazines and similar) whose latest episode is recent. They enter tc-new and rank high.

## ADDON-5c: tc-new restored, tc-recent added

The 5b sort put 17 weekly or long-running shows (Dateline, 48 Hours, ...) into the top 30 of tc-new, so 5c reverses it. Commits on top of 35d4873, no history rewrite.

- `tc-new` (series and movie), `tc-trending` and every movie file are byte-identical to main (10833c6) against the same mocked TMDB. `buildNew` is main's again; the recent pass and the date cache do not feed it.
- New series-only catalogue `tc-recent`, name "New episodes", after `tc-new` in the manifest. Input: union of the New pass, pass P and the recent pass by TMDB id. Key `sortDate` = `last_air_date`, else `first_air_date`. Only titles whose key is within `RECENT_DAYS` = 90 days (and not in the future), ties by popularity, capped at 100 (`buildRecent` in `src/lists.js`).
- `RECENT_DAYS` (`src/universe.js`) is one constant: 120 to 90 for the recent discover pass and the tc-recent window.
- Cache rule unchanged: Ended and Canceled are cached for good, everything else is refreshed each build; a failed lookup keeps the cached value or falls back to `first_air_date` and never fails the build.
- `tc-recent` is exempt from the 20-title failure rule. `status.json` has a `series/tc-recent` count and a `seriesNew` block (recentAdded, lookups, lookupsFailed, recentBeforeCap, recentKeyFromFirst).
- Version stays 0.1.3. No workflow change in 5c. The landing page text (`index.html`) still says two catalogues per type.

Note that tc-recent includes weekly and long-running shows by design; it is a recent-episode view, not a new-show view.
