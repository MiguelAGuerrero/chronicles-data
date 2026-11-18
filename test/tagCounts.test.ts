/// <reference types="node" />
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { FetchContext } from '../src/adapter';

// OpenStreetMap tag counts, for the owner's review (docs/osm-tag-counts/spec.md, OC1-OC7). Written before the code;
// loaded by a path TypeScript doesn't resolve until it exists.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const load = (p: string): Promise<any> => import(String(`../src/${p}`));
const ROOT = join(fileURLToPath(import.meta.url), '../..');
const FIXTURE = join(ROOT, 'test/fixtures/osm-counts.osm');
const hasOsmium = spawnSync('osmium', ['--version']).status === 0;
const PARTS = ['us-northeast', 'us-midwest', 'us-south', 'us-west'];

/** Real `osmium tags-count` output (osmium 1.16.0, on test/fixtures/osm-counts.osm without the natural=waterfall node). */
const ALL = '2\t"tourism"\t"artwork"\n2\t"tourism"\t"museum"\n1\t"historic"\t"castle"\n1\t"leisure"\t"park"\n1\t"waterway"\t"waterfall"\n';
const WITH_WD = '1\t"historic"\t"castle"\n1\t"leisure"\t"park"\n1\t"tourism"\t"museum"\n';

test('OC1: the counted tags are pinned; a waterfall is waterway=waterfall', async () => {
  const { COUNT_TAGS, COUNTED } = await load('adapters/osm/tagCounts');
  assert.deepEqual(COUNT_TAGS, {
    tourism: ['museum', 'attraction', 'theme_park', 'zoo', 'aquarium', 'viewpoint', 'gallery', 'artwork'],
    leisure: ['nature_reserve', 'garden', 'park', 'water_park'],
    man_made: ['pier'],
    historic: ['memorial', 'monument', 'ruins', 'fort', 'castle', 'archaeological_site', 'ship', 'wreck', 'building', 'manor'],
    natural: ['cave_entrance'],
    waterway: ['waterfall'],
  });
  assert.equal(COUNTED.length, 26);
  assert.ok(COUNTED.includes('waterway=waterfall') && !COUNTED.includes('natural=waterfall'));
});

test('OC2: tags-count\'s lines are read; a tag with no line counts 0; its expressions carry no type prefix', async () => {
  const { parseTagsCount, countExpressions, countFilter } = await load('adapters/osm/tagCounts');
  assert.deepEqual(parseTagsCount(ALL), { 'tourism=artwork': 2, 'tourism=museum': 2, 'historic=castle': 1, 'leisure=park': 1, 'waterway=waterfall': 1 });
  assert.deepEqual(parseTagsCount(''), {}, 'nothing matched, no lines');
  assert.deepEqual(parseTagsCount('3\t"tourism"\n'), {}, 'a key-only line is no tag');
  const table = { tourism: ['museum', 'zoo'], man_made: ['pier'] };
  assert.deepEqual(countExpressions(table), ['tourism=museum,zoo', 'man_made=pier']);
  assert.deepEqual(countFilter(table), ['nwr/tourism=museum,zoo', 'nwr/man_made=pier']);
});

test('OC3, OC5: one part\'s counts hold every pinned tag; the run\'s are the sum of the four parts', async () => {
  const { partCounts, sumParts, parseTagsCount, COUNTED, COUNTS_NOTE } = await load('adapters/osm/tagCounts');
  const one = partCounts(parseTagsCount(ALL), parseTagsCount(WITH_WD));
  assert.deepEqual(Object.keys(one), COUNTED, 'every pinned tag, in order');
  assert.deepEqual(one['tourism=museum'], { all: 2, withWikidata: 1 });
  assert.deepEqual(one['tourism=artwork'], { all: 2, withWikidata: 0 });
  assert.deepEqual(one['man_made=pier'], { all: 0, withWikidata: 0 });
  const meta = Object.fromEntries(PARTS.map((p) => [`${COUNTS_NOTE}${p}`, JSON.stringify(one)]));
  const sum = sumParts({ ...meta, 'etag:us-west': '"x"' }, PARTS);
  assert.deepEqual(sum['tourism=museum'], { all: 8, withWikidata: 4 });
  assert.deepEqual(sum['historic=castle'], { all: 4, withWikidata: 4 });
  assert.deepEqual(Object.keys(sum), COUNTED);
  // OC5: a part of the US is never reported as the whole.
  const { [`${COUNTS_NOTE}us-south`]: _, ...missing } = meta;
  assert.equal(sumParts(missing, PARTS), null, 'a part with no note: no counts');
  const { 'tourism=museum': __, ...fewer } = one;
  assert.equal(sumParts({ ...meta, [`${COUNTS_NOTE}us-west`]: JSON.stringify(fewer) }, PARTS), null, 'a part that counted another set of tags: no counts');
  assert.equal(sumParts({ ...meta, [`${COUNTS_NOTE}us-west`]: 'not json' }, PARTS), null);
});

