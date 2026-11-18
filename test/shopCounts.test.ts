/// <reference types="node" />
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { FetchContext } from '../src/adapter';

// OpenStreetMap shop counts, for the owner's review (docs/shop-counts/spec.md, SK1-SK8). Written before the code; loaded
// by a path TypeScript doesn't resolve until it exists.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const load = (p: string): Promise<any> => import(String(`../src/${p}`));
const hasOsmium = spawnSync('osmium', ['--version']).status === 0;
const PARTS = ['us-northeast', 'us-midwest', 'us-south', 'us-west'];

/** Real `osmium tags-count` output (osmium 1.16.0) for `shop=*` and `craft=*`. */
const ALL = '4\t"shop"\t"books"\n3\t"shop"\t"clothes"\n3\t"craft"\t"pottery"\n1\t"shop"\t"bokos"\n';
const SECOND = '3\t"shop"\t"clothes"\n1\t"shop"\t"books"\n';

test('SK1, SK2, SK3: every value of shop and craft is counted, in one small pass, with the second-hand among them', async () => {
  const m = await load('adapters/osm/shopCounts');
  assert.deepEqual(m.shopCountFilter(), ['nwr/shop', 'nwr/craft']);
  assert.deepEqual(m.shopCountExpressions(), ['shop=*', 'craft=*']);
  assert.deepEqual(m.SECOND_HAND_FILTER, ['nwr/second_hand=only,yes']);
});

test('SK9: every value of tourism, historic, leisure and amenity is counted too, straight from the extract', async () => {
  const m = await load('adapters/osm/shopCounts');
  assert.deepEqual(m.PLACE_COUNT_KEYS, ['tourism', 'historic', 'leisure', 'amenity', 'information']);
  assert.deepEqual(m.placeCountExpressions(), ['tourism=*', 'historic=*', 'leisure=*', 'amenity=*', 'information=*']);
  const { parseTagsCount } = await load('adapters/osm/tagCounts');
  const got = m.partShopCounts(parseTagsCount(ALL), parseTagsCount(SECOND), 3, parseTagsCount('7\t"tourism"\t"museum"\n2\t"tourism"\t"musuem"\n9\t"amenity"\t"library"\n'));
  assert.deepEqual(got['tourism=museum'], { all: 7, secondHand: 0, withHours: 0 });
  assert.deepEqual(got['amenity=library'], { all: 9, secondHand: 0, withHours: 0 });
  assert.equal(got['tourism=musuem'], undefined);
  assert.deepEqual(got['shop=books'], { all: 4, secondHand: 1, withHours: 0 });
});

test('SK10: how many of each kind say when they are open', async () => {
  const m = await load('adapters/osm/shopCounts');
  const { parseTagsCount } = await load('adapters/osm/tagCounts');
  assert.deepEqual(m.HOURS_FILTER, ['nwr/opening_hours']);
  const got = m.partShopCounts(parseTagsCount(ALL), parseTagsCount(SECOND), 3, parseTagsCount('7\t"tourism"\t"museum"\n'), parseTagsCount('2\t"shop"\t"books"\n5\t"tourism"\t"museum"\n'));
  assert.equal(got['shop=books'].withHours, 2);
  assert.equal(got['tourism=museum'].withHours, 5);
  assert.equal(got['shop=clothes'].withHours, 0);
});

test('SK4: a value under three elements of an extract is left out; the rest keep both counts', async () => {
  const m = await load('adapters/osm/shopCounts');
  const { parseTagsCount } = await load('adapters/osm/tagCounts');
  const got = m.partShopCounts(parseTagsCount(ALL), parseTagsCount(SECOND));
  assert.deepEqual(got, { 'shop=books': { all: 4, secondHand: 1, withHours: 0 }, 'shop=clothes': { all: 3, secondHand: 3, withHours: 0 }, 'craft=pottery': { all: 3, secondHand: 0, withHours: 0 } });
  assert.equal(m.MIN_PER_EXTRACT, 3);
});

test('SK5, SK6: the run sums its four extracts\' notes; one missing or unreadable and there are none', async () => {
  const m = await load('adapters/osm/shopCounts');
  const note = JSON.stringify({ 'shop=books': { all: 4, secondHand: 1, withHours: 0 }, 'shop=toys': { all: 5, secondHand: 0, withHours: 0 } });
  const other = JSON.stringify({ 'shop=books': { all: 10, secondHand: 2, withHours: 0 } });
  const meta = Object.fromEntries(PARTS.map((p, i) => [`shopCounts:${p}`, i === 0 ? note : other]));
  assert.deepEqual(m.sumShopParts(meta, PARTS), { 'shop=books': { all: 34, secondHand: 7, withHours: 0 }, 'shop=toys': { all: 5, secondHand: 0, withHours: 0 } });
  const { [`shopCounts:${PARTS[2]}`]: _gone, ...three } = meta;
  assert.equal(m.sumShopParts(three, PARTS), null);
  assert.equal(m.sumShopParts({ ...meta, [`shopCounts:${PARTS[1]}`]: 'not json' }, PARTS), null);
  assert.equal(m.sumShopParts({ ...meta, [`shopCounts:${PARTS[1]}`]: JSON.stringify({ 'shop=books': { all: 'many' } }) }, PARTS), null);
});

