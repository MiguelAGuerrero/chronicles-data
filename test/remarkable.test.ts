/// <reference types="node" />
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Adapter, Box } from '../src/adapter';
import { partOf, wikidata } from '../src/adapters/wikidata';
import { cellQuery, itemsFrom } from '../src/adapters/wikidata/query';
import { CLASS_NAMES, CONTRACT_VERSION } from '../src/classes';
import { emptyRegistry } from '../src/conflate';
import type { Clock } from '../src/http';
import { createRawStore } from '../src/rawStore';
import { run, type RunOptions } from '../src/runner';
import { CandidateSchema } from '../src/schema';

// Remarkable and public, the data side (docs/remarkable-and-public/spec.md, RD1-RD14; the app's decisions 0109-0111).
// Written before the code. Class ids checked against Wikidata on Nov 9 (the app's pin).

const Q = {
  church: 'Q16970', cemetery: 'Q39614', roadBridge: 'Q537127', gristmill: 'Q623605', station: 'Q55488', courthouse: 'Q1137809',
  house: 'Q3947', building: 'Q41176', schoolBuilding: 'Q1244442', office: 'Q1021645', bank: 'Q18761864', hotel: 'Q27686',
  museum: 'Q33506', houseMuseum: 'Q2087181', theatre: 'Q24354', district: 'Q15243209', statue: 'Q179700', lighthouse: 'Q39715',
  ghostTown: 'Q74047', site: 'Q839954', battlefield: 'Q4895508',
};
const NRHP = 'Q19558910';
const CELL: Box = [-76, 40, -74, 42];
const AREA: Box[] = [CELL];

type Item = { id: string; name: string; at: [number, number]; p31: string[]; listed?: boolean; nhl?: boolean; ended?: boolean };
let n = 0;
const item = (name: string, p31: string[], o: Partial<Item> = {}): Item => ({ id: `Q9${++n}`, name, at: [-75.37 + n * 0.002, 40.61], p31, listed: true, ...o });

/** The query service's answer for these items, as `itemsFrom` reads it. */
function answer(items: Item[]) {
  const v = (value: string) => ({ value });
  const ent = (q: string) => v(`http://www.wikidata.org/entity/${q}`);
  const bindings = items.flatMap((it) => it.p31.map((c) => ({
    item: ent(it.id), label: v(it.name), coord: v(`Point(${it.at[0]} ${it.at[1]})`), p31: ent(c),
    ...(it.nhl ? { nhl: v('true') } : {}), ...(it.listed && !it.ended ? { listed: v('true') } : {}),
  })));
  return JSON.stringify({ results: { bindings } });
}

/** The real Wikidata adapter, its fetch answering from these items. */
const wikidataOf = (items: Item[]): Adapter => ({ ...wikidata, async fetch(ctx) { ctx.put(partOf(CELL), answer(items)); } });

/** The OSM adapter (RD7), its fetch writing these elements as the shared extract step would; loaded by a path TypeScript doesn't resolve. */
async function osmOf(elements: Record<string, string>[]): Promise<Adapter> {
  const { osm } = (await import(String('../src/adapters/osm'))) as { osm: Adapter };
  const lines = elements.map((tags, i) => JSON.stringify({ type: 'Feature', geometry: { type: 'Point', coordinates: [-75, 41] }, properties: { '@id': `node/${i + 1}`, ...tags } }));
  return { ...osm, async fetch(ctx) { ctx.put('us-test.geojsonl', lines.join('\n')); } };
}
const tagFor = (it: Item, tags: Record<string, string>) => ({ wikidata: it.id, ...tags });

