/// <reference types="node" />
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import type { Box } from '../src/adapter';
import { partOf, wikidata } from '../src/adapters/wikidata';
import { emptyRegistry } from '../src/conflate';
import type { Clock } from '../src/http';
import type { Pack } from '../src/package';
import { createRawStore, type RawStore } from '../src/rawStore';
import { run, type RunOptions } from '../src/runner';

// Changes first (docs/spec.md, CF1-CF6; decision 0120 in the app repo): written from the spec before the code. The new
// exports are loaded inside each test, so one that doesn't exist yet fails its own test only.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const adapterModule = (): Promise<Any> => import('../src/adapters/wikidata/index');

const ROOT = join(fileURLToPath(import.meta.url), '../..');
const FIX = join(ROOT, 'test/fixtures');
const AREA: Box[] = [[-76, 40, -72, 42]];
const FOLLY = 'Q180174';
const STATUE = 'Q179700';

function fakeClock(start: string): Clock {
  let t = Date.parse(start);
  return { now: () => t, sleep: async (ms) => { t += ms; } };
}
function counter() {
  let n = 0;
  return () => `p_${(++n).toString(16).padStart(16, '0')}`;
}
const entity = (id: string) => `http://www.wikidata.org/entity/${id}`;
const binding = (id: string, name: string, cls: string, lon: number, lat: number) => ({
  item: { value: entity(id) }, label: { value: name }, p31: { value: entity(cls) }, coord: { value: `Point(${lon} ${lat})` },
});
const answer = (bindings: object[]) => new Response(JSON.stringify({ results: { bindings } }), { status: 200 });

interface Handlers {
  /** A changes query's answer, by target (a class's Q-id, or NHL) and its since (null when asked whole). */
  changes?: (target: string, since: string | null) => object[];
  /** A held check's answer, by the ids asked. */
  held?: (ids: string[]) => object[];
}

/** The query service: cells from the fixtures, changes and held checks from the handlers; every query logged. */
function service(h: Handlers = {}) {
  const log: string[] = [];
  const http = async (_url: string, init: RequestInit) => {
    const q = decodeURIComponent(String(init.body).replace(/^query=/, ''));
    log.push(q);
    if (/VALUES \?item/.test(q)) return answer(h.held?.([...q.matchAll(/wd:(Q\d+)/g)].map((m) => m[1])) ?? []);
    const sw = /cornerSouthWest "Point\(([-\d.]+) ([-\d.]+)\)/.exec(q);
    if (sw) {
      const ne = /cornerNorthEast "Point\(([-\d.]+) ([-\d.]+)\)/.exec(q)!;
      try {
        return new Response(readFileSync(join(FIX, partOf([Number(sw[1]), Number(sw[2]), Number(ne[1]), Number(ne[2])])), 'utf8'), { status: 200 });
      } catch {
        return answer([]);
      }
    }
    const target = /wdt:P1435 wd:Q624232/.test(q) && !/wdt:P31 wd:Q/.test(q) ? 'NHL' : /wdt:P31 wd:(Q\d+)/.exec(q)?.[1] ?? '?';
    const since = /"([^"]+)"\^\^xsd:dateTime/.exec(q)?.[1] ?? null;
    return answer(h.changes?.(target, since) ?? []);
  };
  return { http, log };
}

const tmpStore = () => createRawStore(mkdtempSync(join(tmpdir(), 'cf-raw-')));

function opts(o: Partial<RunOptions> & { store: RawStore } & Record<string, unknown>): RunOptions {
  return {
    adapters: [wikidata], region: 'us', area: AREA, version: '20261109', registry: emptyRegistry(), edits: { remove: [], add: [] },
    fetch: true, http: service().http, clock: fakeClock('2026-11-09T07:17:00Z'), newId: counter(), ...o,
  } as RunOptions;
}

const names = (packs: Pack[]) => [...new Set(packs.flatMap((p) => p.places).map((p) => p.name))].sort();

/** A first run on Nov 2 (every cell swept), then the store and its registry for the next. */
async function firstRun() {
  const store = tmpStore();
  const r = await run(opts({ store, version: '20261102', clock: fakeClock('2026-11-02T07:17:00Z'), week: 45 }));
  return { store, first: r };
}
const isBox = (q: string) => /wikibase:box/.test(q);
const isHeld = (q: string) => /VALUES \?item/.test(q);
const isChanges = (q: string) => !isBox(q) && !isHeld(q);

