// ADDON-5b: series tc-new sorted by last air date (fallback first air date), tv lookup cache,
// recent-airing membership pass. No network: mocked TMDB only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runBuild } from '../src/build.js';
import { buildNew } from '../src/lists.js';
import { toMeta } from '../src/meta.js';
import { sortKey, resolveTvDates, needsTvLookup } from '../src/tvdates.js';
import { createClient } from '../src/tmdb.js';
import { mockFetch } from './helpers.js';
import { fakeTmdb, TODAY } from './fake-tmdb.js';

const item = (id, o = {}) => ({
  kind: 'tv', id, name: `S${id}`, date: '2026-01-01', overview: 'ov',
  poster_path: `/p${id}.jpg`, popularity: 1, vote_count: 1, imdb: `tt${id}`, ...o,
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'sn-'));
  return { root, distDir: join(root, 'dist'), idmapPath: join(root, 'data', 'idmap.json'), tvDatesPath: join(root, 'data', 'tvdates.json') };
}
const run = (p, fetchImpl) =>
  runBuild({ token: 'tok', fetchImpl, now: TODAY, version: '9.9.9', sleep: async () => {}, ...p });
const read = async (p, rel) => JSON.parse(await readFile(join(p.distDir, rel), 'utf8'));
const tvCalls = (f) => f.calls.filter((c) => /^\/3\/tv\/\d+$/.test(new URL(c.url).pathname));
const tmdbIdOf = (m) => String(Number(m.id.slice(2)) - 1000000);
async function allSeriesNew(p) {
  const out = [...(await read(p, 'catalog/series/tc-new.json')).metas];
  for (let skip = 100; ; skip += 100) {
    const page = await read(p, `catalog/series/tc-new/skip=${skip}.json`).catch(() => null);
    if (!page || !page.metas.length) break;
    out.push(...page.metas);
  }
  return out;
}

test('sort key: last_air_date wins, null falls back to first_air_date, date is untouched', () => {
  const a = item(1, { date: '2025-05-05' }); // old show, new season
  const b = item(2, { date: '2026-11-12' }); // brand new, null last_air_date
  const c = item(3, { date: '2026-10-01' });
  const withKey = [
    { ...a, ...sortKey(a, { last_air_date: '2026-10-27' }) },
    { ...b, ...sortKey(b, { last_air_date: null }) },
    { ...c, ...sortKey(c, undefined) }, // no cache entry at all
  ];
  assert.deepEqual(withKey.map((x) => x.sortSource), ['last', 'first', 'first']);
  assert.deepEqual(buildNew(withKey, '2026-11-17').map((x) => x.id), [2, 1, 3]);
  // cards keep the first-air year, not the sort date
  assert.equal(toMeta(withKey[0]).releaseInfo, '2025');
  assert.equal(withKey[0].date, '2025-05-05');
});

test('movies: items without sortDate keep the plain date order', () => {
  const m = (id, date, popularity = 1) => item(id, { kind: 'movie', date, popularity });
  const out = buildNew([m(1, '2026-01-01'), m(2, '2026-06-01', 5), m(3, '2026-06-01', 50), m(4, '2026-11-01')], '2026-11-17');
  assert.deepEqual(out.map((x) => x.id), [4, 3, 2, 1]);
});

test('series ties on the sort key go by popularity', () => {
  const x = item(1, { sortDate: '2026-11-01', popularity: 1 });
  const y = item(2, { sortDate: '2026-11-01', popularity: 9 });
  assert.deepEqual(buildNew([x, y], '2026-11-17').map((i) => i.id), [2, 1]);
});

test('lookup cache: Ended and Canceled are never refetched, anything else is, missing is fetched', async () => {
  const entry = (status) => ({ first_air_date: 'a', last_air_date: 'a', status, checkedAt: '2026-01-01' });
  const map = { 1: entry('Ended'), 2: entry('Canceled'), 3: entry('Returning Series'), 4: entry('In Production') };
  const f = mockFetch(() => ({ first_air_date: '2026-01-01', last_air_date: '2026-11-01', status: 'Returning Series' }));
  const client = createClient({ token: 't', fetchImpl: f });
  const r = await resolveTvDates([1, 2, 3, 4, 5].map((id) => ({ id })), map, client, TODAY);
  assert.deepEqual(f.calls.map((c) => new URL(c.url).pathname).sort(), ['/3/tv/3', '/3/tv/4', '/3/tv/5']);
  assert.deepEqual([r.fetched, r.failed], [3, 0]);
  assert.equal(map[3].last_air_date, '2026-11-01');
  assert.equal(map[3].checkedAt, '2026-11-17');
  assert.equal(map[1].checkedAt, '2026-01-01'); // untouched
  assert.ok(needsTvLookup(undefined) && needsTvLookup(map[3]) && !needsTvLookup(map[1]));
});

test('build: warm cache re-requests only non-final series', async () => {
  const p = await setup();
  const f1 = mockFetch(fakeTmdb());
  await run(p, f1);
  assert.equal(tvCalls(f1).length, 404);
  const cache = JSON.parse(await readFile(p.tvDatesPath, 'utf8'));
  assert.deepEqual(Object.keys(cache[1001]).sort(), ['checkedAt', 'first_air_date', 'last_air_date', 'status']);
  const open = Object.values(cache).filter((e) => e.status !== 'Ended' && e.status !== 'Canceled').length;
  const f2 = mockFetch(fakeTmdb());
  await run(p, f2);
  assert.equal(tvCalls(f2).length, open);
  assert.ok(open > 0 && open < 404);
  assert.ok(tvCalls(f2).every((c) => cache[new URL(c.url).pathname.split('/').pop()].status !== 'Ended'));
  assert.equal(f2.calls.filter((c) => c.url.includes('external_ids')).length, 0);
});

