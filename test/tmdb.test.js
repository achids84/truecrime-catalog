import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, parseRetryAfter, TmdbError } from '../src/tmdb.js';
import { jsonRes, mockFetch } from './helpers.js';

test('sends Bearer header, token never in URL', async () => {
  const f = mockFetch(() => ({ fine: 1 }));
  const c = createClient({ token: 'SECRET123', fetchImpl: f });
  await c.get('/trending/movie/week', { page: 2 });
  assert.equal(f.calls[0].opts.headers.Authorization, 'Bearer SECRET123');
  assert.ok(!f.calls[0].url.includes('SECRET123'));
  assert.match(f.calls[0].url, /page=2/);
});

test('missing token throws', () => {
  assert.throws(() => createClient({ token: '' }), TmdbError);
});

test('retries 429 honouring Retry-After, then succeeds', async () => {
  const sleeps = [];
  let n = 0;
  const f = mockFetch(() => (++n === 1 ? jsonRes({}, 429, { 'retry-after': '3' }) : { done: true }));
  const c = createClient({ token: 't', fetchImpl: f, sleep: async (ms) => sleeps.push(ms) });
  assert.deepEqual(await c.get('/x'), { done: true });
  assert.deepEqual(sleeps, [3000]);
});

test('retries 5xx with exponential backoff', async () => {
  const sleeps = [];
  let n = 0;
  const f = mockFetch(() => (++n <= 3 ? jsonRes({}, 503) : { fine: true }));
  const c = createClient({ token: 't', fetchImpl: f, baseDelayMs: 100, sleep: async (ms) => sleeps.push(ms) });
  await c.get('/x');
  assert.deepEqual(sleeps, [100, 200, 400]);
});

test('gives up after maxRetries with an error that has no token', async () => {
  const f = mockFetch(() => jsonRes({}, 500));
  const c = createClient({ token: 'SECRET123', fetchImpl: f, maxRetries: 2, sleep: async () => {} });
  await assert.rejects(c.get('/x'), (e) => e.status === 500 && !e.message.includes('SECRET123'));
  assert.equal(f.calls.length, 3);
});

test('does not retry other 4xx', async () => {
  const f = mockFetch(() => jsonRes({}, 401));
  const c = createClient({ token: 't', fetchImpl: f, sleep: async () => {} });
  await assert.rejects(c.get('/x'), { status: 401 });
  assert.equal(f.calls.length, 1);
});

test('network errors are retried and their message dropped', async () => {
  let n = 0;
  const f = async () => {
    if (++n < 2) throw new Error('boom https://x?api_key=LEAK');
    return jsonRes({ fine: 1 });
  };
  const c = createClient({ token: 't', fetchImpl: f, sleep: async () => {} });
  assert.deepEqual(await c.get('/x'), { fine: 1 });
});

test('concurrency never exceeds the limit', async () => {
  let cur = 0;
  let max = 0;
  const f = async () => {
    cur++;
    max = Math.max(max, cur);
    await new Promise((r) => setTimeout(r, 5));
    cur--;
    return jsonRes({});
  };
  const c = createClient({ token: 't', fetchImpl: f, concurrency: 10 });
  await Promise.all(Array.from({ length: 50 }, (_, i) => c.get(`/p/${i}`)));
  assert.equal(max, 10);
});

test('parseRetryAfter handles seconds, dates and junk', () => {
  assert.equal(parseRetryAfter('2'), 2000);
  assert.equal(parseRetryAfter(null), null);
  assert.equal(parseRetryAfter('nonsense'), null);
  assert.equal(parseRetryAfter(new Date(10_000).toUTCString(), 4000), 6000);
});
