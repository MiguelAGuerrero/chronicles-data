// Writes the places archive (Places worth the stop, PW14, decision 0103): one region's places as a PMTiles v3
// file of gzipped z12 vector tiles, layer `places`, each point carrying name, class, src and id (PW7) and nothing
// else. Unlike the e2e's harness encoder it writes leaf directories, so a US-sized archive keeps its root in the
// first 16 KB the reader asks for. The same places give the same bytes, whatever order they come in.
import { gzipSync } from 'node:zlib';
import { PbfWriter } from 'pbf';
import { zxyToTileId } from 'pmtiles';

export const ZOOM = 12;
const EXTENT = 4096;
const LAYER = 'places';
const FIELDS = ['name', 'class', 'src', 'id'];
const ATTRIBUTION = 'Wikidata (CC0); National Register of Historic Places (public domain); © OpenStreetMap contributors (ODbL)';
/** What the reader fetches first: the header and the root directory must fit in it. */
const FIRST_READ = 16384;
const HEADER = 127;

const zig = (v) => (v << 1) ^ (v >> 31);

function tileOf(lon, lat, z) {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  const fx = ((lon + 180) / 360) * n;
  const fy = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  return { x: Math.floor(fx), y: Math.floor(fy), fx, fy };
}

function encodeTile(places, z, x, y, layer, fields) {
  const keys = fields;
  const values = [];
  const index = (v) => {
    let i = values.indexOf(v);
    if (i < 0) i = values.push(v) - 1;
    return i;
  };
  const features = places.map((p) => {
    const t = tileOf(p.lon, p.lat, z);
    const px = Math.round((t.fx - x) * EXTENT);
    const py = Math.round((t.fy - y) * EXTENT);
    // A field a feature lacks is left out of its tags (every place has all four, so the places pack is as before).
    const tags = fields.flatMap((k, i) => (p[k] == null ? [] : [i, index(String(p[k]))]));
    return { tags, geom: [1 | (1 << 3), zig(px), zig(py)] };
  });
  const pbf = new PbfWriter();
  pbf.writeMessage(3, (_, w) => {
    w.writeVarintField(15, 2);
    w.writeStringField(1, layer);
    for (const f of features)
      w.writeMessage(2, (__, q) => {
        q.writePackedVarint(2, f.tags);
        q.writeVarintField(3, 1);
        q.writePackedVarint(4, f.geom);
      }, null);
    for (const k of keys) w.writeStringField(3, k);
    for (const v of values) w.writeMessage(4, (__, q) => q.writeStringField(1, v), null);
    w.writeVarintField(5, EXTENT);
  }, null);
  return pbf.finish();
}

function varints(nums) {
  const out = [];
  for (let n of nums) {
    while (n >= 0x80) {
      out.push((n % 0x80) | 0x80);
      n = Math.floor(n / 0x80);
    }
    out.push(n);
  }
  return Buffer.from(out);
}

/** A PMTiles directory, gzipped: entries {id, offset, length, run}, sorted by id. */
function directory(entries) {
  let last = 0;
  const raw = Buffer.concat([
    varints([entries.length]),
    varints(entries.map((e) => {
      const d = e.id - last;
      last = e.id;
      return d;
    })),
    varints(entries.map((e) => e.run)),
    varints(entries.map((e) => e.length)),
    varints(entries.map((e, i) => (i > 0 && e.offset === entries[i - 1].offset + entries[i - 1].length ? 0 : e.offset + 1))),
  ]);
  return gzipSync(raw, { level: 9 });
}

/** The root directory, and leaf directories when the root alone won't fit in the first read. */
function directories(entries, firstRead) {
  const room = firstRead - HEADER;
  const root = directory(entries);
  if (root.length <= room) return { root, leaves: Buffer.alloc(0) };
  for (let size = 4096; ; size *= 2) {
    const leaves = [];
    const rootEntries = [];
    let offset = 0;
    for (let i = 0; i < entries.length; i += size) {
      const chunk = entries.slice(i, i + size);
      const leaf = directory(chunk);
      rootEntries.push({ id: chunk[0].id, offset, length: leaf.length, run: 0 });
      leaves.push(leaf);
      offset += leaf.length;
    }
    const r = directory(rootEntries);
    if (r.length <= room) return { root: r, leaves: Buffer.concat(leaves) };
  }
}

