// OpenStreetMap tag counts, for the owner's review (docs/osm-tag-counts/spec.md, OC1-OC7). How many US elements carry
// each conventional-attraction tag, and how many of those also carry `wikidata`. The counts go to out/report.json and
// nowhere else: they never decide, gate or rank a place (a structured type decides, the app's 0103; nothing is a count
// or a score). Pure: the osmium calls that produce the text read here live in `./extract.ts`.

/** OC1: the tags counted, pinned. OpenStreetMap's waterfall is a `waterway`, as SL2 reads it. */
export const COUNT_TAGS: Record<string, readonly string[]> = {
  tourism: ['museum', 'attraction', 'theme_park', 'zoo', 'aquarium', 'viewpoint', 'gallery', 'artwork'],
  leisure: ['nature_reserve', 'garden', 'park', 'water_park'],
  man_made: ['pier'],
  historic: ['memorial', 'monument', 'ruins', 'fort', 'castle', 'archaeological_site', 'ship', 'wreck', 'building', 'manor'],
  natural: ['cave_entrance'],
  waterway: ['waterfall'],
};

type Table = Record<string, readonly string[]>;

const tagsOf = (table: Table) => Object.entries(table).flatMap(([k, vs]) => vs.map((v) => `${k}=${v}`));

/** OC1: the counted tags as `key=value`, in the table's order (the report's keys). */
export const COUNTED: readonly string[] = tagsOf(COUNT_TAGS);

/** One tag's counts: elements carrying it, and those of them that also carry `wikidata`. */
export interface TagCount {
  all: number;
  withWikidata: number;
}
export type TagCounts = Record<string, TagCount>;

/** OC4: the run's note holding one extract's counts, `tagCounts:<part>`. */
export const COUNTS_NOTE = 'tagCounts:';

/** OC2: `osmium tags-count` expressions, which take no object-type prefix (`nwr/…` matches nothing there). */
export function countExpressions(table: Table = COUNT_TAGS): string[] {
  return Object.entries(table).map(([k, vs]) => `${k}=${vs.join(',')}`);
}

/** OC3: `osmium tags-filter` expressions keeping the elements that carry a counted tag. */
export function countFilter(table: Table = COUNT_TAGS): string[] {
  return countExpressions(table).map((e) => `nwr/${e}`);
}

/** OC2: `osmium tags-count`'s lines (`count<TAB>"key"<TAB>"value"`) as `key=value` → count; key-only lines are skipped. */
export function parseTagsCount(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  const unquote = (s: string) => (s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s);
  for (const line of text.split('\n')) {
    const cols = line.replace(/\r$/, '').split('\t');
    if (cols.length < 3) continue;
    const n = Number(cols[0]);
    if (!Number.isInteger(n) || n < 0) continue;
    const tag = `${unquote(cols[1])}=${unquote(cols.slice(2).join('\t'))}`;
    out[tag] = (out[tag] ?? 0) + n;
  }
  return out;
}

/** OC3, OC5: one extract's counts, every counted tag present (0 when no element carries it). */
export function partCounts(all: Record<string, number>, withWikidata: Record<string, number>, table: Table = COUNT_TAGS): TagCounts {
  return Object.fromEntries(tagsOf(table).map((t) => [t, { all: all[t] ?? 0, withWikidata: withWikidata[t] ?? 0 }]));
}

/**
 * OC5: the run's counts, the sum of each part's note; null when a part has no note, or one that counted another set of
 * tags, so a part of the US is never reported as the whole.
 */
export function sumParts(meta: Record<string, string>, parts: readonly string[], table: Table = COUNT_TAGS): TagCounts | null {
  const tags = tagsOf(table);
  const sum = partCounts({}, {}, table);
  for (const part of parts) {
    const note = meta[`${COUNTS_NOTE}${part}`];
    if (note == null) return null;
    let c: TagCounts;
    try {
      c = JSON.parse(note);
    } catch {
      return null;
    }
    if (!c || typeof c !== 'object') return null;
    const keys = Object.keys(c);
    if (keys.length !== tags.length || !tags.every((t) => Number.isInteger(c[t]?.all) && Number.isInteger(c[t]?.withWikidata))) return null;
    for (const t of tags) {
      sum[t].all += c[t].all;
      sum[t].withWikidata += c[t].withWikidata;
    }
  }
  return sum;
}

/**
 * OC6: the counts the report holds: only from a run that asked OpenStreetMap (`asked`) and fetched it itself (its entry
 * names this run, with no error); null otherwise, so a push, a hand run naming other sources, `--no-fetch` or a fallback
 * writes none.
 */
export function countsForReport(
  entry: { run: string | null; error?: string; fellBack?: string } | undefined,
  version: string,
  asked: boolean,
  meta: Record<string, string>,
  parts: readonly string[],
): TagCounts | null {
  if (!asked || !entry || entry.run !== version || entry.error != null || entry.fellBack != null) return null;
  return sumParts(meta, parts);
}
