import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildManifest, planOutput, writeDist, assertMinimums, BuildError, renderIndexHtml, TMDB_ATTRIBUTION,
} from '../src/writer.js';

const metas = (n, prefix = 'tt') =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, type: 'movie', name: `n${i}` }));
const cats = (n) => ({
  movie: { 'tc-trending': metas(n), 'tc-new': metas(n) },
  series: { 'tc-trending': metas(n), 'tc-recent': metas(n) },
});
const plan = (n) =>
  planOutput({
    version: '1.2.3', builtAt: '2026-11-17T00:00:00.000Z', catalogs: cats(n),
    skippedNoImdb: { movie: 4, series: 2 }, padded: { movie: 0, series: 5 },
    newestNew: { movie: '2026-11-16', series: null },
    contributions: { 'movie/tc-new': { P: 1, New: 25, genreRule: 0 } },
  });

test('manifest shape', () => {
  const m = buildManifest('1.2.3');
  assert.equal(m.id, 'org.allistair.truecrime');
  assert.equal(m.version, '1.2.3');
  assert.equal(m.name, 'True Crime Documentaries');
  assert.deepEqual(m.resources, ['catalog']);
  assert.deepEqual(m.types, ['movie', 'series']);
  assert.equal(m.catalogs.length, 4); // 2 movie + series tc-recent and tc-trending
  assert.ok(!('addonCatalogs' in m) && !('idPrefixes' in m));
});

test('no tc-popular anywhere in the manifest or the planned files', () => {
  const m = buildManifest('1.0.0');
  assert.ok(!JSON.stringify(m).includes('tc-popular'));
  assert.ok(!JSON.stringify(m).toLowerCase().includes('popular'));
  assert.deepEqual(m.catalogs.map((c) => `${c.type}/${c.id}`), [
    'movie/tc-trending', 'movie/tc-new', 'series/tc-recent', 'series/tc-trending',
  ]);
  const files = plan(30);
  assert.ok([...files.keys()].every((k) => !k.includes('popular')));
  assert.ok([...files.values()].every((v) => !v.includes('tc-popular')));
});

test('catalogue ids, names, types and extra', () => {
  const m = buildManifest('1.0.0');
  for (const type of ['movie', 'series']) {
    const mine = m.catalogs.filter((c) => c.type === type);
    // series: New episodes first, then Trending, no series tc-new; movies: Trending then New
    assert.deepEqual(mine.map((c) => c.id), type === 'series' ? ['tc-recent', 'tc-trending'] : ['tc-trending', 'tc-new']);
    assert.deepEqual(mine.map((c) => c.name), type === 'series' ? ['New episodes', 'Trending this week'] : ['Trending this week', 'New']);
  }
  for (const c of m.catalogs) assert.deepEqual(c.extra, [{ name: 'skip' }]); // no search, no genre
});

const ids = (files, path) => JSON.parse(files.get(path)).metas.map((m) => m.id);
const skips = (files, type = 'movie', id = 'tc-new') =>
  [...files.keys()]
    .filter((k) => k.startsWith(`catalog/${type}/${id}/skip=`))
    .map((k) => Number(/skip=(\d+)\.json$/.exec(k)[1]))
    .sort((x, y) => x - y);

test('base, skip=100 and skip=200 keep their old content for a 300 list', () => {
  const files = plan(300);
  for (const type of ['movie', 'series']) {
    for (const id of type === 'series' ? ['tc-trending', 'tc-recent'] : ['tc-trending', 'tc-new']) {
      const all = cats(300)[type][id];
      const json = (m) => JSON.stringify({ metas: m }) + '\n';
      assert.equal(files.get(`catalog/${type}/${id}.json`), json(all.slice(0, 100)));
      assert.equal(files.get(`catalog/${type}/${id}/skip=100.json`), json(all.slice(100, 200)));
      assert.equal(files.get(`catalog/${type}/${id}/skip=200.json`), json(all.slice(200, 300)));
      assert.equal(files.get(`catalog/${type}/${id}/skip=300.json`), EMPTY); // end-of-list page
    }
  }
});

test('pages exist at every multiple of 10 and hold the right slices', () => {
  const files = plan(245);
  const p = (n) => ids(files, `catalog/movie/tc-new/skip=${n}.json`);
  assert.equal(p(30).length, 100);
  assert.equal(p(30)[0], 'tt30');
  assert.equal(p(30)[99], 'tt129');
  assert.equal(p(130)[0], 'tt130');
  assert.equal(p(130).length, 100);
  assert.equal(p(230)[0], 'tt230');
  assert.equal(p(230).length, 15); // last partial page
  assert.equal(p(240).length, 5);
  assert.deepEqual(skips(files), Array.from({ length: 24 }, (_, i) => (i + 1) * 10));
});

const EMPTY = '{"metas":[]}\n'; // the old writer's empty page, byte for byte

