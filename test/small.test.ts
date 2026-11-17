/// <reference types="node" />
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Adapter, Box } from '../src/adapter';
import { partOf, wikidata } from '../src/adapters/wikidata';
import { CLASS_NAMES, CONTRACT_VERSION } from '../src/classes';
import { emptyRegistry } from '../src/conflate';
import type { Clock } from '../src/http';
import { createRawStore } from '../src/rawStore';
import { declarationProblems, run, type RunOptions } from '../src/runner';
import { CandidateSchema, FeatureSchema } from '../src/schema';

// Small places, the data side (docs/small-places/spec.md, SL1-SL11; the app's decision 0183). Written before the code.

const ROOT = join(fileURLToPath(import.meta.url), '../..');
const CELL: Box = [-76, 40, -74, 42];
const STATUE = 'Q179700';

function clock(): Clock {
  let t = Date.parse('2026-11-16T07:17:00Z');
  return { now: () => t, sleep: async (ms) => { t += ms; } };
}
function counter() {
  let k = 0;
  return () => `p_${(++k).toString(16).padStart(16, '0')}`;
}

type El = { tags: Record<string, string>; at?: [number, number]; geometry?: unknown; id?: string };
let n = 0;
/** An element as the shared extract step writes it into the small filter's part. */
const el = (tags: Record<string, string>, o: Partial<El> = {}): El => ({ tags, at: [-75.37 + ++n * 0.001, 40.61], ...o });

/** The real OSM adapter, its fetch writing these elements into the small part (SL9) and nothing to the confirming one. */
async function osmOf(small: El[], confirm: Record<string, string>[] = []): Promise<Adapter> {
  const { osm } = (await import(String('../src/adapters/osm'))) as { osm: Adapter };
  const line = (e: El, i: number) => JSON.stringify({
    type: 'Feature',
    geometry: e.geometry !== undefined ? e.geometry : { type: 'Point', coordinates: e.at },
    properties: { '@id': e.id ?? `node/${i + 1}`, ...e.tags },
  });
  return {
    ...osm,
    async fetch(ctx) {
      ctx.put('small-us-test.geojsonl', small.map(line).join('\n'));
      ctx.put('confirm-us-test.geojsonl', confirm.map((t, i) => line({ tags: t, at: [-75, 41] }, i + 1000)).join('\n'));
    },
  };
}

/** The Wikidata adapter answering with these items. */
function wikidataOf(items: { id: string; name: string; at: [number, number]; p31: string }[]): Adapter {
  const v = (value: string) => ({ value });
  const ent = (q: string) => v(`http://www.wikidata.org/entity/${q}`);
  const body = JSON.stringify({ results: { bindings: items.map((it) => ({ item: ent(it.id), label: v(it.name), coord: v(`Point(${it.at[0]} ${it.at[1]})`), p31: ent(it.p31) })) } });
  return { ...wikidata, async fetch(ctx) { ctx.put(partOf(CELL), body); } };
}

async function build(adapters: Adapter[], extra: Partial<RunOptions> = {}) {
  return run({
    adapters, region: 'us', area: [CELL], version: '20261116', store: createRawStore(mkdtempSync(join(tmpdir(), 'sl-raw-'))),
    registry: emptyRegistry(), edits: { remove: [], add: [] }, fetch: true, http: async () => new Response(''), clock: clock(), newId: counter(), ...extra,
  } as RunOptions);
}
const placesOf = (r: Awaited<ReturnType<typeof build>>) => r.packs.flatMap((p) => p.places);
const classes = (r: Awaited<ReturnType<typeof build>>) => placesOf(r).map((p) => `${p.class}:${p.name}`).sort();


test('SL1: OSM locates its table\'s classes and confirms the rest; locates is refused beside another role', async () => {
  const { osm } = (await import(String('../src/adapters/osm'))) as { osm: Adapter };
  assert.equal(osm.declaration.role, 'confirms');
  assert.ok((osm.declaration as { locates?: string[] }).locates?.includes('time_capsule'));
  const r = await build([await osmOf([el({ historic: 'time_capsule', name: 'Class of 1976 Time Capsule' }), el({ tourism: 'museum', name: 'An OSM-only museum' })])]);
  assert.deepEqual(classes(r), ['time_capsule:Class of 1976 Time Capsule'], 'a museum only OSM knows still makes no place');
  const bad = { ...osm.declaration, role: 'locates', locates: ['marker'] };
  assert.ok(declarationProblems(bad).some((p) => p.startsWith('locates')), 'locates only beside confirms');
});

