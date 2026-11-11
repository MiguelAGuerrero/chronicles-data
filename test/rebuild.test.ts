/// <reference types="node" />
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Adapter, Box, FetchContext } from '../src/adapter';
import { FILTER, osm } from '../src/adapters/osm';
import { DOWNLOAD_MS, filterExtracts } from '../src/adapters/osm/extract';
import { wikidata } from '../src/adapters/wikidata';
import { emptyRegistry } from '../src/conflate';
import { createRawStore, type RawStore } from '../src/rawStore';
import { FETCH_KEY, run, staleSources, type RunOptions } from '../src/runner';
import type { Declaration } from '../src/schema';

// Rebuild on push, fetch only what's stale (docs/spec.md, RB).

const ROOT = join(fileURLToPath(import.meta.url), '../..');
const WORKFLOW = readFileSync(join(ROOT, '.github/workflows/weekly-build.yml'), 'utf8');
const AREA: Box[] = [[-76, 40, -72, 42]];
const clock = { now: () => Date.parse('2026-11-11T07:17:00Z'), sleep: async () => {} };
const tmpStore = () => createRawStore(mkdtempSync(join(tmpdir(), 'rb-raw-')));

/** A source whose fetch is counted, with a fingerprint the test can change. */
function source(name: string, place: string, at: [number, number]) {
  const s = { key: 'k1', fetched: 0 };
  const adapter: Adapter = {
    declaration: { ...wikidata.declaration, name, code: name.slice(0, 8), hosts: ['example.org'] } as Declaration,
    fetchKey: () => s.key,
    async fetch(ctx) {
      s.fetched++;
      ctx.put('rows.json', JSON.stringify([{ source: name, sourceId: '1', name: place, at, class: 'folly', signals: {}, fetchedAt: '2026-11-11T07:17:00.000Z' }]));
    },
    adapt: (raw) => JSON.parse(raw) as unknown[],
  };
  return { adapter, s };
}

function opts(store: RawStore, adapters: Adapter[], o: Partial<RunOptions> = {}): RunOptions {
  let n = 0;
  return {
    adapters, region: 'us', area: AREA, version: '20261111', store, registry: emptyRegistry(), edits: { remove: [], add: [] },
    fetch: true, http: async () => { throw new Error('no network'); }, clock, newId: () => `p_${(++n).toString(16).padStart(16, '0')}`, ...o,
  };
}

const names = (r: Awaited<ReturnType<typeof run>>) => r.packs.flatMap((p) => p.places.map((q) => q.name)).sort();

test('RB1: the push trigger covers the code, the owner\'s files and the dependencies, and runs the tests first', () => {
  const push = WORKFLOW.slice(WORKFLOW.indexOf('  push:'), WORKFLOW.indexOf('permissions:'));
  for (const p of ["'src/**'", 'edits.json', 'review-areas.json', 'package.json', 'package-lock.json']) assert.ok(push.includes(`- ${p}`), `a push to ${p} rebuilds`);
  assert.match(push, /branches: \[main\]/);
  const tests = WORKFLOW.indexOf('npm run typecheck && npm test');
  assert.ok(tests > 0 && tests < WORKFLOW.indexOf('Run the pipeline'), 'the typecheck and tests run before the build, in the same job');
});

test('RB2: each source\'s fetch has a fingerprint, recorded with the run that fetched it', async () => {
  const k = wikidata.fetchKey!(AREA);
  assert.match(k, /^[0-9a-f]{16}$/);
  assert.equal(wikidata.fetchKey!(AREA), k, 'the same fetch, the same fingerprint');
  assert.notEqual(wikidata.fetchKey!([[-80, 30, -70, 40]]), k, 'another area is another fetch');
  const o = osm.fetchKey!(AREA);
  FILTER.then!.push('nwr/test=1');
  try {
    assert.notEqual(osm.fetchKey!(AREA), o, 'a changed OSM filter is another fetch');
  } finally {
    FILTER.then!.pop();
  }
  assert.equal(osm.fetchKey!(AREA), o);
  const store = tmpStore();
  const a = source('alpha', 'Alpha Folly', [-75, 41]);
  await run(opts(store, [a.adapter]));
  assert.equal(store.meta('alpha', '20261111')[FETCH_KEY], 'k1');
});

