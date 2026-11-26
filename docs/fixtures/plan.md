# Plan: the fixtures pack (FX1-FX14)

Spec: `docs/fixtures/spec.md`. The app's side: `specs/town-fixtures/spec.md` (TF1, TF2, TF4, TF5, TF14, TF19, TF21,
TF25-TF27) and its `plan.md`. The model is the stores pack (`docs/stores/`), file for file.

## The shape

```
src/fixtures/
  kinds.ts      KINDS: the thirteen {kind, key, value}, in the owner's order; FIXTURE_FILTER derived from it (FX2, FX3, FX10)
  schema.ts     FixtureSchema, FixtureCandidateSchema, FeatureSchema, fixturesJsonSchema() (FX1, FX2, FX9)
  osm.ts        READS, kindsOf(tags) with FX14's heritage stations out, adaptFixtures(raw, fetchedAt) (FX3, FX4, FX5, FX14)
  wikidata.ts   LIBRARY_QUERY, fetchKey, fetchLibraries(store, http, clock, ...), adaptLibraries(raw) (FX5, FX13)
  merge.ts      mergeFixtures(osm, wikidata): one fixture once, OSM first, a grid index, a fixed preference (FX6)
  package.ts    packFixtures: the pack through archive.mjs, block hashes (FX8)
  build.ts      buildFixtures(raw store, run, registry, newId): reads fixtures-* parts of the osm source (FX7)
src/adapters/osm/index.ts   fetch passes FIXTURE_FILTER as a filter keyed by its own note; adapt skips fixtures-* parts (FX7, FX10)
src/adapters/osm/extract.ts planPart(): what one extract's fetch does (ask, carry, fill), pure; filterExtracts follows it (FX10)
src/publish.ts      decideFixtures (FX11)
src/cli.ts          after the stores: Wikidata's libraries fetched when FX13 says, buildFixtures, decideFixtures, files written
                    as the stores' are (odbl), its registry; `state-sources` gains `wikidata-fixtures`
scripts/manifest.mjs  fixtures-<region>-<version>.pmtiles listed as region.fixtures {current, previous} (FX8)
src/contract.ts     fixtures.schema.json, the example pack and fixtures-example.json, the manifest schema's `fixtures` (FX9)
src/classes.ts      CONTRACT_VERSION 9 (places classes unchanged)
.github/workflows/build.yml   saves registry-fixtures-us.json in the state (FX11)
.github/workflows/pages.yml   keeps the newest releases per kind for fixtures too, and downloads fixtures-* (FX11)
.github/workflows/manual-build.yml  the OSM box says it fetches the fixtures too (words only)
README.md           the fixtures pack in "What's published" and the contract list
```

- **Raw parts** `fixtures-<part>.geojsonl` of source `osm`, from the one pass per extract (FX10).
- **Ids**: registry `registry-fixtures-<region>.json` through `createIds` with the pattern `^f_[0-9a-f]{16}$`, keyed
  `osm:<type>/<id>#<kind>` or `wd:<Q>#library`; kept in the state asset.
- **Wikidata's libraries (FX13)**: raw source `wikidata-fixtures`, one part `libraries-us.json` per run, its run's note
  `fetchKey` the fingerprint of the endpoint and the query. Fetched through `politeFetch` with the places' Wikidata
  declaration (same host, pace and user agent); not an adapter, so `ADAPTERS`, `sources.json`'s sources, the places'
  fingerprints and the manual build's boxes are main's.
