# True Crime Documentaries (Stremio addon)

A static Stremio addon. A Node build script reads TMDB and writes plain JSON files to `dist/`. GitHub Pages hosts them and GitHub Actions rebuilds every 6 hours. No server, no runtime dependencies.

Types: `movie` and `series`. Catalogues: movies have **Trending this week** (`tc-trending`) then **New** (`tc-new`). Series have **New episodes** (`tc-recent`, since 0.1.3) then **Trending this week**; since 0.1.7 there is no series New catalogue, because New episodes covers it (the series New pass still feeds `tc-recent`). The Popular catalogue was removed in version 0.1.1. Every item the build finds is served, in pages of up to 100 (see Paging below). No search, no genre filter.

Status: not yet run against the real TMDB API. Not yet tested on a device.

## What counts as true crime

Two discover queries define it: Documentary AND Crime (genres 99,80), and Documentary with the keyword "true crime" (id 33722). Each query is run in two passes of up to 10 pages: by popularity (used for Trending padding and membership) and by release date newest first up to today (the **New** catalogue). So New can hold recent titles that nobody has voted on or watched much. `tc-new` (movies only since 0.1.7) is only that pass, by release date. For series there is a third pass (since 0.1.3): shows with an episode aired in the last 90 days (`air_date.gte`, constant `RECENT_DAYS`), by popularity, up to 3 pages per query. It feeds only `tc-recent`; it never changes `tc-new` or Trending. Since 0.1.5 there are extra discover sets, Documentary (99) AND one keyword each: cold case (210662, tv and movie), serial killer (10714, tv and movie), murder (9826, tv only). Since 0.1.6 six more: human trafficking (6019), drug trafficking (2149), drug cartel (10175), organized crime (10291), trafficking (208458) (tv and movie) and smuggling (294521, tv only); these run only in the New pass and (tv) the recent pass, with no popularity pass. They are listed in `EXTRA_KEYWORD_SETS` in `src/universe.js` and run in the same passes (New, P, and for tv the recent pass) with the same page caps. They widen `tc-new` and `tc-recent` only; Trending (membership and padding) is built from the original two queries and is unchanged.

**New episodes** (`tc-recent`, series only): every series in the New pass, pass P or the recent pass, sorted by the date of the newest episode, ties by popularity. That date is the later of TMDB last air date and the newest released episode (season 1 or later, not in the future) that Cinemeta lists, because TMDB lacks episode dates for some airing shows and the Stremio TV detail page reads Cinemeta. Cinemeta is asked only for series that are not Ended or Canceled, once per build, with an 8 second timeout and 5 requests at a time; if it fails the cached or TMDB date is used. With neither date, the first air date is used. A title is listed only if that date is within the last 90 days. At most 100 titles; paging follows the same rules as the other catalogues. Cards still show the first-air year. It is exempt from the 20-title failure rule, since it can legitimately be short. Trending keeps a title from TMDB's weekly trending list if its genres include both 99 and 80, or it appears in either pass. Titles need a poster and an IMDb id. At the start of each build the keyword id is checked against `/search/keyword`; if 33722 is not "true crime" the build stops.

## Commands

```
npm test          # offline tests, no network
npm run build     # needs TMDB_TOKEN (env or .env.local); writes dist/
npm run serve     # serves dist/ on http://localhost:8080 with CORS
```

`.env.local` (gitignored) holds one line: `TMDB_TOKEN=<your v4 Read Access Token>`.

Needs Node 20.6 or newer. `npm run build` uses `node --env-file=.env.local` and so needs that file; CI uses `npm run build:ci`, which reads the secret from the environment.

## Output (`dist/`)

`manifest.json`, `index.html`, `status.json`, `catalog/{type}/{id}.json` (first 100), `catalog/{type}/{id}/skip=100.json`, `skip=200.json`.

`status.json` records build time, items per catalogue, items skipped for having no IMDb id, how many Trending slots were padded, the newest release date in New (per type), and per catalogue how many items each pass contributed.

## How to exclude a title

Off-topic titles are listed in `config/exclude.json`. You can edit it in the browser:

1. Find the title's TMDB id: it is the number in its themoviedb.org address (`.../movie/47894-terror-in-the-aisles` is movie 47894; `.../tv/119838-...` is series 119838).
2. On GitHub open the repository, then `config/exclude.json`, and click the pencil icon (Edit this file).
3. Add the number, without quotes, to `"movie"` or `"series"` (comma-separated), and add `"<id>": "<title>"` to `"names"` so the list stays readable.
4. Click **Commit changes** (commit straight to `main`).
5. Wait for the Action: the **build** workflow runs, then **deploy**. The title is gone from every catalogue after it finishes (the next scheduled run does the same).

If the file is not valid JSON or an id is not a whole number, the build stops with a message in the Action log and the live site stays on the last good build. To check the file before you commit, run `npm run check-exclude`. It needs no TMDB token.

## Failure behaviour

If TMDB fails or any catalogue would have fewer than 20 items, the build exits non-zero and does not touch `dist/`, so the last good deployment stays live.

## Files

`data/tvdates.json` is committed too: per series id, `first_air_date`, `last_air_date`, `status`, `checkedAt` from `/tv/{id}`, used for `tc-recent` (plus `cinemeta_last` and `cinemetaCheckedAt` for non-final series). Ended and Canceled entries are cached for good; every other status is looked up again on each build. A failed lookup never fails the build: the cached entry is used, else the first air date. The Action commits both files.

`data/idmap.json` is committed: TMDB id to IMDb id cache (`"movie:123": "tt..."`, or `null`). Null entries are checked again after 30 days; the dates live under the reserved key `_nullChecked`.

Deploy steps: [docs/DEPLOY.md](docs/DEPLOY.md). Job notes: [docs/jobs/ADDON-1.md](docs/jobs/ADDON-1.md).

This product uses the TMDB API but is not endorsed or certified by TMDB.

## Paging

Each catalogue has a base file (the first 100 titles) and one page file per `skip` that is a multiple of 10 and below the list size, for example `catalog/movie/tc-new/skip=30.json`. Each page holds up to 100 titles from that offset, in list order. Stremio apps ask for `skip=100`, `skip=200`. The GameDay app keeps 30 cards per rail and asks with skip equal to the cards it holds: 30, 130, 230 and so on. That is why skip steps are multiples of 10. Three kinds of empty page (`{"metas":[]}`) exist so clients do not hit a 404: `skip=100` and `skip=200` always exist, as in earlier versions, and `skip=<list size>` exists when the list size is a multiple of 10 (a list of 20 has an empty `skip=20.json`, which GameDay asks for right after its last card). Any other skip at or beyond the list size, or not a multiple of 10, has no file and returns 404, which the app treats as the end of the list. If GameDay ever changes its card limit to a number that is not a multiple of 10, paging breaks again.
