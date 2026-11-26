# Plan: the fixtures pack (FX1-FX12)

Spec: `docs/fixtures/spec.md`. The app's side: `specs/town-fixtures/spec.md` (TF1, TF2, TF4, TF5, TF14, TF19, TF21,
TF25-TF27) and its `plan.md`. The model is the stores pack (`docs/stores/`), file for file.

## The shape

```
src/fixtures/
  kinds.ts      KINDS: the thirteen {kind, key, value}, in the owner's order; FIXTURE_FILTER derived from it (FX2, FX3, FX10)
  schema.ts     FixtureSchema, FixtureCandidateSchema, FeatureSchema, fixturesJsonSchema() (FX1, FX2, FX9)
  osm.ts        READS, kindsOf(tags), adaptFixtures(raw, fetchedAt) (FX3, FX4, FX5)
  merge.ts      mergeFixtures(candidates): one fixture once, a grid index, a fixed preference (FX6)
  package.ts    packFixtures: the pack through archive.mjs, block hashes (FX8)
  build.ts      buildFixtures(raw store, run, registry, newId): reads fixtures-* parts of the osm source (FX7)
src/adapters/osm/index.ts   fetch passes FIXTURE_FILTER as a filter keyed by its own note; adapt skips fixtures-* parts (FX7, FX10)
src/adapters/osm/extract.ts planPart(): what one extract's fetch does (ask, carry, fill), pure; filterExtracts follows it (FX10)
src/publish.ts      decideFixtures (FX11)
src/cli.ts          after the stores: buildFixtures, decideFixtures, files written as the stores' are (odbl), its registry
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
  `osm:<type>/<id>#<kind>`; kept in the state asset.
- **Tile properties**: `kind`, `id`, `src`, and `name` when it has one.
- **The fill (FX10).** `planPart({ sameFetch, previous, counted, base, added, part })` returns `{ ask: headers | null, run:
  Filter[], carry: string[], keepNotes: boolean }`. Base filters (confirm, small, shops) are held as today (RB5: the same
  fingerprint and every base part held). An added filter (fixtures) is held when its part is held and the note
  `filter:fixtures` equals its fingerprint. All held: the conditional request, a 304 carries everything (as today). The
  base held and an added one not: an unconditional download, only the unheld added filters run on it, the rest carried,
  and the held copy's `etag:`, `modified:`, `tagCounts:` and `shopCounts:` notes kept, so next week's request is
  conditional on the copy the carried parts came from. Otherwise: everything, as today. The OSM `fetchKey` stays the
  fingerprint of the base filters, byte for byte, so the held copy of run 40 (Nov 23) is held.
- **The merge (FX6)**: per kind, a grid of about 250 m cells; a candidate joins a kept fixture in its cell or the eight
  around it by Wikidata item, by normalised name within 250 m, or unnamed within 50 m; candidates are taken in the
  preference order first, so the kept one is the first and the result does not depend on the input's order. O(n) cells,
  n about 100,000 for the US.

## Tests (`test/fixtures.test.ts`, one per id, todo first)

FX1 closed schema, extra fields at depth, JSON Schema walk; FX2 the kinds and tags, visitor centre and a bare
`tourism=information` give none, unknown kind fails; FX3 the filter's expressions are the thirteen tags exactly, and
elements of twenty other kinds give nothing; FX4 the fixture file's mapping, unnamed square, access drops, two kinds on one
element, order-free; FX5 poisoned tags give the same record, READS and the filter hold no crowd key; FX6 building and
point one library, same name 200 m apart one, 300 m apart two, unnamed 40 m one, two kinds at one point two, shuffled
input the same; FX7 places and stores identical with and without a fixtures part (bytes, blocks, registry, report), adapt
yields nothing, the import grep; FX8 pack read back with the pmtiles reader, order-free bytes, places pack bytes unchanged,
manifest with and without fixtures (byte for byte the old one without); FX9 contract files and version; FX10 `planPart`
over every case, and with osmium installed a real `filterExtracts` over a small `.osm`: the held run's base parts carried
byte for byte, the fixtures part written, the notes kept; FX11 decideFixtures and the workflows' text; FX12 no count key
in the schema, the feature, the manifest entry or the report.

A differential beside the tests (the app's review asks for it, kept outside the repo): the places and stores outputs over
the same fixture input from main's code and this branch's, every difference printed.

## The build the owner authorised (Nov 26)

After this lands on `main` (its push rebuilds from kept answers and fetches nothing: OSM is weekly, Wikidata's fingerprint
is unchanged), one "Manual places build" with `osm: true`, `wikidata: false`: the extracts are downloaded, only the
fixtures filter runs (FX10), the places and stores are built from the same answers as run 40 and are not published
("unchanged"), and the fixtures pack is published ("new region"). If the plan step or the log shows anything else
(OSM asked whole, places or stores published), the run is cancelled and reported.

## Not run here

A real extract, the workflows, a publish (until the build above).
</content>
</invoke>
