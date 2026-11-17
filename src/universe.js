// TMDB discovery passes. For each type, queries (a) and (b) are run once per pass:
//   (a) genres 99 AND 80 (Documentary + Crime)
//   (b) genre 99 + keyword 33722 ("true crime")
// Two passes (up to 10 pages each, per query):
//   P   popularity.desc               -> Trending padding and Trending membership
//   N   release date desc, <= today   -> the New catalogue
// kind is 'movie' or 'tv' (TMDB naming); Stremio types are mapped in meta.js.

export const KEYWORD_ID = 33722;
export const KEYWORD_NAME = 'true crime';
export const MAX_DISCOVER_PAGES = 10;
export const MAX_TRENDING_PAGES = 20;

export class KeywordMismatchError extends Error {}

// Stop with a clear error if 33722 is not the "true crime" keyword.
export async function confirmKeyword(client) {
  const res = await client.get('/search/keyword', { query: 'true crime' });
  const hit = (res?.results ?? []).find((k) => k.id === KEYWORD_ID);
  if (!hit || String(hit.name).trim().toLowerCase() !== KEYWORD_NAME) {
    throw new KeywordMismatchError(
      `Keyword id ${KEYWORD_ID} is not "${KEYWORD_NAME}" on TMDB` +
        (hit ? ` (it is "${hit.name}")` : ' (not found in search results)') +
        '. Refusing to build.',
    );
  }
}

export function normalize(kind, raw) {
  return {
    kind,
    id: raw.id,
    name: (kind === 'movie' ? raw.title : raw.name) ?? '',
    date: (kind === 'movie' ? raw.release_date : raw.first_air_date) || '',
    overview: raw.overview ?? '',
    poster_path: raw.poster_path,
    popularity: raw.popularity ?? 0,
    vote_count: raw.vote_count ?? 0,
  };
}

export const PASS_SORT = {
  popularity: () => 'popularity.desc',
  new: (kind) => (kind === 'movie' ? 'primary_release_date.desc' : 'first_air_date.desc'),
};

async function discoverPages(client, kind, extra) {
  const params = { include_adult: 'false', language: 'en-US', ...extra };
  const first = await client.get(`/discover/${kind}`, { ...params, page: 1 });
  const last = Math.min(MAX_DISCOVER_PAGES, first.total_pages ?? 1);
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, last - 1) }, (_, i) =>
      client.get(`/discover/${kind}`, { ...params, page: i + 2 }),
    ),
  );
  return [first, ...rest].flatMap((p) => p.results ?? []);
}

export const byPopularity = (a, b) => b.popularity - a.popularity;

// Merge result lists: dedupe by TMDB id, require poster_path, sort popularity desc.
export function mergeUniverse(kind, ...lists) {
  const seen = new Map();
  for (const raw of lists.flat()) {
    if (!raw?.poster_path || seen.has(raw.id)) continue;
    seen.set(raw.id, normalize(kind, raw));
  }
  return [...seen.values()].sort(byPopularity);
}

// pass: 'popularity' | 'new'. today: YYYY-MM-DD (used by 'new' only).
export async function buildPass(client, kind, pass, today) {
  const extra = { sort_by: PASS_SORT[pass](kind) };
  if (pass === 'new') {
    extra[kind === 'movie' ? 'primary_release_date.lte' : 'first_air_date.lte'] = today;
  }
  const [a, b] = await Promise.all([
    discoverPages(client, kind, { ...extra, with_genres: '99,80' }),
    discoverPages(client, kind, { ...extra, with_genres: '99', with_keywords: String(KEYWORD_ID) }),
  ]);
  return mergeUniverse(kind, a, b);
}

// Raw trending results in trending order (pages 1..20).
export async function fetchTrending(client, kind) {
  const pages = await Promise.all(
    Array.from({ length: MAX_TRENDING_PAGES }, (_, i) =>
      client.get(`/trending/${kind}/week`, { page: i + 1, language: 'en-US' }),
    ),
  );
  return pages.flatMap((p) => p.results ?? []);
}

// Trending membership: genre_ids contain both 99 and 80, or the id is in the union of the
// two passes (P and New). Needs a poster. Trending order kept, duplicates dropped.
export function qualifyTrending(kind, rawList, unionIds) {
  const seen = new Set();
  const out = [];
  for (const raw of rawList) {
    if (!raw?.poster_path || seen.has(raw.id)) continue;
    const g = raw.genre_ids ?? [];
    if ((g.includes(99) && g.includes(80)) || unionIds.has(raw.id)) {
      seen.add(raw.id);
      out.push(normalize(kind, raw));
    }
  }
  return out;
}

// ---- kind "discover": one TMDB discover query per catalogue and type ----------------------
// The true crime keyword is always ANDed in. Comma means AND on TMDB (a pipe would mean OR,
// which this version does not support). The order TMDB returns is kept; nothing is re-sorted.
export const DISCOVER_DEFAULT_LIMIT = 100;
export const DISCOVER_PAGE_SIZE = 20;
export const DISCOVER_MAX_PAGES = 25; // limit 500 / 20 per page
const DISCOVER_OVERFETCH = 1.15; // a share of titles will lack a poster or an IMDb id

const DATE_SORTS = ['primary_release_date.desc', 'first_air_date.desc'];

// The two date sorts mean "newest first" for either type; each type gets its own TMDB name.
export function discoverSort(kind, sort = 'popularity.desc') {
  if (DATE_SORTS.includes(sort)) return PASS_SORT.new(kind);
  return sort;
}

// today: YYYY-MM-DD. For a date sort, unreleased titles are cut off at today.
export function discoverParams(kind, spec, today) {
  const sort = discoverSort(kind, spec.sort);
  const dateKey = kind === 'movie' ? 'primary_release_date' : 'first_air_date';
  const keywords = [...new Set([KEYWORD_ID, ...(spec.keywordsAll ?? [])])];
  const params = { sort_by: sort, with_keywords: keywords.join(',') };
  if (spec.genresAll?.length) params.with_genres = spec.genresAll.join(',');
  if (spec.minVotes > 0) params['vote_count.gte'] = String(spec.minVotes);
  if (spec.language) params.with_original_language = spec.language;
  if (spec.yearFrom != null) params[`${dateKey}.gte`] = `${spec.yearFrom}-01-01`;
  let upper = spec.yearTo != null ? `${spec.yearTo}-12-31` : null;
  if (DATE_SORTS.includes(spec.sort) && (!upper || upper > today)) upper = today;
  if (upper) params[`${dateKey}.lte`] = upper;
  return params;
}

export async function buildDiscover(client, kind, spec, today) {
  const limit = spec.limit ?? DISCOVER_DEFAULT_LIMIT;
  const wanted = Math.min(DISCOVER_MAX_PAGES, Math.ceil((limit * DISCOVER_OVERFETCH) / DISCOVER_PAGE_SIZE));
  const params = { include_adult: 'false', language: 'en-US', ...discoverParams(kind, spec, today) };
  const first = await client.get(`/discover/${kind}`, { ...params, page: 1 });
  const last = Math.min(wanted, first.total_pages ?? 1);
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, last - 1) }, (_, i) =>
      client.get(`/discover/${kind}`, { ...params, page: i + 2 }),
    ),
  );
  const seen = new Set();
  const out = [];
  for (const raw of [first, ...rest].flatMap((p) => p.results ?? [])) {
    if (!raw?.poster_path || seen.has(raw.id)) continue;
    seen.add(raw.id);
    out.push(normalize(kind, raw));
  }
  return out;
}
