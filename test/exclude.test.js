// ADDON-5h: exclusion list, new keyword sets, check script. No network: mocked TMDB only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runBuild } from '../src/build.js';
import { parseExclude, ExcludeError } from '../src/exclude.js';
import { mockFetch } from './helpers.js';
import { fakeTmdb, TODAY } from './fake-tmdb.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

async function setup(exclude) {
  const root = await mkdtemp(join(tmpdir(), 'x5h-'));
  const excludePath = join(root, 'exclude.json');
  if (exclude !== undefined) await writeFile(excludePath, typeof exclude === 'string' ? exclude : JSON.stringify(exclude));
  return { root, excludePath, distDir: join(root, 'dist'), idmapPath: join(root, 'data', 'idmap.json'), tvDatesPath: join(root, 'data', 'tvdates.json') };
}
const run = (p, fetchImpl = mockFetch(fakeTmdb({ extras: true }))) =>
  runBuild({ token: 'tok', fetchImpl, now: TODAY, version: '9.9.9', sleep: async () => {}, ...p });
const read = async (p, rel) => JSON.parse(await readFile(join(p.distDir, rel), 'utf8'));
const idsOf = (metas) => metas.map((m) => Number(m.id.slice(2)) - 1000000);
const catalogFiles = async (p, type, cat) => {
  const skips = await readdir(join(p.distDir, 'catalog', type, cat)).catch(() => []);
  return [`catalog/${type}/${cat}.json`, ...skips.map((f) => `catalog/${type}/${cat}/${f}`)];
};
const allIds = async (p, type, cat) => {
  const ids = [];
  for (const rel of await catalogFiles(p, type, cat)) ids.push(...idsOf((await read(p, rel)).metas));
  return ids;
};

test('new sets: with_genres=99 and the listed keyword; none in a popularity pass; smuggling tv only', async () => {
  const p = await setup('{"movie":[],"series":[]}');
  const f = mockFetch(fakeTmdb({ extras: true }));
  await run(p, f);
  const calls = f.calls.map((c) => new URL(c.url)).filter((u) => u.pathname.includes('/discover/'));
  const newKw = ['6019', '2149', '10175', '10291', '208458', '294521'];
  const mine = calls.filter((u) => newKw.includes(u.searchParams.get('with_keywords')));
  assert.ok(mine.length > 0);
  for (const u of mine) {
    assert.equal(u.searchParams.get('with_genres'), '99');
    const popOnly = u.searchParams.get('sort_by') === 'popularity.desc' && !u.searchParams.has('air_date.gte');
    assert.equal(popOnly, false, 'no popularity pass');
  }
  const count = (kw, kind, pred) => mine.filter((u) => u.searchParams.get('with_keywords') === kw && u.pathname.endsWith(`/${kind}`) && pred(u)).length;
  for (const kw of newKw.slice(0, 5)) {
    assert.equal(count(kw, 'movie', () => true), 10, `${kw} movie: New pass only, 10 pages`);
    assert.equal(count(kw, 'tv', (u) => !u.searchParams.has('air_date.gte')), 10, `${kw} tv New`);
    assert.equal(count(kw, 'tv', (u) => u.searchParams.has('air_date.gte')), 3, `${kw} tv recent`);
  }
  assert.equal(count('294521', 'movie', () => true), 0);
  assert.equal(count('294521', 'tv', () => true), 13);
});

test('an excluded id never appears in any list or skip page, either type', async () => {
  const gone = { movie: [1001, 299, 10301], series: [1003, 298, 10302, 2001] };
  const p = await setup(gone);
  await run(p);
  for (const type of ['movie', 'series']) {
    for (const cat of ['tc-new', 'tc-trending', 'tc-recent']) {
      if (type === 'movie' && cat === 'tc-recent') continue;
      const ids = await allIds(p, type, cat);
      assert.ok(ids.length > 0, `${type}/${cat} not empty`);
      for (const id of gone[type]) assert.ok(!ids.includes(id), `${type}/${cat} still has ${id}`);
    }
  }
});

