/// <reference types="node" />
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { test } from 'node:test';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { PMTiles, type RangeResponse, type Source } from 'pmtiles';
import type { Adapter, Box } from '../src/adapter';
import { partOf, wikidata } from '../src/adapters/wikidata';
import { emptyRegistry } from '../src/conflate';
import { politeFetch, RETRY_CAP_S, type Clock } from '../src/http';
import { blocksOf, type Pack } from '../src/package';
import { decide } from '../src/publish';
import { createRawStore, type RawStore } from '../src/rawStore';
import { checkAdapters, declarationProblems, redistributable, run, type RunOptions } from '../src/runner';
import { CandidateSchema as Candidate, jsonSchema, PlaceSchema as Place, type Declaration } from '../src/schema';

// The places pipeline (docs/spec.md; decision 0108 in the app repo): the frame, with Wikidata behind it.

const ROOT = join(fileURLToPath(import.meta.url), '../..');
const FIX = join(ROOT, 'test/fixtures');
const AREA: Box[] = [[-76, 40, -72, 42]];
const fixture = (cell: Box) => readFileSync(join(FIX, partOf(cell)), 'utf8');

/** A clock that never waits: sleeping moves it on. */
function fakeClock(start = Date.parse('2026-11-09T07:17:00Z')): Clock & { slept: number[] } {
  let t = start;
  const slept: number[] = [];
  return { now: () => t, sleep: async (ms) => { slept.push(ms); t += ms; }, slept };
}

/** IDs p_0000000000000001, p_…02, … */
function counter(from = 0) {
  let n = from;
  return () => `p_${(++n).toString(16).padStart(16, '0')}`;
}

/** The query service, answering each cell's query from the fixtures by its south-west corner. */
function fakeWdqs(calls: string[] = []) {
  return async (url: string, init: RequestInit) => {
    calls.push(url);
    const q = decodeURIComponent(String(init.body).replace(/^query=/, ''));
    const sw = /cornerSouthWest "Point\(([-\d.]+) ([-\d.]+)\)/.exec(q)!;
    const ne = /cornerNorthEast "Point\(([-\d.]+) ([-\d.]+)\)/.exec(q)!;
    const cell: Box = [Number(sw[1]), Number(sw[2]), Number(ne[1]), Number(ne[2])];
    let body = '{"results":{"bindings":[]}}';
    try {
      body = fixture(cell);
    } catch {
      // A cell with no fixture answers empty.
    }
    return new Response(body, { status: 200, headers: { 'content-type': 'application/sparql-results+json' } });
  };
}

const tmpStore = () => createRawStore(mkdtempSync(join(tmpdir(), 'pp-raw-')));

function opts(o: Partial<RunOptions> & { store: RawStore }): RunOptions {
  return {
    adapters: [wikidata],
    region: 'us',
    area: AREA,
    version: '20261109',
    registry: emptyRegistry(),
    edits: { remove: [], add: [] },
    fetch: true,
    http: fakeWdqs(),
    clock: fakeClock(),
    newId: counter(),
    ...o,
  };
}

const placesOf = (packs: Pack[]) => packs.flatMap((p) => p.places).map((p) => ({ name: p.name, at: p.at, class: p.class })).sort((a, b) => (a.name < b.name ? -1 : 1));

/** An adapter whose raw answers are given candidates, for runs that need no network. */
function listAdapter(decl: Partial<Declaration> & { name: string }, rows: unknown[], opt: { failFetch?: boolean } = {}): Adapter {
  return {
    declaration: { ...wikidata.declaration, code: decl.name.replace(/[^a-z]/g, '').slice(0, 8) || 'xx', ...decl } as Declaration,
    async fetch(ctx) {
      if (opt.failFetch) throw new Error('down');
      ctx.put('rows.json', JSON.stringify(rows));
    },
    adapt: (raw) => JSON.parse(raw) as unknown[],
  };
}

const cand = (source: string, sourceId: string, name: string, at: [number, number], extra: Record<string, unknown> = {}) => ({
  source, sourceId, name, at, class: 'folly', signals: {}, fetchedAt: '2026-11-09T07:17:00.000Z', ...extra,
});

