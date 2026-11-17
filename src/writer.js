// Output side: manifest, paging, status.json, landing page, and the dist/ writer.
import { mkdir, rm, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const ADDON_ID = 'org.allistair.truecrime';
export const PAGE_SIZE = 100;
export const SKIP_STEP = 10; // a page file exists for every skip that is a multiple of this
export const MIN_ITEMS = 20;
export const TYPES = ['movie', 'series'];
export const CATALOGS = [
  { id: 'tc-trending', name: 'Trending this week' },
  { id: 'tc-new', name: 'New' },
];
export const TMDB_ATTRIBUTION =
  'This product uses the TMDB API but is not endorsed or certified by TMDB.';

export class BuildError extends Error {}

export function buildManifest(version) {
  return {
    id: ADDON_ID,
    version,
    name: 'True Crime Documentaries',
    description: 'True crime documentaries: trending this week and new. Data from TMDB.',
    resources: ['catalog'],
    types: [...TYPES],
    catalogs: TYPES.flatMap((type) =>
      CATALOGS.map((c) => ({ type, id: c.id, name: c.name, extra: [{ name: 'skip' }] })),
    ),
  };
}

// The failure rule: every catalogue needs at least MIN_ITEMS items.
// catalogs: { movie: { 'tc-new': [metas], ... }, series: {...} }
export function assertMinimums(catalogs, min = MIN_ITEMS) {
  const short = [];
  for (const type of TYPES) {
    for (const c of CATALOGS) {
      const n = catalogs?.[type]?.[c.id]?.length ?? 0;
      if (n < min) short.push(`${type}/${c.id}=${n}`);
    }
  }
  if (short.length) {
    throw new BuildError(
      `Refusing to write dist/: catalogue(s) under ${min} items: ${short.join(', ')}`,
    );
  }
}

// newestNew: newest release date in New, per type. contributions: per catalogue, how many
// of its items each discover pass contributed (P = popularity pass, New; an item in
// several passes counts in each; genreRule = in no pass, admitted to Trending by genre_ids).
export function buildStatus({ builtAt, catalogs, skippedNoImdb, padded, newestNew, contributions, seriesNew }) {
  const counts = {};
  for (const type of TYPES) for (const c of CATALOGS) counts[`${type}/${c.id}`] = catalogs[type][c.id].length;
  return { builtAt, counts, skippedNoImdb, padded, newestNew, contributions, ...(seriesNew ? { seriesNew } : {}) };
}

export function renderIndexHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>True Crime Documentaries - Stremio addon</title>
<style>
  :root { color-scheme: light dark; --bg: #fff; --fg: #1a1a1a; --muted: #666; --accent: #5b3fd0; }
  @media (prefers-color-scheme: dark) { :root { --bg: #14141a; --fg: #eee; --muted: #9a9aa5; --accent: #9d86ff; } }
  body { background: var(--bg); color: var(--fg); font: 16px/1.5 system-ui, sans-serif; margin: 0 auto; max-width: 36rem; padding: 2rem 16px; }
  a { color: var(--accent); }
  .btn { display: inline-block; padding: .7rem 1.2rem; border-radius: .5rem; background: var(--accent); color: var(--bg); text-decoration: none; font-weight: 600; }
  code { word-break: break-all; }
  footer { color: var(--muted); font-size: .85rem; margin-top: 2.5rem; }
</style>
</head>
<body>
<h1>True Crime Documentaries</h1>
<p>A Stremio addon with true crime documentaries, as movies and series. Each type has two catalogues: Trending this week and New.</p>
<p><a class="btn" id="install" href="#">Install in Stremio</a></p>
<p>Or paste this manifest URL into Stremio's addon search box:<br><code id="url"></code></p>
<script>
  var base = location.href.replace(/[^/]*$/, '') + 'manifest.json';
  document.getElementById('url').textContent = base;
  document.getElementById('install').href = 'stremio://' + base.replace(/^https?:\\/\\//, '');
</script>
<footer>${TMDB_ATTRIBUTION}</footer>
</body>
</html>
`;
}

// Pure: returns Map<relativePath, string> for everything that goes into dist/.
export function planOutput({ version, builtAt, catalogs, skippedNoImdb, padded, newestNew, contributions, seriesNew }) {
  const files = new Map();
  const json = (v) => JSON.stringify(v) + '\n';
  files.set('manifest.json', json(buildManifest(version)));
  files.set('index.html', renderIndexHtml());
  files.set('status.json', JSON.stringify(buildStatus({ builtAt, catalogs, skippedNoImdb, padded, newestNew, contributions, seriesNew }), null, 2) + '\n');
  for (const type of TYPES) {
    for (const c of CATALOGS) {
      const all = catalogs[type][c.id];
      // Base file is always written (the first PAGE_SIZE titles). Then one page per skip that
      // is a multiple of SKIP_STEP and below the list size, so apps whose rail holds a count
      // that is not a multiple of PAGE_SIZE (GameDay: 30, 130, 230) still hit a file.
      const page = (skip) => `catalog/${type}/${c.id}/skip=${skip}.json`;
      files.set(`catalog/${type}/${c.id}.json`, json({ metas: all.slice(0, PAGE_SIZE) }));
      for (let skip = SKIP_STEP; skip < all.length; skip += SKIP_STEP) {
        files.set(page(skip), json({ metas: all.slice(skip, skip + PAGE_SIZE) }));
      }
      // Empty pages, so no client gets a 404 where it used to get a file or where its paging
      // ends: skip=100 and skip=200 always exist (as before), and skip=<list size> exists
      // when the size is a multiple of SKIP_STEP (GameDay asks exactly that after its last card).
      for (const skip of [100, 200, all.length]) {
        if (skip > 0 && skip % SKIP_STEP === 0 && !files.has(page(skip))) {
          files.set(page(skip), json({ metas: [] }));
        }
      }
    }
  }
  return files;
}

// Writes to a sibling temp dir, then swaps it in, so a crash mid-write never leaves a
// half-written dist/. Call only after assertMinimums has passed.
export async function writeDist(distDir, files) {
  const tmp = `${distDir}.tmp-${process.pid}`;
  await rm(tmp, { recursive: true, force: true });
  try {
    for (const [rel, content] of files) {
      const full = join(tmp, rel);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, content);
    }
    await rm(distDir, { recursive: true, force: true });
    await rename(tmp, distDir);
  } catch (e) {
    await rm(tmp, { recursive: true, force: true });
    throw e;
  }
}
