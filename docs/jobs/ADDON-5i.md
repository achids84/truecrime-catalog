# ADDON-5i: Series tab is New episodes, then Trending

Branch `addon-5i`, from `main` at 832689a. 99 tests. Not pushed, not deployed.

## Change

- `src/writer.js:12-19`: `catalogsFor('series')` is `[tc-recent, tc-trending]`; movies stay `[tc-trending, tc-new]`. `assertMinimums` checks a `REQUIRED` list (movie: trending, new; series: trending only), so series tc-recent stays exempt from the 20-title rule and series tc-new is no longer required. `buildStatus` and `planOutput` follow `catalogsFor`, so no series tc-new file (base or skip pages) is written, and `dist/` is replaced whole, so none is left behind.
- `src/build.js`: series `tc-new` is no longer put in `catalogs` or `contributions`. The New pass, popularity pass, recent pass and extra sets are unchanged; tc-recent still takes the union of all pools. Exclusions still apply.
- Landing page text in `renderIndexHtml` (`src/writer.js`) names the catalogues per type.
- `package.json:3` 0.1.6 to 0.1.7.

## Checks

Same recorded TMDB and Cinemeta responses replayed through main and this branch: every `catalog/movie/**`, `catalog/series/tc-trending/**` and `catalog/series/tc-recent/**` file is byte-identical. Only `manifest.json`, `index.html`, `status.json` differ, and the `catalog/series/tc-new` files are gone.

## Limits

Request count per build is unchanged: the series New pass is still needed for tc-recent.
