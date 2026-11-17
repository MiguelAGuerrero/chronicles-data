// The stores gate (ST1, ST5): which candidates become stores. Each is checked against the closed schema, and one element
// is one store. A chain's shop stays (the app decides on chains, by its own list). It reads no count and imports no adapter.
import { StoreCandidateSchema, type StoreCandidate } from './schema';

export interface Dropped {
  name: string;
  reason: string;
}

export function gateStores(candidates: unknown[]): { kept: StoreCandidate[]; dropped: Dropped[] } {
  const kept: StoreCandidate[] = [];
  const dropped: Dropped[] = [];
  const seen = new Set<string>();
  for (const row of candidates) {
    const r = StoreCandidateSchema.safeParse(row);
    if (!r.success) {
      dropped.push({ name: String((row as { name?: unknown })?.name ?? '?'), reason: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
      continue;
    }
    const c = r.data;
    const key = `${c.source}:${c.sourceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(c);
  }
  return { kept: kept.sort((a, b) => (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0)), dropped };
}
