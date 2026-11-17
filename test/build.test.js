import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runBuild, redactor } from '../src/build.js';
import { mockFetch } from './helpers.js';
import { fakeTmdb, TODAY } from './fake-tmdb.js';

const TOKEN = 'eyJ.SUPER-SECRET-TOKEN-VALUE.sig';

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'build-'));
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
  runBuild({ token: TOKEN, fetchImpl, now: TODAY, version: '9.9.9', sleep: async () => {}, ...paths, ...extra });

test('end to end with mocked TMDB: files, counts, sorting, trending', async () => {
  const p = await setup();
  const logs = [];
  const f = mockFetch(fakeTmdb());
  await run(p, f, { log: (m) => logs.push(m) });

  const manifest = JSON.parse(await readFile(join(p.distDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, '9.9.9');
  const status = JSON.parse(await readFile(join(p.distDir, 'status.json'), 'utf8'));
  // pools per kind: P 1..300, N 1001..1300 (+ genre-rule trending id 5001);
  // ids divisible by 25 have no IMDb id -> 12 per pass = 24 skipped
  assert.equal(status.skippedNoImdb.movie, 24);
  assert.equal(status.counts['movie/tc-new'], 288);
  assert.equal(status.padded.movie, 0);

  // new status fields: newest release date in New, and per catalogue pass contributions
  assert.deepEqual(status.newestNew, { movie: '2026-11-17', series: '2026-11-17' });
  for (const type of ['movie', 'series']) {
    // tc-new is the same for both types: the recent pass never feeds it (ADDON-5c)
    assert.deepEqual(status.contributions[`${type}/tc-new`], { P: 0, New: 288, genreRule: 0 });
    assert.equal(status.contributions[`${type}/tc-popular`], undefined);
    // 38 P hits, the New-pass title 1001, and id 5001 admitted by the genre rule alone
    assert.deepEqual(status.contributions[`${type}/tc-trending`], { P: 38, New: 1, genreRule: 1 });
  }

  const read = async (rel) => JSON.parse(await readFile(join(p.distDir, rel), 'utf8')).metas;
  // a missing page file is the end of the list (404), so it reads as empty
  const readOrEmpty = (rel) => read(rel).catch((e) => (e.code === 'ENOENT' ? [] : Promise.reject(e)));
  const pages = async (type, id) => [
    ...(await read(`catalog/${type}/${id}.json`)),
    ...(await readOrEmpty(`catalog/${type}/${id}/skip=100.json`)),
    ...(await readOrEmpty(`catalog/${type}/${id}/skip=200.json`)),
  ];
  const tmdbId = (m) => Number(m.id.slice(2)) - 1000000;
  assert.equal((await read('catalog/movie/tc-new.json')).length, 100);
  assert.equal((await read('catalog/movie/tc-new/skip=200.json')).length, 88);

  // New comes from the date pass (ids 1001..1300, low popularity), never from P,
  // and the newest title leads
  const newest = await pages('movie', 'tc-new');
  assert.ok(newest.every((m) => tmdbId(m) >= 1001 && tmdbId(m) <= 1300));
  assert.equal(newest[0].id, 'tt1001291');
  assert.ok(newest.every((m) => Number(m.releaseInfo) <= 2026));


  // Trending: P hits in trending order (300 has no IMDb id), then the union-only title
  // (1001, found by the New pass) and the genre-rule title (5001). Strangers are excluded.
  const trending = await pages('series', 'tc-trending');
  assert.equal(trending[0].id, 'tt1000299');
  assert.equal(trending[0].type, 'series');
  assert.equal(trending.length, 40);
  const ids = trending.map(tmdbId);
  assert.ok(ids.includes(1001) && ids.includes(5001));
  assert.ok(!ids.some((i) => i >= 90000));
  assert.ok(logs.length > 0);
});

test('request budget of a cold run (empty idmap), mocked', async () => {
  const p = await setup();
  const f = mockFetch(fakeTmdb());
  await run(p, f);
  const tmdbCalls = f.calls.filter((c) => new URL(c.url).hostname === 'api.themoviedb.org');
  const cinemetaCalls = f.calls.filter((c) => new URL(c.url).hostname === 'v3-cinemeta.strem.io');
  const urls = tmdbCalls.map((c) => new URL(c.url).pathname);
  const count = (re) => urls.filter((u) => re.test(u)).length;
  const keyword = count(/search\/keyword/);
  const discover = count(/\/discover\//);
  const trending = count(/\/trending\//);
  const ext = count(/external_ids/);
  const tv = count(/^\/3\/tv\/\d+$/);
  assert.deepEqual([keyword, discover, trending], [1, 86, 40]); // 127 fixed (80 + 6 recent-pass pages)
  assert.equal(ext, 2 * 601 + 120); // 600 pass titles + 1 genre-rule trending title, per kind, + 120 recent-pass titles
  assert.equal(tv, 692); // one /tv/{id} per series in the union of New, P and recent pools with an IMDb id (288 + 288 + 116)
  assert.equal(tmdbCalls.length, 2141);
  // Cinemeta: one per series in the pool that is not Ended: 144 odd New ids + 116 recent-pass ids
  assert.equal(cinemetaCalls.length, 260);
  console.log(`# cold run: ${tmdbCalls.length} TMDB + ${cinemetaCalls.length} Cinemeta requests = ${keyword} keyword + ${discover} discover + ${trending} trending + ${ext} external_ids + ${tv} tv`);
});
test('dist/ has no tc-popular file or mention, and status.json has no Popular key', async () => {
  const p = await setup();
  await run(p, mockFetch(fakeTmdb()));
  const files = await walk(p.distDir);
  // manifest, index, status + per catalogue: base file + a page per multiple of 10 below its size
  // + the empty skip=100, skip=200 and skip=<size> (when size is a multiple of 10)
  const counts = JSON.parse(await readFile(join(p.distDir, 'status.json'), 'utf8')).counts;
  const pageFiles = Object.values(counts).reduce((t, n) => {
    const skips = new Set([100, 200]);
    for (let k = 10; k < n; k += 10) skips.add(k);
    if (n % 10 === 0) skips.add(n);
    return t + 1 + skips.size;
  }, 0);
  assert.equal(files.length, 3 + pageFiles);
  for (const file of files) {
    assert.ok(!file.toLowerCase().includes('popular'), file);
    assert.ok(!(await readFile(file, 'utf8')).includes('tc-popular'), file);
  }
  const manifest = JSON.parse(await readFile(join(p.distDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.catalogs.length, 5);
  const status = JSON.parse(await readFile(join(p.distDir, 'status.json'), 'utf8'));
  assert.deepEqual(Object.keys(status.counts), ['movie/tc-trending', 'movie/tc-new', 'series/tc-trending', 'series/tc-new', 'series/tc-recent']);
  assert.deepEqual(Object.keys(status.contributions).sort(), Object.keys(status.counts).sort());
  assert.ok(!JSON.stringify(status).toLowerCase().includes('popular'));
});

test('idmap is written and reused: second run resolves nothing new', async () => {
  const p = await setup();
  const f1 = mockFetch(fakeTmdb());
  await run(p, f1);
  const map = JSON.parse(await readFile(p.idmapPath, 'utf8'));
  assert.equal(map['movie:1'], 'tt1000001');
  assert.equal(map['movie:25'], null);
  const f2 = mockFetch(fakeTmdb());
  await run(p, f2);
  assert.equal(f2.calls.filter((c) => c.url.includes('external_ids')).length, 0);
});

test('padding is recorded in status.json when trending overlap is small', async () => {
  const p = await setup();
  await run(p, mockFetch(fakeTmdb({ trendingHits: 5 })));
  const status = JSON.parse(await readFile(join(p.distDir, 'status.json'), 'utf8'));
  // 5 P hits (id 300 has no IMDb id -> 4) plus the union title and the genre-rule title = 6 qualified
  assert.equal(status.padded.movie, 14);
  assert.equal(status.counts['movie/tc-trending'], 20);
});

test('failure rule: under 20 items exits via error and writes nothing to dist', async () => {
  const p = await setup();
  // only a handful of items have IMDb ids -> every catalogue is short
  await assert.rejects(run(p, mockFetch(fakeTmdb({ nullEvery: 1 }))), /under 20/);
  await assert.rejects(stat(p.distDir));
});

test('a failed run does not replace an existing good dist', async () => {
  const p = await setup();
  await mkdir(p.distDir, { recursive: true });
  await writeFile(join(p.distDir, 'manifest.json'), 'GOOD');
  await assert.rejects(run(p, mockFetch(fakeTmdb({ fail: 500 })), { }));
  assert.equal(await readFile(join(p.distDir, 'manifest.json'), 'utf8'), 'GOOD');
  await assert.rejects(run(p, mockFetch(fakeTmdb({ nullEvery: 1 }))));
  assert.equal(await readFile(join(p.distDir, 'manifest.json'), 'utf8'), 'GOOD');
});

test('wrong keyword id stops the build before any discover call', async () => {
  const p = await setup();
  const f = mockFetch(fakeTmdb({ keywordName: 'cooking' }));
  await assert.rejects(run(p, f), /33722/);
  assert.ok(f.calls.every((c) => c.url.includes('/search/keyword')));
  await assert.rejects(stat(p.distDir));
});

test('secret scan: token appears nowhere in dist/, logs, idmap or error text', async () => {
  const p = await setup();
  const logs = [];
  const f = mockFetch(fakeTmdb());
  await run(p, f, { log: (m) => logs.push(m) });
  for (const file of [...(await walk(p.distDir)), p.idmapPath]) {
    assert.ok(!(await readFile(file, 'utf8')).includes(TOKEN), `token leaked into ${file}`);
  }
  assert.ok(!logs.join('\n').includes(TOKEN));
  // the token goes only in the header, never in a URL
  assert.ok(f.calls.every((c) => !c.url.includes(TOKEN) && !c.url.includes('api_key')));
  // TMDB and Cinemeta are the only hosts; the token goes only to TMDB, in a header
  const host = (c) => new URL(c.url).hostname;
  assert.ok(f.calls.every((c) => ['api.themoviedb.org', 'v3-cinemeta.strem.io'].includes(host(c))));
  assert.ok(f.calls.some((c) => host(c) === 'v3-cinemeta.strem.io'));
  assert.ok(f.calls.filter((c) => host(c) === 'v3-cinemeta.strem.io').every((c) => !JSON.stringify(c.opts ?? {}).includes(TOKEN) && !c.opts?.headers?.Authorization));

  const p2 = await setup();
  try {
    await run(p2, mockFetch(fakeTmdb({ fail: 500 })));
    assert.fail('should throw');
  } catch (e) {
    assert.ok(!e.message.includes(TOKEN));
  }
});

test('redactor replaces the token in any string', () => {
  assert.equal(redactor('abc')('x abc y abc'), 'x [redacted] y [redacted]');
  assert.equal(redactor('')('plain'), 'plain');
});

test('manifest version comes from package.json (0.1.4: tc-recent uses Cinemeta dates)', async () => {
  const p = await setup();
  await run(p, mockFetch(fakeTmdb()), { version: undefined });
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const manifest = JSON.parse(await readFile(join(p.distDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, pkg.version);
  assert.equal(pkg.version, '0.1.4');
});
