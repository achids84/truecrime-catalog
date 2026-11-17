# ADDON-1: static true crime catalogue addon

Branch `addon-1`. Status: built and unit-tested against a mocked TMDB only. Not yet run against the real TMDB API. Not yet tested on a device. Not yet deployed.

## Delivered

Steps 1 to 6 of the brief: skeleton, TMDB client with retry, IMDb id map, universe and list builders, dist writer with the failure rule, local server, workflow, docs, tests.

## Dependencies

None at runtime and none for development. Node built-ins only (`fetch`, `node:test`, `node:http`, `node:fs`). Nothing to justify.

## Decisions and deviations

- **Null recheck dates.** The brief fixes the idmap value as `"tt..."` or `null`, which cannot carry a date. Null checks are dated under one reserved top-level key `_nullChecked` in the same file. Entry keys keep the `movie:123` / `tv:456` shape. Consumers iterating all keys must skip `_nullChecked`.
- **IMDb filter comes first.** Items without an IMDb id are removed from the universe before the lists are built, so list sizes, the 20 item rule and Trending padding all count only usable items. `skippedNoImdb` in status.json counts universe items dropped for this reason.
- **IMDb lookups for the whole universe.** Up to about 400 items per type on the first run, only new items afterwards. One request each, at most 10 at a time.
- **Duplicate IMDb ids.** Two TMDB ids sharing one IMDb id appear once per catalogue.
- **Missing optional fields.** `releaseInfo` and `description` are left out when TMDB gives no date or overview, rather than invented.
- **status.json `padded`** is an object by type (`{ "movie": n, "series": n }`).
- **Paging.** Three files per catalogue always exist; tail pages of short lists contain `{"metas":[]}`.
- **dist/ write.** Written to `dist.tmp-<pid>` and swapped in, so a crash cannot leave a half-written `dist/`. The idmap is saved before the failure rule runs (it is a cache, not output); in CI a failed build never reaches the commit step.
- **Workflow.** Two jobs: `build` has `contents: write` (idmap commit), `deploy` has `pages: write` and `id-token: write`. Top level permissions are empty. Action versions are major tags (`@v4` etc.), not pinned to commit SHAs.
- **`npm test`** is `node --test` with no path, which works on Node 20 and later.
- **serve test** binds a loopback port (127.0.0.1) only.

## Not verified

- Any real TMDB response shape, keyword id 33722, rate limits, or the real size of the universe.
- That a real run yields at least 20 items in every catalogue.
- GitHub Actions, Pages deployment, and the `access-control-allow-origin` header on GitHub Pages.
- Stremio installing the addon and rendering the catalogues on any device.
- `npm run build` with a real `.env.local` token (only the missing-token path was exercised). `--env-file-if-exists` was avoided because it needs Node 20.18 or newer; the local script uses `--env-file`, CI uses `build:ci`.
