<!-- Fixtures pack. The data side of the app's town fixtures (specs/town-fixtures, TF1, TF2, TF4, TF5, TF14, TF19, TF21,
     TF25-TF27; its G13 slice). Rules kept: the app's decisions 0103, 0108, 0225 and 0255. -->

# Fixtures pack: what every town has, as its own layer (FX)

Nov 26, 2026

A third pack, beside places and stores: one record per town fixture (a tourist office, a town hall, a library, a post
office, a square, a market, a station...), each with its kind, its position and its name where it has one, and nothing a
crowd says. The app reads it to know ahead of time what a town has; a fixture is never a find, so no fixture reaches the
places pack, its gate or its conflate, and none reaches the stores.

## Vision

```
Idea: a fixtures layer from OpenStreetMap's own tags for a town's staples, a closed list of kinds approved by the owner, its own pack
Verb: earn (knowing ahead where a town's tourist office and middle are), through the app's screens that follow
Touches: Never "Tallies", "Scores, levels, completion" (nothing counts fixtures: no count in the record, the pack, the
  manifest or the report); 0103 (a gate of kinds, never a measure: the closed list); 0108 (this repo owns the pipeline and
  the contract; phones never call a source); 0225 (a fixture is a stop, never a find); 0255 (OpenStreetMap first; a
  visitor centre is the town's tourist office, `information=office`, never an attraction's)
Verdict: no surface (this pack); the app's screens keep 0225's gate
Criteria: FX1-FX12
```

## Decisions kept

- **A fixture is neither a place nor a store.** Its own schema, pack file, registry of opaque ids (`f_`) and manifest key;
  the places and stores schemas, gates, conflate and packs are untouched (their bytes and tests included).
- **The kinds are the owner's** (Nov 25, decision 0255): thirteen tags, closed, below. Out: the practical amenities
  (toilets, parking, drinking water, benches, banks and cash machines, fuel, pharmacies, supermarkets, bus stops, taxis,
  post boxes, information boards, guideposts and maps, the settlements themselves) and the arguables recommended out
  (places of worship, parks, cemeteries, memorials, schools, emergency services, museums, theatres and cinemas, clocks,
  water towers, tram stops and halts, hospitals); `information=visitor_centre` is out (an attraction's, a place to
  discover).
- **OpenStreetMap first.** Every kind from the same Geofabrik extracts the places and stores already read, in the same
  pass. Folding Overture and Wikidata in where they are strong (0255) waits (see "Deferred").
- **Adding the pack moves nothing else.** The week the fixtures filter is first asked, the other filters' answers are
  carried as they were, so the places and stores packs are built from the same answers as before (FX10).

## The kinds

| Kind | OpenStreetMap tag |
|---|---|
| `tourist_office` | `information=office` |
| `town_hall` | `amenity=townhall` |
| `library` | `amenity=library` |
| `post_office` | `amenity=post_office` |
| `square` | `place=square` |
| `market` | `amenity=marketplace` |
| `station` | `railway=station` |
| `bus_station` | `amenity=bus_station` |
| `courthouse` | `amenity=courthouse` |
| `community_centre` | `amenity=community_centre` |
| `ferry_terminal` | `amenity=ferry_terminal` |
| `common` | `leisure=common` |
| `bandstand` | `leisure=bandstand` |

## The record, and its tile encoding

`{ id, kind, at: [lon, lat], name?, src }` and nothing else. In the pack a feature carries flat string properties `kind`,
`id`, `src` and `name` (left out when it has none); layer `fixtures`, zoom 12 like the places pack.

## Criteria

1. **FX1 The fixture record is closed.** A fixture holds exactly an opaque id (`f_` and 16 hex), a kind, a position, a src
   and, where it has one, a name. Every other field fails the schema, at any depth: `rating`, `reviews`, `visits`,
   `popularity`, `count`, `hours`, `wikidata`, and any unknown one. The only numbers are the two of the position. The JSON
   Schema export is closed at every object.
2. **FX2 The kinds are a closed list.** Exactly the thirteen kinds above, each from its one tag, in that order. A kind
   outside the list fails the schema. `information=visitor_centre`, and `tourism=information` without
   `information=office`, are no tourist office. The contract lists each kind with its tag, and says a client ignores a
   kind it does not know.
3. **FX3 No practical amenity is a fixture.** The osmium filter asks for the thirteen tags and nothing else; an element of
   any other kind (`amenity=toilets`, `amenity=parking`, `amenity=drinking_water`, `amenity=bench`, `amenity=atm`,
   `amenity=place_of_worship`, `leisure=park`, `tourism=museum`, `highway=bus_stop`, `railway=halt`, `railway=tram_stop`,
   `information=board`...) yields nothing, named or not.
