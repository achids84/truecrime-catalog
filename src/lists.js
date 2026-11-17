// The two list builders. Items are normalized TMDB items that already carry item.imdb.
// All builders are pure and drop repeated IMDb ids before applying the cap.
import { byPopularity } from './universe.js';
import { dedupeByImdb } from './meta.js';

export const MAX_ITEMS = 300;
export const MIN_ITEMS = 20;

// Trending: `qualified` is already filtered by membership (see qualifyTrending) and kept in
// trending order. If fewer than `min` remain, pad from `padSource` (pass P) by popularity.desc.
export function buildTrending(qualified, padSource, { min = MIN_ITEMS, max = MAX_ITEMS } = {}) {
  const out = dedupeByImdb(qualified);
  const usedId = new Set(out.map((it) => it.id));
  const usedImdb = new Set(out.map((it) => it.imdb));
  let padded = 0;
  if (out.length < min) {
    for (const it of [...padSource].sort(byPopularity)) {
      if (out.length >= min) break;
      if (usedId.has(it.id) || usedImdb.has(it.imdb)) continue;
      usedId.add(it.id);
      usedImdb.add(it.imdb);
      out.push(it);
      padded++;
    }
  }
  return { items: out.slice(0, max), padded };
}

// New: from the date-sorted pass. Release/first-air date on or before today (YYYY-MM-DD),
// sorted by descending date, ties by popularity. The date is `sortDate` when an item has one
// (series: last air date, else first air date), otherwise `date` (movies). `date` itself is
// never changed, so cards keep showing the release/first-air year.
const sortKeyOf = (it) => it.sortDate || it.date;
export function buildNew(items, today, { max = MAX_ITEMS } = {}) {
  return dedupeByImdb(
    items
      .filter((it) => it.date && it.date <= today)
      .sort((a, b) => {
        const ka = sortKeyOf(a);
        const kb = sortKeyOf(b);
        return ka < kb ? 1 : ka > kb ? -1 : byPopularity(a, b);
      }),
  ).slice(0, max);
}

// How many of `items` each pass (P, New) contributed (an item in several passes counts in each);
// genreRule = in no pass, i.e. admitted to Trending only by the genre_ids rule.
export function contributions(items, passSets) {
  const passes = ['P', 'New', ...(passSets.Recent ? ['Recent'] : [])];
  const out = { P: 0, New: 0, ...(passSets.Recent ? { Recent: 0 } : {}), genreRule: 0 };
  for (const it of items) {
    let any = false;
    for (const k of passes) {
      if (passSets[k].has(it.id)) {
        out[k]++;
        any = true;
      }
    }
    if (!any) out.genreRule++;
  }
  return out;
}