const e7 = (v) => Math.round(v * 1e7);

/**
 * PW14: places [{name, lon, lat, class, src, id}] to one archive. Tiles are clustered by tile id, so the file's
 * bytes follow the map. The options default to the places pack's; the stores pack (ST7) passes its own `layer`,
 * `fields` (flat string properties), `attribution` and `extra` (more keys for the metadata), and no option changes
 * the places pack's bytes.
 */
export function writeArchive(places, { name = 'Chronicles places', firstRead = FIRST_READ, layer = LAYER, fields = FIELDS, attribution = ATTRIBUTION, extra = {} } = {}) {
  const sorted = [...places].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const byTile = new Map();
  for (const p of sorted) {
    const { x, y } = tileOf(p.lon, p.lat, ZOOM);
    const id = zxyToTileId(ZOOM, x, y);
    if (!byTile.has(id)) byTile.set(id, { x, y, places: [] });
    byTile.get(id).places.push(p);
  }
  const ids = [...byTile.keys()].sort((a, b) => a - b);
  const entries = [];
  const datas = [];
  let offset = 0;
  for (const id of ids) {
    const t = byTile.get(id);
    const data = gzipSync(Buffer.from(encodeTile(t.places, ZOOM, t.x, t.y, layer, fields)), { level: 9 });
    entries.push({ id, offset, length: data.length, run: 1 });
    datas.push(data);
    offset += data.length;
  }
  const tileData = Buffer.concat(datas);
  const metadata = gzipSync(Buffer.from(JSON.stringify({
    name,
    attribution,
    vector_layers: [{ id: layer, minzoom: ZOOM, maxzoom: ZOOM, fields: Object.fromEntries(fields.map((f) => [f, 'String'])) }],
    ...extra,
  })), { level: 9 });
  const { root, leaves } = directories(entries, firstRead);

  // A loop, never Math.min(...all): a whole US OSM run's archive holds more points than the call stack takes (run 33).
  const bounds = places.length ? [Infinity, Infinity, -Infinity, -Infinity] : [0, 0, 0, 0];
  for (const p of places) {
    if (p.lon < bounds[0]) bounds[0] = p.lon;
    if (p.lat < bounds[1]) bounds[1] = p.lat;
    if (p.lon > bounds[2]) bounds[2] = p.lon;
    if (p.lat > bounds[3]) bounds[3] = p.lat;
  }
  const h = Buffer.alloc(HEADER);
  h.write('PMTiles', 0, 'ascii');
  h.writeUInt8(3, 7);
  const rootOffset = HEADER;
  const metaOffset = rootOffset + root.length;
  const leafOffset = metaOffset + metadata.length;
  const dataOffset = leafOffset + leaves.length;
  const u64 = (v, at) => h.writeBigUInt64LE(BigInt(v), at);
  u64(rootOffset, 8);
  u64(root.length, 16);
  u64(metaOffset, 24);
  u64(metadata.length, 32);
  u64(leafOffset, 40);
  u64(leaves.length, 48);
  u64(dataOffset, 56);
  u64(tileData.length, 64);
  u64(entries.length, 72);
  u64(entries.length, 80);
  u64(entries.length, 88);
  h.writeUInt8(1, 96); // clustered
  h.writeUInt8(2, 97); // directories: gzip
  h.writeUInt8(2, 98); // tiles: gzip
  h.writeUInt8(1, 99); // vector tiles
  h.writeUInt8(ZOOM, 100);
  h.writeUInt8(ZOOM, 101);
  h.writeInt32LE(e7(bounds[0]), 102);
  h.writeInt32LE(e7(bounds[1]), 106);
  h.writeInt32LE(e7(bounds[2]), 110);
  h.writeInt32LE(e7(bounds[3]), 114);
  h.writeUInt8(ZOOM, 118);
  h.writeInt32LE(e7((bounds[0] + bounds[2]) / 2), 119);
  h.writeInt32LE(e7((bounds[1] + bounds[3]) / 2), 123);
  return new Uint8Array(Buffer.concat([h, root, metadata, leaves, tileData]));
}
