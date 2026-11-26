#!/usr/bin/env node
// The places pipeline's command line (docs/spec.md, decision 0108 in the app repo), run by the weekly job:
//
//   npm run build -- --region us --version 20261116 --state state --out out \
//        --manifest-url https://…/manifest.json [--edits edits.json] [--no-fetch] [--box w,s,e,n]
//
// `--box` sweeps that box's cells by hand and asks no changes (CF4); `--no-fetch` builds from the raw store alone
// (PP2). A push runs `--plan` first, which only prints `stale=…` (the sources whose fetch changed, RB4), then
// `--fetch-stale`, which fetches those and builds the others from their kept answers (RB3).
//
// `state` holds the raw store (state/raw) and the ID registry (state/registry-<region>.json) between runs; the job
// restores it before and saves it after. Writes, per pack, out/<file>.pmtiles and out/<file>.blocks.json, and
// out/report.json; prints `publish=true|false`, `reason=…` and `files=…` for the workflow, and `state-sources=…`, the
// sources whose raw answers may go in the published state (PP1).
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Adapter, Box } from './adapter';
import { osm } from './adapters/osm';
import { US_PARTS } from './adapters/osm/extract';
import { kindCountsForReport } from './adapters/osm/shopCounts';
import { countsForReport } from './adapters/osm/tagCounts';
import { wikidata } from './adapters/wikidata';
import { emptyRegistry, type Registry } from './conflate';
import { realClock } from './http';
import { decide, decideFixtures, decideStores } from './publish';
import { createRawStore } from './rawStore';
import { redistributable, run, staleSources } from './runner';
import { buildFixtures } from './fixtures/build';
import { fetchLibraries, librariesRun, librariesStale, shouldFetchLibraries, SOURCE as FIXTURES_WIKIDATA } from './fixtures/wikidata';
import { buildStores } from './stores/build';

/** The adapters, in priority order: the first source's record is promoted whole when two name one place. */
export const ADAPTERS: Adapter[] = [wikidata, osm];

export const REGIONS: Record<string, Box[]> = {
  // The conterminous US, Alaska and Hawaii, in boxes [west, south, east, north].
  us: [[-125, 24, -66, 50], [-170, 51, -129, 72], [-161, 18, -154, 23]],
};

export const newId = () => `p_${randomBytes(8).toString('hex')}`;

/** RB9: the sources a hand run names ("wikidata" or "wikidata,osm"), or null for every source; an unknown name stops the run. */
export function sourcesArg(v: string | null, adapters: Adapter[] = ADAPTERS): string[] | null {
  const names = (v ?? '').split(/[\s,]+/).filter(Boolean);
  if (!names.length) return null;
  const known = adapters.map((a) => a.declaration.name);
  const unknown = names.filter((n) => !known.includes(n));
  if (unknown.length) throw new Error(`--sources names no adapter: ${unknown.join(', ')} (known: ${known.join(', ')})`);
  return names;
}

/** CF4: a box from "w,s,e,n", or null when absent or empty. */
export function boxArg(v: string | null): Box | null {
  if (!v) return null;
  const b = v.split(',').map(Number);
  if (b.length !== 4 || !b.every(Number.isFinite) || b[0] >= b[2] || b[1] >= b[3]) throw new Error(`--box is w,s,e,n: ${v}`);
  return b as Box;
}

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : null;
}

