// Local test server for dist/: npm run serve  (PORT env overrides 8080).
// Sends Access-Control-Allow-Origin: * and Content-Type: application/json for .json files,
// so the manifest URL can be tried in Stremio before anything is deployed.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname, sep } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.json': 'application/json', '.html': 'text/html; charset=utf-8' };

export function makeServer(distDir) {
  const base = normalize(distDir) + sep;
  return createServer(async (req, res) => {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors).end();
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, cors).end();
      return;
    }
    try {
      let rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (rel.endsWith('/')) rel += 'index.html';
      const file = normalize(join(distDir, rel));
      if (!file.startsWith(base)) throw Object.assign(new Error('outside'), { code: 'ENOENT' });
      if (!(await stat(file)).isFile()) throw Object.assign(new Error('nf'), { code: 'ENOENT' });
      const body = await readFile(file);
      res.writeHead(200, {
        ...cors,
        'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
        'Content-Length': body.length,
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      res.writeHead(404, { ...cors, 'Content-Type': 'application/json' }).end('{"error":"not found"}');
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const distDir = join(ROOT, 'dist');
  try {
    await stat(distDir);
  } catch {
    console.error('dist/ does not exist. Run npm run build first.');
    process.exit(1);
  }
  const port = Number(process.env.PORT) || 8080;
  makeServer(distDir).listen(port, '127.0.0.1', () => {
    console.log(`Serving dist/ at http://localhost:${port}/`);
    console.log(`Manifest: http://localhost:${port}/manifest.json`);
  });
}