test('SL2: the tag table, pinned; any other tag is no place', async () => {
  const r = await build([await osmOf([
    el({ historic: 'memorial', memorial: 'plaque', name: 'Plaque A' }), el({ memorial: 'blue_plaque', name: 'Plaque B' }),
    el({ historic: 'memorial', memorial: 'bench', name: 'Bench' }), el({ memorial: 'ghost_bike', name: 'Ghost bike' }), el({ memorial: 'stolperstein', name: 'Anna Frei' }),
    el({ historic: 'milestone', name: 'Mile 12' }), el({ historic: 'boundary_stone', name: 'Stone' }),
    el({ historic: 'wayside_shrine', name: 'Shrine' }), el({ historic: 'wayside_cross', name: 'Cross' }),
    el({ historic: 'time_capsule', name: 'Capsule' }), el({ amenity: 'public_bookcase', name: 'Books' }),
    el({ leisure: 'garden', 'garden:type': 'community', name: 'Garden' }), el({ leisure: 'garden', name: 'Private garden' }),
    el({ tourism: 'artwork', artwork_type: 'mural', name: 'Mural' }), el({ tourism: 'artwork', artwork_type: 'mosaic', name: 'Mosaic' }),
    el({ tourism: 'artwork', artwork_type: 'sculpture', name: 'Sculpture' }), el({ tourism: 'artwork', artwork_type: 'relief', name: 'Relief' }),
    el({ tourism: 'artwork', artwork_type: 'statue', name: 'Statue' }), el({ tourism: 'artwork', artwork_type: 'graffiti', name: 'Tag' }),
    el({ tourism: 'artwork', name: 'Untyped' }), el({ historic: 'memorial', memorial: 'war_memorial', name: 'War memorial' }),
  ])]);
  assert.deepEqual(classes(r), [
    'community_garden:Garden', 'mural:Mosaic', 'mural:Mural', 'old_stone:Mile 12', 'old_stone:Stone',
    // ST1 (the owner, Nov 17): OSM's plaques are `plaque`, apart from Wikidata's historical markers; a war memorial is a place.
    'plaque:Plaque A', 'plaque:Plaque B', 'public_bookcase:Books', 'sculpture:Relief', 'sculpture:Sculpture', 'small_memorial:Anna Frei', 'small_memorial:Bench', 'small_memorial:Ghost bike',
    'statue:Statue', 'time_capsule:Capsule', 'war_memorial:War memorial', 'wayside_shrine:Cross', 'wayside_shrine:Shrine',
  ]);
});

test('SL3: access=private or access=no makes no place', async () => {
  const r = await build([await osmOf([el({ amenity: 'public_bookcase', name: 'Open books' }), el({ amenity: 'public_bookcase', name: 'Yard books', access: 'private' }), el({ historic: 'milestone', name: 'Fenced', access: 'no' })])]);
  assert.deepEqual(classes(r), ['public_bookcase:Open books']);
});

test('SL4: an element naming a Wikidata item the build made is that place, not a second', async () => {
  const at: [number, number] = [-75.38, 40.62];
  const r = await build([wikidataOf([{ id: 'Q4242', name: 'Soldiers Statue', at, p31: STATUE }]), await osmOf([el({ tourism: 'artwork', artwork_type: 'statue', name: 'Civil War Soldier', wikidata: 'Q4242' }, { at: [at[0] + 0.002, at[1]] })])]);
  assert.deepEqual(classes(r), ['statue:Soldiers Statue']);
});

test('SL5: a small place may be unnamed; every other class still needs a name', async () => {
  const r = await build([await osmOf([el({ amenity: 'public_bookcase' }), el({ memorial: 'plaque' })])]);
  assert.deepEqual(classes(r), ['plaque:', 'public_bookcase:']);
  assert.ok(FeatureSchema.safeParse({ name: '', class: 'public_bookcase', src: 'osm', id: 'p_0000000000000001' }).success);
  assert.ok(!FeatureSchema.safeParse({ name: '', class: 'church', src: 'osm', id: 'p_0000000000000001' }).success, 'a church needs a name');
  assert.ok(!CandidateSchema.safeParse({ source: 'wikidata', sourceId: 'Q1', name: '', class: 'museum', signals: {}, fetchedAt: '2026-11-16T00:00:00Z' }).success);
});

