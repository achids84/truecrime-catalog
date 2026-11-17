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
  // 300 in U per kind, ids divisible by 25 have no IMDb id -> 12 skipped
  assert.equal(status.skippedNoImdb.movie, 12);
  assert.equal(status.counts['movie/tc-popular'], 288);
  assert.equal(status.padded.movie, 0);

  const read = async (rel) => JSON.parse(await readFile(join(p.distDir, rel), 'utf8')).metas;
  const popular = await read('catalog/movie/tc-popular.json');
  assert.equal(popular.length, 100);
  assert.equal((await read('catalog/movie/tc-popular/skip=200.json')).length, 88);

  // New never lists the future (ids divisible by 7 are dated 2027)
  const newest = [];
  for (const rel of ['catalog/movie/tc-new.json', 'catalog/movie/tc-new/skip=100.json', 'catalog/movie/tc-new/skip=200.json'])
    newest.push(...(await read(rel)));
  assert.ok(newest.every((m) => Number(m.releaseInfo) <= 2026));

  // Trending starts with trending order: ids 300, 299, ... (300 and 275/250/... lack IMDb ids)
  const trending = await read('catalog/series/tc-trending.json');
  assert.equal(trending[0].id, 'tt1000299');
  assert.equal(trending[0].type, 'series');
  assert.ok(logs.length > 0);
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
  assert.equal(status.padded.movie, 16); // 5 trending hits, id 300 has no IMDb id -> 4 kept, 16 padded
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
  assert.ok(f.calls.every((c) => c.url.startsWith('https://api.themoviedb.org/')));

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
