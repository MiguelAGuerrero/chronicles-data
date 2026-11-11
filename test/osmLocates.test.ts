/// <reference types="node" />
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Adapter, Box } from '../src/adapter';
import { partOf, wikidata } from '../src/adapters/wikidata';
import { CONTRACT_VERSION } from '../src/classes';
import { emptyRegistry } from '../src/conflate';
import type { Clock } from '../src/http';
import { createRawStore } from '../src/rawStore';
import { run, type RunOptions } from '../src/runner';
import { CandidateSchema, FeatureSchema, PlaceSchema } from '../src/schema';

// OpenStreetMap locates places (specs/osm-locates OL1-OL12 in the app repo, decision 0142), the build side: OL1-OL9
// and the contract's part of OL10. Written before the code.

const CELL: Box = [-77, 40, -76, 41];
const AT: [number, number] = [-76.8872, 40.2688];
/** About `m` metres east of AT. */
const east = (m: number): [number, number] => [AT[0] + m / 84_300, AT[1]];

type Tags = Record<string, string>;
type El = { tags: Tags; at?: [number, number]; geometry?: unknown };

/** The OSM-locating adapter, its fetch writing these elements as the shared extract step would. */
async function osmPlacesOf(elements: El[]): Promise<Adapter> {
  const { osmPlaces } = (await import(String('../src/adapters/osm/places'))) as { osmPlaces: Adapter };
  const lines = elements.map((e, i) => JSON.stringify({ type: 'Feature', geometry: e.geometry ?? { type: 'Point', coordinates: e.at ?? AT }, properties: { '@id': `node/${i + 1}`, ...e.tags } }));
  return { ...osmPlaces, async fetch(ctx) { ctx.put('places-us-test.geojsonl', lines.join('\n')); } };
}

type Item = { id: string; name: string; at: [number, number]; p31: string[] };
const Q = { monument: 'Q4989906', obelisk: 'Q170980', statue: 'Q179700', church: 'Q16970' };
function wikidataOf(items: Item[]): Adapter {
  const v = (value: string) => ({ value });
  const ent = (q: string) => v(`http://www.wikidata.org/entity/${q}`);
  const bindings = items.flatMap((it) => it.p31.map((c) => ({ item: ent(it.id), label: v(it.name), coord: v(`Point(${it.at[0]} ${it.at[1]})`), p31: ent(c), listed: v('true') })));
  return { ...wikidata, async fetch(ctx) { ctx.put(partOf(CELL), JSON.stringify({ results: { bindings } })); } };
}

function clock(): Clock {
  let t = Date.parse('2026-11-11T07:17:00Z');
  return { now: () => t, sleep: async (ms) => { t += ms; } };
}
function counter() {
  let k = 0;
  return () => `p_${(++k).toString(16).padStart(16, '0')}`;
}
async function build(adapters: Adapter[], extra: Partial<RunOptions> = {}) {
  return run({
    adapters, region: 'us', area: [CELL], version: '20261111', store: createRawStore(mkdtempSync(join(tmpdir(), 'ol-raw-'))),
    registry: emptyRegistry(), edits: { remove: [], add: [] }, fetch: true, http: async () => new Response(''), clock: clock(), newId: counter(), ...extra,
  } as RunOptions);
}
type Built = Awaited<ReturnType<typeof build>>;
const placesOf = (r: Built) => r.packs.flatMap((p) => p.places);
const only = async (elements: El[]) => placesOf(await build([await osmPlacesOf(elements)]));
const classes = (ps: { class?: string }[]) => ps.map((p) => p.class).sort();

test('OL1: a historic=monument element with no wikidata tag is in the pack as class monument, named or not', async () => {
  const ps = await only([{ tags: { historic: 'monument', name: 'Soldiers Monument' }, at: AT }, { tags: { historic: 'monument' }, at: east(500) }]);
  assert.deepEqual(classes(ps), ['monument', 'monument']);
  assert.deepEqual(ps.map((p) => p.name).sort(), [undefined, 'Soldiers Monument']);
});

