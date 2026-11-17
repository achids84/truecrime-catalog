import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, stat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runCheck, runKeywords, runPreview, readToken } from '../src/tools.js';
import { createClient } from '../src/tmdb.js';
import { ConfigError } from '../src/config.js';
import { mockFetch } from './helpers.js';
import { fakeTmdb, TODAY } from './fake-tmdb.js';

const TOKEN = 'eyJ.PREVIEW-SECRET.sig';
const clientFor = (handler) => {
  const f = mockFetch(handler);
  return { f, client: createClient({ token: TOKEN, fetchImpl: f, sleep: async () => {} }) };
};
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const dir = () => mkdtemp(join(tmpdir(), 'tools-'));
async function cfgFile(catalogues) {
  const file = join(await dir(), 'c.json');
  await writeFile(file, JSON.stringify({ catalogues }));
  return file;
}
const base = { types: ['movie', 'series'], enabled: true };
const top = { id: 'tc-top', name: 'Top', kind: 'discover', ...base, enabled: false, sort: 'vote_average.desc', limit: 40 };
const trending = { id: 'tc-trending', name: 'Trending this week', kind: 'trending', ...base };

test('check: summary for the shipped config; errors name the entry and field', async () => {
  const out = await runCheck();
  assert.match(out, /config ok: 3 catalogues, 2 enabled/);
  assert.match(out, /movie \(2 of 8 allowed\): tc-trending, tc-new/);
  assert.match(out, /disabled: tc-top-rated/);
  await assert.rejects(
    runCheck(await cfgFile([{ ...trending, kind: 'nope' }])),
    (e) => e instanceof ConfigError && /catalogues\[0\]\.kind/.test(e.message),
  );
});

test('check script: exit 0 on the shipped config, exit 1 with the message on a bad one, no token needed', async () => {
  const env = { ...process.env, TMDB_TOKEN: '' };
  const ok = spawnSync(process.execPath, ['scripts/check.js'], { cwd: ROOT, env, encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  const bad = spawnSync(process.execPath, ['scripts/check.js', await cfgFile([{ ...trending, id: 'Bad' }])], {
    cwd: ROOT, env, encoding: 'utf8',
  });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /catalogues\[0\]\.id: must match tc-\[a-z0-9-\]\+/);
});

test('keywords: top 10 as id and name; nothing found; empty query', async () => {
  const { f, client } = clientFor(() => ({
    results: Array.from({ length: 14 }, (_, i) => ({ id: 100 + i, name: `kw ${i}` })),
  }));
  const out = await runKeywords(client, ' serial killer ');
  assert.equal(out.split('\n').length, 10);
  assert.equal(out.split('\n')[0], '     100  kw 0');
  const u = new URL(f.calls[0].url);
  assert.equal(u.pathname, '/3/search/keyword');
  assert.equal(u.searchParams.get('query'), 'serial killer');
  assert.ok(!f.calls[0].url.includes(TOKEN));

  assert.match(await runKeywords(clientFor(() => ({ results: [] })).client, 'zzz'), /No TMDB keywords match "zzz"/);
  await assert.rejects(runKeywords(client, '  '), /Usage/);
});

test('preview: a disabled discover entry shows 15 titles and counts, and writes nothing', async () => {
  const d = await dir();
  const idmapPath = join(d, 'data', 'idmap.json');
  const configPath = await cfgFile([trending, top]);
  const { f, client } = clientFor(fakeTmdb({ nullEvery: 0 }));
  const out = await runPreview({ client, id: 'tc-top', configPath, idmapPath, now: TODAY });
  assert.match(out, /^tc-top "Top" \(discover, currently disabled\)/);
  assert.match(out, /movie: 40 titles, 0 candidates skipped for no IMDb id/);
  assert.match(out, /series: 40 titles/);
  const titles = out.split('\n').filter((l) => /^\s+\d+\. /.test(l));
  assert.equal(titles.length, 30); // 15 per type
  assert.match(titles[0], /^ {3}1\. Movie 2001 \(20\d\d\) {2}tt1002001$/);
  assert.match(titles[14], /^ {2}15\. /);
  assert.match(titles[15], /^ {3}1\. Show 2001/);
  assert.match(out, /Nothing was written\.$/);
  await assert.rejects(stat(join(d, 'data'))); // idmap not saved
  await assert.rejects(stat(join(d, 'dist')));
  assert.ok(f.calls.every((c) => c.url.startsWith('https://api.themoviedb.org/') && !c.url.includes(TOKEN)));
  assert.ok(!out.includes(TOKEN));
});

test('preview: trending counts padding, small catalogues are warned about, unknown ids list the choices', async () => {
  const idmapPath = join(await dir(), 'idmap.json');
  const configPath = await cfgFile([trending, { ...top, limit: 10 }]);
  const { client } = clientFor(fakeTmdb({ nullEvery: 0, trendingHits: 5 }));
  const t = await runPreview({ client, id: 'tc-trending', configPath, idmapPath, now: TODAY });
  assert.match(t, /movie: 20 titles \(\d+ added to reach 20\)/);
  const small = await runPreview({
    client: clientFor(fakeTmdb({ nullEvery: 0 })).client, id: 'tc-top', configPath, idmapPath, now: TODAY,
  });
  assert.match(small, /WARNING: under 20 titles/);
  await assert.rejects(
    runPreview({ client, id: 'tc-nope', configPath, idmapPath }),
    /No catalogue with id "tc-nope".*tc-trending, tc-top/,
  );
  await assert.rejects(runPreview({ client, id: undefined, configPath, idmapPath }), /No catalogue with id ""/);
});

test('preview does not change an existing idmap file', async () => {
  const d = await dir();
  const idmapPath = join(d, 'idmap.json');
  const before = JSON.stringify({ 'movie:1': 'tt1', _nullChecked: {} });
  await writeFile(idmapPath, before);
  await runPreview({
    client: clientFor(fakeTmdb({ nullEvery: 0 })).client, id: 'tc-top',
    configPath: await cfgFile([trending, top]), idmapPath, now: TODAY,
  });
  assert.equal(await readFile(idmapPath, 'utf8'), before);
});

test('token: from the environment first, then .env.local', async () => {
  const d = await dir();
  const envFile = join(d, '.env.local');
  await writeFile(envFile, '# c\nOTHER=1\nTMDB_TOKEN="abc.def"\n');
  assert.equal(await readToken({ env: { TMDB_TOKEN: 'fromenv' }, envFile }), 'fromenv');
  assert.equal(await readToken({ env: {}, envFile }), 'abc.def');
  await writeFile(envFile, 'TMDB_TOKEN=plain.value  \n');
  assert.equal(await readToken({ env: {}, envFile }), 'plain.value');
  assert.equal(await readToken({ env: {}, envFile: join(d, 'missing') }), '');
});

test('keywords and preview scripts stop with a clear message when there is no token', () => {
  const env = { ...process.env, TMDB_TOKEN: '' };
  for (const s of ['keywords', 'preview']) {
    // run from an empty directory so a real .env.local is not picked up
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts', `${s}.js`), 'x'], { cwd: tmpdir(), env, encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /TMDB_TOKEN is not set/);
  }
});
