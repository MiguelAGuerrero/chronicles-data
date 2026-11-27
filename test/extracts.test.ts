/// <reference types="node" />
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Adapter, Box } from '../src/adapter';
import { FILTER, osm, SMALL_FILTER } from '../src/adapters/osm';
import { DOWNLOAD_MAX_MS, filterExtracts, US_PARTS } from '../src/adapters/osm/extract';
import { COUNT_TAGS } from '../src/adapters/osm/tagCounts';
import { emptyRegistry } from '../src/conflate';
import { buildFixtures } from '../src/fixtures/build';
import { FIXTURE_FILTER } from '../src/fixtures/kinds';
import { politeFetch, SourceTimeout } from '../src/http';
import { createRawStore, type RawStore } from '../src/rawStore';
import { run } from '../src/runner';
import { buildStores } from '../src/stores/build';
import { SHOP_FILTER } from '../src/stores/osmShops';

// OpenStreetMap's four extracts, one at a time (RD7, PP14), after the owner's manual builds of Nov 26 and 27: run
// 45932949065 downloaded and filtered three extracts, then us-west's second try was cut mid-body ("terminated") and the
// whole source fell back to run 40's answers, so no fixtures pack was built. The owner's call (Nov 27, "Fix the fetch,
// then rebuild"): an extract that downloaded keeps its new answers and only the failed one carries its held answers; a
// third try after a longer pause for a non-answer or a cut body; the log names what happened. Everything runs through
// the extract step's seam (town-fixtures audit 11): no osmium, no request to Geofabrik.

/* eslint-disable @typescript-eslint/no-explicit-any */
const ROOT = join(fileURLToPath(import.meta.url), '../..');
// The fix's new exports are read through a path TypeScript doesn't resolve, so the tests load before the code exists.
const load = (p: string): Promise<any> => import(String(`../src/${p}`));
const AREA: Box[] = [[-125, 24, -66, 50]];
const HELD = '20261123.40';
const V = '20261127.2';
const AT: Record<string, [number, number]> = { 'us-northeast': [-74, 41], 'us-midwest': [-88, 42], 'us-south': [-90, 32], 'us-west': [-120, 38] };

function fakeClock(start = Date.parse('2026-11-27T03:46:00Z')) {
  let t = start;
  const slept: number[] = [];
  return { now: () => t, sleep: async (ms: number) => { slept.push(ms); t += ms; }, slept, advance: (ms: number) => { t += ms; } };
}

/** One filter's answer for one extract: a line the places, stores or fixtures read, named by extract and week. */
function answer(filter: string, part: string, when: 'old' | 'new'): string {
  const tags: Record<string, Record<string, string>> = {
    small: { amenity: 'public_bookcase', name: `${part} bookcase (${when})` },
    shops: { shop: 'books', name: `${part} books (${when})` },
    fixtures: { amenity: 'townhall', name: `${part} town hall (${when})` },
  };
  if (!tags[filter]) return '';
  const id = (US_PARTS.indexOf(part) + 1) * 10 + Object.keys(tags).indexOf(filter);
  return JSON.stringify({ type: 'Feature', geometry: { type: 'Point', coordinates: AT[part] }, properties: { '@type': 'node', '@id': id, ...tags[filter] } });
}

/** Run 40 as the owner's state held it: the three base filters for each extract, no fixtures, ETags, dates and counts. */
function heldStore(o: { fixtures?: string } = {}): RawStore {
  const store = createRawStore(mkdtempSync(join(tmpdir(), 'osm-held-')));
  for (const p of US_PARTS) {
    for (const f of ['confirm', 'small', 'shops', ...(o.fixtures ? ['fixtures'] : [])]) store.put('osm', HELD, `${f}-${p}.geojsonl`, answer(f, p, 'old'), '2026-11-23T20:20:00.000Z');
    store.setMeta('osm', HELD, `etag:${p}`, `"held-${p}"`);
    store.setMeta('osm', HELD, `modified:${p}`, 'Sun, 22 Nov 2026 23:54:02 GMT');
    store.setMeta('osm', HELD, `tagCounts:${p}`, '{}');
    store.setMeta('osm', HELD, `shopCounts:${p}`, '{}');
  }
  if (o.fixtures) store.setMeta('osm', HELD, 'filter:fixtures', o.fixtures);
  store.setMeta('osm', HELD, 'fetchKey', osm.fetchKey!(AREA));
  store.complete('osm', HELD);
  return store;
}

/** The connection Geofabrik drops (undici's shape: a TypeError whose cause names the socket). */
const dropped = () => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }) });
const partOf = (url: string) => /(us-[a-z]+)-latest/.exec(url)![1];
const fresh = (part: string) => new Response('pbf bytes', { status: 200, headers: { etag: `"new-${part}"`, 'last-modified': 'Fri, 27 Nov 2026 01:00:00 GMT' } });

