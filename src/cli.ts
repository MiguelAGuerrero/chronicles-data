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
import { wikidata } from './adapters/wikidata';
import { emptyRegistry, type Registry } from './conflate';
import { realClock } from './http';
import { decide } from './publish';
import { createRawStore } from './rawStore';
import { redistributable, run, staleSources } from './runner';

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
    fetch: !process.argv.includes('--no-fetch'),
    only,
    box: boxArg(arg('box')),
    http: (u, init) => fetch(u, init),
    clock: realClock,
    newId,
    log: (l) => console.error(l),
    // RD12: test areas for the owner's review in report.json, which no release, archive or manifest carries.
    reviewAreas: arg('review-areas') ? JSON.parse(readFileSync(arg('review-areas')!, 'utf8')) : undefined,
  });

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
  writeFileSync(regFile, `${JSON.stringify(r.registry)}\n`);
  writeFileSync(join(out, 'report.json'), `${JSON.stringify(r.report, null, 1)}\n`);
  console.log(`publish=${files.length > 0}`);
  console.log(`reason=${reasons.join('; ')}`);
  console.log(`files=${files.join(' ')}`);
  console.log(`state-sources=${redistributable(ADAPTERS).join(' ')}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