async function main() {
  const region = arg('region');
  const version = arg('version');
  const state = arg('state') ?? 'state';
  const out = arg('out') ?? 'out';
  const url = arg('manifest-url');
  if (!region || !REGIONS[region] || !version) {
    console.error('usage: npm run build -- --region us --version YYYYMMDD[.n] --state dir --out dir --manifest-url URL [--edits edits.json] [--review-areas areas.json] [--no-fetch | --fetch-stale | --plan | --sources a,b] [--box w,s,e,n]');
    process.exit(1);
  }
  const store = createRawStore(join(state, 'raw'));
  // RB4: what a push would fetch, and nothing else.
  if (process.argv.includes('--plan')) {
    console.log(`stale=${staleSources(ADAPTERS, store, version, REGIONS[region]).join(' ')}`);
    return;
  }
  const fetching = !process.argv.includes('--no-fetch');
  const only = process.argv.includes('--fetch-stale') ? staleSources(ADAPTERS, store, version, REGIONS[region]) : sourcesArg(arg('sources'));
  if (only) console.error(`fetching only: ${only.join(', ') || 'nothing'}`);
  mkdirSync(out, { recursive: true });
  const regFile = join(state, `registry-${region}.json`);
  const registry: Registry = existsSync(regFile) ? JSON.parse(readFileSync(regFile, 'utf8')) : emptyRegistry();
  const edits = JSON.parse(readFileSync(arg('edits') ?? 'edits.json', 'utf8'));

  const r = await run({
    adapters: ADAPTERS,
    region,
    area: REGIONS[region],
    version,
    store,
    registry,
    edits,
    fetch: fetching,
    only,
    box: boxArg(arg('box')),
    http: (u, init) => fetch(u, init),
    clock: realClock,
    newId,
    log: (l) => console.error(l),
    // RD12: test areas for the owner's review in report.json, which no release, archive or manifest carries.
    reviewAreas: arg('review-areas') ? JSON.parse(readFileSync(arg('review-areas')!, 'utf8')) : undefined,
  });

  // ST6, ST9: the stores are built from the OSM run's shops parts, apart from the places; their own registry of ids.
  const storesRegFile = join(state, `registry-stores-${region}.json`);
  const storesRegistry: Registry = existsSync(storesRegFile) ? JSON.parse(readFileSync(storesRegFile, 'utf8')) : emptyRegistry();
  const stores = buildStores({ store, run: r.report.sources.find((x) => x.name === 'osm')?.run ?? null, region, version, registry: storesRegistry, newId: () => `s_${randomBytes(8).toString('hex')}` });

  // FX13: Wikidata's libraries, by their own read (never the places' Wikidata fetch): on a run that fetches every source or
  // Wikidata, or on any fetching run while they are stale. FX11: the fixtures are built from the OSM run's fixtures parts
  // and those libraries, apart from the places and the stores; their own registry of ids.
  if (shouldFetchLibraries({ fetching, only, stale: librariesStale(store, version) })) {
    await fetchLibraries({ store, version, http: (u, init) => fetch(u, init), clock: realClock, log: (l) => console.error(l) });
  }
  const fixturesRegFile = join(state, `registry-fixtures-${region}.json`);
  const fixturesRegistry: Registry = existsSync(fixturesRegFile) ? JSON.parse(readFileSync(fixturesRegFile, 'utf8')) : emptyRegistry();
  const fixtures = buildFixtures({ store, osmRun: r.report.sources.find((x) => x.name === 'osm')?.run ?? null, wikidataRun: librariesRun(store, version), region, version, registry: fixturesRegistry, newId: () => `f_${randomBytes(8).toString('hex')}` });

  let manifest = null;
  let unreachable = false;
  if (url) {
    try {
      const res = await fetch(url);
      if (res.ok) manifest = await res.json();
      else if (res.status !== 404) unreachable = true;
    } catch {
      unreachable = true;
    }
  }
  const files: string[] = [];
  const reasons: string[] = [];
  for (const p of r.packs) {
    const d = decide({ region: p.region, blocks: p.blocks, manifest, unreachable, license: p.license });
    reasons.push(`${p.region}: ${d.reason}`);
    if (!d.publish) continue;
    writeFileSync(join(out, p.file), p.bytes);
    writeFileSync(join(out, p.file.replace(/\.pmtiles$/, '.blocks.json')), `${JSON.stringify(p.blocks)}\n`);
    // RD11: the pack's license family beside it, read into the manifest's entry (`license`).
    writeFileSync(join(out, p.file.replace(/\.pmtiles$/, '.license')), `${p.license}\n`);
    files.push(p.file);
  }
  if (!r.packs.length) reasons.push('no archive built');
  // ST10: the stores pack is published only when a block of it changed, read against the live manifest's `stores`.
  if (stores.pack) {
    const p = stores.pack;
    const d = decideStores({ region: p.region, blocks: p.blocks, manifest, unreachable });
    reasons.push(`stores ${p.region}: ${d.reason}`);
    if (d.publish) {
      writeFileSync(join(out, p.file), p.bytes);
      writeFileSync(join(out, p.file.replace(/\.pmtiles$/, '.blocks.json')), `${JSON.stringify(p.blocks)}\n`);
      writeFileSync(join(out, p.file.replace(/\.pmtiles$/, '.license')), 'odbl\n');
      files.push(p.file);
    }
    writeFileSync(storesRegFile, `${JSON.stringify(stores.registry)}\n`);
  }
  // FX11: the fixtures pack, likewise, only when a block of it changed; never built without OSM's fixtures.
  if (fixtures.pack) {
    const p = fixtures.pack;
    const d = decideFixtures({ region: p.region, blocks: p.blocks, manifest, unreachable });
    reasons.push(`fixtures ${p.region}: ${d.reason}`);
    if (d.publish) {
      writeFileSync(join(out, p.file), p.bytes);
      writeFileSync(join(out, p.file.replace(/\.pmtiles$/, '.blocks.json')), `${JSON.stringify(p.blocks)}\n`);
      writeFileSync(join(out, p.file.replace(/\.pmtiles$/, '.license')), 'odbl\n');
      files.push(p.file);
    }
    writeFileSync(fixturesRegFile, `${JSON.stringify(fixtures.registry)}\n`);
  }
  writeFileSync(regFile, `${JSON.stringify(r.registry)}\n`);
  // OC6: the owner's OSM tag counts, only from a run that fetched OpenStreetMap; never in a pack, release or manifest.
  const osmEntry = r.report.sources.find((x) => x.name === 'osm');
  const osmTagCounts = countsForReport(osmEntry, version, fetching && (!only || only.includes('osm')), osmEntry?.run ? store.meta('osm', osmEntry.run) : {}, US_PARTS);
  // SK7, SK9: every value of the keys a stop is told by, for redrawing the facets; the same rule, and never in a pack.
  const osmKindCounts = kindCountsForReport(osmEntry, version, fetching && (!only || only.includes('osm')), osmEntry?.run ? store.meta('osm', osmEntry.run) : {}, US_PARTS);
  writeFileSync(join(out, 'report.json'), `${JSON.stringify({ ...r.report, ...(osmTagCounts ? { osmTagCounts } : {}), ...(osmKindCounts ? { osmKindCounts } : {}), stores: stores.report, fixtures: fixtures.report }, null, 1)}\n`);
  console.log(`publish=${files.length > 0}`);
  console.log(`reason=${reasons.join('; ')}`);
  console.log(`files=${files.join(' ')}`);
  // FX13: Wikidata's libraries are CC0 and kept with the state, beside the adapters' answers.
  console.log(`state-sources=${[...redistributable(ADAPTERS), FIXTURES_WIKIDATA].join(' ')}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