test('RB3: a push fetches only stale sources and builds the others from their kept answers', async () => {
  const store = tmpStore();
  const a = source('alpha', 'Alpha Folly', [-75, 41]);
  const b = source('beta', 'Beta Folly', [-74, 41]);
  await run(opts(store, [a.adapter, b.adapter], { version: '20261110' }));
  assert.deepEqual(staleSources([a.adapter, b.adapter], store, '20261111', AREA), [], 'nothing changed: nothing to fetch');
  // A change after fetching (here the edits) fetches nothing and still rebuilds.
  const edited = await run(opts(store, [a.adapter, b.adapter], { only: [], edits: { remove: [{ name: 'Beta Folly', at: [-74, 41] }], add: [] } }));
  assert.deepEqual([a.s.fetched, b.s.fetched], [1, 1]);
  assert.deepEqual(names(edited), ['Alpha Folly']);
  // Beta's fetch changes: only Beta is fetched; Alpha is built from its kept answers.
  b.s.key = 'k2';
  const stale = staleSources([a.adapter, b.adapter], store, '20261111', AREA);
  assert.deepEqual(stale, ['beta']);
  const r = await run(opts(store, [a.adapter, b.adapter], { only: stale }));
  assert.deepEqual([a.s.fetched, b.s.fetched], [1, 2]);
  assert.deepEqual(names(r), ['Alpha Folly', 'Beta Folly']);
  assert.deepEqual(staleSources([a.adapter, b.adapter], store, '20261112', AREA), [], 'the new fingerprint is recorded');
});

test('RB4: the plan names the stale sources, and osmium is installed only when OpenStreetMap is one', async () => {
  const state = mkdtempSync(join(tmpdir(), 'rb-state-'));
  const out = await new Promise<string>((resolve, reject) =>
    execFile(process.execPath, ['--import', 'tsx', join(ROOT, 'src/cli.ts'), '--region', 'us', '--version', '20261111', '--state', state, '--plan'], { cwd: ROOT }, (err, stdout, stderr) => (err ? reject(new Error(stderr)) : resolve(stdout))));
  assert.equal(out.trim(), 'stale=wikidata', 'with no runs held, every source but a weekly one is stale (RB8)');
  const plan = WORKFLOW.indexOf('--plan');
  const install = WORKFLOW.indexOf('Install osmium');
  assert.ok(plan > 0 && plan < install, 'the plan comes before the install');
  assert.match(WORKFLOW.slice(install - 200, install + 200), /if: github\.event_name != 'push' \|\| contains\(format\(' \{0\} ', steps\.plan\.outputs\.stale\), ' osm '\)/);
});

test('RB5: an extract unchanged since the copy held is not downloaded, and its answers are carried', async () => {
  const filter = { name: 'confirm', expressions: ['nwr/wikidata'] };
  const asked: Record<string, string | null>[] = [];
  const carried: string[] = [];
  const meta: Record<string, string> = {};
  const ctx = (sameFetch: boolean, status: number): FetchContext => ({
    area: AREA, run: '20261111', week: 46, box: null, log: () => {},
    put: () => assert.fail('nothing is downloaded or written'),
    http: async (_url, init) => {
      const h = new Headers(init?.headers);
      asked.push({ etag: h.get('if-none-match'), since: h.get('if-modified-since') });
      return new Response(null, { status });
    },
    previous: { run: '20261104', startedAt: null, parts: [{ part: 'confirm-us-west.geojsonl', sha256: 'x', fetchedAt: '2026-11-04T07:17:00Z' }], read: () => '', meta: { 'etag:us-west': '"abc"', 'modified:us-west': 'Tue, 03 Nov 2026 21:00:00 GMT' } },
    carry: (part) => carried.push(part),
    keepClock: () => {},
    setMeta: (k, v) => { meta[k] = v; },
    sameFetch,
  });
  await filterExtracts(ctx(true, 304), [filter], ['us-west']);
  assert.deepEqual(asked[0], { etag: '"abc"', since: 'Tue, 03 Nov 2026 21:00:00 GMT' }, 'it asks only if the extract changed');
  assert.deepEqual(carried, ['confirm-us-west.geojsonl'], 'the 304 carries what the earlier run filtered');
  assert.equal(meta['etag:us-west'], '"abc"', 'and keeps the validator for next time');
  // With another fingerprint the earlier answers can't stand in: it asks unconditionally (here Geofabrik refuses).
  await assert.rejects(filterExtracts(ctx(false, 503), [filter], ['us-west']));
  assert.deepEqual(asked[1], { etag: null, since: null });
});

