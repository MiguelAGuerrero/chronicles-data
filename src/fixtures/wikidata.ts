// Wikidata's public libraries for the fixtures pack (FX5, FX13; the app's decision 0268, "Add Wikidata too"). A read of its
// own, beside the places' Wikidata fetch and never inside it: one query to the same endpoint, at the places' declared pace
// and with its user agent, kept under its own raw source with its own fingerprint, so the places' fetch, its fingerprint
// and its answers are untouched (FX7). Only `library`, from `P31 = Q28564` exactly: no subclass walk, no visitor centre
// or town hall (a former use, or an attraction's). It reads an item's label, coordinate and the signals that it is gone,
// nothing about articles, visits or popularity.
import type { Clock, Fetch } from '../http';
import { politeFetch } from '../http';
import { fingerprint } from '../fingerprint';
import { wikidata } from '../adapters/wikidata';
import type { RawStore } from '../rawStore';

export const SOURCE = 'wikidata-fixtures';
export const PART = 'libraries-us.json';
export const ENDPOINT = 'https://query.wikidata.org/sparql';
/**
 * FX13: the US's public libraries, by their one class; the dissolved and closed are asked so they can be left out, as are
 * those whose library statement has ended (`pq:P582`) and those whose state of use is permanently closed, demolished or
 * without its original use (`P5817`; town-fixtures audit 9).
 */
export const LIBRARY_QUERY = `SELECT ?item ?label ?coord ?dissolved ?closed ?ended ?use WHERE {
  ?item wdt:P31 wd:Q28564 ; wdt:P17 wd:Q30 ; wdt:P625 ?coord .
  OPTIONAL { ?item rdfs:label ?label . FILTER(LANG(?label) = "en") }
  OPTIONAL { ?item wdt:P576 ?dissolved . }
  OPTIONAL { ?item wdt:P3999 ?closed . }
  OPTIONAL { ?item p:P31 ?st . ?st ps:P31 wd:Q28564 ; pq:P582 ?ended . }
  OPTIONAL { ?item wdt:P5817 ?use . FILTER(?use IN (wd:Q104664889, wd:Q56556915, wd:Q110435753)) }
}`;
/** FX13: what this read asks for; a change makes it stale. */
export const fixturesWikidataKey = () => fingerprint([ENDPOINT, LIBRARY_QUERY]);
const FETCH_KEY = 'fetchKey';

/** The binding keys read, and no others (FX5). */
const READS = ['item', 'label', 'coord', 'dissolved', 'closed', 'ended', 'use'] as const;
type Row = Partial<Record<(typeof READS)[number], { value?: unknown }>>;

const POINT = /^Point\(\s*(-?[\d.]+(?:e-?\d+)?)\s+(-?[\d.]+(?:e-?\d+)?)\s*\)$/i;
const round = (v: number) => Math.round(v * 1e6) / 1e6;

/** FX13: an answer's rows as library candidates: one per item, none for a dissolved, closed or unlabelled one. */
export function adaptLibraries(raw: string, fetchedAt: string): unknown[] {
  let rows: unknown;
  try {
    rows = (JSON.parse(raw) as { results?: { bindings?: unknown } })?.results?.bindings;
  } catch {
    return [];
  }
  if (!Array.isArray(rows)) return [];
  const byItem = new Map<string, { labels: string[]; coords: [number, number][]; gone: boolean }>();
  for (const r of rows as Row[]) {
    const v = (k: (typeof READS)[number]) => (typeof r?.[k]?.value === 'string' ? (r[k]!.value as string) : undefined);
    const q = /\/(Q\d+)$/.exec(v('item') ?? '')?.[1];
    if (!q) continue;
    const e = byItem.get(q) ?? { labels: [], coords: [], gone: false };
    byItem.set(q, e);
    if (v('dissolved') != null || v('closed') != null || v('ended') != null || v('use') != null) e.gone = true;
    const label = v('label')?.trim();
    if (label) e.labels.push(label);
    const m = POINT.exec(v('coord') ?? '');
    if (m) {
      const at: [number, number] = [round(Number(m[1])), round(Number(m[2]))];
      if (Math.abs(at[0]) <= 180 && Math.abs(at[1]) <= 90) e.coords.push(at);
    }
  }
  const out: unknown[] = [];
  for (const q of [...byItem.keys()].sort()) {
    const e = byItem.get(q)!;
    if (e.gone || !e.labels.length || !e.coords.length) continue;
    const at = [...e.coords].sort((a, b) => a[0] - b[0] || a[1] - b[1])[0];
    out.push({ source: 'wikidata', sourceId: q, kind: 'library', at, name: [...e.labels].sort()[0], item: q, fetchedAt });
  }
  return out;
}

/** FX13: whether a run fetches the libraries: every source, Wikidata, or any fetch while they are stale. */
export function shouldFetchLibraries({ fetching, only, stale }: { fetching: boolean; only: string[] | null; stale: boolean }): boolean {
  return fetching && (only == null || only.includes('wikidata') || stale);
}

/** FX13: none kept before this run, or kept under another fingerprint. */
export function librariesStale(store: RawStore, version: string): boolean {
  const prev = store.lastComplete(SOURCE, version);
  return !prev || store.meta(SOURCE, prev)[FETCH_KEY] !== fixturesWikidataKey();
}

/** The run whose libraries a build reads: this run's when it fetched them, else the last kept; null with none. */
export function librariesRun(store: RawStore, version: string): string | null {
  return store.lastComplete(SOURCE, `${version}~`);
}

/** FX13: one query, kept with its fingerprint; false (the last answer standing) when it fails or is cut off. */
export async function fetchLibraries(o: { store: RawStore; version: string; http: Fetch; clock: Clock; log: (l: string) => void }): Promise<boolean> {
  try {
    const http = politeFetch(wikidata.declaration, o.http, o.clock);
    const res = await http(ENDPOINT, {
      method: 'POST',
      headers: { accept: 'application/sparql-results+json', 'content-type': 'application/x-www-form-urlencoded' },
      body: `query=${encodeURIComponent(LIBRARY_QUERY)}`,
    });
    const body = await res.text();
    const rows = (JSON.parse(body) as { results?: { bindings?: unknown } })?.results?.bindings;
    if (!Array.isArray(rows)) throw new Error('no rows');
    const now = new Date(o.clock.now()).toISOString();
    o.store.start(SOURCE, o.version, now);
    o.store.put(SOURCE, o.version, PART, body, now);
    o.store.setMeta(SOURCE, o.version, FETCH_KEY, fixturesWikidataKey());
    o.store.complete(SOURCE, o.version);
    o.store.keepNewest(SOURCE, 3);
    o.log(`fixtures: Wikidata's libraries fetched`);
    return true;
  } catch (e) {
    o.log(`fixtures: Wikidata's libraries not fetched (${String((e as Error)?.message ?? e)}); the last answer stands`);
    return false;
  }
}
