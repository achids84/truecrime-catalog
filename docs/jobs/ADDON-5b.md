# ADDON-5b: series New sorted by last air date

Branch `addon-5b`, from `main` at 10833c6. Unit-tested against a mocked TMDB plus one real build to a scratch directory. Not deployed. Not pushed.

## Problem

`tc-new` for series was ordered by first air date, so a show with a new season airing now stayed buried (ADDON-5a: Harlan Coben's Final Twist at rank 108, Toxic at 174). The pool came only from discover sorted by first air date, so such shows could also be missing.

## Change

- `src/tvdates.js` (new): `/tv/{id}` lookup and cache in `data/tvdates.json` (`first_air_date`, `last_air_date`, `status`, `checkedAt`). Ended and Canceled are cached for good, other statuses and missing entries are fetched every build. A failed lookup keeps the cached entry or none; it never throws.
- `src/universe.js`: `buildRecentPass` (tv only): `air_date.gte` = today minus 120 days, same genre/keyword sets, popularity, 3 pages per query. `unionById`. The pass is not part of the Trending union.
- `src/lists.js`: `buildNew` sorts by `sortDate` when present, else `date`. Ties by popularity. Movies have no `sortDate`, so they are unchanged.
- `src/build.js`: wires the pass, lookup and `sortDate` (last air date, else first air date) for series only; `status.json` gets `seriesNew`; the New contribution count gets a `Recent` key (series only).
- `.github/workflows/build.yml`: the "Commit caches" step commits `data/idmap.json` and `data/tvdates.json`.
- `package.json` 0.1.2 to 0.1.3 (the only place; the manifest reads it).
- `item.date` and every card field are unchanged. Paging files and names are unchanged.

## Side effect to know about

The recent pass also pulls in long-running series (news magazines and similar) whose latest episode is recent. They enter tc-new and rank high.
