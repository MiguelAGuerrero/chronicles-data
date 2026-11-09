# chronicles-data

The places data [Chronicles](https://github.com/MiguelAGuerrero/chronicles) reads, the pipeline that builds it, and the
contract the app relies on. The archives are served from GitHub Pages and read by the app one small piece at a time
(HTTP range requests). Nothing here runs a server, and nothing about the people using the app is sent here beyond an
ordinary file request. Phones never call a data source: every outside request happens here, once a week.

## What's published (the Pages site)

- `manifest.json`: which archive is current for each region, with its size, SHA-256, bounds, zoom range and `blocks`
  (a hash of the places in each z8 tile, so the app rebuilds an area only when its own places change), plus the
  previous versions still available.
- `places-<region>-<version>.pmtiles`: one archive per region, version and license family (US first). A published file
  is never changed; a new version gets a new name.
- `contract/`: the contract below, beside the data it describes.

The app reads `manifest.json` (at most daily) and then only the parts of the current archive it needs.

## The contract (`contract/`)

What a client may rely on, generated from the code by `npm run contract` and checked by CI:

- `places.schema.json`: the canonical shape (candidates, places, a pack's tile feature: name, class, src, id) and the
  class names. Every object is closed; the only numbers are a position. Nothing in it can hold a count, rank or score.
- `manifest.schema.json`: the manifest's shape.
- `sources.json`: each source's name, license, attribution, role and hosts.
- `example/`: a small pack and its manifest, built from the test fixtures, for clients' tests.

A change to the contract bumps `CONTRACT_VERSION` (`src/classes.ts`); the app pins a copy and its tests fail until it
takes the new one. The rules the contract keeps (no popularity, a gate never a measure, nominations never in a pack)
are the app's decisions 0103 and 0104.

## The pipeline (`src/`)

Stages: fetch (each source's adapter, at its declared pace) into the raw store, adapt (candidates checked by the
schema), conflate (opaque place IDs kept between builds), gate (the class names, still exists, blind to sources), the
owner's `edits.json`, package (PMTiles per region and license family, with block hashes), publish (only when a block
changed). An adapter is a declaration (license, attribution, pace, allowed uses, role) plus `fetch` and `adapt`; the
runner refuses one whose declaration is incomplete. Only a source whose role is `locates` puts a place on the map; a
`nominates` source only reaches the run's review list.

`docs/spec.md` has the criteria (PP1-PP16, CT1-CT2, and those carried from the app's Places worth the stop), and
`docs/plan.md` the plan as written before the code.

```bash
npm ci
npm test                    # the pipeline, the build and the contract
npm run typecheck
npm run contract            # regenerate contract/ after changing the schema, classes or sources
npm run build -- --region us --version 20261116 --state state --out out --manifest-url https://miguelaguerrero.github.io/chronicles-data/manifest.json
```

## How a new version is published

`.github/workflows/weekly-build.yml` runs on Mondays (and by hand): it restores the pipeline's state (raw answers and
the place ID registry) from the `state-us` pre-release, runs the build, saves the state back (only sources whose terms
allow redistribution), and publishes a release with the archive and its blocks only when a block changed. Publishing
(or deleting) a release, or a change to the workflow, `scripts/` or `contract/` on `main`, runs
`.github/workflows/pages.yml`, which downloads the newest three releases' archives, writes `manifest.json`, copies
`contract/` and deploys them to Pages. The three newest versions stay online so an app that read an older manifest
still finds its file.

## Licences

- Data from Wikidata: CC0.
- National Register of Historic Places data: public domain.
- Data from OpenStreetMap: © OpenStreetMap contributors, under the [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/). An archive that includes OpenStreetMap data is a derived database, published under the ODbL, in a pack of its own.
