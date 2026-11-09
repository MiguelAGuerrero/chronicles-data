#!/usr/bin/env node
// The places pipeline's command line (docs/spec.md, decision 0108 in the app repo), run by the weekly job:
//
//   npm run build -- --region us --version 20261116 --state state --out out \
//        --manifest-url https://…/manifest.json [--edits edits.json] [--no-fetch]
//
// `state` holds the raw store (state/raw) and the ID registry (state/registry-<region>.json) between runs; the job
// restores it before and saves it after. Writes, per pack, out/<file>.pmtiles and out/<file>.blocks.json, and
// out/report.json; prints `publish=true|false`, `reason=…` and `files=…` for the workflow, and `state-sources=…`, the
// sources whose raw answers may go in the published state (PP1).
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Adapter, Box } from './adapter';
import { wikidata } from './adapters/wikidata';
import { emptyRegistry, type Registry } from './conflate';
import { realClock } from './http';
import { decide } from './publish';
import { createRawStore } from './rawStore';
import { redistributable, run } from './runner';

/** The adapters, in priority order: the first source's record is promoted whole when two name one place. */
export const ADAPTERS: Adapter[] = [wikidata];

export const REGIONS: Record<string, Box[]> = {
  // The conterminous US, Alaska and Hawaii, in boxes [west, south, east, north].
  us: [[-125, 24, -66, 50], [-170, 51, -129, 72], [-161, 18, -154, 23]],
};

export const newId = () => `p_${randomBytes(8).toString('hex')}`;

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
    console.error('usage: npm run build -- --region us --version YYYYMMDD[.n] --state dir --out dir --manifest-url URL [--edits edits.json] [--no-fetch]');
    process.exit(1);
  }
  mkdirSync(out, { recursive: true });
  const regFile = join(state, `registry-${region}.json`);
  const registry: Registry = existsSync(regFile) ? JSON.parse(readFileSync(regFile, 'utf8')) : emptyRegistry();
  const edits = JSON.parse(readFileSync(arg('edits') ?? 'edits.json', 'utf8'));

  const r = await run({
    adapters: ADAPTERS,
    region,
    area: REGIONS[region],
    version,
    store: createRawStore(join(state, 'raw')),
    registry,
    edits,
    fetch: !process.argv.includes('--no-fetch'),
    http: (u, init) => fetch(u, init),
    clock: realClock,
    newId,
    log: (l) => console.error(l),
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
    const d = decide({ region: p.region, blocks: p.blocks, manifest, unreachable });
    reasons.push(`${p.region}: ${d.reason}`);
    if (!d.publish) continue;
    writeFileSync(join(out, p.file), p.bytes);
    writeFileSync(join(out, p.file.replace(/\.pmtiles$/, '.blocks.json')), `${JSON.stringify(p.blocks)}\n`);
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
