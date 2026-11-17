// ADDON-5e: extra discover sets (cold case, serial killer, murder), genre 99 required.
// No network: mocked TMDB only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runBuild } from '../src/build.js';
import { EXTRA_KEYWORD_SETS, buildExtraPass, buildExtraRecentPass } from '../src/universe.js';
import { createClient } from '../src/tmdb.js';
import { mockFetch } from './helpers.js';
import { fakeTmdb, TODAY } from './fake-tmdb.js';

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'x5e-'));
  return { root, distDir: join(root, 'dist'), idmapPath: join(root, 'data', 'idmap.json'), tvDatesPath: join(root, 'data', 'tvdates.json') };
}
const run = (p, fetchImpl) => runBuild({ token: 'tok', fetchImpl, now: TODAY, version: '9.9.9', sleep: async () => {}, ...p });
const read = async (p, rel) => JSON.parse(await readFile(join(p.distDir, rel), 'utf8'));
const discoverCalls = (f) =>
  f.calls.map((c) => new URL(c.url)).filter((u) => u.pathname.includes('/discover/'));
const ids = (metas) => metas.map((m) => Number(m.id.slice(2)) - 1000000);
const TODAY_STR = '2026-11-17';

test('keyword list: one constant, ids and types as decided', () => {
  assert.deepEqual(EXTRA_KEYWORD_SETS.map((s) => [s.id, s.types]), [
    [210662, ['tv', 'movie']],
    [10714, ['tv', 'movie']],
    [9826, ['tv']],
  ]);
});

test('every extra request sends with_genres=99 and one listed keyword; murder only for tv', async () => {
  const p = await setup();
  const f = mockFetch(fakeTmdb({ extras: true }));
  await run(p, f);
  const extra = discoverCalls(f).filter((u) => u.searchParams.get('with_keywords') && u.searchParams.get('with_keywords') !== '33722');
  assert.ok(extra.length > 0);
  for (const u of extra) assert.equal(u.searchParams.get('with_genres'), '99');
  const byKw = (kw, kind) => extra.filter((u) => u.searchParams.get('with_keywords') === String(kw) && u.pathname.endsWith(`/${kind}`));
  assert.equal(byKw(9826, 'movie').length, 0);
  assert.ok(byKw(9826, 'tv').length > 0);
  for (const kw of [210662, 10714]) for (const kind of ['movie', 'tv']) assert.ok(byKw(kw, kind).length > 0, `${kw} ${kind}`);
});

test('request counting: new passes use the 10-page cap, the recent pass 3 pages, date filter on New', async () => {
  const f = mockFetch(fakeTmdb({ extras: true }));
  const client = createClient({ token: 'tok', fetchImpl: f, sleep: async () => {} });
  await buildExtraPass(client, 'movie', 'new', TODAY_STR);
  let calls = discoverCalls(f);
  assert.equal(calls.length, 2 * 10); // cold case + serial killer, 10 pages each
  assert.ok(calls.every((u) => u.searchParams.get('primary_release_date.lte') === TODAY_STR));
  f.calls.length = 0;
  await buildExtraPass(client, 'tv', 'popularity', TODAY_STR);
  assert.equal(discoverCalls(f).length, 3 * 10);
  f.calls.length = 0;
  await buildExtraRecentPass(client, TODAY_STR);
  calls = discoverCalls(f);
  assert.equal(calls.length, 3 * 3);
  assert.ok(calls.every((u) => u.searchParams.get('air_date.gte') === '2026-08-19'));
});

test('dedupe across sets: an id in two sets appears once', async () => {
  const f = mockFetch(fakeTmdb({ extras: true }));
  const client = createClient({ token: 'tok', fetchImpl: f, sleep: async () => {} });
  const tv = await buildExtraPass(client, 'tv', 'new', TODAY_STR);
  const all = tv.map((it) => it.id);
  assert.equal(new Set(all).size, all.length);
  // cold case new 10301..10500, murder new 10401..10600 overlap on 100; serial killer 20301..20500
  assert.equal(all.length, 200 + 200 + 200 - 100);
  const movie = await buildExtraPass(client, 'movie', 'new', TODAY_STR);
  assert.equal(movie.length, 400);
});

test('tc-trending is byte-identical with the extra sets on or off, both types', async () => {
  const off = await setup();
  const on = await setup();
  await run(off, mockFetch(fakeTmdb({ extras: false })));
  await run(on, mockFetch(fakeTmdb({ extras: true })));
  for (const type of ['movie', 'series']) {
    const rels = ['catalog/' + type + '/tc-trending.json'];
    for (let k = 10; k < 300; k += 10) rels.push(`catalog/${type}/tc-trending/skip=${k}.json`);
    for (const rel of rels) {
      const a = await readFile(join(off.distDir, rel), 'utf8').catch(() => null);
      const b = await readFile(join(on.distDir, rel), 'utf8').catch(() => null);
      assert.equal(b, a, rel);
    }
  }
});

test('movie and tv pools grow: tc-new and tc-recent contain extra-set titles, extras off do not', async () => {
  const off = await setup();
  const on = await setup();
  await run(off, mockFetch(fakeTmdb({ extras: false })));
  await run(on, mockFetch(fakeTmdb({ extras: true })));
  const cOff = (await read(off, 'status.json')).counts;
  const cOn = (await read(on, 'status.json')).counts;
  assert.ok(cOn['movie/tc-new'] > cOff['movie/tc-new']);
  assert.ok(cOn['series/tc-new'] > cOff['series/tc-new']);
  assert.ok(cOn['series/tc-recent'] >= cOff['series/tc-recent']);
  assert.equal(cOn['movie/tc-trending'], cOff['movie/tc-trending']);
  assert.equal(cOn['series/tc-trending'], cOff['series/tc-trending']);
  const mNew = ids((await read(on, 'catalog/movie/tc-new.json')).metas);
  assert.ok(mNew.some((id) => id > 10000));
  // movies never contain a murder-only id (30001+)
  assert.ok(mNew.every((id) => id < 30000));
  assert.equal((await read(on, 'status.json')).counts['movie/tc-recent'], undefined);
});