const memory = (buf: Uint8Array): Source => ({
  getKey: () => 'memory',
  getBytes: async (offset: number, length: number): Promise<RangeResponse> => ({ data: buf.slice(offset, offset + length).buffer as ArrayBuffer }),
});

async function featuresIn(pack: Pack) {
  const pm = new PMTiles(memory(pack.bytes));
  const out: Record<string, unknown>[][] = [];
  const header = await pm.getHeader();
  const seen = new Set<string>();
  for (const p of pack.places) {
    const n = 2 ** header.maxZoom;
    const r = (p.at[1] * Math.PI) / 180;
    const x = Math.floor(((p.at[0] + 180) / 360) * n);
    const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
    if (seen.has(`${x}/${y}`)) continue;
    seen.add(`${x}/${y}`);
    const t = await pm.getZxy(header.maxZoom, x, y);
    const layer = new VectorTile(new PbfReader(new Uint8Array(t!.data))).layers.places;
    out.push(Array.from({ length: layer.length }, (_, i) => layer.feature(i).properties as Record<string, unknown>));
  }
  return out;
}

test('PP1: an adapter without its full declaration is refused, and its declared allowed uses are enforced', async () => {
  for (const field of ['name', 'code', 'license', 'licenseFamily', 'attribution', 'role', 'hosts', 'pace', 'allowed', 'termsChecked'] as const) {
    const decl: Record<string, unknown> = { ...wikidata.declaration };
    delete decl[field];
    assert.ok(declarationProblems(decl).some((p) => p.startsWith(field)), `missing ${field} is named`);
    assert.throws(() => checkAdapters([{ ...wikidata, declaration: decl as Declaration }]), new RegExp(field));
  }
  assert.deepEqual(declarationProblems(wikidata.declaration), []);
  const nominator = { ...wikidata.declaration, name: 'forum', role: 'nominates' as const, allowed: { ...wikidata.declaration.allowed, reachPack: false } };
  assert.ok(declarationProblems(nominator).some((p) => p.startsWith('decision')), 'a nominating adapter names its decision record');
  assert.deepEqual(declarationProblems({ ...nominator, decision: '0108' }), []);
  assert.ok(declarationProblems({ ...nominator, decision: '0108', allowed: { ...nominator.allowed, reachPack: true } }).length, 'a nomination never reaches a pack');

  // A source that may not reach a pack adds nothing to one.
  const shy = listAdapter({ name: 'shy', allowed: { store: true, retentionDays: null, redistribute: true, reachPack: false } }, [cand('shy', '1', 'Hidden Folly', [-75, 41])]);
  const r = await run(opts({ store: tmpStore(), adapters: [shy] }));
  assert.equal(r.packs.length, 0);

  // Raw answers past their retention are deleted; a source that may not store keeps none past the run.
  const store = tmpStore();
  const short = listAdapter({ name: 'short', allowed: { store: true, retentionDays: 7, redistribute: true, reachPack: true } }, [cand('short', '1', 'A Folly', [-75, 41])]);
  const clock = fakeClock(Date.parse('2026-11-01T00:00:00Z'));
  await run(opts({ store, adapters: [short], version: '20261101', clock }));
  assert.deepEqual(store.runs('short'), ['20261101']);
  await run(opts({ store, adapters: [short], version: '20261109', clock: fakeClock(Date.parse('2026-11-09T00:00:00Z')) }));
  assert.deepEqual(store.runs('short'), ['20261109'], 'the run from 8 days ago is gone');
  const none = listAdapter({ name: 'none', allowed: { store: false, retentionDays: null, redistribute: false, reachPack: true } }, [cand('none', '1', 'B Folly', [-75, 41])]);
  const r2 = await run(opts({ store, adapters: [none] }));
  assert.equal(r2.packs[0].places.length, 1, 'its places still enter');
  assert.deepEqual(store.runs('none'), [], 'but its raw answers are not kept');

  // A source that may not be redistributed stays out of the published state.
  assert.deepEqual(redistributable([wikidata, none, short]), ['wikidata', 'short']);
});