/** The seam's fake osmium: each filter's answer for the week, and counts. */
const io = {
  exportFilter: (c: any, _pbf: string, _dir: string, part: string, f: { name: string }) => c.put(`${f.name}-${part}.geojsonl`, answer(f.name, part, 'new')),
  countExtract: () => ({}),
  countShopsIn: () => ({}),
};
/** The OSM adapter with the seam's osmium, the filters exactly as the adapter passes them (FX10). */
const viaSeam: Adapter = { ...osm, fetch: (ctx) => filterExtracts(ctx, [FILTER, SMALL_FILTER, SHOP_FILTER], US_PARTS, COUNT_TAGS, [FIXTURE_FILTER], io as any) };

async function build(store: RawStore, failing: (part: string, n: number) => boolean) {
  const clock = fakeClock();
  const logs: string[] = [];
  const asked: { part: string; t: number }[] = [];
  const http = async (url: string) => {
    const part = partOf(url);
    asked.push({ part, t: clock.now() });
    if (failing(part, asked.filter((a) => a.part === part).length)) throw dropped();
    return fresh(part);
  };
  let n = 0;
  const r = await run({
    adapters: [viaSeam], region: 'us', area: AREA, version: V, store, registry: emptyRegistry(), edits: { remove: [], add: [] },
    fetch: true, http, clock, newId: () => `p_${(++n).toString(16).padStart(16, '0')}`, log: (l) => logs.push(l),
  });
  return { r, logs, asked, clock };
}
const names = (xs: { name?: string }[]) => xs.map((x) => x.name ?? '').sort();

test('PP14, Nov 27: three extracts download and the fourth fails every try: three new, one carried, a fixtures part for the three, and the log names it', async () => {
  const store = heldStore();
  const { r, logs, asked, clock } = await build(store, (part) => part === 'us-west');
  const entry = r.report.sources[0] as any;
  assert.equal(entry.run, V, 'the run is this run, not run 40');
  assert.equal(entry.fellBack, undefined, logs.join('\n'));
  assert.equal(entry.error, undefined);
  assert.deepEqual(Object.keys(entry.carried ?? {}), ['us-west'], 'the report says which extract carried');
  assert.match(entry.carried['us-west'], /^20261123\.40: .*gave no answer \(fetch failed: other side closed \(UND_ERR_SOCKET\)\)/);
  // The three that downloaded keep their new answers, ETags and filters; us-west carries run 40's, as a 304 would.
  const parts = store.parts('osm', V);
  assert.deepEqual(parts.filter((p) => p.part.startsWith('fixtures-')).map((p) => p.part), ['fixtures-us-midwest.geojsonl', 'fixtures-us-northeast.geojsonl', 'fixtures-us-south.geojsonl']);
  assert.deepEqual(parts.filter((p) => p.carriedFrom).map((p) => p.part), ['confirm-us-west.geojsonl', 'shops-us-west.geojsonl', 'small-us-west.geojsonl']);
  assert.ok(parts.filter((p) => !p.part.endsWith('us-west.geojsonl')).every((p) => !p.carriedFrom), 'nothing of the three is carried');
  const meta = store.meta('osm', V);
  assert.deepEqual([meta['etag:us-west'], meta['modified:us-west'], meta['shopCounts:us-west']], ['"held-us-west"', 'Sun, 22 Nov 2026 23:54:02 GMT', '{}'], 'the held ETag, date and counts, so next week asks against the copy its answers came from');
  assert.deepEqual(['us-northeast', 'us-midwest', 'us-south'].map((p) => meta[`etag:${p}`]), ['"new-us-northeast"', '"new-us-midwest"', '"new-us-south"']);
  assert.ok(meta['filter:fixtures'], 'the fixtures filter is noted, and us-west, holding no fixtures part, is filled next week');
  // Three tries for us-west, the third after the longer pause.
  const west = asked.filter((a) => a.part === 'us-west');
  assert.equal(west.length, 3);
  assert.ok(west[2].t - west[1].t >= 5 * 60_000, `the third try waited ${(west[2].t - west[1].t) / 1000} s`);
  assert.ok(clock.slept.includes(5 * 60_000));
  // The packs are built from that mix.
  assert.deepEqual(names(r.packs.flatMap((p) => p.places)), ['us-midwest bookcase (new)', 'us-northeast bookcase (new)', 'us-south bookcase (new)', 'us-west bookcase (old)']);
  let f = 0;
  const fixtures = buildFixtures({ store, osmRun: entry.run, wikidataRun: null, region: 'us', version: V, registry: emptyRegistry(), newId: () => `f_${(++f).toString(16).padStart(16, '0')}` });
  assert.ok(fixtures.pack, fixtures.report.reason);
  assert.deepEqual(names(fixtures.pack.fixtures), ['us-midwest town hall (new)', 'us-northeast town hall (new)', 'us-south town hall (new)']);
  let s = 0;
  const stores = buildStores({ store, run: entry.run, region: 'us', version: V, registry: emptyRegistry(), newId: () => `s_${(++s).toString(16).padStart(16, '0')}` });
  assert.deepEqual(names(stores.pack!.stores), ['us-midwest books (new)', 'us-northeast books (new)', 'us-south books (new)', 'us-west books (old)']);
  // The log names what happened at each try, and which extract carried.
  const westLines = logs.filter((l) => l.includes('us-west'));
  assert.equal(westLines.length, 3, logs.join('\n'));
  assert.match(westLines[0], /^osm: us-west failed \(.*gave no answer \(fetch failed: other side closed \(UND_ERR_SOCKET\)\)\); asking once more$/);
  assert.match(westLines[1], /^osm: us-west failed again \(.*other side closed.*\); asking a last time in 5 minutes$/);
  assert.match(westLines[2], /^osm: us-west failed \(.*other side closed.*\); its answers carried from 20261123\.40, the other extracts' are this run's$/);
  assert.ok(!logs.some((l) => /fetch failed .*; using/.test(l)), 'no whole-source fallback');
});