test('OC4: an extract unchanged since the copy held carries its counts with its answers', async () => {
  const { filterExtracts } = await load('adapters/osm/extract');
  const { COUNT_TAGS, COUNTS_NOTE } = await load('adapters/osm/tagCounts');
  const meta: Record<string, string> = {};
  const note = JSON.stringify({ 'tourism=museum': { all: 5, withWikidata: 2 } });
  const ctx: FetchContext = {
    area: [[-76, 40, -72, 42]], run: '20261118', week: 47, box: null, log: () => {},
    put: () => assert.fail('nothing is downloaded or written'),
    http: async () => new Response(null, { status: 304 }),
    previous: { run: '20261111', startedAt: null, parts: [{ part: 'confirm-us-west.geojsonl', sha256: 'x', fetchedAt: '2026-11-11T07:17:00Z' }], read: () => '', meta: { 'etag:us-west': '"abc"', [`${COUNTS_NOTE}us-west`]: note } },
    carry: () => {}, keepClock: () => {}, setMeta: (k, v) => { meta[k] = v; }, sameFetch: true,
  };
  await filterExtracts(ctx, [{ name: 'confirm', expressions: ['nwr/wikidata'] }], ['us-west'], COUNT_TAGS);
  assert.equal(meta[`${COUNTS_NOTE}us-west`], note);
});

test('OC6: the report holds counts only from a run that fetched OpenStreetMap', async () => {
  const { countsForReport, partCounts, COUNTS_NOTE } = await load('adapters/osm/tagCounts');
  const one = JSON.stringify(partCounts({ 'tourism=museum': 3 }, { 'tourism=museum': 1 }));
  const meta = Object.fromEntries(PARTS.map((p) => [`${COUNTS_NOTE}${p}`, one]));
  const v = '20261118.40';
  const fetched = countsForReport({ name: 'osm', run: v }, v, true, meta, PARTS);
  assert.deepEqual(fetched['tourism=museum'], { all: 12, withWikidata: 4 });
  assert.equal(countsForReport({ name: 'osm', run: '20261111.39' }, v, false, meta, PARTS), null, 'a push builds OSM from kept answers: no counts');
  assert.equal(countsForReport({ name: 'osm', run: v }, v, false, meta, PARTS), null, '--no-fetch over this version\'s answers: no counts');
  assert.equal(countsForReport({ name: 'osm', run: '20261111.39', error: 'x', fellBack: '20261111.39' }, v, true, meta, PARTS), null, 'a fetch that fell back: no counts');
  assert.equal(countsForReport(undefined, v, true, meta, PARTS), null);
  assert.equal(countsForReport({ name: 'osm', run: v }, v, true, {}, PARTS), null, 'no notes, no counts, no failure');
  // The CLI writes the key only when there are counts.
  const cli = readFileSync(join(ROOT, 'src/cli.ts'), 'utf8');
  assert.match(cli, /osmTagCounts/);
});