test('PP2: only fetch touches the network; a rerun from the raw store makes no request', async () => {
  const store = tmpStore();
  const calls: string[] = [];
  const first = await run(opts({ store, http: fakeWdqs(calls) }));
  assert.equal(calls.length, 2, 'one query per cell');
  assert.deepEqual(store.parts('wikidata', '20261109').map((p) => p.part), [partOf([-74, 40, -72, 42]), partOf([-76, 40, -74, 42])].sort());
  const again = await run(opts({
    store,
    fetch: false,
    registry: first.registry,
    http: async () => assert.fail('a rerun from the raw store asks nothing'),
  }));
  assert.deepEqual(again.packs[0].places, first.packs[0].places);
});

test('PP3: each source is held to its declared pace, waits a Retry-After and sends its User-Agent', async () => {
  const clock = fakeClock(0);
  const seen: { t: number; ua: string | null }[] = [];
  let refuse = 1;
  const http = politeFetch({ pace: { perMinute: 30, userAgent: 'Test agent (+example)' } }, async (_u, init) => {
    seen.push({ t: clock.now(), ua: new Headers(init.headers).get('user-agent') });
    if (refuse-- > 0) return new Response('', { status: 429, headers: { 'retry-after': '5' } });
    return new Response('ok');
  }, clock);
  await Promise.all([http('https://example.org/a'), http('https://example.org/b')]);
  assert.deepEqual(seen.map((s) => s.t), [0, 5000, 7000], 'a 429 waits its 5 s; then 2 s between requests (30 a minute)');
  assert.ok(seen.every((s) => s.ua === 'Test agent (+example)'));
  const capped = fakeClock(0);
  let once = true;
  const slow = politeFetch({ pace: { perMinute: 60, userAgent: 'Test agent (+example)' } }, async () => {
    if (once) { once = false; return new Response('', { status: 503, headers: { 'retry-after': '99999' } }); }
    return new Response('ok');
  }, capped);
  await slow('https://example.org/');
  assert.equal(Math.max(...capped.slept), RETRY_CAP_S * 1000, 'a huge Retry-After is capped');
  // Wikidata keeps its manners: one query at a time, a 1.5 s pause, its User-Agent naming the project.
  assert.equal(60_000 / wikidata.declaration.pace.perMinute, 1500);
  assert.match(wikidata.declaration.pace.userAgent, /Chronicles places build/);
});

test('PP4: a candidate that fails the schema is set aside with its reason and the run goes on', async () => {
  const a = listAdapter({ name: 'mixed' }, [cand('mixed', '1', 'Good Folly', [-75, 41]), { source: 'mixed', sourceId: '2', at: [-75, 41], signals: {}, fetchedAt: '2026-11-09T07:17:00.000Z' }]);
  const r = await run(opts({ store: tmpStore(), adapters: [a] }));
  assert.deepEqual(r.packs[0].places.map((p) => p.name), ['Good Folly']);
  assert.equal(r.report.setAside.length, 1);
  assert.match(r.report.setAside[0].reason, /name/);
});

test('PP5: every object in the schema is closed and the only numbers are a position; no score field passes at any depth', () => {
  const committed = JSON.parse(readFileSync(join(ROOT, 'contract/places.schema.json'), 'utf8'));
  assert.deepEqual(committed, JSON.parse(JSON.stringify(jsonSchema())), 'contract/places.schema.json is the export of schema.ts');
  const numbers: string[] = [];
  const walk = (node: unknown, path: string) => {
    if (!node || typeof node !== 'object') return;
    const n = node as Record<string, unknown>;
    if (n.type === 'object') assert.equal(n.additionalProperties, false, `${path} is closed`);
    if (n.type === 'number' || n.type === 'integer') numbers.push(path);
    for (const [k, v] of Object.entries(n)) walk(v, `${path}/${k}`);
  };
  for (const k of ['candidate', 'place', 'feature']) walk(committed[k], k);
  assert.deepEqual(numbers.sort(), ['candidate/properties/at/prefixItems/0', 'candidate/properties/at/prefixItems/1', 'place/properties/at/prefixItems/0', 'place/properties/at/prefixItems/1']);
  const ok = cand('wikidata', 'Q1', 'A Folly', [-75, 41]);
  assert.ok(Candidate.safeParse(ok).success);
  for (const f of ['count', 'rank', 'score', 'votes', 'likes', 'mentions', 'upvotes', 'followers', 'sitelinks', 'views']) {
    assert.equal(Candidate.safeParse({ ...ok, [f]: 3 }).success, false, `${f} at the top fails`);
    assert.equal(Candidate.safeParse({ ...ok, signals: { [f]: 3 } }).success, false, `${f} in signals fails`);
    assert.equal(Place.safeParse({ id: 'p_0000000000000001', name: 'A', at: [-75, 41], class: 'folly', gone: false, src: 'wd', license: 'cc0', [f]: 3 }).success, false, `${f} on a place fails`);
  }
  assert.equal(Candidate.safeParse({ ...ok, evidence: { upvotes: 3 } }).success, false, 'evidence is a string');
});

