// Package the stores (ST7): one PMTiles file per region through the archive writer (layer `stores`), and a hash per z8
// block of the stores inside it (the places pack's blocks, so a client rebuilds only a block that changed).
import { createHash } from 'node:crypto';
import { writeArchive } from '../archive.mjs';
import { blockOf } from '../package';
import { EMITTED } from './dimensions';
import type { Store } from './schema';

export interface StorePack {
  region: string;
  file: string;
  bytes: Uint8Array;
  blocks: Record<string, string>;
  stores: Store[];
}

/** The tile properties: name, src, id, then one per emitted dimension. */
export const FIELDS = ['name', 'src', 'id', ...EMITTED];

export function storeBlocks(stores: Store[]): Record<string, string> {
  const by = new Map<string, Store[]>();
  for (const s of stores) by.set(blockOf(s.at), [...(by.get(blockOf(s.at)) ?? []), s]);
  const out: Record<string, string> = {};
  for (const k of [...by.keys()].sort()) {
    const rows = by.get(k)!.sort((a, b) => (a.id < b.id ? -1 : 1)).map((s) => [s.id, s.name, s.facets, s.at[0].toFixed(6), s.at[1].toFixed(6)]);
    out[k] = createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 16);
  }
  return out;
}

/** The pack of a region's stores, or null when there are none. */
export function packStores(stores: Store[], region: string, version: string): StorePack | null {
  if (!/^[a-z0-9]+$/.test(region) || !/^\d{8}(\.\d+)?$/.test(version)) throw new Error('region is lowercase letters and digits; version is YYYYMMDD');
  if (!stores.length) return null;
  const features = stores.map((s) => ({
    name: s.name, lon: s.at[0], lat: s.at[1], src: s.src, id: s.id,
    ...Object.fromEntries(EMITTED.map((d) => [d, (s.facets as Record<string, string[] | undefined>)[d]?.join(',')])),
  }));
  const bytes = writeArchive(features, {
    name: 'Chronicles stores', layer: 'stores', fields: FIELDS, attribution: '© OpenStreetMap contributors (ODbL)', extra: { contract: 'stores' },
  });
  return { region, file: `stores-${region}-${version}.pmtiles`, bytes, blocks: storeBlocks(stores), stores };
}
