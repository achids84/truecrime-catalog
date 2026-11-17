import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  validateConfig, parseConfig, loadConfig, ConfigError, enabledCatalogues, activeTypes, CONFIG_PATH,
} from '../src/config.js';

const NOW = Date.parse('2026-11-17T12:00:00Z');
const entry = (o = {}) => ({ id: 'tc-a', name: 'A', kind: 'trending', types: ['movie', 'series'], enabled: true, ...o });
const errs = (catalogues, extra = {}) => validateConfig({ catalogues, ...extra }, { now: NOW });
const only = (catalogues) => {
  const e = errs(catalogues);
  assert.equal(e.length, 1, e.join('\n'));
  return e[0];
};

test('the shipped config is valid, with trending and new enabled and one disabled discover example', async () => {
  const cfg = await loadConfig(CONFIG_PATH, { now: NOW });
  assert.deepEqual(enabledCatalogues(cfg).map((c) => [c.id, c.kind]), [['tc-trending', 'trending'], ['tc-new', 'new']]);
  const off = cfg.catalogues.filter((c) => !c.enabled);
  assert.equal(off.length, 1);
  assert.equal(off[0].kind, 'discover');
  assert.equal(off[0].name, 'Top rated');
  assert.equal(typeof cfg._readme, 'string');
});

test('a full valid discover entry passes, and _readme is allowed', () => {
  const full = entry({
    id: 'tc-x1', kind: 'discover', sort: 'popularity.desc', minVotes: 0, yearFrom: 1900, yearTo: 2027,
    language: 'en', genresAll: [99, 80], keywordsAll: [1], limit: 500,
  });
  assert.deepEqual(errs([full, entry({ id: 'tc-b', kind: 'new', types: ['series'] })], { _readme: 'hi' }), []);
});

test('duplicate ids name both entries', () => {
  assert.equal(only([entry(), entry({ kind: 'new' })]), 'catalogues[1].id: duplicate of catalogues[0].id ("tc-a")');
});

test('a duplicate counts even when one of the two is disabled', () => {
  assert.match(only([entry(), entry({ enabled: false })]), /^catalogues\[1\]\.id: duplicate/);
});

test('bad id pattern', () => {
  for (const id of ['trending', 'tc-', 'TC-a', 'tc-a b', 'tc_a', 'tc-é', '', 5, undefined]) {
    assert.match(only([entry({ id })]), /^catalogues\[0\]\.id: must match tc-\[a-z0-9-\]\+/, String(id));
  }
});

test('tc-popular stays gone', () => {
  assert.match(only([entry({ id: 'tc-popular' })]), /catalogues\[0\]\.id: "tc-popular" was removed/);
});

test('unknown kind', () => {
  assert.equal(only([entry({ kind: 'popular' })]), 'catalogues[0].kind: must be one of trending, new, discover (got "popular")');
});

test('unknown fields are errors, at the top and in entries', () => {
  assert.match(only([entry({ colour: 'red' })]), /^catalogues\[0\]\.colour: unknown field/);
  assert.match(errs([entry()], { extra: 1 })[0], /^config\.extra: unknown field/);
});

test('discover-only fields are refused on trending and new, with a clear reason', () => {
  assert.equal(
    only([entry({ limit: 10 })]),
    'catalogues[0].limit: only allowed when kind is "discover" (this entry is "trending")',
  );
  assert.match(only([entry({ kind: 'new', sort: 'popularity.desc' })]), /^catalogues\[0\]\.sort: only allowed/);
});

test('bad sort lists the allowed values', () => {
  assert.equal(
    only([entry({ kind: 'discover', sort: 'revenue.desc' })]),
    'catalogues[0].sort: must be one of popularity.desc, vote_average.desc, primary_release_date.desc, first_air_date.desc (got "revenue.desc")',
  );
});

test('out of range numbers', () => {
  const d = (o) => entry({ kind: 'discover', ...o });
  const cases = [
    [{ minVotes: -1 }, 'minVotes'], [{ minVotes: 10001 }, 'minVotes'], [{ minVotes: 1.5 }, 'minVotes'], [{ minVotes: '5' }, 'minVotes'],
    [{ yearFrom: 1899 }, 'yearFrom'], [{ yearTo: 2028 }, 'yearTo'], [{ yearFrom: 'x' }, 'yearFrom'],
    [{ limit: 0 }, 'limit'], [{ limit: 501 }, 'limit'], [{ limit: null }, 'limit'],
  ];
  for (const [o, field] of cases) assert.match(only([d(o)]), new RegExp(`^catalogues\\[0\\]\\.${field}: must be a whole number`), JSON.stringify(o));
  assert.deepEqual(errs([d({ yearTo: 2027 })]), []); // next year is allowed
  assert.match(only([d({ yearFrom: 2020, yearTo: 2010 })]), /^catalogues\[0\]\.yearFrom: must not be after yearTo/);
});

