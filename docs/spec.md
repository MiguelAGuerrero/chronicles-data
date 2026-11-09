<!-- Places pipeline. Written in the app repo (MiguelAGuerrero/chronicles, specs/places-pipeline) on 2026-11-09 and moved
     here the same day (the owner: the data repo houses the frame, the schemas and the plans, as the interface the app
     consumes). Research: "Places data pipeline: research" (https://claude.ai/artifact/R1GLx9Q5gurtYdJrLsRi4s). The
     product rules it keeps are the app's decisions 0103 and 0108. -->

# Places pipeline: the frame, with Wikidata behind it (PP)

Nov 9, 2026 · @Miguel Guerrero

The places archive's build grows into a pipeline any source can join through its own adapter: fetch, raw store, adapt,
conflate, gate, package, publish. This first slice builds the frame and moves today's Wikidata code behind it. The app
reads the same places from the same host. Phones never call a source; every outside call happens once a week in the
build job.

## Vision

```
Idea: grow the places archive build into a pipeline that takes any source through its own adapter into one known shape,
  cut into packs phones download from our CDN; slice 1 is the frame with Wikidata moved behind it
Verb: earn (more open sources raise what a walker notices, under the same "worth the stop" gate; the rest of slice 1 is
  in the build job)
Touches: Never "Popularity, trending, foot traffic, other people's activity" (Worth the stop, not the most popular), the
  rule the adapters' roles guard; Never "Ratings, reviews, stars, 'best of', rankings of places", nearest fit
  "open-data signals such as a heritage listing"; Never "Data leaving the device without a tap", not touched (phones
  only download from our host, as in 0103); decisions 0016 (no dataset hard-coded) and 0103 (PW7: "significance is a
  gate, never a measure"; "never a count: no sitelinks, page views or rank")
Verdict: aligned
Shape: as asked; a nominating source can only propose a place a locating, open source confirms, and the nomination
  never reaches a pack
Criteria: PP5 (closed schema, no number but a position); PP7 (a place needs a locating source; nominations never change
  a pack); PP9 (one src, sources only in the registry, one license family per pack); PP1 (declaration required and
  enforced; a nominating adapter needs its own decision); PP6 (a gate blind to sources); PP12 (no change publishes
  nothing); PP16 (phones never call a source)
Open: none (the owner's calls below)
```

## Decisions (the owner's calls, Nov 9; decision 0108 in the app repo)

- **This repo owns the pipeline and the contract** (Nov 9, after slice 1 was built in the app repo): the code, the
  schemas, the class names, the owner's edits and these docs live here; `contract/` is what the app may rely on,
  served beside the archives, and the app pins a copy of it. The edits apply only when packs are built.

- **Node and TypeScript only.** Python tools (Splink, dlt) wait until rule-based matching falls short.
- **Our own opaque place IDs from this slice**, with a crosswalk from source IDs (Wikidata QIDs now). IDs carry no
  meaning (Overture's lesson: IDs that encoded a cell had to be thrown away).
- **Packs are tile lists inside one region file**, never a file per town.
- **Zod 4** as a dev dependency for the schema and its JSON Schema export.
- **Nominations reach only a review list** (after the steward's review): never a pack, even when a locating source
  confirms them; the owner adds a place through the edits. Each nominating adapter needs its own decision record
  (decision 0108).
- **Architecture as researched:** stages fetch, raw store, adapt, conflate, gate, package, publish; an adapter is a
  declaration plus `fetch` and `adapt`; roles locate, corroborate or deny, nominate.

## Criteria

1. **PP1 No adapter runs without its declaration, and the declaration is enforced.** An adapter declares its name,
   license, attribution line, role (locates, confirms or denies, nominates), pace (requests a minute, User-Agent) and
   allowed uses (may it be stored, for how long, may it be redistributed, may it reach a pack), and that its terms were
   checked, with the date. The runner refuses to run one whose declaration is missing any of these, naming what is
   missing. A source that may not reach a pack contributes nothing to one; raw parts older than its retention are deleted
   before the state is saved; a source that may not be redistributed is left out of the published state. A nominating
   adapter also names the decision record that admitted it, or the runner refuses it.
2. **PP2 Only fetch touches the network.** Fetch writes each source's answers to the raw store as received, with the
   date and a SHA-256. Every later stage reads only the raw store, so a rerun from the raw store makes no request.
3. **PP3 Each source at its own pace.** The runner holds a source to its declared requests a minute, waits a 429's or
   503's `Retry-After` (capped), and sends the declared User-Agent. The Wikidata adapter keeps today's behaviour: one
   query at a time, a pause between, a cell that times out split in four.
4. **PP4 Candidates are checked.** `adapt` turns raw files into candidates in the canonical shape. A schema checks each
   one; one that fails is set aside with its reason in the run's report, and the run goes on.
5. **PP5 Nothing in the shape is a score.** Every object in the canonical schema (candidates, places, packs) is closed,
   nested ones included, and the only numbers anywhere are the two of a position. Evidence is a string that never reaches
   a place. The schema is exported as JSON Schema and committed; a record carrying `count`, `rank`, `score`, `votes`,
   `likes`, `mentions`, `upvotes`, `followers`, `sitelinks` or `views`, at any depth, fails it.
6. **PP6 The same places, through a gate blind to sources.** The gate is written in the archive's own class vocabulary
   (`ARCHIVE_CLASSES`); the Wikidata adapter maps P31 classes, heritage and "gone" signals to it. The gate reads no source
   name and no number of sources: renaming a source changes no result. From the same Wikidata items, the pipeline yields
   the same places (name, position, class) as the current build.
7. **PP7 A place needs a locating source; nominations never change a pack.** A place enters a pack only with a
   position from an adapter whose role is locates. For the same other candidates, a build with zero, one or fifty
   nominations yields identical blocks. Nominations appear only in the run's report, as a list for the owner to review
   (who can add a place through the edits, PP10); never in a pack, the registry's places or the crosswalk. Confirming or
   denying can only confirm a place or mark it gone; nothing records how many sources confirm it.
8. **PP8 Places keep their IDs.** Each place gets an opaque ID. A registry kept between builds gives a place the same ID
   when it matches the last build's (the same source ID first, else the same name within 50 m). A crosswalk lists each
   source ID with its place ID. A place that disappears keeps its ID retired, never reused.
9. **PP9 Every place says where it came from, once.** A pack's feature holds exactly name, class, src (its first
   locating source) and id; the full list of sources lives only in the registry. Within a block, places are in ID order,
   so a confirming source added to a place changes neither its feature nor its position. A pack holds one license family,
   and ODbL is never mixed with another.
10. **PP10 The owner's edits still apply.** `edits.json` removes and adds places after the gate, as PW13 does, and only
    here: the app no longer applies it.
11. **PP11 Blocks carry their own hash.** The manifest lists, for each region, its blocks (z8 tiles) with a hash of the
    places inside each (ID, name, class, position), not of the file's bytes.
12. **PP12 No change publishes nothing.** A weekly run in which no place changed publishes no new file and leaves the
    manifest as it was.
13. **PP13 Only changed areas are rebuilt** (the app's side; tested in the app repo). The app rebuilds a checklist area or re-reads an atlas ring only when its
    block's hash changes, not on every new file version. Areas built before blocks existed are rebuilt once.
14. **PP14 A failing source doesn't sink the run.** When a source's fetch fails, its last good raw snapshot is used, the
    report says so, and the other stages publish.
15. **PP15 Runs weekly in chronicles-data.** The weekly workflow runs the stages in order, keeps the raw store and the ID
    registry between runs as release assets, and stays within the free tier (one job, under 6 hours).
</content>
</invoke>
16. **PP16 Phones still never call a source** (the app's side; tested in the app repo against `contract/sources.json`). The slice adds nothing to `ALLOWED_HOSTS` or `lib/net`'s host table, and
    no file under the app's `src/` names an adapter's host (`query.wikidata.org` and any later one).

## The contract (CT)

1. **CT1 The contract is the code's.** `contract/` (places.schema.json, manifest.schema.json, sources.json, an example
   pack and its manifest) is exactly what `npm run contract` generates; CI fails otherwise.
2. **CT2 The manifest's shape is written down.** The example manifest names its file, version, bounds and blocks as
   `contract/manifest.schema.json` says; the Pages workflow serves `contract/` beside the manifest.

## Carried from Places worth the stop

The build-side criteria of the app's `specs/places-worth-the-stop` moved here with the code, tested in
`test/build.test.ts`: PW5 (the class names, here against `src/classes.ts`), PW6, PW7, PW13, PW14, PW15 and PW19.

## Record (Nov 9)

- **Built** in the app repo first: PP1-PP16, each with its test, the todos committed first (the app's
  `claude/places-pipeline-frame`). Moved here the same day: the pipeline is `src/`, its tests `test/`; the Wikidata
  adapter carries the archive's query and classes, and
  `build-places-archive.mjs`, `fetch-wikidata.mjs` and `publish.mjs` are retired (PW7, PW13-PW15 and PW19 now run
  against the pipeline). PP6 holds against the places the old build made from the same sample answers, frozen in
  `test/fixtures/expected-places.json`.
- **Found while building:** Explore compared an area's archive tag with the tag at the walker's fix, so with blocks an
  area by a block's edge would have been read on every fix; each area is now tagged and judged at its own point
  (PP13's second test). The run's report, which holds the nominations list, is not published with a release.
- **The weekly job** runs `npm run build` from this repo and keeps the state as the `state-us` pre-release. The workflow
  on main before this had a YAML error in its last step; that was fixed on main first (Nov 9).
- **Deferred:** town and city entries in the manifest (no screen asks for one yet; when they come, tile lists inside
  the region file); GeoParquet and DuckDB (with the Overture adapter); Overture, OSM and nominating adapters, each its
  own slice (a nominating one needs its own decision record in the app repo); whether OSM counts when it only removes
  places (any pack OSM changed is treated as ODbL); conditional requests (the query service has none); Cloudflare R2
  (when bandwidth nears 100 GB a month, or the app is sold). Two Wikidata items with the same name within 50 m become
  one place (accepted).
