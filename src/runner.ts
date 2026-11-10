// The runner (PP1-PP4, PP7, PP14, decision 0108): checks each adapter's declaration, fetches through its polite
// fetch into the raw store, adapts every raw answer and checks each candidate, then conflates, gates, applies the
// owner's edits and packages. Only `fetch` touches the network; with `fetch: false` the run reads the raw store alone.
import type { Adapter, Box } from './adapter';
import { conflate, createIds, type Registry, type SourceInfo } from './conflate';
import { applyEdits, gate, type Edits } from './gate';
import { politeFetch, type Clock, type Fetch } from './http';
import { packages, type Pack } from './package';
import type { RawStore } from './rawStore';
import { CandidateSchema, DeclarationSchema, type Candidate, type LicenseFamily, type Place } from './schema';

export interface Report {
  sources: { name: string; run: string | null; fellBack?: string; error?: string }[];
  setAside: { source: string; part: string; reason: string }[];
  /** Nominations, for the owner to read: never in a pack, the registry or the crosswalk (PP7). */
  review: { source: string; name: string; evidence?: string }[];
  /**
   * RD12: for each test area, every place the pack holds there, with its class and why it entered; and, for the whole
   * region, how many each class and reason add. For the owner: never in a release, the archive, the manifest or the
   * state (the reason is worked out here from the candidates, never stored on a place or in the registry).
   */
  added?: { area: string; places: { name: string; class: string; reason: string; id: string; at: [number, number] }[] }[];
  summary?: Record<string, number>;
}

/** RD12: a test area for the owner's review, [west, south, east, north]. */
export interface ReviewArea {
  name: string;
  bbox: [number, number, number, number];
}

/** RD12: why a place entered, from its locating candidate's signals (booleans only, RD14). */
export function reasonOf(c: Candidate | undefined): string {
  const s = c?.signals ?? {};
  if (s.needsOpen) return 'shown open';
  if (s.publicType) return 'public type';
  if (s.heritage) return 'landmark';
  if (s.listed) return 'shown open';
  return 'class';
}

/** RD11: the family a region's one pack takes when a source of another family changed its places; none otherwise. */
export function familyOf(touched: Set<LicenseFamily>): LicenseFamily | undefined {
  const other = [...touched].filter((f) => f !== 'cc0');
  if (other.length > 1) throw new Error(`sources of two licenses (${other.join(', ')}) changed one region; a pack never mixes families (PP9)`);
  return other[0];
}

/** PP1: what a declaration is missing or gets wrong, by field; empty when it may run. */
export function declarationProblems(decl: unknown): string[] {
  const r = DeclarationSchema.safeParse(decl);
  return r.success ? [] : [...new Set(r.error.issues.map((i) => `${i.path.join('.') || '(declaration)'}: ${i.message}`))];
}

/** PP1: refuses an adapter whose declaration is incomplete, naming what is missing. */
export function checkAdapters(adapters: Adapter[]) {
  const names = new Set<string>();
  for (const a of adapters) {
    const problems = declarationProblems(a.declaration);
    if (problems.length) throw new Error(`adapter ${String((a.declaration as { name?: unknown })?.name ?? '?')} may not run: ${problems.join('; ')}`);
    if (names.has(a.declaration.name)) throw new Error(`two adapters are named ${a.declaration.name}`);
    names.add(a.declaration.name);
  }
}

export interface RunOptions {
  adapters: Adapter[];
  region: string;
  area: Box[];
  version: string;
  store: RawStore;
  registry: Registry;
  edits: Edits;
  /** False: build from the raw store alone, asking no source (PP2). */
  fetch: boolean;
  http: Fetch;
  clock: Clock;
  newId: () => string;
  log?: (line: string) => void;
  /** Runs of raw answers kept per source (PP15); default 3. */
  keepRuns?: number;
  /** RD12: test areas for the owner's review in the report. */
  reviewAreas?: ReviewArea[];
}

export interface RunResult {
  report: Report;
  packs: Pack[];
  registry: Registry;
}

