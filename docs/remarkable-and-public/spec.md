# Remarkable and public, the data side (RD)

Nov 10, 2026 · the owner, porting the app's Remarkable and public (the app's `specs/remarkable-and-public`, decisions
0109-0111) into the pipeline, which moved here while that slice was built (decision 0108).

A National Register listing enters a pack when the place is public: its type is public by nature, or a source shows it
open to visitors, or it is a National Historic Landmark. A listed house, school, office or hotel with none of those stays
out, a historic district never enters, and a place OpenStreetMap marks private or closed never enters. OpenStreetMap
only corroborates Wikidata items, joined by their `wikidata` tag, and a pack it changed is ODbL.

## Why

The app's measurement (Nov 9): of 369 plausible destinations in six US towns, 84 became places to find; 172 of the
misses carry a heritage listing (155 National Register, 15 Landmarks), and the pack took only Landmarks. A draft of this
rule on that sample let in 59 public-type listings (chapels, mills, cemeteries, stations), kept out 36 houses and 30
districts, and needed a sign of being open for public places Wikidata types only as "house" or "building" (Trout Hall,
Burnside Plantation).

## Vision

The app's gate (0109), carried: aligned if reshaped. A listing is a gate on what a place is, never a measure or a label;
OpenStreetMap corroborates; nothing about a listing is stored in a pack or shown. Criteria RD1-RD14 carry it.

## Decisions (the owner's calls)

- Nov 9 (0109): remarkable is a heritage listing (the National Register counts); public is reachable from public ground.
- Nov 9 (0110): a private house that is a Landmark enters; OpenStreetMap only corroborates, joined by `wikidata`.
- Nov 9 (0111): sites, battlefields and wrecks are Monuments (class `historic_site`).
- Nov 10: OSM's signals now, and accept ODbL ("Include OSM now, accept ODbL"): a pack OpenStreetMap changed is ODbL
  (this repo's rule since PP9's deferral).

## Criteria

