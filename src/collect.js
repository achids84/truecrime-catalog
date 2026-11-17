// Turns a list of catalogue entries (from config/catalogues.json) into catalogue contents.
// Used by the build and by `npm run preview`. It makes TMDB calls but never touches dist/.
//   kind "trending" / "new": the original passes (P, New, trending), unchanged.
//   kind "discover": one filtered TMDB query per catalogue and type.
import { resolveImdbIds, lookup } from './idmap.js';
import { buildPass, fetchTrending, qualifyTrending, buildDiscover, DISCOVER_DEFAULT_LIMIT } from './universe.js';
import { buildTrending, buildNew, contributions } from './lists.js';
import { toMetas, dedupeByImdb } from './meta.js';
import { activeTypes } from './config.js';

const TMDB_KIND = { movie: 'movie', series: 'tv' };

// catalogues: validated entries (the caller picks which ones: enabled for a build, one for a preview).
// idmap is mutated; persist() is awaited once all IMDb ids are resolved (the build saves the cache there).
export async function collect({ client, catalogues, idmap, now, log = () => {}, persist = async () => {} }) {
  const today = new Date(now).toISOString().slice(0, 10);
  const types = activeTypes(catalogues);
  const forType = (type, kind) => catalogues.filter((c) => c.kind === kind && c.types.includes(type));

  // 1. TMDB passes, per type, all in parallel.
  const data = {}; // data[type] = { kind, P, N, trending, discover: { id: items } }
  await Promise.all(
    types.map(async (type) => {
      const kind = TMDB_KIND[type];
      const wantTrending = forType(type, 'trending').length > 0;
      const wantNew = forType(type, 'new').length > 0;
      const discovers = forType(type, 'discover');
      const d = (data[type] = { kind, P: [], N: [], trending: [], discover: {} });
      await Promise.all([
        (async () => {
          if (!wantTrending && !wantNew) return;
          // Trending needs both passes (its membership is their union); New needs only the date pass.
          const [P, N, trendingRaw] = await Promise.all([
            wantTrending ? buildPass(client, kind, 'popularity', today) : [],
            buildPass(client, kind, 'new', today),
            wantTrending ? fetchTrending(client, kind) : [],
          ]);
          const unionIds = new Set([...P, ...N].map((it) => it.id));
          Object.assign(d, { P, N, trending: wantTrending ? qualifyTrending(kind, trendingRaw, unionIds) : [] });
          log(`${kind}: P ${P.length}, New ${N.length}, trending qualified ${d.trending.length}`);
        })(),
        ...discovers.map(async (c) => {
          d.discover[c.id] = await buildDiscover(client, kind, c, today);
          log(`${kind}: ${c.id} (discover) ${d.discover[c.id].length} candidates`);
        }),
      ]);
    }),
  );

  // 2. IMDb ids, resolved once for every distinct title in any pass, Trending or discover list.
  const pool = {}; // pool[type] = Map(tmdb id -> item)
  for (const type of types) {
    const { P, N, trending, discover } = data[type];
    pool[type] = new Map([...P, ...N, ...trending, ...Object.values(discover).flat()].map((it) => [it.id, it]));
  }
  const { fetched } = await resolveImdbIds(
    types.flatMap((t) => [...pool[t].values()]),
    idmap,
    client,
    now,
  );
  await persist(); // cache only; dist/ is still untouched
  log(`resolved ${fetched} new IMDb ids`);

  // 3. Build each catalogue.
  const catalogs = {};
  const skippedNoImdb = {};
  const padded = {};
  const newestNew = {};
  const contribution = {};
  for (const type of types) {
    const { kind, P, N, trending, discover } = data[type];
    const attach = (list) =>
      list.flatMap((it) => {
        const imdb = lookup(idmap, kind, it.id);
        return imdb ? [{ ...it, imdb }] : [];
      });
    skippedNoImdb[type] = [...pool[type].values()].filter((it) => !lookup(idmap, kind, it.id)).length;
    const passSets = { P: new Set(P.map((it) => it.id)), New: new Set(N.map((it) => it.id)) };
    const trend = forType(type, 'trending').length ? buildTrending(attach(trending), attach(P)) : null;
    const newItems = forType(type, 'new').length ? buildNew(attach(N), today) : null;
    if (trend) padded[type] = trend.padded;
    newestNew[type] = newItems?.[0]?.date ?? null;

    catalogs[type] = {};
    for (const c of catalogues.filter((c) => c.types.includes(type))) {
      if (c.kind === 'trending') {
        catalogs[type][c.id] = toMetas(trend.items);
        contribution[`${type}/${c.id}`] = contributions(trend.items, passSets);
      } else if (c.kind === 'new') {
        catalogs[type][c.id] = toMetas(newItems);
        contribution[`${type}/${c.id}`] = contributions(newItems, passSets);
      } else {
        const items = dedupeByImdb(attach(discover[c.id])).slice(0, c.limit ?? DISCOVER_DEFAULT_LIMIT);
        catalogs[type][c.id] = toMetas(items);
      }
    }
    const parts = Object.entries(catalogs[type]).map(([id, metas]) => `${id} ${metas.length}`);
    log(`${type}: ${parts.join(', ')}${trend ? ` (trending padded ${trend.padded})` : ''}, skipped no IMDb id ${skippedNoImdb[type]}`);
  }
  return { catalogs, skippedNoImdb, padded, newestNew, contribution };
}
