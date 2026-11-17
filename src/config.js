// Catalogue configuration: config/catalogues.json. Validation is pure and offline.
// Every problem is collected and reported with the entry and field, for example
//   catalogues[2].sort: must be one of popularity.desc, vote_average.desc, ...
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const CONFIG_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'config', 'catalogues.json');

export const KINDS = ['trending', 'new', 'discover'];
export const TYPE_NAMES = ['movie', 'series'];
export const SORTS = ['popularity.desc', 'vote_average.desc', 'primary_release_date.desc', 'first_air_date.desc'];
export const MAX_ENABLED_PER_TYPE = 8; // GameDay shows at most 20 rails per tab across all addons
export const ID_PATTERN = /^tc-[a-z0-9-]+$/;
export const BASE_FIELDS = ['id', 'name', 'kind', 'types', 'enabled'];
export const DISCOVER_FIELDS = ['sort', 'minVotes', 'yearFrom', 'yearTo', 'language', 'genresAll', 'keywordsAll', 'limit'];
const TOP_FIELDS = ['_readme', 'catalogues'];
const MAX_LIST = 10;

export class ConfigError extends Error {
  constructor(errors) {
    super(`Invalid config/catalogues.json:\n` + errors.map((e) => `  - ${e}`).join('\n'));
    this.name = 'ConfigError';
    this.errors = errors;
  }
}

const isInt = (v) => Number.isInteger(v);
const show = (v) => (typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v) ?? String(v));
const list = (a) => a.join(', ');

function checkInt(errors, at, field, v, min, max) {
  if (!isInt(v) || v < min || v > max) errors.push(`${at}.${field}: must be a whole number from ${min} to ${max} (got ${show(v)})`);
}

function checkIdList(errors, at, field, v) {
  if (!Array.isArray(v) || v.length < 1 || v.length > MAX_LIST) {
    errors.push(`${at}.${field}: must be a list of 1 to ${MAX_LIST} TMDB ids, like [80, 99] (got ${show(v)})`);
  } else if (!v.every((n) => isInt(n) && n > 0)) {
    errors.push(`${at}.${field}: every entry must be a positive whole number (got ${show(v)})`);
  }
}

