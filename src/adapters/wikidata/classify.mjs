import { createRequire } from 'node:module';

// The Wikidata adapter's classes (PW5-PW7, decision 0103 in the app repo). Each class is a fixed list of Wikidata
// classes (P31 values), pinned from a lookup on 2026-11-06: never a judgment at run time. The class names are the
// contract's vocabulary (`src/classes.ts`); a test keeps them in it.

/** PW6: the order a place is classified in: it commemorates; it was made as art; you look out from it; it is odd. */
export const ORDER = [
  // It commemorates: a war memorial before a memorial or a statue (ST2).
  'war_memorial', 'monument', 'memorial', 'statue', 'marker',
  // It was made as art: a sculpture before a fountain, so a fountain that is art is art (ST5; the owner, Nov 17).
  'mural', 'sculpture', 'fountain', 'sign',
  // You go there to look out: a fire lookout tower before an observation tower.
  'fire_tower', 'overlook', 'tower',
  // What it is, by type (ST1): structures, nature, culture.
  // AT10: a covered bridge (`bridge`) before a suspension bridge.
  'bridge', 'suspension_bridge', 'lighthouse', 'mill', 'water_tower', 'clock_tower', 'fort', 'historic_machine', 'mausoleum',
  'waterfall', 'cave', 'hot_spring', 'old_tree', 'garden', 'community_garden',
  'concert_hall', 'observatory', 'carousel', 'zoo', 'amusement_park', 'museum_by_type', 'archaeological_site', 'nature_reserve', 'pier',
  // It is one of the odd classes: a curiosity; a milestone is an old stone before it marks a fact; a ghost town before a ruin.
  'folly', 'novelty_building', 'roadside_giant', 'natural_oddity', 'odd_engineering', 'old_stone', 'marks_a_fact', 'art_environment', 'ghost_town', 'ruin',
];

