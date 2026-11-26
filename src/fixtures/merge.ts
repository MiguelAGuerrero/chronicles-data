// One fixture kept once (FX6; the app's TF25, decision 0268): OpenStreetMap preferred at every step. Its candidates are
// merged first, in a fixed order of preference; Wikidata's libraries then join the OSM element whose `wikidata` tag names
// their item, else an OSM library they match by name within 250 m (or an unnamed one within 50 m), and are kept on their
// own only when none does. Pure, and the same whatever the order of its input. A grid of cells of about 280 m keeps it
// O(n) over the US's hundred thousand fixtures.
import type { FixtureCandidate } from './schema';

const NAME_M = 250;
const UNNAMED_M = 50;
const CELL_DEG = 0.0025;

/** Letter case, accents, spaces, punctuation, a trailing parenthetical and a trailing ", <town>" aside. */
export function normName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s*\([^()]*\)\s*$/, '')
    .replace(/,[^,]*$/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function metres(a: [number, number], b: [number, number]): number {
  const r = Math.PI / 180;
  const x = (b[0] - a[0]) * r * Math.cos(((a[1] + b[1]) / 2) * r);
  const y = (b[1] - a[1]) * r;
  return Math.sqrt(x * x + y * y) * 6_371_000;
}

const TYPE_RANK: Record<string, number> = { way: 0, relation: 1, node: 2 };
const typeRank = (c: FixtureCandidate) => TYPE_RANK[c.sourceId.split('/')[0]] ?? 3;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The order of preference within a source: a name, then a Wikidata item, then a way before a relation before a node, then the id. */
function preferred(a: FixtureCandidate, b: FixtureCandidate): number {
  return Number(!a.name) - Number(!b.name) || Number(!a.item) - Number(!b.item) || typeRank(a) - typeRank(b) || cmp(a.sourceId, b.sourceId) || cmp(a.kind, b.kind);
}

export function mergeFixtures(candidates: readonly FixtureCandidate[]): FixtureCandidate[] {
  const kept: FixtureCandidate[] = [];
  const grid = new Map<string, FixtureCandidate[]>();
  const byItem = new Map<string, FixtureCandidate>();
  const cellOf = (at: [number, number]) => [Math.floor(at[1] / CELL_DEG), Math.floor((at[0] * Math.cos((at[1] * Math.PI) / 180)) / CELL_DEG)];
  const near = (c: FixtureCandidate): FixtureCandidate[] => {
    const [y, x] = cellOf(c.at);
    const out: FixtureCandidate[] = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) out.push(...(grid.get(`${c.kind}|${y + dy}|${x + dx}`) ?? []));
    return out;
  };
  const matches = (k: FixtureCandidate, c: FixtureCandidate) => {
    const d = metres(k.at, c.at);
    if (k.name && c.name) return d <= NAME_M && normName(k.name) === normName(c.name);
    return d <= UNNAMED_M;
  };
  const keep = (c: FixtureCandidate) => {
    kept.push(c);
    const [y, x] = cellOf(c.at);
    const key = `${c.kind}|${y}|${x}`;
    grid.set(key, [...(grid.get(key) ?? []), c]);
    if (c.item) {
      const k = `${c.kind}|${c.item}`;
      if (!byItem.has(k)) byItem.set(k, c);
    }
  };
  const osm = candidates.filter((c) => c.source === 'osm').sort(preferred);
  const others = candidates.filter((c) => c.source !== 'osm').sort(preferred);
  for (const c of [...osm, ...others]) {
    if (c.item && byItem.has(`${c.kind}|${c.item}`)) continue;
    if (near(c).some((k) => matches(k, c))) continue;
    keep(c);
  }
  return kept.sort((a, b) => cmp(`${a.source}:${a.sourceId}:${a.kind}`, `${b.source}:${b.sourceId}:${b.kind}`));
}