export async function run(o: RunOptions): Promise<RunResult> {
  checkAdapters(o.adapters);
  const log = o.log ?? (() => {});
  const report: Report = { sources: [], setAside: [], review: [] };
  const candidates: Candidate[] = [];

  for (const a of o.adapters) {
    const d = a.declaration;
    let used: string | null = null;
    const entry: Report['sources'][number] = { name: d.name, run: null };
    if (o.fetch) {
      try {
        const http = politeFetch(d, o.http, o.clock);
        await a.fetch({ area: o.area, run: o.version, put: (part, body) => o.store.put(d.name, o.version, part, body, new Date(o.clock.now()).toISOString()), http, log });
        o.store.complete(d.name, o.version);
        used = o.version;
      } catch (e) {
        // PP14: the last complete answers stand in, and the other sources go on.
        used = o.store.lastComplete(d.name, o.version);
        entry.error = String((e as Error)?.message ?? e);
        entry.fellBack = used ?? 'none';
        log(`${d.name}: fetch failed (${entry.error}); using ${used ?? 'nothing'}`);
      }
    } else {
      used = o.store.parts(d.name, o.version).length ? o.version : o.store.lastComplete(d.name, `${o.version}~`);
    }
    entry.run = used;
    report.sources.push(entry);
    if (!used) continue;

    for (const { part, fetchedAt } of o.store.parts(d.name, used)) {
      let rows: unknown[];
      try {
        rows = a.adapt(o.store.read(d.name, used, part), part, fetchedAt);
      } catch (e) {
        report.setAside.push({ source: d.name, part, reason: `unreadable: ${String((e as Error)?.message ?? e)}` });
        continue;
      }
      for (const row of rows) {
        const r = CandidateSchema.safeParse(row);
        if (!r.success) {
          report.setAside.push({ source: d.name, part, reason: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
          continue;
        }
        if (r.data.source !== d.name) {
          report.setAside.push({ source: d.name, part, reason: `claims to be from ${r.data.source}` });
          continue;
        }
        // PP7: a nomination goes to the owner's review list and nowhere else.
        if (d.role === 'nominates') report.review.push({ source: d.name, name: r.data.name, ...(r.data.evidence ? { evidence: r.data.evidence } : {}) });
        // PP1: a source that may not reach a pack adds nothing to one.
        else if (d.allowed.reachPack) candidates.push({ ...r.data, evidence: undefined });
      }
    }
    // PP1: a source that may not store its answers keeps none past the run; the rest keep theirs for their retention.
    o.store.prune(d.name, d.allowed.store ? d.allowed.retentionDays : 0, o.clock.now() + (d.allowed.store ? 0 : 1));
    o.store.keepNewest(d.name, o.keepRuns ?? 3);
  }

  const sources: SourceInfo[] = o.adapters.map((a) => ({ name: a.declaration.name, code: a.declaration.code, role: a.declaration.role, licenseFamily: a.declaration.licenseFamily }));
  const ids = createIds(o.registry, o.newId);
  const touched = new Set<LicenseFamily>();
  const places = applyEdits(gate(conflate(candidates, sources, ids, touched)), o.edits, ids);
  if (o.reviewAreas?.length) review(report, places, candidates, sources, ids, o.reviewAreas);
  return { report, packs: packages(places, o.region, o.version, familyOf(touched)), registry: ids.finish() };
}

/** RD12: the owner's review, worked out from the candidates; nothing of it is stored on a place. */
function review(report: Report, places: Place[], candidates: Candidate[], sources: SourceInfo[], ids: ReturnType<typeof createIds>, areas: ReviewArea[]) {
  const locating = new Set(sources.filter((s) => s.role === 'locates').map((s) => s.name));
  const byId = new Map<string, Candidate>();
  for (const c of candidates) {
    if (!locating.has(c.source)) continue;
    const id = ids.lookup(`${c.source}:${c.sourceId}`);
    if (id && !byId.has(id)) byId.set(id, c);
  }
  const reason = (p: Place) => (p.src === 'owner' ? 'owner' : reasonOf(byId.get(p.id)));
  report.summary = {};
  for (const p of places) {
    const k = `${p.class}: ${reason(p)}`;
    report.summary[k] = (report.summary[k] ?? 0) + 1;
  }
  const inside = ([w, s, e, n]: ReviewArea['bbox'], [x, y]: [number, number]) => x >= w && x <= e && y >= s && y <= n;
  report.added = areas.map((a) => ({
    area: a.name,
    places: places.filter((p) => inside(a.bbox, p.at)).map((p) => ({ name: p.name, class: String(p.class), reason: reason(p), id: p.id, at: p.at })),
  }));
}

/** PP1: the sources whose raw answers may go into the published state asset. */
export const redistributable = (adapters: Adapter[]) => adapters.filter((a) => a.declaration.allowed.redistribute).map((a) => a.declaration.name);
