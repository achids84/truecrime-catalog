# truecrime-catalog

Static Stremio addon (true crime documentaries). A Node build script reads TMDB and writes `dist/`; GitHub Pages hosts it; Actions rebuilds every 6 hours.

## Rules
- Zero runtime dependencies. Node >= 20.6. Tests use `node:test`, ESM.
- Tests make no network calls (inject a mock `fetch`). The build calls only `api.themoviedb.org` and, for tc-recent dates, `v3-cinemeta.strem.io` (no credentials sent; the token goes only to TMDB).
- Secret: `TMDB_TOKEN` (TMDB v4 Read Access Token) from env or gitignored `.env.local`. Never log it, never print URLs carrying a key, never commit it.
- A failed build must exit non-zero and write nothing to `dist/`.
- `data/idmap.json` and `data/tvdates.json` (series first/last air dates for tc-recent, status-keyed refresh) are committed; everything else generated is not.
- Catalogues (0.1.7): movie `[tc-trending, tc-new]`; series `[tc-recent, tc-trending]` in that order, with no series `tc-new` output (no manifest entry, no files; its New pool still feeds tc-recent). Series `tc-recent` "New episodes" (Popular was removed in 0.1.1; do not reintroduce `tc-popular`). Discover passes: P (popularity) and New (release date), plus a series-only Recent pass (`air_date.gte`, `RECENT_DAYS` = 90) that feeds only tc-recent. Extra sets (`EXTRA_KEYWORD_SETS` in `src/universe.js`: genre 99 AND keyword 210662 cold case tv+movie, 10714 serial killer tv+movie, 9826 murder tv only) run in the same passes and feed tc-new and tc-recent only, never Trending membership or padding. tc-trending must stay byte-identical to main's output (same mocked TMDB, extras on or off); tc-recent = union of all series pools, key `sortDate` = the later of TMDB `last_air_date` and the Cinemeta newest released episode (season >= 1, not future; Cinemeta only for series that are not Ended or Canceled), else first air date, within 90 days, cap 100. A failed Cinemeta request never fails the build (cached date, else TMDB). `item.date` is never changed.
- Paging: besides the base file, write `skip=N.json` for every N that is a multiple of 10 and below the list size (GameDay keeps 30 cards per rail: skip 30, 130, 230). Version 0.1.6.
- Exclusion list: `config/exclude.json` (`movie`, `series` TMDB ids, `names` for reading) is applied to every pool before any list is built; an invalid file fails the build before any request (`npm run check-exclude`). The 0.1.6 keyword sets (6019, 2149, 10175, 10291, 208458 tv+movie; 294521 tv) have `passes: ['new', 'recent']`: no popularity pass.
- Commit per step; add files by name, never `git add -A`.

## Layout
- `src/tmdb.js` client + retry; `src/idmap.js` id cache; `src/tvdates.js` series date cache; `src/cinemeta.js` Cinemeta client; `src/universe.js`, `src/lists.js`, `src/meta.js`; `src/writer.js`; `src/exclude.js` exclusion loader; `src/build.js` entry.
- `scripts/serve.js` local server for `dist/`.
