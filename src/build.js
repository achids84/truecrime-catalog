// Build entry point: node --env-file=.env.local src/build.js
// Reads TMDB_TOKEN from the environment. Exits non-zero and writes nothing to dist/ on failure.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from './tmdb.js';
import { loadIdMap, saveIdMap } from './idmap.js';
import { confirmKeyword } from './universe.js';
import { collect } from './collect.js';
import { loadConfig, parseConfig, enabledCatalogues } from './config.js';
import { assertMinimums, planOutput, writeDist, BuildError } from './writer.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// config: an already parsed config object (tests); otherwise config/catalogues.json is read.
// Either way it is validated first, before any TMDB call.
export async function runBuild({
  token,
  fetchImpl = globalThis.fetch,
  sleep,
  now = Date.now(),
  distDir = join(ROOT, 'dist'),
  idmapPath = join(ROOT, 'data', 'idmap.json'),
  version,
  config,
  configPath,
  log = () => {},
} = {}) {
  const cfg = config ? parseConfig(config, { now }) : await loadConfig(configPath, { now });
  const catalogues = enabledCatalogues(cfg);
  log(`config ok: ${catalogues.length} enabled catalogues`);

  const client = createClient({ token, fetchImpl, ...(sleep ? { sleep } : {}) });
  version ??= JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')).version;

  log('checking keyword 33722');
  await confirmKeyword(client);

  const idmap = await loadIdMap(idmapPath);
  const { catalogs, skippedNoImdb, padded, newestNew, contribution } = await collect({
    client,
    catalogues,
    idmap,
    now,
    log,
    persist: () => saveIdMap(idmapPath, idmap),
  });

  assertMinimums(catalogs, undefined, catalogues); // throws before anything is written

  const files = planOutput({
    version,
    builtAt: new Date(now).toISOString(),
    catalogs,
    skippedNoImdb,
    padded,
    newestNew,
    contributions: contribution,
    catalogues,
  });
  await writeDist(distDir, files);
  log(`wrote ${files.size} files to dist/`);
  return { catalogs, skippedNoImdb, padded };
}

// Redacts the token from anything that is logged, as a belt-and-braces guard.
export function redactor(token) {
  return (s) => (token ? String(s).split(token).join('[redacted]') : String(s));
}

async function main() {
  const token = process.env.TMDB_TOKEN;
  if (!token) {
    console.error(
      'TMDB_TOKEN is not set. Put it in .env.local (TMDB_TOKEN=...) or export it. See docs/DEPLOY.md.',
    );
    process.exit(1);
  }
  const redact = redactor(token);
  try {
    await runBuild({ token, log: (m) => console.log(redact(m)) });
  } catch (e) {
    console.error(redact(`Build failed: ${e instanceof Error ? e.message : e}`));
    console.error('dist/ was not modified.');
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
export { BuildError };
