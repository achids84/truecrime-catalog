// A fake TMDB for offline tests. No network.
// Per kind, the two discover passes return disjoint id ranges so tests can tell them apart:
//   P (popularity.desc):      a = 1..200,       b = 101..300     (high popularity)
//   N (release date desc):    a = 1001..1200,   b = 1101..1300   (recent, LOW popularity)
// Trending slot s < trendingHits is P id 300-s (genre [99]); slot trendingHits is N id 1001
// (in the union, genre [99]); slot trendingHits+1 is id 5001 (genre [99,80], in no pass);
// every other slot is a stranger (90000+s, genre [99,35]) that must not qualify.
import { jsonRes } from './helpers.js';

export const TODAY = Date.parse('2026-11-17T12:00:00Z');
const pad = (n) => String(n).padStart(2, '0');

function pageIds(base, page, i) {
  return base + (page - 1) * 20 + i + 1;
}

function discoverItem(id, sort, lte) {
  let date;
  let popularity;
  let vote_count;
  if (sort === 'popularity.desc') {
    date = id % 7 === 0 ? '2027-03-01' : `20${10 + (id % 15)}-0${1 + (id % 9)}-1${id % 9}`;
    popularity = 1000 - id;
    vote_count = (id * 37) % 500;
  } else {
    date = `2026-11-${pad(1 + (id % 17))}`; // 2026-11-01 .. 2026-11-17
    if (lte && date > lte) date = lte;
    popularity = id / 1000; // all below 2, far under every P item
    vote_count = 1;
  }
  return {
    id,
    title: `Movie ${id}`,
    name: `Show ${id}`,
    release_date: date,
    first_air_date: date,
    overview: `Overview ${id}`,
    poster_path: `/poster${id}.jpg`,
    popularity,
    vote_count,
  };
}

// `opts.fail` forces every request to return that status. `nullEvery`: ids divisible by it
// have no IMDb id.
export function fakeTmdb(opts = {}) {
  const { trendingHits = 40, fail = null, keywordName = 'true crime', nullEvery = 25 } = opts;
  return (u) => {
    if (fail) return jsonRes({}, fail);
    const path = u.pathname.replace(/^\/3/, '');
    const q = u.searchParams;
    if (path === '/search/keyword') return { results: [{ id: 33722, name: keywordName }] };

    let m = path.match(/^\/discover\/(movie|tv)$/);
    if (m) {
      const page = Number(q.get('page'));
      const sort = q.get('sort_by');
      const lte = q.get('primary_release_date.lte') ?? q.get('first_air_date.lte');
      const isB = Boolean(q.get('with_keywords'));
      if (sort !== 'popularity.desc' && !sort.endsWith('date.desc')) return jsonRes({}, 400); // no other sort is used
      const base = sort === 'popularity.desc' ? (isB ? 100 : 0) : isB ? 1100 : 1000;
      const results = Array.from({ length: 20 }, (_, i) => discoverItem(pageIds(base, page, i), sort, lte));
      return { page, total_pages: 50, results };
    }

    m = path.match(/^\/trending\/(movie|tv)\/week$/);
    if (m) {
      const page = Number(q.get('page'));
      return {
        results: Array.from({ length: 20 }, (_, i) => {
          const slot = (page - 1) * 20 + i;
          let id;
          let genre_ids;
          if (slot < trendingHits) [id, genre_ids] = [300 - slot, [99]];
          else if (slot === trendingHits) [id, genre_ids] = [1001, [99]];
          else if (slot === trendingHits + 1) [id, genre_ids] = [5001, [99, 80]];
          else [id, genre_ids] = [90000 + slot, [99, 35]];
          return { ...discoverItem(id, 'popularity.desc'), genre_ids };
        }),
      };
    }

    m = path.match(/^\/(movie|tv)\/(\d+)\/external_ids$/);
    if (m) {
      const id = Number(m[2]);
      return { id, imdb_id: nullEvery && id % nullEvery === 0 ? '' : `tt${1000000 + id}` };
    }
    return jsonRes({}, 404);
  };
}