/** Wikidata classes per archive class (usage counts on 2026-11-06 in the comments). */
export const CLASSES = {
  monument: ['Q4989906', 'Q170980', 'Q893745'], // monument 48,814; obelisk 1,134; national monument 76 (AT5; AT8 limits it)
  // ST2: war memorial moved to its own class (Nov 17).
  war_memorial: ['Q575759'], // war memorial 66,515
  memorial: ['Q5003624'], // memorial 20,074
  statue: ['Q179700', 'Q241045'], // statue 60,852; bust (Nov 17)
  marker: ['Q721747'], // commemorative plaque 23,862
  mural: ['Q219423', 'Q133067'], // mural 4,008; mosaic (Nov 17)
  sculpture: ['Q860861', 'Q557141'], // sculpture 129,767; public art 162
  // ST1 (Nov 17; US counts with coordinates in the comments).
  fountain: ['Q483453'], // fountain 165
  sign: ['Q6006', 'Q3410466', 'Q83809'], // neon sign 11; ghost sign 1; totem pole 6
  overlook: ['Q6017969', 'Q177305'], // scenic viewpoint 1,510; observation deck 165
  tower: ['Q1440300'], // observation tower 1,891
  fire_tower: ['Q748998'], // fire lookout tower 277 (from tower)
  bridge: ['Q1825472'], // covered bridge 896 (from odd_engineering)
  // AT10 (contract v8; the owner, Nov 18): suspension bridge 122 (AT5; from `bridge`), not History unless listed (AT7).
  suspension_bridge: ['Q12570'],
  lighthouse: ['Q39715'], // lighthouse 888 (from odd_engineering)
  mill: ['Q185187', 'Q38720'], // watermill 142; windmill 56
  water_tower: ['Q274153'], // water tower 146
  clock_tower: ['Q853854'], // clock tower 22
  fort: ['Q1412205'], // armory 34
  historic_machine: ['Q575727'], // museum ship 45
  mausoleum: ['Q162875', 'Q381885'], // mausoleum 86; tomb 24
  waterfall: ['Q34038'], // waterfall 823
  cave: ['Q2232001'], // show cave 112
  hot_spring: ['Q177380', 'Q83471'], // hot spring 170; geyser 106
  old_tree: ['Q811534'], // remarkable tree 120
  garden: ['Q167346', 'Q272231', 'Q15835', 'Q291177', 'Q1107656', 'Q1759852', 'Q84343482', 'Q55177716', 'Q47692', 'Q140470772', 'Q11507581'],
  // botanical garden 704; arboretum 82; Japanese garden 27; rose garden 14; AT3: garden 73, sculpture garden 73, memorial
  // garden 12, public garden 9, Chinese garden 4, peace garden 3, Japanese garden outside Japan 7 (US, Nov 17)
  community_garden: ['Q251958'], // community garden 114
  concert_hall: ['Q1060829', 'Q153562'], // concert hall 190; opera house 218
  observatory: ['Q62832', 'Q148319'], // observatory 76; planetarium 43
  carousel: ['Q208322', 'Q3126170'], // carousel 70; bandstand 30
  zoo: ['Q43501', 'Q2281788'], // zoo 337; public aquarium 74
  // AT5: amusement park 366, water park 108, theme park 35, animal theme park 8, marine mammal park 6, indoor water park 3.
  amusement_park: ['Q194195', 'Q740326', 'Q2416723', 'Q3363974', 'Q15060435', 'Q15411990'],
  // AT2: the museum types that hold the US's museums with coordinates (5,866 in all, Nov 17); a listed museum stays `museum`.
  museum_by_type: [
    'Q33506', 'Q207694', 'Q16735822', 'Q54934129', 'Q4828724', 'Q2772772', 'Q1595639', 'Q16761700', 'Q18704634', 'Q842478',
    'Q1863818', 'Q588140', 'Q1970365', 'Q787934', 'Q756102', 'Q866133', 'Q17455058', 'Q10624527', 'Q11786880', 'Q111889841',
    'Q78458396', 'Q18411786', 'Q2087181', 'Q3499307',
  ],
  // AT4: nature reserve 390, National Wildlife Refuge 577, wildlife refuge 109, Washington State Wildlife Area 208, national
  // preserve 17, ecological reserve 6, state wildlife refuge 8.
  nature_reserve: ['Q179049', 'Q1410668', 'Q1377575', 'Q104905143', 'Q841646', 'Q5333253', 'Q140963225'],
  // AT5: pier 87, boardwalk 24 and 5.
  pier: ['Q863454', 'Q11111030', 'Q93338609'],
  archaeological_site: ['Q42195'], // petroglyph 17
  folly: ['Q180174'], // folly 359
  novelty_building: ['Q548879'], // novelty architecture 1
  roadside_giant: ['Q14915208'], // roadside attraction 35
  natural_oddity: ['Q372934', 'Q4850014', 'Q954501', 'Q854550', 'Q2086896'], // glacial erratic, balancing rock, natural arch, hoodoo, gravity hill
  odd_engineering: ['Q142031', 'Q2250229'], // funicular, shot tower (lighthouse and covered bridge moved, Nov 17)
  old_stone: ['Q10145'], // milestone (from marks_a_fact, Nov 17)
  marks_a_fact: ['Q316655', 'Q352956', 'Q590232'], // tripoint, survey marker, geographical center
  art_environment: ['Q2860356'], // visionary environment
  ghost_town: ['Q74047'], // ghost town 2,748 (from ruin, Nov 17)
  ruin: ['Q109607'], // ruins
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
/** ST3: a listed place's class by its type's root, in this order; a class no root names stays as `listing` found it. */
const BY_ROOT = Object.entries(TYPES.classes ?? {}).map(([cls, ids]) => [cls, new Set(ids)]);
/** ST3: which broad class each root's class refines. */
const REFINES = { building_structure: ['bridge', 'mill', 'station', 'lighthouse', 'civic_building', 'fort', 'water_tower', 'fountain', 'tavern'], historic_site: ['battlefield', 'archaeological_site'], theatre: ['concert_hall'] };
/** ST3: the class a listed place takes from its root, within the broad class its entry decided. */
function byRoot(broad, p31) {
  const ok = REFINES[broad] ?? [];
  for (const [cls, ids] of BY_ROOT) if (ok.includes(cls) && [...p31].some((q) => ids.has(q))) return cls;
  return broad;
}
const inGroup = (p31, g) => [...p31].some((q) => GROUPS[g].has(q));

/**
 * AT7: every Wikidata type v6 added (AT1-AT5): a listing's class wins over each (more-attractions audit 15, 17; the
 * owner, Nov 18: "Yes, every new type").
 */
const V6_TYPES = new Set([
  ...['museum_by_type', 'amusement_park', 'nature_reserve', 'pier', 'suspension_bridge'].flatMap((c) => CLASSES[c]),
  'Q893745', // national monument
  'Q1107656', 'Q1759852', 'Q84343482', 'Q55177716', 'Q47692', 'Q140470772', 'Q11507581', // AT3's new garden types
]);
/**
 * AT9: the US national monuments that are natural places (the owner, Nov 18: "Own subtype under Nature"), pinned by
 * item because Wikidata types most of them only as national monuments. From a lookup on 2026-11-18 of the 76 items
 * `?item wdt:P31 wd:Q893745 ; wdt:P17 wd:Q30 ; wdt:P625 ?c` with their P31 types; Timpanogos Cave (a show cave) stays
 * `cave`, and El Morro, Scotts Bluff and Russell Cave are kept for their history.
 */
export const NATURAL_MONUMENTS = [
  'Q390945', // Agate Fossil Beds
  'Q999352', // Buck Island Reef
  'Q2937254', // Cape Krusenstern
  'Q1035203', // Capulin Volcano
  'Q22927906', // Castle Mountains
  'Q374879', // Cedar Breaks
  'Q1111312', // Colorado
  'Q729965', // Devils Postpile
  'Q28920023', // Devils Tower
  'Q1324315', // El Malpais
  'Q1430179', // Florissant Fossil Beds
  'Q1439427', // Fossil Butte
  'Q692370', // Hagerman Fossil Beds
  'Q386178', // Jewel Cave
  'Q26695669', // Katahdin Woods and Waters
  'Q1476014', // Lava Beds
  'Q1195839', // Muir Woods
  'Q1936970', // Natural Bridges
  'Q1276829', // Organ Pipe Cactus
  'Q1894724', // Rainbow Bridge
  'Q1754469', // Sunset Crater Volcano
  'Q18712585', // Tule Springs Fossil Beds
  'Q386154', // Virgin Islands Coral Reef
  'Q7958854', // Waco Mammoth
];
/** AT8: national monument (AT5), and what `monument` holds besides it. */
const NATIONAL_MONUMENT = 'Q893745';
const MONUMENT_OWN = CLASSES.monument.filter((q) => q !== NATIONAL_MONUMENT);
const STATUE = CLASSES.statue;
/**
 * AT8: a national monument typed as one of these is a natural area, not a monument: protected area, nature reserve,
 * natural landscape, natural monument, biosphere reserve, canyon, volcano, mountain, forest, coral reef, cave (pinned
 * from a lookup on 2026-11-18), and the archive's nature classes.
 */
const NATURAL = new Set([
  'Q473972', 'Q179049', 'Q1286517', 'Q23790', 'Q158454', 'Q150784', 'Q8072', 'Q8502', 'Q4421', 'Q11292', 'Q35509',
  ...['nature_reserve', 'waterfall', 'cave', 'hot_spring', 'natural_oddity'].flatMap((c) => CLASSES[c]),
]);

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
  for (const cls of ['church', 'cemetery', 'theatre']) if (inGroup(p31, cls)) return { cls: byRoot(cls, p31), publicType: true, needsOpen: false };
  if (inGroup(p31, 'museum')) return { cls: 'museum', publicType: false, needsOpen: false };
  const cls = byRoot(inGroup(p31, 'site') ? 'historic_site' : 'building_structure', p31);
  if (inGroup(p31, 'public')) return { cls, publicType: true, needsOpen: false };
  if (inGroup(p31, 'open') || item.nhl) return { cls, publicType: false, needsOpen: false };
  return { cls, publicType: false, needsOpen: true };
}

