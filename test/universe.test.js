import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '../src/tmdb.js';
import {
  confirmKeyword, KeywordMismatchError, buildPass, mergeUniverse, fetchTrending, qualifyTrending,
} from '../src/universe.js';
import { mockFetch } from './helpers.js';

const mk = (id, extra = {}) => ({
  id, title: `T${id}`, name: `N${id}`, release_date: '2024-01-01', first_air_date: '2023-05-05',
  overview: 'o', poster_path: `/p${id}.jpg`, popularity: id, vote_count: id * 10, ...extra,
});

test('confirmKeyword passes for 33722 "true crime"', async () => {
  const f = mockFetch(() => ({ results: [{ id: 1, name: 'x' }, { id: 33722, name: 'true crime' }] }));
  await confirmKeyword(createClient({ token: 't', fetchImpl: f }));
  assert.equal(new URL(f.calls[0].url).searchParams.get('query'), 'true crime');
});

test('confirmKeyword stops with a clear error when the id is something else', async () => {
  const f = mockFetch(() => ({ results: [{ id: 33722, name: 'cooking' }] }));
  await assert.rejects(confirmKeyword(createClient({ token: 't', fetchImpl: f })), KeywordMismatchError);
});

test('confirmKeyword stops when 33722 is absent', async () => {
  const f = mockFetch(() => ({ results: [{ id: 5, name: 'true crime' }] }));
  await assert.rejects(confirmKeyword(createClient({ token: 't', fetchImpl: f })), /not found/);
});

test('mergeUniverse dedupes by TMDB id, drops no-poster, sorts by popularity', () => {
  const a = [mk(1), mk(2), mk(3, { poster_path: null })];
  const b = [mk(2), mk(4)];
  const u = mergeUniverse('movie', a, b);
  assert.deepEqual(u.map((x) => x.id), [4, 2, 1]);
  assert.equal(u[0].name, 'T4');
  assert.equal(u[0].date, '2024-01-01');
});

test('tv items use name and first_air_date', () => {
  const [it] = mergeUniverse('tv', [mk(1)]);
  assert.equal(it.name, 'N1');
  assert.equal(it.date, '2023-05-05');
});

const client = (f) => createClient({ token: 't', fetchImpl: f });
const paramsOf = (f) => f.calls.map((c) => new URL(c.url));

test('each pass runs queries a and b, 10 pages each, with its own sort', async () => {
  const cases = [
    ['popularity', 'movie', 'popularity.desc', null],
    ['popular', 'movie', 'vote_count.desc', null],
    ['new', 'movie', 'primary_release_date.desc', 'primary_release_date.lte'],
    ['new', 'tv', 'first_air_date.desc', 'first_air_date.lte'],
  ];
  for (const [pass, kind, sort, lte] of cases) {
    const f = mockFetch((u) => ({ total_pages: 50, results: [mk(Number(u.searchParams.get('page')) + (u.searchParams.get('with_keywords') ? 100 : 0))] }));
    const u = await buildPass(client(f), kind, pass, '2026-11-17');
    const urls = paramsOf(f);
    assert.equal(urls.length, 20, pass);
    assert.equal(u.length, 20);
    assert.ok(urls.every((x) => x.pathname === `/3/discover/${kind}`));
    assert.ok(urls.every((x) => x.searchParams.get('sort_by') === sort));
    assert.ok(urls.every((x) => x.searchParams.get('include_adult') === 'false'));
    assert.ok(urls.every((x) => x.searchParams.get('language') === 'en-US'));
    assert.equal(urls.filter((x) => x.searchParams.get('with_genres') === '99,80').length, 10);
    const b = urls.filter((x) => x.searchParams.get('with_keywords') === '33722');
    assert.equal(b.length, 10);
    assert.ok(b.every((x) => x.searchParams.get('with_genres') === '99'));
    assert.equal(Math.max(...urls.map((x) => Number(x.searchParams.get('page')))), 10);
    // the date cap is sent for the New pass only
    for (const key of ['primary_release_date.lte', 'first_air_date.lte']) {
      const sent = urls.every((x) => x.searchParams.get(key) === '2026-11-17');
      assert.equal(sent, key === lte, `${pass}/${kind}/${key}`);
    }
  }
});

test('a pass stops at total_pages when under 10', async () => {
  const f = mockFetch(() => ({ total_pages: 2, results: [mk(1)] }));
  await buildPass(client(f), 'tv', 'popular', '2026-11-17');
  assert.equal(f.calls.length, 4);
});

test('fetchTrending returns raw items from pages 1..20 in order', async () => {
  const f = mockFetch((u) => ({ results: [{ id: Number(u.searchParams.get('page')), genre_ids: [99] }] }));
  const raw = await fetchTrending(client(f), 'tv');
  assert.deepEqual(raw.map((r) => r.id), Array.from({ length: 20 }, (_, i) => i + 1));
  assert.ok(f.calls.every((c) => new URL(c.url).pathname === '/3/trending/tv/week'));
});

test('Trending membership: genre rule (99 and 80) or union, in trending order', () => {
  const raw = [
    mk(1, { genre_ids: [99, 35] }), // not in union, only one of the two genres: out
    mk(2, { genre_ids: [99, 80] }), // genre rule: in, though in no pass
    mk(3, { genre_ids: [18] }), // in union: in
    mk(4, { genre_ids: [80] }), // out
    mk(5, { genre_ids: [99, 80], poster_path: null }), // no poster: out
    mk(3, { genre_ids: [18] }), // duplicate: once
    mk(6), // no genre_ids at all, not in union: out
    mk(7, { genre_ids: [80, 99, 12] }), // genre rule, any order: in
  ];
  const got = qualifyTrending('movie', raw, new Set([3]));
  assert.deepEqual(got.map((x) => x.id), [2, 3, 7]);
  assert.equal(got[0].name, 'T2');
});