test('PP14, Nov 27: a failure before any extract has answers, or a held copy that cannot be mixed, still falls back whole', async () => {
  // Run 45912355660: us-northeast, the first extract, gave no answer: nothing of this run to keep, so run 40 stands whole.
  const first = await build(heldStore(), (part) => part === 'us-northeast');
  const e1 = first.r.report.sources[0];
  assert.equal(e1.fellBack, HELD);
  assert.match(e1.error!, /us-northeast.*gave no answer \(fetch failed: other side closed/);
  assert.deepEqual(first.asked.map((a) => a.part), ['us-northeast', 'us-northeast', 'us-northeast'], 'asked three times, then nothing more');
  assert.ok(first.logs.some((l) => l === `osm: fetch failed (${e1.error}); using ${HELD}`), first.logs.join('\n'));
  // The held copy keeps a fixtures part made by another fixtures filter: carried, us-west's fixtures would disagree with
  // the other three; dropped, the published West would lose its fixtures. Neither is safe, so the source falls back.
  const stale = await build(heldStore({ fixtures: 'an older filter' }), (part) => part === 'us-west');
  assert.equal(stale.r.report.sources[0].fellBack, HELD, stale.logs.join('\n'));
  // A held copy made by other filters (another fetch fingerprint) cannot stand for an extract of this run's either.
  const other = heldStore();
  other.setMeta('osm', HELD, 'fetchKey', 'another fingerprint');
  const refiltered = await build(other, (part) => part === 'us-west');
  assert.equal(refiltered.r.report.sources[0].fellBack, HELD, refiltered.logs.join('\n'));
});

/** One extract through the seam, answered by `answer(n)` for its n-th ask. */
async function oneExtract(respond: (n: number) => Response | Promise<Response>, clock = fakeClock()) {
  const seen = { asked: [] as number[], exported: [] as string[], logs: [] as string[], carried: [] as string[] };
  const ctx: any = {
    area: AREA, run: V, week: 48, box: null, sameFetch: false, previous: null, clock,
    http: async () => { seen.asked.push(clock.now()); return respond(seen.asked.length); },
    put: () => {}, carry: (p: string) => seen.carried.push(p), setMeta: () => {}, keepClock: () => {}, log: (l: string) => seen.logs.push(l),
  };
  const fio = { ...io, exportFilter: (c: any, p: string, d: string, part: string, f: { name: string }) => { seen.exported.push(f.name); io.exportFilter(c, p, d, part, f); } };
  let error: Error | null = null;
  try {
    await filterExtracts(ctx, [FILTER, SMALL_FILTER], ['us-west'], undefined, [], fio as any);
  } catch (e) {
    error = e as Error;
  }
  return { seen, error, clock };
}

/** A 200 whose body breaks off after `mb` megabytes, as undici reports it ("terminated", the socket's cause). */
function cutAfter(mb: number): Response {
  const body = new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array(mb * 1_000_000));
      setTimeout(() => c.error(Object.assign(new TypeError('terminated'), { cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }) })), 5);
    },
  });
  return new Response(body, { status: 200, headers: { etag: '"new"' } });
}

