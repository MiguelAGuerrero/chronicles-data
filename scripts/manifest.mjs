// Writes manifest.json from the archives in a folder: node scripts/manifest.mjs <dir>
// Each archive is places-<region>-<version>.pmtiles; the newest version of a region is current.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: manifest.mjs <dir>');
  process.exit(1);
}
const NAME = /^places-([a-z0-9]+)-(\d{8}(?:\.\d+)?)\.pmtiles$/;

/** Bounds and zooms from the PMTiles v3 header (127 bytes). */
function header(buf) {
  if (buf.toString('ascii', 0, 7) !== 'PMTiles' || buf.readUInt8(7) !== 3) throw new Error('not a PMTiles v3 archive');
  const e7 = (o) => buf.readInt32LE(o) / 1e7;
  return { minzoom: buf.readUInt8(100), maxzoom: buf.readUInt8(101), bounds: [e7(102), e7(106), e7(110), e7(114)] };
}

const byRegion = new Map();
for (const file of readdirSync(dir)) {
  const m = NAME.exec(file);
  if (!m) continue;
  const path = join(dir, file);
  const buf = readFileSync(path);
  const entry = { file, version: m[2], bytes: statSync(path).size, sha256: createHash('sha256').update(buf).digest('hex'), ...header(buf) };
  if (!byRegion.has(m[1])) byRegion.set(m[1], []);
  byRegion.get(m[1]).push(entry);
}

const regions = [...byRegion].sort(([a], [b]) => a.localeCompare(b)).map(([id, list]) => {
  list.sort((a, b) => b.version.localeCompare(a.version, 'en', { numeric: true }));
  return { id, current: list[0], previous: list.slice(1) };
});
process.stdout.write(JSON.stringify({ schema: 1, regions }, null, 2) + '\n');