function clock(): Clock {
  let t = Date.parse('2026-11-10T07:17:00Z');
  return { now: () => t, sleep: async (ms) => { t += ms; } };
}
function counter() {
  let k = 0;
  return () => `p_${(++k).toString(16).padStart(16, '0')}`;
}
async function build(adapters: Adapter[], extra: Partial<RunOptions> = {}) {
  return run({
    adapters, region: 'us', area: AREA, version: '20261110', store: createRawStore(mkdtempSync(join(tmpdir(), 'rd-raw-'))),
    registry: emptyRegistry(), edits: { remove: [], add: [] }, fetch: true, http: async () => new Response(''), clock: clock(), newId: counter(), ...extra,
  } as RunOptions);
}
const placesOf = (r: Awaited<ReturnType<typeof build>>) => r.packs.flatMap((p) => p.places);
const names = (r: Awaited<ReturnType<typeof build>>) => placesOf(r).map((p) => p.name).sort();
const classOf = (r: Awaited<ReturnType<typeof build>>, name: string) => placesOf(r).find((p) => p.name === name)?.class;

test('RD1: a listed church, cemetery, bridge, mill and station enter by type', { todo: 'test first' }, async () => {
  const r = await build([wikidataOf([
    item('Central Moravian Church', [Q.church]), item('Nisky Hill Cemetery', [Q.cemetery]), item('Northampton Street Bridge', [Q.roadBridge]),
    item('Bushkill Gristmill', [Q.gristmill]), item('Mauch Chunk Station', [Q.station]),
  ])]);
  assert.deepEqual(names(r), ['Bushkill Gristmill', 'Central Moravian Church', 'Mauch Chunk Station', 'Nisky Hill Cemetery', 'Northampton Street Bridge']);
  assert.equal(classOf(r, 'Central Moravian Church'), 'church');
  assert.equal(classOf(r, 'Northampton Street Bridge'), 'building_structure');
});

test('RD2: a home is never public by type; a courthouse stays public', { todo: 'test first' }, async () => {
  const r = await build([wikidataOf([item('Kistler Residence', [Q.house]), item('Old Lehigh County Courthouse', [Q.courthouse])])]);
  assert.deepEqual(names(r), ['Old Lehigh County Courthouse']);
});

test('RD3: a Landmark enters whatever its type, a private house too', { todo: 'test first' }, async () => {
  const r = await build([wikidataOf([item('Private Landmark House', [Q.house], { listed: false, nhl: true }), item('Landmark Office', [Q.office], { nhl: true })])]);
  assert.deepEqual(names(r), ['Landmark Office', 'Private Landmark House']);
});

test('RD4: a district never enters, also typed ghost town or monument', { todo: 'test first' }, async () => {
  const r = await build([wikidataOf([item('Eckley Miners\' Village', [Q.district, Q.ghostTown], { nhl: true }), item('A District', [Q.district]), item('A Church', [Q.church])])]);
  assert.deepEqual(names(r), ['A Church']);
});

