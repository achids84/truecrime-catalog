# truecrime-catalog

Static Stremio addon (true crime documentaries). A Node build script reads TMDB and writes `dist/`; GitHub Pages hosts it; Actions rebuilds every 6 hours.

## Rules
- Zero runtime dependencies. Node >= 20.6. Tests use `node:test`, ESM.
- Tests make no network calls (inject a mock `fetch`). The build calls only `api.themoviedb.org`.
- Secret: `TMDB_TOKEN` (TMDB v4 Read Access Token) from env or gitignored `.env.local`. Never log it, never print URLs carrying a key, never commit it.
- A failed build must exit non-zero and write nothing to `dist/`.
- `data/idmap.json` is committed; everything else generated is not.
- Commit per step; add files by name, never `git add -A`.

## Layout
- `src/tmdb.js` client + retry; `src/idmap.js` id cache; `src/universe.js`, `src/lists.js`, `src/meta.js`; `src/writer.js`; `src/build.js` entry.
- `scripts/serve.js` local server for `dist/`.
