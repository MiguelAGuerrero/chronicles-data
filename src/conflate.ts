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

const near = (a: { name: string; at: [number, number] }, b: { name: string; at: [number, number] }) =>
  norm(a.name) === norm(b.name) && metres(a.at, b.at) <= SAME_PLACE_M;

/** PP8: hands out IDs for one build against the last build's registry. */
export function createIds(prev: Registry, newId: () => string) {
  const places: Registry['places'] = structuredClone(prev.places);
  const crosswalk: Registry['crosswalk'] = { ...prev.crosswalk };
  const claimed = new Set<string>();
  // Places by name, so matching a record is a lookup, not a scan of every place (a full sweep took 74 minutes, Nov 11).
  const byName = new Map<string, Set<string>>();
  const index = (id: string) => {
    const k = norm(places[id].name);
    if (!byName.has(k)) byName.set(k, new Set());
    byName.get(k)!.add(id);
  };
  const unindex = (id: string) => byName.get(norm(places[id].name))?.delete(id);
  for (const id of Object.keys(places)) index(id);

  const mint = () => {
    for (;;) {
      const id = newId();
      if (!/^p_[0-9a-f]{16}$/.test(id)) throw new Error(`newId gave ${id}`);
      if (!(id in places) && !claimed.has(id)) return id;
    }
  };

  return {
    /** The ID for a source's record: by its key, else a known place of the same name within 50 m, else a new one. */
    forKey(key: string, name: string, at: [number, number]): string {
      let id = crosswalk[key];
      if (!id || claimed.has(id)) {
        id = [...(byName.get(norm(name)) ?? [])]
          .sort()
          .find((k) => !places[k].retired && !claimed.has(k) && near(places[k], { name, at })) ?? mint();
      }
      claimed.add(id);
      crosswalk[key] = id;
      if (places[id]) unindex(id);
      places[id] = { name, at };
      index(id);
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
  const byKey = (a: Candidate, b: Candidate) =>
    (order.get(a.source) ?? 99) - (order.get(b.source) ?? 99) || (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0);

  const made: Place[] = [];
  const madeByName = new Map<string, Place[]>();
  const madeById = new Map<string, Place>();
  const seen = new Set<string>();
  for (const c of candidates.filter((x) => roleOf(x) === 'locates' && x.at).sort(byKey)) {
    const key = `${c.source}:${c.sourceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const at = c.at as [number, number];
    const twin = (madeByName.get(norm(c.name)) ?? []).find((p) => near(p, { name: c.name, at }));
    if (twin) {
      ids.alias(key, twin.id);
      continue;
    }
    const src = info.get(c.source)!;
    const place: Place = {
      id: ids.forKey(key, c.name, at), name: c.name, at, ...(c.class ? { class: c.class } : {}), gone: c.signals.gone === true,
      ...(c.signals.needsOpen === true ? { needsOpen: true } : {}), src: src.code, license: src.licenseFamily,
    };
    made.push(place);
    madeById.set(place.id, place);
    const n = norm(place.name);
    madeByName.set(n, [...(madeByName.get(n) ?? []), place]);
  }

  // A confirming source confirms a place, marks it gone, or says it is open or closed (PP7, RD7); nothing records how
  // many confirm it. `touched` gets the source's license family when its word changed what a place is (RD11): a
  // place it opened, closed or marked gone, so a region OSM only took places from is ODbL too.
  for (const c of candidates.filter((x) => roleOf(x) === 'confirms').sort(byKey)) {
    const id = (c.sameAs ?? []).map((k) => ids.lookup(k)).find((x) => x != null);
    const place = (id ? madeById.get(id) : undefined) ?? (c.at ? (madeByName.get(norm(c.name)) ?? []).find((p) => near(p, { name: c.name, at: c.at as [number, number] })) : undefined);
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