test('CF1: with an earlier run, the fetch asks each class by country since it began, checks the held items, and no cell', async () => {
  const { ALL_TARGETS } = await adapterModule();
  const { store, first } = await firstRun();
  const { http, log } = service();
  const second = await run(opts({ store, http, registry: first.registry, week: 46 }));
  const changes = log.filter(isChanges);
  assert.equal(changes.length, ALL_TARGETS.length, 'one query per pinned class, and one for the landmarks');
  for (const q of changes) {
    assert.match(q, /wdt:P17 wd:Q30/);
    assert.match(q, /"2026-11-01T07:17:00Z"\^\^xsd:dateTime/, 'since the earlier run began, less a day');
  }
  const held = log.filter(isHeld);
  assert.ok(held.length >= 1 && held.every((q) => [...q.matchAll(/wd:Q\d+/g)].length <= 400));
  assert.equal(log.filter(isBox).length, 0, 'no cell: this week\'s sweep share holds none of the two');
  assert.deepEqual(names(second.packs), names(first.packs), 'nothing changed, so the same places');
});

test('CF2: a held item modified away, merged or deleted leaves; one modified and returned is replaced; the rest stay', async () => {
  const { store, first } = await firstRun();
  const { http } = service({
    changes: (target) => (target === FOLLY ? [binding('Q1001', 'Hessian Folly Tower', FOLLY, -75.2, 40.7)] : []),
    held: (ids) => [
      ...(ids.includes('Q1001') ? [{ item: { value: entity('Q1001') }, m: { value: '2026-11-05T00:00:00Z' } }] : []),
      ...(ids.includes('Q1002') ? [{ item: { value: entity('Q1002') }, m: { value: '2026-11-05T00:00:00Z' } }] : []),
      ...(ids.includes('Q1008') ? [{ item: { value: entity('Q1008') } }] : []),
    ],
  });
  const second = await run(opts({ store, http, registry: first.registry, week: 46 }));
  assert.deepEqual(names(second.packs), ['Ghost Town Ruins', 'Hessian Folly Tower', 'Old Mill', 'Overlook Point'],
    'the monument left its classes, the duck is merged or deleted, the folly was renamed');
});

test('CF3: a class the earlier run did not ask is asked once across the country; the others only for changes', async () => {
  const { ALL_TARGETS } = await adapterModule();
  const { store, first } = await firstRun();
  store.setMeta('wikidata', '20261102', 'asked', JSON.stringify(ALL_TARGETS.filter((t: string) => t !== STATUE)));
  const { http, log } = service();
  await run(opts({ store, http, registry: first.registry, week: 46 }));
  const statue = log.filter((q) => isChanges(q) && q.includes(`wd:${STATUE}`));
  assert.equal(statue.length, 1);
  assert.ok(!/xsd:dateTime/.test(statue[0]), 'the new class is asked whole');
  assert.ok(log.filter((q) => isChanges(q) && q.includes(`wd:${FOLLY}`)).every((q) => /xsd:dateTime/.test(q)));
  assert.ok(JSON.parse(store.meta('wikidata', '20261109').asked).includes(STATUE), 'recorded as asked');
});

test('CF3: an earlier run with no note of what it asked (from before the note existed) did not ask the National Register listings: they are asked whole', async () => {
  // Found Nov 11 (Harrisburg's State Street Bridge): run 3 swept the cells before the listing target existed and left no
  // `asked` note; run 5 took that as "every target", asked the listings only for changes (about 70 items) and never
  // fetched the rest, so no Register-only place reached a pack. The target was added after the note, so a run with no
  // note cannot have asked it.
  const { store, first } = await firstRun();
  store.setMeta('wikidata', '20261102', 'asked', '');
  const { http, log } = service();
  await run(opts({ store, http, registry: first.registry, week: 46 }));
  const listing = log.filter((q) => isChanges(q) && /\?hl ps:P1435/.test(q));
  assert.equal(listing.length, 1, 'the Register listings are asked once across the country');
  assert.ok(!/xsd:dateTime/.test(listing[0]), 'asked whole, not for changes since the earlier run');
  const others = log.filter((q) => isChanges(q) && !/\?hl ps:P1435/.test(q));
  assert.ok(others.length > 0 && others.every((q) => /xsd:dateTime/.test(q)), 'every other target is asked only for changes');
  assert.ok(JSON.parse(store.meta('wikidata', '20261109').asked).includes('NRHP'), 'recorded as asked');
});