// Returns an array of error strings; empty means valid.
export function validateConfig(cfg, { now = Date.now() } = {}) {
  const errors = [];
  if (cfg === null || typeof cfg !== 'object' || Array.isArray(cfg)) {
    return ['config: the file must contain one JSON object with a "catalogues" list'];
  }
  for (const k of Object.keys(cfg)) {
    if (!TOP_FIELDS.includes(k)) errors.push(`config.${k}: unknown field (allowed: ${list(TOP_FIELDS)})`);
  }
  if ('_readme' in cfg && typeof cfg._readme !== 'string') errors.push('config._readme: must be text');
  const entries = cfg.catalogues;
  if (!Array.isArray(entries)) {
    errors.push('config.catalogues: must be a list');
    return errors;
  }
  const maxYear = new Date(now).getUTCFullYear() + 1;
  const firstIndexOfId = new Map();
  const enabledPerType = { movie: 0, series: 0 };
  let enabledTotal = 0;
  let unsure = false; // an entry has a broken enabled or types, so "none enabled" would be noise

  entries.forEach((e, i) => {
    const at = `catalogues[${i}]`;
    if (e === null || typeof e !== 'object' || Array.isArray(e)) {
      errors.push(`${at}: must be an object`);
      return;
    }
    const kindOk = KINDS.includes(e.kind);
    const allowed = kindOk && e.kind === 'discover' ? [...BASE_FIELDS, ...DISCOVER_FIELDS] : BASE_FIELDS;
    for (const k of Object.keys(e)) {
      if (allowed.includes(k)) continue;
      errors.push(
        DISCOVER_FIELDS.includes(k) && kindOk
          ? `${at}.${k}: only allowed when kind is "discover" (this entry is "${e.kind}")`
          : `${at}.${k}: unknown field (allowed: ${list(allowed)})`,
      );
    }

    if (typeof e.id !== 'string' || !ID_PATTERN.test(e.id)) {
      errors.push(`${at}.id: must match tc-[a-z0-9-]+, lower case letters, digits and dashes (got ${show(e.id)})`);
    } else if (e.id === 'tc-popular') {
      errors.push(`${at}.id: "tc-popular" was removed in 0.1.1 and must not come back`);
    } else if (firstIndexOfId.has(e.id)) {
      errors.push(`${at}.id: duplicate of catalogues[${firstIndexOfId.get(e.id)}].id (${show(e.id)})`);
    } else {
      firstIndexOfId.set(e.id, i);
    }
    if (typeof e.name !== 'string' || e.name.trim() === '' || e.name.length > 60) {
      errors.push(`${at}.name: must be text of 1 to 60 characters (got ${show(e.name)})`);
    }
    if (!kindOk) errors.push(`${at}.kind: must be one of ${list(KINDS)} (got ${show(e.kind)})`);

    let typesOk = false;
    if (
      Array.isArray(e.types) &&
      e.types.length >= 1 &&
      e.types.every((t) => TYPE_NAMES.includes(t)) &&
      new Set(e.types).size === e.types.length
    ) {
      typesOk = true;
    } else {
      errors.push(`${at}.types: must be ["movie"], ["series"] or ["movie","series"] (got ${show(e.types)})`);
    }
    if (typeof e.enabled !== 'boolean') {
      errors.push(`${at}.enabled: must be true or false, without quotes (got ${show(e.enabled)})`);
      unsure = true;
    } else if (e.enabled && !typesOk) {
      unsure = true;
    } else if (e.enabled) {
      enabledTotal++;
      for (const t of e.types) enabledPerType[t]++;
    }

    if (kindOk && e.kind === 'discover') {
      if ('sort' in e && !SORTS.includes(e.sort)) errors.push(`${at}.sort: must be one of ${list(SORTS)} (got ${show(e.sort)})`);
      if ('minVotes' in e) checkInt(errors, at, 'minVotes', e.minVotes, 0, 10000);
      if ('yearFrom' in e) checkInt(errors, at, 'yearFrom', e.yearFrom, 1900, maxYear);
      if ('yearTo' in e) checkInt(errors, at, 'yearTo', e.yearTo, 1900, maxYear);
      if (isInt(e.yearFrom) && isInt(e.yearTo) && e.yearFrom > e.yearTo) {
        errors.push(`${at}.yearFrom: must not be after yearTo (${e.yearFrom} > ${e.yearTo})`);
      }
      if ('language' in e && !(typeof e.language === 'string' && /^[a-z]{2}$/.test(e.language))) {
        errors.push(`${at}.language: must be a two letter lower case code like "en" (got ${show(e.language)})`);
      }
      if ('genresAll' in e) checkIdList(errors, at, 'genresAll', e.genresAll);
      if ('keywordsAll' in e) checkIdList(errors, at, 'keywordsAll', e.keywordsAll);
      if ('limit' in e) checkInt(errors, at, 'limit', e.limit, 1, 500);
    }
  });

  if (enabledTotal === 0 && !unsure) errors.push('config.catalogues: at least one catalogue must be enabled');
  for (const t of TYPE_NAMES) {
    if (enabledPerType[t] > MAX_ENABLED_PER_TYPE) {
      errors.push(
        `config.catalogues: ${enabledPerType[t]} enabled catalogues for ${t}, the most allowed is ${MAX_ENABLED_PER_TYPE} (GameDay shows at most 20 rails per tab across all addons)`,
      );
    }
  }
  return errors;
}

// Throws ConfigError listing every problem; returns the config otherwise.
export function parseConfig(cfg, opts) {
  const errors = validateConfig(cfg, opts);
  if (errors.length) throw new ConfigError(errors);
  return cfg;
}

export async function loadConfig(file = CONFIG_PATH, opts) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (e) {
    throw new ConfigError([`config: cannot read ${file} (${e.code ?? e.message})`]);
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new ConfigError([`config: not valid JSON (${e.message})`]);
  }
  return parseConfig(json, opts);
}

export const enabledCatalogues = (cfg) => cfg.catalogues.filter((c) => c.enabled);

// Stremio types that have at least one enabled catalogue, in manifest order.
export const activeTypes = (cats) => TYPE_NAMES.filter((t) => cats.some((c) => c.types.includes(t)));