test('OL2: a historic=memorial with a pinned memorial or monument value is in the pack as that value class, and the table is pinned', async () => {
  const { MEMORIAL_CLASSES } = (await import(String('../src/adapters/osm/places'))) as { MEMORIAL_CLASSES: Record<string, string> };
  assert.deepEqual(MEMORIAL_CLASSES, { obelisk: 'monument', column: 'monument', statue: 'statue', bust: 'statue', war_memorial: 'memorial', stone: 'memorial', cross: 'memorial' });
  const els: El[] = [
    { tags: { historic: 'memorial', memorial: 'obelisk', name: 'A' }, at: east(0) }, { tags: { historic: 'memorial', memorial: 'statue', name: 'B' }, at: east(300) },
    { tags: { historic: 'memorial', memorial: 'war_memorial', name: 'C' }, at: east(600) }, { tags: { historic: 'memorial', memorial: 'stone', name: 'D' }, at: east(900) },
    { tags: { historic: 'memorial', memorial: 'cross', name: 'E' }, at: east(1200) }, { tags: { historic: 'memorial', monument: 'obelisk', name: 'F' }, at: east(1500) },
  ];
  const byName = Object.fromEntries((await only(els)).map((p) => [p.name, p.class]));
  assert.deepEqual(byName, { A: 'monument', B: 'statue', C: 'memorial', D: 'memorial', E: 'memorial', F: 'monument' });
});

test('OL3: a value the table excludes is not in the pack, named or not, and a memorial with no value enters as a memorial, named or not', async () => {
  const out = ['plaque', 'bench', 'stolperstein', 'ghost_bike', 'blue_plaque', 'sculpture'];
  const els: El[] = out.flatMap((v, i) => [{ tags: { historic: 'memorial', memorial: v, name: `N${v}` }, at: east(i * 200) }, { tags: { historic: 'memorial', memorial: v }, at: east(i * 200 + 100) }]);
  assert.deepEqual(await only(els), []);
  const bare = await only([{ tags: { historic: 'memorial', name: 'Veterans Memorial' }, at: east(0) }, { tags: { historic: 'memorial' }, at: east(500) }]);
  assert.deepEqual(classes(bare), ['memorial', 'memorial']);
});

test('OL4: the same filter holds for named and unnamed places, and an unnamed place has no name in the pack', async () => {
  // Unnamed: excluded value out, private out, merged into a named one beside it, and it carries no name key at all.
  const ps = await only([
    { tags: { historic: 'memorial', memorial: 'plaque' }, at: east(0) },
    { tags: { historic: 'monument', access: 'private' }, at: east(300) },
    { tags: { historic: 'monument', name: 'Hessian Monument' }, at: east(600) },
    { tags: { historic: 'monument' }, at: east(620) },
    { tags: { historic: 'monument' }, at: east(1000) },
    { tags: { historic: 'monument' }, at: east(1010) },
  ]);
  assert.equal(ps.length, 3, 'the plaque and the private one are out; the unnamed beside a named one and the unnamed pair each merge');
  assert.equal(ps.filter((p) => p.name === 'Hessian Monument').length, 1);
  const bare = ps.filter((p) => p.name == null);
  assert.equal(bare.length, 2);
  for (const p of bare) assert.equal('name' in p, false);
  // A named place sorted after an unnamed one still wins.
  const late = await only([{ tags: { historic: 'monument' }, at: east(0) }, { tags: { historic: 'monument', name: 'Zed Monument' }, at: east(10) }]);
  assert.deepEqual(late.map((p) => p.name), ['Zed Monument']);
});

test('OL5: access=private|no and the demolished, razed and destroyed tags keep a place out, whichever source located it', async () => {
  const tags: Tags[] = [{ access: 'private' }, { access: 'no' }, { 'demolished:historic': 'monument' }, { 'razed:historic': 'monument' }, { 'destroyed:historic': 'monument' }];
  const els: El[] = tags.flatMap((t, i) => [{ tags: { historic: 'monument', name: `Named ${i}`, ...t }, at: east(i * 200) }, { tags: { historic: 'monument', ...t }, at: east(i * 200 + 100) }]);
  assert.deepEqual(await only(els), []);
  const open = await only([{ tags: { historic: 'monument', name: 'Open', access: 'yes' }, at: east(0) }]);
  assert.equal(open.length, 1);
});