test('CF4: no earlier run sweeps every cell; a box sweeps its cells only and keeps the clock; the weekly share is one in thirteen', async () => {
  const { sweepShare } = await adapterModule();
  const { http: h1, log: first } = service();
  const store = tmpStore();
  const r1 = await run(opts({ store, http: h1, version: '20261102', clock: fakeClock('2026-11-02T07:17:00Z'), week: 45 }));
  assert.equal(first.filter(isBox).length, 2, 'both cells of the area');
  const { http: h2, log: byHand } = service({ held: () => [] });
  const r2 = await run(opts({ store, http: h2, registry: r1.registry, version: '20261105', clock: fakeClock('2026-11-05T07:17:00Z'), box: [-76, 40, -74, 42] }));
  assert.equal(byHand.filter(isBox).length, 1, 'only the box\'s cell');
  assert.equal(byHand.filter(isChanges).length, 0, 'a sweep by hand asks no changes');
  assert.ok(names(r2.packs).includes('Big Duck'), 'the other cell is carried');
  const { http: h3, log: weekly } = service();
  await run(opts({ store, http: h3, registry: r2.registry, week: 46 }));
  assert.ok(weekly.filter(isChanges).every((q) => q.includes('"2026-11-01T07:17:00Z"')), 'the changes clock is still the Nov 2 run\'s');
  const cells = Array.from({ length: 26 }, (_, i) => i);
  for (const week of [1, 7, 46]) {
    const share = sweepShare(cells.length, week);
    assert.equal(share.length, 2);
    assert.ok(share.every((i: number) => i % 13 === week % 13));
  }
});

test('CF5: answers are carried with their time and hash; the newest answer about an item wins; one every cell was swept since is dropped', async () => {
  const { store, first } = await firstRun();
  const { http } = service({ held: () => [] });
  await run(opts({ store, http, registry: first.registry, week: 46 }));
  const before = new Map(store.parts('wikidata', '20261102').map((p) => [p.part, p]));
  const carried = store.parts('wikidata', '20261109').filter((p) => p.part.startsWith('cell_'));
  assert.equal(carried.length, 2);
  for (const p of carried) {
    assert.equal((p as Any).carriedFrom, '20261102');
    assert.deepEqual([p.sha256, p.fetchedAt], [before.get(p.part)!.sha256, before.get(p.part)!.fetchedAt]);
  }
  const { settleParts } = await adapterModule();
  const cell = (fetchedAt: string, rows: object[]) => ({ part: partOf([-76, 40, -74, 42]), fetchedAt, raw: JSON.stringify({ results: { bindings: rows } }) });
  const changes = (fetchedAt: string, rows: object[]) => ({ part: `changes_20261109_${FOLLY}_Q30.json`, fetchedAt, raw: JSON.stringify({ results: { bindings: rows } }) });
  const old = cell('2026-11-02T07:17:00.000Z', [binding('Q1001', 'Hessian Folly', FOLLY, -75.2, 40.7)]);
  const renamed = changes('2026-11-09T07:17:00.000Z', [binding('Q1001', 'Hessian Folly Tower', FOLLY, -75.2, 40.7)]);
  const swept = cell('2026-11-12T07:17:00.000Z', [binding('Q1001', 'Hessian Folly', FOLLY, -75.2, 40.7)]);
  const nameOf = (parts: object[]) => settleParts(parts, AREA).map((c: { name: string }) => c.name);
  assert.deepEqual(nameOf([renamed, old]), ['Hessian Folly Tower'], 'a newer changes answer wins, whatever the order given');
  assert.deepEqual(nameOf([old, renamed, swept]), ['Hessian Folly'], 'a newer sweep of the cell wins');
  assert.deepEqual(nameOf([swept, renamed, old]), nameOf([old, renamed, swept]), 'the same answers settle the same');
  const added = changes('2026-11-09T07:17:00.000Z', [binding('Q2000', 'New Folly', FOLLY, -75.3, 40.8)]);
  assert.deepEqual(nameOf([old, added, swept]), ['Hessian Folly'], 'a sweep replaces what earlier answers said inside its cell');
});

test('CF6: a push that changes the edits or the classes rebuilds (amended by RB3: it fetches only what is stale)', () => {
  const wf = readFileSync(join(ROOT, '.github/workflows/weekly-build.yml'), 'utf8');
  const push = /\n  push:\n([\s\S]*?)\n  [a-z_]+:/.exec(`${wf.split('\njobs:')[0]}\n  end:`)?.[1] ?? '';
  assert.ok(push.includes('edits.json'), 'pushes to edits.json rebuild');
  assert.ok(push.includes("'src/**'"), 'pushes to the classes (src/adapters/wikidata/classify.mjs, src/classes.ts) rebuild');
  assert.match(wf, /github\.event_name == 'push'[\s\S]{0,200}--fetch-stale/, 'a push fetches only the stale sources: the edits alone fetch nothing (RB3)');
  assert.match(wf, /workflow_dispatch:\n\s+inputs:\n\s+box:/, 'a sweep by hand takes a box');
});
