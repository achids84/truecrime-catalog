// The universe U per type: union of two TMDB discover queries, deduplicated by TMDB id.
//   (a) genres 99 AND 80 (Documentary + Crime)
//   (b) genre 99 + keyword 33722 ("true crime")
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

async function discoverPages(client, kind, extra) {
  const params = {
    include_adult: 'false',
    language: 'en-US',
    sort_by: 'popularity.desc',
    ...extra,
  };
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

export async function buildUniverse(client, kind) {
  const [a, b] = await Promise.all([
    discoverPages(client, kind, { with_genres: '99,80' }),
    discoverPages(client, kind, { with_genres: '99', with_keywords: String(KEYWORD_ID) }),
  ]);
  return mergeUniverse(kind, a, b);
}

// TMDB TV/movie ids in trending order (pages 1..20).
export async function fetchTrendingIds(client, kind) {
  const pages = await Promise.all(
    Array.from({ length: MAX_TRENDING_PAGES }, (_, i) =>
      client.get(`/trending/${kind}/week`, { page: i + 1, language: 'en-US' }),
    ),
  );
  return pages.flatMap((p) => (p.results ?? []).map((r) => r.id));
}
