# Remarkable and public, the data side: the plan

For the owner to read before any code. Spec: `docs/remarkable-and-public/spec.md` (RD1-RD14). The code to port is the
app's, at its commit `5a9a2bc` (`specs/remarkable-and-public/handoff.md` there).

## Files

The Wikidata adapter (`src/adapters/wikidata/`):

- `classify.mjs`: `listing(item)` and `classify(item)` from the app's port: the district first (RD4), 0103's ORDER
  (RD6), then the listing by type (`church`, `cemetery`, `theatre`, `museum`, public, `site`), Landmarks (RD3), and
  otherwise a listed item that needs a sign of being open (RD8). An item needing one gets the class it would take and
  the signal `needsOpen`; the gate drops it unless a confirming source said `open`.
- `public-types.json` and `scripts/pin-types.mjs` (new, from the app): the pinned groups with subclasses; only homes
  are taken out of the public groups (RD1, RD2).
- `query.ts`: listings without an end time (`p:P1435` / `ps:P1435` / no `pq:P582`), `listed` on each item, and
  `parseAnswer` (a cut-off answer is a split, RD5).
- `index.ts`: candidates carry `signals.listed` and `signals.needsOpen`.

The OSM adapter (new, `src/adapters/osm/`):

- `index.ts`: the declaration (role `confirms`, `ODbL 1.0`, family `odbl`, "© OpenStreetMap contributors", host
  `download.geofabrik.de`, terms checked); `fetch` downloads the US sub-region extracts from Geofabrik one at a time
  (northeast, midwest, south, west), filters each with `osmium tags-filter` to elements with a `wikidata` tag and any of
  `tourism`, `historic`, `amenity`, `access`, `demolished:*`, `razed:*`, `destroyed:*`, exports them as GeoJSON lines
  (`osmium export`), writes that to the raw store and deletes the extract. `adapt` emits one confirming candidate per
  Wikidata id an element carries (`sameAs: wikidata:Q…`), with `signals.open`, `closed` and `gone` (RD7-RD10).
- The public Overpass servers refuse cloud runners (the app's DEFERRED), so the extracts are Geofabrik's; the weekly
  workflow installs `osmium-tool` with apt. The extracts are 2-5 GB each; one at a time fits the runner's disk.

The pipeline:

- `schema.ts`: `signals` gains `listed`, `needsOpen`, `open`, `closed` (booleans; RD14); `PlaceSchema` gains
  `needsOpen`, `open`, `closed` (booleans); the feature is unchanged.
- `conflate.ts`: a confirming candidate may also set `open` or `closed` on the place it confirms (it still never makes
  one, and nothing counts confirmations: `open` and `closed` are ORs, `closed` wins; PP7 amended in `docs/spec.md`).
  It records, per region, whether any ODbL source's signal reached the gate, and that decides the pack's family
  (RD11), not the surviving places' licenses.
- `gate.ts`: a place enters with a class, not gone, not `closed`, and, when it `needsOpen`, only if `open` (RD8, RD9).
  It still reads no source name and no count.
- `package.ts`: a region's pack is one license family: when any place is `odbl`, the whole region's pack is `odbl`
  and keeps the region's id (RD11; PP9's one-family rule holds, the CC0 places inside an ODbL database).
- `runner.ts`, `cli.ts`: the run's report gains `added` (per `--review-areas` test area: name, class, reason) and a
  per-class, per-reason summary; the reason is worked out from the candidates for the report, never stored on a place or
  in the registry; it stays out of the release and the state pre-release (RD12).
- `classes.ts`: the five classes, `heritage_building` renamed `building_structure`, `CONTRACT_VERSION` 2; `npm run
  contract` (RD13). The 0103 Landmark fallback takes the new name too.
- `README.md` (Licences, Published) and `package.ts`'s header: one pack per region, its license family in the manifest,
  ODbL when OpenStreetMap changed it (steward 4). `contract/sources.json` lists OSM
  with its license and attribution.
- `.github/workflows/weekly-build.yml`: install `osmium-tool`; run with the OSM adapter; keep the report as a workflow
  artifact only.
- `scripts/manifest.mjs`: the region's `license` in the manifest (`odbl`), read from the pack's sidecar.

The app (its repo, after this merges):

- Take contract v2 into `src/lib/__tests__/explore/contract/`; `ARCHIVE_CLASSES` gains the five classes (History /
  Places of worship, History / Cemeteries, Culture / Theatres, Culture / Museums and galleries, History / Monuments and
  ruins) and maps `building_structure` (History / Buildings and structures) in place of `heritage_building`; RP9's test
  returns; PP17 pins v2.
- The map's credits already name OpenStreetMap (PW15); nothing new on screen.

## Data

- The ID registry and raw store carry over; OSM's raw answers are stored (ODbL allows it, with attribution).
- The first build after this changes most US blocks (listings arrive), so every client rebuilds those areas once
  (PP13).

## Tests, per criterion

`test/remarkable.test.ts` (new), fixtures under `test/fixtures/remarkable/`: Wikidata bindings for the app's sample
items (a church, a cemetery, a road bridge, a gristmill, a station; a house, a school, an office, a bank, a hotel, a
bare building; a Landmark house; a district; an ended listing; a house museum; a site) and OSM GeoJSON lines (a museum
tag, `access=private`, `historic=building`, `was:railway`, `demolished:building`, `wikidata=Q1;Q2`).

| Id | Test |
|---|---|
| RD1 | RD1: a listed church, cemetery, bridge, mill and station enter by type |
| RD2 | RD2: a home is never public by type; a courthouse stays public |
| RD3 | RD3: a Landmark enters whatever its type, a private house too |
| RD4 | RD4: a district never enters, also typed ghost town or monument |
| RD5 | RD5: an ended listing is none; a cut-off answer splits the cell |
| RD6 | RD6: museums and sites take their own class; 0103's classes keep theirs |
| RD7 | RD7: the OSM adapter confirms by wikidata tag only, never makes a place; one, two or five open elements give identical blocks, and closed wins |
| RD8 | RD8: a listed house enters only shown open (a museum type or an OSM visitor tag); historic=building is no sign |
| RD9 | RD9: access=private or no keeps a place out, a Landmark too |
| RD10 | RD10: was:* keeps a place; demolished:, razed:, destroyed: remove it |
| RD11 | RD11: a region OSM changed packs as one ODbL file under the region's id; one where OSM only closed a place too |
| RD12 | RD12: the report lists each added place with its reason per test area, and is not in the release |
| RD13 | RD13: contract v2 has the five classes and building_structure, no class name names significance, and it is the code's |
| RD14 | RD14: the new signals are booleans and every object stays closed |

PP1-PP16 and the carried PW tests keep passing; `expected-places.json` (PP6) is re-frozen deliberately, since the gate
now admits listings.

## Deferred, and why

- The atlas History step before and after per test area (the build reads no map tiles).
- Registers outside the US.
- Places only OpenStreetMap knows (the owner's call, 0110: corroborate only).
- The first real OSM fetch: Geofabrik is unreachable from the session that builds this, so RD7's fetch is tested with a
  stubbed download and runs for real in the first weekly build.

## Native

None in this repo.
