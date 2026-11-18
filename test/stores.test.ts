/// <reference types="node" />
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { PMTiles, type RangeResponse, type Source } from 'pmtiles';
import type { Adapter, FetchContext } from '../src/adapter';
import { CONTRACT_VERSION } from '../src/classes';
import { emptyRegistry } from '../src/conflate';
import { createRawStore } from '../src/rawStore';
import { run } from '../src/runner';

// The stores pack (docs/stores/spec.md, ST1-ST10). Written before the code. The store modules are loaded by a path
// TypeScript doesn't resolve (the file was first committed while they did not exist).
const ROOT = join(fileURLToPath(import.meta.url), '../..');
const FIX = join(ROOT, 'test/fixtures');
const SHOPS = readFileSync(join(FIX, 'osm-shops.geojsonl'), 'utf8');
const AT = '2026-11-09T07:17:00.000Z';

/* eslint-disable @typescript-eslint/no-explicit-any */
const load = (p: string): Promise<any> => import(String(`../src/${p}`));
const counter = () => {
  let n = 0;
  return () => `s_${(++n).toString(16).padStart(16, '0')}`;
};
const placeIds = () => {
  let n = 0;
  return () => `p_${(++n).toString(16).padStart(16, '0')}`;
};
const memory = (buf: Uint8Array): Source => ({
  getKey: () => 'memory',
  getBytes: async (offset: number, length: number): Promise<RangeResponse> => ({ data: buf.slice(offset, offset + length).buffer as ArrayBuffer }),
});
async function featuresOf(bytes: Uint8Array, layer: string) {
  const pm = new PMTiles(memory(bytes));
  const h = await pm.getHeader();
  const out: Record<string, unknown>[] = [];
  // Read every tile by walking the bounds' tile range at the pack's zoom.
  const n = 2 ** h.maxZoom;
  const tile = (lon: number, lat: number) => {
    const r = (lat * Math.PI) / 180;
    return [Math.floor(((lon + 180) / 360) * n), Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)];
  };
  const [x0, y1] = tile(h.minLon, h.minLat);
  const [x1, y0] = tile(h.maxLon, h.maxLat);
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    const t = await pm.getZxy(h.maxZoom, x, y);
    if (!t) continue;
    const l = new VectorTile(new PbfReader(new Uint8Array(t.data))).layers[layer];
    for (let i = 0; i < l.length; i++) out.push(l.feature(i).properties as Record<string, unknown>);
  }
  return out;
}
const good = { id: 's_0000000000000001', name: 'Old Tin Antiques', at: [-75.37, 40.61], facets: { what: ['antiques'] }, src: 'osm' };
const walk = (s: any, f: (o: any) => void) => {
  if (s && typeof s === 'object') {
    f(s);
    for (const v of Object.values(s)) walk(v, f);
  }
};

test('ST1: a store holds exactly id, name, position, facets and src; every other field fails, at any depth', async () => {
  const { StoreSchema, storesJsonSchema } = await load('stores/schema');
  assert.ok(StoreSchema.safeParse(good).success);
  for (const extra of ['rating', 'reviewCount', 'priceLevel', 'popularity', 'footTraffic', 'photo', 'openNow', 'hours', 'sitelinks', 'whatever']) {
    assert.ok(!StoreSchema.safeParse({ ...good, [extra]: 1 }).success, `${extra} fails`);
    assert.ok(!StoreSchema.safeParse({ ...good, facets: { ...good.facets, [extra]: ['x'] } }).success, `facets.${extra} fails`);
  }
  assert.ok(!StoreSchema.safeParse({ ...good, id: 'p_0000000000000001' }).success, 'a place id is not a store id');
  assert.ok(!StoreSchema.safeParse({ ...good, at: [-75.37, 40.61, 3] }).success, 'no third number');
  const schema = storesJsonSchema();
  for (const part of [schema.record, schema.feature]) {
    walk(part, (o) => {
      if (o.type === 'object' && o.properties) assert.equal(o.additionalProperties, false, 'every object is closed');
    });
  }
  const numbers: string[] = [];
  walk(schema.record, (o) => {
    if (o.type === 'number' || o.type === 'integer') numbers.push(JSON.stringify(o));
  });
  assert.equal(numbers.length, 2, 'only the two of a position');
});

