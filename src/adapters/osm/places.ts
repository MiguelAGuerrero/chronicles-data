// The OpenStreetMap locating adapter (OpenStreetMap locates places, the app's decision 0142; specs/osm-locates OL1-OL9
// there). Wikidata alone proved incomplete: a significant obelisk in Harrisburg was in OpenStreetMap and not in
// Wikidata. This adapter puts named and unnamed monuments and memorials on the map beside Wikidata's; the archive is
// the union. It never ranks, counts or confirms anything (PP6, PP7): a place enters by what its tags say it is.
//
// - `historic=monument` is a monument. `historic=memorial` is the class its `memorial=*` (or `monument=*`) value names
//   in MEMORIAL_CLASSES, a memorial when it has no value, and left out when the value is not in the table: a plaque, a
//   bench, a stolperstein, a ghost bike, a grave marker, anything else (0109: an unmapped tag is never guessed).
// - `access=private|no` and the `demolished:`, `razed:` and `destroyed:` tags keep an element out, named or not (RD9, RD10).
// - An element with no name is a place with no name (contract v3); the app calls it a monument.
// - The corroborating adapter (`./index.ts`) is unchanged and still closes or removes what it finds closed or gone.
import type { Adapter } from '../../adapter';
import { sharedExtracts } from './extract';
import { PLACES_FILTER } from './filters';
import { CLOSED_ACCESS, FILTER, GONE_KEY } from './index';

/** OL2: a memorial's value to the archive's class. Pinned by a test: a new value is a deliberate change. */
export const MEMORIAL_CLASSES: Record<string, string> = {
  obelisk: 'monument',
  column: 'monument',
  statue: 'statue',
  bust: 'statue',
  war_memorial: 'memorial',
  stone: 'memorial',
  cross: 'memorial',
};

type Geometry = { type?: string; coordinates?: unknown } | null | undefined;
const num = (v: unknown): v is [number, number] => Array.isArray(v) && typeof v[0] === 'number' && typeof v[1] === 'number';

/** A position for any element: a node's point, a way's or an area's middle (the mean of its vertices). */
export function centre(g: Geometry): [number, number] | null {
  if (!g || !g.coordinates) return null;
  const c = g.coordinates as unknown;
  const mean = (pts: unknown[]): [number, number] | null => {
    const ps = pts.filter(num);
    if (!ps.length) return null;
    return [ps.reduce((s, p) => s + p[0], 0) / ps.length, ps.reduce((s, p) => s + p[1], 0) / ps.length];
  };
  switch (g.type) {
    case 'Point':
      return num(c) ? [c[0], c[1]] : null;
    case 'LineString':
      return Array.isArray(c) ? mean(c) : null;
    case 'Polygon':
      return Array.isArray(c) && Array.isArray(c[0]) ? mean((c[0] as unknown[]).slice(0, -1)) : null;
    case 'MultiPolygon':
      return Array.isArray(c) && Array.isArray(c[0]) && Array.isArray((c[0] as unknown[])[0]) ? mean((((c[0] as unknown[])[0]) as unknown[]).slice(0, -1)) : null;
    default:
      return null;
  }
}

/** The class an element's tags give it, or null when it is left out (OL1-OL3). */
export function classOfTags(t: Record<string, string>): string | null {
  if (t.historic === 'monument') return 'monument';
  if (t.historic !== 'memorial') return null;
  const value = (t.memorial ?? t.monument ?? '').trim().toLowerCase();
  if (!value) return 'memorial';
  return MEMORIAL_CLASSES[value] ?? null;
}

export const osmPlaces: Adapter = {
  declaration: {
    name: 'osm-places',
    code: 'osmp',
    license: 'ODbL 1.0',
    licenseFamily: 'odbl',
    attribution: '© OpenStreetMap contributors',
    role: 'locates',
    hosts: ['download.geofabrik.de'],
    // The same four extracts as the corroborating adapter, downloaded once a week and shared (sharedExtracts).
    pace: { perMinute: 2, userAgent: 'Chronicles places build (+github.com/MiguelAGuerrero/chronicles; weekly, four extracts)' },
    allowed: { store: true, retentionDays: null, redistribute: true, reachPack: true },
    termsChecked: '2026-11-11',
    decision: '0142',
  },

  async fetch(ctx) {
    await sharedExtracts(ctx, [FILTER, PLACES_FILTER], PLACES_FILTER.name);
  },

  adapt(raw, _part, fetchedAt) {
    const out: unknown[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let f: { id?: unknown; geometry?: Geometry; properties?: Record<string, unknown> };
      try {
        f = JSON.parse(line);
      } catch {
        continue;
      }
      const t = (f.properties ?? {}) as Record<string, string>;
      const cls = classOfTags(t);
      if (!cls) continue;
      if (CLOSED_ACCESS.includes(t.access) || Object.keys(t).some((k) => GONE_KEY.test(k))) continue;
      const at = centre(f.geometry);
      if (!at) continue;
      const element = typeof f.id === 'string' && f.id ? f.id : `${t['@type'] ?? 'x'}/${t['@id'] ?? '?'}`;
      const name = typeof t.name === 'string' ? t.name.trim() : '';
      const same = typeof t.wikidata === 'string' ? t.wikidata.split(';').map((s) => s.trim()).filter((s) => /^Q\d+$/.test(s)) : [];
      out.push({
        source: 'osm-places',
        sourceId: element,
        ...(name ? { name } : {}),
        at,
        class: cls,
        signals: {},
        ...(same.length ? { sameAs: same.map((q) => `wikidata:${q}`) } : {}),
        fetchedAt,
      });
    }
    return out;
  },
};
