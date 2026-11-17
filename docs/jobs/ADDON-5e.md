# ADDON-5e: extra keyword discover sets

Branch `addon-5e`, from `main` at 742b351. Unit-tested against a mocked TMDB, plus real builds to scratch folders. Not deployed.

## Problem

Network true crime shows that TMDB tags with neither genres 99+80 nor keyword 33722 were missing from the pool.

## Change

- `src/universe.js`: `EXTRA_KEYWORD_SETS` (id, name, types), one line per keyword. Each set is a discover query with `with_genres=99` and its keyword: cold case 210662 (tv, movie), serial killer 10714 (tv, movie), murder 9826 (tv only). `buildExtraPass` (New, P) and `buildExtraRecentPass` (tv) use the same sorts, date filter, page caps (10, recent 3) as the 33722 set. Results are deduped by TMDB id.
- `src/build.js`: extras feed `tc-new` (New pass) and `tc-recent` (all pools) and the IMDb id resolution. They are not in `unionIds` and not in the padding source, so `tc-trending` is built from the same inputs as main.
- `package.json` 0.1.4 to 0.1.5. No catalogue added or renamed.

## Limits

`tc-new` is capped at 300 (`MAX_ITEMS`), and with the extras both types reach it, so the oldest titles by date fall off. A title that only appears in the extras still needs a poster and an IMDb id. `status.json` contributions for tc-new and tc-recent count extra-set titles under P, New and Recent.
