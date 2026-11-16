<!-- Stores pack. The data side of the app's Plan an outing (specs/quick-circuit, QC11-QC15, QC29, QC31, QC37, QC40 and its
     handoff note). Rules kept: the app's decisions 0103, 0108, 0115 and 0182. -->

# Stores pack: what a shop sells, as its own layer (ST)

Nov 16, 2026

A second pack, beside the places pack: one record per shop, entering by what it sells (antiques, books, records...) and by
nothing a crowd says. The app's outing feature reads it to plan a short walk past the kind of shop a person asked for. It
is not a list of places to find: no store reaches the places pack, its gate or its conflate.

## Vision

```
Idea: a stores layer from open data (OpenStreetMap's shop tags first), a closed record and closed facet lists, its own pack
Verb: earn (a shop worth the stop for what it sells), for the outing planner; nothing on Explore
Touches: Never "ratings, reviews, popularity, foot traffic" (the record has none, no source field of that kind is read);
  0103 (significance is a gate, never a measure: here, a closed list of what a shop sells); 0108 (this repo owns the
  pipeline and the contract; an adapter is a declaration plus fetch and adapt; phones never call a source); 0115
  ("ordinary shops stay out" of the places, kept: a shop is never a place; amended only for this layer, by 0182);
  0182 (the outing's stores layer: enters by what it sells; chains out)
Verdict: aligned, as the app's QC11-QC15 say
Criteria: ST1-ST10
Open: whether a general second-hand shop is `what=vintage` or waits for `how` (below)
```

## Decisions kept

- **A store is not a place.** Separate schema, separate pack file, separate registry of opaque ids; the places schema, gate,
  conflate and pack are untouched (their bytes and tests included).
- **Open data only.** OpenStreetMap shop tags now (the same Geofabrik extracts the places build already downloads, ST9);
  Wikidata instances of shop types are admitted as a source and its adapter is deferred. Never a source whose records
  carry ratings, reviews or popularity.
- **Dimensions by contract version.** `what` is emitted in v1; `how` (`vintage`, `thrift`, `new`) is declared and reserved;
  `hours` is reserved. Adding a dimension, a value or a field is a contract version (CONTRACT_VERSION 2 to 3 here).
- **The app ignores unknown dimensions and values** (QC40), so a pack of a later version never breaks an older app.
- **Chains out by data**: `src/stores/chains.json`, whole-leading-word match on the name, as the app's chains list.

## The record, and its tile encoding

`{ id, name, at: [lon, lat], facets: { what: [...] }, src }` and nothing else. In the pack a feature carries flat string
properties `name`, `id`, `src` and one property per emitted dimension holding its values joined by a comma
(`what: "antiques,books"`); layer `stores`, zoom 12 like the places pack.

## Criteria

1. **ST1 The store record is closed.** A store holds exactly an opaque id (`s_` and 16 hex), a name, a position, facets and
   a src. Every other field fails the schema, at any depth: `rating`, `reviewCount`, `priceLevel`, `popularity`,
   `footTraffic`, `photo`, `openNow`, `hours`, and any unknown one. The only numbers in the record are the two of the position.
   The JSON Schema export is closed at every object.
2. **ST2 Dimensions have closed lists.** `what` is antiques, vintage, books, records, maps, art_supplies, crafts. `how`
   (vintage, thrift, new) is declared and reserved: a record carrying it fails the build's schema. A value outside a
   dimension's list fails the build. A dimension holds one or more values, each once. The contract says that a client ignores
   an unknown dimension or value and reads the rest.
3. **ST3 The shop adapter maps tags to facets.** From recorded OSM elements (node, way, relation): `shop=antiques` is
   antiques; `shop=books` books; `shop=music|records` records; `shop=maps|map` maps; `shop=art_supplies` art_supplies;
   `shop=craft|handicraft` crafts, and a `craft=` of a pinned set on an element that is also a shop; `shop=second_hand`, and
   `second_hand=only` on a pinned set of shops, vintage. A shop with no mapped `what` (a bakery, a charity shop) and one with
   no name are dropped. A way or relation takes one representative position. Output is the same whatever the order of lines.
4. **ST4 No crowd field is read.** The adapter reads only `name`, `shop`, `craft`, `second_hand` and the element's
   type and id. A shop carrying `rating`, `stars`, `reviews`, `popularity`, `wikipedia`, `wikidata` or `brand:wikipedia`
   tags, however large, yields the same record as without them; no such key is in the adapter's reads or in its osmium filter.
   No Wikidata sitelink count is read.
5. **ST5 Chains are out.** A name whose leading whole words are a chain's in `chains.json` is dropped (Half Price Books and
   Half Price Books Outlet; not Half Price Bookshop, since a word is whole). Case, accents, `&` and punctuation do not matter.
   The list is data in a JSON file.
6. **ST6 Stores never reach the places pack.** With shop elements in the OSM raw store, the places packs (their bytes and
   blocks), the registry and the report's review are identical to a build without them; the OSM places adapter's `adapt` yields
   nothing from a stores part; `gate.ts`, `conflate.ts`, `package.ts` and `runner.ts` import nothing of `stores/`.
7. **ST7 The stores pack and the manifest.** The stores are written to `stores-<region>-<version>.pmtiles` through the
   archive writer (layer `stores`, the same bytes for the same stores in any order), with a hash per z8 block of its stores.
   `archive.mjs` with no options writes the places pack's bytes as before. The manifest lists a region's `stores`
   (`current`, `previous`) beside its `current`; a manifest built with no stores packs has no `stores` key, as before.
8. **ST8 Published for the app.** `contract/example/` holds `stores-example-<version>.pmtiles` and `stores-example.json`
   (the records it holds), built from fixtures; `contract/stores.schema.json` holds the record, the feature, the dimensions
   and the reserved names; `npm run contract` regenerates them with CONTRACT_VERSION bumped to 3, and the contract test fails
   when they drift.
9. **ST9 One download a week.** The shops' osmium filter runs in the same pass as the existing OSM adapter's
   (`filterExtracts` with two filters): the part list and the Geofabrik requests are those of one extract per US part; no
   adapter adds a host or a download.
10. **ST10 Published only when a block changed.** `decideStores` reads the live manifest's `stores.current.blocks`: no
    change publishes nothing, a changed block publishes, no `stores` yet publishes; an unreachable manifest publishes
    nothing. The weekly workflow uploads the stores pack and the Pages workflow serves `stores-*` files.

## Not run here

A real Geofabrik extract, osmium, the weekly and Pages workflows and a live publish are not run: only fixtures,
the fake `http` and the tests. The workflow edits are read, not executed.

## Deferred

- Wikidata instances of shop types (its adapter); `how` and `hours`; stores-only regions in the manifest.

## Open for the owner

- Is `shop=second_hand` `what=vintage`, or should general second-hand shops wait for `how=thrift` and only
  `second_hand=only` dealers in clothes and the like be vintage? v1 maps both to vintage.