test('ST2: `what` has a closed list, `how` and `hours` are reserved and not emitted, an unknown value fails, clients ignore the unknown', async () => {
  const { DIMENSIONS, RESERVED_FIELDS } = await load('stores/dimensions');
  const { StoreSchema, storesJsonSchema } = await load('stores/schema');
  assert.deepEqual(DIMENSIONS.what, { emitted: true, values: ['antiques', 'vintage', 'books', 'records', 'maps', 'art_supplies', 'crafts', 'second_hand'] });
  assert.deepEqual(DIMENSIONS.how, { emitted: false, values: ['vintage', 'thrift', 'new'] });
  assert.deepEqual(RESERVED_FIELDS, ['hours']);
  assert.ok(!StoreSchema.safeParse({ ...good, facets: { what: ['antiques'], how: ['vintage'] } }).success, 'how is not emitted');
  assert.ok(!StoreSchema.safeParse({ ...good, facets: { what: ['groceries'] } }).success, 'an unknown value fails the build');
  assert.ok(!StoreSchema.safeParse({ ...good, facets: { what: [] } }).success, 'one or more');
  assert.ok(!StoreSchema.safeParse({ ...good, facets: { what: ['books', 'books'] } }).success, 'each once');
  assert.ok(!StoreSchema.safeParse({ ...good, facets: {} }).success, 'what is required');
  assert.ok(StoreSchema.safeParse({ ...good, facets: { what: ['books', 'records'] } }).success);
  const c = storesJsonSchema();
  assert.deepEqual(c.dimensions.how.emitted, false);
  assert.match(JSON.stringify(c.clients), /ignore/);
  assert.deepEqual(c.reserved, ['hours']);
});

test('ST3: the shop adapter maps OSM tags to facets from fixtures; no mapped `what`, or no name, is dropped', async () => {
  const { adaptShops } = await load('stores/osmShops');
  const { StoreCandidateSchema } = await load('stores/schema');
  const rows: any[] = adaptShops(SHOPS, AT);
  for (const r of rows) assert.ok(StoreCandidateSchema.safeParse(r).success, r.name);
  const what = Object.fromEntries(rows.map((r) => [r.name, r.facets.what]));
  assert.deepEqual(what, {
    'Old Tin Antiques': ['antiques'], 'Lehigh Books': ['books'], 'Spin Records': ['records'], Chartroom: ['maps'], 'Easel & Brush': ['art_supplies'],
    'Clay Bench': ['crafts'], 'Thread Shed': ['crafts'], 'Second Time Clothes': ['vintage'], 'Odd Lots': ['second_hand'], 'Helping Hands': ['second_hand'], 'Salvation Army Family Store': ['second_hand'],
    'Half Price Books': ['books'], 'Wide Antiques & Books': ['antiques', 'books'], 'Starred Books': ['books'], 'Goodwill Industries of the Valley': ['second_hand'],
  });
  for (const gone of ['Corner Bakery', 'Pottery Only']) assert.ok(!(gone in what), `${gone} has no mapped what`);
  assert.equal(rows.length, 15, 'the nameless shop is dropped too');
  const by = Object.fromEntries(rows.map((r) => [r.name, r]));
  assert.equal(by['Old Tin Antiques'].sourceId, 'node/1');
  assert.deepEqual(by['Old Tin Antiques'].at, [-75.37, 40.61]);
  assert.equal(by['Lehigh Books'].sourceId, 'way/2');
  assert.ok(Math.abs(by['Lehigh Books'].at[0] + 75.3709) < 0.0005 && Math.abs(by['Lehigh Books'].at[1] - 40.6121) < 0.0005, 'a way takes one position inside it');
  assert.equal(by['Wide Antiques & Books'].sourceId, 'relation/14');
  assert.deepEqual(adaptShops(SHOPS.split('\n').reverse().join('\n'), AT).map((r: any) => r.sourceId).sort(), rows.map((r) => r.sourceId).sort(), 'line order is free');
  assert.deepEqual(adaptShops('not json\n\n{"type":"Feature"}\n', AT), [], 'unreadable lines are skipped');
});

