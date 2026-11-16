// Build the stores (ST6): read the OSM source's `shops-*` raw parts (kept by the one shared extract pass, ST9), adapt,
// gate, give each store an opaque id from its own registry, and package. Nothing here touches the places pipeline: the
// places run never sees these parts (the OSM places adapter skips them) and the places packs are built without them.
import { createIds, type Registry } from '../conflate';
import type { RawStore } from '../rawStore';
import { gateStores, type Dropped } from './gate';
import { adaptShops } from './osmShops';
import { packStores, type StorePack } from './package';
import { StoreSchema, type Store } from './schema';

export const SHOPS_PART = /^shops-.+\.geojsonl$/;
const STORE_ID = /^s_[0-9a-f]{16}$/;

export interface StoresResult {
  pack: StorePack | null;
  registry: Registry;
  report: { setAside: Dropped[]; reason: string };
}

export function buildStores(o: { store: RawStore; run: string | null; region: string; version: string; registry: Registry; newId: () => string; chains?: string[] }): StoresResult {
  const none = (reason: string): StoresResult => ({ pack: null, registry: o.registry, report: { setAside: [], reason } });
  if (!o.run) return none('no OpenStreetMap run');
  const parts = o.store.parts('osm', o.run).filter((p) => SHOPS_PART.test(p.part));
  if (!parts.length) return none('no shops in the OpenStreetMap run');
  const candidates = parts.flatMap((p) => adaptShops(o.store.read('osm', o.run!, p.part), p.fetchedAt));
  const { kept, dropped } = gateStores(candidates, o.chains);
  const ids = createIds(o.registry, o.newId, STORE_ID);
  const stores: Store[] = [];
  for (const c of kept) {
    const s = { id: ids.forKey(`${c.source}:${c.sourceId}`, c.name, c.at), name: c.name, at: c.at, facets: c.facets, src: 'osm' };
    const r = StoreSchema.safeParse(s);
    if (r.success) stores.push(r.data);
    else dropped.push({ name: c.name, reason: r.error.issues.map((i) => i.message).join('; ') });
  }
  return { pack: packStores(stores, o.region, o.version), registry: ids.finish(), report: { setAside: dropped, reason: 'built' } };
}
