// Build entry point: node --env-file=.env.local src/build.js
// Reads TMDB_TOKEN from the environment. Exits non-zero and writes nothing to dist/ on failure.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from './tmdb.js';
import { loadIdMap, saveIdMap, resolveImdbIds, lookup } from './idmap.js';
import { confirmKeyword, buildPass, fetchTrending, qualifyTrending } from './universe.js';
import { buildTrending, buildNew, contributions } from './lists.js';
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
  const passes = {}; // passes[kind] = { P, N, trending }
  await Promise.all(
    kinds.map(async (kind) => {
      const [P, N, trendingRaw] = await Promise.all([
        buildPass(client, kind, 'popularity', today),
        buildPass(client, kind, 'new', today),
        fetchTrending(client, kind),
      ]);
      const unionIds = new Set([...P, ...N].map((it) => it.id));
      const trending = qualifyTrending(kind, trendingRaw, unionIds);
      passes[kind] = { P, N, trending };
      log(`${kind}: P ${P.length}, New ${N.length}, trending qualified ${trending.length}`);
    }),
  );

  // IMDb ids are resolved once for every distinct title in any pass or in Trending.
  const pool = {}; // pool[kind] = Map(tmdb id -> item)
  for (const kind of kinds) {
    const { P, N, trending } = passes[kind];
    pool[kind] = new Map([...P, ...N, ...trending].map((it) => [it.id, it]));
  }
  const idmap = await loadIdMap(idmapPath);
  const { fetched } = await resolveImdbIds(
    kinds.flatMap((k) => [...pool[k].values()]),
    idmap,
    client,
    now,
  );
  await saveIdMap(idmapPath, idmap); // cache only; dist/ is still untouched
  log(`resolved ${fetched} new IMDb ids`);

  const catalogs = {};
  const skippedNoImdb = {};
  const padded = {};
  const newestNew = {};
  const contribution = {};
  for (const kind of kinds) {
    const type = STREMIO_TYPE[kind];
    const attach = (list) =>
      list.flatMap((it) => {
        const imdb = lookup(idmap, kind, it.id);
        return imdb ? [{ ...it, imdb }] : [];
      });
    const { P, N, trending } = passes[kind];
    skippedNoImdb[type] = [...pool[kind].values()].filter((it) => !lookup(idmap, kind, it.id)).length;
    const trend = buildTrending(attach(trending), attach(P));
    padded[type] = trend.padded;
    const newItems = buildNew(attach(N), today);
    const passSets = {
      P: new Set(P.map((it) => it.id)),
      New: new Set(N.map((it) => it.id)),
    };
    newestNew[type] = newItems[0]?.date ?? null;
    contribution[`${type}/tc-trending`] = contributions(trend.items, passSets);
    contribution[`${type}/tc-new`] = contributions(newItems, passSets);
    catalogs[type] = {
      'tc-trending': toMetas(trend.items),
      'tc-new': toMetas(newItems),
    };
    log(
      `${type}: trending ${catalogs[type]['tc-trending'].length} (padded ${trend.padded}), ` +
        `new ${catalogs[type]['tc-new'].length}, ` +
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
    newestNew,
    contributions: contribution,
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
