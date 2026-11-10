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
   fountains (`heritage_building`). The groups are pinned with their subclasses by `scripts/pin-types.mjs`, never
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
   whose `sameAs` is that id (`wikidata=Q1;Q2` speaks for both). It never makes a place.
8. **RD8 Shown open.** A listed item of no public type, not a Landmark and of no Wikidata museum or historic-site type
   enters only when an OSM element carrying its id has `tourism=museum|attraction|gallery`,
   `historic=monument|memorial|castle|ruins|fort|archaeological_site` or
   `amenity=place_of_worship|theatre|arts_centre|library|townhall|courthouse`. `historic=building` is no sign.
9. **RD9 Closed.** An item whose OSM element is `access=private` or `access=no` never enters, a Landmark included.
10. **RD10 Gone.** Only `demolished:*`, `razed:*` and `destroyed:*` say a place is gone; `was:*` is a former use.
11. **RD11 A pack OpenStreetMap changed is ODbL.** When the OSM adapter's signals changed any place of a region, the
    region's pack is of the license family `odbl`: one pack, the region keeping its id (`us`), so the app reads one
    file; the manifest and `contract/sources.json` say so, and the attribution names OpenStreetMap.

The owner's review and the contract:

12. **RD12 The owner's review.** For named test areas, the run's report lists every place added with its class and why
    it entered (public type, shown open, Landmark), and a summary per class and reason for the region. The report is
    never part of a release, the archive or the manifest.
13. **RD13 Contract v2.** `church`, `cemetery`, `theatre`, `museum` and `historic_site` join the class names;
    `CONTRACT_VERSION` is 2; `npm run contract` regenerates `contract/`. The app takes the copy and maps them (the
    app's RP9).
14. **RD14 Still no score.** The new signals (`listed`, `needsOpen`, `open`, `closed`) are booleans; every object stays
    closed (PP5); a pack's feature keeps name, class, src and id (PP9).

## Record

(Filled in as the slice is built.)
