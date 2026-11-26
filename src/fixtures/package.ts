// Package the fixtures (FX8): one PMTiles file per region through the archive writer (layer `fixtures`), and a hash per z8
// block of the fixtures inside it (the places pack's blocks, so a client rebuilds only a block that changed).
import { createHash } from 'node:crypto';
import { writeArchive } from '../archive.mjs';
import { blockOf } from '../package';
import type { Fixture } from './schema';

export interface FixturePack {
  region: string;
  file: string;
  bytes: Uint8Array;
  blocks: Record<string, string>;
  fixtures: Fixture[];
}

/** The tile properties; `name` is left out of a feature that has none. */
export const FIELDS = ['kind', 'name', 'src', 'id'];

export function fixtureBlocks(fixtures: Fixture[]): Record<string, string> {
  const by = new Map<string, Fixture[]>();
  for (const f of fixtures) by.set(blockOf(f.at), [...(by.get(blockOf(f.at)) ?? []), f]);
  const out: Record<string, string> = {};
  for (const k of [...by.keys()].sort()) {
    const rows = by.get(k)!.sort((a, b) => (a.id < b.id ? -1 : 1)).map((f) => [f.id, f.kind, f.name ?? '', f.src, f.at[0].toFixed(6), f.at[1].toFixed(6)]);
    out[k] = createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 16);
  }
  return out;
}

/** The pack of a region's fixtures, or null when there are none. */
export function packFixtures(fixtures: Fixture[], region: string, version: string): FixturePack | null {
  if (!/^[a-z0-9]+$/.test(region) || !/^\d{8}(\.\d+)?$/.test(version)) throw new Error('region is lowercase letters and digits; version is YYYYMMDD');
  if (!fixtures.length) return null;
  const features = fixtures.map((f) => ({ kind: f.kind, name: f.name, lon: f.at[0], lat: f.at[1], src: f.src, id: f.id }));
  const bytes = writeArchive(features, {
    name: 'Chronicles fixtures', layer: 'fixtures', fields: FIELDS, attribution: '© OpenStreetMap contributors (ODbL); Wikidata (CC0)', extra: { contract: 'fixtures' },
  });
  return { region, file: `fixtures-${region}-${version}.pmtiles`, bytes, blocks: fixtureBlocks(fixtures), fixtures };
}
