// The three list builders. Input items are universe items (see universe.js) that already
// have an IMDb id attached as item.imdb. All builders are pure.
import { byPopularity } from './universe.js';

export const MAX_ITEMS = 300;
export const MIN_ITEMS = 20;

// Trending: trending order, only items in U. Pad with U by popularity if fewer than 20.
export function buildTrending(universe, trendingIds, { min = MIN_ITEMS, max = MAX_ITEMS } = {}) {
  const byId = new Map(universe.map((it) => [it.id, it]));
  const out = [];
  const used = new Set();
  for (const id of trendingIds) {
    const it = byId.get(id);
    if (it && !used.has(id)) {
      used.add(id);
      out.push(it);
    }
  }
  let padded = 0;
  if (out.length < min) {
    for (const it of [...universe].sort(byPopularity)) {
      if (out.length >= min) break;
      if (used.has(it.id)) continue;
      used.add(it.id);
      out.push(it);
      padded++;
    }
  }
  return { items: out.slice(0, max), padded };
}

// New: release/first-air date on or before today (YYYY-MM-DD), newest first.
export function buildNew(universe, today, { max = MAX_ITEMS } = {}) {
  return universe
    .filter((it) => it.date && it.date <= today)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : byPopularity(a, b)))
    .slice(0, max);
}

// Popular: vote_count descending, ties by popularity.
export function buildPopular(universe, { max = MAX_ITEMS } = {}) {
  return [...universe]
    .sort((a, b) => b.vote_count - a.vote_count || byPopularity(a, b))
    .slice(0, max);
}
