/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { PMTiles, type RangeResponse, type Source } from 'pmtiles';
import { writeArchive } from '../src/archive.mjs';
import { ALL_CLASS_IDS, CLASSES, classify, gone, keep } from '../src/adapters/wikidata/classify.mjs';
import type { Adapter } from '../src/adapter';
import { wikidata } from '../src/adapters/wikidata';
import { cellQuery, cellsFor, itemsFrom, splitCell } from '../src/adapters/wikidata/query';
import { emptyRegistry } from '../src/conflate';
import { decide } from '../src/publish';
import { createRawStore } from '../src/rawStore';
import { run } from '../src/runner';
import type { Declaration } from '../src/schema';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLASS_NAMES } from '../src/classes';

// Places worth the stop: the build script's archive writer (PW14), written from the spec before the code.

/** pmtiles' own reader over bytes in memory, as the app reads them over the network. */
const memory = (buf: Uint8Array): Source => ({
  getKey: () => 'memory',
  getBytes: async (offset: number, length: number): Promise<RangeResponse> => ({ data: buf.slice(offset, offset + length).buffer }),
});

const place = (name: string, lon: number, lat: number, cls = 'folly') => ({ name, lon, lat, class: cls, src: 'wd', id: `Q${name.length}${Math.round(lon * 1000)}` });

async function featuresAt(buf: Uint8Array, z: number, x: number, y: number) {
  const t = await new PMTiles(memory(buf)).getZxy(z, x, y);
  if (!t) return [];
  const layer = new VectorTile(new PbfReader(new Uint8Array(t.data))).layers.places;
  return Array.from({ length: layer?.length ?? 0 }, (_, i) => {
    const f = layer!.feature(i).toGeoJSON(x, y, z);
    return { geometry: f.geometry, properties: (f.properties ?? {}) as Record<string, unknown> };
  });
}

