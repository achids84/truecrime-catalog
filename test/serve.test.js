import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeServer } from '../scripts/serve.js';

// Loopback only; nothing leaves this machine.
test('serve sends CORS and JSON content type, 404s outside dist', async () => {
  const dist = await mkdtemp(join(tmpdir(), 'serve-'));
  await mkdir(join(dist, 'catalog'), { recursive: true });
  await writeFile(join(dist, 'manifest.json'), '{"id":"x"}');
  await writeFile(join(dist, 'index.html'), '<p>hi</p>');
  const server = makeServer(dist);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const m = await fetch(`${base}/manifest.json`);
    assert.equal(m.status, 200);
    assert.equal(m.headers.get('access-control-allow-origin'), '*');
    assert.match(m.headers.get('content-type'), /^application\/json/);
    assert.deepEqual(await m.json(), { id: 'x' });
    assert.match((await fetch(`${base}/`)).headers.get('content-type'), /text\/html/);
    const bad = await fetch(`${base}/..%2f..%2fpackage.json`);
    assert.equal(bad.status, 404);
    assert.equal((await fetch(`${base}/nope.json`)).status, 404);
    const pre = await fetch(`${base}/manifest.json`, { method: 'OPTIONS' });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-origin'), '*');
  } finally {
    server.close();
  }
});
