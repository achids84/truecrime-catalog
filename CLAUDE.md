# truecrime-catalog

Static Stremio addon (true crime documentaries). A Node build script reads TMDB and writes `dist/`; GitHub Pages hosts it; Actions rebuilds every 6 hours.

## Rules
- Zero runtime dependencies. Node >= 20.6. Tests use `node:test`, ESM.
- Tests make no network calls (inject a mock `fetch`). The build calls only `api.themoviedb.org`.
- Secret: `TMDB_TOKEN` (TMDB v4 Read Access Token) from env or gitignored `.env.local`. Never log it, never print URLs carrying a key, never commit it.
- A failed build must exit non-zero and write nothing to `dist/`.
- `data/idmap.json` and `data/tvdates.json` (series first/last air dates, status-keyed refresh) are committed; everything else generated is not.
- Catalogues: only `tc-trending` and `tc-new` per type (Popular was removed in 0.1.1; do not reintroduce `tc-popular`). Discover passes: P (popularity) and New (release date), plus a series-only Recent pass (`air_date.gte` 120 days) that widens the New pool and never touches Trending. Series tc-new sorts by `sortDate` (last air date, else first air date); `item.date` is never changed.
- Paging: besides the base file, write `skip=N.json` for every N that is a multiple of 10 and below the list size (GameDay keeps 30 cards per rail: skip 30, 130, 230). Version 0.1.3.
- Commit per step; add files by name, never `git add -A`.

## Layout
- `src/tmdb.js` client + retry; `src/idmap.js` id cache; `src/tvdates.js` series date cache; `src/universe.js`, `src/lists.js`, `src/meta.js`; `src/writer.js`; `src/build.js` entry.
- `scripts/serve.js` local server for `dist/`.
