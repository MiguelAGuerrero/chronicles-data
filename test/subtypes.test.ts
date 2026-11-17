/// <reference types="node" />
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Adapter, Box } from '../src/adapter';
import { CLASS_NAMES, CONTRACT_VERSION, UNNAMED_CLASSES } from '../src/classes';
import { emptyRegistry } from '../src/conflate';
import type { Clock } from '../src/http';
import { createRawStore } from '../src/rawStore';
import { run, type RunOptions } from '../src/runner';

// Subtypes, the data side (docs/subtypes/spec.md, ST1-ST10; the app's decision 0187). Written before the code.

const ROOT = join(fileURLToPath(import.meta.url), '../..');
const CELL: Box = [-76, 40, -74, 42];

type Classify = {
  classify: (item: { p31?: string[]; listed?: boolean; nhl?: boolean }) => string | null;
  listing: (item: { p31?: string[]; listed?: boolean; nhl?: boolean }) => { cls: string; publicType: boolean; needsOpen: boolean } | null;
};
const wd = async () => (await import(String('../src/adapters/wikidata/classify.mjs'))) as Classify;
type Osm = {
  osm: Adapter;
  smallClass: (t: Record<string, string>) => string | null;
  SMALL_FILTER: { expressions: string[] };
  LOCATES: readonly string[];
};
const osmMod = async () => (await import(String('../src/adapters/osm'))) as Osm;

function clock(): Clock {
  let t = Date.parse('2026-11-17T07:17:00Z');
  return { now: () => t, sleep: async (ms) => { t += ms; } };
}
function counter() {
  let k = 0;
  return () => `p_${(++k).toString(16).padStart(16, '0')}`;
}
type El = { tags: Record<string, string>; at?: [number, number] };
let n = 0;
const el = (tags: Record<string, string>, o: Partial<El> = {}): El => ({ tags, at: [-75.37 + ++n * 0.001, 40.61], ...o });
async function osmOf(small: El[]): Promise<Adapter> {
  const { osm } = await osmMod();
  const line = (e: El, i: number) => JSON.stringify({ type: 'Feature', geometry: { type: 'Point', coordinates: e.at }, properties: { '@id': `node/${i + 1}`, ...e.tags } });
  return { ...osm, async fetch(ctx) { ctx.put('small-us-test.geojsonl', small.map(line).join('\n')); ctx.put('confirm-us-test.geojsonl', ''); } };
}
async function build(adapters: Adapter[], extra: Partial<RunOptions> = {}) {
  return run({
    adapters, region: 'us', area: [CELL], version: '20261117', store: createRawStore(mkdtempSync(join(tmpdir(), 'st-raw-'))),
    registry: emptyRegistry(), edits: { remove: [], add: [] }, fetch: true, http: async () => new Response(''), clock: clock(), newId: counter(), ...extra,
  } as RunOptions);
}
const classes = (r: Awaited<ReturnType<typeof build>>) => r.packs.flatMap((p) => p.places).map((p) => `${p.class}:${p.name}`).sort();

const NEW = [
  'fountain', 'sign', 'plaque', 'war_memorial', 'battlefield', 'archaeological_site', 'bridge', 'mill', 'station', 'lighthouse',
  'civic_building', 'fort', 'water_tower', 'clock_tower', 'tavern', 'historic_machine', 'mausoleum', 'garden', 'waterfall', 'cave',
  'hot_spring', 'old_tree', 'concert_hall', 'observatory', 'carousel', 'zoo', 'fire_tower', 'ghost_town',
];

test('ST1: contract v4: the new classes, OSM locates the extended table', () => {
  assert.equal(CONTRACT_VERSION, 4);
  for (const c of NEW) assert.ok((CLASS_NAMES as readonly string[]).includes(c), c);
  const sources = JSON.parse(readFileSync(join(ROOT, 'contract/sources.json'), 'utf8'));
  assert.equal(sources.contractVersion, 4);
  const locates: string[] = sources.sources.find((s: { name: string }) => s.name === 'osm')?.locates ?? [];
  for (const c of ['fountain', 'plaque', 'war_memorial', 'mill', 'lighthouse', 'water_tower', 'historic_machine', 'garden', 'waterfall', 'cave', 'hot_spring', 'old_tree', 'carousel']) assert.ok(locates.includes(c), c);
});

