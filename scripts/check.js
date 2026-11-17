// npm run check [-- path/to/catalogues.json]: validate the catalogue config. Offline, no token.
import { runCheck } from '../src/tools.js';
import { fail } from './_cli.js';

try {
  console.log(await runCheck(process.argv[2]));
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}
