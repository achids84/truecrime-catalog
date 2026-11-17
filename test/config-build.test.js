// Config-driven build: golden output for the shipped config, and the "discover" kind.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { runBuild } from '../src/build.js';
import { loadConfig } from '../src/config.js';
import { buildDiscover, discoverParams, discoverSort } from '../src/universe.js';
import { createClient } from '../src/tmdb.js';
import { mockFetch } from './helpers.js';
import { fakeTmdb, TODAY } from './fake-tmdb.js';

const TODAY_ISO = '2026-11-17';
const base = { types: ['movie', 'series'], enabled: true };
const trending = { id: 'tc-trending', name: 'Trending this week', kind: 'trending', ...base };
const newest = { id: 'tc-new', name: 'New', kind: 'new', ...base };
const discover = (o = {}) => ({ id: 'tc-top', name: 'Top', kind: 'discover', ...base, ...o });

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'cfgbuild-'));
  return { root, distDir: join(root, 'dist'), idmapPath: join(root, 'data', 'idmap.json') };
}
async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}
const run = (paths, fetchImpl, extra = {}) =>
  runBuild({ token: 'tok', fetchImpl, now: TODAY, version: '9.9.9', sleep: async () => {}, ...paths, ...extra });
const readJson = async (p, rel) => JSON.parse(await readFile(join(p.distDir, rel), 'utf8'));

test('golden: the shipped config gives byte for byte the output of main@c0322af', async () => {
  const golden = JSON.parse(await readFile(new URL('./golden/shipped-output.json', import.meta.url), 'utf8'));
  delete golden._source;
  const p = await setup();
  await run(p, mockFetch(fakeTmdb())); // no config passed: config/catalogues.json is read
  const actual = {};
  for (const f of (await walk(p.distDir)).sort()) {
    actual[relative(p.distDir, f).replaceAll('\\', '/')] = createHash('sha256').update(await readFile(f)).digest('hex');
  }
  assert.deepEqual(actual, golden);
});

test('a disabled catalogue makes no requests and no files', async () => {
  const p = await setup();
  const cfg = await loadConfig();
  const f = mockFetch(fakeTmdb());
  await run(p, f, { config: cfg });
  assert.ok(!f.calls.some((c) => c.url.includes('vote_average')));
  assert.ok(!(await walk(p.distDir)).some((x) => x.includes('tc-top-rated')));
});

test('an invalid config stops the build before any TMDB call and writes nothing', async () => {
  const p = await setup();
  const f = mockFetch(fakeTmdb());
  const bad = { catalogues: [{ ...trending, id: 'tc-trending' }, { ...newest, kind: 'popular' }] };
  await assert.rejects(run(p, f, { config: bad }), /catalogues\[1\]\.kind: must be one of trending, new, discover/);
  assert.equal(f.calls.length, 0);
  await assert.rejects(stat(p.distDir));
});

test('discover: filters reach the TMDB request, and the true crime keyword is always ANDed in', () => {
  const spec = discover({
    sort: 'vote_average.desc', minVotes: 150, yearFrom: 2000, yearTo: 2020, language: 'en',
    genresAll: [99, 80], keywordsAll: [555, 7],
  });
  assert.deepEqual(discoverParams('movie', spec, TODAY_ISO), {
    sort_by: 'vote_average.desc',
    with_keywords: '33722,555,7',
    with_genres: '99,80',
    'vote_count.gte': '150',
    with_original_language: 'en',
    'primary_release_date.gte': '2000-01-01',
    'primary_release_date.lte': '2020-12-31',
  });
  const tv = discoverParams('tv', spec, TODAY_ISO);
  assert.equal(tv['first_air_date.gte'], '2000-01-01');
  assert.equal(tv['first_air_date.lte'], '2020-12-31');
  assert.ok(!('primary_release_date.gte' in tv));

  // nothing but the keyword when no filter is set
  assert.deepEqual(discoverParams('tv', discover(), TODAY_ISO), { sort_by: 'popularity.desc', with_keywords: '33722' });
  // listing 33722 yourself does not repeat it
  assert.equal(discoverParams('tv', discover({ keywordsAll: [33722, 9] }), TODAY_ISO).with_keywords, '33722,9');
  // minVotes 0 sends nothing; AND uses commas, never a pipe (OR)
  assert.ok(!('vote_count.gte' in discoverParams('tv', discover({ minVotes: 0 }), TODAY_ISO)));
  assert.ok(!JSON.stringify(discoverParams('tv', spec, TODAY_ISO)).includes('|'));
});