test('ST2: a Wikidata item takes the first class in the order; the moved types land in their new classes', async () => {
  const { classify } = await wd();
  const is = (q: string) => classify({ p31: [q] });
  assert.equal(is('Q575759'), 'war_memorial');
  assert.equal(is('Q1825472'), 'bridge');
  assert.equal(is('Q39715'), 'lighthouse');
  assert.equal(is('Q74047'), 'ghost_town');
  assert.equal(is('Q109607'), 'ruin');
  assert.equal(is('Q748998'), 'fire_tower');
  assert.equal(is('Q10145'), 'old_stone');
  assert.equal(is('Q34038'), 'waterfall');
  assert.equal(is('Q167346'), 'garden');
  assert.equal(is('Q43501'), 'zoo');
  assert.equal(is('Q1060829'), 'concert_hall');
  assert.equal(is('Q62832'), 'observatory');
  assert.equal(is('Q208322'), 'carousel');
  assert.equal(is('Q811534'), 'old_tree');
  assert.equal(is('Q241045'), 'statue');
  assert.equal(is('Q133067'), 'mural');
  assert.equal(is('Q483453'), 'fountain');
  // The owner's "unless truly artistic": a fountain that is a sculpture too is a sculpture.
  assert.equal(classify({ p31: ['Q483453', 'Q860861'] }), 'sculpture');
});

test('ST3: a listed place takes its type root\'s class; entry is unchanged', async () => {
  const { listing } = await wd();
  assert.deepEqual(listing({ p31: ['Q12280'], listed: true }), { cls: 'bridge', publicType: true, needsOpen: false });
  assert.equal(listing({ p31: ['Q1137809'], listed: true })?.cls, 'civic_building');
  assert.equal(listing({ p31: ['Q55488'], listed: true })?.cls, 'station');
  assert.equal(listing({ p31: ['Q185187'], listed: true })?.cls, 'mill');
  assert.equal(listing({ p31: ['Q4895508'], listed: true })?.cls, 'battlefield');
  assert.equal(listing({ p31: ['Q839954'], listed: true })?.cls, 'archaeological_site');
  assert.equal(listing({ p31: ['Q153562'], listed: true })?.cls, 'concert_hall');
  // A tavern is no public type: it enters as a Landmark, or needs a confirming source, as any building did.
  assert.deepEqual(listing({ p31: ['Q154250'], nhl: true }), { cls: 'tavern', publicType: false, needsOpen: false });
  assert.deepEqual(listing({ p31: ['Q154250'], listed: true }), { cls: 'tavern', publicType: false, needsOpen: true });
  // No root names it: the broad class stays.
  assert.equal(listing({ p31: ['Q83405'], listed: true })?.cls, 'building_structure');
  assert.equal(listing({ p31: ['Q1081138'], listed: true })?.cls, 'historic_site');
});

test('ST4: the OSM table, pinned; any other tag is no place; access keeps a place out', async () => {
  const r = await build([await osmOf([
    el({ amenity: 'fountain', name: 'Fountain' }), el({ memorial: 'plaque', name: 'Plaque' }), el({ memorial: 'war_memorial', name: 'War' }),
    el({ man_made: 'windmill', name: 'Windmill' }), el({ man_made: 'watermill', name: 'Watermill' }), el({ man_made: 'lighthouse', name: 'Light' }),
    el({ man_made: 'water_tower', name: 'Tank' }), el({ historic: 'cannon', name: 'Cannon' }), el({ historic: 'locomotive', name: 'Engine' }),
    el({ leisure: 'garden', 'garden:type': 'botanical', name: 'Botanic' }), el({ waterway: 'waterfall', name: 'Falls' }),
    el({ natural: 'cave_entrance', name: 'Cave' }), el({ natural: 'hot_spring', name: 'Spring' }), el({ natural: 'geyser', name: 'Geyser' }),
    el({ natural: 'tree', denotation: 'natural_monument', name: 'Oak' }), el({ attraction: 'carousel', name: 'Carousel' }), el({ leisure: 'bandstand', name: 'Bandstand' }),
    el({ tourism: 'artwork', artwork_type: 'bust', name: 'Bust' }),
    el({ natural: 'tree', name: 'Any tree' }), el({ man_made: 'tower', name: 'Tower' }), el({ amenity: 'fountain', name: 'Closed', access: 'private' }),
  ])]);
  assert.deepEqual(classes(r), [
    'carousel:Bandstand', 'carousel:Carousel', 'cave:Cave', 'fountain:Fountain', 'garden:Botanic', 'historic_machine:Cannon', 'historic_machine:Engine',
    'hot_spring:Geyser', 'hot_spring:Spring', 'lighthouse:Light', 'mill:Watermill', 'mill:Windmill', 'old_tree:Oak', 'plaque:Plaque', 'statue:Bust',
    'war_memorial:War', 'waterfall:Falls', 'water_tower:Tank',
  ].sort());
});

