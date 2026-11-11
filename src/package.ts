// Package (PP9, PP11): places into one PMTiles file per region and license family, through the places archive's own
// writer (`archive.mjs`, so the app's reader is unchanged), and a hash per z8 block of the places inside it. A block's
// hash is of its places (ID, name, class, position), never of the file's bytes, so a town is rebuilt on a phone only
// when its places changed (PP13).
import { createHash } from 'node:crypto';
import { writeArchive } from './archive.mjs';
import type { LicenseFamily, Place } from './schema';

/** The block zoom: about 150 km across at the US's latitudes. */
export const BLOCK_Z = 8;

export function blockOf([lon, lat]: [number, number], z = BLOCK_Z): string {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return `${z}/${Math.min(Math.max(x, 0), n - 1)}/${Math.min(Math.max(y, 0), n - 1)}`;
}

/** PP11: each block's hash (16 hex characters) over its places in ID order. */
export function blocksOf(places: Place[]): Record<string, string> {
  const by = new Map<string, Place[]>();
  for (const p of places) {
    const k = blockOf(p.at);
    by.set(k, [...(by.get(k) ?? []), p]);
  }
  const out: Record<string, string> = {};
  for (const k of [...by.keys()].sort()) {
    const rows = by.get(k)!
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((p) => [p.id, p.name ?? null, p.class, p.at[0].toFixed(6), p.at[1].toFixed(6)]);
    out[k] = createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 16);
  }
  return out;
}

export interface Pack {
  /** The manifest's region id: the region (a region's one pack, RD11), or the region and family when families split. */
  region: string;
  license: LicenseFamily;
  file: string;
  bytes: Uint8Array;
  blocks: Record<string, string>;
  places: Place[];
}

/**
 * PP9: one pack per license family; a pack never mixes families. RD11: when `family` is given (a source of that family
 * changed a place of the region, so the whole database is derived from it), the region is one pack of that family
 * under the region's own id, the other sources' places inside it (CC0 places may sit in an ODbL database).
 */
export function packages(places: Place[], region: string, version: string, family?: LicenseFamily): Pack[] {
  if (!/^[a-z0-9]+$/.test(region) || !/^\d{8}(\.\d+)?$/.test(version)) throw new Error('region is lowercase letters and digits; version is YYYYMMDD');
  if (family) {
    const all = places.map((p) => ({ ...p, license: family }));
    const features = all.map((p) => ({ ...(p.name ? { name: p.name } : {}), lon: p.at[0], lat: p.at[1], class: p.class as string, src: p.src, id: p.id }));
    return all.length ? [{ region, license: family, file: `places-${region}-${version}.pmtiles`, bytes: writeArchive(features), blocks: blocksOf(all), places: all }] : [];
  }
  const families = [...new Set(places.map((p) => p.license))].sort();
  return families.map((license) => {
    const mine = places.filter((p) => p.license === license);
    const id = license === 'cc0' ? region : `${region}${license.replace(/[^a-z0-9]/g, '')}`;
    const features = mine.map((p) => ({ ...(p.name ? { name: p.name } : {}), lon: p.at[0], lat: p.at[1], class: p.class as string, src: p.src, id: p.id }));
    return { region: id, license, file: `places-${id}-${version}.pmtiles`, bytes: writeArchive(features), blocks: blocksOf(mine), places: mine };
  });
}
