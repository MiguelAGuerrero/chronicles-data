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
   denying can only confirm a place, mark it gone, or (amended by RD7, Nov 10) say it is open or closed, which decides
   whether a listed place that needs a sign of being open enters and keeps a closed one out; `open` and `closed` are
   each true when any confirming element says so, `closed` wins, and nothing records how many sources confirm it.
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

## Changes first (CF, decision 0120 in the app repo)

The Wikidata adapter asks every 2° cell of the region each week (about 630 queries, roughly 1-2 hours). Measured on
Nov 9, "items of a class modified since a date", filtered by country, answers in 1-7 s a class; the same filtered by
box takes 46 s to over the 60 s limit. This slice makes the weekly fetch ask what changed, ported from the app's staged
places build (its SB3, SB4, SB8, SB11, SB12; the rest of that slice was already this pipeline's).

1. **CF1 Changes first.** With an earlier complete run in the raw store, a fetch asks no cell beyond its sweep share
   (CF4): one query per pinned class and one for the landmarks, filtered by the region's country and modified since
   the earlier run began (less a day for the query service's lag), and a check of the held items, at most 400 ids a
   query. Every answer is kept as received (PP2).
2. **CF2 Changed away leaves.** A held item the check says was modified since, that no changes answer of the same run
   returned (it left its class or lost its location), leaves; so does one the service no longer knows (merged or
   deleted). A held item not modified stays as its earlier answer said, and is never asked about.
3. **CF3 A new class asks only for itself.** A pinned class the earlier run did not ask is asked once across the
   country with no date; the other classes are asked only for changes.
4. **CF4 The sweep, only when needed.** With no earlier complete run, every cell is swept. Run by hand with a box, only
   that box's cells are swept and the changes clock doesn't move. Every weekly run also sweeps one cell in thirteen
   (the ISO week's share), so every cell is re-asked once a quarter, a backstop for changes a week missed. A cell swept
   replaces what earlier answers said inside it.
5. **CF5 Answers carried, newest wins.** A run carries forward the earlier run's answers it did not re-ask, with their
   original time and hash. An answer that every cell has been swept since is not carried. Where answers disagree about
   an item, the newest wins; the same raw store builds the same places (PP2).
6. **CF6 The owner's edits rebuild without a fetch.** A push to `main` that changes `edits.json` or the classes runs the
   build from the raw store with no request (`--no-fetch`) and publishes only if a block changed (PP12).

Found while porting (Nov 10): the cell query, like the changes query, requires the country (`wdt:P17 wd:Q30`), so
items with no country in Wikidata (about 2% of one measured cell) enter by no query. Whether they should is the
owner's call; this slice keeps the current rule (PP6).

Built (Nov 10, branch `claude/youthful-einstein-go1xie`): CF1-CF6 each with its test in `test/changes.test.ts`, the
todos committed first. The raw store keeps a run's start and notes (the classes it asked) in its index and carries
earlier answers with their time and hash; an adapter may `settle` all its answers at once; the Wikidata adapter's
`settle` replays them in time order. Not yet run against the real query service: its first run sweeps every cell.

## Rebuild on push, fetch only what's stale (RB)

The owner, Nov 11: changes to the rules went out by hand-run workflows (runs 3, 5, 6 and 7, Nov 10-11; push run 4 hung
installing osmium), because a push to `main` rebuilt only for the edits or the classes (CF6), and every fetching run
downloaded the four OpenStreetMap extracts again. The owner's
calls: a push rebuilds by itself; a source is fetched on a push only when the change needs it, and then right away.
The weekly and hand runs stay as they are.

1. **RB1 A push rebuilds by itself, once its tests pass.** A push to `main` that changes the code (`src/`), the
   owner's files (`edits.json`, `review-areas.json`) or the dependencies runs the build. The typecheck and tests run
   first in the same job; a commit that fails them builds nothing.
2. **RB2 Each source's fetch has a fingerprint.** An adapter may say what its fetch asks for (the Wikidata queries and
   pinned classes; OpenStreetMap's filters and extracts) as a string; a run that fetched a source records that
   string beside its answers.
3. **RB3 A push fetches only what is stale.** A source is stale when it has no complete run or its fingerprint
   differs from the one its last complete run recorded. A push fetches the stale sources (Wikidata changes first, so
   a new class asks only for itself, CF3) and builds the others from their kept answers. A change to what happens
   after fetching (adapt, conflate, gate, package, the edits) fetches nothing.
4. **RB4 The plan says what a run will fetch.** Before it runs, a push's job asks the pipeline which sources are
   stale (`--plan`), and installs osmium only when OpenStreetMap is among them.
5. **RB5 An unchanged extract isn't downloaded.** OpenStreetMap's fetch asks Geofabrik for each extract only if it
   changed since the copy its last complete run read (`If-None-Match` / `If-Modified-Since`); an extract that answers
   304 is not downloaded, and that run's answers for it are carried (CF5), provided the fingerprint is the same.
6. **RB6 The weekly and hand runs are unchanged.** The schedule and a hand run fetch every source (Wikidata changes
   first); a hand run with a box sweeps only that box. Every run publishes only when a block changed (PP12).
7. **RB7 Old runs count as stale once.** A complete run from before fingerprints (none recorded) is stale, so the
   first push after this ships fetches each source once and records its fingerprint.

8. **RB8 A push never waits on a weekly source.** An adapter may say its source is refreshed only by the weekly and
   hand runs (OpenStreetMap: four multi-GB extracts, over an hour on a runner). A push never fetches it, whatever its
   fingerprint says, and builds it from its kept answers; the plan never names it, so osmium is never installed on a
   push. A change to its filter takes effect at the next weekly or hand run (the owner, Nov 11, after push run 10
   spent over two hours on OSM's first fetch).

9. **RB9 A hand run may name its sources.** A hand run may list the sources to fetch (`sources: wikidata`); the others
   are built from their kept answers, and osmium is installed only when OpenStreetMap is fetched. Empty fetches every
   source, as before (RB6). An unknown name stops the run before it fetches anything. (Nov 11: a Wikidata fix needed a
   fetch, and every hand run also fetched OpenStreetMap, over an hour.)

Found after it shipped (Nov 12): run versions were compared as text, so `20261111.14` sorted before `20261111.8`.
Keeping the newest three runs then deleted the run just fetched (run 10's first OpenStreetMap answers, run 14's
Wikidata), and a fetch found no earlier run to ask changes since, so run 14 swept all 633 cells. Runs now compare by
date and run number as numbers (`compareRuns`, RB audit 1). The sweep's 74 minutes after fetching were conflate
scanning every place for each record; it now looks places up by name (RB audit 2).

CF6 is amended by RB3: a push that changes the edits rebuilds from the kept answers as before; one that changes the
classes now fetches Wikidata's changes, which asks only for the new class.

Built (Nov 11, branch `claude/auto-rebuild`): RB1-RB7 each with its test in `test/rebuild.test.ts`, the todos committed
first; CF6's test amended to RB3. Adapters may declare `fetchKey`; the runner records it as a run note and fetches only
the sources `staleSources` names when given `only`; a 304 is an answer to `politeFetch`. First run on GitHub (run 8,
Nov 11): Wikidata fetched and recorded its fingerprint; OpenStreetMap failed as it had in every run before (5-8),
because the extracts were asked at `north-america/us/<region>`, which Geofabrik answers 404, so no OSM answer had ever
been kept or reached a pack. The address is now `north-america/<region>-latest.osm.pbf`, pinned by a test. Run 9 then reached Geofabrik but cut each
download short: the polite fetch's 75 s limit (for queries) also ends the body; an extract now has its own 45-minute
limit, also pinned by a test.

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
