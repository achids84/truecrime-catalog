// A fake TMDB for offline tests. No network.
// Per kind, the two discover passes return disjoint id ranges so tests can tell them apart:
//   P (popularity.desc):      a = 1..200,       b = 101..300     (high popularity)
//   N (release date desc):    a = 1001..1200,   b = 1101..1300   (recent, LOW popularity)
//   Recent (tv only, air_date.gte): a = 2001..2060, b = 2101..2160 (OLD first air date, low popularity)
// Extra keyword sets (ADDON-5e), each its own range, genre 99 + keyword:
//   cold case 210662   pop 10001..10200, new 10301..10500, recent 10601..10660
//   serial killer 10714 pop 20001..20200, new 20301..20500, recent 20601..20660
//   murder 9826 (tv)   pop 30001..30200, new 10401..10600 (overlaps cold case new by 100), recent 30601..30660
// opts.extras (default false) turns them on; off they return nothing (= the pool main builds).
// Trending slot s < trendingHits is P id 300-s (genre [99]); slot trendingHits is N id 1001
// (in the union, genre [99]); slot trendingHits+1 is id 5001 (genre [99,80], in no pass);
// every other slot is a stranger (90000+s, genre [99,35]) that must not qualify.
import { jsonRes } from './helpers.js';

export const TODAY = Date.parse('2026-11-17T12:00:00Z');
export const EXTRA_BASE = {
  210662: { popularity: 10000, new: 10300, recent: 10600 },
  10714: { popularity: 20000, new: 20300, recent: 20600 },
  9826: { popularity: 30000, new: 10400, recent: 30600 },
};
const pad = (n) => String(n).padStart(2, '0');

function pageIds(base, page, i) {
  return base + (page - 1) * 20 + i + 1;
}

function discoverItem(id, sort, lte) {
  let date;
  let popularity;
  let vote_count;
  if (sort === 'recent') {
    date = `2025-0${1 + (id % 9)}-10`; // first aired long ago, a new season airing now
    popularity = id / 1000;
    vote_count = 1;
  } else if (sort === 'popularity.desc') {
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

// `opts.fail` forces every request to return that status; `failTv` does so for /tv/{id} only. `nullEvery`: ids divisible by it
// have no IMDb id.
export function fakeTmdb(opts = {}) {
  const { trendingHits = 40, fail = null, keywordName = 'true crime', nullEvery = 25, failTv = null, tvDetail = null, cinemeta = null, failCinemeta = null, extras = false } = opts;
  return (u) => {
    // Cinemeta (v3-cinemeta.strem.io): /meta/series/tt<N>.json; tmdb id = N - 1000000.
    // opts.cinemeta(id) returns a videos array (default: none); opts.failCinemeta forces a status.
    if (u.hostname === 'v3-cinemeta.strem.io') {
      if (failCinemeta) return jsonRes({}, failCinemeta);
      const id = Number(/tt(\d+)\.json$/.exec(u.pathname)[1]) - 1000000;
      return { meta: { videos: cinemeta ? cinemeta(id) : [] } };
    }
    if (fail) return jsonRes({}, fail);
    const path = u.pathname.replace(/^\/3/, '');
    const q = u.searchParams;
    if (path === '/search/keyword') return { results: [{ id: 33722, name: keywordName }] };

    let m = path.match(/^\/discover\/(movie|tv)$/);
    if (m) {
      const page = Number(q.get('page'));
      const sort = q.get('sort_by');
      const lte = q.get('primary_release_date.lte') ?? q.get('first_air_date.lte');
      const kw = q.get('with_keywords');
      const isB = Boolean(kw);
      const extraBase = EXTRA_BASE[kw];
      if (kw && kw !== '33722' && !extraBase) return jsonRes({}, 400); // unknown keyword
      if (extraBase) {
        if (path.endsWith('/movie') && kw === '9826') return jsonRes({}, 400); // murder is tv only
        if (q.get('with_genres') !== '99') return jsonRes({}, 400); // genre 99 is required
        if (!extras) return { page, total_pages: 1, results: [] };
      }
      if (sort !== 'popularity.desc' && !sort.endsWith('date.desc')) return jsonRes({}, 400); // no other sort is used
      const recent = q.has('air_date.gte');
      const base = extraBase ? extraBase[recent ? 'recent' : sort === 'popularity.desc' ? 'popularity' : 'new'] : recent ? (isB ? 2100 : 2000) : sort === 'popularity.desc' ? (isB ? 100 : 0) : isB ? 1100 : 1000;
      const results = Array.from({ length: 20 }, (_, i) =>
        discoverItem(pageIds(base, page, i), recent ? 'recent' : sort, lte),
      );
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
    // /tv/{id}: details used by the series New sort.
    //   Recent ids (2001+): old first_air_date, last_air_date in Nov 2026, Returning Series.
    //   N ids (1001..1300): last == first; every 10th has a null last_air_date; even ids Ended.
    //   Others: Ended, last == first.
    m = path.match(/^\/tv\/(\d+)$/);
    if (m) {
      if (failTv) return jsonRes({}, failTv);
      const id = Number(m[1]);
      if (tvDetail) return tvDetail(id);
      const isRecent = (id >= 2000 && id < 3000) || (id % 10000 >= 601 && id % 10000 <= 700 && id >= 10000);
      if (isRecent) {
        return { id, first_air_date: discoverItem(id, 'recent').first_air_date, last_air_date: `2026-11-${pad(1 + (id % 17))}`, status: 'Returning Series' };
      }
      const isN = (id >= 1000 && id < 2000) || (id >= 10000 && id % 10000 >= 301 && id % 10000 <= 600);
      const first = discoverItem(id, isN ? 'new' : 'popularity.desc').first_air_date;
      return {
        id,
        first_air_date: first,
        last_air_date: isN && id % 10 === 0 ? null : first,
        status: isN && id % 2 === 1 ? 'Returning Series' : 'Ended',
      };
    }
    return jsonRes({}, 404);
  };
}
