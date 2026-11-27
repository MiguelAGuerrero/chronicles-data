// Build the fixtures (FX7, FX11, FX13): read the OSM source's `fixtures-*` raw parts (kept by the one shared extract pass,
// FX10) and Wikidata's libraries (their own read, FX13), adapt, check, keep one fixture once (OpenStreetMap first, FX6),
// give each an opaque id from its own registry, and package. OpenStreetMap first: a run whose OSM answers hold no
// fixtures builds no pack, so no Wikidata-only pack is published. Nothing here touches the places or the stores.
import { pointOf } from '../adapters/osm';
import { createIds, type Registry } from '../conflate';
import { blockOf } from '../package';
import type { RawStore } from '../rawStore';
import { mergeFixtures } from './merge';
import { adaptFixtures } from './osm';
import { packFixtures, type FixturePack } from './package';
import { FixtureCandidateSchema, FixtureSchema, type Fixture, type FixtureCandidate } from './schema';
import { adaptLibraries, PART, SOURCE } from './wikidata';

export const FIXTURES_PART = /^fixtures-.+\.geojsonl$/;
const FIXTURE_ID = /^f_[0-9a-f]{16}$/;

/** FX12: why the pack was or was not built, what was set aside by name, and which sources it read; never a count. */
export interface FixturesReport {
  reason: string;
  setAside: { name: string; reason: string }[];
  sources: string[];
  /**
   * fix osm-per-extract audit 2 (the owner, Nov 27, "Leave the region empty"): the OSM extracts this run holds no fixtures
   * part for (an extract carried from a run before the fixtures), by name, never a count (FX12). Absent when none.
   */
  missing?: string[];
}

/** The extract a raw part answers for (`<filter>-<extract>.geojsonl`). */
const extractOf = (part: string) => part.slice(part.indexOf('-') + 1).replace(/\.geojsonl$/, '');

/** The z8 blocks an extract's other answers (its places' and stores' elements) fall in: where that extract is. */
function blocksOf(store: RawStore, run: string, parts: { part: string }[]): Set<string> {
  const out = new Set<string>();
  for (const { part } of parts) {
    for (const line of store.read('osm', run, part).split('\n')) {
      if (!line.trim()) continue;
      try {
        const at = pointOf((JSON.parse(line) as { geometry?: unknown }).geometry);
        if (at) out.add(blockOf(at));
      } catch {
        // a line that is not JSON places nothing
      }
    }
  }
  return out;
}

export interface FixturesResult {
  pack: FixturePack | null;
  registry: Registry;
  report: FixturesReport;
}

export function buildFixtures(o: { store: RawStore; osmRun: string | null; wikidataRun: string | null; region: string; version: string; registry: Registry; newId: () => string }): FixturesResult {
  const none = (reason: string): FixturesResult => ({ pack: null, registry: o.registry, report: { reason, setAside: [], sources: [] } });
  if (!o.osmRun) return none('no OpenStreetMap run');
  const all = o.store.parts('osm', o.osmRun);
  // fix osm-per-extract audit 5: a copy fetched this run before one carried from an earlier run (`carriedFrom`), so an
  // element both extracts hold along their border is the fresh copy, once (the order is otherwise the parts' own).
  const parts = all.filter((p) => FIXTURES_PART.test(p.part)).sort((a, b) => Number(a.carriedFrom != null) - Number(b.carriedFrom != null));
  if (!parts.length) return none('no fixtures in the OpenStreetMap run');
  const raw: unknown[] = parts.flatMap((p) => adaptFixtures(o.store.read('osm', o.osmRun!, p.part), p.fetchedAt));
  const sources = ['osm'];
  // fix osm-per-extract audit 2: an extract with no fixtures part (carried from a run before them) is left empty: its
  // Wikidata libraries are left out too, where no extract with fixtures reaches the same block, so none is kept alone
  // this week and re-keyed to its OSM element next week.
  const filled = new Set(parts.map((p) => extractOf(p.part)));
  const missing = [...new Set(all.map((p) => extractOf(p.part)))].filter((x) => !filled.has(x)).sort();
  const others = all.filter((p) => !FIXTURES_PART.test(p.part));
  const lost = missing.length ? blocksOf(o.store, o.osmRun, others.filter((p) => missing.includes(extractOf(p.part)))) : new Set<string>();
  const reached = missing.length ? blocksOf(o.store, o.osmRun, others.filter((p) => !missing.includes(extractOf(p.part)))) : new Set<string>();
  const wd = o.wikidataRun ? o.store.parts(SOURCE, o.wikidataRun).find((p) => p.part === PART) : undefined;
  if (wd) {
    raw.push(...adaptLibraries(o.store.read(SOURCE, o.wikidataRun!, PART), wd.fetchedAt));
    sources.push('wikidata');
  }
  const setAside: FixturesReport['setAside'] = [];
  const candidates: FixtureCandidate[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    const r = FixtureCandidateSchema.safeParse(row);
    if (!r.success) {
      setAside.push({ name: String((row as { name?: unknown })?.name ?? '?'), reason: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
      continue;
    }
    const c = r.data;
    const key = `${c.source}:${c.sourceId}#${c.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (c.source !== 'osm' && lost.has(blockOf(c.at)) && !reached.has(blockOf(c.at))) continue;
    candidates.push(c);
  }
  const ids = createIds(o.registry, o.newId, FIXTURE_ID);
  const fixtures: Fixture[] = [];
  for (const c of mergeFixtures(candidates)) {
    const f = {
      id: ids.forKey(`${c.source}:${c.sourceId}#${c.kind}`, `${c.kind} ${c.name ?? ''}`, c.at),
      kind: c.kind,
      at: c.at,
      ...(c.name ? { name: c.name } : {}),
      src: c.source === 'osm' ? 'osm' : 'wd',
    };
    const r = FixtureSchema.safeParse(f);
    if (r.success) fixtures.push(r.data);
    else setAside.push({ name: c.name ?? c.kind, reason: r.error.issues.map((i) => i.message).join('; ') });
  }
  return { pack: packFixtures(fixtures, o.region, o.version), registry: ids.finish(), report: { reason: 'built', setAside, sources, ...(missing.length ? { missing } : {}) } };
}
