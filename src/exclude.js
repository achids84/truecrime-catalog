// Exclusion list: config/exclude.json = {"movie": [tmdb ids], "series": [tmdb ids], "names": {"<id>": "<title>"}}.
// "names" is for readability only. Ids are TMDB ids (movie ids for "movie", tv ids for "series").
// A missing file means nothing is excluded. Anything malformed throws ExcludeError, which fails the build.
import { readFile } from 'node:fs/promises';

export class ExcludeError extends Error {}

const KINDS = ['movie', 'series'];

export function parseExclude(text, label = 'config/exclude.json') {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new ExcludeError(`${label} is not valid JSON (${e.message}). Fix the file and commit again.`);
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new ExcludeError(`${label} must be a JSON object like {"movie": [], "series": [], "names": {}}.`);
  }
  for (const key of Object.keys(data)) {
    if (![...KINDS, 'names'].includes(key)) {
      throw new ExcludeError(`${label}: unknown key "${key}" (allowed: movie, series, names).`);
    }
  }
  const out = { movie: new Set(), series: new Set() };
  for (const kind of KINDS) {
    const list = data[kind] ?? [];
    if (!Array.isArray(list)) throw new ExcludeError(`${label}: "${kind}" must be an array of integer TMDB ids.`);
    for (const id of list) {
      if (!Number.isSafeInteger(id) || id <= 0) {
        throw new ExcludeError(`${label}: "${kind}" holds ${JSON.stringify(id)}, which is not a positive integer TMDB id (no quotes, no decimals).`);
      }
      out[kind].add(id);
    }
  }
  if (data.names !== undefined) {
    const n = data.names;
    if (n === null || typeof n !== 'object' || Array.isArray(n) || Object.values(n).some((v) => typeof v !== 'string')) {
      throw new ExcludeError(`${label}: "names" must be an object of {"<id>": "<title>"} with text values.`);
    }
  }
  return out;
}

export async function loadExclude(path) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return { movie: new Set(), series: new Set() };
    throw e;
  }
  return parseExclude(text, 'config/exclude.json');
}

// Items are normalized ({id, ...}). kind is the TMDB kind ('movie' | 'tv').
export const excludeKey = (kind) => (kind === 'tv' ? 'series' : 'movie');
export const dropExcluded = (list, set) => (set.size ? list.filter((it) => !set.has(it.id)) : list);
