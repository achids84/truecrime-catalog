# True Crime Documentaries (Stremio addon)

A static Stremio addon. A Node build script reads TMDB and writes plain JSON files to `dist/`. GitHub Pages hosts them and GitHub Actions rebuilds every 6 hours. No server, no runtime dependencies.

Types: `movie` and `series`. The catalogues are defined in `config/catalogues.json` (edit it on GitHub, see [docs/CONFIG.md](docs/CONFIG.md)). Shipped: **Trending this week** (`tc-trending`) and **New** (`tc-new`) per type, plus a disabled `discover` example, **Top rated**. The Popular catalogue was removed in version 0.1.1. Trending and New hold up to 300 items in pages of 100 (`skip=100`, `skip=200`). No search, no genre filter.

Status: version 0.2.0 (config-driven catalogues, ADDON-3). Not yet tested on a device.

## What counts as true crime

Two discover queries define it: Documentary AND Crime (genres 99,80), and Documentary with the keyword "true crime" (id 33722). Each query is run in two passes of up to 10 pages: by popularity (used for Trending padding and membership) and by release date newest first up to today (the **New** catalogue). So New can hold recent titles that nobody has voted on or watched much. Trending keeps a title from TMDB's weekly trending list if its genres include both 99 and 80, or it appears in either pass. Titles need a poster and an IMDb id. At the start of each build the keyword id is checked against `/search/keyword`; if 33722 is not "true crime" the build stops.

## Commands

```
npm test          # offline tests, no network
npm run check     # validate config/catalogues.json, offline
npm run keywords -- "text"   # TMDB keyword search (id and name, top 10); needs the token
npm run preview -- <id>      # first 15 titles and counts of one catalogue; writes nothing
npm run build     # needs TMDB_TOKEN (env or .env.local); writes dist/
npm run serve     # serves dist/ on http://localhost:8080 with CORS
```

`.env.local` (gitignored) holds one line: `TMDB_TOKEN=<your v4 Read Access Token>`.

Needs Node 20.6 or newer. `npm run build` uses `node --env-file=.env.local` and so needs that file; CI uses `npm run build:ci`, which reads the secret from the environment.

## Output (`dist/`)

`manifest.json`, `index.html`, `status.json`, `catalog/{type}/{id}.json` (first 100), `catalog/{type}/{id}/skip=100.json`, `skip=200.json`.

`status.json` records build time, items per catalogue, items skipped for having no IMDb id, how many Trending slots were padded, the newest release date in New (per type), and per catalogue how many items each pass contributed.

## Failure behaviour

If the config is invalid, TMDB fails or any enabled catalogue would have fewer than 20 items, the build exits non-zero and does not touch `dist/`, so the last good deployment stays live.

## Files

`data/idmap.json` is committed: TMDB id to IMDb id cache (`"movie:123": "tt..."`, or `null`). Null entries are checked again after 30 days; the dates live under the reserved key `_nullChecked`.

Deploy steps: [docs/DEPLOY.md](docs/DEPLOY.md). Editing catalogues: [docs/CONFIG.md](docs/CONFIG.md). Job notes: [ADDON-1](docs/jobs/ADDON-1.md), [ADDON-2](docs/jobs/ADDON-2.md), [ADDON-3](docs/jobs/ADDON-3.md).

This product uses the TMDB API but is not endorsed or certified by TMDB.
