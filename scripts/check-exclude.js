// Validate config/exclude.json without a TMDB token: npm run check-exclude
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadExclude, ExcludeError } from '../src/exclude.js';

const path = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'config', 'exclude.json');
try {
  const ex = await loadExclude(path);
  console.log(`config/exclude.json is valid: ${ex.movie.size} movie ids, ${ex.series.size} series ids.`);
} catch (e) {
  console.error(e instanceof ExcludeError ? e.message : `Could not check the exclude list: ${e.message}`);
  process.exit(1);
}