test('discover: a date sort maps to the type and never lists unreleased titles', () => {
  assert.equal(discoverSort('movie', 'first_air_date.desc'), 'primary_release_date.desc');
  assert.equal(discoverSort('tv', 'primary_release_date.desc'), 'first_air_date.desc');
  assert.equal(discoverSort('tv', undefined), 'popularity.desc');
  const m = discoverParams('movie', discover({ sort: 'primary_release_date.desc' }), TODAY_ISO);
  assert.equal(m.sort_by, 'primary_release_date.desc');
  assert.equal(m['primary_release_date.lte'], TODAY_ISO);
  const t = discoverParams('tv', discover({ sort: 'primary_release_date.desc', yearTo: 2030 }), TODAY_ISO);
  assert.equal(t.sort_by, 'first_air_date.desc');
  assert.equal(t['first_air_date.lte'], TODAY_ISO); // today wins over a later yearTo
  const old = discoverParams('tv', discover({ sort: 'first_air_date.desc', yearTo: 2015 }), TODAY_ISO);
  assert.equal(old['first_air_date.lte'], '2015-12-31');
});

test('discover: the request on the wire has every filter and pages 1..n', async () => {
  const f = mockFetch(fakeTmdb());
  const client = createClient({ token: 'tok', fetchImpl: f, sleep: async () => {} });
  const items = await buildDiscover(client, 'movie', discover({ sort: 'vote_average.desc', minVotes: 50, genresAll: [99], limit: 45 }), TODAY_ISO);
  const urls = f.calls.map((c) => new URL(c.url));
  assert.ok(urls.every((u) => u.pathname === '/3/discover/movie'));
  assert.deepEqual(urls.map((u) => u.searchParams.get('page')).sort(), ['1', '2', '3']); // ceil(45 * 1.15 / 20)
  for (const u of urls) {
    assert.equal(u.searchParams.get('sort_by'), 'vote_average.desc');
    assert.equal(u.searchParams.get('with_keywords'), '33722');
    assert.equal(u.searchParams.get('with_genres'), '99');
    assert.equal(u.searchParams.get('vote_count.gte'), '50');
    assert.equal(u.searchParams.get('include_adult'), 'false');
  }
  assert.equal(items.length, 60);
  assert.equal(items[0].id, 2001); // TMDB order kept
});

test('discover: limit and skip paging through the build', async () => {
  const p = await setup();
  const cfg = { catalogues: [trending, discover({ id: 'tc-top', sort: 'vote_average.desc', limit: 250, types: ['movie'] }), discover({ id: 'tc-few', sort: 'vote_average.desc', limit: 30, types: ['series'] })] };
  const f = mockFetch(fakeTmdb({ nullEvery: 0 }));
  await run(p, f, { config: cfg });

  const page = async (rel) => (await readJson(p, rel)).metas;
  assert.equal((await page('catalog/movie/tc-top.json')).length, 100);
  assert.equal((await page('catalog/movie/tc-top/skip=100.json')).length, 100);
  assert.equal((await page('catalog/movie/tc-top/skip=200.json')).length, 50);
  await assert.rejects(stat(join(p.distDir, 'catalog/movie/tc-top/skip=300.json')));
  const first = (await page('catalog/movie/tc-top.json'))[0];
  assert.equal(first.id, 'tt1002001'); // vote order of the first TMDB page, not re-sorted by popularity
  assert.equal(first.type, 'movie');

  assert.equal((await page('catalog/series/tc-few.json')).length, 30); // limit cuts the extra pages' titles
  await assert.rejects(stat(join(p.distDir, 'catalog/series/tc-few/skip=100.json')));
  // trending still has its 3 pages
  await readJson(p, 'catalog/movie/tc-trending/skip=200.json');

  // discover requests: 250 -> ceil(250*1.15/20) = 15 pages for movie, 30 -> 2 for series
  const votePages = (kind) => f.calls.map((c) => new URL(c.url)).filter((u) => u.pathname.endsWith(kind) && u.searchParams.get('sort_by') === 'vote_average.desc').length;
  assert.equal(votePages('/discover/movie'), 15);
  assert.equal(votePages('/discover/tv'), 2);
  const status = await readJson(p, 'status.json');
  assert.deepEqual(Object.keys(status.counts), ['movie/tc-trending', 'movie/tc-top', 'series/tc-trending', 'series/tc-few']);
  assert.equal(status.counts['movie/tc-top'], 250);
  assert.equal(status.contributions['movie/tc-top'], undefined);
});

test('discover alone: no trending or pass requests are made', async () => {
  const p = await setup();
  const f = mockFetch(fakeTmdb({ nullEvery: 0 }));
  await run(p, f, { config: { catalogues: [discover({ limit: 40, types: ['series'] })] } });
  assert.ok(!f.calls.some((c) => c.url.includes('/trending/') || c.url.includes('/discover/movie')));
  const status = await readJson(p, 'status.json');
  assert.deepEqual(status.counts, { 'series/tc-top': 40 });
  assert.deepEqual(status.padded, {});
  assert.deepEqual(status.newestNew, { series: null });
});

test('a discover catalogue under 20 items fails the build and names it', async () => {
  const p = await setup();
  await assert.rejects(
    run(p, mockFetch(fakeTmdb({ nullEvery: 0 })), { config: { catalogues: [discover({ limit: 10 })] } }),
    /movie\/tc-top=10/,
  );
  await assert.rejects(stat(p.distDir));
});
