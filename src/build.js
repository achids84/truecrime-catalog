// Build entry point: node --env-file=.env.local src/build.js
// Reads TMDB_TOKEN from the environment. Exits non-zero and writes nothing to dist/ on failure.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from './tmdb.js';
import { loadIdMap, saveIdMap, resolveImdbIds, lookup } from './idmap.js';
import { confirmKeyword, buildPass, buildRecentPass, buildExtraPass, buildExtraRecentPass, unionById, fetchTrending, qualifyTrending } from './universe.js';
import { loadTvDates, saveTvDates, resolveTvDates, resolveCinemeta, sortKey } from './tvdates.js';
import { createCinemeta } from './cinemeta.js';
import { buildTrending, buildNew, buildRecent, contributions } from './lists.js';
import { toMetas, STREMIO_TYPE } from './meta.js';
import { loadExclude, excludeKey, dropExcluded } from './exclude.js';
import { assertMinimums, planOutput, writeDist, BuildError } from './writer.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export async function runBuild({
  token,
  fetchImpl = globalThis.fetch,
  cinemetaFetch = fetchImpl,
  sleep,
  now = Date.now(),
  distDir = join(ROOT, 'dist'),
  idmapPath = join(ROOT, 'data', 'idmap.json'),
  tvDatesPath = join(dirname(idmapPath), 'tvdates.json'),
  excludePath = join(ROOT, 'config', 'exclude.json'),
  version,
  log = () => {},
} = {}) {
  const client = createClient({ token, fetchImpl, ...(sleep ? { sleep } : {}) });
  const today = new Date(now).toISOString().slice(0, 10);
  version ??= JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')).version;

  const exclude = await loadExclude(excludePath); // invalid file: throws before any request
  log(`exclusion list: ${exclude.movie.size} movies, ${exclude.series.size} series`);

  log('checking keyword 33722');
  await confirmKeyword(client);

  const kinds = ['movie', 'tv'];
  const passes = {}; // passes[kind] = { P, N, trending }
  await Promise.all(
    kinds.map(async (kind) => {
      const [P0, N0, trendingRaw, R0, XP0, XN0, XR0] = await Promise.all([
        buildPass(client, kind, 'popularity', today),
        buildPass(client, kind, 'new', today),
        fetchTrending(client, kind),
        kind === 'tv' ? buildRecentPass(client, today) : [],
        buildExtraPass(client, kind, 'popularity', today),
        buildExtraPass(client, kind, 'new', today),
        kind === 'tv' ? buildExtraRecentPass(client, today) : [],
      ]);
      // Exclusion list: applied to every pool before any list is built (padding included).
      const ex = exclude[excludeKey(kind)];
      const [P, N, R, XP, XN, XR] = [P0, N0, R0, XP0, XN0, XR0].map((l) => dropExcluded(l, ex));
      // R (series recent-airing pass) widens the New pool only. It stays out of the union so
      // Trending membership is exactly what it was.
      const unionIds = new Set([...P, ...N].map((it) => it.id));
      const trending = dropExcluded(qualifyTrending(kind, trendingRaw, unionIds), ex);
      // XP, XN, XR (extra keyword sets) are kept out of unionIds and out of the padding source (P),
      // so tc-trending is built from exactly the inputs main uses.
      passes[kind] = { P, N, R, XP, XN, XR, trending };
      log(`${kind}: P ${P.length}, New ${N.length}${kind === 'tv' ? `, Recent ${R.length}` : ''}, trending qualified ${trending.length}`);
    }),
  );

  // IMDb ids are resolved once for every distinct title in any pass or in Trending.
  const pool = {}; // pool[kind] = Map(tmdb id -> item)
  for (const kind of kinds) {
    const { P, N, R, XP, XN, XR, trending } = passes[kind];
    pool[kind] = new Map([...P, ...N, ...R, ...XP, ...XN, ...XR, ...trending].map((it) => [it.id, it]));
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

  const tvDates = await loadTvDates(tvDatesPath);
  const seriesNew = {
    recentAdded: 0, lookups: 0, lookupsFailed: 0, cinemetaRequests: 0, cinemetaFailed: 0, cinemetaBeatTmdb: 0,
    recentBeforeCap: 0, recentKeyFromFirst: 0,
  };
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
    const { P, N, R, XP, XN, XR, trending } = passes[kind];
    skippedNoImdb[type] = [...pool[kind].values()].filter((it) => !lookup(idmap, kind, it.id)).length;
    const trend = buildTrending(attach(trending), attach(P));
    padded[type] = trend.padded;
    // tc-new is exactly what main builds: the New pass only, sorted by first air date.
    // (The recent pass and the date cache never feed it.)
    const newPool = attach(unionById(N, XN)); // N plus the extra keyword sets
    let recent = null;
    if (kind === 'tv') {
      // tc-recent: every series pool (New, P, recent pass), last air date else first air date.
      const datePool = attach(unionById(N, XN, P, XP, R, XR));
      const known = new Set([...P, ...N, ...XP, ...XN].map((it) => it.id));
      seriesNew.recentAdded = [...R, ...XR].filter((it) => !known.has(it.id)).length;
      const { fetched, failed } = await resolveTvDates(datePool, tvDates, client, now);
      // Cinemeta: the newest released episode, for series that are not Ended or Canceled.
      const cin = await resolveCinemeta(datePool, tvDates, createCinemeta({ fetchImpl: cinemetaFetch }), now);
      await saveTvDates(tvDatesPath, tvDates); // cache only; dist/ is still untouched
      seriesNew.lookups = fetched;
      seriesNew.lookupsFailed = failed;
      seriesNew.cinemetaRequests = cin.requests;
      seriesNew.cinemetaFailed = cin.failed;
      const keyed = datePool.map((it) => ({ ...it, ...sortKey(it, tvDates[it.id]) }));
      seriesNew.cinemetaBeatTmdb = keyed.filter((it) => it.sortSource === 'cinemeta').length;
      recent = buildRecent(keyed, today);
      seriesNew.recentBeforeCap = recent.total;
      seriesNew.recentKeyFromFirst = recent.items.filter((it) => it.sortSource === 'first').length;
    }
    const newItems = buildNew(newPool, today);
    const passSets = {
      P: new Set(P.map((it) => it.id)),
      New: new Set(N.map((it) => it.id)),
    };
    const poolSets = {
      P: new Set([...P, ...XP].map((it) => it.id)),
      New: new Set([...N, ...XN].map((it) => it.id)),
    };
    newestNew[type] = newItems[0]?.date ?? null;
    contribution[`${type}/tc-trending`] = contributions(trend.items, passSets);
    contribution[`${type}/tc-new`] = contributions(newItems, poolSets);
    catalogs[type] = {
      'tc-trending': toMetas(trend.items),
      'tc-new': toMetas(newItems),
    };
    if (recent) {
      catalogs[type]['tc-recent'] = toMetas(recent.items);
      contribution[`${type}/tc-recent`] = contributions(recent.items, { ...poolSets, Recent: new Set([...R, ...XR].map((it) => it.id)) });
    }
    log(
      `${type}: trending ${catalogs[type]['tc-trending'].length} (padded ${trend.padded}), ` +
        `new ${catalogs[type]['tc-new'].length}, ` +
        `skipped no IMDb id ${skippedNoImdb[type]}`,
    );
    if (kind === 'tv') {
      log(
        `series: recent pass added ${seriesNew.recentAdded} titles to the pool, ${seriesNew.lookups} /tv lookups ` +
          `(${seriesNew.lookupsFailed} failed), ${seriesNew.cinemetaRequests} Cinemeta requests ` +
          `(${seriesNew.cinemetaFailed} failed, ${seriesNew.cinemetaBeatTmdb} titles where Cinemeta beat TMDB), tc-recent ${recent.items.length} of ${seriesNew.recentBeforeCap} ` +
          `(${seriesNew.recentKeyFromFirst} keyed by first air date)`,
      );
    }
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
    seriesNew,
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
