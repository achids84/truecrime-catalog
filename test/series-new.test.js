// ADDON-5b/5c: series tc-recent ("New episodes") from the tv date cache and the recent pass,
// and the guarantee that tc-new, tc-trending and every movie file stay as main builds them.
// No network: mocked TMDB only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runBuild } from '../src/build.js';
import { buildNew, buildRecent, RECENT_MAX } from '../src/lists.js';
import { toMeta } from '../src/meta.js';
import { daysBefore, RECENT_DAYS } from '../src/universe.js';
import { sortKey, resolveTvDates, needsTvLookup } from '../src/tvdates.js';
import { createClient } from '../src/tmdb.js';
import { mockFetch } from './helpers.js';
import { fakeTmdb, TODAY } from './fake-tmdb.js';

const TODAY_STR = '2026-11-17';
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
// every title of a catalogue, following the page files
async function allOf(p, type, id) {
  const out = [...(await read(p, `catalog/${type}/${id}.json`)).metas];
  for (let skip = 100; ; skip += 100) {
    const page = await read(p, `catalog/${type}/${id}/skip=${skip}.json`).catch(() => null);
    if (!page || !page.metas.length) break;
    out.push(...page.metas);
  }
  return out;
}

test('constants: one RECENT_DAYS (90) drives both the pass and the tc-recent window', () => {
  assert.equal(RECENT_DAYS, 90);
  assert.equal(RECENT_MAX, 100);
  assert.equal(daysBefore('2026-11-17', 90), '2026-08-19');
});

test('buildNew is first air date again, even for items that carry a sortDate', () => {
  const a = item(1, { date: '2025-05-05', sortDate: '2026-10-27' }); // old show, new season
  const b = item(2, { date: '2026-11-12', sortDate: '2026-11-12' });
  const c = item(3, { date: '2026-10-01', sortDate: '2026-11-16' });
  assert.deepEqual(buildNew([a, b, c], TODAY_STR).map((x) => x.id), [2, 3, 1]);
});

test('sort key: last_air_date wins, null or missing falls back to first_air_date; date is untouched', () => {
  const a = item(1, { date: '2025-05-05' });
  const b = item(2, { date: '2026-11-12' });
  const c = item(3, { date: '2026-10-01' });
  const withKey = [
    { ...a, ...sortKey(a, { last_air_date: '2026-10-27' }) },
    { ...b, ...sortKey(b, { last_air_date: null }) },
    { ...c, ...sortKey(c, undefined) },
  ];
  assert.deepEqual(withKey.map((x) => [x.sortDate, x.sortSource]), [['2026-10-27', 'last'], ['2026-11-12', 'first'], ['2026-10-01', 'first']]);
  assert.deepEqual(buildRecent(withKey, TODAY_STR).items.map((x) => x.id), [2, 1, 3]);
  assert.equal(toMeta(withKey[0]).releaseInfo, '2025'); // cards keep the first-air year
  assert.equal(withKey[0].date, '2025-05-05');
});

test('tc-recent window: 89 days in, 90 in, 91 out, future out', () => {
  const at = (id, daysAgo) => item(id, { sortDate: daysBefore(TODAY_STR, daysAgo) });
  const future = item(9, { sortDate: '2026-11-18' });
  const { items, total } = buildRecent([at(1, 89), at(2, 90), at(3, 91), at(4, 0), future], TODAY_STR);
  assert.deepEqual(items.map((x) => x.id), [4, 1, 2]);
  assert.equal(total, 3);
});

test('tc-recent: ties on the key go by popularity, repeated IMDb ids collapse', () => {
  const x = item(1, { sortDate: '2026-11-01', popularity: 1 });
  const y = item(2, { sortDate: '2026-11-01', popularity: 9 });
  const dup = item(3, { sortDate: '2026-11-01', popularity: 0.5, imdb: 'tt2' });
  assert.deepEqual(buildRecent([x, y, dup], TODAY_STR).items.map((i) => i.id), [2, 1]);
});

