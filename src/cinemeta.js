// Cinemeta (the Stremio metadata addon): the episode dates the Stremio TV detail page shows.
// TMDB is missing episode dates for some airing shows, so for series that are not Ended or
// Canceled the build asks Cinemeta for the newest released episode. No credentials are sent.
// Every request has a timeout and a concurrency cap; a failure throws to the caller, which
// degrades (cached date, else the TMDB date) and never fails the build.

export const CINEMETA_HOST = 'https://v3-cinemeta.strem.io';
export const CINEMETA_TIMEOUT_MS = 8000;
export const CINEMETA_CONCURRENCY = 5;

// Newest `released` among videos with season >= 1 and released <= now. Returns YYYY-MM-DD or null.
export function latestReleased(meta, now = Date.now()) {
  let best = null;
  for (const v of meta?.meta?.videos ?? []) {
    if (!(Number(v?.season) >= 1)) continue; // season 0 = specials
    const t = Date.parse(v?.released);
    if (Number.isNaN(t) || t > now) continue; // missing or not yet released
    if (best === null || t > best) best = t;
  }
  return best === null ? null : new Date(best).toISOString().slice(0, 10);
}

export function createCinemeta({
  fetchImpl = globalThis.fetch,
  timeoutMs = CINEMETA_TIMEOUT_MS,
  concurrency = CINEMETA_CONCURRENCY,
} = {}) {
  let active = 0;
  const waiting = [];
  const acquire = () =>
    active < concurrency ? (active++, Promise.resolve()) : new Promise((res) => waiting.push(res));
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else active--;
  };

  // Resolves to YYYY-MM-DD or null (no released episode); rejects on any failure.
  async function latest(imdbId, now = Date.now()) {
    await acquire();
    try {
      const res = await fetchImpl(`${CINEMETA_HOST}/meta/series/${imdbId}.json`, {
        redirect: 'follow', // Cinemeta answers 307
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`Cinemeta ${res.status}`);
      return latestReleased(await res.json(), now);
    } finally {
      release();
    }
  }
  return { latest };
}