test('an exclusion on one type leaves the other type alone', async () => {
  const p = await setup({ movie: [], series: [299] });
  await run(p);
  assert.ok((await allIds(p, 'movie', 'tc-trending')).includes(299));
  assert.ok(!(await allIds(p, 'series', 'tc-trending')).includes(299));
});

test('invalid exclude.json fails the build with a clear message, before any request, writing nothing', async () => {
  for (const [text, msg] of [
    ['{"movie": [1, 2,', /not valid JSON/],
    ['{"movie": ["12"], "series": []}', /not a positive integer/],
    ['{"movie": [1.5], "series": []}', /not a positive integer/],
    ['{"movie": [], "series": [null]}', /not a positive integer/],
    ['{"movies": []}', /unknown key "movies"/],
    ['[1,2]', /must be a JSON object/],
  ]) {
    const p = await setup(text);
    const f = mockFetch(fakeTmdb({ extras: true }));
    await assert.rejects(run(p, f), (e) => e instanceof ExcludeError && msg.test(e.message), text);
    assert.equal(f.calls.length, 0);
    await assert.rejects(readdir(p.distDir));
  }
});

test('empty exclude list: tc-trending (both types) is byte-identical to a build without the file', async () => {
  const none = await setup(); // no file at all = nothing excluded
  const empty = await setup('{"movie":[],"series":[],"names":{}}');
  await run(none);
  await run(empty);
  for (const type of ['movie', 'series']) {
    const rels = await catalogFiles(none, type, 'tc-trending');
    assert.ok(rels.length > 1);
    for (const rel of rels) {
      assert.equal(await readFile(join(empty.distDir, rel), 'utf8'), await readFile(join(none.distDir, rel), 'utf8'), rel);
    }
  }
});

test('tc-trending with the list differs only where an excluded title was in it', async () => {
  const none = await setup('{"movie":[],"series":[]}');
  const some = await setup({ movie: [299, 298], series: [] });
  await run(none);
  await run(some);
  // skip pages overlap, so compare the base files (the first page of the same list)
  const a = idsOf((await read(none, 'catalog/movie/tc-trending.json')).metas);
  const b = idsOf((await read(some, 'catalog/movie/tc-trending.json')).metas);
  assert.ok(a.includes(299) && a.includes(298));
  const full = (await read(none, 'status.json')).counts['movie/tc-trending'];
  assert.equal((await read(some, 'status.json')).counts['movie/tc-trending'], full - 2);
  assert.deepEqual(b.slice(0, 5), a.filter((id) => id !== 299 && id !== 298).slice(0, 5));
  for (const rel of await catalogFiles(none, 'series', 'tc-trending')) {
    assert.equal(await readFile(join(some.distDir, rel), 'utf8'), await readFile(join(none.distDir, rel), 'utf8'), rel);
  }
});

test('parseExclude accepts names and returns sets', () => {
  const ex = parseExclude('{"movie":[5],"series":[6,7],"names":{"5":"A"}}');
  assert.deepEqual([...ex.movie], [5]);
  assert.deepEqual([...ex.series], [6, 7]);
});

test('check script passes on the seeded config/exclude.json, needs no token, and fails on a bad file', async () => {
  const env = { ...process.env };
  delete env.TMDB_TOKEN;
  const ok = spawnSync(process.execPath, [join(ROOT, 'scripts', 'check-exclude.js')], { encoding: 'utf8', env });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /14 movie ids, 4 series ids/);
  const seeded = JSON.parse(await readFile(join(ROOT, 'config', 'exclude.json'), 'utf8'));
  assert.equal(Object.keys(seeded.names).length, 18);
  const p = await setup('{"movie": ["x"]}');
  const bad = spawnSync(process.execPath, [join(ROOT, 'scripts', 'check-exclude.js'), p.excludePath], { encoding: 'utf8', env });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /not a positive integer/);
});
