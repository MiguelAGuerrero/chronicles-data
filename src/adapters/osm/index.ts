// The OpenStreetMap confirming adapter (Remarkable and public, RD7-RD10; the app's decisions 0110 and its Nov 10 call
// "Include OSM now, accept ODbL"). It reads only elements carrying a `wikidata` tag and says, of the Wikidata item
// each names, whether it is open to visitors, closed, or gone. It never makes a place (role `confirms`), never joins by
// name or position, and nothing counts how many elements say a thing (PP7, amended by RD7).
import type { Adapter } from '../../adapter';
import { filterExtracts, type Filter } from './extract';

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

export const osm: Adapter = {
  declaration: {
    name: 'osm',
    code: 'osm',
    license: 'ODbL 1.0',
    licenseFamily: 'odbl',
    attribution: '© OpenStreetMap contributors',
    role: 'confirms',
    hosts: ['download.geofabrik.de'],
    // Four downloads a week, one at a time.
    pace: { perMinute: 2, userAgent: 'Chronicles places build (+github.com/MiguelAGuerrero/chronicles; weekly, four extracts)' },
    allowed: { store: true, retentionDays: null, redistribute: true, reachPack: true },
    termsChecked: '2026-11-10',
  },

  async fetch(ctx) {
    await filterExtracts(ctx, [FILTER]);
  },

  /** RD7: one confirming candidate per Wikidata id an element carries (`wikidata=Q1;Q2` speaks for both). */
  adapt(raw, _part, fetchedAt) {
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