test('PP6: from the same Wikidata items the pipeline yields the same places, through a gate blind to sources', async () => {
  const expected = JSON.parse(readFileSync(join(FIX, 'expected-places.json'), 'utf8'));
  const r = await run(opts({ store: tmpStore() }));
  assert.deepEqual(placesOf(r.packs), expected, 'the places the places archive built from these items (frozen Nov 9; heritage_building renamed building_structure in contract v2, RD13)');
  const gateSrc = readFileSync(join(ROOT, 'src/gate.ts'), 'utf8');
  assert.doesNotMatch(gateSrc, /from '\.\/adapters|from '\.\/runner/, 'the gate imports no adapter');
  const gateFn = gateSrc.slice(gateSrc.indexOf('export function gate('), gateSrc.indexOf('\n}\n', gateSrc.indexOf('export function gate(')));
  assert.doesNotMatch(gateFn, /\.src\b|\.sources?\b|\.license\b|\.length/, 'the gate reads no source, license or number of sources');
  const rows = [cand('alpha', '1', 'One Folly', [-75, 41]), cand('alpha', '2', 'Gone Folly', [-75.1, 41], { signals: { gone: true } }), cand('alpha', '3', 'No Class', [-75.2, 41], { class: undefined })];
  const asAlpha = await run(opts({ store: tmpStore(), adapters: [listAdapter({ name: 'alpha' }, rows)] }));
  const asBeta = await run(opts({ store: tmpStore(), adapters: [listAdapter({ name: 'beta' }, rows.map((x) => ({ ...x, source: 'beta' })))] }));
  assert.deepEqual(placesOf(asBeta.packs), placesOf(asAlpha.packs), 'renaming a source changes no result');
  assert.deepEqual(placesOf(asAlpha.packs).map((p) => p.name), ['One Folly']);
});

test('PP7: a place needs a locating source, and nominations never change a pack', async () => {
  const nominator = (n: number) =>
    listAdapter({ name: 'forum', role: 'nominates', decision: '0108', allowed: { store: true, retentionDays: 30, redistribute: false, reachPack: false } },
      Array.from({ length: n }, (_, i) => cand('forum', `t${i}`, i % 2 ? 'Hessian Folly' : 'Corner Diner', [-75.2, 40.7], { evidence: `https://forum.example/t${i}` })));
  const builds = [];
  for (const n of [0, 1, 50]) builds.push(await run(opts({ store: tmpStore(), adapters: [wikidata, nominator(n)] })));
  assert.deepEqual(builds[1].packs[0].blocks, builds[0].packs[0].blocks);
  assert.deepEqual(builds[2].packs[0].blocks, builds[0].packs[0].blocks);
  assert.equal(builds[2].report.review.length, 50);
  assert.ok(!builds[2].packs[0].places.some((p) => p.name === 'Corner Diner'), 'a nomination alone never enters');
  assert.ok(!Object.keys(builds[2].registry.crosswalk).some((k) => k.startsWith('forum:')), 'nor reaches the crosswalk');
  assert.ok(!JSON.stringify(builds[2].registry.places).includes('Corner Diner'));
  // A place needs a position from a locating source.
  const noAt = listAdapter({ name: 'alpha' }, [{ ...cand('alpha', '1', 'Floating Folly', [0, 0]), at: undefined }]);
  assert.equal((await run(opts({ store: tmpStore(), adapters: [noAt] }))).packs.length, 0);
  // A confirming source can only confirm a place or mark it gone.
  const confirms = (gone: boolean) => listAdapter({ name: 'register', role: 'confirms' }, [cand('register', 'r1', 'Hessian Folly', [-75.2, 40.7], { sameAs: ['wikidata:Q1001'], signals: { gone } })]);
  const confirmed = await run(opts({ store: tmpStore(), adapters: [wikidata, confirms(false)] }));
  assert.deepEqual(confirmed.packs[0].blocks, builds[0].packs[0].blocks, 'a confirmation changes nothing in a pack');
  const denied = await run(opts({ store: tmpStore(), adapters: [wikidata, confirms(true)] }));
  assert.ok(!denied.packs[0].places.some((p) => p.name === 'Hessian Folly'), 'a denial removes it');
});