- **Tile properties**: `kind`, `id`, `src`, and `name` when it has one.
- **The fill (FX10; the app's T66).** `planPart({ sameFetch, prev, counted, base, added, part })` returns `{ mode: 'ask' |
  'fill' | 'whole', run: Filter[], carry: string[] }`. Base filters (confirm, small, shops) are held as today (RB5: the
  same fingerprint and every base part held). An added filter (fixtures) is held when its part is held and the note
  `filter:fixtures` equals its fingerprint. All held (`ask`): the conditional request, a 304 carries everything (as
  today). The base held and an added one not (`fill`): the same conditional request first (T66, Nov 26). A 304: one
  unconditional download, only the unheld added filters (`run`) run on it, the rest (`carry`) carried, and the held
  copy's `etag:`, `modified:`, `tagCounts:` and `shopCounts:` notes kept, so next week's request is conditional on the
  copy the carried parts came from; the download is made before anything is carried, so a refused one throws and the
  source keeps its last good answers. A 200: every filter runs on that one download, its ETag, date and counts kept, as
  any downloaded week. Otherwise (`whole`): everything, as today. The OSM `fetchKey` stays the fingerprint of the base
  filters, byte for byte, so the held copy of run 40 (Nov 23) is held.
- **The merge (FX6)**: per kind, a grid of about 250 m cells; a candidate joins a kept fixture in its cell or the eight
  around it by Wikidata item, by normalised name within 250 m, or unnamed within 50 m; OSM's candidates are taken first, in
  the preference order, then Wikidata's libraries (an OSM element's `wikidata` tag first, then name and distance), so the
  kept one is OSM's and the result does not depend on the input's order. O(n) cells, n about 110,000 for the US.

## Tests (`test/fixtures.test.ts`, one per id, todo first)

Each steward finding of the plan review is named in its test too: town-fixtures audit 1 (FX13: both sources in the pack),
2 (FX13: libraries only, exact P31, gone items), 3 (FX6: OSM preferred), 4 (FX7: the places and stores do not move), 5
(FX5: Wikidata's crowd fields), 6 (FX14: heritage stations).

FX1 closed schema, extra fields at depth, JSON Schema walk; FX2 the kinds and tags, visitor centre and a bare
`tourism=information` give none, unknown kind fails; FX3 the filter's expressions are the thirteen tags exactly, and
elements of twenty other kinds give nothing; FX4 the fixture file's mapping, unnamed square, access drops, two kinds on one
element, order-free; FX5 poisoned tags give the same record, READS and the filter hold no crowd key; FX6 building and
point one library, same name 200 m apart one, 300 m apart two, unnamed 40 m one, two kinds at one point two, shuffled
input the same; FX7 places and stores identical with and without a fixtures part (bytes, blocks, registry, report), adapt
yields nothing, the import grep; FX8 pack read back with the pmtiles reader, order-free bytes, places pack bytes unchanged,
manifest with and without fixtures (byte for byte the old one without); FX9 contract files and version; FX10 `planPart`
over every case, and with osmium installed a real `filterExtracts` over a small `.osm`: the held run's base parts carried
byte for byte, the fixtures part written, the notes kept (the held copy's 304, then one download); and through audit 11's
seam, no osmium (the app's T66): a fill's 304 carries every held answer and fills the fixtures from one unconditional
download, a refused download after it carrying and noting nothing; a fill's 200 runs every filter on its one download, with
its ETag, date and counts; each way's log line word for word (tend fixtures audit 1); FX11 decideFixtures, no pack without OSM's fixtures, the workflows' text; FX12 no count
key in the schema, the feature, the manifest entry or the report; FX13 the query's text (exact P31, no `P279`, no listing,
no sitelinks), a fake answer's rows (dissolved, closed, unlabelled, duplicated), when it is fetched (weekly, Wikidata
fetched, stale, not stale), a failure keeping the last; FX14 the four heritage signals and a subway station.

A differential beside the tests (the app's review asks for it, kept outside the repo): the places and stores outputs over
the same fixture input from main's code and this branch's, every difference printed.

## The build the owner authorised (Nov 26)

1. **The push to `main`** runs the weekly workflow's push path: its plan names no stale adapter (OSM is fetched only weekly
   and by hand; Wikidata's places fingerprint is main's), so it fetches no adapter and builds places and stores from run
   40's answers: "unchanged", not published. Wikidata's libraries are stale (none kept), so they are fetched (one query
   to the places' host) and kept in the state. No fixtures pack: run 40's OSM answers hold no fixtures (FX11).
2. **One "Manual places build"**, `osm: true`, `wikidata: false`: each extract is a fill, asked for against run 40's
   copy first (FX10, as T66 reshaped it on Nov 26). An extract unchanged since (304) is downloaded once and only the
   fixtures filter runs on it (its log: "fixtures filled"), its places' and stores' answers run 40's. One that changed
   (200; Geofabrik renews its extracts daily, so the likely answer for each) logs "downloaded, changed since the held
   copy: every filter runs": its places and stores take the edits since Nov 23 and are published if a block changed, as
   a weekly run would. The libraries are the push's (or fetched again if the push could not keep them). It publishes
   the first fixtures pack, holding both sources ("new region").
3. **The tripwire**: an extract whose log says neither "fixtures filled" nor "changed since the held copy" (asked for
   whole: run 40's copy was not held), or, with every extract "fixtures filled", the places pack differing from main's
   build over the same answers or the stores pack published: the run is cancelled before it publishes, if it can be,
   and reported.

## Not run here

A real extract, the workflows, a publish (until the build above).
</content>
</invoke>
