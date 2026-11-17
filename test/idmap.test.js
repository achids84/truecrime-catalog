import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadIdMap, saveIdMap, resolveImdbIds, needsResolve } from '../src/idmap.js';
import { createClient } from '../src/tmdb.js';
import { mockFetch } from './helpers.js';

const NOW = Date.parse('2026-06-01T00:00:00Z');
const DAY = 86400000;
const clientWith = (table) => {
  const f = mockFetch((u) => {
    const m = u.pathname.match(/\/3\/(movie|tv)\/(\d+)\/external_ids/);
    const v = table[`${m[1]}:${m[2]}`];
    return { imdb_id: v === undefined ? null : v };
  });
  return { f, c: createClient({ token: 't', fetchImpl: f }) };
};

test('only new items are resolved on later runs', async () => {
  const { f, c } = clientWith({ 'movie:1': 'tt1', 'tv:2': 'tt2', 'movie:3': 'tt3' });
  const map = {};
  await resolveImdbIds([{ kind: 'movie', id: 1 }, { kind: 'tv', id: 2 }], map, c, NOW);
  assert.equal(f.calls.length, 2);
  await resolveImdbIds(
    [{ kind: 'movie', id: 1 }, { kind: 'tv', id: 2 }, { kind: 'movie', id: 3 }],
    map, c, NOW,
  );
  assert.equal(f.calls.length, 3);
  assert.equal(map['movie:3'], 'tt3');
});

test('null entries are rechecked only after 30 days', async () => {
  const { f, c } = clientWith({});
  const map = {};
  await resolveImdbIds([{ kind: 'movie', id: 9 }], map, c, NOW);
  assert.equal(map['movie:9'], null);
  assert.equal(f.calls.length, 1);
  await resolveImdbIds([{ kind: 'movie', id: 9 }], map, c, NOW + 29 * DAY);
  assert.equal(f.calls.length, 1, 'no recheck at 29 days');
  await resolveImdbIds([{ kind: 'movie', id: 9 }], map, c, NOW + 30 * DAY);
  assert.equal(f.calls.length, 2, 'recheck at 30 days');
});

test('a recheck that now finds an id replaces the null', async () => {
  const map = { 'movie:9': null, _nullChecked: { 'movie:9': '2026-01-01' } };
  const { c } = clientWith({ 'movie:9': 'tt999' });
  await resolveImdbIds([{ kind: 'movie', id: 9 }], map, c, NOW);
  assert.equal(map['movie:9'], 'tt999');
  assert.equal(map._nullChecked['movie:9'], undefined);
});

test('null with no recorded date is rechecked', () => {
  assert.equal(needsResolve({ 'tv:1': null, _nullChecked: {} }, 'tv:1', NOW), true);
});

test('save/load round trip keeps documented key shape, sorted', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'idmap-'));
  const file = join(dir, 'data', 'idmap.json');
  await saveIdMap(file, { 'tv:2': 'tt2', 'movie:1': null, _nullChecked: { 'movie:1': '2026-05-01' } });
  const raw = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(Object.keys(raw), ['movie:1', 'tv:2', '_nullChecked']);
  const back = await loadIdMap(file);
  assert.equal(back['movie:1'], null);
  const fresh = await loadIdMap(join(dir, 'missing.json'));
  assert.deepEqual(fresh, { _nullChecked: {} });
});

test('404 from external_ids counts as no IMDb id', async () => {
  const f = mockFetch(() => ({ ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) }));
  const c = createClient({ token: 't', fetchImpl: f });
  const map = {};
  await resolveImdbIds([{ kind: 'tv', id: 5 }], map, c, NOW);
  assert.equal(map['tv:5'], null);
});
