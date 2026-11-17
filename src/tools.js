// Helpers behind `npm run check`, `npm run keywords` and `npm run preview`.
// Each returns text; the thin scripts in scripts/ print it. None of them writes to dist/ or data/.
import { readFile } from 'node:fs/promises';
import { loadConfig, enabledCatalogues, activeTypes, MAX_ENABLED_PER_TYPE } from './config.js';
import { loadIdMap } from './idmap.js';
import { collect } from './collect.js';
import { MIN_ITEMS } from './writer.js';

export const KEYWORD_RESULTS = 10;
export const PREVIEW_TITLES = 15;

// The token comes from the environment, else from the TMDB_TOKEN line of .env.local. Never printed.
export async function readToken({ env = process.env, envFile = '.env.local' } = {}) {
  if (env.TMDB_TOKEN) return env.TMDB_TOKEN;
  try {
    const m = /^\s*TMDB_TOKEN\s*=\s*(.*?)\s*$/m.exec(await readFile(envFile, 'utf8'));
    return m ? m[1].replace(/^(['"])(.*)\1$/, '$2') : '';
  } catch {
    return '';
  }
}

export const NO_TOKEN =
  'TMDB_TOKEN is not set. Put TMDB_TOKEN=... in .env.local (it is gitignored) or export it.';

// npm run check: validate config/catalogues.json, offline.
export async function runCheck(configPath) {
  const cfg = await loadConfig(configPath); // throws ConfigError with every problem
  const on = enabledCatalogues(cfg);
  const lines = [`config ok: ${cfg.catalogues.length} catalogues, ${on.length} enabled`];
  for (const type of activeTypes(on)) {
    const mine = on.filter((c) => c.types.includes(type));
    lines.push(`  ${type} (${mine.length} of ${MAX_ENABLED_PER_TYPE} allowed): ${mine.map((c) => c.id).join(', ')}`);
  }
  const off = cfg.catalogues.filter((c) => !c.enabled).map((c) => c.id);
  if (off.length) lines.push(`  disabled: ${off.join(', ')}`);
  return lines.join('\n');
}

// npm run keywords -- "text": id and name of the top matches.
export async function runKeywords(client, query) {
  const q = String(query ?? '').trim();
  if (!q) throw new Error('Usage: npm run keywords -- "some text"');
  const res = await client.get('/search/keyword', { query: q });
  const hits = (res?.results ?? []).slice(0, KEYWORD_RESULTS);
  if (!hits.length) return `No TMDB keywords match "${q}".`;
  return hits.map((k) => `${String(k.id).padStart(8)}  ${k.name}`).join('\n');
}

// npm run preview -- <id>: what one catalogue would contain. Works for disabled entries too.
// IMDb ids are read from data/idmap.json and missing ones fetched, but nothing is saved.
export async function runPreview({ client, id, configPath, idmapPath, now = Date.now() }) {
  const cfg = await loadConfig(configPath);
  const entry = cfg.catalogues.find((c) => c.id === id);
  if (!entry) {
    throw new Error(
      `No catalogue with id ${JSON.stringify(id ?? '')}. Ids in the config: ${cfg.catalogues.map((c) => c.id).join(', ')}`,
    );
  }
  const idmap = await loadIdMap(idmapPath);
  const { catalogs, padded, skippedNoImdb } = await collect({
    client,
    catalogues: [{ ...entry, enabled: true }],
    idmap,
    now,
  });
  const lines = [`${entry.id} "${entry.name}" (${entry.kind}${entry.enabled ? '' : ', currently disabled'})`];
  for (const type of activeTypes([entry])) {
    const metas = catalogs[type][entry.id];
    lines.push('', `${type}: ${metas.length} titles` +
      (padded[type] ? ` (${padded[type]} added to reach ${MIN_ITEMS})` : '') +
      `, ${skippedNoImdb[type]} candidates skipped for no IMDb id`);
    if (metas.length < MIN_ITEMS) {
      lines.push(`  WARNING: under ${MIN_ITEMS} titles. If enabled, the build would fail.`);
    }
    metas.slice(0, PREVIEW_TITLES).forEach((m, i) => {
      lines.push(`  ${String(i + 1).padStart(2)}. ${m.name}${m.releaseInfo ? ` (${m.releaseInfo})` : ''}  ${m.id}`);
    });
  }
  lines.push('', 'Nothing was written.');
  return lines.join('\n');
}
