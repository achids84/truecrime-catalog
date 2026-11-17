// data/idmap.json: { "movie:123": "tt...", "tv:456": null, "_nullChecked": { "tv:456": "2026-01-01" } }
// Keys keep the documented shape. "_nullChecked" is a reserved key holding the date a null
// entry was last checked, which is how the 30 day recheck is possible.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export const NULL_RECHECK_DAYS = 30;
const META = '_nullChecked';
const DAY = 86400000;

export const keyFor = (kind, id) => `${kind}:${id}`; // kind: 'movie' | 'tv'

export async function loadIdMap(file) {
  try {
    const data = JSON.parse(await readFile(file, 'utf8'));
    if (!data[META]) data[META] = {};
    return data;
  } catch (e) {
    if (e.code === 'ENOENT') return { [META]: {} };
    throw e;
  }
}

export async function saveIdMap(file, map) {
  const out = {};
  for (const k of Object.keys(map).filter((k) => k !== META).sort()) out[k] = map[k];
  const checked = {};
  for (const k of Object.keys(map[META] ?? {}).sort()) {
    if (map[k] === null) checked[k] = map[META][k];
  }
  out[META] = checked;
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(out, null, 2) + '\n');
}

export function needsResolve(map, key, now) {
  if (!(key in map)) return true;
  if (map[key] !== null) return false;
  const last = Date.parse(map[META]?.[key] ?? '');
  if (Number.isNaN(last)) return true;
  return now - last >= NULL_RECHECK_DAYS * DAY;
}

// items: [{ kind: 'movie'|'tv', id }]. Mutates map. Returns { fetched }.
export async function resolveImdbIds(items, map, client, now = Date.now()) {
  if (!map[META]) map[META] = {};
  const today = new Date(now).toISOString().slice(0, 10);
  const todo = items.filter((it) => needsResolve(map, keyFor(it.kind, it.id), now));
  await Promise.all(
    todo.map(async (it) => {
      const key = keyFor(it.kind, it.id);
      let imdb = null;
      try {
        const r = await client.get(`/${it.kind}/${it.id}/external_ids`);
        imdb = /^tt\d+$/.test(r?.imdb_id ?? '') ? r.imdb_id : null;
      } catch (e) {
        if (e.status !== 404) throw e; // a deleted title is just "no IMDb id"
      }
      map[key] = imdb;
      if (imdb === null) map[META][key] = today;
      else delete map[META][key];
    }),
  );
  return { fetched: todo.length };
}

export function lookup(map, kind, id) {
  return map[keyFor(kind, id)] ?? null;
}