test('tc-recent cap: 100 titles kept, total reports the count before the cap', () => {
  const many = Array.from({ length: 150 }, (_, i) => item(i + 1, { sortDate: '2026-11-01', popularity: i }));
  const { items, total } = buildRecent(many, TODAY_STR);
  assert.equal(items.length, 100);
  assert.equal(total, 150);
  assert.equal(items[0].id, 150); // most popular of the tie
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
  assert.equal(map[3].checkedAt, TODAY_STR);
  assert.equal(map[1].checkedAt, '2026-01-01'); // untouched
  assert.ok(needsTvLookup(undefined) && needsTvLookup(map[3]) && !needsTvLookup(map[1]));
});

test('build: warm cache re-requests only non-final series', async () => {
  const p = await setup();
  const f1 = mockFetch(fakeTmdb());
  await run(p, f1);
  assert.equal(tvCalls(f1).length, 692);
  const cache = JSON.parse(await readFile(p.tvDatesPath, 'utf8'));
  assert.deepEqual(Object.keys(cache[1001]).sort(), ['checkedAt', 'first_air_date', 'last_air_date', 'status']);
  const open = Object.values(cache).filter((e) => e.status !== 'Ended' && e.status !== 'Canceled').length;
  const f2 = mockFetch(fakeTmdb());
  await run(p, f2);
  assert.equal(tvCalls(f2).length, open);
  assert.ok(open > 0 && open < 692);
  assert.ok(tvCalls(f2).every((c) => cache[new URL(c.url).pathname.split('/').pop()].status !== 'Ended'));
  assert.equal(f2.calls.filter((c) => c.url.includes('external_ids')).length, 0);
});

test('build: tc-recent is ordered by last air date, null falls back, old shows with a new season appear', async () => {
  const p = await setup();
  await run(p, mockFetch(fakeTmdb()));
  const metas = await allOf(p, 'series', 'tc-recent');
  assert.equal(metas.length, 100); // capped
  const cache = JSON.parse(await readFile(p.tvDatesPath, 'utf8'));
  const keyOf = (m) => cache[tmdbIdOf(m)].last_air_date || cache[tmdbIdOf(m)].first_air_date;
  const keys = metas.map(keyOf);
  for (let i = 1; i < keys.length; i++) assert.ok(keys[i - 1] >= keys[i], `order broken at ${i}`);
  assert.ok(keys.every((k) => k >= daysBefore(TODAY_STR, 90) && k <= TODAY_STR));
  // recent-pass shows first aired in 2025 but the card still shows that year
  const old = metas.find((m) => Number(tmdbIdOf(m)) >= 2000);
  assert.ok(old);
  assert.equal(old.releaseInfo, '2025');
  // id 1010 has a null last_air_date: its key is its first air date
  assert.equal(cache[1010].last_air_date, null);
  const status = await read(p, 'status.json');
  assert.equal(status.counts['series/tc-recent'], 100);
  assert.ok(status.seriesNew.recentBeforeCap > 100);
  assert.equal(status.seriesNew.recentAdded, 120);
  assert.ok(status.contributions['series/tc-recent']);
  assert.equal(status.counts['movie/tc-recent'], undefined);
});

test('build: a failed /tv lookup degrades, never fails the build or drops a title', async () => {
  const ok = await setup();
  await run(ok, mockFetch(fakeTmdb()));

  // cold cache and every /tv/{id} failing: the build still succeeds; keys fall back to first air date
  const bad = await setup();
  await run(bad, mockFetch(fakeTmdb({ failTv: 500 })));
  const badRecent = await allOf(bad, 'series', 'tc-recent');
  assert.equal(badRecent.length, 100);
  const status = await read(bad, 'status.json');
  assert.equal(status.seriesNew.lookupsFailed, 692);
  assert.equal(status.seriesNew.recentKeyFromFirst, 100); // every key fell back
  // the failed lookups did not drop any title from tc-new, which does not use them
  assert.deepEqual(await allOf(bad, 'series', 'tc-new'), await allOf(ok, 'series', 'tc-new'));

  // a cached entry is used when the refresh fails: id 2001 is cached with a very new date
  const warm = await setup();
  await mkdir(join(warm.root, 'data'), { recursive: true });
  await writeFile(
    warm.tvDatesPath,
    JSON.stringify({ 2001: { first_air_date: '2025-02-10', last_air_date: '2026-11-17', status: 'Returning Series', checkedAt: '2026-11-01' } }),
  );
  await run(warm, mockFetch(fakeTmdb({ failTv: 500 })));
  assert.equal((await allOf(warm, 'series', 'tc-recent'))[0].id, 'tt1002001');
  assert.equal(JSON.parse(await readFile(warm.tvDatesPath, 'utf8'))[2001].checkedAt, '2026-11-01'); // untouched
});

