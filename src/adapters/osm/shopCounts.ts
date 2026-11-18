// OpenStreetMap shop counts, for the owner's review (docs/shop-counts/spec.md, SK1-SK8). Every value of `shop` and of
// `craft` in the US, and how many elements of each also say they sell second-hand: the evidence the stores contract's
// facets are redrawn from. The counts go to out/report.json and nowhere else; they decide, gate and rank nothing.
// Pure: the osmium calls that produce the text read here live in `./extract.ts`.

/** SK1: the keys whose every value is counted. */
export const SHOP_COUNT_KEYS = ['shop', 'craft'] as const;

/** SK2: `osmium tags-filter` expressions keeping the elements that carry either key. */
export const shopCountFilter = (): string[] => SHOP_COUNT_KEYS.map((k) => `nwr/${k}`);

/** SK1: `osmium tags-count` expressions; `key=*` counts each value (a bare key would count the key alone). */
export const shopCountExpressions = (): string[] => SHOP_COUNT_KEYS.map((k) => `${k}=*`);

/** SK9: every stop is a facet of the data, not only shops: these keys' values are counted too, straight from the extract. */
export const PLACE_COUNT_KEYS = ['tourism', 'historic', 'leisure', 'amenity', 'information'] as const;
export const placeCountExpressions = (): string[] => PLACE_COUNT_KEYS.map((k) => `${k}=*`);

/** SK3: the elements that say they sell second-hand. */
export const SECOND_HAND_FILTER = ['nwr/second_hand=only,yes'];

/** SK10: the elements that say when they are open. */
export const HOURS_FILTER = ['nwr/opening_hours'];

/** SK4: a value under this many elements of an extract is left out of that extract's counts. */
export const MIN_PER_EXTRACT = 3;

/** SK5: the run's note holding one extract's counts, `shopCounts:<part>`. */
export const SHOP_COUNTS_NOTE = 'shopCounts:';

export interface ShopCount {
  all: number;
  secondHand: number;
  /** SK10: those that carry `opening_hours`. */
  withHours: number;
}
export type ShopCounts = Record<string, ShopCount>;

/** SK4: one extract's counts: each value carried by enough elements, with the second-hand among them. */
export function partShopCounts(all: Record<string, number>, secondHand: Record<string, number>, min = MIN_PER_EXTRACT, places: Record<string, number> = {}, withHours: Record<string, number> = {}): ShopCounts {
  const out: ShopCounts = {};
  for (const [tag, n] of Object.entries(all)) if (n >= min) out[tag] = { all: n, secondHand: secondHand[tag] ?? 0, withHours: withHours[tag] ?? 0 };
  // SK9: the other kinds of stop; second-hand is asked of shops and crafts only.
  for (const [tag, n] of Object.entries(places)) if (n >= min && !(tag in out)) out[tag] = { all: n, secondHand: 0, withHours: withHours[tag] ?? 0 };
  return out;
}

/** SK6: the sum of each part's note; null when a part has none or one that cannot be read. */
export function sumShopParts(meta: Record<string, string>, parts: readonly string[]): ShopCounts | null {
  const sum: ShopCounts = {};
  for (const part of parts) {
    const note = meta[`${SHOP_COUNTS_NOTE}${part}`];
    if (note == null) return null;
    let c: ShopCounts;
    try {
      c = JSON.parse(note);
    } catch {
      return null;
    }
    if (!c || typeof c !== 'object' || Array.isArray(c)) return null;
    for (const [tag, v] of Object.entries(c)) {
      if (!Number.isInteger(v?.all) || !Number.isInteger(v?.secondHand) || !Number.isInteger(v?.withHours)) return null;
      const s = (sum[tag] ??= { all: 0, secondHand: 0, withHours: 0 });
      s.all += v.all;
      s.secondHand += v.secondHand;
      s.withHours += v.withHours;
    }
  }
  return sum;
}

/** SK7: what the report holds: the tags by how many carry them, then by name; only from a run that fetched OpenStreetMap itself. */
export function kindCountsForReport(
  entry: { run: string | null; error?: string; fellBack?: string } | undefined,
  version: string,
  asked: boolean,
  meta: Record<string, string>,
  parts: readonly string[],
): { minPerExtract: number; tags: ShopCounts } | null {
  if (!asked || !entry || entry.run !== version || entry.error != null || entry.fellBack != null) return null;
  const sum = sumShopParts(meta, parts);
  if (!sum) return null;
  const tags = Object.fromEntries(Object.entries(sum).sort((a, b) => b[1].all - a[1].all || (a[0] < b[0] ? -1 : 1)));
  return { minPerExtract: MIN_PER_EXTRACT, tags };
}
