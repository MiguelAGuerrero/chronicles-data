# chronicles-data

Static place archives for [Chronicles](https://github.com/MiguelAGuerrero/chronicles), served from GitHub Pages and read by the app one small piece at a time (HTTP range requests). Nothing here runs a server, and nothing about the people using the app is sent here beyond an ordinary file request.

## What's published

- `manifest.json`: which archive is current for each region, with its size, SHA-256, bounds and zoom range, plus the previous versions still available.
- `places-<region>-<version>.pmtiles`: one archive per region and version (US first). A published file is never changed or overwritten; a new version gets a new name.

The app reads `manifest.json` (at most daily) and then only the parts of the current archive it needs.

## How a new version is published

Archives are built by `scripts/build-places-archive.js` in the app repo (its decision 0101), never in this repo. To publish one:

```bash
gh release create v20261105 places-us-20261105.pmtiles --repo MiguelAGuerrero/chronicles-data --title "US places 2026-11-05"
```

Publishing (or deleting) a release, or a change to the workflow or `scripts/` on `main`, runs `.github/workflows/pages.yml`, which downloads the archives of the newest three releases, writes `manifest.json` and deploys them to Pages. The archives live only on releases, so this repo's history stays small, and the three newest versions stay online so an app that read an older manifest still finds its file.

## Licences

- Data from Wikidata: CC0.
- National Register of Historic Places data: public domain.
- Data from OpenStreetMap: © OpenStreetMap contributors, under the [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/). An archive that includes OpenStreetMap data is a derived database and is published under the ODbL.
