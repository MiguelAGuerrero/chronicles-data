// The shared OpenStreetMap step (Remarkable and public, RD7; the app's decisions 0110, 0115): Geofabrik's US
// sub-region extracts, one at a time, each filtered with osmium to what the adapters asked for and exported as GeoJSON
// lines, then deleted, so the runner's disk holds one extract at a time. The public Overpass servers refuse cloud
// runners (the app's DEFERRED), so the extracts are Geofabrik's. The confirming adapter (`./index.ts`) uses it now;
// the out-of-town locating adapter passes its own filters to the same pass when it comes, so the week's extracts are
// downloaded once.
import { spawnSync } from 'node:child_process';
import { createWriteStream, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { FetchContext } from '../../adapter';

export const GEOFABRIK = 'https://download.geofabrik.de/north-america/us';
/** The US in four extracts, a few GB each (Geofabrik's sub-regions). */
export const US_PARTS = ['us-northeast', 'us-midwest', 'us-south', 'us-west'];

/**
 * One filter set: osmium tags-filter expressions (`nwr/wikidata`), an optional second pass over what the first kept
 * (osmium ORs the expressions of one pass; two passes AND them), and the raw part name its output is stored under.
 */
export interface Filter {
  name: string;
  expressions: string[];
  then?: string[];
}

function osmium(args: string[]) {
  const r = spawnSync('osmium', args, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 });
  if (r.error || r.status !== 0) throw new Error(`osmium ${args[0]} failed: ${r.error?.message ?? r.stderr.toString().slice(0, 300)}`);
}

/**
 * RD7: downloads each US part, applies every filter to it, stores each filter's GeoJSON lines as a raw part
 * (`<filter>-<part>.geojsonl`), and deletes the extract before the next. Throws when a part can't be had (the run then
 * uses this source's last good answers, PP14).
 */
export async function filterExtracts(ctx: FetchContext, filters: Filter[], parts = US_PARTS) {
  const dir = mkdtempSync(join(tmpdir(), 'osm-'));
  try {
    for (const part of parts) {
      const pbf = join(dir, `${part}.osm.pbf`);
      // RB5: ask only if the extract changed since the copy the earlier run read, when that run kept the same filters.
      const prev = ctx.previous;
      const held = ctx.sameFetch && prev != null && filters.every((f) => prev.parts.some((p) => p.part === `${f.name}-${part}.geojsonl`));
      const etag = held ? prev.meta[`etag:${part}`] : undefined;
      const modified = held ? prev.meta[`modified:${part}`] : undefined;
      const headers: Record<string, string> = {};
      if (etag) headers['if-none-match'] = etag;
      if (modified) headers['if-modified-since'] = modified;
      const res = await ctx.http(`${GEOFABRIK}/${part}-latest.osm.pbf`, { headers });
      if (res.status === 304 && held) {
        for (const f of filters) ctx.carry(`${f.name}-${part}.geojsonl`);
        if (etag) ctx.setMeta(`etag:${part}`, etag);
        if (modified) ctx.setMeta(`modified:${part}`, modified);
        ctx.log(`osm: ${part} unchanged since ${prev.run}, its answers carried`);
        continue;
      }
      if (!res.ok || !res.body) throw new Error(`${part}: Geofabrik answered ${res.status}`);
      const tag = res.headers.get('etag');
      const mod = res.headers.get('last-modified');
      if (tag) ctx.setMeta(`etag:${part}`, tag);
      if (mod) ctx.setMeta(`modified:${part}`, mod);
      await pipeline(Readable.fromWeb(res.body as never), createWriteStream(pbf));
      ctx.log(`osm: ${part} downloaded`);
      for (const f of filters) {
        const kept = join(dir, `${f.name}-${part}.osm.pbf`);
        const out = join(dir, `${f.name}-${part}.geojsonl`);
        osmium(['tags-filter', pbf, ...f.expressions, '-o', kept, '--overwrite']);
        if (f.then?.length) {
          const narrowed = join(dir, `${f.name}-${part}.then.osm.pbf`);
          osmium(['tags-filter', kept, ...f.then, '-o', narrowed, '--overwrite']);
          rmSync(kept, { force: true });
          osmium(['cat', narrowed, '-o', kept, '--overwrite']);
          rmSync(narrowed, { force: true });
        }
        osmium(['export', kept, '-f', 'geojsonseq', '-a', 'type,id', '-u', 'type_id', '-o', out, '--overwrite']);
        // geojsonseq writes RS-separated lines; the adapter reads one JSON object per line.
        ctx.put(`${f.name}-${part}.geojsonl`, readFileSync(out, 'utf8').replace(/\x1e/g, ''));
        rmSync(kept, { force: true });
        rmSync(out, { force: true });
      }
      rmSync(pbf, { force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
