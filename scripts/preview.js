// npm run preview -- <catalogue id>: first titles and counts of one catalogue. Writes nothing.
import { fileURLToPath } from 'node:url';
import { runPreview } from '../src/tools.js';
import { withClient } from './_cli.js';

await withClient((client) =>
  runPreview({
    client,
    id: process.argv[2],
    idmapPath: fileURLToPath(new URL('../data/idmap.json', import.meta.url)),
  }),
);
