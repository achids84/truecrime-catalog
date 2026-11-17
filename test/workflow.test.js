// The deploy rule: a failed check or build must leave the live Pages site unchanged.
// Read as text (no YAML dependency); the order of steps and the job dependency are what matter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const yml = await readFile(new URL('../.github/workflows/build.yml', import.meta.url), 'utf8');
const at = (s) => {
  const i = yml.indexOf(s);
  assert.ok(i >= 0, `missing: ${s}`);
  return i;
};

test('config check runs before the TMDB build, which runs before the Pages upload', () => {
  assert.ok(at('run: npm run check') < at('run: npm run build:ci'));
  assert.ok(at('run: npm run build:ci') < at('actions/upload-pages-artifact'));
  assert.ok(!/continue-on-error/.test(yml)); // a failing step must stop the job
});

test('deploy needs the build job, so a failed build never deploys', () => {
  assert.match(yml, /deploy:\n\s+needs: build/);
  assert.ok(at('actions/deploy-pages') > at('deploy:'));
});

test('a push to main (any path, so config/** too) triggers the workflow', () => {
  assert.match(yml, /push:\n\s+branches: \[main\]/);
  assert.ok(!/\bpaths(-ignore)?:/.test(yml)); // no path filter that could skip config/
});