test('ST4: no rating, review, popularity, wikipedia or sitelink field is read', async () => {
  const { adaptShops, READS, SHOP_FILTER } = await load('stores/osmShops');
  const crowd = /rating|stars|review|popular|traffic|wikipedia|wikidata|sitelink|views|likes|checkin|visitors|price/i;
  for (const k of READS) assert.doesNotMatch(k, crowd);
  assert.deepEqual([...READS].sort(), ['@id', '@type', 'craft', 'name', 'second_hand', 'shop']);
  assert.doesNotMatch(JSON.stringify(SHOP_FILTER), crowd);
  const rows: any[] = adaptShops(SHOPS, AT);
  const starred = rows.find((r) => r.name === 'Starred Books');
  const plain = rows.find((r) => r.name === 'Lehigh Books');
  assert.deepEqual(Object.keys(starred).sort(), Object.keys(plain).sort());
  const bare = SHOPS.split('\n').filter(Boolean).map((l) => {
    const f = JSON.parse(l);
    if (f.properties.name === 'Starred Books') f.properties = { '@type': 'node', '@id': 15, name: 'Starred Books', shop: 'books' };
    return JSON.stringify(f);
  }).join('\n');
  assert.deepEqual(adaptShops(bare, AT), rows, 'the same rows without the crowd tags');
  const src = readFileSync(join(ROOT, 'src/stores/osmShops.ts'), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(src, /wikipedia|sitelink|rating|review/i, 'the code names no such key');
});

test('ST5: chains are not dropped at the build; no chain list, flag or field exists', async () => {
  const { gateStores } = await load('stores/gate');
  const { adaptShops } = await load('stores/osmShops');
  const { StoreSchema } = await load('stores/schema');
  const { kept, dropped } = gateStores(adaptShops(SHOPS, AT));
  assert.deepEqual(dropped, []);
  assert.equal(kept.length, 15);
  const names = kept.map((s: any) => s.name);
  for (const chain of ['Half Price Books', 'Goodwill Industries of the Valley', 'Salvation Army Family Store']) assert.ok(names.includes(chain), chain);
  for (const s of kept) assert.deepEqual(Object.keys(s).sort(), ['at', 'facets', 'fetchedAt', 'name', 'source', 'sourceId']);
  assert.ok(!StoreSchema.safeParse({ ...good, chain: true }).success, 'no chain flag on a record');
  const { readdirSync } = await import('node:fs');
  assert.ok(!readdirSync(join(ROOT, 'src/stores')).some((f) => /chain/i.test(f)), 'no chain list in the repo');
  assert.doesNotMatch(readFileSync(join(ROOT, 'src/stores/gate.ts'), 'utf8').replace(/\/\/.*$/gm, ''), /chain/i, 'the gate knows no chain');
});

async function osmRaw(parts: Record<string, string>) {
  const store = createRawStore(mkdtempSync(join(tmpdir(), 'st-raw-')));
  for (const [p, body] of Object.entries(parts)) store.put('osm', '20261109', p, body, AT);
  store.complete('osm', '20261109');
  return store;
}

test('ST6: stores never reach the places pack, its gate or its conflate', async () => {
  const { osm } = await load('adapters/osm');
  const locates: Adapter = {
    declaration: { ...osm.declaration, locates: undefined, name: 'fake', code: 'fk', role: 'locates', hosts: ['example.org'], pace: { perMinute: 60, userAgent: 'test agent string' } },
    async fetch(ctx) {
      ctx.put('rows.json', '[]');
    },
    adapt: () => [{ source: 'fake', sourceId: '1', name: 'A Folly', at: [-75.4, 40.7], class: 'folly', signals: {}, fetchedAt: AT }],
  };
  const build = async (withShops: boolean) => {
    const osmWith: Adapter = { ...osm, async fetch(ctx: FetchContext) {
      ctx.put('confirm-us-test.geojsonl', '');
      if (withShops) ctx.put('shops-us-test.geojsonl', SHOPS);
    } };
    return run({
      adapters: [locates, osmWith], region: 'us', area: [[-76, 40, -72, 42]], version: '20261109', store: createRawStore(mkdtempSync(join(tmpdir(), 'st-run-'))),
      registry: emptyRegistry(), edits: { remove: [], add: [] }, fetch: true, http: async () => { throw new Error('none'); },
      clock: { now: () => Date.parse(AT), sleep: async () => {} }, newId: placeIds(),
    });
  };
  const [a, b] = [await build(false), await build(true)];
  assert.equal(a.packs.length, 1);
  assert.deepEqual(b.packs.map((p) => [p.file, p.blocks, Buffer.from(p.bytes).toString('base64')]), a.packs.map((p) => [p.file, p.blocks, Buffer.from(p.bytes).toString('base64')]));
  assert.deepEqual(b.registry, a.registry);
  assert.deepEqual(b.report.review, a.report.review);
  assert.equal(b.report.setAside.length, 0);
  assert.deepEqual(osm.adapt(SHOPS, 'shops-us-test.geojsonl', AT), [], 'the places adapter reads nothing from a stores part');
  for (const f of ['gate.ts', 'conflate.ts', 'package.ts', 'runner.ts', 'schema.ts']) assert.doesNotMatch(readFileSync(join(ROOT, 'src', f), 'utf8'), /from '\.\/stores|stores\//, `${f} imports no stores code`);
  const { buildStores } = await load('stores/build');
  const r = buildStores({ store: await osmRaw({ 'shops-us-test.geojsonl': SHOPS }), run: '20261109', region: 'us', version: '20261109', registry: emptyRegistry(), newId: counter() });
  assert.equal(r.pack.stores.length, 15);
  assert.ok(r.pack.stores.every((s: any) => /^s_[0-9a-f]{16}$/.test(s.id)));
  assert.equal(buildStores({ store: await osmRaw({ 'confirm-us-test.geojsonl': '' }), run: '20261109', region: 'us', version: '20261109', registry: emptyRegistry(), newId: counter() }).pack, null, 'no shops part, no pack');
});

test('ST7: the stores pack is written through the archive writer and listed in the manifest as `stores`; absent when there is none', async () => {
  const { buildStores } = await load('stores/build');
  const { writeArchive } = await import(String('../src/archive.mjs'));
  const raw = await osmRaw({ 'shops-us-test.geojsonl': SHOPS });
  const r = buildStores({ store: raw, run: '20261109', region: 'us', version: '20261109', registry: emptyRegistry(), newId: counter() });
  const { pack } = r;
  assert.equal(pack.file, 'stores-us-20261109.pmtiles');
  assert.equal(pack.region, 'us');
  assert.ok(Object.keys(pack.blocks).every((k) => /^8\/\d+\/\d+$/.test(k)));
  const feats = await featuresOf(pack.bytes, 'stores');
  assert.equal(feats.length, 15);
  for (const f of feats) assert.deepEqual(Object.keys(f).sort(), ['id', 'name', 'src', 'what']);
  const wide = feats.find((f) => f.name === 'Wide Antiques & Books')!;
  assert.equal(wide.what, 'antiques,books');
  assert.equal(wide.src, 'osm');
  const reversed = buildStores({ store: await osmRaw({ 'shops-us-test.geojsonl': SHOPS.split('\n').reverse().join('\n') }), run: '20261109', region: 'us', version: '20261109', registry: emptyRegistry(), newId: counter() });
  assert.deepEqual(Object.keys(reversed.pack.blocks), Object.keys(pack.blocks));
  const sorted = (xs: any[]) => xs.map((s) => [s.name, s.facets, s.at]).sort((p, q) => (p[0] < q[0] ? -1 : 1));
  assert.deepEqual(sorted(reversed.pack.stores), sorted(pack.stores));
  // The same stores give the same bytes in any order.
  const rows = pack.stores.map((s: any) => ({ name: s.name, lon: s.at[0], lat: s.at[1], src: s.src, id: s.id, what: s.facets.what.join(',') }));
  const opts = { layer: 'stores', fields: ['name', 'src', 'id', 'what'], name: 'Chronicles stores', attribution: 'x' };
  assert.deepEqual(writeArchive(rows, opts), writeArchive([...rows].reverse(), opts));
  // The places pack is as it was: its example is pinned by the hash it has on main without the stores (taken at the merge, contract v4).
  const example = readFileSync(join(ROOT, 'contract/example/places-example-20261109.pmtiles'));
  assert.equal(createHash('sha256').update(example).digest('hex'), '8ccc55421ad1c5ae755fbdd19c0a93b055ca6d1abbcb96b519682dbfbc037f5d');

  const dir = mkdtempSync(join(tmpdir(), 'st-man-'));
  writeFileSync(join(dir, 'places-us-20261109.pmtiles'), example);
  writeFileSync(join(dir, 'places-us-20261109.blocks.json'), '{"8/1/1":"abc0123456789abc"}');
  const manifest = (d: string) => JSON.parse(execFileSync(process.execPath, [join(ROOT, 'scripts/manifest.mjs'), d], { encoding: 'utf8' }));
  const before = manifest(dir);
  assert.ok(!('stores' in before.regions[0]), 'no stores key without a stores pack');
  writeFileSync(join(dir, pack.file), pack.bytes);
  writeFileSync(join(dir, pack.file.replace('.pmtiles', '.blocks.json')), JSON.stringify(pack.blocks));
  writeFileSync(join(dir, pack.file.replace('.pmtiles', '.license')), 'odbl\n');
  writeFileSync(join(dir, 'stores-us-20261101.pmtiles'), pack.bytes);
  const after = manifest(dir);
  const { stores, ...rest } = after.regions[0];
  assert.deepEqual(rest, before.regions[0], 'the places entry is unchanged');
  assert.equal(stores.current.file, 'stores-us-20261109.pmtiles');
  assert.deepEqual(stores.current.blocks, pack.blocks);
  assert.equal(stores.current.license, 'odbl');
  assert.equal(stores.previous[0].file, 'stores-us-20261101.pmtiles');
  assert.equal(stores.current.sha256.length, 64);
});

test('ST8: the example pack, its records and the stores schema are published; the contract is bumped', async () => {
  const { contractFiles } = await load('contract');
  const { StoreSchema } = await load('stores/schema');
  assert.ok(CONTRACT_VERSION >= 3);
  const files: Map<string, string | Buffer> = await contractFiles();
  for (const f of ['stores.schema.json', 'example/stores-example-20261109.pmtiles', 'example/stores-example.json', 'example/manifest.json']) {
    assert.ok(files.has(f), f);
    assert.ok(readFileSync(join(ROOT, 'contract', f)).equals(Buffer.from(files.get(f)!)), `contract/${f} is committed as generated`);
  }
  const schema = JSON.parse(readFileSync(join(ROOT, 'contract/stores.schema.json'), 'utf8'));
  assert.equal(schema.contractVersion, CONTRACT_VERSION);
  assert.deepEqual(Object.keys(schema.dimensions), ['what', 'how']);
  assert.equal(JSON.parse(readFileSync(join(ROOT, 'contract/places.schema.json'), 'utf8')).contractVersion, CONTRACT_VERSION);
  const records = JSON.parse(readFileSync(join(ROOT, 'contract/example/stores-example.json'), 'utf8'));
  assert.ok(records.length >= 5);
  for (const chain of ['Goodwill Industries of the Valley', 'Salvation Army Family Store']) assert.ok(records.some((s: any) => s.name === chain), `the example holds ${chain}`);
  assert.ok(records.some((s: any) => s.facets.what.includes('second_hand')));
  for (const s of records) assert.ok(StoreSchema.safeParse(s).success, s.name);
  const feats = await featuresOf(new Uint8Array(readFileSync(join(ROOT, 'contract/example/stores-example-20261109.pmtiles'))), 'stores');
  assert.equal(feats.length, records.length);
  const m = JSON.parse(readFileSync(join(ROOT, 'contract/example/manifest.json'), 'utf8'));
  assert.equal(m.regions[0].stores.current.file, 'stores-example-20261109.pmtiles');
  const ms = JSON.parse(readFileSync(join(ROOT, 'contract/manifest.schema.json'), 'utf8'));
  assert.match(JSON.stringify(ms), /stores-/);
  assert.ok(!ms.properties.regions.items.required.includes('stores'), 'stores is optional');
});

test('ST9: the shops filter shares the OSM pass: no second download, no new host', async () => {
  const { osm, FILTER, SMALL_FILTER } = await load('adapters/osm');
  const { SHOP_FILTER } = await load('stores/osmShops');
  const { US_PARTS } = await load('adapters/osm/extract');
  assert.notEqual(SHOP_FILTER.name, FILTER.name);
  assert.deepEqual(osm.declaration.hosts, ['download.geofabrik.de']);
  const { fingerprint } = await load('fingerprint');
  const { GEOFABRIK } = await load('adapters/osm/extract');
  assert.equal(osm.fetchKey([]), fingerprint([GEOFABRIK, US_PARTS, FILTER, SMALL_FILTER, SHOP_FILTER]), 'the fingerprint covers the shops filter');
  assert.notEqual(osm.fetchKey([]), fingerprint([GEOFABRIK, US_PARTS, FILTER, SMALL_FILTER]));
  const urls: string[] = [];
  const carried: string[] = [];
  const metas: Record<string, string> = {};
  // SK11: each extract's kinds were counted by the earlier run, so it is asked for only if it changed.
  for (const p of US_PARTS) Object.assign(metas, { [`etag:${p}`]: `"${p}"`, [`shopCounts:${p}`]: '{}' });
  const prevParts = US_PARTS.flatMap((p: string) => [FILTER.name, SMALL_FILTER.name, SHOP_FILTER.name].map((n: string) => ({ part: `${n}-${p}.geojsonl`, sha256: 'x', fetchedAt: AT })));
  await osm.fetch({
    area: [], run: 'r2', put: () => { throw new Error('nothing is re-read'); }, log: () => {}, week: 1, box: null, keepClock: () => {}, setMeta: () => {},
    http: async (u: string) => { urls.push(u); return new Response(null, { status: 304 }); },
    carry: (p: string) => carried.push(p), sameFetch: true,
    previous: { run: 'r1', startedAt: AT, parts: prevParts, read: () => '', meta: metas },
  } as FetchContext);
  assert.equal(urls.length, US_PARTS.length, 'one request per extract, shops included');
  assert.equal(carried.length, US_PARTS.length * 3);
  assert.equal(new Set(carried.filter((c) => c.startsWith('shops-'))).size, US_PARTS.length);
  for (const f of ['src/stores/osmShops.ts', 'src/stores/build.ts']) assert.doesNotMatch(readFileSync(join(ROOT, f), 'utf8'), /geofabrik|fetch\(|http\(/i, `${f} downloads nothing`);
  const { RULES } = await load('stores/osmShops');
  const expr = JSON.stringify(SHOP_FILTER.expressions);
  for (const r of RULES.shop) assert.ok(expr.includes(r), `the filter asks for shop=${r}`);
});

test('ST10: the stores pack is published only when a block of it changed; the workflows carry it', async () => {
  const { decideStores } = await load('publish');
  const blocks = { '8/75/95': '0123456789abcdef' };
  const m = (stores?: unknown) => ({ schema: 1, regions: [{ id: 'us', current: { file: 'places-us-1.pmtiles', version: '1', bounds: [0, 0, 0, 0] }, previous: [], ...(stores ? { stores } : {}) }] });
  const live = m({ current: { file: 'stores-us-1.pmtiles', version: '1', bounds: [0, 0, 0, 0], blocks }, previous: [] });
  assert.deepEqual(decideStores({ region: 'us', blocks, manifest: live }), { publish: false, reason: 'unchanged' });
  assert.deepEqual(decideStores({ region: 'us', blocks: { ...blocks, '8/75/96': 'fedcba9876543210' }, manifest: live }), { publish: true, reason: 'changed' });
  assert.deepEqual(decideStores({ region: 'us', blocks: { '8/75/95': 'fedcba9876543210' }, manifest: live }), { publish: true, reason: 'changed' });
  assert.equal(decideStores({ region: 'us', blocks, manifest: m() }).publish, true, 'no stores yet in the manifest');
  assert.equal(decideStores({ region: 'us', blocks, manifest: null }).publish, true);
  assert.equal(decideStores({ region: 'us', blocks, manifest: null, unreachable: true }).publish, false);
  assert.equal(decideStores({ region: 'us', blocks: null, manifest: live }).publish, false);
  const cli = readFileSync(join(ROOT, 'src/cli.ts'), 'utf8');
  assert.match(cli, /decideStores/);
  assert.match(cli, /buildStores/);
  assert.match(readFileSync(join(ROOT, '.github/workflows/build.yml'), 'utf8'), /registry-stores-us\.json/);
  assert.match(readFileSync(join(ROOT, '.github/workflows/pages.yml'), 'utf8'), /stores-\*\.pmtiles/);
});