test('PP8: places keep their opaque IDs across builds; a dropped place\'s ID is retired, never reused', async () => {
  const rows = [cand('alpha', '1', 'One Folly', [-75, 41]), cand('alpha', '2', 'Two Folly', [-75.5, 41.5])];
  const ids = (r: { packs: Pack[] }) => Object.fromEntries(r.packs[0].places.map((p) => [p.name, p.id]));
  const b1 = await run(opts({ store: tmpStore(), adapters: [listAdapter({ name: 'alpha' }, rows)], newId: counter() }));
  for (const p of b1.packs[0].places) assert.match(p.id, /^p_[0-9a-f]{16}$/);
  const b2 = await run(opts({ store: tmpStore(), adapters: [listAdapter({ name: 'alpha' }, rows)], registry: b1.registry, newId: counter(100) }));
  assert.deepEqual(ids(b2), ids(b1), 'the same IDs next build');
  const renamed = await run(opts({ store: tmpStore(), adapters: [listAdapter({ name: 'alpha' }, [{ ...rows[0], name: 'One Folly (restored)' }, rows[1]])], registry: b1.registry, newId: counter(100) }));
  assert.equal(ids(renamed)['One Folly (restored)'], ids(b1)['One Folly'], 'a renamed item keeps its ID by its source ID');
  assert.equal(b1.registry.crosswalk['alpha:1'], ids(b1)['One Folly']);
  // Two Folly is dropped; a new place must not get its ID, even when the generator offers it first.
  const retired = ids(b1)['Two Folly'];
  const b3 = await run(opts({ store: tmpStore(), adapters: [listAdapter({ name: 'alpha' }, [rows[0], cand('alpha', '3', 'Three Folly', [-74.5, 40.5])])], registry: b1.registry, newId: (() => { const seq = [retired, 'p_00000000000000ff']; return () => seq.shift()!; })() }));
  assert.equal(b3.registry.places[retired].retired, true);
  assert.equal(ids(b3)['Three Folly'], 'p_00000000000000ff');
  // A different item that moved and was renamed is a new place.
  const b4 = await run(opts({ store: tmpStore(), adapters: [listAdapter({ name: 'alpha' }, [rows[0], cand('alpha', '9', 'Elsewhere', [-74.9, 41.9])])], registry: b1.registry, newId: counter(200) }));
  assert.ok(!Object.values(ids(b1)).includes(ids(b4).Elsewhere));
});

