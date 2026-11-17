# Subtypes, the data side (ST)

Nov 17, 2026 · the owner, from the app's Explore subtypes (the app's `specs/explore-subtypes`, decision 0187).

The archive's classes split by what a place is, so the app can give each kind its subtypes; new Wikidata types and an
extended OpenStreetMap table add the places the app could not show at all. Type decides, never a judgment (0103); a
class is resolved from the type, tag or name the build already reads, and nothing is fetched only to sort a place
(the app's 0117).

## Why

The second review of Nov 17 measured the live pack (`places-us-20261116.17`, 32,458 places): 9,725 listed buildings in
one class, 2,604 of 2,739 `ruin` places ghost towns, about 3,800 of 4,129 `marker` places named state historical markers,
740 lighthouses and 600 covered bridges inside `odd_engineering`, and no waterfall, garden, zoo, fountain or concert
hall at all. The owner: "be more inclusive than exclusive, and only truly discount things that are really
unremarkable".

## Vision

The app's gate (0187): aligned if reshaped. Subtypes filter what is shown and are never counted (PP5 holds: nothing in
the contract can hold a count, rank or score); a class comes from a type, tag or name; the truly unremarkable stays out.

## Decisions (the owner's calls, Nov 17)

- **OpenStreetMap locates more types** (over Wikidata only): fountains, water towers, windmills and watermills,
  lighthouses, cannons and locomotives, caves, waterfalls, hot springs and geysers, old trees, botanical gardens,
  war memorials, bandstands and carousels. This extends 0183's pinned table; for every other type OSM still confirms.
- **Ghost towns are their own class**, off by default in the app; true ruins keep `ruin`.
- **Historical markers and plaques are two classes**: Wikidata's commemorative plaques (named state markers) stay
  `marker`; OpenStreetMap's plaques become `plaque`. This supersedes the Nov 16 call "a marker is a marker whoever
  lists it".
- Defaults taken here, for the owner to overrule: an OpenStreetMap cave enters only with a name (an unnamed cave
  entrance is a hole in the ground); a garden from OpenStreetMap only as `garden:type=botanical`; Japanese and rose
  gardens only from Wikidata.

## Criteria

- **ST1** contract v4: the classes below, `CONTRACT_VERSION` 4, `sources.json`'s OSM `locates` extended, the classes
  that may come unnamed extended (ST6).

  | New class | Wikidata (P31, pinned) | Listed places by type root | OpenStreetMap (locates) |
  |---|---|---|---|
  | `fountain` | fountain Q483453 | fountain | `amenity=fountain`, never with `fountain=drinking\|bubbler\|bottle_refill` or `drinking_water=yes` |
  | `sign` | neon sign Q6006, ghost sign Q3410466, totem pole Q83809 | | |
  | `plaque` | | | `memorial=plaque\|blue_plaque` (was `marker`) |
  | `war_memorial` | war memorial Q575759 (from `memorial`) | | `memorial=war_memorial` |
  | `battlefield` | | battlefield | |
  | `archaeological_site` | petroglyph Q42195 | archaeological site | |
  | `bridge` | covered bridge Q1825472 (from `odd_engineering`) | bridge, viaduct, aqueduct | |
  | `mill` | watermill Q185187, windmill Q38720 | mill, watermill, gristmill | `man_made=windmill\|watermill` |
  | `station` | | railway station | |
  | `lighthouse` | lighthouse Q39715 (from `odd_engineering`) | lighthouse | `man_made=lighthouse` |
  | `civic_building` | | courthouse, town hall, city hall, post office, library | |
  | `fort` | armory Q1412205 | fort | |
  | `water_tower` | water tower Q274153 | water tower | `man_made=water_tower`, only named or tagged `historic`/`heritage` |
  | `clock_tower` | clock tower Q853854 | | |
  | `tavern` | | tavern Q154250, inn Q256020 (new roots) | |
  | `historic_machine` | museum ship Q575727 | | `historic=cannon\|locomotive\|railway_car\|aircraft\|tank` |
  | `mausoleum` | mausoleum Q162875, tomb Q381885 | | |
  | `garden` | botanical garden Q167346, arboretum Q272231, Japanese garden Q15835, rose garden Q291177 | | `leisure=garden` + `garden:type=botanical` |
  | `waterfall` | waterfall Q34038 | | `waterway=waterfall` |
  | `cave` | show cave Q2232001 | | `natural=cave_entrance`, named only |
  | `hot_spring` | hot spring Q177380, geyser Q83471 | | `natural=hot_spring\|geyser` |
  | `old_tree` | remarkable tree Q811534 | | `natural=tree` + `denotation=natural_monument` |
  | `concert_hall` | concert hall Q1060829, opera house Q153562 (from `theatre`'s root) | concert hall, opera house | |
  | `observatory` | observatory Q62832, planetarium Q148319 | | |
  | `carousel` | carousel Q208322, bandstand Q3126170 | | `attraction=carousel`, `leisure=bandstand` |
  | `zoo` | zoo Q43501, public aquarium Q2281788 | | |
  | `fire_tower` | fire lookout tower Q748998 (from `tower`) | | |
  | `ghost_town` | ghost town Q74047 (from `ruin`) | | |

  Existing classes widen: `statue` takes bust Q241045 and OSM `artwork_type=bust`; `mural` takes mosaic Q133067;
  `old_stone` takes Wikidata's milestone Q10145 (from `marks_a_fact`). `community_garden` takes Wikidata's community
  garden (pinned with the others).
- **ST2** a Wikidata item is classified by the first class in a fixed order whose list holds one of its types; the new
  classes sit in that order so a war memorial is `war_memorial` (never `memorial`), a covered bridge `bridge` (never
  `odd_engineering`), a ghost town `ghost_town` (never `ruin`), and a fire lookout tower `fire_tower` (never `tower`).
- **ST3** a listed place's class comes from its type's root, by a pinned table from root to class (`pin-types.mjs`
  re-pinned): a listed bridge is `bridge`, a listed courthouse `civic_building`; a listed building no root names stays
  `building_structure`, a listed site no root names stays `historic_site`. How a listed place enters (public by type,
  open, a Landmark) does not change (RD1-RD8).
- **ST4** the OSM table of ST1, pinned; any other tag is no place; `access=private|no` keeps a place out (SL3); an
  element whose `wikidata` tag names a place already made is that place (SL4).
- **ST5** a drinking fountain is never a `fountain`, however tagged with `amenity=fountain`.
- **ST6** the classes that may come unnamed: SL5's, and `fountain`, `plaque`, `war_memorial`, `mill`, `lighthouse`,
  `historic_machine`, `waterfall`, `hot_spring`, `old_tree`, `carousel` (never `water_tower`); any other unnamed place is
  set aside (PP4).
- **ST7** nothing truly unremarkable enters: a spring, a dam, a bench (other than a memorial bench), a give box or a
  shipwreck is no class; a mass-imported type with no listing (GNIS springs and dams) is never asked for.
- **ST8** the review report lists each review area's places of the new classes with their class (SL11), so the owner
  can strike types or places in `edits.json`.
- **ST10** no class name names significance: `old_tree`, never `notable_tree` or `remarkable_tree` (RP18, the app's
  0110; its steward S1).
- **ST9** the OSM fetch filter changes with the table, so its fingerprint changes (RB2); the next weekly or hand run
  fetches it (RB8: never a push).

## Not here

- Outside the US (the regions are the app's call).
- Splitting places of worship by tradition, house museums, or chapels and meeting houses (the review counted them;
  the owner has not asked).
- Overture's places of these types (0109).
