# ADDON-5h: drug, trafficking and organized crime sets, and an exclusion list

Branch `addon-5h`, from `main` at 6a5b52f. Unit-tested against a mocked TMDB (99 tests), plus real builds to scratch folders. Not pushed, not deployed.

## Change

- `src/universe.js:14-27`: six new entries in `EXTRA_KEYWORD_SETS`, each with genre 99: human trafficking 6019, drug trafficking 2149, drug cartel 10175, organized crime 10291, trafficking 208458 (tv and movie), smuggling 294521 (tv only). New field `passes` (default all three; the new sets use `NEW_ONLY_PASSES = ['new', 'recent']`). `runsIn` (line 28) filters on it in `buildExtraPass` and `buildExtraRecentPass`. The new sets make no popularity request. `build.js` needed no wiring: it already calls those functions.
- `src/exclude.js`, `config/exclude.json`: `{"movie": [ids], "series": [ids], "names": {"<id>": "<title>"}}`. `names` is for reading only. A missing file excludes nothing. `src/build.js:35` loads it before any request, and `src/build.js:56-60` drops excluded ids from every pool (P, New, Recent, extras, trending) before any list is built, so a freed Trending slot is padded by the existing rule.
- Validation: invalid JSON, an unknown key, or an id that is not a positive integer throws `ExcludeError` with a plain message. The build exits non-zero before it makes a request or writes anything, and the workflow's `deploy` job needs `build`, so the live site stays on the last good build. `npm run check-exclude` (`scripts/check-exclude.js`) runs the same check with no token.
- Seeded with 14 movies and 4 series (all found).
- `package.json` 0.1.5 to 0.1.6.

## Scope kept

No back-catalogue rail. A title shows only if it fits within `tc-new`'s cap of 300 or has a recent episode. Because `tc-new` is already full, new titles push the oldest ones out.

## Limits

Excluding by TMDB id only. A title with two TMDB ids needs both listed.