test('OC3, OC7: osmium counts each extract in the run\'s pass, and the raw parts are the same with or without counting', { skip: !hasOsmium && 'osmium is not installed (it is only on runs that fetch OpenStreetMap)' }, async () => {
  const { filterExtracts } = await load('adapters/osm/extract');
  const { COUNT_TAGS, COUNTS_NOTE } = await load('adapters/osm/tagCounts');
  const dir = mkdtempSync(join(tmpdir(), 'oc-'));
  const pbf = join(dir, 'fixture.osm.pbf');
  assert.equal(spawnSync('osmium', ['cat', FIXTURE, '-o', pbf]).status, 0);
  const bytes = readFileSync(pbf);
  const fetchWith = async (counts?: unknown) => {
    const puts: Record<string, string> = {};
    const meta: Record<string, string> = {};
    const logs: string[] = [];
    let asked = 0;
    const ctx: FetchContext = {
      area: [[-76, 40, -72, 42]], run: '20261118', week: 47, box: null, log: (l) => logs.push(l),
      put: (p, b) => { puts[p] = b; },
      http: async () => { asked++; return new Response(bytes, { status: 200 }); },
      previous: null, carry: () => {}, keepClock: () => {}, setMeta: (k, v) => { meta[k] = v; }, sameFetch: false,
    };
    await filterExtracts(ctx, [{ name: 'small', expressions: ['nwr/tourism=artwork'] }, { name: 'confirm', expressions: ['nwr/wikidata'], then: ['nwr/tourism=museum'] }], ['us-west'], counts);
    return { puts, meta, logs, asked };
  };
  const counted = await fetchWith(COUNT_TAGS);
  assert.equal(counted.asked, 1, 'the extract is downloaded once');
  const c = JSON.parse(counted.meta[`${COUNTS_NOTE}us-west`]);
  assert.deepEqual(c['tourism=museum'], { all: 2, withWikidata: 1 });
  // -R: the artwork node a park with a wikidata tag refers to doesn't carry the wikidata tag itself.
  assert.deepEqual(c['tourism=artwork'], { all: 2, withWikidata: 0 });
  assert.deepEqual(c['leisure=park'], { all: 1, withWikidata: 1 });
  assert.deepEqual(c['historic=castle'], { all: 1, withWikidata: 1 });
  // -R: the waterfall way a castle relation with a wikidata tag refers to doesn't carry it either.
  assert.deepEqual(c['waterway=waterfall'], { all: 1, withWikidata: 0 });
  assert.deepEqual(c['man_made=pier'], { all: 0, withWikidata: 0 });
  assert.equal(c['natural=waterfall'], undefined, 'natural=waterfall is not counted');
  // OC7: counting changes nothing the run keeps.
  const plain = await fetchWith(undefined);
  assert.deepEqual(counted.puts, plain.puts, 'the same raw parts with or without counting');
  assert.ok(Object.keys(plain.puts).length === 2);
  assert.ok(!Object.keys(plain.meta).some((k) => k.startsWith(COUNTS_NOTE)), 'no counting asked, no note');
  // OC7: a count that fails is logged; the fetch goes on with the same parts and no note.
  const failed = await fetchWith({});
  assert.deepEqual(failed.puts, plain.puts);
  assert.ok(!Object.keys(failed.meta).some((k) => k.startsWith(COUNTS_NOTE)));
  assert.ok(failed.logs.some((l) => /count/.test(l)), failed.logs.join('\n'));
});

test('OC7: the counts reach no place: the adapters never read them, and they are not in the fingerprint of what is fetched', async () => {
  const src = (p: string) => readFileSync(join(ROOT, 'src', p), 'utf8');
  for (const f of ['runner.ts', 'conflate.ts', 'gate.ts', 'package.ts', 'stores/build.ts']) assert.doesNotMatch(src(f), /tagCounts|osmTagCounts|COUNT_TAGS/, `${f} never reads the counts`);
  // The OSM adapter asks for the counts through the shared step, and its adapt never reads them.
  const { osm } = await load('adapters/osm');
  assert.match(String(osm.fetch), /COUNT_TAGS/);
  assert.doesNotMatch(String(osm.adapt), /count/i);
  const { fingerprint } = await load('fingerprint');
  const { GEOFABRIK, US_PARTS } = await load('adapters/osm/extract');
  const { FILTER, SMALL_FILTER } = await load('adapters/osm');
  const { SHOP_FILTER } = await load('stores/osmShops');
  assert.equal(osm.fetchKey([]), fingerprint([GEOFABRIK, US_PARTS, FILTER, SMALL_FILTER, SHOP_FILTER]), 'the fingerprint is unchanged (ST9)');
});
