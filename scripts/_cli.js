// Shared by the helper scripts: token, client, and a redacted error exit.
import { createClient } from '../src/tmdb.js';
import { readToken, NO_TOKEN } from '../src/tools.js';
import { redactor } from '../src/build.js';

export async function withClient(fn) {
  const token = await readToken();
  if (!token) fail(NO_TOKEN);
  try {
    console.log(await fn(createClient({ token })));
  } catch (e) {
    fail(redactor(token)(e instanceof Error ? e.message : e));
  }
}

export function fail(msg) {
  console.error(msg);
  process.exit(1);
}
