// The gate (PP6, PP10, decisions 0103, 0108): which places enter a pack. It is written in the archive's own class
// vocabulary and reads no source name, no number of sources and no count: a place with a class, a position and no
// sign that it is gone enters, whoever named it. Then the owner's edits, as PW13. It imports no adapter.
import { metres, norm, SAME_PLACE_M, type Ids } from './conflate';
import type { Place } from './schema';

export interface Edits {
  /** A removal without a name strikes the unnamed places within 50 m of `at` (OL4). */
  remove: { name?: string; at: [number, number] }[];
  add: { name: string; at: [number, number]; class: string }[];
}

/**
 * PP6, RD8, RD9: the places that may enter a pack: a class, not gone, not closed, and, when it needs a sign of being
 * open, one. Still blind to sources: it reads booleans, never who said them or how many did.
 */
export function gate(places: Place[]): Place[] {
  return places.filter((p) => p.class != null && !p.gone && !p.closed && (!p.needsOpen || p.open === true));
}

const same = (p: { name?: string; at: [number, number] }, q: { name?: string; at: [number, number] }) =>
  norm(p.name ?? '') === norm(q.name ?? '') && metres(p.at, q.at) <= SAME_PLACE_M;

/** PP10: the owner's removals, then additions (an addition replaces a gated place of the same name within 50 m). */
export function applyEdits(places: Place[], edits: Edits, ids: Ids): Place[] {
  let out = places.filter((p) => !(edits.remove ?? []).some((r) => same(p, r)));
  for (const a of edits.add ?? []) {
    const name = a.name.trim();
    out = out.filter((p) => !same(p, { name, at: a.at }));
    out.push({ id: ids.forKey(`owner:${norm(name)}`, name, a.at), name, at: a.at, class: a.class, gone: false, src: 'owner', license: 'cc0' });
  }
  return out;
}
