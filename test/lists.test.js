import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTrending, buildNew, buildPopular } from '../src/lists.js';
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

test('Trending: keeps only items in U, in trending order, no padding when >= 20', () => {
  const u = range(40).map((i) => it(i));
  const trending = [999, ...range(30).reverse(), 888];
  const { items, padded } = buildTrending(u, trending);
  assert.equal(padded, 0);
  assert.deepEqual(items.map((x) => x.id), range(30).reverse());
});

test('Trending: pads from U by popularity when fewer than 20 remain', () => {
  const u = range(40).map((i) => it(i)); // popularity = 100 - id, so id 1 is most popular
  const { items, padded } = buildTrending(u, [30, 25, 7, 500]);
  assert.equal(items.length, 20);
  assert.equal(padded, 17);
  assert.deepEqual(items.slice(0, 3).map((x) => x.id), [30, 25, 7]);
  assert.deepEqual(items.slice(3, 6).map((x) => x.id), [1, 2, 3]); // popularity order, skips 7
  assert.equal(new Set(items.map((x) => x.id)).size, 20);
});

test('Trending: duplicates in the trending feed are collapsed', () => {
  const u = range(25).map((i) => it(i));
  const { items } = buildTrending(u, [1, 1, 2, 2, ...range(25)]);
  assert.equal(new Set(items.map((x) => x.id)).size, items.length);
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
