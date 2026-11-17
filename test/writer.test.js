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
  movie: { 'tc-trending': metas(n), 'tc-new': metas(n), 'tc-popular': metas(n) },
  series: { 'tc-trending': metas(n), 'tc-new': metas(n), 'tc-popular': metas(n) },
});
const plan = (n) =>
  planOutput({
    version: '1.2.3', builtAt: '2026-11-17T00:00:00.000Z', catalogs: cats(n),
    skippedNoImdb: { movie: 4, series: 2 }, padded: { movie: 0, series: 5 },
  });

test('manifest shape', () => {
  const m = buildManifest('1.2.3');
  assert.equal(m.id, 'org.allistair.truecrime');
  assert.equal(m.version, '1.2.3');
  assert.equal(m.name, 'True Crime Documentaries');
  assert.deepEqual(m.resources, ['catalog']);
  assert.deepEqual(m.types, ['movie', 'series']);
  assert.equal(m.catalogs.length, 6);
  assert.ok(!('addonCatalogs' in m) && !('idPrefixes' in m));
});

test('catalogue ids, names, types and extra', () => {
  const m = buildManifest('1.0.0');
  for (const type of ['movie', 'series']) {
    const mine = m.catalogs.filter((c) => c.type === type);
    assert.deepEqual(mine.map((c) => c.id), ['tc-trending', 'tc-new', 'tc-popular']);
    assert.deepEqual(mine.map((c) => c.name), ['Trending this week', 'New', 'Popular']);
  }
  for (const c of m.catalogs) assert.deepEqual(c.extra, [{ name: 'skip' }]); // no search, no genre
});

test('paging file names and sizes are 100, 100, 100', () => {
  const files = plan(300);
  for (const type of ['movie', 'series']) {
    for (const id of ['tc-trending', 'tc-new', 'tc-popular']) {
      const sizes = [
        `catalog/${type}/${id}.json`,
        `catalog/${type}/${id}/skip=100.json`,
        `catalog/${type}/${id}/skip=200.json`,
      ].map((p) => {
        assert.ok(files.has(p), `missing ${p}`);
        return JSON.parse(files.get(p)).metas.length;
      });
      assert.deepEqual(sizes, [100, 100, 100]);
    }
  }
  assert.ok(![...files.keys()].some((k) => k.includes('skip=300')));
});

test('pages are consecutive slices and short lists leave empty tail pages', () => {
  const files = plan(150);
  const p0 = JSON.parse(files.get('catalog/movie/tc-new.json')).metas;
  const p1 = JSON.parse(files.get('catalog/movie/tc-new/skip=100.json')).metas;
  const p2 = JSON.parse(files.get('catalog/movie/tc-new/skip=200.json')).metas;
  assert.deepEqual([p0.length, p1.length, p2.length], [100, 50, 0]);
  assert.equal(p0[99].id, 'tt99');
  assert.equal(p1[0].id, 'tt100');
});

test('status.json has build time, counts, skipped and padded', () => {
  const s = JSON.parse(plan(25).get('status.json'));
  assert.equal(s.builtAt, '2026-11-17T00:00:00.000Z');
  assert.equal(s.counts['movie/tc-new'], 25);
  assert.equal(Object.keys(s.counts).length, 6);
  assert.deepEqual(s.skippedNoImdb, { movie: 4, series: 2 });
  assert.deepEqual(s.padded, { movie: 0, series: 5 });
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
  c.series['tc-new'] = metas(19);
  assert.throws(() => assertMinimums(c), (e) => e instanceof BuildError && /series\/tc-new=19/.test(e.message));
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