test('PW14: the archive is the same bytes each time, and the app\'s reader finds each place in its z12 tile', async () => {
  const places = [place('Bushkill Folly', -75.2, 40.7), place('Odd Rock', -75.19, 40.69, 'natural_oddity')];
  const a = writeArchive(places);
  const b = writeArchive([...places].reverse());
  assert.deepEqual(Buffer.from(a), Buffer.from(b), 'the same bytes, whatever order the inputs came in');
  const header = await new PMTiles(memory(a)).getHeader();
  assert.deepEqual([header.minZoom, header.maxZoom, header.tileType, header.clustered], [12, 12, 1, true]);
  const z = 12;
  const n = 2 ** z;
  const x = Math.floor(((-75.2 + 180) / 360) * n);
  const r = (40.7 * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  const got = await featuresAt(a, z, x, y);
  const names = got.map((f) => f.properties.name).sort();
  assert.deepEqual(names, ['Bushkill Folly', 'Odd Rock']);
  const folly = got.find((f) => f.properties.name === 'Bushkill Folly')!;
  assert.deepEqual(Object.keys(folly.properties).sort(), ['class', 'id', 'name', 'src'], 'PW7: nothing else rides along');
  const [lon, lat] = (folly.geometry as { coordinates: number[] }).coordinates;
  assert.ok(Math.abs(lon + 75.2) < 0.0002 && Math.abs(lat - 40.7) < 0.0002, `within a few metres (${lon}, ${lat})`);
});

test('PW14: the root directory always fits in the reader\'s first read; leaf directories hold the rest, and every tile is found', async () => {
  // Places scattered over the US, as real ones are: their tile ids compress poorly, so the root alone won't fit.
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const places = Array.from({ length: 80000 }, (_, i) => place(`P${i}`, -124 + rand() * 57, 25 + rand() * 24));
  const us = await new PMTiles(memory(writeArchive(places))).getHeader();
  assert.ok(us.rootDirectoryOffset + us.rootDirectoryLength <= 16384, 'a US-sized root fits in the 16 KB first read');
  // A smaller first read forces leaf directories, so the path a larger archive takes is read for real.
  const buf = writeArchive(places, { firstRead: 2048 });
  const header = await new PMTiles(memory(buf)).getHeader();
  assert.ok(header.rootDirectoryOffset + header.rootDirectoryLength <= 2048, 'the root fits the smaller read');
  assert.ok((header.leafDirectoryLength ?? 0) > 0, 'leaf directories hold the rest');
  for (const i of [0, 12345, 79999]) {
    const p = places[i];
    const n = 2 ** 12;
    const x = Math.floor(((p.lon + 180) / 360) * n);
    const r = (p.lat * Math.PI) / 180;
    const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
    assert.ok((await featuresAt(buf, 12, x, y)).some((f) => f.properties.name === p.name), `tile of ${p.name}`);
  }
});

const item = (o: Partial<{ p31: string[]; heritage: boolean; nhl: boolean; article: boolean; dissolved: boolean; closed: boolean; states: string[]; name: string; lon: number; lat: number }>) =>
  ({ p31: [], heritage: false, nhl: false, article: false, dissolved: false, closed: false, states: [], name: 'X', lon: -75.19, lat: 40.69, ...o });
const DISTRICT = 'Q15243209';
const FOLLY = 'Q180174';
const STATUE = 'Q179700';
const MURAL = 'Q219423';
const OVERLOOK = 'Q6017969';
const HOUSE = 'Q3947';

test('PW6: type decides, in a fixed order of pinned Wikidata classes, never age or listing', () => {
  assert.equal(classify(item({ p31: [FOLLY], heritage: true })), 'folly', 'a listed century-old folly is a curiosity');
  assert.equal(classify(item({ p31: [HOUSE], heritage: true, nhl: true })), 'building_structure', 'a National Historic Landmark house is a building (heritage_building renamed in contract v2, RD13)');
  assert.equal(classify(item({ p31: [HOUSE], heritage: true, article: true })), null, 'an article is no sign: nearly every listing has one (the owner, Nov 6: landmarks only)');
  assert.equal(classify(item({ p31: [HOUSE], heritage: true })), null, 'a plain listing is left out (the owner, Nov 6)');
  assert.equal(classify(item({ p31: [DISTRICT], heritage: true, nhl: true, article: true })), null, 'a historic district is an area, never a place');
  assert.equal(classify(item({ p31: [HOUSE] })), null, 'an unlisted ordinary house is left out');
  assert.equal(classify(item({ p31: [STATUE, FOLLY] })), 'statue', 'it commemorates: a monument first');
  assert.equal(classify(item({ p31: [MURAL, OVERLOOK] })), 'mural', 'made as art, before a viewpoint');
  assert.equal(classify(item({ p31: [OVERLOOK, FOLLY] })), 'overlook', 'you go there to look out, before an odd class');
  for (const cls of Object.keys(CLASSES)) assert.ok((CLASS_NAMES as readonly string[]).includes(cls), `${cls} is in the contract's class names (PW5)`);
  assert.ok(Object.values(CLASSES).every((ids: unknown) => (ids as string[]).every((q) => /^Q\d+$/.test(q))), 'fixed lists of Wikidata classes, never a judgment at run time');
});

test('PW7: a place enters with a class and a location, and only while its sources say it still exists', () => {
  assert.equal(keep(item({ p31: [FOLLY] })), 'folly', 'a Wikidata entry with a location is enough');
  assert.equal(keep(item({ p31: [FOLLY], lon: Number.NaN })), null, 'no location: left out');
  assert.equal(keep(item({ p31: [HOUSE] })), null, 'no class from the table: a signal alone never admits a place');
  assert.equal(gone(item({ dissolved: true }), 'folly'), true, 'demolished, dissolved or abolished (P576)');
  assert.equal(gone(item({ closed: true }), 'odd_engineering'), false, 'closed is not gone: a decommissioned lighthouse still stands (places-worth-the-stop audit 6)');
  assert.equal(gone(item({ dissolved: true }), 'ruin'), false, 'a ghost town\'s abolished date: the ruins still stand (audit 6)');
  assert.equal(gone(item({ states: ['demolished'] })), true);
  assert.equal(gone(item({ states: ['destroyed by fire'] })), true);
  assert.equal(gone(item({ states: ['abandoned'] })), false, 'an abandoned place still exists and stays');
  assert.equal(gone(item({ states: ['ruins'] })), false, 'so does a ruin');
  assert.equal(keep(item({ p31: [FOLLY], dissolved: true })), null);
});

type Item = { id: string; name: string; lon: number; lat: number; p31: string[] };
const E = 'http://www.wikidata.org/entity/';
/** Wikidata items as the query service's answer, so they go through the real adapter. */
const answer = (items: Item[]) => JSON.stringify({ results: { bindings: items.flatMap((it) => it.p31.map((q) => ({ item: { value: E + it.id }, label: { value: it.name }, coord: { value: `Point(${it.lon} ${it.lat})` }, p31: { value: E + q } }))) } });
const withAnswer = (items: Item[]): Adapter => ({ ...wikidata, fetch: async (ctx) => ctx.put('cell.json', answer(items)) });
/** OSM's tags, as a confirming source: a `demolished:*` tag says its place is gone (PW7). */
const osmSays = (gone: { wikidata: string; name: string; at: [number, number] }[]): Adapter => ({
  declaration: { ...wikidata.declaration, name: 'osm', code: 'osm', role: 'confirms', license: 'ODbL 1.0', licenseFamily: 'odbl', hosts: ['example.org'] } as Declaration,
  fetch: async (ctx) => ctx.put('tags.json', JSON.stringify(gone)),
  adapt: (raw, _p, fetchedAt) => (JSON.parse(raw) as typeof gone).map((g) => ({ source: 'osm', sourceId: g.wikidata, name: g.name, at: g.at, sameAs: [`wikidata:${g.wikidata}`], signals: { gone: true }, fetchedAt })),
});
const clock = { now: () => Date.parse('2026-11-08T07:17:00Z'), sleep: async () => {} };
const counter = () => { let n = 0; return () => `p_${(++n).toString(16).padStart(16, '0')}`; };
async function buildWith(adapters: Adapter[], edits = { remove: [] as { name: string; at: [number, number] }[], add: [] as { name: string; at: [number, number]; class: string }[] }) {
  const r = await run({ adapters, region: 'us', area: [[-76, 40, -74, 42]], version: '20261108', store: createRawStore(mkdtempSync(join(tmpdir(), 'pw-raw-'))), registry: emptyRegistry(), edits, fetch: true, http: async () => { throw new Error('no network'); }, clock, newId: counter() });
  return r.packs[0];
}

test('PW14, PW7, PW13: the build turns Wikidata items (and, if given, OSM tags) into one region\'s archive, the same bytes each time', async () => {
  const items: Item[] = [
    { id: 'Q1', name: 'Bushkill Folly', lon: -75.2, lat: 40.7, p31: [FOLLY] },
    { id: 'Q2', name: 'Gone Tower', lon: -75.21, lat: 40.71, p31: ['Q1440300'] },
    { id: 'Q3', name: 'Old House', lon: -75.22, lat: 40.72, p31: [HOUSE] },
    { id: 'Q4', name: 'Unwanted Statue', lon: -75.23, lat: 40.73, p31: [STATUE] },
  ];
  const osm = osmSays([{ wikidata: 'Q2', name: 'Gone Tower', at: [-75.21, 40.71] }]);
  const edits = { remove: [{ name: 'Unwanted Statue', at: [-75.23, 40.73] as [number, number] }], add: [{ name: 'Giant Peanut', at: [-75.18, 40.69] as [number, number], class: 'roadside_giant' }] };
  const a = await buildWith([withAnswer(items), osm], edits);
  const b = await buildWith([withAnswer([...items].reverse()), osm], edits);
  assert.equal(a.file, 'places-us-20261108.pmtiles');
  assert.deepEqual(Buffer.from(a.bytes), Buffer.from(b.bytes));
  assert.deepEqual(a.places.map((p) => `${p.name}:${p.class}`).sort(), ['Bushkill Folly:folly', 'Giant Peanut:roadside_giant'],
    'the tower OSM says is demolished, the unlisted house and the removed statue are left out; the owner\'s add is in');
  const noOsm = await buildWith([withAnswer(items)]);
  assert.ok(noOsm.places.some((p) => p.name === 'Gone Tower'), 'without OSM, Wikidata alone decides');
});

test('PW14, PW7: the fetch asks each US cell for the pinned classes and heritage places, and never for a count', () => {
  const q = cellQuery([-76, 40, -75, 41]);
  for (const id of ALL_CLASS_IDS) assert.ok(q.includes(`wd:${id}`), id);
  assert.match(q, /wdt:P1435 wd:Q624232/, 'heritage only as a National Historic Landmark (places-worth-the-stop audit 5)');
  assert.ok(!/wdt:P649/.test(q), 'never every National Register listing, which the build would throw away');
  assert.match(q, /wdt:P17 wd:Q30/, 'in the US');
  assert.match(q, /cornerSouthWest "Point\(-76 40\)"/);
  assert.match(q, /wdt:P576/);
  assert.match(q, /wdt:P3999/);
  assert.ok(!/sitelinks|schema:about|wikipedia|pageviews|COUNT/i.test(q), 'nothing about articles or popularity is ever asked for (PW7)');
  assert.ok(cellsFor([[-125, 24, -66, 50]], 2).length > 300, 'the conterminous US in 2-degree cells');
  assert.deepEqual(splitCell([-76, 40, -74, 42]), [[-76, 40, -75, 41], [-75, 40, -74, 41], [-76, 41, -75, 42], [-75, 41, -74, 42]]);
});

test('PW14: the fetch\'s rows become one item each, with its classes, listing and whether it is gone', () => {
  const b = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { value: v }]));
  const items = itemsFrom([
    b({ item: 'http://www.wikidata.org/entity/Q1', label: 'Folly', coord: 'Point(-75.2 40.7)', p31: 'http://www.wikidata.org/entity/Q180174' }),
    b({ item: 'http://www.wikidata.org/entity/Q1', label: 'Folly', coord: 'Point(-75.2 40.7)', p31: 'http://www.wikidata.org/entity/Q3947', nhl: 'true' }),
    b({ item: 'http://www.wikidata.org/entity/Q2', label: 'Old Mill', coord: 'Point(-75.3 40.8)', p31: 'http://www.wikidata.org/entity/Q44494', dissolved: '1950-01-01', stateLabel: 'demolished' }),
  ]);
  assert.deepEqual(items, [
    { id: 'Q1', name: 'Folly', lon: -75.2, lat: 40.7, p31: ['Q180174', 'Q3947'], listed: false, nhl: true, dissolved: false, closed: false, states: [] },
    { id: 'Q2', name: 'Old Mill', lon: -75.3, lat: 40.8, p31: ['Q44494'], listed: false, nhl: false, dissolved: true, closed: false, states: ['demolished'] },
  ]);
});

