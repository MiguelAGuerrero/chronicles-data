// Conflate (PP7, PP8, decision 0108): candidates from every source become places with opaque IDs that last from
// build to build. Only a locating source makes a place; a confirming source can only confirm one, mark it gone, or
// say it is open or closed (PP7 as amended by RD7: `open` and `closed` are ORs, and nothing counts how many say so);
// nominations never come here (the runner keeps them for the owner's review list).
//
// Matching, cheapest first, as Overture does: the same source ID as last build (the crosswalk), then the same name
// within 50 m of a place this build already made, then of a place the registry knows. One source's record is promoted
// whole (the source listed first wins); fields are never blended.
import type { Candidate, LicenseFamily, Place, Role } from './schema';

/** The same place when names match within this distance (the app's `archiveMerge.ts` uses the same). */
export const SAME_PLACE_M = 50;

export interface Registry {
  /** Every ID ever given, with where it was last; a retired ID is never given to another place (PP8). */
  places: Record<string, { name: string; at: [number, number]; retired?: boolean }>;
  /** `source:sourceId` to place ID. */
  crosswalk: Record<string, string>;
}

export interface SourceInfo {
  name: string;
  code: string;
  role: Role;
  licenseFamily: LicenseFamily;
}

export const emptyRegistry = (): Registry => ({ places: {}, crosswalk: {} });

export const norm = (s: string) => s.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();

export function metres([lon1, lat1]: [number, number], [lon2, lat2]: [number, number]) {
  const r = Math.PI / 180;
  const x = (lon2 - lon1) * r * Math.cos(((lat1 + lat2) / 2) * r);
  const y = (lat2 - lat1) * r;
  return Math.hypot(x, y) * 6371008.8;
}

type Located = { name?: string; at: [number, number] };
// An unnamed place has the empty name: two unnamed places within 50 m match (the same ID from build to build).
const near = (a: Located, b: Located) => norm(a.name ?? '') === norm(b.name ?? '') && metres(a.at, b.at) <= SAME_PLACE_M;

/** PP8: hands out IDs for one build against the last build's registry. */
export function createIds(prev: Registry, newId: () => string) {
  const places: Registry['places'] = structuredClone(prev.places);
  const crosswalk: Registry['crosswalk'] = { ...prev.crosswalk };
  const claimed = new Set<string>();

  const mint = () => {
    for (;;) {
      const id = newId();
      if (!/^p_[0-9a-f]{16}$/.test(id)) throw new Error(`newId gave ${id}`);
      if (!(id in places) && !claimed.has(id)) return id;
    }
  };

  return {
    /** The ID for a source's record: by its key, else a known place of the same name within 50 m, else a new one. */
    forKey(key: string, name: string | undefined, at: [number, number]): string {
      let id = crosswalk[key];
      if (!id || claimed.has(id)) {
        id = Object.keys(places)
          .sort()
          .find((k) => !places[k].retired && !claimed.has(k) && near(places[k], { name, at })) ?? mint();
      }
      claimed.add(id);
      crosswalk[key] = id;
      places[id] = { name: name ?? '', at };
      return id;
    },
    /** Records another key for a place already made (a second source naming it). */
    alias(key: string, id: string) {
      crosswalk[key] = id;
    },
    lookup: (key: string): string | undefined => crosswalk[key],
    /** The registry after this build: IDs not given this time are retired, never reused (PP8). */
    finish(): Registry {
      for (const id of Object.keys(places)) if (!claimed.has(id)) places[id] = { ...places[id], retired: true };
      return { places, crosswalk };
    },
  };
}

export type Ids = ReturnType<typeof createIds>;

/**
 * PP7, PP8: places from candidates. `sources` is in priority order (the first source's record is promoted whole).
 */
export function conflate(candidates: Candidate[], sources: SourceInfo[], ids: Ids, touched: Set<LicenseFamily> = new Set()): Place[] {
  const order = new Map(sources.map((s, i) => [s.name, i]));
  const info = new Map(sources.map((s) => [s.name, s]));
  const roleOf = (c: Candidate) => info.get(c.source)?.role;
  // A named record comes before an unnamed one of its source, so a named place is never replaced by an unnamed one (OL4).
  const byKey = (a: Candidate, b: Candidate) =>
    (order.get(a.source) ?? 99) - (order.get(b.source) ?? 99) || Number(!a.name) - Number(!b.name) || (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0);

  /** OL6: the place a locating record is already. By a source ID it names, else by position (names equal, or an unnamed one of the same class). */
  const twinOf = (made: Place[], c: Candidate, at: [number, number]): Place | undefined => {
    for (const k of c.sameAs ?? []) {
      const id = ids.lookup(k);
      const p = id ? made.find((x) => x.id === id) : undefined;
      if (p) return p;
    }
    return made.find((p) => metres(p.at, at) <= SAME_PLACE_M && (p.name && c.name ? norm(p.name) === norm(c.name) : p.class === c.class));
  };

  const made: Place[] = [];
  const seen = new Set<string>();
  for (const c of candidates.filter((x) => roleOf(x) === 'locates' && x.at).sort(byKey)) {
    const key = `${c.source}:${c.sourceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const at = c.at as [number, number];
    const twin = twinOf(made, c, at);
    if (twin) {
      ids.alias(key, twin.id);
      continue;
    }
    const src = info.get(c.source)!;
    // RD11: a place only a source of another license family made makes the region's pack that family's (OL9).
    if (src.licenseFamily !== 'cc0') touched.add(src.licenseFamily);
    made.push({
      id: ids.forKey(key, c.name, at), ...(c.name ? { name: c.name } : {}), at, ...(c.class ? { class: c.class } : {}), gone: c.signals.gone === true,
      ...(c.signals.needsOpen === true ? { needsOpen: true } : {}), src: src.code, license: src.licenseFamily,
    });
  }

  // A confirming source confirms a place, marks it gone, or says it is open or closed (PP7, RD7); nothing records how
  // many confirm it. `touched` gets the source's license family when its word changed what a place is (RD11): a
  // place it opened, closed or marked gone, so a region OSM only took places from is ODbL too.
  for (const c of candidates.filter((x) => roleOf(x) === 'confirms').sort(byKey)) {
    const id = (c.sameAs ?? []).map((k) => ids.lookup(k)).find((x) => x != null);
    const place = (id ? made.find((p) => p.id === id) : undefined) ?? (c.at && c.name ? made.find((p) => near(p, { name: c.name, at: c.at as [number, number] })) : undefined);
    if (!place) continue;
    ids.alias(`${c.source}:${c.sourceId}`, place.id);
    const family = info.get(c.source)!.licenseFamily;
    if (c.signals.gone === true && !place.gone) {
      place.gone = true;
      touched.add(family);
    }
    if (c.signals.closed === true && !place.closed) {
      place.closed = true;
      touched.add(family);
    }
    if (c.signals.open === true && !place.open) {
      place.open = true;
      if (place.needsOpen) touched.add(family);
    }
  }
  return made;
}