test('tc-new series is what main builds: the New pass by first air date, with the recent pass active', async () => {
  const p = await setup();
  await run(p, mockFetch(fakeTmdb()));
  const series = await allOf(p, 'series', 'tc-new');
  assert.equal(series.length, 288);
  // main's rule, computed independently: pass N ids with an IMDb id, first air date desc, popularity (id/1000) breaks ties
  const date = (id) => `2026-11-${String(1 + (id % 17)).padStart(2, '0')}`;
  const expected = Array.from({ length: 300 }, (_, i) => 1001 + i)
    .filter((id) => id % 25 !== 0)
    .sort((a, b) => (date(a) < date(b) ? 1 : date(a) > date(b) ? -1 : b - a))
    .map((id) => `tt${1000000 + id}`);
  assert.deepEqual(series.map((m) => m.id), expected);
  assert.ok(series.every((m) => Number(tmdbIdOf(m)) < 2000)); // nothing from the recent pass
  // and it is the same list as the movie side, which has no lookups at all
  assert.deepEqual((await allOf(p, 'movie', 'tc-new')).map((m) => m.id), expected);
});

test('tc-trending and every movie file are unaffected by tv lookups, the recent pass and tc-recent', async () => {
  const a = await setup();
  const b = await setup();
  await run(a, mockFetch(fakeTmdb()));
  await run(b, mockFetch(fakeTmdb({ failTv: 500 })));
  const files = async (d) => (await readdir(d, { recursive: true })).filter((f) => /^catalog[\\/](movie|series[\\/]tc-(trending|new))/.test(f) && f.endsWith('.json')).sort();
  const fa = await files(a.distDir);
  assert.deepEqual(fa, await files(b.distDir));
  assert.ok(fa.length > 50);
  for (const rel of fa) {
    assert.equal(await readFile(join(a.distDir, rel), 'utf8'), await readFile(join(b.distDir, rel), 'utf8'), rel);
  }
  // Trending membership never uses the recent pass (ids 2001..2160)
  const trend = (await read(a, 'catalog/series/tc-trending.json')).metas;
  assert.ok(trend.every((m) => !(Number(tmdbIdOf(m)) >= 2000 && Number(tmdbIdOf(m)) < 3000)));
  const status = await read(a, 'status.json');
  assert.deepEqual(status.contributions['series/tc-trending'], { P: 38, New: 1, genreRule: 1 });
  assert.equal(status.newestNew.series, '2026-11-17');
});

test('tc-recent page files follow the writer rules; other catalogues keep their names', async () => {
  const p = await setup();
  await run(p, mockFetch(fakeTmdb()));
  const names = async (id) => (await readdir(join(p.distDir, 'catalog', 'series', id))).sort();
  // 100 titles: base file, skip=10..90, and the empty skip=100 and skip=200 every catalogue has
  const expected = [];
  for (let k = 10; k <= 100; k += 10) expected.push(`skip=${k}.json`);
  expected.push('skip=200.json');
  assert.deepEqual(await names('tc-recent'), expected.sort());
  assert.equal((await read(p, 'catalog/series/tc-recent/skip=100.json')).metas.length, 0);
  assert.equal((await read(p, 'catalog/series/tc-recent.json')).metas.length, 100);
  assert.equal((await read(p, 'catalog/series/tc-recent/skip=10.json')).metas.length, 90);
  // tc-new (288): skip=10..280 and the empty skip=100/200 are inside that range
  const newNames = await names('tc-new');
  assert.equal(newNames.length, 28);
  assert.ok(newNames.includes('skip=280.json') && !newNames.includes('skip=290.json'));
  const manifest = await read(p, 'manifest.json');
  assert.deepEqual(manifest.catalogs.filter((c) => c.type === 'series').map((c) => [c.id, c.name]), [
    ['tc-trending', 'Trending this week'], ['tc-new', 'New'], ['tc-recent', 'New episodes'],
  ]);
  assert.equal(manifest.version, '9.9.9');
});
