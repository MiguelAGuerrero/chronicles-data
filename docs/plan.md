# Plan: Places pipeline, slice 1 (the frame, with Wikidata behind it)

> Written in the app repo before the code, and kept as written. The code then moved here (Nov 9): `scripts/places-pipeline/`
> is `src/`, `scripts/places-archive/classify.mjs` is `src/adapters/wikidata/classify.mjs`, `archive.mjs` is
> `src/archive.mjs`, the app's `archiveEdits.json` is `edits.json`, and the tests are `test/`. The weekly job runs
> from this repo without checking out the app.

Spec: `specs/places-pipeline/spec.md` (PP1-PP15). Research: "Places data pipeline: research"
(https://claude.ai/artifact/R1GLx9Q5gurtYdJrLsRi4s). Nothing here is built; the owner reviews it first.

## The shape

```
scripts/places-pipeline/
  schema.ts            Zod: Declaration, Candidate, Place, Block; exports JSON Schema (PP1, PP4, PP5, PP9)
  places.schema.json   the exported JSON Schema, committed; a test fails when it drifts from schema.ts (PP5)
  runner.ts            checks declarations, holds each source to its pace, runs the stages, writes the report (PP1, PP3, PP14)
  rawStore.ts          raw/<source>/<run date>/<part>.json + index.json {part, sha256, fetchedAt} (PP2)
  conflate.ts          candidates -> places: registry match, opaque IDs, crosswalk, retired IDs (PP8)
  gate.ts              source-independent: class vocabulary, locates-only, gone, then the owner's edits (PP6, PP7, PP10)
  package.ts           license families, the region file through archive.mjs, z8 blocks and their hashes (PP9, PP11)
  publish.ts           decide on the blocks' hashes, not the file's bytes (PP12)
  cli.ts               node --import tsx scripts/places-pipeline/cli.ts --region us --stages fetch,adapt,... --state dir
  adapters/wikidata/
    declaration.ts     CC0, locates, 1 request at a time with a 1.5 s pause, terms checked 2026-11-09
    fetch.ts           today's fetch-wikidata.mjs (cells, split on timeout, Retry-After), writing to the raw store
    adapt.ts           itemsFrom + the P31 -> class mapping now in classify.mjs, emitting candidates
    fixtures/          recorded SPARQL answers for two cells and the candidates they must produce
```

- **TypeScript, run with `tsx`** (already a dev dependency; tests already run with it). The old `.mjs` scripts are
  retired once PP6's equivalence test passes: `classify.mjs` moves into the Wikidata adapter, `fetch-wikidata.mjs`
  into its `fetch.ts`, `build-places-archive.mjs` into `gate.ts` and `package.ts`, `publish.mjs` into `publish.ts`.
  `archive.mjs` (the PMTiles writer) stays and is called by `package.ts`. The PW tests that import them move with the
  code and keep their ids (PW5, PW6, PW7, PW13, PW14, PW19).
- **A candidate** (the canonical record an adapter emits): `{source, sourceId, name, at?: [lon, lat], class?, signals:
  {gone?: boolean, heritage?: boolean}, evidence?: string, fetchedAt}`. Every object `.strict()`, nested ones too; no
  number but the position; `evidence` is dropped before conflate (PP5).
- **A place** (what conflate and the gate produce): `{id, name, at, class, sources: [{source, sourceId}], license}`.
  The pack's tile features keep today's properties (name, class, src, id), so `archivePois.ts` doesn't change; `id`
  becomes the opaque ID and `src` the first locating source.
- **IDs:** `p_` + 16 random hex characters, minted by a `newId` passed in (tests pass a counter). The registry is
  `registry.json` `{places: {id: {name, at, sources, retired?}}, crosswalk: {"wd:Q123": id}}`; a match is the same
  source ID first, else the same name within 50 m (`SAME_PLACE_M`, as the app's merge).
- **Blocks:** a z8 tile (about 150 km across at the US's latitudes) is the unit of change. `package.ts` writes, per
  region file, `blocks: {"8/x/y": sha256 of the sorted places inside}`, and the chronicles-data manifest script copies
  it into the region's `current` entry. The manifest stays `schema: 1`: `blocks` is optional, and today's app ignores
  it.

## The app

- `discovery/archiveManifest.ts`: `fileOf` keeps a valid `blocks` map (keys `8/x/y`, values hex); `blockAt(file, at)`
  gives the hash of the block holding a point.
- `discovery/archive/shell.ts`: `versionAt(at)` returns `b:<hash>` when the region file has blocks, else the version
  as today. Checklist areas (`archive` column) and atlas profiles (`profile.archive`) already store that string and
  compare it with `archiveStale`, so an area is rebuilt only when its block's places change (PP13). Areas built with a
  file version see a different string once and are rebuilt once. No migration, no `ATLAS_CODE` bump: the string's
  meaning changes, not the rule.

## chronicles-data

- `weekly-build.yml`: restore the state (raw store and registry) from the latest `pipeline-state-<region>` release
  asset; run `cli.ts` through fetch, adapt, conflate, gate, package, publish; on publish, upload the new archive as
  today and the new state as an asset. The state is kept even when nothing publishes, so the next run's registry and
  raw store are current. `scripts/manifest.mjs` copies `blocks`. Assets older than three runs are deleted.

## Tests (one per criterion, todo first)

`src/lib/__tests__/explore/placesPipeline.test.ts` (scripts) and `placesArchive.test.ts` (the app), named by id:

| Id | Test |
| --- | --- |
| PP1 | a declaration missing each required field is refused, naming the field; a no-pack source adds nothing to a pack; raw parts past retention are deleted before the state is saved; a no-redistribution source is left out of the state asset; a nominating adapter with no decision record is refused |
| PP2 | a rerun from the raw store with a fetch that throws on any call completes and writes the same places |
| PP3 | the runner's clock-driven pacer holds a source to its rate; a 429 with `Retry-After: 5` waits 5 s; the User-Agent is sent (fake fetch) |
| PP4 | a raw file with a bad row yields the good candidates and a report line for the bad one |
| PP5 | the exported JSON Schema equals the committed file; a walk of it finds every object closed and no number but `at`'s two; `count`, `rank`, `score`, `votes`, `likes`, `mentions`, `upvotes`, `followers`, `sitelinks`, `views` fail at the top level and nested in `signals` |
| PP6 | for the recorded fixtures, the pipeline's places equal the current `build()`'s (name, position, class); `gate.ts` imports no adapter; the same in-memory candidates under a renamed source give the same result |
| PP7 | zero, one and fifty nominations for a place give identical block hashes; nominations appear in the report's review list and nowhere in the registry or crosswalk; a confirming source changes no field but `sources` in the registry |
| PP8 | two builds over the same fixtures give the same IDs; a renamed source item keeps its ID by source ID; a moved-and-renamed one gets a new ID; a dropped place's ID is retired and not reused |
| PP9 | a pack feature's keys are exactly name, class, src, id; places in a block are in ID order and a confirming source leaves the feature and order unchanged; an ODbL candidate and a CC0 one go to separate packs |
| PP10 | an edit removes a gated place and adds one (moved from PW13) |
| PP11 | each block's hash changes when, and only when, a place inside it changes |
| PP12 | `decide` publishes nothing when every block hash matches the live manifest's |
| PP13 | `versionAt` returns the block's hash; an area is stale only when its block changed; an area tagged with a file version is stale once |
| PP14 | with the Wikidata fetch failing, the run uses the last raw snapshot, reports it, and publishes |
| PP16 | `ALLOWED_HOSTS` and `lib/net`'s table are unchanged; no file under `src/` contains an adapter's declared host |
| PP15 | the workflow file runs the stages in order, restores and saves the state asset, and has a 360-minute timeout (read as YAML, like PW19's check) |

No e2e: no screen changes. The `curiosities` journey still covers the app's archive read and runs at the end.

## Steward review (Nov 9), triage

All eight findings accepted; each made a criterion stricter. Nothing rejected.

| Finding | Triage |
| --- | --- |
| S1 a nomination could admit a place (a popularity gate) | Accepted into PP7: nominations never change a pack; they become a review list in the run's report, and the owner adds a place through the edits. This narrows the research doc, which let a confirmed nomination in: **the owner's call** (below) |
| S2 PP5 was a short denylist | Accepted into PP5: every object closed, no number but a position, checked by walking the schema |
| S3 a `sources` list in the pack is a corroboration count | Accepted into PP9: one `src` in the feature, the list only in the registry, ID order in a block |
| S4 allowed uses declared but not enforced; state assets are public | Accepted into PP1: no-pack sources add nothing, retention deletes, no-redistribution sources stay out of the state asset |
| S5 the gate could branch on a source | Accepted into PP6: the gate imports no adapter and reads no source name |
| S6 "corroborates" undefined, could become a strength | Accepted into PP1 and PP7: the role is "confirms or denies", and nothing records how many confirm |
| S7 nothing holds "phones never call a source" | Accepted as PP16 |
| S8 slice 1 has no surface; later adapters must not inherit "aligned" | Accepted into PP1: a nominating adapter names the decision record that admitted it. The verdict stays aligned for the frame, whose gate rules are the slice's point |

The owner's call on S1 (Nov 9, decision 0108): a review list only, never a pack.

## Data

No SQLite migration, no IndexedDB version: the `archive` column and `profile.archive` keep a string. No new meta key.

## Dependencies (the owner's call, Nov 9: added)

- **Zod 4** as a dev dependency, for the schema and its JSON Schema export (`z.toJSONSchema`). Zod 3.25 is in the tree
  only as another package's dependency; relying on it would break when that package moves.

## Deferred, and why

- **Town and city pack entries** in the manifest: no screen asks for a town offline yet, so blocks are the only unit
  this slice. The owner's call stands for when they come: tile lists in the region file.
- **GeoParquet and DuckDB:** Wikidata's few thousand items fit in JSON; they arrive with Overture (slice 2), which
  publishes GeoParquet.
- **Overture, OSM and nominating adapters, Splink, moving to Cloudflare R2:** later slices, as the research doc orders.
- **Conditional requests:** the query service has none; the raw store already spares Wikidata on reruns.

## Native

Nothing native changes. One device check: an install with checklist areas built under a file version rebuilds them
once and then only when their block changes (PP13), in `docs/NATIVE_UNVERIFIED.md`.
</content>

## Changes first (CF1-CF6)

- **`FetchContext`** gains `previous` (the earlier complete run: its id, when it began, its parts and a reader), `week`
  (the ISO week), `box` (a sweep by hand) and `carry(part)`; the runner fills them from the raw store.
- **`RawStore.carry(source, from, to, part)`** copies an answer into the new run with its original `fetchedAt` and
  SHA-256, and marks it `carriedFrom`, so a run's start is its own parts' earliest time.
- **`Adapter.settle?(parts, area)`**: when an adapter has it, the runner calls it once with every part of the run
  instead of `adapt` per part. Wikidata's replays its answers in time order: a cell answer replaces the items inside
  its box, a changes answer adds or replaces items, a check answer removes items modified away, merged or deleted.
- **Part names** carry what `settle` needs: `cell_<w>_<s>_<e>_<n>.json` (as before), `changes_<run>_<target>_<country>.json`,
  `held_<run>_<since-epoch>_<n>.json`.
- **The Wikidata adapter's fetch**: no earlier run, sweep every cell; a box, sweep its cells and carry the rest; else the
  changes queries, the held check, this week's thirteenth of the cells, and carry what wasn't re-asked. A new class too
  big to ask whole is swept cell by cell for itself.
- **The weekly workflow** gains a `box` input for a sweep by hand, and a push trigger on `edits.json` and the class
  files that runs with `--no-fetch` (CF6).
- **Tests** (`test/changes.test.ts`): CF1-CF6 against the fixtures and a fake query service that answers changes and
  held-check queries.
