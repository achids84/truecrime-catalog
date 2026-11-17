// data/tvdates.json: per TMDB tv id, the dates behind the series New sort.
//   { "123": { "first_air_date": "2026-01-07", "last_air_date": "2026-10-19",
//              "status": "Returning Series", "checkedAt": "2026-11-17",
//              "cinemeta_last": "2026-11-17", "cinemetaCheckedAt": "2026-11-17" } }
// cinemeta_last: newest released episode (season >= 1) per Cinemeta, for non-final series only.
// Refresh rule keys on status: Ended and Canceled are cached for good; every other status
// (Returning Series, In Production, ...) and every missing entry is fetched on each build.
// A failed lookup never throws: the old entry stays, or there is none and the caller falls back
// to first_air_date.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export const FINAL_STATUSES = new Set(['Ended', 'Canceled']);

export async function loadTvDates(file) {
  try {
    const data = JSON.parse(await readFile(file, 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw e;
  }
}

export async function saveTvDates(file, map) {
  const out = {};
  for (const k of Object.keys(map).sort((a, b) => Number(a) - Number(b))) out[k] = map[k];
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(out, null, 2) + '\n');
}

export const needsTvLookup = (entry) => !entry || !FINAL_STATUSES.has(entry.status);

// items: [{ id }] series. Mutates map. Returns { fetched, failed }.
export async function resolveTvDates(items, map, client, now = Date.now()) {
  const today = new Date(now).toISOString().slice(0, 10);
  const todo = items.filter((it) => needsTvLookup(map[it.id]));
  let failed = 0;
  await Promise.all(
    todo.map(async (it) => {
      try {
        const r = await client.get(`/tv/${it.id}`, { language: 'en-US' });
        map[it.id] = {
          first_air_date: r?.first_air_date || null,
          last_air_date: r?.last_air_date || null,
          status: r?.status ?? null,
          checkedAt: today,
        };
      } catch {
        failed++; // degrade: keep the cached entry, or none
      }
    }),
  );
  return { fetched: todo.length, failed };
}

// Cinemeta lookups for items (needs item.imdb) whose series is not Ended or Canceled. Runs after
// resolveTvDates. Mutates map. A failed request keeps the cached cinemeta_last. Never throws.
// Returns { requests, failed }.
export async function resolveCinemeta(items, map, cinemeta, now = Date.now()) {
  const today = new Date(now).toISOString().slice(0, 10);
  const todo = items.filter((it) => it.imdb && needsTvLookup(map[it.id]));
  let failed = 0;
  await Promise.all(
    todo.map(async (it) => {
      try {
        const date = await cinemeta.latest(it.imdb, now);
        map[it.id] = { ...map[it.id], cinemeta_last: date, cinemetaCheckedAt: today };
      } catch {
        failed++; // degrade: cached Cinemeta date if any, else the TMDB date
      }
    }),
  );
  return { requests: todo.length, failed };
}

// Series sort key: the later of TMDB last_air_date and the Cinemeta date (ties: tmdb); else the
// first_air_date (the discover date). Ended and Canceled series ignore Cinemeta.
export function sortKey(item, entry) {
  const tmdb = entry?.last_air_date || null;
  const cin = entry && !FINAL_STATUSES.has(entry.status) ? entry.cinemeta_last || null : null;
  if (cin && (!tmdb || cin > tmdb)) return { sortDate: cin, sortSource: 'cinemeta' };
  if (tmdb) return { sortDate: tmdb, sortSource: 'tmdb' };
  return { sortDate: item.date, sortSource: 'first' };
}
