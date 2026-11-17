// A fake TMDB for offline tests. No network.
import { jsonRes } from './helpers.js';

export const TODAY = Date.parse('2026-11-17T12:00:00Z');

// ids 1..200 match the genre query, 101..300 the keyword query -> universe of 300 per kind.
// Every 25th id has no IMDb id. `opts.fail` forces every request to return that status.
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
      const base = q.get('with_keywords') ? 100 : 0;
      const results = Array.from({ length: 20 }, (_, i) => {
        const id = base + (page - 1) * 20 + i + 1;
        return {
          id,
          title: `Movie ${id}`,
          name: `Show ${id}`,
          release_date: id % 7 === 0 ? '2027-03-01' : `20${10 + (id % 15)}-0${1 + (id % 9)}-1${id % 9}`,
          first_air_date: id % 7 === 0 ? '2027-03-01' : `20${10 + (id % 15)}-0${1 + (id % 9)}-1${id % 9}`,
          overview: `Overview ${id}`,
          poster_path: `/poster${id}.jpg`,
          popularity: 1000 - id,
          vote_count: (id * 37) % 500,
        };
      });
      return { page, total_pages: 50, results };
    }

    m = path.match(/^\/trending\/(movie|tv)\/week$/);
    if (m) {
      const page = Number(q.get('page'));
      // the first `trendingHits` trending slots are universe ids, the rest are strangers
      return {
        results: Array.from({ length: 20 }, (_, i) => {
          const slot = (page - 1) * 20 + i;
          return { id: slot < trendingHits ? 300 - slot : 90000 + slot };
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
