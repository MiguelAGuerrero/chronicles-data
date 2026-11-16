// The OpenStreetMap confirming adapter (Remarkable and public, RD7-RD10; the app's decisions 0110 and its Nov 10 call
// "Include OSM now, accept ODbL"). It reads only elements carrying a `wikidata` tag and says, of the Wikidata item
// each names, whether it is open to visitors, closed, or gone. It never makes a place (role `confirms`), never joins by
// name or position, and nothing counts how many elements say a thing (PP7, amended by RD7).
//
// Small places (SL1-SL9, the app's decision 0182): it also locates a pinned table of small places from its own raw part
// (`small-*`), read from the same download of each extract. Its role is `confirms`; `locates` names the classes it makes.
import type { Adapter } from '../../adapter';
import type { ClassName } from '../../classes';
import { fingerprint } from '../../fingerprint';
import { filterExtracts, GEOFABRIK, US_PARTS, type Filter } from './extract';

/** RD8: tags that show a place open to visitors; `historic=building` and the like are no sign. */
export const OPEN_TAGS: Record<string, readonly string[]> = {
  tourism: ['museum', 'attraction', 'gallery'],
  historic: ['monument', 'memorial', 'castle', 'ruins', 'fort', 'archaeological_site'],
  amenity: ['place_of_worship', 'theatre', 'arts_centre', 'library', 'townhall', 'courthouse'],
};
/** RD9: OSM's word that a place can't be reached. */
export const CLOSED_ACCESS: readonly string[] = ['private', 'no'];
/** RD10: only these say a place is gone; `was:*` is a former use of a place still standing. */
export const GONE_KEY = /^(demolished|razed|destroyed):/;

/** The lifecycle keys osmium is asked for (RD10): its filter takes keys, not prefixes. */
const GONE_KEYS = ['building', 'amenity', 'railway', 'man_made', 'historic', 'tourism', 'bridge'].flatMap((k) => ['demolished', 'razed', 'destroyed'].map((p) => `${p}:${k}`));

/**
 * What the shared step keeps for this adapter: elements with a `wikidata` tag (first pass) that also carry a tag it
 * reads (second pass), so the raw store, saved in the state pre-release, stays small.
 */
export const FILTER: Filter = {
  name: 'confirm',
  expressions: ['nwr/wikidata'],
  then: [
    ...Object.entries(OPEN_TAGS).map(([k, vs]) => `nwr/${k}=${vs.join(',')}`),
    `nwr/access=${CLOSED_ACCESS.join(',')}`,
    ...GONE_KEYS.map((k) => `nwr/${k}`),
  ],
};

/**
 * SL2: the tag table, pinned. Each row is a tag and its values, a class, and an extra tag the element must also carry.
 * An element matching no row is no place (0103: an unmapped tag is left out, never guessed).
 */
export const SMALL_TABLE: readonly { key: string; values: readonly string[]; cls: ClassName; also?: [string, readonly string[]] }[] = [
  { key: 'memorial', values: ['plaque', 'blue_plaque'], cls: 'marker' },
  { key: 'memorial', values: ['bench', 'ghost_bike', 'stolperstein'], cls: 'small_memorial' },
  { key: 'historic', values: ['milestone', 'boundary_stone'], cls: 'old_stone' },
  { key: 'historic', values: ['wayside_shrine', 'wayside_cross'], cls: 'wayside_shrine' },
  { key: 'historic', values: ['time_capsule'], cls: 'time_capsule' },
  { key: 'amenity', values: ['public_bookcase'], cls: 'public_bookcase' },
  { key: 'leisure', values: ['garden'], cls: 'community_garden', also: ['garden:type', ['community']] },
  { key: 'tourism', values: ['artwork'], cls: 'mural', also: ['artwork_type', ['mural', 'mosaic']] },
  { key: 'tourism', values: ['artwork'], cls: 'sculpture', also: ['artwork_type', ['sculpture', 'relief']] },
  { key: 'tourism', values: ['artwork'], cls: 'statue', also: ['artwork_type', ['statue']] },
];

/** SL1: the classes this source locates. */
export const LOCATES: readonly ClassName[] = [...new Set(SMALL_TABLE.map((r) => r.cls))];

/** SL2: an element's class from the table, the first row that holds; null when none does. */
export function smallClass(t: Record<string, string>): ClassName | null {
  for (const r of SMALL_TABLE) {
    if (!r.values.includes(t[r.key])) continue;
    if (r.also && !r.also[1].includes(t[r.also[0]])) continue;
    return r.cls;
  }
  return null;
}

/**
 * SL9: what the shared step keeps for the small places, one pass (osmium ORs one pass's expressions). A row with an extra
 * tag is asked for by that tag (`garden:type=community`, not every garden), so the raw part stays small; `adaptSmall`
 * checks the whole row.
 */
const ASKED: [string, readonly string[]][] = SMALL_TABLE.map((r) => r.also ?? [r.key, r.values]);
export const SMALL_FILTER: Filter = {
  name: 'small',
  expressions: [...new Set(ASKED.map(([k]) => k))].map((k) => `nwr/${k}=${[...new Set(ASKED.filter(([x]) => x === k).flatMap(([, vs]) => vs))].join(',')}`),
};

