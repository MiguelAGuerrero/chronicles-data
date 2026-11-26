/// <reference types="node" />
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { PMTiles, type RangeResponse, type Source } from 'pmtiles';
import { CONTRACT_VERSION } from '../src/classes';
import { emptyRegistry } from '../src/conflate';
import { createRawStore } from '../src/rawStore';
import { run } from '../src/runner';

// The fixtures pack (docs/fixtures/spec.md, FX1-FX14; the app's specs/town-fixtures, decisions 0225, 0255, 0268). Written
// before the code: the fixtures modules are loaded by a path TypeScript doesn't resolve, as the stores' tests were.
// The plan review's findings are named in their tests too (town-fixtures audit 1-6).
const ROOT = join(fileURLToPath(import.meta.url), '../..');
const FIX = join(ROOT, 'test/fixtures');
const OSM = readFileSync(join(FIX, 'osm-fixtures.geojsonl'), 'utf8');
const WD = readFileSync(join(FIX, 'wikidata-libraries.json'), 'utf8');
const AT = '2026-11-09T07:17:00.000Z';
const hasOsmium = spawnSync('osmium', ['--version']).status === 0;

/* eslint-disable @typescript-eslint/no-explicit-any */
const load = (p: string): Promise<any> => import(String(`../src/${p}`));
const ids = (prefix: string) => {
  let n = 0;
  return () => `${prefix}_${(++n).toString(16).padStart(16, '0')}`;
};
const memory = (buf: Uint8Array): Source => ({
  getKey: () => 'memory',
  getBytes: async (offset: number, length: number): Promise<RangeResponse> => ({ data: buf.slice(offset, offset + length).buffer as ArrayBuffer }),
});
async function featuresOf(bytes: Uint8Array, layer: string) {
  const pm = new PMTiles(memory(bytes));
  const h = await pm.getHeader();
  const out: Record<string, unknown>[] = [];
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
const shuffled = (raw: string) => raw.split('\n').filter(Boolean).reverse().join('\n');
const good = { id: 'f_0000000000000001', kind: 'library', at: [-74, 40.7], name: 'Hudson Free Library', src: 'osm' };

/** A raw store holding the fixture inputs: OSM's fixtures part and Wikidata's libraries, each a complete run. */
function storeWith({ osm = true, wd = true }: { osm?: boolean; wd?: boolean } = {}) {
  const store = createRawStore(mkdtempSync(join(tmpdir(), 'fx-raw-')));
  if (osm) {
    store.put('osm', '20261109', 'fixtures-us-northeast.geojsonl', OSM, AT);
    store.complete('osm', '20261109');
  }
  if (wd) {
    store.put('wikidata-fixtures', '20261109', 'libraries-us.json', WD, AT);
    store.complete('wikidata-fixtures', '20261109');
  }
  return store;
}
async function built(o: { osm?: boolean; wd?: boolean; osmRaw?: string } = {}) {
  const { buildFixtures } = await load('fixtures/build');
  const store = storeWith(o);
  if (o.osmRaw) store.put('osm', '20261109', 'fixtures-us-northeast.geojsonl', o.osmRaw, AT);
  return buildFixtures({ store, osmRun: o.osm === false ? null : '20261109', wikidataRun: o.wd === false ? null : '20261109', region: 'example', version: '20261109', registry: emptyRegistry(), newId: ids('f') });
}
const byName = (fs: { name?: string; kind: string; src: string }[]) => fs.map((f) => `${f.kind}:${f.name ?? ''}:${f.src}`).sort();

test('FX1: the fixture record is closed: an opaque id, a kind, a position, a src and a name where it has one', { todo: 'test first' }, async () => {
  const { FixtureSchema, fixturesJsonSchema } = await load('fixtures/schema');
  assert.ok(FixtureSchema.safeParse(good).success);
  const { name: _n, ...unnamed } = good;
  assert.ok(FixtureSchema.safeParse(unnamed).success, 'an unnamed fixture');
  for (const extra of ['rating', 'reviews', 'visits', 'popularity', 'count', 'hours', 'wikidata', 'colour']) {
    assert.equal(FixtureSchema.safeParse({ ...good, [extra]: 1 }).success, false, `${extra} fails`);
  }
  assert.equal(FixtureSchema.safeParse({ ...good, id: 'p_0000000000000001' }).success, false, 'an f_ id');
  assert.equal(FixtureSchema.safeParse({ ...good, at: [-74, 40.7, 3] }).success, false);
  const walk = (o: unknown): void => {
    if (!o || typeof o !== 'object') return;
    const s = o as Record<string, unknown>;
    if (s.type === 'object') assert.equal(s.additionalProperties, false, 'every object closed');
    for (const v of Object.values(s)) walk(v);
  };
  const js = fixturesJsonSchema();
  walk(js.record);
  walk(js.feature);
  const numbers = JSON.stringify(js.record).match(/"type":"number"/g) ?? [];
  assert.ok(numbers.length <= 2, 'the only numbers are a position');
});

test('FX2: the kinds are the owner\'s thirteen, each from its one tag, in order; a visitor centre is no tourist office', { todo: 'test first' }, async () => {
  const { KINDS } = await load('fixtures/kinds');
  const { kindsOf } = await load('fixtures/osm');
  const { FixtureSchema } = await load('fixtures/schema');
  assert.deepEqual(KINDS.map((k: any) => `${k.kind}=${k.key}=${k.value}`), [
    'tourist_office=information=office', 'town_hall=amenity=townhall', 'library=amenity=library', 'post_office=amenity=post_office',
    'square=place=square', 'market=amenity=marketplace', 'station=railway=station', 'bus_station=amenity=bus_station',
    'courthouse=amenity=courthouse', 'community_centre=amenity=community_centre', 'ferry_terminal=amenity=ferry_terminal',
    'common=leisure=common', 'bandstand=leisure=bandstand',
  ]);
  assert.deepEqual(kindsOf({ tourism: 'information', information: 'office' }), ['tourist_office']);
  assert.deepEqual(kindsOf({ information: 'office' }), ['tourist_office'], 'the tag is trusted wherever it is (decision 0268)');
  assert.deepEqual(kindsOf({ tourism: 'information', information: 'visitor_centre' }), []);
  assert.deepEqual(kindsOf({ tourism: 'information' }), []);
  assert.equal(FixtureSchema.safeParse({ ...good, kind: 'visitor_centre' }).success, false, 'a kind outside the list fails');
});

test('FX3: no practical amenity is a fixture: the filter asks for the thirteen tags only, and other kinds give nothing', { todo: 'test first' }, async () => {
  const { FIXTURE_FILTER } = await load('fixtures/kinds');
  const { adaptFixtures, kindsOf } = await load('fixtures/osm');
  assert.equal(FIXTURE_FILTER.name, 'fixtures');
  assert.deepEqual([...FIXTURE_FILTER.expressions].sort(), [
    'nwr/amenity=townhall,library,post_office,marketplace,bus_station,courthouse,community_centre,ferry_terminal',
    'nwr/information=office', 'nwr/leisure=common,bandstand', 'nwr/place=square', 'nwr/railway=station',
  ].sort());
  assert.equal(FIXTURE_FILTER.then, undefined);
  const others: Record<string, string>[] = [
    { amenity: 'toilets' }, { amenity: 'parking' }, { amenity: 'drinking_water' }, { amenity: 'bench' }, { amenity: 'atm' }, { amenity: 'bank' },
    { amenity: 'fuel' }, { amenity: 'pharmacy' }, { shop: 'supermarket' }, { amenity: 'place_of_worship' }, { leisure: 'park' },
    { tourism: 'museum' }, { highway: 'bus_stop' }, { railway: 'halt' }, { railway: 'tram_stop' }, { information: 'board' },
    { information: 'guidepost' }, { information: 'visitor_centre' }, { amenity: 'post_box' }, { place: 'town' }, { amenity: 'school' },
    { historic: 'memorial' }, { amenity: 'hospital' }, { amenity: 'taxi' },
  ];
  for (const t of others) assert.deepEqual(kindsOf({ ...t, name: 'Somewhere' }), [], JSON.stringify(t));
  const names = adaptFixtures(OSM, AT).map((c: any) => c.name);
  for (const n of ['Public Toilets', 'Hudson Lot', 'Town Map', 'Battlefield Visitor Center']) assert.ok(!names.includes(n), `${n} is not a fixture`);
});

test('FX4: the adapter maps tags to kinds: one candidate per kind, a name where it has one, one position, private dropped, order-free', { todo: 'test first' }, async () => {
  const { adaptFixtures } = await load('fixtures/osm');
  const cs = adaptFixtures(OSM, AT);
  const at = (n: string, k?: string) => cs.filter((c: any) => c.name === n && (!k || c.kind === k));
  assert.deepEqual(at('Old Hall').map((c: any) => c.kind).sort(), ['tourist_office', 'town_hall'], 'two kinds on one element');
  const square = cs.filter((c: any) => c.kind === 'square');
  assert.equal(square.length, 1);
  assert.equal(square[0].name, undefined, 'an unnamed square is a square, with no name');
  assert.deepEqual(at('Hudson Post Office').length, 1, 'the private post office is dropped');
  const hall = at('Hudson Town Hall')[0];
  assert.deepEqual(hall.at, [-74.0015, 40.7015], 'a way is one point, its ring\'s mean');
  assert.equal(hall.sourceId, 'way/202');
  assert.deepEqual(adaptFixtures(shuffled(OSM), AT).sort((a: any, b: any) => `${a.sourceId}${a.kind}`.localeCompare(`${b.sourceId}${b.kind}`)),
    [...cs].sort((a: any, b: any) => `${a.sourceId}${a.kind}`.localeCompare(`${b.sourceId}${b.kind}`)));
  for (const k of ['town_hall', 'library', 'post_office', 'market', 'station', 'bus_station', 'courthouse', 'community_centre', 'ferry_terminal', 'common', 'bandstand', 'tourist_office', 'square']) {
    assert.ok(cs.some((c: any) => c.kind === k), `the fixture file has a ${k}`);
  }
});

test('FX5, town-fixtures audit 5: no crowd field is read, on the OSM side or the Wikidata side', { todo: 'test first' }, async () => {
  const { adaptFixtures, READS } = await load('fixtures/osm');
  const { FIXTURE_FILTER } = await load('fixtures/kinds');
  const { adaptLibraries, LIBRARY_QUERY } = await load('fixtures/wikidata');
  const crowd = ['rating', 'stars', 'reviews', 'popularity', 'opening_hours', 'wikipedia', 'website', 'sitelinks', 'P1174', 'listed', 'nhl'];
  for (const k of crowd) {
    assert.ok(!READS.includes(k), `${k} is not read`);
    assert.ok(!FIXTURE_FILTER.expressions.join(' ').includes(k));
  }
  const plain = '{"type":"Feature","geometry":{"type":"Point","coordinates":[-74,40.7]},"properties":{"@type":"way","@id":202,"amenity":"townhall","name":"Hudson Town Hall"}}';
  const poisoned = OSM.split('\n').find((l) => l.includes('"@id":202'))!;
  const strip = (c: any) => ({ ...c, at: null });
  assert.deepEqual(adaptFixtures(poisoned, AT).map(strip), adaptFixtures(plain, AT).map(strip), 'a rating, hours and a website change nothing');
  // The Wikidata side: the query asks the label, the coordinate and the gone-signals only, and a row's crowd fields change nothing.
  for (const k of ['sitelinks', 'P1174', 'P1435', 'wikibase:sitelinks', 'schema:about']) assert.ok(!LIBRARY_QUERY.includes(k), `the query asks no ${k}`);
  const row = (extra: Record<string, unknown>) => JSON.stringify({ results: { bindings: [{ item: { value: 'http://www.wikidata.org/entity/Q1' }, label: { value: 'A Library' }, coord: { value: 'Point(-74 40.7)' }, ...extra }] } });
  assert.deepEqual(adaptLibraries(row({ sitelinks: { value: '40' }, P1174: { value: '120000' }, listed: { value: 'true' } }), AT), adaptLibraries(row({}), AT));
});

test('FX6, town-fixtures audit 3: one fixture kept once, OpenStreetMap\'s first, whatever the order', { todo: 'test first' }, async () => {
  const { mergeFixtures, normName } = await load('fixtures/merge');
  const { adaptFixtures } = await load('fixtures/osm');
  const { adaptLibraries } = await load('fixtures/wikidata');
  assert.equal(normName('Hudson Free Library (New York)'), normName('hudson free library'));
  assert.equal(normName('Maple Street Library, Brookfield'), normName('Maple Street Library'));
  const all = [...adaptFixtures(OSM, AT), ...adaptLibraries(WD, AT)];
  const kept = mergeFixtures(all);
  const libs = kept.filter((f: any) => f.kind === 'library');
  // The building and the point inside it, and the unnamed point 33 m off, are one library: the point with the Wikidata tag.
  const hudson = libs.filter((f: any) => f.name === 'Hudson Free Library');
  assert.equal(hudson.length, 2, 'the one at the corner and the one 337 m off are two');
  assert.ok(hudson.every((f: any) => f.source === 'osm'), 'OpenStreetMap\'s, never Wikidata\'s point (Q900001 joins by its tag, Q900002 by name)');
  assert.ok(hudson.some((f: any) => f.sourceId === 'node/101'));
  assert.ok(!libs.some((f: any) => f.name === undefined), 'the unnamed point near it joined it');
  const maple = libs.filter((f: any) => normName(f.name ?? '') === normName('Maple Street Library'));
  assert.deepEqual(maple.map((f: any) => [f.source, f.name]), [['osm', 'Maple Street Library']], 'a label with ", <town>" joins the OSM library 154 m off');
  assert.deepEqual(libs.filter((f: any) => f.source === 'wikidata').map((f: any) => f.name).sort(), ['Crowd Library', 'Ridge Public Library'], 'kept alone only when no OSM library matches');
  // Two of different kinds at one place are two.
  assert.deepEqual(kept.filter((f: any) => f.name === 'Old Hall').map((f: any) => f.kind).sort(), ['tourist_office', 'town_hall']);
  // Order-free.
  const key = (fs: any[]) => fs.map((f) => `${f.source}:${f.sourceId}:${f.kind}`).sort();
  assert.deepEqual(key(mergeFixtures([...all].reverse())), key(kept));
  // Same name 200 m apart is one; 300 m apart is two; an unnamed one 40 m off joins, 60 m off does not.
  const lib = (id: number, lon: number, lat: number, name?: string) => ({ source: 'osm', sourceId: `node/${id}`, kind: 'library', at: [lon, lat], ...(name ? { name } : {}), fetchedAt: AT });
  assert.equal(mergeFixtures([lib(1, -74, 40.7, 'A'), lib(2, -74.0024, 40.7, 'A')]).length, 1);
  assert.equal(mergeFixtures([lib(1, -74, 40.7, 'A'), lib(2, -74.0036, 40.7, 'A')]).length, 2);
  assert.equal(mergeFixtures([lib(1, -74, 40.7, 'A'), lib(2, -74.00047, 40.7)]).length, 1);
  assert.equal(mergeFixtures([lib(1, -74, 40.7, 'A'), lib(2, -74.00072, 40.7)]).length, 2);
  // A named OSM way with no Wikidata tag beats a Wikidata item of its name 180 m off (the steward's case).
  const wd = { source: 'wikidata', sourceId: 'Q5', kind: 'library', at: [-74.0021, 40.7], name: 'Stowe Free Library (Vermont)', item: 'Q5', fetchedAt: AT };
  const way = { source: 'osm', sourceId: 'way/9', kind: 'library', at: [-74, 40.7], name: 'Stowe Free Library', fetchedAt: AT };
  assert.deepEqual(mergeFixtures([wd, way]).map((f: any) => f.sourceId), ['way/9']);
});

test('FX7, town-fixtures audit 4: fixtures never reach the places or the stores, and the adapters\' fingerprints are main\'s', { todo: 'test first' }, async () => {
  const { ADAPTERS, REGIONS } = await import('../src/cli');
  const { osm } = await import('../src/adapters/osm');
  const { partOf } = await import('../src/adapters/wikidata');
  const { buildStores } = await import('../src/stores/build');
  // main's fingerprints (chronicles-data 1b0e149): a change here would refetch a source and move its pack.
  assert.deepEqual(ADAPTERS.map((a) => [a.declaration.name, a.fetchKey?.(REGIONS.us)]), [['wikidata', 'a5aa805b9b0738b5'], ['osm', '3ce3ff1bb5769733']]);
  assert.deepEqual(osm.adapt(OSM, 'fixtures-us-west.geojsonl', AT), [], 'the places adapter skips a fixtures part');
  const SHOPS = readFileSync(join(FIX, 'osm-shops.geojsonl'), 'utf8');
  const build = async (withFixtures: boolean) => {
    const store = createRawStore(mkdtempSync(join(tmpdir(), 'fx7-')));
    for (const cell of [[-76, 40, -74, 42], [-74, 40, -72, 42]] as [number, number, number, number][]) store.put('wikidata', '20261109', partOf(cell), readFileSync(join(FIX, partOf(cell)), 'utf8'), AT);
    store.complete('wikidata', '20261109');
    store.put('osm', '20261109', 'shops-us-northeast.geojsonl', SHOPS, AT);
    if (withFixtures) {
      store.put('osm', '20261109', 'fixtures-us-northeast.geojsonl', OSM, AT);
      store.put('wikidata-fixtures', '20261109', 'libraries-us.json', WD, AT);
      store.complete('wikidata-fixtures', '20261109');
    }
    store.complete('osm', '20261109');
    const r = await run({
      adapters: ADAPTERS, region: 'example', area: [[-76, 40, -72, 42]], version: '20261109', store, registry: emptyRegistry(), edits: { remove: [], add: [] },
      fetch: false, http: async () => { throw new Error('asks nothing'); }, clock: { now: () => Date.parse(AT), sleep: async () => {} }, newId: ids('p'),
    });
    const s = buildStores({ store, run: '20261109', region: 'example', version: '20261109', registry: emptyRegistry(), newId: ids('s') });
    return { packs: r.packs.map((p) => [p.file, Buffer.from(p.bytes).toString('base64'), p.blocks]), registry: r.registry, report: r.report, stores: s.pack && [Buffer.from(s.pack.bytes).toString('base64'), s.pack.blocks], storesRegistry: s.registry };
  };
  assert.deepEqual(await build(true), await build(false));
  for (const f of ['gate.ts', 'conflate.ts', 'package.ts', 'runner.ts', 'stores/build.ts', 'stores/osmShops.ts', 'stores/package.ts', 'stores/gate.ts', 'stores/schema.ts']) {
    assert.ok(!/from '\.\.?\/(\.\.\/)?fixtures\//.test(readFileSync(join(ROOT, 'src', f), 'utf8')), `${f} imports nothing of fixtures/`);
  }
});

test('FX8: the fixtures pack (layer fixtures, z12, order-free bytes, blocks) and the manifest\'s `fixtures`, the old manifest unchanged', { todo: 'test first' }, async () => {
  const { packFixtures } = await load('fixtures/package');
  const r = await built();
  const p = r.pack;
  assert.equal(p.file, 'fixtures-example-20261109.pmtiles');
  const header = await new PMTiles(memory(p.bytes)).getHeader();
  assert.equal(header.maxZoom, 12);
  const props = await featuresOf(p.bytes, 'fixtures');
  assert.equal(props.length, p.fixtures.length);
  for (const f of props) assert.deepEqual(Object.keys(f).filter((k) => !['kind', 'id', 'src', 'name'].includes(k)), [], 'kind, id, src and name only');
  assert.ok(props.some((f) => f.kind === 'square' && f.name === undefined), 'an unnamed square has no name property');
  assert.ok(Buffer.from(packFixtures([...p.fixtures].reverse(), 'example', '20261109').bytes).equals(Buffer.from(p.bytes)), 'order-free');
  for (const [k, v] of Object.entries(p.blocks)) {
    assert.match(k, /^8\/\d+\/\d+$/);
    assert.match(String(v), /^[0-9a-f]{16}$/);
  }
  // The manifest: a folder with places and stores packs only is written as before; a fixtures pack is listed beside them.
  const dir = mkdtempSync(join(tmpdir(), 'fx8-'));
  for (const f of ['places-example-20261109.pmtiles', 'stores-example-20261109.pmtiles']) writeFileSync(join(dir, f), readFileSync(join(ROOT, 'contract/example', f)));
  const manifest = () => execFileSync(process.execPath, [join(ROOT, 'scripts/manifest.mjs'), dir], { encoding: 'utf8' });
  const before = manifest();
  assert.ok(!before.includes('fixtures'), 'no fixtures key with no fixtures pack');
  writeFileSync(join(dir, p.file), p.bytes);
  writeFileSync(join(dir, 'fixtures-example-20261109.blocks.json'), JSON.stringify(p.blocks));
  writeFileSync(join(dir, 'fixtures-example-20261109.license'), 'odbl\n');
  const m = JSON.parse(manifest());
  assert.equal(m.regions[0].fixtures.current.file, p.file);
  assert.equal(m.regions[0].fixtures.current.license, 'odbl');
  assert.deepEqual(m.regions[0].fixtures.previous, []);
  const { fixtures: _f, ...rest } = m.regions[0];
  assert.deepEqual({ ...m, regions: [rest] }, JSON.parse(before), 'the places and stores entries are as before');
});

test('FX9: published for the app: fixtures.schema.json, the example pack and its records, contract v9', { todo: 'test first' }, async () => {
  assert.equal(CONTRACT_VERSION, 9);
  const schema = JSON.parse(readFileSync(join(ROOT, 'contract/fixtures.schema.json'), 'utf8'));
  assert.equal(schema.contractVersion, 9);
  assert.deepEqual(schema.kinds.map((k: any) => k.kind), ['tourist_office', 'town_hall', 'library', 'post_office', 'square', 'market', 'station', 'bus_station', 'courthouse', 'community_centre', 'ferry_terminal', 'common', 'bandstand']);
  assert.match(schema.clients, /ignores a kind it does not know/);
  const records = JSON.parse(readFileSync(join(ROOT, 'contract/example/fixtures-example.json'), 'utf8'));
  const bytes = new Uint8Array(readFileSync(join(ROOT, 'contract/example/fixtures-example-20261109.pmtiles')));
  assert.equal((await featuresOf(bytes, 'fixtures')).length, records.length);
  assert.ok(records.some((r: any) => r.src === 'wd') && records.some((r: any) => r.src === 'osm'), 'both sources (town-fixtures audit 1)');
  const m = JSON.parse(readFileSync(join(ROOT, 'contract/example/manifest.json'), 'utf8'));
  assert.equal(m.regions[0].fixtures.current.file, 'fixtures-example-20261109.pmtiles');
  const ms = JSON.parse(readFileSync(join(ROOT, 'contract/manifest.schema.json'), 'utf8'));
  assert.ok(ms.properties.regions.items.properties.fixtures, 'the manifest schema names fixtures');
  assert.ok(!ms.properties.regions.items.required.includes('fixtures'), 'optional');
});

test('FX10: one download a week, and a new filter is filled while the held answers are carried as they were', { todo: 'test first' }, async () => {
  const { planPart } = await load('adapters/osm/extract');
  const { fingerprint } = await import('../src/fingerprint');
  const base = [{ name: 'confirm', expressions: ['nwr/wikidata'] }, { name: 'small', expressions: ['nwr/x=y'] }];
  const added = [{ name: 'fixtures', expressions: ['nwr/amenity=library'] }];
  const parts = (names: string[]) => names.map((n) => ({ part: `${n}-us-west.geojsonl` }));
  const note = { 'filter:fixtures': fingerprint([added[0]]) };
  const prev = (names: string[], meta: Record<string, string> = {}) => ({ parts: parts(names), meta });
  const plan = (o: any) => planPart({ sameFetch: true, counted: true, base, added, part: 'us-west', ...o });
  // Run 40: the base held, no fixtures: fill.
  const fill = plan({ prev: prev(['confirm', 'small']) });
  assert.equal(fill.mode, 'fill');
  assert.deepEqual(fill.run.map((f: any) => f.name), ['fixtures']);
  assert.deepEqual(fill.carry, ['confirm-us-west.geojsonl', 'small-us-west.geojsonl']);
  // All held: ask conditionally, as before.
  const ask = plan({ prev: prev(['confirm', 'small', 'fixtures'], note) });
  assert.equal(ask.mode, 'ask');
  assert.deepEqual(ask.run.map((f: any) => f.name), ['confirm', 'small', 'fixtures']);
  // The fixtures part held under another fingerprint: filled again.
  assert.equal(plan({ prev: prev(['confirm', 'small', 'fixtures'], { 'filter:fixtures': 'old' }) }).mode, 'fill');
  // The base not held (another fetch, uncounted, a part missing, no run): everything, as before.
  assert.equal(plan({ sameFetch: false, prev: prev(['confirm', 'small']) }).mode, 'whole');
  assert.equal(plan({ counted: false, prev: prev(['confirm', 'small']) }).mode, 'whole');
  assert.equal(plan({ prev: prev(['confirm']) }).mode, 'whole');
  assert.equal(plan({ prev: null }).mode, 'whole');
  // With no added filter, planPart is today's rule.
  assert.equal(planPart({ sameFetch: true, counted: true, base, added: [], part: 'us-west', prev: prev(['confirm', 'small']) }).mode, 'ask');
  // The OSM adapter passes the fixtures filter as added, so its fingerprint is the base's (FX7 pins it).
  const src = readFileSync(join(ROOT, 'src/adapters/osm/index.ts'), 'utf8');
  assert.match(src, /filterExtracts\(ctx, \[FILTER, SMALL_FILTER, SHOP_FILTER\], US_PARTS, COUNT_TAGS, \[FIXTURE_FILTER\]\)/);
});

test('FX10: on a real extract, the fill writes the fixtures part and carries the held parts, ETag and counts byte for byte', { skip: !hasOsmium && 'osmium is not installed', todo: 'test first' }, async () => {
  const { filterExtracts } = await load('adapters/osm/extract');
  const { FIXTURE_FILTER } = await load('fixtures/kinds');
  const pbf = join(mkdtempSync(join(tmpdir(), 'fx10-')), 'x.osm.pbf');
  execFileSync('osmium', ['cat', join(FIX, 'osm-fixtures.osm'), '-o', pbf, '--overwrite']);
  const body = readFileSync(pbf);
  const put: Record<string, string> = {};
  const carried: string[] = [];
  const meta: Record<string, string> = {};
  const asked: Record<string, string>[] = [];
  const held = { 'confirm-us-west.geojsonl': 'held confirm', 'small-us-west.geojsonl': 'held small' };
  const ctx: any = {
    sameFetch: true,
    previous: { run: '20261123.40', parts: Object.keys(held).map((part) => ({ part })), read: (p: string) => (held as any)[p], meta: { 'etag:us-west': '"old"', 'modified:us-west': 'Mon, 23 Nov 2026', 'tagCounts:us-west': '{"a":1}', 'shopCounts:us-west': '{"b":2}' } },
    http: async (_u: string, init: any) => { asked.push(init.headers); return new Response(body, { status: 200, headers: { etag: '"new"' } }); },
    put: (p: string, b: string) => { put[p] = b; },
    carry: (p: string) => carried.push(p),
    setMeta: (k: string, v: string) => { meta[k] = v; },
    log: () => {},
  };
  await filterExtracts(ctx, [{ name: 'confirm', expressions: ['nwr/wikidata'] }, { name: 'small', expressions: ['nwr/historic=milestone'] }], ['us-west'], { amenity: ['library'] }, [FIXTURE_FILTER]);
  assert.deepEqual(asked, [{}], 'asked once, unconditionally');
  assert.deepEqual(Object.keys(put), ['fixtures-us-west.geojsonl'], 'only the fixtures part is written');
  assert.deepEqual(carried.sort(), ['confirm-us-west.geojsonl', 'small-us-west.geojsonl']);
  assert.equal(meta['etag:us-west'], '"old"', 'the held copy\'s ETag, so next week asks against what was carried');
  assert.equal(meta['tagCounts:us-west'], '{"a":1}');
  assert.equal(meta['shopCounts:us-west'], '{"b":2}');
  assert.ok(meta['filter:fixtures']);
  const lines = put['fixtures-us-west.geojsonl'].split('\n').filter(Boolean).map((l) => JSON.parse(l).properties.name).sort();
  assert.deepEqual(lines, ['Hudson', 'Hudson Free Library', 'Hudson Town Hall', 'Hudson Visitor Center'], 'no toilets, no visitor centre');
});

test('FX11: published only when a block changed, never without OSM\'s fixtures; the workflows keep and serve the pack', { todo: 'test first' }, async () => {
  const { decideFixtures } = await import('../src/publish') as any;
  const blocks = { '8/75/96': 'aaaaaaaaaaaaaaaa' };
  const region = (fixtures?: unknown) => ({ schema: 1, regions: [{ id: 'us', current: { blocks: { '8/1/1': 'bbbbbbbbbbbbbbbb' } }, ...(fixtures ? { fixtures } : {}) }] });
  assert.equal(decideFixtures({ region: 'us', blocks, manifest: region({ current: { blocks } }) }).publish, false);
  assert.equal(decideFixtures({ region: 'us', blocks: { '8/75/96': 'cccccccccccccccc' }, manifest: region({ current: { blocks } }) }).publish, true);
  assert.equal(decideFixtures({ region: 'us', blocks, manifest: region() }).publish, true);
  assert.equal(decideFixtures({ region: 'us', blocks, manifest: null, unreachable: true }).publish, false);
  // OpenStreetMap first: Wikidata's libraries alone build no pack.
  const none = await built({ osm: false });
  assert.equal(none.pack, null);
  assert.match(none.report.reason, /no fixtures in the OpenStreetMap run/);
  const build = readFileSync(join(ROOT, '.github/workflows/build.yml'), 'utf8');
  assert.match(build, /registry-fixtures-us\.json/);
  const pages = readFileSync(join(ROOT, '.github/workflows/pages.yml'), 'utf8');
  assert.match(pages, /for kind in places stores fixtures/);
  assert.match(pages, /--pattern 'fixtures-\*\.pmtiles' --pattern 'fixtures-\*\.blocks\.json' --pattern 'fixtures-\*\.license'/);
  const cli = readFileSync(join(ROOT, 'src/cli.ts'), 'utf8');
  assert.match(cli, /state-sources=\$\{\[\.\.\.redistributable\(ADAPTERS\), FIXTURES_WIKIDATA\]\.join\(' '\)\}/);
});

test('FX12: nothing counts fixtures: no count in the record, the feature, the manifest entry or the report', { todo: 'test first' }, async () => {
  const { fixturesJsonSchema } = await load('fixtures/schema');
  const js = JSON.stringify(fixturesJsonSchema());
  assert.ok(!/count|total|tally|number_of/i.test(JSON.stringify({ r: fixturesJsonSchema().record, f: fixturesJsonSchema().feature })), 'no count field');
  assert.ok(js.length > 0);
  const r = await built();
  assert.deepEqual(Object.keys(r.report).sort(), ['reason', 'setAside', 'sources']);
  assert.ok(Object.values(r.report).every((v) => typeof v !== 'number'), 'no number in the report');
  assert.ok(r.report.setAside.every((s: any) => typeof s.name === 'string' && typeof s.reason === 'string'));
  const ms = JSON.parse(readFileSync(join(ROOT, 'contract/manifest.schema.json'), 'utf8'));
  assert.ok(!/count/i.test(JSON.stringify(ms.$defs.fixturesFile)));
});

test('FX13, town-fixtures audit 1, 2: Wikidata\'s public libraries by a read of their own: exact P31, the gone and unlabelled out', { todo: 'test first' }, async () => {
  const w = await load('fixtures/wikidata');
  assert.equal(w.SOURCE, 'wikidata-fixtures');
  assert.match(w.LIBRARY_QUERY, /wdt:P31 wd:Q28564/);
  assert.ok(!/P279|\*/.test(w.LIBRARY_QUERY), 'no subclass walk');
  assert.match(w.LIBRARY_QUERY, /wdt:P17 wd:Q30/);
  for (const k of ['Q18411786', 'Q543654', 'Q25550691', 'Q35054']) assert.ok(!w.LIBRARY_QUERY.includes(k), `no ${k}: libraries only`);
  const cs = w.adaptLibraries(WD, AT);
  assert.deepEqual(cs.map((c: any) => c.name).sort(), ['Crowd Library', 'Hudson Free Library', 'Hudson Free Library (New York)', 'Maple Street Library, Brookfield', 'Ridge Public Library']);
  assert.ok(cs.every((c: any) => c.kind === 'library' && c.source === 'wikidata' && c.item === c.sourceId));
  assert.equal(cs.filter((c: any) => c.sourceId === 'Q900003').length, 1, 'two rows of one item are one');
  // When it is fetched: a full run, a run that fetches Wikidata, any fetching run while stale; never with nothing fetched.
  assert.equal(w.shouldFetchLibraries({ fetching: true, only: null, stale: false }), true);
  assert.equal(w.shouldFetchLibraries({ fetching: true, only: ['wikidata'], stale: false }), true);
  assert.equal(w.shouldFetchLibraries({ fetching: true, only: ['osm'], stale: false }), false);
  assert.equal(w.shouldFetchLibraries({ fetching: true, only: [], stale: true }), true);
  assert.equal(w.shouldFetchLibraries({ fetching: false, only: null, stale: true }), false);
  // The read: one POST to the places' endpoint, with its user agent; kept with its fingerprint; a failure keeps the last.
  const store = createRawStore(mkdtempSync(join(tmpdir(), 'fx13-')));
  assert.equal(w.librariesStale(store, '20261126'), true);
  const asked: { url: string; ua: string | null }[] = [];
  const clock = { now: () => Date.parse(AT), sleep: async () => {} };
  const ok = await w.fetchLibraries({ store, version: '20261126', clock, log: () => {}, http: async (url: string, init: any) => { asked.push({ url, ua: new Headers(init.headers).get('user-agent') }); return new Response(WD, { status: 200 }); } });
  assert.equal(ok, true);
  assert.deepEqual(asked.map((a) => a.url), ['https://query.wikidata.org/sparql']);
  assert.match(asked[0].ua!, /Chronicles places build/);
  assert.equal(w.librariesStale(store, '20261127'), false);
  assert.equal(w.librariesRun(store, '20261127'), '20261126');
  const failed = await w.fetchLibraries({ store, version: '20261127', clock, log: () => {}, http: async () => new Response('cut', { status: 200 }) });
  assert.equal(failed, false);
  assert.equal(w.librariesRun(store, '20261127'), '20261126', 'the last answer stands');
  const r = await built();
  assert.ok(r.pack.fixtures.some((f: any) => f.src === 'wd') && r.pack.fixtures.some((f: any) => f.src === 'osm'), 'the pack holds both sources');
  assert.deepEqual(r.report.sources, ['osm', 'wikidata']);
});

test('FX14, town-fixtures audit 6: a heritage railway\'s station is not a fixture; every other station is, subway included', { todo: 'test first' }, async () => {
  const { kindsOf } = await load('fixtures/osm');
  assert.deepEqual(kindsOf({ railway: 'station' }), ['station']);
  assert.deepEqual(kindsOf({ railway: 'station', station: 'subway' }), ['station']);
  assert.deepEqual(kindsOf({ railway: 'station', station: 'light_rail' }), ['station']);
  for (const t of [{ 'railway:preserved': 'yes' }, { usage: 'tourism' }, { tourism: 'museum' }, { tourism: 'attraction' }, { historic: 'railway_station' }]) {
    assert.deepEqual(kindsOf({ railway: 'station', name: 'Old Depot', ...t }), [], JSON.stringify(t));
  }
  const r = await built();
  assert.deepEqual(byName(r.pack.fixtures.filter((f: any) => f.kind === 'station')), ['station:Fulton St:osm', 'station:Hudson:osm']);
});