test('no real page at or beyond the list size; an empty page only where a client needs one', () => {
  const f226 = plan(226);
  assert.ok(f226.has('catalog/movie/tc-new/skip=220.json'));
  assert.equal(ids(f226, 'catalog/movie/tc-new/skip=220.json').length, 6);
  assert.ok(!f226.has('catalog/movie/tc-new/skip=230.json'));
  assert.ok(!f226.has('catalog/movie/tc-new/skip=226.json'));
  assert.deepEqual(skips(f226).filter((n) => n >= 230), []);
  assert.ok(plan(245).has('catalog/series/tc-trending/skip=240.json'));
  assert.ok(!plan(245).has('catalog/series/tc-trending/skip=250.json'));
  const f200 = plan(200);
  assert.ok(f200.has('catalog/movie/tc-new/skip=190.json'));
  assert.equal(f200.get('catalog/movie/tc-new/skip=200.json'), EMPTY); // size 200: end-of-list page
});

test('a list of 20: base, skip=10, empty skip=20, and the legacy empty skip=100 and skip=200', () => {
  const files = plan(20);
  assert.ok(files.has('catalog/movie/tc-new.json'));
  assert.deepEqual(skips(files), [10, 20, 100, 200]);
  assert.equal(ids(files, 'catalog/movie/tc-new/skip=10.json').length, 10);
  for (const n of [20, 100, 200]) assert.equal(files.get(`catalog/movie/tc-new/skip=${n}.json`), EMPTY);
});

test('lists of 226 and 245 get no empty page: sizes are not multiples of 10', () => {
  for (const n of [226, 245]) {
    const files = plan(n);
    for (const k of skips(files)) {
      assert.notEqual(files.get(`catalog/movie/tc-new/skip=${k}.json`), EMPTY, `skip=${k}`);
    }
  }
});

test('a list of 150 keeps an empty skip=200 as before', () => {
  const files = plan(150);
  assert.equal(files.get('catalog/movie/tc-new/skip=200.json'), EMPTY);
  assert.equal(ids(files, 'catalog/movie/tc-new/skip=100.json').length, 50);
});

test('no page file for a skip that is not a multiple of 10', () => {
  for (const f of [plan(20), plan(226), plan(245)]) {
    for (const k of f.keys()) {
      const m = /skip=(\d+)\.json$/.exec(k);
      if (m) assert.equal(Number(m[1]) % 10, 0, k);
    }
    assert.ok(!f.has('catalog/movie/tc-new/skip=35.json'));
  }
});

test('status.json has build time, counts, skipped and padded', () => {
  const s = JSON.parse(plan(25).get('status.json'));
  assert.equal(s.builtAt, '2026-11-17T00:00:00.000Z');
  assert.equal(s.counts['movie/tc-new'], 25);
  assert.equal(Object.keys(s.counts).length, 4);
  assert.deepEqual(s.skippedNoImdb, { movie: 4, series: 2 });
  assert.deepEqual(s.padded, { movie: 0, series: 5 });
  assert.deepEqual(s.newestNew, { movie: '2026-11-16', series: null });
  assert.deepEqual(s.contributions['movie/tc-new'], { P: 1, New: 25, genreRule: 0 });
});

test('index.html carries the TMDB attribution line and install link code', () => {
  const html = renderIndexHtml();
  assert.ok(html.includes(TMDB_ATTRIBUTION));
  assert.equal(TMDB_ATTRIBUTION, 'This product uses the TMDB API but is not endorsed or certified by TMDB.');
  assert.ok(html.includes('stremio://'));
  assert.ok(html.includes('manifest.json'));
});

test('failure rule: any catalogue under 20 throws and names it', () => {
  assert.doesNotThrow(() => assertMinimums(cats(20)));
  const c = cats(50);
  c.movie['tc-new'] = metas(19);
  assert.throws(() => assertMinimums(c), (e) => e instanceof BuildError && /movie\/tc-new=19/.test(e.message));
  // series tc-recent is exempt, and series needs no tc-new
  const d = cats(50);
  d.series['tc-recent'] = metas(3);
  assert.doesNotThrow(() => assertMinimums(d));
  delete d.series['tc-recent'];
  assert.doesNotThrow(() => assertMinimums(d));
  d.series['tc-trending'] = metas(19);
  assert.throws(() => assertMinimums(d), (e) => e instanceof BuildError && /series\/tc-trending=19/.test(e.message));
  // no series tc-new file is planned even if a caller passes the list
  const e2 = cats(30);
  e2.series['tc-new'] = metas(30);
  const planned = planOutput({ version: '1', builtAt: 'x', catalogs: e2, skippedNoImdb: {}, padded: {}, newestNew: {}, contributions: {} });
  assert.ok([...planned.keys()].every((k) => !k.includes('series/tc-new')));
  assert.throws(() => assertMinimums({ movie: {}, series: {} }), BuildError);
});

test('writeDist writes every planned file and replaces old content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dist-'));
  const dist = join(root, 'dist');
  await mkdir(dist);
  await writeFile(join(dist, 'stale.txt'), 'old');
  const files = plan(30);
  await writeDist(dist, files);
  assert.equal(JSON.parse(await readFile(join(dist, 'manifest.json'), 'utf8')).version, '1.2.3');
  await assert.rejects(stat(join(dist, 'stale.txt')));
  assert.deepEqual((await readdir(root)).sort(), ['dist']); // no temp dir left behind
});
