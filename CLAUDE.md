# truecrime-catalog

Static Stremio addon (true crime documentaries). A Node build script reads TMDB and writes `dist/`; GitHub Pages hosts it; Actions rebuilds every 6 hours.

## Rules
- Zero runtime dependencies. Node >= 20.6. Tests use `node:test`, ESM.
- Tests make no network calls (inject a mock `fetch`). The build calls only `api.themoviedb.org`.
- Secret: `TMDB_TOKEN` (TMDB v4 Read Access Token) from env or gitignored `.env.local`. Never log it, never print URLs carrying a key, never commit it.
- A failed build must exit non-zero and write nothing to `dist/`.
- `data/idmap.json` is committed; everything else generated is not.
- Catalogues come from `config/catalogues.json` (kinds `trending`, `new`, `discover`; validated offline by `src/config.js`, max 8 enabled per type). Shipped state, version 0.2.0: `tc-trending` and `tc-new` enabled, one disabled discover example. Popular was removed in 0.1.1; do not reintroduce `tc-popular` (the validator rejects the id). Passes for trending and new: P (popularity) and New (release date).
- The workflow runs `npm run check` before the build; a failed check or build must never reach the deploy job.
- Commit per step; add files by name, never `git add -A`.

## Layout
- `src/tmdb.js` client + retry; `src/idmap.js` id cache; `src/config.js` config validation; `src/universe.js`, `src/lists.js`, `src/meta.js`; `src/collect.js` catalogue contents; `src/writer.js`; `src/build.js` entry; `src/tools.js` helper logic.
- `scripts/serve.js` local server for `dist/`; `scripts/check.js`, `keywords.js`, `preview.js` helpers. `test/golden/shipped-output.json` pins the output of the shipped config; docs: `docs/CONFIG.md`.
