import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTrending, buildNew, buildPopular, contributions } from '../src/lists.js';
import { toMeta, toMetas } from '../src/meta.js';

const it = (id, o = {}) => ({
  kind: 'movie', id, name: `M${id}`, date: '2020-01-01', overview: 'ov',
  poster_path: `/p${id}.jpg`, popularity: 100 - id, vote_count: id, imdb: `tt${id}`, ...o,
});
const range = (n) => Array.from({ length: n }, (_, i) => i + 1);

test('New: only on/before today, newest first, ties by popularity', () => {
  const u = [
    it(1, { date: '2026-01-01' }),
    it(2, { date: '2026-12-31' }), // future
    it(3, { date: '2026-06-01', popularity: 5 }),
    it(4, { date: '2026-06-01', popularity: 50 }),
    it(5, { date: '' }), // undated
    it(6, { date: '2026-11-17' }), // today counts
  ];
  assert.deepEqual(buildNew(u, '2026-11-17').map((x) => x.id), [6, 4, 3, 1]);
});

test('Popular: vote_count desc, ties by popularity', () => {
  const u = [
    it(1, { vote_count: 10, popularity: 1 }),
    it(2, { vote_count: 99 }),
    it(3, { vote_count: 10, popularity: 9 }),
  ];
  assert.deepEqual(buildPopular(u).map((x) => x.id), [2, 3, 1]);
});

test('lists are capped at 300', () => {
  const u = range(350).map((i) => it(i, { date: '2020-01-01' }));
  assert.equal(buildNew(u, '2026-01-01').length, 300);
  assert.equal(buildPopular(u).length, 300);
});

test('Trending: qualified items kept in order, no padding when >= 20', () => {
  const qualified = range(30).reverse().map((i) => it(i));
  const { items, padded } = buildTrending(qualified, range(5).map((i) => it(100 + i)));
  assert.equal(padded, 0);
  assert.deepEqual(items.map((x) => x.id), range(30).reverse());
});

test('Trending: pads from pass P by popularity.desc when fewer than 20 remain', () => {
  const P = range(40).map((i) => it(i)); // popularity = 100 - id, so id 1 is most popular
  const qualified = [it(30), it(25), it(7), it(500, { imdb: 'tt500' })];
  const { items, padded } = buildTrending(qualified, P);
  assert.equal(items.length, 20);
  assert.equal(padded, 16);
  assert.deepEqual(items.slice(0, 4).map((x) => x.id), [30, 25, 7, 500]);
  assert.deepEqual(items.slice(4, 7).map((x) => x.id), [1, 2, 3]); // popularity order, skips 7
  assert.equal(new Set(items.map((x) => x.id)).size, 20);
});

test('Trending: padding never repeats a title already present (by TMDB or IMDb id)', () => {
  const P = [it(1, { imdb: 'tt-same' }), ...range(30).slice(1).map((i) => it(i))];
  const { items } = buildTrending([it(99, { imdb: 'tt-same' })], P);
  assert.equal(new Set(items.map((x) => x.imdb)).size, items.length);
});

test('Trending: duplicates in the qualified list are collapsed', () => {
  const { items } = buildTrending([it(1), it(1), it(2), ...range(25).map((i) => it(i + 10))], []);
  assert.equal(new Set(items.map((x) => x.id)).size, items.length);
});

test('New is cut from its own pass: a recent low-popularity title beats popular older ones', () => {
  // pass P holds old, very popular titles. The New pass also holds a brand new, unpopular one.
  const P = range(30).map((i) => it(i, { date: '2015-01-01', popularity: 1000 - i }));
  const N = [it(900, { date: '2026-11-10', popularity: 0.1 }), it(901, { date: '2026-10-01', popularity: 0.1 })];
  assert.ok(!P.some((x) => x.id === 900), 'absent from P');
  const fromP = buildNew(P, '2026-11-17');
  assert.ok(!fromP.some((x) => x.id === 900));
  const fromN = buildNew(N, '2026-11-17');
  assert.deepEqual(fromN.map((x) => x.id), [900, 901]);
  assert.equal(fromN[0].date, '2026-11-10');
});

test('Popular is cut from the vote_count pass and sorted by vote_count', () => {
  const V = [it(1, { vote_count: 50000, popularity: 1 }), it(2, { vote_count: 90000, popularity: 1 })];
  assert.deepEqual(buildPopular(V).map((x) => x.id), [2, 1]);
});

test('contributions counts each pass, overlaps in each, and genre-rule-only items', () => {
  const sets = { P: new Set([1, 2]), New: new Set([2, 3]), Popular: new Set([9]) };
  const c = contributions([it(1), it(2), it(3), it(4), it(5)], sets);
  assert.deepEqual(c, { P: 2, New: 2, Popular: 0, genreRule: 2 });
});

test('meta has exactly the preview fields', () => {
  assert.deepEqual(toMeta(it(7, { kind: 'tv', date: '2019-03-04' })), {
    id: 'tt7',
    type: 'series',
    name: 'M7',
    poster: 'https://image.tmdb.org/t/p/w342/p7.jpg',
    posterShape: 'poster',
    releaseInfo: '2019',
    description: 'ov',
  });
  assert.equal(toMeta(it(1)).type, 'movie');
});

test('meta omits empty year and description rather than inventing values', () => {
  const m = toMeta(it(1, { date: '', overview: '' }));
  assert.ok(!('releaseInfo' in m) && !('description' in m));
});

test('toMetas drops repeated IMDb ids', () => {
  const metas = toMetas([it(1), it(2, { imdb: 'tt1' }), it(3)]);
  assert.deepEqual(metas.map((m) => m.id), ['tt1', 'tt3']);
});