test('RD7, Nov 27: a body cut mid-download twice is asked a third time after a longer pause, and saved', async () => {
  const { seen, error } = await oneExtract((n) => (n <= 2 ? cutAfter(2) : new Response('pbf bytes', { status: 200, headers: { etag: '"new"' } })));
  assert.equal(error, null, String(error));
  assert.equal(seen.asked.length, 3);
  assert.ok(seen.asked[2] - seen.asked[1] >= 5 * 60_000, 'the third try waits five minutes');
  assert.deepEqual(seen.exported, ['confirm', 'small'], 'the third try\'s download is filtered as any');
  assert.deepEqual(seen.logs.slice(0, 2), [
    'osm: us-west failed (us-west: the download broke off after 2.0 MB (terminated: other side closed (UND_ERR_SOCKET))); asking once more',
    'osm: us-west failed again (us-west: the download broke off after 2.0 MB (terminated: other side closed (UND_ERR_SOCKET))); asking a last time in 5 minutes',
  ]);
  assert.equal(seen.logs[2], 'osm: us-west downloaded');
});

test('PP3, Nov 27: a failure says what happened (a status, a dropped connection, a time-out), still the timeout the Wikidata adapter splits on', async () => {
  const pace = { pace: { perMinute: 60, userAgent: 'Test agent (+example)' } };
  const clock = fakeClock(0);
  const once = (answer: () => Promise<Response>) => politeFetch(pace, answer, clock)('https://example.org/q');
  const timeout = () => Promise.reject(Object.assign(new DOMException('The operation was aborted due to timeout', 'TimeoutError')));
  // CF2: the Wikidata adapter splits a cell on SourceTimeout; the same answers still are one, only their words changed.
  await assert.rejects(once(async () => new Response('', { status: 500 })), (e: Error) => e instanceof SourceTimeout && /^https:\/\/example\.org\/q answered 500$/.test(e.message));
  await assert.rejects(once(async () => new Response('', { status: 504 })), (e: Error) => e instanceof SourceTimeout && /answered 504/.test(e.message));
  await assert.rejects(once(() => Promise.reject(dropped())), (e: Error) => e instanceof SourceTimeout && e.message === 'https://example.org/q gave no answer (fetch failed: other side closed (UND_ERR_SOCKET))');
  await assert.rejects(once(timeout), (e: Error) => e instanceof SourceTimeout && /^https:\/\/example\.org\/q timed out \(The operation was aborted due to timeout\)$/.test(e.message));
  await assert.rejects(once(async () => new Response('', { status: 404 })), (e: Error) => !(e instanceof SourceTimeout) && /answered 404/.test(e.message));
  // An extract refused with a status is asked twice, as before: the third try is for a non-answer or a cut body.
  const polite = politeFetch(osm.declaration, async () => new Response('', { status: 404 }), clock);
  const refused = await oneExtract(() => polite(`https://download.geofabrik.de/north-america/us-west-latest.osm.pbf`), clock);
  assert.equal(refused.seen.asked.length, 2);
  assert.match(refused.error!.message, /us-west-latest\.osm\.pbf answered 404/);
  assert.match(refused.seen.logs[0], /^osm: us-west failed \(.*answered 404\); asking once more$/);
});

test('RD7, Nov 27: the third try fits the job: never begun after minute 150 of the OSM fetch, and cut there', async () => {
  const { LAST_TRY_WAIT_MS, LAST_TRY_BY_MS, lastTry } = await load('adapters/osm/extract');
  assert.equal(LAST_TRY_WAIT_MS, 5 * 60_000);
  assert.equal(LAST_TRY_BY_MS, 150 * 60_000);
  // Pure: what the third try may take, from when the fetch began and the time now; null when it would begin too late.
  assert.deepEqual(lastTry(0, 0), { wait: LAST_TRY_WAIT_MS, limit: LAST_TRY_BY_MS - LAST_TRY_WAIT_MS });
  assert.deepEqual(lastTry(0, 100 * 60_000), { wait: LAST_TRY_WAIT_MS, limit: 45 * 60_000 }, 'cut at minute 150');
  assert.equal(lastTry(0, LAST_TRY_BY_MS - LAST_TRY_WAIT_MS), null, 'a third try that would begin at minute 150 is not asked');
  assert.ok(lastTry(0, 0).limit <= DOWNLOAD_MAX_MS);
  // The job's 300 minutes hold the fetch's first 150 and what comes after (Wikidata before it, the libraries after).
  assert.match(readFileSync(join(ROOT, '.github/workflows/build.yml'), 'utf8'), /timeout-minutes: 300\n/);
  // An extract still failing at minute 146 is asked twice, and the log says why there is no third try.
  const late = fakeClock(0);
  const slow = politeFetch(osm.declaration, async () => { late.advance(73 * 60_000); throw dropped(); }, late);
  const r = await oneExtract(() => slow('https://download.geofabrik.de/north-america/us-west-latest.osm.pbf'), late);
  assert.equal(r.seen.asked.length, 2);
  assert.match(r.seen.logs.at(-1)!, /^osm: us-west failed again \(.*other side closed.*\); no third try this late in the run \(minute 146 of the OSM fetch\)$/);
  assert.ok(r.error);
});