/**
 * PW6: the archive class of a Wikidata item {p31: [Q…], listed, nhl}: a district never (RD4, whatever else it is
 * typed); a pinned natural national monument `natural_monument` (AT9); else the first in ORDER whose list holds one of
 * its classes (a listing never changes it, RD6, except that it wins over every v6 type, AT7; national monument as AT8
 * limits it); else its listed class (`listing`). Nothing about articles is read (the owner, Nov 6). Else null.
 */
export function classify(item) {
  const p31 = new Set(item.p31 ?? []);
  if (p31.has(DISTRICT)) return null;
  const listed = listing(item);
  // AT9: a pinned natural national monument is `natural_monument`, unless its listing gives it a class (AT7).
  if (NATURAL_MONUMENTS.includes(item.id)) return listed?.cls ?? 'natural_monument';
  for (const cls of ORDER) {
    if (!CLASSES[cls].some((q) => p31.has(q))) continue;
    // AT2, AT7: a listed place is classified as if the v6 types did not exist, so it keeps its listing's class (a listed
    // museum stays `museum`, a listed church that is also a museum `church`; more-attractions audit 15, 17).
    if (listed && CLASSES[cls].every((q) => !p31.has(q) || V6_TYPES.has(q))) continue;
    // AT8: national monument alone yields to a statue and makes no monument of a natural area (audit 16).
    if (cls === 'monument' && !MONUMENT_OWN.some((q) => p31.has(q)) && (STATUE.some((q) => p31.has(q)) || [...p31].some((q) => NATURAL.has(q)))) continue;
    return cls;
  }
  return listed?.cls ?? null;
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
  if (item.dissolved && cls !== 'ruin' && cls !== 'ghost_town') return true;
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