test('SL6: unnamed twins of one class within 10 m are one place; never the same as a named one', async () => {
  const a: [number, number] = [-75.3, 40.6];
  const near: [number, number] = [a[0] + 0.00005, a[1]]; // about 4 m
  const far: [number, number] = [a[0] + 0.0004, a[1]]; // about 34 m
  const r = await build([await osmOf([
    el({ amenity: 'public_bookcase' }, { at: a }), el({ amenity: 'public_bookcase' }, { at: near }), el({ amenity: 'public_bookcase' }, { at: far }),
    el({ memorial: 'plaque' }, { at: near }), el({ memorial: 'plaque', name: 'Named plaque' }, { at: a }),
  ])]);
  assert.deepEqual(classes(r), ['plaque:', 'plaque:Named plaque', 'public_bookcase:', 'public_bookcase:']);
});

test('SL7: a way or an area becomes one point inside its bounds; no geometry is no place', async () => {
  const ring = [[-75.31, 40.61], [-75.30, 40.61], [-75.30, 40.62], [-75.31, 40.62], [-75.31, 40.61]];
  const r = await build([await osmOf([
    el({ leisure: 'garden', 'garden:type': 'community', name: 'Ring garden' }, { geometry: { type: 'Polygon', coordinates: [ring] }, id: 'way/7' }),
    el({ historic: 'boundary_stone', name: 'Lost stone' }, { geometry: null, id: 'relation/9' }),
  ])]);
  const g = placesOf(r).find((p) => p.name === 'Ring garden');
  assert.ok(g && g.at[0] > -75.31 && g.at[0] < -75.30 && g.at[1] > 40.61 && g.at[1] < 40.62, JSON.stringify(g?.at));
  assert.deepEqual(classes(r), ['community_garden:Ring garden']);
});

test('SL8: a pack with a place OpenStreetMap located is ODbL', async () => {
  const r = await build([await osmOf([el({ historic: 'time_capsule', name: 'Capsule' })])]);
  // PP9: its own family's pack; RD11: one ODbL pack for the region once OSM also confirmed a place there.
  assert.deepEqual(r.packs.map((p) => [p.license, p.places.map((q) => q.name)]), [['odbl', ['Capsule']]]);
});

test('SL9: the small places come from their own raw part of the same download; the filter is part of the fetch key', async () => {
  const { osm, SMALL_FILTER, FILTER } = (await import(String('../src/adapters/osm'))) as { osm: Adapter; SMALL_FILTER: { name: string; expressions: string[] }; FILTER: { name: string } };
  assert.equal(SMALL_FILTER.name, 'small');
  assert.notEqual(FILTER.name, SMALL_FILTER.name);
  for (const e of ['nwr/historic=time_capsule', 'nwr/amenity=public_bookcase', 'nwr/artwork_type=mural', 'nwr/garden:type=community']) assert.ok(SMALL_FILTER.expressions.some((x) => x.startsWith(e.split('=')[0]) && x.includes(e.split('=')[1])), e);
  const key = osm.fetchKey!([CELL]);
  assert.ok(key.length > 0);
  // The confirming part never locates, whatever its tags.
  const r = await build([await osmOf([], [{ historic: 'time_capsule', name: 'In the confirming part' }])]);
  assert.deepEqual(classes(r), []);
});

test('SL10: contract v3 (v4 since Subtypes, ST1): the new classes, locates in sources.json, an empty name only for the small classes', () => {
  assert.ok(CONTRACT_VERSION >= 3);
  for (const c of ['small_memorial', 'old_stone', 'wayside_shrine', 'time_capsule', 'public_bookcase', 'community_garden']) assert.ok((CLASS_NAMES as readonly string[]).includes(c), c);
  const sources = JSON.parse(readFileSync(join(ROOT, 'contract/sources.json'), 'utf8'));
  assert.ok(sources.contractVersion >= 3);
  assert.ok(sources.sources.find((s: { name: string }) => s.name === 'osm')?.locates?.includes('public_bookcase'));
});

test('SL11: the review report lists each area\'s small places with their class', async () => {
  const r = await build([await osmOf([el({ historic: 'time_capsule', name: 'Bethlehem capsule' }, { at: [-75.37, 40.615] })])], {
    reviewAreas: [{ name: 'Bethlehem', bbox: [-75.3918, 40.6020, -75.3522, 40.6320] }],
  });
  assert.deepEqual(r.report.added?.[0].places.map((p) => [p.name, p.class]), [['Bethlehem capsule', 'time_capsule']]);
});
