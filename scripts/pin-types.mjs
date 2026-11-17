#!/usr/bin/env node
// Pins the Wikidata classes the listing rule reads (Remarkable and public, RP1-RP3, RP8, decision 0104): each root
// class with every subclass (P279*), looked up once and written to `public-types.json`, so neither the build nor
// the app ever looks a class up at run time. Owner-run, like the Nov 6 lookup of `classify.mjs`'s CLASSES:
//
//   node scripts/places-archive/pin-types.mjs
//
// A class reached from a home (a house, a residence, an apartment building) is never public by type, even when it is
// also a subclass of a public one (a rectory is a house before it is a church's). A class reached from another mundane
// root (an office, a school, a hotel) stays public when a public root reaches it too: a courthouse is a government
// building, which Wikidata makes an office building (remarkable-and-public audit 1).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ENDPOINT = 'https://query.wikidata.org/sparql';
const AGENT = 'Chronicles places build (+github.com/MiguelAGuerrero/chronicles; pinning classes, one query at a time)';

/** The roots, by the archive class a listed place of that type takes (RP8), with their English labels (Nov 9). */
export const ROOTS = {
  // A place of worship is a Historic church (RP8).
  church: { Q1370598: 'structure of worship', Q16970: 'church building', Q108325: 'chapel', Q2977: 'cathedral', Q34627: 'synagogue', Q32815: 'mosque', Q44539: 'temple' },
  cemetery: { Q39614: 'cemetery' },
  theatre: { Q24354: 'theatre building', Q153562: 'opera house' },
  // Public by nature, of the kind Buildings and structures: civic buildings, stations, engineering, industry, towers.
  public: {
    Q1137809: 'courthouse', Q543654: 'town hall', Q25550691: 'city hall', Q35054: 'post office', Q856584: 'library building',
    Q7075: 'library', Q28564: 'public library',
    Q55488: 'railway station', Q12280: 'bridge', Q12323: 'dam', Q105731: 'lock', Q474: 'aqueduct', Q181348: 'viaduct',
    Q44494: 'mill', Q185187: 'watermill', Q623605: 'gristmill', Q83405: 'factory', Q131734: 'brewery', Q181485: 'blast furnace',
    Q39715: 'lighthouse', Q274153: 'water tower', Q1785071: 'fort', Q483453: 'fountain',
  },
  // Shown open by its type (RP2): a museum is a Museum (RP8); a historic site is open but keeps the class of its type.
  museum: { Q33506: 'museum', Q2087181: 'historic house museum', Q756102: 'open-air museum' },
  open: { Q1081138: 'historic site' },
  // Not a building: an admitted site is a Monument (audit 10, the owner, Nov 9); it decides the kind, never entry.
  site: { Q839954: 'archaeological site', Q4895508: 'battlefield', Q852190: 'shipwreck', Q1081138: 'historic site' },
  // Homes: never public by type, whatever else they are (RP3).
  home: { Q3947: 'house', Q11755880: 'residential building', Q1307276: 'single-family detached home', Q13402009: 'apartment building' },
  // Never public by type on their own (RP3): enters only shown open or as a Landmark.
  mundane: {
    Q3914: 'school', Q1244442: 'school building', Q1021645: 'office building', Q655686: 'commercial building',
    Q18761864: 'bank building', Q27686: 'hotel', Q63099748: 'hotel building',
  },
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function subclasses(root) {
  const q = `SELECT DISTINCT ?c WHERE { ?c wdt:P279* wd:${root} . }`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${ENDPOINT}?query=${encodeURIComponent(q)}`, { headers: { 'user-agent': AGENT, accept: 'application/sparql-results+json' } }).catch(() => null);
    if (res?.ok) return (await res.json()).results.bindings.map((b) => b.c.value.replace(/^.*\//, ''));
    await wait(5000 * (attempt + 1));
  }
  throw new Error(`no subclasses for ${root}`);
}

/** The groups a mundane class is taken out of: public by type. A museum or a historic site is shown open whatever else it is. */
const BY_TYPE = new Set(['church', 'cemetery', 'theatre', 'public']);

const HOMES = ['Q3947', 'Q11755880', 'Q1307276', 'Q13402009'];

/**
 * Each group's ids, every root with its subclasses. A home's class is never public by type (a historic house museum
 * still shows open); another mundane class is taken out only where no public root reaches it (audit 1).
 */
export function groupsFrom(closures) {
  const homes = new Set(HOMES.flatMap((r) => closures[r] ?? [r]));
  const out = {};
  for (const [group, roots] of Object.entries(ROOTS)) {
    const ids = new Set(Object.keys(roots).flatMap((r) => closures[r] ?? [r]));
    out[group] = [...ids].filter((id) => !BY_TYPE.has(group) || !homes.has(id)).sort();
  }
  return out;
}

async function main() {
  const closures = {};
  for (const roots of Object.values(ROOTS))
    for (const r of Object.keys(roots)) {
      closures[r] = await subclasses(r);
      await wait(1500);
    }
  const groups = groupsFrom(closures);
  const file = join(import.meta.dirname, 'public-types.json');
  writeFileSync(file, `${JSON.stringify({ pinned: new Date().toISOString().slice(0, 10), roots: ROOTS, groups }, null, 1)}\n`);
  console.error(Object.entries(groups).map(([g, ids]) => `${g} ${ids.length}`).join(', '));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
