// Build the fixtures (FX7, FX11, FX13): read the OSM source's `fixtures-*` raw parts (kept by the one shared extract pass,
// FX10) and Wikidata's libraries (their own read, FX13), adapt, check, keep one fixture once (OpenStreetMap first, FX6),
// give each an opaque id from its own registry, and package. OpenStreetMap first: a run whose OSM answers hold no
// fixtures builds no pack, so no Wikidata-only pack is published. Nothing here touches the places or the stores.
import { createIds, type Registry } from '../conflate';
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
}

export interface FixturesResult {
  pack: FixturePack | null;
  registry: Registry;
  report: FixturesReport;
}

export function buildFixtures(o: { store: RawStore; osmRun: string | null; wikidataRun: string | null; region: string; version: string; registry: Registry; newId: () => string }): FixturesResult {
  const none = (reason: string): FixturesResult => ({ pack: null, registry: o.registry, report: { reason, setAside: [], sources: [] } });
  if (!o.osmRun) return none('no OpenStreetMap run');
  const parts = o.store.parts('osm', o.osmRun).filter((p) => FIXTURES_PART.test(p.part));
  if (!parts.length) return none('no fixtures in the OpenStreetMap run');
  const raw: unknown[] = parts.flatMap((p) => adaptFixtures(o.store.read('osm', o.osmRun!, p.part), p.fetchedAt));
  const sources = ['osm'];
  const wd = o.wikidataRun ? o.store.parts(SOURCE, o.wikidataRun).find((p) => p.part === PART) : undefined;
  if (wd) {
    raw.push(...adaptLibraries(o.store.read(SOURCE, o.wikidataRun!, PART), wd.fetchedAt));
    sources.push('wikidata');
  }
  const setAside: FixturesReport['setAside'] = [];
  const candidates: FixtureCandidate[] = [];
  for (const row of raw) {
    const r = FixtureCandidateSchema.safeParse(row);
    if (r.success) candidates.push(r.data);
    else setAside.push({ name: String((row as { name?: unknown })?.name ?? '?'), reason: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
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
  return { pack: packFixtures(fixtures, o.region, o.version), registry: ids.finish(), report: { reason: 'built', setAside, sources } };
}
