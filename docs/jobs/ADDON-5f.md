# ADDON-5f: Cinemeta dates for tc-recent

Branch `addon-5f`, from `main` at b73a1c9. Unit-tested against a mocked TMDB and Cinemeta, plus one real build to a scratch folder. Not deployed.

## Problem

TMDB misses episode dates for some airing shows. Harlan Coben's Final Twist (tmdb 305997, tt36852013): TMDB last_air_date 2026-10-19, but Cinemeta lists S2E3 to S2E7 weekly, the latest released 2026-11-17. It sat at rank 39 in tc-recent. The Stremio TV detail page reads Cinemeta, so Cinemeta is the date the user sees.

## Change

- `src/cinemeta.js` (new): `createCinemeta` fetches `https://v3-cinemeta.strem.io/meta/series/<imdb>.json` (follows the 307, 8 s timeout, 5 at a time, no credentials). `latestReleased`: the newest `released` among videos with season >= 1 and released <= build time.
- `src/tvdates.js`: `resolveCinemeta` for series whose status is not Ended or Canceled (every build). `cinemeta_last` and `cinemetaCheckedAt` are cached per tmdb id in `data/tvdates.json`. A failed request keeps the cached value; a TMDB refresh keeps the Cinemeta fields. `sortKey`: the later of TMDB last_air_date and `cinemeta_last` (ties: tmdb), else first_air_date; source `tmdb`, `cinemeta` or `first`. Ended and Canceled ignore Cinemeta.
- `src/build.js`: wiring; `runBuild` takes `cinemetaFetch` (defaults to `fetchImpl`). `status.json` `seriesNew` has `cinemetaRequests`, `cinemetaFailed`, `cinemetaBeatTmdb`. The log has counts only.
- `package.json` 0.1.3 to 0.1.4.
- `tc-new`, `tc-trending` and every movie file are byte-identical to main (checked against the same mocked TMDB).

## Limits

The 90 day window and the 100 cap are as before. A Cinemeta date is trusted as is; a wrong Cinemeta date moves a title. The workflow is unchanged (the Action already commits `data/tvdates.json`).
