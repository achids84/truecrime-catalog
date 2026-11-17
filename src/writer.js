// Output side: manifest, paging, status.json, landing page, and the dist/ writer.
import { mkdir, rm, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const ADDON_ID = 'org.allistair.truecrime';
export const PAGE_SIZE = 100;
export const PAGES = 3; // skip=0 (no suffix), skip=100, skip=200
export const MIN_ITEMS = 20;
export const TYPES = ['movie', 'series'];
export const CATALOGS = [
  { id: 'tc-trending', name: 'Trending this week' },
  { id: 'tc-new', name: 'New' },
  { id: 'tc-popular', name: 'Popular' },
];
export const TMDB_ATTRIBUTION =
  'This product uses the TMDB API but is not endorsed or certified by TMDB.';

export class BuildError extends Error {}

export function buildManifest(version) {
  return {
    id: ADDON_ID,
    version,
    name: 'True Crime Documentaries',
    description: 'True crime documentaries: trending, new and popular. Data from TMDB.',
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

export function buildStatus({ builtAt, catalogs, skippedNoImdb, padded }) {
  const counts = {};
  for (const type of TYPES) for (const c of CATALOGS) counts[`${type}/${c.id}`] = catalogs[type][c.id].length;
  return { builtAt, counts, skippedNoImdb, padded };
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
<p>A Stremio addon with true crime documentaries, as movies and series. Each type has three catalogues: Trending this week, New and Popular.</p>
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
export function planOutput({ version, builtAt, catalogs, skippedNoImdb, padded }) {
  const files = new Map();
  const json = (v) => JSON.stringify(v) + '\n';
  files.set('manifest.json', json(buildManifest(version)));
  files.set('index.html', renderIndexHtml());
  files.set('status.json', JSON.stringify(buildStatus({ builtAt, catalogs, skippedNoImdb, padded }), null, 2) + '\n');
  for (const type of TYPES) {
    for (const c of CATALOGS) {
      const all = catalogs[type][c.id];
      for (let p = 0; p < PAGES; p++) {
        const metas = all.slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE);
        const path =
          p === 0
            ? `catalog/${type}/${c.id}.json`
            : `catalog/${type}/${c.id}/skip=${p * PAGE_SIZE}.json`;
        files.set(path, json({ metas }));
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
