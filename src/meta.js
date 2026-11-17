// Stremio meta preview mapping. Exactly these fields, nothing else.
export const POSTER_BASE = 'https://image.tmdb.org/t/p/w342';
export const STREMIO_TYPE = { movie: 'movie', tv: 'series' };

export function toMeta(item) {
  const meta = {
    id: item.imdb,
    type: STREMIO_TYPE[item.kind],
    name: item.name,
    poster: POSTER_BASE + item.poster_path,
    posterShape: 'poster',
  };
  const year = /^\d{4}/.exec(item.date ?? '')?.[0];
  if (year) meta.releaseInfo = year;
  if (item.overview) meta.description = item.overview;
  return meta;
}

// Map items to metas, dropping repeated IMDb ids (two TMDB ids can share one).
export function toMetas(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    if (!it.imdb || seen.has(it.imdb)) continue;
    seen.add(it.imdb);
    out.push(toMeta(it));
  }
  return out;
}