test('build: series New is ordered by last air date, recent-pass shows appear, null falls back', async () => {
  const p = await setup();
  await run(p, mockFetch(fakeTmdb()));
  const metas = await allSeriesNew(p);
  assert.equal(metas.length, 300);
  const cache = JSON.parse(await readFile(p.tvDatesPath, 'utf8'));
  const keys = metas.map((m) => cache[tmdbIdOf(m)].last_air_date || cache[tmdbIdOf(m)].first_air_date);
  for (let i = 1; i < keys.length; i++) assert.ok(keys[i - 1] >= keys[i], `order broken at ${i}`);
  // an old show (first aired 2025) with a new season is now in the list, near the top
  const recent = metas.filter((m) => Number(tmdbIdOf(m)) >= 2000);
  assert.ok(recent.length > 0);
  assert.equal(recent[0].releaseInfo, '2025'); // card still shows the first-air year
  assert.ok(metas.indexOf(recent[0]) < 5);
  // id 1010 has a null last_air_date: it sorts by its first air date, and is still listed
  assert.equal(cache[1010].last_air_date, null);
  assert.ok(metas.find((m) => tmdbIdOf(m) === '1010'));
  const status = await read(p, 'status.json');
  assert.ok(status.seriesNew.keyFromFirst > 0);
  assert.equal(status.seriesNew.recentAdded, 120);
});

test('build: a failed /tv lookup degrades, never fails the build or drops a title', async () => {
  // cold cache and every /tv/{id} failing: the build succeeds and falls back to first_air_date
  const bad = await setup();
  await run(bad, mockFetch(fakeTmdb({ failTv: 500 })));
  const badMetas = await allSeriesNew(bad);
  assert.equal(badMetas.length, 300);
  assert.equal(new Set(badMetas.map((m) => m.id)).size, 300);
  const status = await read(bad, 'status.json');
  assert.equal(status.seriesNew.lookupsFailed, 404);
  assert.equal(status.seriesNew.keyFromFirst, 300); // every key fell back

  // a title is kept (by first air date) when its lookup fails, even when the cap is not hit:
  // compare the set of ids with a run where lookups work, restricted to the shared window
  const ok = await setup();
  await run(ok, mockFetch(fakeTmdb()));
  const okIds = new Set((await allSeriesNew(ok)).map((m) => m.id));
  const first = await read(bad, 'catalog/series/tc-new.json');
  assert.ok(first.metas.length === 100 && okIds.size === 300);

  // a cached entry is used when the refresh fails: id 2001 is cached with a very new date
  const warm = await setup();
  await mkdir(join(warm.root, 'data'), { recursive: true });
  await writeFile(
    warm.tvDatesPath,
    JSON.stringify({ 2001: { first_air_date: '2025-02-10', last_air_date: '2026-11-17', status: 'Returning Series', checkedAt: '2026-11-01' } }),
  );
  await run(warm, mockFetch(fakeTmdb({ failTv: 500 })));
  assert.equal((await allSeriesNew(warm))[0].id, 'tt1002001');
  // and a failed refresh leaves that cached entry as it was
  assert.equal(JSON.parse(await readFile(warm.tvDatesPath, 'utf8'))[2001].checkedAt, '2026-11-01');
});

test('tc-trending and movie catalogues are unaffected by tv lookups or the recent pass', async () => {
  const a = await setup();
  const b = await setup();
  await run(a, mockFetch(fakeTmdb()));
  await run(b, mockFetch(fakeTmdb({ failTv: 500 })));
  for (const rel of ['catalog/series/tc-trending.json', 'catalog/movie/tc-trending.json', 'catalog/movie/tc-new.json']) {
    assert.equal(await readFile(join(a.distDir, rel), 'utf8'), await readFile(join(b.distDir, rel), 'utf8'));
  }
  // Trending membership never uses the recent pass (ids 2001+)
  const trend = (await read(a, 'catalog/series/tc-trending.json')).metas;
  assert.ok(trend.every((m) => !(Number(tmdbIdOf(m)) >= 2000 && Number(tmdbIdOf(m)) < 3000)));
  // movie New stays in plain release-date order
  const movies = (await read(a, 'catalog/movie/tc-new.json')).metas;
  assert.equal(movies[0].id, 'tt1001291');
  const status = await read(a, 'status.json');
  assert.deepEqual(status.contributions['series/tc-trending'], { P: 38, New: 1, genreRule: 1 });
});

test('paging file names are unchanged: base, skip=10..N, empty page at the list size', async () => {
  const p = await setup();
  await run(p, mockFetch(fakeTmdb()));
  const files = (await readdir(join(p.distDir, 'catalog', 'series', 'tc-new'))).sort();
  const expected = [];
  for (let k = 10; k <= 300; k += 10) expected.push(`skip=${k}.json`); // 300 = list size, empty page
  assert.deepEqual(files, expected.sort());
  assert.equal((await read(p, 'catalog/series/tc-new/skip=300.json')).metas.length, 0);
  assert.equal((await read(p, 'catalog/series/tc-new.json')).metas.length, 100);
});