test('language, genresAll and keywordsAll', () => {
  const d = (o) => entry({ kind: 'discover', ...o });
  assert.match(only([d({ language: 'EN' })]), /\.language: must be a two letter/);
  assert.match(only([d({ language: 'eng' })]), /\.language: must be a two letter/);
  assert.match(only([d({ genresAll: [] })]), /\.genresAll: must be a list of 1 to 10/);
  assert.match(only([d({ genresAll: '99' })]), /\.genresAll: must be a list/);
  assert.match(only([d({ keywordsAll: [1, 'a'] })]), /\.keywordsAll: every entry must be a positive whole number/);
  assert.match(only([d({ keywordsAll: [0] })]), /\.keywordsAll: every entry/);
});

test('wrong types value', () => {
  for (const types of ['both', 'movie', [], ['tv'], ['movie', 'movie'], undefined]) {
    assert.match(only([entry({ types })]), /^catalogues\[0\]\.types: must be \["movie"\], \["series"\] or \["movie","series"\]/, String(types));
  }
});

test('enabled must be a real boolean', () => {
  assert.match(only([entry({ enabled: 'true' })]), /^catalogues\[0\]\.enabled: must be true or false/);
});

test('none enabled', () => {
  assert.equal(only([entry({ enabled: false })]), 'config.catalogues: at least one catalogue must be enabled');
  assert.equal(only([]), 'config.catalogues: at least one catalogue must be enabled');
});

test('more than 8 enabled for a type is an error; 8 is fine; disabled ones do not count', () => {
  const many = (n, types, extra = {}) =>
    Array.from({ length: n }, (_, i) => entry({ id: `tc-d${i}`, kind: 'discover', types, ...extra }));
  assert.deepEqual(errs(many(8, ['movie', 'series'])), []);
  assert.match(only(many(9, ['movie'])), /9 enabled catalogues for movie, the most allowed is 8/);
  assert.deepEqual(errs([...many(8, ['movie']), ...many(8, ['series']).map((c) => ({ ...c, id: c.id + 'x' }))]), []);
  assert.deepEqual(errs([...many(8, ['movie']), entry({ id: 'tc-off', kind: 'discover', types: ['movie'], enabled: false })]), []);
  assert.equal(errs(many(9, ['movie', 'series'])).length, 2); // reported per type
});

test('every problem is reported at once, and ConfigError text is plain', () => {
  const bad = [entry({ id: 'x' }), entry({ id: 'tc-ok', kind: 'nope' })];
  assert.equal(errs(bad).length, 2);
  assert.throws(
    () => parseConfig({ catalogues: bad }, { now: NOW }),
    (e) => e instanceof ConfigError && /catalogues\[0\]\.id/.test(e.message) && /catalogues\[1\]\.kind/.test(e.message),
  );
});

test('non-object input and a missing list', () => {
  assert.match(validateConfig(null)[0], /one JSON object/);
  assert.match(validateConfig({})[0], /config\.catalogues: must be a list/);
  assert.match(validateConfig({ catalogues: [7] })[0], /^catalogues\[0\]: must be an object/);
});

test('activeTypes follows the enabled entries', () => {
  assert.deepEqual(activeTypes([entry({ types: ['series'] })]), ['series']);
  assert.deepEqual(activeTypes([entry({ types: ['series'] }), entry({ id: 'tc-b', types: ['movie'] })]), ['movie', 'series']);
});

test('loadConfig reports unreadable and unparsable files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cfg-'));
  await assert.rejects(loadConfig(join(dir, 'missing.json')), /cannot read/);
  await writeFile(join(dir, 'bad.json'), '{ "catalogues": [ ');
  await assert.rejects(loadConfig(join(dir, 'bad.json')), /not valid JSON/);
  await writeFile(join(dir, 'arr.json'), '[]');
  await assert.rejects(loadConfig(join(dir, 'arr.json')), /one JSON object/);
  assert.ok((await readFile(CONFIG_PATH, 'utf8')).endsWith('\n'));
});