test('RB6: the weekly and hand runs fetch every source, as before', async () => {
  const store = tmpStore();
  const a = source('alpha', 'Alpha Folly', [-75, 41]);
  const b = source('beta', 'Beta Folly', [-74, 41]);
  await run(opts(store, [a.adapter, b.adapter], { version: '20261110' }));
  await run(opts(store, [a.adapter, b.adapter]));
  assert.deepEqual([a.s.fetched, b.s.fetched], [2, 2], 'without `only`, every source is fetched though nothing changed');
  assert.match(WORKFLOW, /cron: '17 7 \* \* 1'/);
  assert.match(WORKFLOW, /if \[ "\$\{\{ github\.event_name == 'push' \}\}" = "true" \]; then extra="--fetch-stale"; fi/, 'only a push fetches what is stale');
});

test('RB7: a complete run from before fingerprints is stale once', async () => {
  const store = tmpStore();
  const a = source('alpha', 'Alpha Folly', [-75, 41]);
  const old = { ...a.adapter };
  delete old.fetchKey;
  await run(opts(store, [old], { version: '20261104' }));
  assert.equal(store.meta('alpha', '20261104')[FETCH_KEY], undefined);
  assert.deepEqual(staleSources([old], store, '20261111', AREA), [], 'a source with no fingerprint is stale only with no run');
  assert.deepEqual(staleSources([a.adapter], store, '20261111', AREA), ['alpha'], 'once it has one, the old run is stale');
  await run(opts(store, [a.adapter], { only: ['alpha'] }));
  assert.deepEqual(staleSources([a.adapter], store, '20261112', AREA), []);
});

test('RD7: the extracts are asked at Geofabrik\'s US region addresses (north-america/<region>-latest.osm.pbf)', async () => {
  // Runs 5-8 asked north-america/us/<region>-latest.osm.pbf, which Geofabrik answers 404, so no OSM answer was ever kept.
  const urls: string[] = [];
  const ctx: FetchContext = {
    area: AREA, run: '20261111', week: 46, box: null, log: () => {}, put: () => {},
    http: async (url) => { urls.push(url); return new Response(null, { status: 503 }); },
    previous: null, carry: () => {}, keepClock: () => {}, setMeta: () => {}, sameFetch: false,
  };
  await assert.rejects(filterExtracts(ctx, [{ name: 'confirm', expressions: ['nwr/wikidata'] }], ['us-northeast']));
  assert.deepEqual(urls, ['https://download.geofabrik.de/north-america/us-northeast-latest.osm.pbf']);
});

test('RD7: an extract\'s download has its own long limit, never the 75 s a query gets', async () => {
  // Run 9 (Nov 11): the polite fetch's 75 s signal also ends the body, so every multi-GB download was cut short.
  const signals: (AbortSignal | null | undefined)[] = [];
  const ctx: FetchContext = {
    area: AREA, run: '20261111', week: 46, box: null, log: () => {}, put: () => {},
    http: async (_url, init) => { signals.push(init?.signal); return new Response(null, { status: 503 }); },
    previous: null, carry: () => {}, keepClock: () => {}, setMeta: () => {}, sameFetch: false,
  };
  await assert.rejects(filterExtracts(ctx, [{ name: 'confirm', expressions: ['nwr/wikidata'] }], ['us-west']));
  assert.ok(signals[0], 'the download carries its own signal, so politeFetch\'s 75 s one is not used');
  assert.ok(DOWNLOAD_MS >= 30 * 60_000, 'at least half an hour per extract');
});

test('RB8: a push never fetches a weekly source, whatever its fingerprint says', async () => {
  assert.equal(osm.weekly, true, 'OpenStreetMap is weekly');
  const store = tmpStore();
  const a = source('alpha', 'Alpha Folly', [-75, 41]);
  const w = source('weekly', 'Weekly Folly', [-74, 41]);
  w.adapter.weekly = true;
  assert.deepEqual(staleSources([a.adapter, w.adapter], store, '20261111', AREA), ['alpha'], 'with no run held, still not named');
  await run(opts(store, [a.adapter, w.adapter], { version: '20261110' }));
  w.s.key = 'k2';
  assert.deepEqual(staleSources([a.adapter, w.adapter], store, '20261111', AREA), [], 'a changed fingerprint waits for the weekly run');
  const r = await run(opts(store, [a.adapter, w.adapter], { only: [] }));
  assert.equal(w.s.fetched, 1);
  assert.deepEqual(names(r), ['Alpha Folly', 'Weekly Folly'], 'built from its kept answers');
  await run(opts(store, [a.adapter, w.adapter]));
  assert.equal(w.s.fetched, 2, 'the weekly run fetches it');
});
