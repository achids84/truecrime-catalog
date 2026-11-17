import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '../src/tmdb.js';
import {
  confirmKeyword, KeywordMismatchError, buildUniverse, mergeUniverse, fetchTrendingIds,
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

test('buildUniverse issues both discover queries with the right params, up to 10 pages', async () => {
  const f = mockFetch((u) => {
    const p = Number(u.searchParams.get('page'));
    const kw = u.searchParams.get('with_keywords');
    return { total_pages: 50, results: [mk(kw ? 1000 + p : p)] };
  });
  const u = await buildUniverse(createClient({ token: 't', fetchImpl: f }), 'movie');
  assert.equal(f.calls.length, 20);
  assert.equal(u.length, 20);
  const urls = f.calls.map((c) => new URL(c.url));
  assert.ok(urls.every((x) => x.pathname === '/3/discover/movie'));
  assert.ok(urls.every((x) => x.searchParams.get('include_adult') === 'false'));
  assert.ok(urls.every((x) => x.searchParams.get('language') === 'en-US'));
  assert.ok(urls.every((x) => x.searchParams.get('sort_by') === 'popularity.desc'));
  assert.equal(urls.filter((x) => x.searchParams.get('with_genres') === '99,80').length, 10);
  const b = urls.filter((x) => x.searchParams.get('with_keywords') === '33722');
  assert.equal(b.length, 10);
  assert.ok(b.every((x) => x.searchParams.get('with_genres') === '99'));
  assert.equal(Math.max(...urls.map((x) => Number(x.searchParams.get('page')))), 10);
});

test('buildUniverse stops at total_pages when under 10', async () => {
  const f = mockFetch(() => ({ total_pages: 2, results: [mk(1)] }));
  await buildUniverse(createClient({ token: 't', fetchImpl: f }), 'tv');
  assert.equal(f.calls.length, 4);
});

test('fetchTrendingIds reads pages 1..20 in order', async () => {
  const f = mockFetch((u) => ({ results: [{ id: Number(u.searchParams.get('page')) }] }));
  const ids = await fetchTrendingIds(createClient({ token: 't', fetchImpl: f }), 'tv');
  assert.deepEqual(ids, Array.from({ length: 20 }, (_, i) => i + 1));
  assert.ok(f.calls.every((c) => new URL(c.url).pathname === '/3/trending/tv/week'));
});
