// Minimal TMDB v3 client authenticated with a v4 Read Access Token (Bearer).
// Retries 429/5xx/network errors with backoff, honours Retry-After, caps concurrency.
// The token only ever travels in the Authorization header; it is never put in a URL,
// an error message or a log line.

export const TMDB_HOST = 'https://api.themoviedb.org/3';

export class TmdbError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'TmdbError';
    this.status = status;
  }
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function parseRetryAfter(value, now = Date.now()) {
  if (value == null || value === '') return null;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const when = Date.parse(value);
  return Number.isNaN(when) ? null : Math.max(0, when - now);
}

export function createClient({
  token,
  fetchImpl = globalThis.fetch,
  sleep = defaultSleep,
  concurrency = 10,
  maxRetries = 5,
  baseDelayMs = 500,
  maxDelayMs = 30000,
} = {}) {
  if (!token) throw new TmdbError('TMDB_TOKEN is not set', 0);

  let active = 0;
  const waiting = [];
  const acquire = () =>
    active < concurrency
      ? (active++, Promise.resolve())
      : new Promise((res) => waiting.push(res));
  const release = () => {
    const next = waiting.shift();
    if (next) next(); // the slot passes straight to the next waiter
    else active--;
  };

  function buildUrl(path, params) {
    const u = new URL(TMDB_HOST + path);
    for (const [k, v] of Object.entries(params ?? {})) u.searchParams.set(k, String(v));
    return u;
  }

  async function attemptLoop(path, params) {
    const url = buildUrl(path, params);
    for (let attempt = 0; ; attempt++) {
      let res = null;
      let netErr = false;
      try {
        res = await fetchImpl(url, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        });
      } catch {
        netErr = true; // message deliberately dropped
      }
      if (res && res.ok) return res.json();

      const status = res ? res.status : 0;
      const retryable = netErr || status === 429 || status >= 500;
      if (!retryable) throw new TmdbError(`TMDB ${status} for ${path}`, status);
      if (attempt >= maxRetries) {
        throw new TmdbError(
          `TMDB ${netErr ? 'network error' : status} for ${path} after ${attempt + 1} attempts`,
          status,
        );
      }
      const ra = res ? parseRetryAfter(res.headers?.get?.('retry-after')) : null;
      const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
      await sleep(ra != null ? Math.min(ra, maxDelayMs * 4) : backoff);
    }
  }

  async function get(path, params) {
    await acquire();
    try {
      return await attemptLoop(path, params);
    } finally {
      release();
    }
  }

  return { get };
}
