# Editing the catalogues

All catalogues live in one file: `config/catalogues.json`. Edit it in the browser; a commit to `main` rebuilds and deploys the addon.

## Change a catalogue in the browser

1. Open the repo on GitHub, then the folder `config`, then `catalogues.json`.
2. Click the pencil icon (Edit this file).
3. Make the change (see below). Keep the commas and quotes exactly as they are.
4. Click **Commit changes**, choose **Commit directly to the main branch**, commit.
5. Open the **Actions** tab. A run named `build` starts within a few seconds. It runs `npm run check` first, then the TMDB build, then the deploy.
   - Green: the change is live.
   - Red: nothing was deployed and the old site stays up. Open the run, then the failed step. The message names the entry and the field, for example `catalogues[2].sort: must be one of ...`.
6. A run takes about 2 to 5 minutes (longer when many new titles need IMDb ids). Pages can take another minute to serve the new files.
7. Check the result at `https://<you>.github.io/<repo>/manifest.json`. Look for your catalogue `id` in the `catalogs` list. If it is there, the addon has it. (Reload the addon in Stremio or the GameDay app to see the new row; an installed addon only refetches the manifest now and then.)

### Undo

On GitHub open `config/catalogues.json`, click **History**, open the last good commit, click the `...` menu, then **View file**, then the pencil on that old version and commit it. Or open the bad commit and press **Revert**. A revert is a normal push to `main`, so it rebuilds and deploys again.

## The file

```json
{
  "catalogues": [
    { "id": "tc-trending", "name": "Trending this week", "kind": "trending", "types": ["movie", "series"], "enabled": true },
    { "id": "tc-new", "name": "New", "kind": "new", "types": ["movie", "series"], "enabled": true },
    { "id": "tc-top-rated", "name": "Top rated", "kind": "discover", "types": ["movie", "series"], "enabled": false,
      "sort": "vote_average.desc", "minVotes": 200, "limit": 100 }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `id` | Unique, `tc-` then lower case letters, digits, dashes. It becomes the file name, so do not change it on a live catalogue. |
| `name` | The row title shown in the app (1 to 60 characters). |
| `kind` | `trending`, `new` or `discover`. |
| `types` | `["movie"]`, `["series"]` or `["movie","series"]`. |
| `enabled` | `true` shows it, `false` hides it (the entry stays in the file). |

At least one catalogue must be enabled. At most **8 enabled per type**: the GameDay app shows at most 20 rails per tab across all addons.

`trending` and `new` behave exactly as before and take no other fields.

### kind "discover"

A discover catalogue is one TMDB query. The "true crime" keyword (33722) is always part of it. Every field below is optional.

| Field | Values |
| --- | --- |
| `sort` | `popularity.desc` (default), `vote_average.desc`, `primary_release_date.desc` or `first_air_date.desc`. Either date sort means newest first and is mapped to the right one for movies and series. Titles not yet released are left out when sorting by date. |
| `minVotes` | 0 to 10000. Use it with `vote_average.desc`, or one-vote titles float to the top. |
| `yearFrom`, `yearTo` | 1900 to next year. |
| `language` | Original language, two letters, for example `"en"`. |
| `genresAll` | TMDB genre ids; a title must have all of them, for example `[99, 80]`. |
| `keywordsAll` | TMDB keyword ids; a title must have all of them. |
| `limit` | 1 to 500, default 100. About 15 percent more are fetched first because some titles have no poster or IMDb id, so a result can come out a little under the limit. |

Only AND is supported. There is no "any of" list.

A catalogue must end up with at least 20 titles, or the build fails (and the old site stays up). Try it first with the preview below.

## Helper commands

They need Node 20.6 or newer and a TMDB token in `.env.local` (`TMDB_TOKEN=...`, gitignored) or in the environment. `check` needs no token.

```
npm run check                      # validate config/catalogues.json, offline
npm run keywords -- "serial killer"   # TMDB keyword search: id and name of the top 10
npm run preview -- tc-top-rated    # first 15 titles and counts per type; writes nothing
```

Finding a keyword: run `npm run keywords -- "cold case"`, pick the id from the list, put it in `keywordsAll`, then run `npm run preview -- <id of your catalogue>` (works on disabled entries) before you enable it. `preview` reads `data/idmap.json` but never saves it and never touches `dist/`.

Add a catalogue: copy an entry, give it a new `id` and `name`, set `enabled` to `true`.