/** SL7: one point for an element: a point's own, else the mean of its outer ring's or its line's vertices; null with none. */
export function pointOf(geometry: unknown): [number, number] | null {
  const g = geometry as { type?: string; coordinates?: unknown } | null;
  if (!g || !Array.isArray(g.coordinates)) return null;
  const pts: number[][] =
    g.type === 'Point' ? [g.coordinates as number[]]
    : g.type === 'LineString' ? (g.coordinates as number[][])
    : g.type === 'Polygon' ? ((g.coordinates as number[][][])[0] ?? [])
    : g.type === 'MultiPolygon' ? ((g.coordinates as number[][][][])[0]?.[0] ?? [])
    : g.type === 'MultiLineString' ? ((g.coordinates as number[][][])[0] ?? [])
    : [];
  const ok = pts.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (!ok.length) return null;
  // A closed ring repeats its first vertex; drop it so the mean isn't pulled toward it.
  const ring = ok.length > 2 && ok[0][0] === ok.at(-1)![0] && ok[0][1] === ok.at(-1)![1] ? ok.slice(0, -1) : ok;
  const lon = ring.reduce((a, p) => a + p[0], 0) / ring.length;
  const lat = ring.reduce((a, p) => a + p[1], 0) / ring.length;
  return [lon, lat];
}

/** SL2-SL7: the small part's elements as locating candidates. */
export function adaptSmall(raw: string, fetchedAt: string): unknown[] {
  const out: unknown[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let f: { geometry?: unknown; properties?: Record<string, unknown> };
    try {
      f = JSON.parse(line);
    } catch {
      continue;
    }
    const t = (f.properties ?? {}) as Record<string, string>;
    const cls = smallClass(t);
    // SL3: a place that can't be reached is no place.
    if (!cls || CLOSED_ACCESS.includes(t.access)) continue;
    const at = pointOf(f.geometry);
    if (!at) continue;
    const element = String(t['@id'] ?? '?');
    const qids = typeof t.wikidata === 'string' ? t.wikidata.split(';').map((x) => x.trim()).filter((x) => /^Q\d+$/.test(x)) : [];
    out.push({
      source: 'osm',
      sourceId: element,
      name: typeof t.name === 'string' ? t.name.trim() : '',
      at,
      class: cls,
      signals: {},
      ...(qids.length ? { sameAs: qids.map((q) => `wikidata:${q}`) } : {}),
      fetchedAt,
    });
  }
  return out;
}

export const osm: Adapter = {
  declaration: {
    name: 'osm',
    code: 'osm',
    license: 'ODbL 1.0',
    licenseFamily: 'odbl',
    attribution: '© OpenStreetMap contributors',
    role: 'confirms',
    // SL1: and locates its small places (the app's decision 0182).
    locates: [...LOCATES],
    hosts: ['download.geofabrik.de'],
    // Four downloads a week, one at a time.
    pace: { perMinute: 2, userAgent: 'Chronicles places build (+github.com/MiguelAGuerrero/chronicles; weekly, four extracts)' },
    allowed: { store: true, retentionDays: null, redistribute: true, reachPack: true },
    termsChecked: '2026-11-10',
  },

  // RB8: four multi-GB extracts take over an hour on a runner, so only the weekly and hand runs fetch them.
  weekly: true,

  // RB2: the extracts it reads and the filter it keeps; the area is the four US parts, whatever the boxes.
  fetchKey: () => fingerprint([GEOFABRIK, US_PARTS, FILTER, SMALL_FILTER]),

  // SL9: both filters from the same download of each extract.
  async fetch(ctx) {
    await filterExtracts(ctx, [FILTER, SMALL_FILTER]);
  },

  /** RD7: one confirming candidate per Wikidata id an element carries (`wikidata=Q1;Q2` speaks for both); SL9: the small part locates. */
  adapt(raw, part, fetchedAt) {
    if (part.startsWith(`${SMALL_FILTER.name}-`)) return adaptSmall(raw, fetchedAt);
    const out: unknown[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let f: { properties?: Record<string, unknown> };
      try {
        f = JSON.parse(line);
      } catch {
        continue;
      }
      const t = (f.properties ?? {}) as Record<string, string>;
      if (typeof t.wikidata !== 'string') continue;
      const open = Object.entries(OPEN_TAGS).some(([k, vs]) => vs.includes(t[k]));
      const closed = CLOSED_ACCESS.includes(t.access);
      const gone = Object.keys(t).some((k) => GONE_KEY.test(k));
      if (!open && !closed && !gone) continue;
      const element = String(t['@id'] ?? `${t['@type'] ?? 'x'}/${t['@id'] ?? '?'}`);
      for (const id of t.wikidata.split(';').map((s) => s.trim()).filter((s) => /^Q\d+$/.test(s))) {
        out.push({
          source: 'osm',
          sourceId: `${element}#${id}`,
          name: typeof t.name === 'string' && t.name.trim() ? t.name.trim() : id,
          sameAs: [`wikidata:${id}`],
          signals: { ...(open ? { open: true } : {}), ...(closed ? { closed: true } : {}), ...(gone ? { gone: true } : {}) },
          fetchedAt,
        });
      }
    }
    return out;
  },
};
