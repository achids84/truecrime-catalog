// Build entry point: node --env-file-if-exists=.env.local src/build.js
// Reads TMDB_TOKEN from the environment. Exits non-zero and writes nothing to dist/ on failure.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from './tmdb.js';
import { loadIdMap, saveIdMap, resolveImdbIds, lookup } from './idmap.js';
import { confirmKeyword, buildUniverse, fetchTrendingIds } from './universe.js';
import { buildTrending, buildNew, buildPopular } from './lists.js';
import { toMetas, STREMIO_TYPE } from './meta.js';
import { assertMinimums, planOutput, writeDist, BuildError } from './writer.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export async function runBuild({
  token,
  fetchImpl = globalThis.fetch,
  sleep,
  now = Date.now(),
  distDir = join(ROOT, 'dist'),
  idmapPath = join(ROOT, 'data', 'idmap.json'),
  version,
  log = () => {},
} = {}) {
  const client = createClient({ token, fetchImpl, ...(sleep ? { sleep } : {}) });
  const today = new Date(now).toISOString().slice(0, 10);
  version ??= JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')).version;

  log('checking keyword 33722');
  await confirmKeyword(client);

  const kinds = ['movie', 'tv'];
  const universe = {};
  const trendingIds = {};
  await Promise.all(
    kinds.map(async (kind) => {
      [universe[kind], trendingIds[kind]] = await Promise.all([
        buildUniverse(client, kind),
        fetchTrendingIds(client, kind),
      ]);
      log(`${kind}: universe ${universe[kind].length}`);
    }),
  );

  const idmap = await loadIdMap(idmapPath);
  const { fetched } = await resolveImdbIds(
    kinds.flatMap((k) => universe[k]),
    idmap,
    client,
    now,
  );
  await saveIdMap(idmapPath, idmap); // cache only; dist/ is still untouched
  log(`resolved ${fetched} new IMDb ids`);

  const catalogs = {};
  const skippedNoImdb = {};
  const padded = {};
  for (const kind of kinds) {
    const type = STREMIO_TYPE[kind];
    const withImdb = [];
    skippedNoImdb[type] = 0;
    for (const it of universe[kind]) {
      const imdb = lookup(idmap, kind, it.id);
      if (imdb) withImdb.push({ ...it, imdb });
      else skippedNoImdb[type]++;
    }
    const trending = buildTrending(withImdb, trendingIds[kind]);
    padded[type] = trending.padded;
    catalogs[type] = {
      'tc-trending': toMetas(trending.items),
      'tc-new': toMetas(buildNew(withImdb, today)),
      'tc-popular': toMetas(buildPopular(withImdb)),
    };
    log(
      `${type}: trending ${catalogs[type]['tc-trending'].length} (padded ${trending.padded}), ` +
        `new ${catalogs[type]['tc-new'].length}, popular ${catalogs[type]['tc-popular'].length}, ` +
        `skipped no IMDb id ${skippedNoImdb[type]}`,
    );
  }

  assertMinimums(catalogs); // throws before anything is written

  const files = planOutput({
    version,
    builtAt: new Date(now).toISOString(),
    catalogs,
    skippedNoImdb,
    padded,
  });
  await writeDist(distDir, files);
  log(`wrote ${files.size} files to dist/`);
  return { catalogs, skippedNoImdb, padded };
}

// Redacts the token from anything that is logged, as a belt-and-braces guard.
export function redactor(token) {
  return (s) => (token ? String(s).split(token).join('[redacted]') : String(s));
}

async function main() {
  const token = process.env.TMDB_TOKEN;
  if (!token) {
    console.error(
      'TMDB_TOKEN is not set. Put it in .env.local (TMDB_TOKEN=...) or export it. See docs/DEPLOY.md.',
    );
    process.exit(1);
  }
  const redact = redactor(token);
  try {
    await runBuild({ token, log: (m) => console.log(redact(m)) });
  } catch (e) {
    console.error(redact(`Build failed: ${e instanceof Error ? e.message : e}`));
    console.error('dist/ was not modified.');
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
export { BuildError };
