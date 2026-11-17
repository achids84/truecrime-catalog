// npm run keywords -- "text": TMDB keyword search, prints id and name of the top 10.
import { runKeywords } from '../src/tools.js';
import { withClient } from './_cli.js';

await withClient((client) => runKeywords(client, process.argv.slice(2).join(' ')));
