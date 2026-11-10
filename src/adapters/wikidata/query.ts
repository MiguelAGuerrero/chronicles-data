// The Wikidata adapter's query and rows (moved from places-archive/fetch-wikidata.mjs, PW14): one map cell at a time
// from the query service, the pinned classes or a National Historic Landmark listing, with what says a place is gone.
// Nothing about articles or popularity (sitelinks, page views) is ever asked for (PW7).
import { ALL_CLASS_IDS, NHL, NRHP } from './classify.mjs';

type Box = [number, number, number, number];

/** The cells of a region's boxes, `step` degrees on a side. */
export function cellsFor(boxes: Box[], step: number): Box[] {
  const out: Box[] = [];
  for (const [w, s, e, n] of boxes)
    for (let x = w; x < e; x += step) for (let y = s; y < n; y += step) out.push([x, y, Math.min(x + step, e), Math.min(y + step, n)]);
  return out;
}

/** A cell's four quarters, for one that timed out. */
export function splitCell([w, s, e, n]: Box): Box[] {
  const mx = (w + e) / 2;
  const my = (s + n) / 2;
  return [[w, s, mx, my], [mx, s, e, my], [w, my, mx, n], [mx, my, e, n]];
}

/**
 * PW14, RD5: one cell's query: the pinned classes, a National Register listing that has not ended (no P582), or a
 * Landmark, in the US, with what says a place is gone.
 */
export function cellQuery([w, s, e, n]: Box): string {
  const classes = ALL_CLASS_IDS.map((q: string) => `wd:${q}`).join(' ');
  return `SELECT ?item ?label ?coord ?p31 ?nhl ?listed ?dissolved ?closed ?stateLabel WHERE {
  SERVICE wikibase:box {
    ?item wdt:P625 ?coord .
    bd:serviceParam wikibase:cornerSouthWest "Point(${w} ${s})"^^geo:wktLiteral .
    bd:serviceParam wikibase:cornerNorthEast "Point(${e} ${n})"^^geo:wktLiteral .
  }
  { VALUES ?cls { ${classes} } ?item wdt:P31 ?cls . } UNION { ?item wdt:P1435 wd:${NHL} . } UNION { ?item p:P1435 ?hl . ?hl ps:P1435 wd:${NRHP} . FILTER NOT EXISTS { ?hl pq:P582 [] } }
  ?item wdt:P17 wd:Q30 .
  ?item rdfs:label ?label . FILTER(LANG(?label) = "en")
  OPTIONAL { ?item wdt:P31 ?p31 . }
  OPTIONAL { ?item wdt:P1435 wd:${NHL} . BIND("true" AS ?nhl) }
  OPTIONAL { ?item p:P1435 ?hs . ?hs ps:P1435 wd:${NRHP} . FILTER NOT EXISTS { ?hs pq:P582 [] } BIND("true" AS ?listed) }
  OPTIONAL { ?item wdt:P576 ?dissolved . }
  OPTIONAL { ?item wdt:P3999 ?closed . }
  OPTIONAL { ?item (wdt:P5817|wdt:P5816) ?state . ?state rdfs:label ?stateLabel . FILTER(LANG(?stateLabel) = "en") }
}`;
}

export interface WikidataItem {
  id: string;
  name: string;
  lon: number;
  lat: number;
  p31: string[];
  /** RD1, RD5: on the National Register, with no end time. */
  listed: boolean;
  nhl: boolean;
  dissolved: boolean;
  closed: boolean;
  states: string[];
}

type Binding = Record<string, { value: string } | undefined>;

const qid = (uri: string) => String(uri).replace(/^.*\//, '');

/** PW14: a query's rows as items, one per Wikidata item, in the order first seen. */
export function itemsFrom(bindings: Binding[]): WikidataItem[] {
  const byId = new Map<string, WikidataItem>();
  for (const b of bindings) {
    if (!b.item) continue;
    const id = qid(b.item.value);
    let it = byId.get(id);
    if (!it) {
      const m = /Point\(([-\d.eE]+) ([-\d.eE]+)\)/.exec(b.coord?.value ?? '');
      it = { id, name: b.label?.value ?? '', lon: m ? Number(m[1]) : NaN, lat: m ? Number(m[2]) : NaN, p31: [], listed: false, nhl: false, dissolved: false, closed: false, states: [] };
      byId.set(id, it);
    }
    if (b.p31 && !it.p31.includes(qid(b.p31.value))) it.p31.push(qid(b.p31.value));
    if (b.nhl) it.nhl = true;
    if (b.listed) it.listed = true;
    if (b.dissolved) it.dissolved = true;
    if (b.closed) it.closed = true;
    if (b.stateLabel && !it.states.includes(b.stateLabel.value)) it.states.push(b.stateLabel.value);
  }
  return [...byId.values()];
}

/** RD5: a query's answer, or null when its JSON is cut off (a timeout after the 200 began): the cell is split. */
export function parseAnswer(text: string): Binding[] | null {
  try {
    const b = (JSON.parse(text) as { results?: { bindings?: unknown } })?.results?.bindings;
    return Array.isArray(b) ? (b as Binding[]) : null;
  } catch {
    return null;
  }
}