The Wikidata adapter (the app's RP1-RP8, RP10 and its audit 1, 10, 12, 13):

1. **RD1 Listed and public by type.** A National Register item whose type is in a pinned public group enters: places of
   worship (`church`), cemeteries (`cemetery`), theatres and opera houses (`theatre`), and civic buildings, libraries,
   stations, bridges, dams, locks, aqueducts, mills, factories, breweries, furnaces, lighthouses, water towers, forts,
   fountains (`building_structure`). The groups are pinned with their subclasses by `scripts/pin-types.mjs`, never
   looked up at build time.
2. **RD2 A home is never public by type.** A class reached from a house, residential building, single-family home or
   apartment building is taken out of every public group; another mundane class (an office, a school, a hotel) stays
   public when a public root reaches it (a courthouse is an office building to Wikidata).
3. **RD3 A Landmark enters**, whatever its type, a private house included.
4. **RD4 Districts never**, a Landmark included, whatever else the item is typed.
5. **RD5 Only standing listings.** A listing with an end time (P582) is no listing. A cut-off answer is a split cell,
   never a crashed run.
6. **RD6 Kinds by type.** Museums (`museum`) and sites, battlefields and wrecks (`historic_site`) take their own class;
   the classes of 0103 come first in their order, so a listing never changes a class 0103 gave.

OpenStreetMap (the app's RP2, RP5, RP7 and audit 2, 4, 11):

7. **RD7 An OSM adapter that confirms.** Its declaration: role `confirms`, ODbL, "© OpenStreetMap contributors", its
   host, its pace, terms checked. It reads only elements carrying a `wikidata` tag and emits confirming candidates
   whose `sameAs` is that id (`wikidata=Q1;Q2` speaks for both). It never makes a place. **PP7 is amended:** a
   confirming source may also say a place is open or closed, which decides whether a `needsOpen` place enters and
   keeps a closed one out. `open` and `closed` are each true when any confirming element says so, and `closed` wins:
   one, two or five elements saying `open` give identical blocks; nothing counts them (steward 1).
8. **RD8 Shown open.** A listed item of no public type, not a Landmark and of no Wikidata museum or historic-site type
   enters only when an OSM element carrying its id has `tourism=museum|attraction|gallery`,
   `historic=monument|memorial|castle|ruins|fort|archaeological_site` or
   `amenity=place_of_worship|theatre|arts_centre|library|townhall|courthouse`. `historic=building` is no sign.
9. **RD9 Closed.** An item whose OSM element is `access=private` or `access=no` never enters, a Landmark included.
10. **RD10 Gone.** Only `demolished:*`, `razed:*` and `destroyed:*` say a place is gone; `was:*` is a former use.
11. **RD11 A pack OpenStreetMap changed is ODbL.** When the OSM adapter's signals changed any place of a region, the
    region's pack is of the license family `odbl`: one pack, the region keeping its id (`us`), so the app reads one
    file; the manifest and `contract/sources.json` say so, and the attribution names OpenStreetMap. The family is
    decided by the OSM signals that reached the gate, so a region where OSM only closed or removed places is ODbL too
    (steward 3). A region's id can change license between versions; the manifest's `license` says which (steward 4).

The owner's review and the contract:

12. **RD12 The owner's review.** For named test areas, the run's report lists every place added with its class and why
    it entered (public type, shown open, Landmark), and a summary per class and reason for the region. The reason is
    worked out for the report from the candidates; no place or registry field holds it (steward 5). The report is a
    workflow artifact, never part of a release, the archive, the manifest or the state pre-release.
13. **RD13 Contract v2.** `church`, `cemetery`, `theatre`, `museum` and `historic_site` join the class names, and
    `heritage_building` becomes `building_structure`: no class name holds a register's name or a word for significance
    (heritage, listed, landmark, notable), the data side's RP18 (steward 2). `CONTRACT_VERSION` is 2; `npm run
    contract` regenerates `contract/`. The app takes the copy and maps them (the app's RP9).
14. **RD14 Still no score.** The new signals (`listed`, `needsOpen`, `open`, `closed`) are booleans; every object stays
    closed (PP5); a pack's feature keeps name, class, src and id (PP9).

## Steward (Nov 10) and triage

1. A confirming source now admits and removes places, and PP7 was not amended; disagreeing elements could become a vote:
   accepted, RD7 amends PP7 and makes `open`/`closed` ORs with `closed` winning, tested.
2. `heritage_building` stores the listing in the published contract: accepted, renamed `building_structure` in v2, and
   no class name may name significance (RD13).
3. A region OSM only subtracted from would ship CC0: accepted, the family comes from the signals that reached the gate
   (RD11).
4. The README says an ODbL archive has a pack of its own: accepted, the README's Licences and Published sections and
   `package.ts`'s header change (plan).
5. The report's reason must not land in the published registry: accepted (RD12).
6. Credit wherever a place is named: noted, nothing new owed while the map's credits name OpenStreetMap.

## Record (Nov 10)

- **Built:** RD1-RD14, each by its test in `test/remarkable.test.ts`, the todos committed first (`8bb0d2d`; RD3 held
  already, as a guard). PP1-PP16 and the carried PW tests pass (39 of 39).
- **Re-pinned on purpose:** PW6 and PP6 (`heritage_building` is `building_structure`; PP6's six places are the same
  places, checked before re-freezing), PW14 (`listed` on each item), PP15 (OSM's filtered answers are in the saved
  state, as ODbL allows), the contract (v2: `npm run contract`).
- **The pack's license** travels as `places-<region>-<version>.license`, uploaded with the release and read into the
  manifest's `license` by `scripts/manifest.mjs`; `decide` publishes a region whose license changed even if no block
  did.
- **Never run here:** the OSM adapter's fetch (Geofabrik and osmium aren't reachable or installed in the session that
  built it): `osmium tags-filter` in two passes and `osmium export -f geojsonseq` run for the first time in the weekly
  build; `adapt` is tested on the GeoJSON lines that export writes.
- **The app's side** (the app repo): contract v2 copied, `ARCHIVE_CLASSES` with the five classes and
  `building_structure`, RP9's test back.
- **Deferred:** the atlas History step per test area; registers outside the US; places only OpenStreetMap knows (the
  out-of-town slice, 0115, with its own locating adapter reusing `filterExtracts`).