test('PP9: a pack feature holds exactly name, class, src and id, in ID order, one license family per pack', async () => {
  const r = await run(opts({ store: tmpStore(), adapters: [listAdapter({ name: 'alpha' }, [cand('alpha', '1', 'B Folly', [-75.2, 40.7]), cand('alpha', '2', 'A Folly', [-75.2001, 40.7001])])] }));
  const tiles = await featuresIn(r.packs[0]);
  for (const tile of tiles) {
    for (const f of tile) assert.deepEqual(Object.keys(f).sort(), ['class', 'id', 'name', 'src']);
    assert.deepEqual(tile.map((f) => f.id), [...tile.map((f) => String(f.id))].sort(), 'in ID order');
  }
  // A confirming source added to a place leaves its feature and its place in the order unchanged.
  const withConfirm = await run(opts({ store: tmpStore(), adapters: [listAdapter({ name: 'alpha' }, [cand('alpha', '1', 'B Folly', [-75.2, 40.7]), cand('alpha', '2', 'A Folly', [-75.2001, 40.7001])]), listAdapter({ name: 'register', role: 'confirms' }, [cand('register', 'x', 'A Folly', [-75.2001, 40.7001], { sameAs: ['alpha:2'] })])] }));
  assert.deepEqual(await featuresIn(withConfirm.packs[0]), tiles);
  // An ODbL source and a CC0 source go to separate packs.
  const mixed = await run(opts({ store: tmpStore(), adapters: [listAdapter({ name: 'alpha' }, [cand('alpha', '1', 'Open Folly', [-75.2, 40.7])]), listAdapter({ name: 'osm', licenseFamily: 'odbl', license: 'ODbL 1.0' }, [cand('osm', 'n1', 'Shared Folly', [-75.6, 41])])] }));
  assert.deepEqual(mixed.packs.map((p) => [p.region, p.license, p.places.map((q) => q.name)]), [['us', 'cc0', ['Open Folly']], ['usodbl', 'odbl', ['Shared Folly']]]);
});

test('PP10: the owner\'s edits remove and add places after the gate', async () => {
  const r = await run(opts({ store: tmpStore(), edits: { remove: [{ name: 'Big Duck', at: [-72.6, 40.9] }], add: [{ name: 'My Folly', at: [-75.4, 40.6], class: 'folly' }] } }));
  const names = r.packs[0].places.map((p) => p.name);
  assert.ok(!names.includes('Big Duck'));
  assert.ok(names.includes('My Folly'));
  assert.equal(r.packs[0].places.find((p) => p.name === 'My Folly')!.src, 'owner');
});

test('PP11: a block\'s hash changes when, and only when, a place inside it changes', () => {
  const p = (id: string, name: string, at: [number, number]) => ({ id, name, at, class: 'folly', gone: false, src: 'wd', license: 'cc0' as const });
  const a = p('p_0000000000000001', 'East Folly', [-75.2, 40.7]);
  const b = p('p_0000000000000002', 'West Folly', [-80.1, 35.2]);
  const base = blocksOf([a, b]);
  assert.equal(Object.keys(base).length, 2);
  assert.deepEqual(blocksOf([b, a]), base, 'order does not matter');
  const renamed = blocksOf([{ ...a, name: 'East Folly Restored' }, b]);
  const changed = Object.keys(base).filter((k) => base[k] !== renamed[k]);
  assert.equal(changed.length, 1, 'only the renamed place\'s block changes');
});

test('PP12: a run in which no place changed publishes nothing', async () => {
  const store = tmpStore();
  const first = await run(opts({ store }));
  const blocks = first.packs[0].blocks;
  const manifest = { schema: 1, regions: [{ id: 'us', current: { file: 'places-us-20261109.pmtiles', version: '20261109', bounds: [-125, 24, -66, 50], blocks } }] };
  const second = await run(opts({ store: tmpStore(), registry: first.registry, version: '20261116' }));
  assert.deepEqual(decide({ region: 'us', blocks: second.packs[0].blocks, manifest }), { publish: false, reason: 'unchanged' });
  assert.deepEqual(decide({ region: 'us', blocks: { ...blocks, '8/1/1': 'x' }, manifest }), { publish: true, reason: 'changed' });
  assert.deepEqual(decide({ region: 'us', blocks, manifest: { schema: 1, regions: [{ id: 'us', current: { file: 'f', version: 'v', bounds: [0, 0, 0, 0] } }] } }), { publish: true, reason: 'no blocks yet' });
  assert.deepEqual(decide({ region: 'us', blocks, manifest: null, unreachable: true }), { publish: false, reason: 'manifest unreachable' });
  assert.deepEqual(decide({ region: 'us', blocks: null, manifest }), { publish: false, reason: 'no archive built' });
});