test('RD5: an ended listing is none; a cut-off answer splits the cell', { todo: 'test first' }, async () => {
  assert.match(cellQuery(CELL), /p:P1435 \?h\w* \. \?h\w* ps:P1435 wd:Q19558910 \. FILTER NOT EXISTS \{ \?h\w* pq:P582/, 'an ended listing is no listing');
  const r = await build([wikidataOf([item('Delisted Mill', [Q.gristmill], { ended: true })])]);
  assert.deepEqual(names(r), []);
  const { parseAnswer } = (await import(String('../src/adapters/wikidata/query'))) as { parseAnswer?: (t: string) => unknown };
  assert.equal(parseAnswer?.('{"results": {"bindings": [{"item"'), null, 'a cut-off answer is a split');
  void NRHP;
});

test('RD6: museums and sites take their own class; 0103\'s classes keep theirs', { todo: 'test first' }, async () => {
  const r = await build([wikidataOf([
    item('A Museum', [Q.museum]), item('A Theatre', [Q.theatre]), item('Bushy Run Battlefield', [Q.battlefield], { nhl: true }),
    item('Indian Steps', [Q.site], { nhl: true }), item('Washington Grays Monument', [Q.statue]), item('A Lighthouse', [Q.lighthouse]),
  ])]);
  assert.equal(classOf(r, 'A Museum'), 'museum');
  assert.equal(classOf(r, 'A Theatre'), 'theatre');
  assert.equal(classOf(r, 'Bushy Run Battlefield'), 'historic_site');
  assert.equal(classOf(r, 'Indian Steps'), 'historic_site');
  assert.equal(classOf(r, 'Washington Grays Monument'), 'statue');
  assert.equal(classOf(r, 'A Lighthouse'), 'odd_engineering');
});

test('RD7: the OSM adapter confirms by wikidata tag only, never makes a place; one, two or five open elements give identical blocks, and closed wins', { todo: 'test first' }, async () => {
  const trout = item('Trout Hall', [Q.house]);
  const osm = await osmOf([{ tourism: 'museum', name: 'An OSM-only museum' }]);
  assert.equal(osm.declaration.role, 'confirms');
  assert.equal(osm.declaration.licenseFamily, 'odbl');
  const alone = await build([wikidataOf([trout]), osm]);
  assert.deepEqual(names(alone), [], 'no element carries its id, and OSM makes no place of its own');
  const once = await build([wikidataOf([trout]), await osmOf([tagFor(trout, { tourism: 'museum' })])]);
  const five = await build([wikidataOf([trout]), await osmOf(Array.from({ length: 5 }, () => tagFor(trout, { tourism: 'museum' })))]);
  assert.deepEqual(names(once), ['Trout Hall']);
  assert.deepEqual(once.packs.map((p) => p.blocks), five.packs.map((p) => p.blocks), 'how many say open changes nothing');
  const split = await build([wikidataOf([trout]), await osmOf([tagFor(trout, { tourism: 'museum' }), tagFor(trout, { access: 'private' })])]);
  assert.deepEqual(names(split), [], 'closed wins');
  const both = await osmOf([{ wikidata: `${trout.id};Q123`, tourism: 'museum' }]);
  assert.deepEqual(names(await build([wikidataOf([trout]), both])), ['Trout Hall'], 'wikidata=Q1;Q2 speaks for both');
});

test('RD8: a listed house enters only shown open (a museum type or an OSM visitor tag); historic=building is no sign', { todo: 'test first' }, async () => {
  const trout = item('Trout Hall', [Q.house]);
  const burnside = item('Burnside Plantation', [Q.building]);
  const plain = item('Gauff-Roth House', [Q.house]);
  const gem = item('Gemeinhaus', [Q.building, Q.houseMuseum]);
  const r = await build([wikidataOf([trout, burnside, plain, gem]), await osmOf([tagFor(trout, { tourism: 'museum' }), tagFor(burnside, { tourism: 'attraction' }), tagFor(plain, { historic: 'building' })])]);
  assert.deepEqual(names(r), ['Burnside Plantation', 'Gemeinhaus', 'Trout Hall']);
  const noOsm = await build([wikidataOf([trout, plain, gem])]);
  assert.deepEqual(names(noOsm), ['Gemeinhaus'], 'without OSM, only a museum type shows a house open');
});

test('RD9: access=private or no keeps a place out, a Landmark too', { todo: 'test first' }, async () => {
  const estate = item('Gated Landmark Estate', [Q.house], { nhl: true });
  const chapel = item('Closed Chapel', [Q.church]);
  const open = item('Open Church', [Q.church]);
  const r = await build([wikidataOf([estate, chapel, open]), await osmOf([tagFor(estate, { access: 'private' }), tagFor(chapel, { access: 'no' }), tagFor(open, { access: 'yes' })])]);
  assert.deepEqual(names(r), ['Open Church']);
});

test('RD10: was:* keeps a place; demolished:, razed:, destroyed: remove it', { todo: 'test first' }, async () => {
  const station = item('Union Station', [Q.station]);
  const a = item('Gone Station', [Q.station]);
  const b = item('Razed Mill', [Q.gristmill]);
  const c = item('Burnt Church', [Q.church]);
  const r = await build([wikidataOf([station, a, b, c]), await osmOf([
    tagFor(station, { 'was:railway': 'station', amenity: 'restaurant' }), tagFor(a, { 'demolished:building': 'train_station' }),
    tagFor(b, { 'razed:building': 'mill' }), tagFor(c, { 'destroyed:building': 'church' }),
  ])]);
  assert.deepEqual(names(r), ['Union Station']);
});

test('RD11: a region OSM changed packs as one ODbL file under the region\'s id; one where OSM only closed a place too', { todo: 'test first' }, async () => {
  const trout = item('Trout Hall', [Q.house]);
  const church = item('A Church', [Q.church]);
  const opened = await build([wikidataOf([trout, church]), await osmOf([tagFor(trout, { tourism: 'museum' })])]);
  assert.equal(opened.packs.length, 1, 'one file');
  assert.equal(opened.packs[0].region, 'us', 'under the region\'s id');
  assert.equal(opened.packs[0].license, 'odbl');
  const closedOnly = await build([wikidataOf([church, item('Shut Church', [Q.church])]), await osmOf([{ wikidata: 'Q999999', access: 'private' }, tagFor(church, { access: 'private' })])]);
  assert.equal(closedOnly.packs[0]?.license, 'odbl', 'OSM only removed a place, and the pack is ODbL still');
  const untouched = await build([wikidataOf([church]), await osmOf([{ wikidata: 'Q999999', tourism: 'museum' }])]);
  assert.equal(untouched.packs[0].license, 'cc0', 'OSM said nothing about any place here');
});

test('RD12: the report lists each added place with its reason per test area, and is not in the release', { todo: 'test first' }, async () => {
  const church = item('A Church', [Q.church]);
  const trout = item('Trout Hall', [Q.house]);
  const landmark = item('Landmark House', [Q.house], { nhl: true });
  const r = await build([wikidataOf([church, trout, landmark]), await osmOf([tagFor(trout, { tourism: 'museum' })])], { reviewAreas: [{ name: 'Bethlehem', bbox: [-76, 40, -74, 42] }] } as never);
  const added = (r.report as unknown as { added?: { area: string; places: { name: string; class: string; reason: string }[] }[] }).added;
  assert.deepEqual(Object.fromEntries((added?.[0]?.places ?? []).map((p) => [p.name, p.reason])), { 'A Church': 'public type', 'Trout Hall': 'shown open', 'Landmark House': 'landmark' });
  for (const p of placesOf(r)) assert.ok(!('reason' in p) && !('listed' in p), 'no place holds the reason or the listing');
  assert.ok(!JSON.stringify(r.registry).includes('landmark'), 'nor the registry');
});

test('RD13: contract v2 has the five classes and building_structure, no class name names significance, and it is the code\'s', { todo: 'test first' }, () => {
  assert.equal(CONTRACT_VERSION, 2);
  for (const c of ['church', 'cemetery', 'theatre', 'museum', 'historic_site', 'building_structure']) assert.ok((CLASS_NAMES as readonly string[]).includes(c), c);
  for (const c of CLASS_NAMES) assert.ok(!/heritage|listed|landmark|notable|remarkable|historic_building/.test(c), c);
});

test('RD14: the new signals are booleans and every object stays closed', { todo: 'test first' }, () => {
  const base = { source: 'wikidata', sourceId: 'Q1', name: 'A', at: [-75, 41], fetchedAt: '2026-11-10T07:17:00.000Z' };
  for (const s of ['listed', 'needsOpen', 'open', 'closed']) {
    assert.equal(CandidateSchema.safeParse({ ...base, signals: { [s]: true } }).success, true, `${s} is a signal`);
    assert.equal(CandidateSchema.safeParse({ ...base, signals: { [s]: 3 } }).success, false, `${s} is never a number`);
  }
  assert.equal(CandidateSchema.safeParse({ ...base, signals: { sitelinks: 40 } }).success, false, 'nothing else');
  void itemsFrom;
});