test('PW15: no place in the archive is taken from OpenStreetMap (it only corroborates), so the map\'s own credit, which names it, stands', async () => {
  const pack = await buildWith([withAnswer([{ id: 'Q1', name: 'Light', lon: -75.2, lat: 40.7, p31: ['Q39715'] }]), osmSays([])], { remove: [], add: [{ name: 'Mine', at: [-75.1, 40.6], class: 'folly' }] });
  assert.deepEqual([...new Set(pack.places.map((p) => p.src))].sort(), ['owner', 'wd']);
});

test('PW19: the weekly build publishes only when the archive changed, and a failed build publishes nothing', () => {
  const blocks = { '8/71/96': 'aaaaaaaaaaaaaaaa' };
  const manifest = { schema: 1, regions: [{ id: 'us', current: { file: 'places-us-20261101.pmtiles', version: '20261101', bounds: [-125, 24, -66, 50], blocks } }] };
  assert.deepEqual(decide({ region: 'us', blocks, manifest }), { publish: false, reason: 'unchanged' });
  assert.deepEqual(decide({ region: 'us', blocks: { '8/71/96': 'bbbbbbbbbbbbbbbb' }, manifest }), { publish: true, reason: 'changed' });
  assert.deepEqual(decide({ region: 'us', blocks, manifest: { schema: 1, regions: [] } }), { publish: true, reason: 'new region' });
  assert.deepEqual(decide({ region: 'us', blocks, manifest: null }), { publish: true, reason: 'no manifest yet' });
  assert.deepEqual(decide({ region: 'us', blocks: null, manifest }), { publish: false, reason: 'no archive built' });
  assert.deepEqual(decide({ region: 'us', blocks, manifest: null, unreachable: true }), { publish: false, reason: 'manifest unreachable' }, 'places-worth-the-stop audit 7: one network error publishes nothing');
});
