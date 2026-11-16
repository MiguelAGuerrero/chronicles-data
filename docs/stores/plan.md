# Plan: the stores pack (ST1-ST10)

Spec: `docs/stores/spec.md`. Contract note from the app: `specs/quick-circuit/handoff.md` (QC11-QC15, QC29, QC31, QC37, QC40).

## The shape

```
src/stores/
  dimensions.ts   DIMENSIONS {what: emitted, how: reserved}, RESERVED_FIELDS ['hours'] (ST2)
  schema.ts       StoreSchema, StoreCandidateSchema, FeatureSchema, storesJsonSchema() (ST1, ST2, ST8)
  osmShops.ts     SHOP_FILTER, the tag tables, READS, adaptShops(raw, fetchedAt) (ST3, ST4, ST9)
  gate.ts         gateStores: schema and duplicates only; no name filter, no chains (ST1, ST5)
  package.ts      packStores: the pack through archive.mjs, block hashes (ST7)
  build.ts        buildStores(raw store, run, registry, newId): reads shops-* parts of the osm source (ST6)
src/adapters/osm/   FILTER stays; fetch passes [FILTER, SHOP_FILTER] to filterExtracts; adapt skips shops-* parts (ST6, ST9)
src/archive.mjs     writeArchive takes optional {layer, fields, attribution, extra}; defaults are the places pack's (ST7)
src/conflate.ts     createIds takes an id pattern, default the places' (stores ids are s_...)
src/publish.ts      decideStores (ST10)
scripts/manifest.mjs  stores-<region>-<version>.pmtiles listed as region.stores {current, previous} (ST7)
src/contract.ts     stores.schema.json, example stores pack and stores-example.json, manifest schema (ST8)
```

- **Raw parts** `shops-<part>.geojsonl` of source `osm`, from `filterExtracts`'s one pass per extract. RB5's 304 carry works
  per part, so an unchanged extract carries its shops too.
- **Ids**: registry `registry-stores-<region>.json` through `createIds` (same crosswalk, retire rules), kept in the state asset.
- **Tile properties**: `name`, `id`, `src`, and one per emitted dimension, values joined by a comma.
- **CLI**: after `run()`, `buildStores` from the osm source's run; `decideStores` against the manifest it already fetched; files
  are written as places files are (`.pmtiles`, `.blocks.json`, `.license` = odbl) and added to `files`.
- **Workflows**: weekly saves the stores registry; Pages downloads `stores-*` and keeps the newest releases that carry each
  kind (a stores-only release must not push the places pack off the site, nor the reverse).

## Tests (`test/stores.test.ts`, one per id, todo first)

ST1 closed schema + extra fields + JSON Schema walk; ST2 lists, `how` rejected, unknown value; ST3 fixture mapping and drops;
ST4 poisoned tags give the same record, reads/filter free of crowd keys; ST5 chains stay in the pack, no chain file or field; ST6 places identical with and without
shops, import grep; ST7 pack read back with the pmtiles reader, order-free, places bytes unchanged (the contract test's
example places pack), manifest; ST8 contract files; ST9 filter shared, one request per part (fake http); ST10 decideStores
and workflow text.

## Not run here

Real extract, osmium, workflows, publish.
