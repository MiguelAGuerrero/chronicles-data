import { createRequire } from 'node:module';

// The Wikidata adapter's classes (PW5-PW7, decision 0103 in the app repo). Each class is a fixed list of Wikidata
// classes (P31 values), pinned from a lookup on 2026-11-06: never a judgment at run time. The class names are the
// contract's vocabulary (`src/classes.ts`); a test keeps them in it.

/** PW6: the order a place is classified in: it commemorates; it was made as art; you look out from it; it is odd. */
export const ORDER = [
  // It commemorates: a monument.
  'monument', 'memorial', 'statue', 'marker',
  // It was made as art: public art.
  'mural', 'sculpture',
  // You go there to look out: a viewpoint.
  'overlook', 'tower',
  // It is one of the odd classes: a curiosity.
  'folly', 'novelty_building', 'roadside_giant', 'natural_oddity', 'odd_engineering', 'marks_a_fact', 'art_environment', 'ruin',
];

/** Wikidata classes per archive class (usage counts on 2026-11-06 in the comments). */
export const CLASSES = {
  monument: ['Q4989906', 'Q170980'], // monument 48,814; obelisk 1,134
  memorial: ['Q5003624', 'Q575759'], // memorial 20,074; war memorial 66,515
  statue: ['Q179700'], // statue 60,852
  marker: ['Q721747'], // commemorative plaque 23,862
  mural: ['Q219423'], // mural 4,008
  sculpture: ['Q860861', 'Q557141'], // sculpture 129,767; public art 162
  overlook: ['Q6017969', 'Q177305'], // scenic viewpoint 1,510; observation deck 165
  tower: ['Q1440300', 'Q748998'], // observation tower 1,891; fire lookout tower 1,791
  folly: ['Q180174'], // folly 359
  novelty_building: ['Q548879'], // novelty architecture 1
  roadside_giant: ['Q14915208'], // roadside attraction 35
  natural_oddity: ['Q372934', 'Q4850014', 'Q954501', 'Q854550', 'Q2086896'], // glacial erratic, balancing rock, natural arch, hoodoo, gravity hill
  odd_engineering: ['Q39715', 'Q1825472', 'Q142031', 'Q2250229'], // lighthouse, covered bridge, funicular, shot tower
  marks_a_fact: ['Q316655', 'Q352956', 'Q10145', 'Q590232'], // tripoint, survey marker, milestone, geographical center
  art_environment: ['Q2860356'], // visionary environment
  ruin: ['Q109607', 'Q74047'], // ruins, ghost town
};

/** National Historic Landmark, as a heritage designation (P1435): 2,522 uses on 2026-11-06. */
export const NHL = 'Q624232';
/** Historic district (P31): an area, never a place, so never a heritage building (the owner, Nov 6). */
export const DISTRICT = 'Q15243209';
/** National Register of Historic Places listing (P1435): a listed place is remarkable (RD1, the app's decision 0109). */
export const NRHP = 'Q19558910';

// RD1, RD2, RD6: the listed places' groups, each root with its subclasses, pinned by scripts/pin-types.mjs (Nov 9);
// only a home is taken out of the public groups. Never looked up at build time.
const TYPES = createRequire(import.meta.url)('./public-types.json');
const GROUPS = Object.fromEntries(Object.entries(TYPES.groups).map(([g, ids]) => [g, new Set(ids)]));
const inGroup = (p31, g) => [...p31].some((q) => GROUPS[g].has(q));

/** Every Wikidata class the fetch asks for. */
export const ALL_CLASS_IDS = [...new Set(Object.values(CLASSES).flat())].sort();

/**
 * RD1-RD6, RD8: a listed or Landmark item's class and how it enters, or null. By type first (a place of worship, a
 * cemetery, a theatre, a museum, then any public type); else shown open by its own type (a historic site); else a
 * Landmark, whatever its type (a private house too); else it `needsOpen`: it enters only when a confirming source
 * says it is open (RD8). A site, battlefield or wreck is `historic_site`; any other building or structure
 * `building_structure`.
 * @returns {{ cls: string, publicType: boolean, needsOpen: boolean } | null}
 */
export function listing(item) {
  if (!item.listed && !item.nhl) return null;
  const p31 = new Set(item.p31 ?? []);
  if (p31.has(DISTRICT)) return null;
  for (const cls of ['church', 'cemetery', 'theatre']) if (inGroup(p31, cls)) return { cls, publicType: true, needsOpen: false };
  if (inGroup(p31, 'museum')) return { cls: 'museum', publicType: false, needsOpen: false };
  const cls = inGroup(p31, 'site') ? 'historic_site' : 'building_structure';
  if (inGroup(p31, 'public')) return { cls, publicType: true, needsOpen: false };
  if (inGroup(p31, 'open') || item.nhl) return { cls, publicType: false, needsOpen: false };
  return { cls, publicType: false, needsOpen: true };
}

/**
 * PW6: the archive class of a Wikidata item {p31: [Q…], listed, nhl}: a district never (RD4, whatever else it is
 * typed); else the first in ORDER whose list holds one of its classes (a listing never changes it, RD6); else its
 * listed class (`listing`). Nothing about articles is read (the owner, Nov 6). Else null.
 */
export function classify(item) {
  const p31 = new Set(item.p31 ?? []);
  if (p31.has(DISTRICT)) return null;
  for (const cls of ORDER) if (CLASSES[cls].some((q) => p31.has(q))) return cls;
  return listing(item)?.cls ?? null;
}

/**
 * PW7: whether the place's sources say it no longer exists: a dissolved, abolished or demolished date (P576), or a
 * state saying demolished or destroyed (P5817, P5816). A closure date (P3999) is not gone: a decommissioned
 * lighthouse still stands. A ruin's or ghost town's abolished date is not gone either: the ruins are what is
 * there (places-worth-the-stop audit 6; the owner, Nov 5: "ensure they actually exist").
 * @param {{ dissolved?: boolean, closed?: boolean, states?: string[] }} item
 * @param {string | null} [cls]
 */
export function gone(item, cls = null) {
  if (item.dissolved && cls !== 'ruin') return true;
  return (item.states ?? []).some((s) => /\b(demolish|destroy|razed|no longer exist)/i.test(String(s)));
}

/**
 * PW7: the place's archive class if it enters the archive, else null. A class from the table and a location are
 * required; a Wikidata entry with a location is enough (the owner, Nov 5); a place that is gone is left out.
 * Never a count: no sitelinks, page views or rank are read.
 */
export function keep(item) {
  if (!Number.isFinite(item.lon) || !Number.isFinite(item.lat)) return null;
  if (!String(item.name ?? '').trim()) return null;
  const cls = classify(item);
  return cls && !gone(item, cls) ? cls : null;
}
