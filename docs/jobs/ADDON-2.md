# ADDON-2: remove the Popular catalogues

Branch `addon-2`, from `main` at a6dc773. Status: built and unit-tested against a mocked TMDB only. Not yet run against the real TMDB API. Not yet tested on a device. Not yet deployed.

## Change

- Manifest: `tc-popular` removed for movie and series. Four catalogues remain: `tc-trending` and `tc-new` for each type. `package.json` version 0.1.0 to 0.1.1 so apps see the manifest change.
- Build: the Popular discover pass (`vote_count.desc`) and `buildPopular` are gone. The passes are P (`popularity.desc`) and New (release date descending, up to today). `buildPass` throws for any other pass name.
- Trending membership: `genre_ids` contain both 99 and 80, or the id is in the union of P and New. Padding from P by `popularity.desc` is unchanged.
- IMDb ids are resolved for the union of P, New and the trending titles admitted by the genre rule alone.
- `dist/` has no `tc-popular` file. `status.json` has `counts` and `contributions` for the four remaining catalogues only; `contributions` values are `{ P, New, genreRule }` (no Popular key). `newestNew`, `padded` and `skippedNoImdb` are unchanged in shape.
- `data/idmap.json` is not pruned. Entries that only Popular needed stay in the file.
- Failure rule unchanged: any remaining catalogue under 20 items fails the build and writes nothing to `dist/`.
- The landing page and manifest description no longer mention Popular.

## Request budget

Mocked cold run (empty idmap), asserted in `test/build.test.js`: **1323 requests** = 1 keyword + 80 discover (2 types x 2 passes x 2 queries x 10 pages) + 40 trending (2 x 20 pages) + 1202 external_ids (the mock's 601 distinct titles per type). Before this change the mocked figure was 1963.

Real first run: 121 fixed requests (1 + 80 + 40) plus one external_ids request per distinct title not already in `data/idmap.json`. The real title count is unknown, so the real total is unknown: not yet run against the real TMDB API. Titles resolved by the previous run stay cached, so a later run should need far fewer lookups than the cold figure.

## Commit note

Commit 26d87bf (universe and lists) leaves `src/build.js` calling the removed pass, so the end-to-end build tests only pass again from the next commit (5b7a172). Run the tests at the branch tip, not at 26d87bf.

## Not verified

- Anything against the real TMDB API, including real catalogue sizes after the change (each must still reach 20 items or the build fails).
- How apps treat the removed catalogues after the 0.1.1 bump (for example whether Stremio drops them from an already installed addon). Not tested on a device.
- GitHub Actions and Pages with this change.