test('ST5: a drinking fountain is never a fountain; an artistic one is a sculpture', async () => {
  const { smallClass } = await osmMod();
  assert.equal(smallClass({ amenity: 'fountain', fountain: 'drinking' }), null);
  assert.equal(smallClass({ amenity: 'fountain', fountain: 'bubbler' }), null);
  assert.equal(smallClass({ amenity: 'fountain', fountain: 'bottle_refill' }), null);
  assert.equal(smallClass({ amenity: 'fountain', drinking_water: 'yes' }), null);
  assert.equal(smallClass({ amenity: 'fountain', fountain: 'decorative' }), 'fountain');
  assert.equal(smallClass({ amenity: 'fountain', tourism: 'artwork' }), 'sculpture');
});

test('ST6: the classes that may come unnamed; an unnamed cave or water tower is no place', async () => {
  for (const c of ['fountain', 'plaque', 'war_memorial', 'mill', 'lighthouse', 'historic_machine', 'waterfall', 'hot_spring', 'old_tree', 'carousel']) assert.ok((UNNAMED_CLASSES as readonly string[]).includes(c), c);
  for (const c of ['water_tower', 'cave', 'garden', 'zoo', 'bridge']) assert.ok(!(UNNAMED_CLASSES as readonly string[]).includes(c), c);
  const r = await build([await osmOf([
    el({ amenity: 'fountain' }), el({ waterway: 'waterfall' }), el({ natural: 'cave_entrance' }), el({ man_made: 'water_tower' }),
    el({ man_made: 'water_tower', historic: 'yes' }), el({ man_made: 'water_tower', heritage: '2' }),
  ])]);
  assert.deepEqual(classes(r), ['fountain:', 'waterfall:']);
});

test('ST7: nothing truly unremarkable: springs, dams, benches, give boxes and wrecks are no class', async () => {
  const { smallClass } = await osmMod();
  for (const t of <Record<string, string>[]>[{ natural: 'spring' }, { waterway: 'dam' }, { amenity: 'bench' }, { amenity: 'give_box' }, { historic: 'wreck' }, { amenity: 'drinking_water' }]) assert.equal(smallClass(t), null, JSON.stringify(t));
  const { classify } = await wd();
  // GNIS's springs (Q124714) and dams (Q12323) are never asked for by type.
  assert.equal(classify({ p31: ['Q124714'] }), null);
  assert.equal(classify({ p31: ['Q12323'] }), null);
});

test('ST8: the review report lists each area\'s places of the new classes with their class', async () => {
  const r = await build([await osmOf([el({ waterway: 'waterfall', name: 'Bethlehem falls' }, { at: [-75.37, 40.615] })])], {
    reviewAreas: [{ name: 'Bethlehem', bbox: [-75.3918, 40.602, -75.3522, 40.632] }],
  });
  assert.deepEqual(r.report.added?.[0].places.map((p) => [p.name, p.class]), [['Bethlehem falls', 'waterfall']]);
});

test('ST9: the OSM fetch filter asks for the new tags, so its fetch key changes', async () => {
  const { SMALL_FILTER } = await osmMod();
  for (const e of ['amenity=fountain', 'man_made=lighthouse', 'man_made=water_tower', 'waterway=waterfall', 'natural=hot_spring', 'historic=cannon', 'attraction=carousel'])
    assert.ok(SMALL_FILTER.expressions.some((x) => x.startsWith(`nwr/${e.split('=')[0]}=`) && x.split('=')[1].split(',').includes(e.split('=')[1])), e);
});

test('ST10: no class name names significance', () => {
  for (const c of CLASS_NAMES) assert.doesNotMatch(c, /notable|remarkable|landmark|listed|champion|wonder|heritage|famous/, c);
  assert.ok((CLASS_NAMES as readonly string[]).includes('old_tree'));
});