4. **FX4 The adapter maps tags to kinds.** From recorded OSM elements (node, way, relation): one candidate per kind an
   element carries; a name where it has one (an unnamed square is a square); one representative position; an element whose
   `access` is `private` or `no` is dropped. Output is the same whatever the order of lines.
5. **FX5 No crowd field is read.** The adapter reads only the element's type and id, `name`, `access`, `wikidata` (to keep
   one fixture once, never emitted) and the keys of the kinds. A fixture carrying `rating`, `stars`, `reviews`,
   `popularity`, `opening_hours`, `wikipedia` or `website` yields the same record as without them.
6. **FX6 One fixture is kept once.** Two candidates of one kind are one fixture when they name the same Wikidata item,
   when they have the same name (letter case, spaces and punctuation aside) within 250 m, or when one has no name and they
   are within 50 m: a library mapped as its building and as a point inside it is one library. The one kept is the one with
   a name, then with a Wikidata item, then a way before a relation before a node, then the lower id; the result is the
   same whatever the order of lines. Two of different kinds at one place are two fixtures.
7. **FX7 Fixtures never reach the places or the stores.** With fixture elements in the OSM raw store, the places packs
   (their bytes and blocks), the registry and the report's places, and the stores pack, are identical to a build without
   them; the OSM places adapter's `adapt` yields nothing from a fixtures part; `gate.ts`, `conflate.ts`, `package.ts`,
   `runner.ts` and `stores/` import nothing of `fixtures/`.
8. **FX8 The fixtures pack and the manifest.** The fixtures are written to `fixtures-<region>-<version>.pmtiles` through
   the archive writer (layer `fixtures`, the same bytes for the same fixtures in any order), with a hash per z8 block. The
   manifest lists a region's `fixtures` (`current`, `previous`) beside `current` and `stores`; a manifest built with no
   fixtures packs is byte for byte the one built before.
9. **FX9 Published for the app.** `contract/fixtures.schema.json` holds the record, the feature, the kinds with their tags
   and what a client does with an unknown kind; `contract/example/` holds `fixtures-example-<version>.pmtiles` and
   `fixtures-example.json`, built from fixtures; `npm run contract` regenerates them with CONTRACT_VERSION 9, and the
   contract test fails when they drift.
10. **FX10 One download a week, and a new filter moves nothing else.** The fixtures' osmium filter runs in the same pass
    as the others (`filterExtracts`); no adapter adds a host or a download. A filter the held copy lacks (or holds under
    another fingerprint, its note `filter:<name>`) is filled from the extract's download while the parts of the filters
    the held copy already has are carried as they were, with its ETag, its date and its counts; the next week the extract
    is asked for as usual. The OSM fetch fingerprint of the other filters is unchanged, so the run that first fills the
    fixtures builds the places and stores from the same answers as the run before it.
11. **FX11 Published only when a block changed.** `decideFixtures` reads the live manifest's `fixtures.current.blocks`: no
    change publishes nothing, a changed block publishes, no `fixtures` yet publishes; an unreachable manifest publishes
    nothing. The build saves the fixtures' registry in the state; the Pages workflow keeps and serves `fixtures-*` files,
    its newest releases chosen for each kind apart.
12. **FX12 Nothing counts fixtures.** The record, the tile feature, the manifest entry and the run's report hold no count
    of fixtures (the report says only why the pack was or was not built, and what was set aside, by name).

## Not run here

A real Geofabrik extract, the weekly, manual and Pages workflows and a live publish: the tests run on fixtures, the fake
`http` and, where installed, a real osmium over a small `.osm` file. The workflow edits are read, not executed, until the
manual build the owner authorised (Nov 26).

## Deferred

- **Overture folded in** (town halls and libraries, where the app's own measure found it mostly right): it needs a new host
  for this repo's build (Overture's bucket) and a GeoParquet reader, a new dependency. The owner's call.
- **Wikidata folded in** (public libraries): its only fetch is the places' own; asking it for libraries changes its
  fingerprint and its answers, and the places pack with them, the week it is added. Its kept answers hold civic buildings
  only when listed, often a former use. A later slice, with its own fetch that moves nothing else (as FX10 does for OSM).
- **A town's "main" station**: every `railway=station` is a station here (subway stations included); which one is a
  town's is the app's screens' question (TF15).
- **A fixture's town**: fixtures are not assigned to a town in the pack; the app reads them against a town's outline.
- **The kinds that are also finds** (TF3): `leisure=bandstand` is also a small place (`carousel`), and town halls,
  libraries and courthouses can enter the places pack by a listing; the app's TF3 slice settles which list keeps them.
</content>
</invoke>
