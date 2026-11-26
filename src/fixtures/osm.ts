// The OpenStreetMap fixtures adapter's pure part (FX3, FX4, FX5, FX14): how one element's tags become fixture candidates.
// A fixture enters by one of the thirteen tags (kinds.ts) and by nothing a crowd says: only the READS keys are looked at,
// so a rating, opening hours, a website or a link to an encyclopedia is never read, whatever the element carries.
import { pointOf } from '../adapters/osm';
import { HERITAGE_STATION, KINDS, type Kind } from './kinds';

/** The tags (and element ids) the adapter reads, and no others. `wikidata` only joins two of one fixture (FX6). */
export const READS: readonly string[] = [...new Set(['@id', '@type', 'name', 'access', 'wikidata', ...KINDS.map((k) => k.key), ...HERITAGE_STATION.map(([k]) => k)])];

const CLOSED_ACCESS = ['private', 'no'];
const split = (v: unknown): string[] => (typeof v === 'string' ? v.split(';').map((s) => s.trim()).filter(Boolean) : []);
const round = (v: number) => Math.round(v * 1e6) / 1e6;

/** FX2, FX14: the kinds an element's tags say it is, in the list's order; a heritage railway's station is none. */
export function kindsOf(t: Record<string, unknown>): Kind[] {
  const heritage = HERITAGE_STATION.some(([k, vs]) => split(t[k]).some((v) => vs.includes(v)));
  return KINDS.filter((k) => split(t[k.key]).includes(k.value) && !(k.kind === 'station' && heritage)).map((k) => k.kind);
}

/** FX4: one candidate per kind of each element with a position that may be reached; pure and order-free. */
export function adaptFixtures(raw: string, fetchedAt: string): unknown[] {
  const out: unknown[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let f: { geometry?: unknown; properties?: Record<string, unknown> };
    try {
      f = JSON.parse(line);
    } catch {
      continue;
    }
    const props = f.properties ?? {};
    const t: Record<string, unknown> = {};
    for (const k of READS) t[k] = props[k];
    const kinds = kindsOf(t);
    if (!kinds.length || t['@id'] == null || split(t.access).some((a) => CLOSED_ACCESS.includes(a))) continue;
    const p = pointOf(f.geometry);
    if (!p) continue;
    const at: [number, number] = [round(p[0]), round(p[1])];
    const id = String(t['@id']);
    const sourceId = typeof t['@type'] === 'string' && !id.includes('/') ? `${t['@type']}/${id}` : id;
    const name = typeof t.name === 'string' && t.name.trim() ? t.name.trim() : undefined;
    const item = split(t.wikidata).find((q) => /^Q\d+$/.test(q));
    for (const kind of kinds) out.push({ source: 'osm', sourceId, kind, at, ...(name ? { name } : {}), ...(item ? { item } : {}), fetchedAt });
  }
  return out;
}
