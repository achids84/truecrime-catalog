# ADDON-1: static true crime catalogue addon

## Step 7: list quality (passes)

Problem found in review: New and Popular were cut from the top 10 pages by popularity, so New could not contain recent low-popularity titles.

Change (commit f8e32fc and the status commit after it):

- Queries a and b now run in three passes of up to 10 pages each: **P** popularity.desc, **N** release date desc (`primary_release_date.desc` for movies, `first_air_date.desc` for tv, with the matching `.lte=today`), **V** vote_count.desc.
- New is built from N only (real date descending, ties by popularity). Popular is built from V only (vote_count descending, ties by popularity). P is used for Trending padding and Trending membership only.
- Trending membership: an item from `/trending/{movie|tv}/week` qualifies if `genre_ids` contains both 99 and 80, or its id is in the union of P, N and V. Trending items need a poster. Padding still uses P by popularity.desc (P items with an IMDb id).
- IMDb ids are resolved for the union of P, N, V **plus** trending titles admitted by the genre rule alone (otherwise they could never be listed). The idmap logic is unchanged.
- Cap stays 300 per catalogue; the failure rule (any catalogue under 20 fails the build) is unchanged.
- status.json adds `newestNew` (newest release date in New, per type, null if empty) and `contributions` (per catalogue: items from pass P, New, Popular; an item in several passes counts in each; `genreRule` = in no pass, admitted to Trending by genre_ids only).

### Request budget

Mocked cold run (empty idmap), asserted in `test/build.test.js`: **1963 requests** = 1 keyword + 120 discover (2 types x 3 passes x 2 queries x 10 pages) + 40 trending (2 x 20 pages) + 1802 external_ids (the mock's 901 distinct titles per type). The mock always has 50 pages, so every pass fetches the full 10.

Expected for a real first run: 161 fixed requests (1 + 120 + 40) plus one external_ids request per distinct title. That count depends on how many titles TMDB actually holds for these queries, which is not known: not yet run against the real TMDB API. Upper bound under the 10 page limits: 6 query-pass lists x 200 titles per type = at most 2400 titles across both types before overlap, plus trending titles admitted by genre; so at most roughly 2,600 to 3,000 requests. If TMDB has fewer than 10 pages for a query, fewer pages are fetched and the three passes overlap heavily, so the real number could be far lower. Later runs repeat the 161 fixed requests and resolve only new titles (and null entries older than 30 days).

Branch `addon-1`. Status: built and unit-tested against a mocked TMDB only. Not yet run against the real TMDB API. Not yet tested on a device. Not yet deployed.

## Delivered

Steps 1 to 6 of the brief: skeleton, TMDB client with retry, IMDb id map, universe and list builders, dist writer with the failure rule, local server, workflow, docs, tests.

## Dependencies

None at runtime and none for development. Node built-ins only (`fetch`, `node:test`, `node:http`, `node:fs`). Nothing to justify.

## Decisions and deviations

- **Null recheck dates.** The brief fixes the idmap value as `"tt..."` or `null`, which cannot carry a date. Null checks are dated under one reserved top-level key `_nullChecked` in the same file. Entry keys keep the `movie:123` / `tv:456` shape. Consumers iterating all keys must skip `_nullChecked`.
- **IMDb filter comes first.** Items without an IMDb id are removed before the lists are built, so list sizes, the 20 item rule and Trending padding all count only usable items. `skippedNoImdb` in status.json counts distinct titles (across the passes and trending) dropped for this reason.
- **IMDb lookups.** One request per distinct title on the first run (see the request budget above), only new titles afterwards. At most 10 at a time.
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
- That a real run yields at least 20 items in every catalogue, and the real request count.
- Whether TMDB's date sort pushes undated or placeholder-dated titles into the New pass in practice (the builder drops items without a date or dated after today, but the real data has not been seen).
- That `genre_ids` on real trending results carry 99 and 80 for true crime titles as assumed.
- GitHub Actions, Pages deployment, and the `access-control-allow-origin` header on GitHub Pages.
- Stremio installing the addon and rendering the catalogues on any device.
- `npm run build` with a real `.env.local` token (only the missing-token path was exercised). `--env-file-if-exists` was avoided because it needs Node 20.18 or newer; the local script uses `--env-file`, CI uses `build:ci`.