test('PP14: a failing source falls back to its last raw snapshot, is reported, and the run publishes', async () => {
  const store = tmpStore();
  await run(opts({ store, version: '20261102' }));
  const down = { ...wikidata, fetch: async () => { throw new Error('query service down'); } };
  const r = await run(opts({ store, adapters: [down], version: '20261109' }));
  assert.equal(r.report.sources[0].fellBack, '20261102');
  assert.match(r.report.sources[0].error!, /down/);
  assert.equal(r.packs[0].places.length, 6);
  // With no earlier answers the source adds nothing, and the others still build.
  const r2 = await run(opts({ store: tmpStore(), adapters: [down, listAdapter({ name: 'alpha' }, [cand('alpha', '1', 'Still Here', [-75, 41])])] }));
  assert.deepEqual(r2.packs[0].places.map((p) => p.name), ['Still Here']);
  assert.equal(r2.report.sources[0].fellBack, 'none');
});

test('PP15: the weekly workflow runs the stages in order, keeps the state asset and stays within one 6-hour job', async () => {
  // The job's own steps, as chronicles-data's weekly workflow runs them: restore the state, run the command line
  // (asking nothing here: --no-fetch reads the restored raw store), save the state, publish what changed.
  const state = mkdtempSync(join(tmpdir(), 'pp-state-'));
  const raw = createRawStore(join(state, 'raw'));
  for (const r of ['20261012', '20261019', '20261026', '20261102']) {
    for (const cell of [[-76, 40, -74, 42], [-74, 40, -72, 42]] as Box[]) raw.put('wikidata', r, partOf(cell), fixture(cell), `${r.slice(0, 4)}-${r.slice(4, 6)}-${r.slice(6)}T07:17:00.000Z`);
    raw.complete('wikidata', r);
  }
  const cli = (version: string, out: string, manifestUrl?: string) =>
    new Promise<Record<string, string>>((resolve, reject) => {
      const args = ['--import', 'tsx', join(ROOT, 'src/cli.ts'), '--region', 'us', '--version', version, '--state', state, '--out', out, '--no-fetch', ...(manifestUrl ? ['--manifest-url', manifestUrl] : [])];
      execFile(process.execPath, args, { cwd: ROOT }, (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr || String(err)));
        resolve(Object.fromEntries(stdout.trim().split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])));
      });
    });
  const out1 = mkdtempSync(join(tmpdir(), 'pp-out-'));
  const first = await cli('20261109', out1);
  assert.equal(first.publish, 'true');
  assert.equal(first.files, 'places-us-20261109.pmtiles');
  assert.equal(first['state-sources'], 'wikidata osm', 'only redistributable sources go in the saved state (OSM since RD7: ODbL allows it, with attribution)');
  assert.deepEqual(raw.runs('wikidata'), ['20261019', '20261026', '20261102'], 'the state keeps three runs');
  const registry1 = readFileSync(join(state, 'registry-us.json'), 'utf8');
  const blocks = JSON.parse(readFileSync(join(out1, 'places-us-20261109.blocks.json'), 'utf8'));
  // The live manifest, as the Pages workflow writes it from the release.
  const server = createServer((_q, res) => res.end(JSON.stringify({ schema: 1, regions: [{ id: 'us', current: { file: 'places-us-20261109.pmtiles', version: '20261109', bounds: [-125, 24, -66, 50], blocks } }] })));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  try {
    const out2 = mkdtempSync(join(tmpdir(), 'pp-out-'));
    const second = await cli('20261116', out2, `http://127.0.0.1:${(server.address() as { port: number }).port}/manifest.json`);
    assert.equal(second.publish, 'false', 'nothing changed: nothing published');
    assert.equal(second.reason, 'us: unchanged');
    assert.deepEqual(readdirSync(out2), ['report.json']);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(state, 'registry-us.json'), 'utf8')).places), Object.keys(JSON.parse(registry1).places), 'the restored registry keeps every ID');
  } finally {
    server.close();
  }
});
