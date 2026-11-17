# ADDON-3: catalogues from config/catalogues.json

Branch `addon-3`, from `main` at c0322af. Status: built and unit-tested against a mocked TMDB, and one real `npm run build` run locally (see the report for counts). Not pushed, not merged, not deployed. Not yet tested on a device.

## Change

- `config/catalogues.json` lists the catalogues: `id`, `name`, `kind` (`trending`, `new`, `discover`), `types`, `enabled`; discover entries also take `sort`, `minVotes`, `yearFrom`, `yearTo`, `language`, `genresAll`, `keywordsAll`, `limit`. A top-level `_readme` string is allowed. The shipped file has `tc-trending` and `tc-new` enabled and one disabled discover example, `tc-top-rated`.
- `src/config.js`: offline validation. Unknown fields, bad values, duplicate ids, nothing enabled and more than 8 enabled for one type are errors, each naming the entry and field. The 8 limit is because GameDay shows at most 20 rails per tab across all addons.
- `src/collect.js` turns catalogue entries into contents. `trending` and `new` keep the old code paths (passes P and New, padding, limits). `discover` is one TMDB discover query per type with the true crime keyword always ANDed in, TMDB order kept, `limit` default 100.
- Manifest and `status.json` come from the enabled catalogues; disabled ones are not in `dist/`. Each catalogue keeps `extra: [{ "name": "skip" }]`. A discover catalogue writes `floor(n/100)+1` page files (trending and new always write 3).
- `package.json` 0.1.1 to 0.2.0 (version only).
- Output with the shipped config is byte for byte the output of c0322af: `test/golden/shipped-output.json` holds the sha256 of every `dist/` file built from the fake TMDB by that commit.
- Helpers: `npm run check`, `npm run keywords -- "text"`, `npm run preview -- <id>`. See [../CONFIG.md](../CONFIG.md).
- Workflow: `npm run check` runs before the build.

## Workflow behaviour

The `deploy` job has `needs: build`, and the build job has no `continue-on-error`, so a failing check or build step fails the job, the upload step never runs and the deploy job is skipped. The live site is unchanged. The push trigger is `branches: [main]` with no path filter, so edits to `config/**` trigger it. `test/workflow.test.js` pins this.

## Notes

- A catalogue under 20 titles still fails the build (the old rule applies to discover catalogues too).
- A build that only has discover catalogues for a type skips the trending and P/New passes for it, which saves requests.
- `npm run preview` fetches missing IMDb ids but does not save `data/idmap.json`.
- The manifest `description` text is still the fixed "trending this week and new" sentence (unchanged so the output stays identical). The landing page sentence follows the enabled catalogues.

## Not verified

- GitHub Actions and Pages with this change (nothing pushed).
- Any device or app.
- How apps treat new catalogue ids appearing in an installed addon.
