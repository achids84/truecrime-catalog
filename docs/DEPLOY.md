# Deploy

Status: not yet run against the real TMDB API. Not yet tested on a device. Nothing below has been confirmed by a real run.

## Steps

1. **TMDB account and token.** Create an account at themoviedb.org. Go to Settings > API, request API access, then copy the **API Read Access Token** (the long v4 token that starts with `eyJ`). Not the short v3 API key.
2. **Local trial (optional but recommended).** In the project folder create `.env.local` containing `TMDB_TOKEN=<the token>`. Run `npm test`, `npm run build`, `npm run serve`. The file is gitignored; never commit it.
3. **Create a public GitHub repo** (GitHub Pages on a free account needs a public repo). Do not add a README or licence on GitHub, so the first push is clean.
4. **Push.**
   ```
   git remote add origin https://github.com/<you>/<repo>.git
   git checkout main
   git merge addon-1
   git push -u origin main
   ```
   The first push triggers the workflow, which will fail until steps 5 and 6 are done. That is expected.
5. **Settings > Pages > Source: GitHub Actions.**
6. **Settings > Secrets and variables > Actions > New repository secret.** Name `TMDB_TOKEN`, value the Read Access Token.
7. **Run the workflow once.** Actions tab > build > Run workflow. Wait for both jobs (build, deploy) to go green. The deploy job prints the site URL, normally `https://<you>.github.io/<repo>/`.
8. **Check the headers.**
   ```
   curl -I https://<you>.github.io/<repo>/manifest.json
   ```
   Expect `HTTP/2 200`, `content-type: application/json` and `access-control-allow-origin: *`.

   If `access-control-allow-origin` is missing: Stremio needs it to load the manifest from the web. GitHub Pages normally sends it, but this has not been verified here. If it is absent, the fix is to host `dist/` on a host where you can set headers (for example Cloudflare Pages or Netlify with a `_headers` file containing `/*` and `  Access-Control-Allow-Origin: *`). Do not install the addon until the header is present.
9. **Install.** In Stremio, Addons > paste `https://<you>.github.io/<repo>/manifest.json`, or open the landing page and press Install.

## Later runs

The schedule `17 */6 * * *` rebuilds automatically. After each run the workflow commits `data/idmap.json` and `data/tvdates.json` with the message `chore: id map and tv dates [skip ci]`. If a build fails, the previous deployment stays live; check the Actions log. Also check `status.json` on the site for counts and padding.

## Troubleshooting

- "TMDB_TOKEN is not set": the secret is missing or misspelled.
- "Keyword id 33722 is not ...": TMDB changed or renamed the keyword. The build refuses to run; pick the right keyword id in `src/universe.js`.
- "catalogue(s) under 20 items": too few titles with an IMDb id. Nothing was deployed.
- Commit step fails with a permissions error: Settings > Actions > General > Workflow permissions must allow the workflow to write (the job requests `contents: write` itself, but an organisation policy can override it).