test('SK7: the report orders the tags by how many carry them, then by name, and says what was left out; only from a run that fetched OpenStreetMap', async () => {
  const m = await load('adapters/osm/shopCounts');
  const a = JSON.stringify({ 'shop=toys': { all: 5, secondHand: 0, withHours: 0 }, 'shop=books': { all: 5, secondHand: 1, withHours: 0 }, 'shop=clothes': { all: 9, secondHand: 4, withHours: 0 } });
  const meta = Object.fromEntries(PARTS.map((p) => [`shopCounts:${p}`, a]));
  const got = m.kindCountsForReport({ run: 'v1' }, 'v1', true, meta, PARTS);
  assert.equal(got.minPerExtract, 3);
  assert.deepEqual(Object.keys(got.tags), ['shop=clothes', 'shop=books', 'shop=toys']);
  assert.deepEqual(got.tags['shop=clothes'], { all: 36, secondHand: 16, withHours: 0 });
  assert.equal(m.kindCountsForReport({ run: 'v0' }, 'v1', true, meta, PARTS), null, 'answers carried from an earlier run');
  assert.equal(m.kindCountsForReport({ run: 'v1' }, 'v1', false, meta, PARTS), null, 'a run that did not ask OpenStreetMap');
  assert.equal(m.kindCountsForReport({ run: 'v1', error: 'x' }, 'v1', true, meta, PARTS), null);
});

test('SK2, SK3: on a real extract, osmium counts every value and the second-hand among them', { skip: !hasOsmium && 'osmium is not installed' }, async () => {
  const { countShopsIn } = await load('adapters/osm/extract');
  const dir = mkdtempSync(join(tmpdir(), 'shops-'));
  const node = (id: number, tags: Record<string, string>) => ` <node id="${id}" version="1" lat="41.8" lon="-71.${400 + id}">${Object.entries(tags).map(([k, v]) => `<tag k="${k}" v="${v}"/>`).join('')}</node>`;
  const rows = [
    ...[1, 2, 3, 4].map((i) => node(i, { shop: 'books', ...(i === 1 ? { second_hand: 'only' } : {}) })),
    ...[5, 6, 7].map((i) => node(i, { shop: 'clothes', second_hand: 'yes' })),
    ...[8, 9, 10].map((i) => node(i, { craft: 'pottery' })),
    node(11, { shop: 'bokos' }),
    node(12, { amenity: 'cafe', second_hand: 'yes' }),
    ...[13, 14, 15].map((i) => node(i, { tourism: 'museum', ...(i < 15 ? { opening_hours: 'Tu-Su 10:00-17:00' } : {}) })),
  ];
  const file = join(dir, 'x.osm');
  writeFileSync(file, `<?xml version='1.0' encoding='UTF-8'?>\n<osm version="0.6" generator="test">\n${rows.join('\n')}\n</osm>\n`);
  // SK9: the cafe's amenity is one element (left out); three museums are counted from the extract itself.
  assert.deepEqual(countShopsIn(file, dir, 'x'), { 'shop=books': { all: 4, secondHand: 1, withHours: 0 }, 'shop=clothes': { all: 3, secondHand: 3, withHours: 0 }, 'craft=pottery': { all: 3, secondHand: 0, withHours: 0 }, 'tourism=museum': { all: 3, secondHand: 0, withHours: 2 } });
});

test('SK8: the shop counts are outside the fetch fingerprint and write no raw part', async () => {
  const { readFileSync } = await import('node:fs');
  const idx = readFileSync(new URL('../src/adapters/osm/index.ts', import.meta.url), 'utf8');
  assert.match(idx, /fetchKey: \(\) => fingerprint\(\[GEOFABRIK, US_PARTS, FILTER, SMALL_FILTER, SHOP_FILTER\]\)/);
  const ex = readFileSync(new URL('../src/adapters/osm/extract.ts', import.meta.url), 'utf8');
  assert.match(ex, /SHOP_COUNTS_NOTE/);
  assert.doesNotMatch(ex, /ctx\.put\([^)]*shopCounts/);
});

test('SK11: an extract whose kinds were never counted is asked for whole, once; with its counts held it is asked only if it changed', async () => {
  const { filterExtracts } = await load('adapters/osm/extract');
  const { COUNT_TAGS, COUNTS_NOTE } = await load('adapters/osm/tagCounts');
  const { SHOP_COUNTS_NOTE } = await load('adapters/osm/shopCounts');
  const asked: Record<string, string>[] = [];
  const meta: Record<string, string> = {};
  const ctxWith = (held: Record<string, string>): FetchContext => ({
    area: [[-76, 40, -72, 42]], run: '20261119', week: 47, box: null, log: () => {},
    put: () => {},
    http: async (_u: string, init?: { headers?: Record<string, string> }) => { asked.push({ ...(init?.headers ?? {}) }); return new Response(null, { status: 304 }); },
    previous: { run: '20261118', startedAt: null, parts: [{ part: 'confirm-us-west.geojsonl', sha256: 'x', fetchedAt: '2026-11-18T07:17:00Z' }], read: () => '', meta: { 'etag:us-west': '"abc"', [`${COUNTS_NOTE}us-west`]: '{}', ...held } },
    carry: () => {}, keepClock: () => {}, setMeta: (k: string, v: string) => { meta[k] = v; }, sameFetch: true,
  } as unknown as FetchContext);
  const filter = [{ name: 'confirm', expressions: ['nwr/wikidata'] }];
  // Never counted: no "only if changed" header, so the extract comes whole (the fake's 304 is then no answer, and the run says so).
  await assert.rejects(filterExtracts(ctxWith({}), filter, ['us-west'], COUNT_TAGS));
  assert.equal(asked[0]['if-none-match'], undefined);
  // Counted before: asked only if it changed, and the note is carried.
  const note = JSON.stringify({ 'shop=books': { all: 4, secondHand: 1, withHours: 2 } });
  await filterExtracts(ctxWith({ [`${SHOP_COUNTS_NOTE}us-west`]: note }), filter, ['us-west'], COUNT_TAGS);
  assert.equal(asked[asked.length - 1]['if-none-match'], '"abc"');
  assert.equal(meta[`${SHOP_COUNTS_NOTE}us-west`], note);
});
