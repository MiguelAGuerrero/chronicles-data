// The OpenStreetMap shop adapter's pure part (ST3, ST4, ST9): what the shared extract step keeps for stores, and how
// one element's tags become a store candidate. A shop enters by what it sells: a mapped `shop`, a pinned `craft`, or
// `second_hand=only`; and by nothing a crowd says: only the READS keys below are ever looked at, so a rating, a count
// of reviews, popularity or a link to an encyclopedia is never read, whatever the element carries (ST4).
import type { Filter } from '../adapters/osm/extract';
import { DIMENSIONS, type What } from './dimensions';

/** The tags (and element ids) the adapter reads, and no others. */
export const READS = ['@id', '@type', 'craft', 'name', 'second_hand', 'shop'] as const;

/** `shop=` values to what is sold. */
export const SHOP_WHAT: Record<string, What[]> = {
  antiques: ['antiques'],
  second_hand: ['vintage'],
  books: ['books'],
  music: ['records'],
  records: ['records'],
  maps: ['maps'],
  map: ['maps'],
  art_supplies: ['art_supplies'],
  craft: ['crafts'],
  handicraft: ['crafts'],
};
/** `craft=` values of makers who sell what they make; they count only on an element that is also a shop. */
export const CRAFT_VALUES = ['pottery', 'glassblower', 'weaver', 'basket_maker', 'candlemaker', 'bookbinder', 'jeweller', 'leather'];
/** Shops that are vintage when `second_hand=only`. */
export const SECOND_HAND_ONLY_SHOPS = ['clothes', 'furniture', 'jewelry', 'shoes', 'bag', 'toys', 'musical_instrument'];

export const RULES = { shop: Object.keys(SHOP_WHAT), craft: CRAFT_VALUES, secondHandOnlyShops: SECOND_HAND_ONLY_SHOPS };

/**
 * ST9: what the shared step keeps for stores, in the pass it already makes over each extract (osmium ORs one pass's
 * expressions). Derived from the tables above, so the filter cannot drift from the mapping. Elements joined by `;`
 * in one tag (`shop=antiques;books`) are not matched by osmium's exact values and are not kept.
 */
export const SHOP_FILTER: Filter = {
  name: 'shops',
  expressions: [`nwr/shop=${[...RULES.shop, ...SECOND_HAND_ONLY_SHOPS.filter((s) => !RULES.shop.includes(s))].join(',')}`, `nwr/craft=${CRAFT_VALUES.join(',')}`],
};

const order = DIMENSIONS.what.values as readonly string[];
const split = (v: unknown): string[] => (typeof v === 'string' ? v.split(';').map((s) => s.trim()).filter(Boolean) : []);

/** What an element's tags say it sells, in the contract's list order. */
export function whatOf(t: Record<string, unknown>): What[] {
  const shops = split(t.shop);
  const found = new Set<What>();
  for (const s of shops) for (const w of SHOP_WHAT[s] ?? []) found.add(w);
  if (split(t.second_hand).includes('only') && shops.some((s) => SECOND_HAND_ONLY_SHOPS.includes(s))) found.add('vintage');
  if (shops.length && split(t.craft).some((c) => CRAFT_VALUES.includes(c))) found.add('crafts');
  return [...found].sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

type Geometry = { type?: string; coordinates?: unknown };
const round = (v: number) => Math.round(v * 1e6) / 1e6;
const isPos = (p: unknown): p is [number, number] => Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number';

/** One position for an element: a point as is, a line's middle vertex, a polygon's vertices' mean (its first ring). */
export function positionOf(g: Geometry | undefined): [number, number] | null {
  const c = g?.coordinates;
  let ring: unknown[] | null = null;
  if (g?.type === 'Point') return isPos(c) ? [round(c[0]), round(c[1])] : null;
  if (g?.type === 'LineString' && Array.isArray(c)) ring = [c[Math.floor(c.length / 2)]];
  else if (g?.type === 'Polygon' && Array.isArray(c) && Array.isArray(c[0])) ring = c[0].slice(0, -1);
  else if (g?.type === 'MultiPolygon' && Array.isArray(c) && Array.isArray(c[0]) && Array.isArray(c[0][0])) ring = (c[0][0] as unknown[]).slice(0, -1);
  const pts = (ring ?? []).filter(isPos);
  if (!pts.length) return null;
  return [round(pts.reduce((s, p) => s + p[0], 0) / pts.length), round(pts.reduce((s, p) => s + p[1], 0) / pts.length)];
}

/**
 * ST3: one candidate per shop element with a name, a position and a mapped `what`; the rest are dropped. Pure: the same
 * lines give the same candidates, whatever their order.
 */
export function adaptShops(raw: string, fetchedAt: string): unknown[] {
  const out: unknown[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let f: { geometry?: Geometry; properties?: Record<string, unknown> };
    try {
      f = JSON.parse(line);
    } catch {
      continue;
    }
    const props = f.properties ?? {};
    const t: Record<string, unknown> = {};
    for (const k of READS) t[k] = props[k];
    const name = typeof t.name === 'string' ? t.name.trim() : '';
    const what = whatOf(t);
    const at = positionOf(f.geometry);
    if (!name || !what.length || !at || t['@id'] == null) continue;
    const id = String(t['@id']);
    out.push({ source: 'osm', sourceId: typeof t['@type'] === 'string' && !id.includes('/') ? `${t['@type']}/${id}` : id, name, at, facets: { what }, fetchedAt });
  }
  return out;
}