test('OL6: the same place in OpenStreetMap and Wikidata is one place', async () => {
  const wd = (name: string, p31: string, at = AT): Item => ({ id: 'Q9001', name, at, p31: [p31] });
  // The same name within 50 m.
  let r = await build([wikidataOf([wd('Hessian Monument', Q.monument)]), await osmPlacesOf([{ tags: { historic: 'monument', name: 'Hessian Monument' }, at: east(30) }])]);
  assert.equal(placesOf(r).length, 1);
  // An unnamed place of the same class within 50 m of a named Wikidata one is that place.
  r = await build([wikidataOf([wd('Hessian Monument', Q.monument)]), await osmPlacesOf([{ tags: { historic: 'monument' }, at: east(30) }])]);
  assert.deepEqual(placesOf(r).map((p) => p.name), ['Hessian Monument']);
  // The element names the Wikidata item: one place, whatever the names.
  r = await build([wikidataOf([wd('Hessian Monument', Q.monument)]), await osmPlacesOf([{ tags: { historic: 'monument', name: 'Another Name', wikidata: 'Q9001' }, at: east(400) }])]);
  assert.equal(placesOf(r).length, 1);
  // An unnamed memorial beside a Wikidata church is a different place.
  r = await build([wikidataOf([wd('Zion Church', Q.church)]), await osmPlacesOf([{ tags: { historic: 'memorial' }, at: east(30) }])]);
  assert.deepEqual(classes(placesOf(r)), ['church', 'memorial']);
});

test('OL7: the gate reads no source name and no count, and a pack place keeps name, class, src and id', async () => {
  const wd: Item = { id: 'Q9001', name: 'Hessian Monument', at: AT, p31: [Q.monument] };
  const alone = placesOf(await build([wikidataOf([wd])]));
  const both = placesOf(await build([wikidataOf([wd]), await osmPlacesOf([{ tags: { historic: 'monument', name: 'Hessian Monument' }, at: east(10) }])]));
  assert.deepEqual(both, alone, 'a second source naming a place changes nothing about it');
  const unnamed = (await only([{ tags: { historic: 'monument' }, at: AT }]))[0];
  assert.deepEqual(Object.keys(unnamed).sort(), ['at', 'class', 'gone', 'id', 'license', 'src']);
  assert.equal(PlaceSchema.safeParse(unnamed).success, true);
  assert.equal(FeatureSchema.safeParse({ class: 'monument', src: 'osmp', id: unnamed.id }).success, true);
  assert.equal(FeatureSchema.safeParse({ class: 'monument', src: 'osmp', id: unnamed.id, sources: 2 }).success, false, 'no count can ride along');
});

test('OL8: the build report lists what OpenStreetMap added, by area and class, before a pack is published', async () => {
  const r = await build(
    [wikidataOf([{ id: 'Q9001', name: 'Commonwealth', at: east(2000), p31: [Q.statue] }]), await osmPlacesOf([
      { tags: { historic: 'monument', name: 'Hessian Monument' }, at: AT }, { tags: { historic: 'memorial', memorial: 'obelisk' }, at: east(300) },
    ])],
    { reviewAreas: [{ name: 'Harrisburg', bbox: [-76.9, 40.26, -76.86, 40.28] }] },
  );
  const area = r.report.added?.find((a) => a.area === 'Harrisburg');
  const mine = area?.places.filter((p) => p.reason === 'openstreetmap') ?? [];
  assert.deepEqual(mine.map((p) => p.class).sort(), ['monument', 'monument']);
  assert.ok(mine.some((p) => p.name === '(no name)'));
  assert.equal(r.report.summary?.['monument: openstreetmap'], 2);
  assert.equal(r.report.summary?.['statue: class'], 1, 'Wikidata places keep their own reason');
});

test('OL9: a place only OpenStreetMap knows enters with no second source, the pack is ODbL, and the confirming adapter still closes', async () => {
  const r = await build([await osmPlacesOf([{ tags: { historic: 'monument', name: 'Hessian Monument' }, at: AT }])]);
  assert.equal(r.packs.length, 1);
  assert.equal(r.packs[0].license, 'odbl');
  assert.equal(placesOf(r)[0].src, 'osmp');
  const { osm } = (await import(String('../src/adapters/osm'))) as { osm: Adapter };
  assert.equal(osm.declaration.role, 'confirms');
  const { osmPlaces } = (await import(String('../src/adapters/osm/places'))) as { osmPlaces: Adapter };
  assert.equal(osmPlaces.declaration.role, 'locates');
  assert.equal(osmPlaces.declaration.licenseFamily, 'odbl');
});

test('OL10: the contract is version 3 and a candidate may have no name', () => {
  assert.equal(CONTRACT_VERSION, 3);
  const base = { source: 'osm-places', sourceId: 'node/1', at: AT, class: 'monument', signals: {}, fetchedAt: '2026-11-11T07:17:00.000Z' };
  assert.equal(CandidateSchema.safeParse(base).success, true);
  assert.equal(CandidateSchema.safeParse({ ...base, name: '' }).success, false, 'an empty name is still no name written down');
});
