# ADDON-4: page files for every multiple of 10

Branch `addon-4`, from `main` at 89f99bf. Status: unit-tested against a mocked TMDB, plus one real build. Not yet deployed. Not yet tested on a device.

## Problem

The GameDay app keeps 30 cards per rail, then asks a catalogue for the next page with skip equal to the cards it holds: first skip=30, then skip=130 (30 plus a 100-title page), then skip=230. The addon only had files for skip=100 and skip=200, so the app got 404 and stopped (seen on the TV: `od.error code=404`). Stremio apps use skip=100 and skip=200.

## Change

- `src/writer.js`: the base file (`catalog/<type>/<id>.json`) is the first 100 titles. Every skip that is a multiple of 10 and below the list size gets `catalog/<type>/<id>/skip=<N>.json` with up to 100 titles from offset N, in list order. `PAGES` is replaced by `SKIP_STEP = 10`; `PAGE_SIZE` stays 100.
- No page at or beyond the list size, none for a skip that is not a multiple of 10. A 404 is the end of the list for the app. Short lists no longer get an empty `skip=200.json`.
- Base, `skip=100.json` and `skip=200.json` are byte-identical to before for lists long enough to have them.
- Manifest unchanged except `version` 0.1.1 to 0.1.2 (package.json). No new dependency, no workflow change.
- Lists are no longer capped at 300 titles by the writer.

## Limit

Steps of 10 only work while GameDay's card limit is a multiple of 10. If it changes to a number that is not, skip values stop matching files and paging breaks again.
