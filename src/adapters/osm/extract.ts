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
import { MIN_PER_EXTRACT, partShopCounts, placeCountExpressions, SECOND_HAND_FILTER, SHOP_COUNTS_NOTE, shopCountExpressions, shopCountFilter, type ShopCounts } from './shopCounts';
import { countExpressions, countFilter, COUNTS_NOTE, parseTagsCount, partCounts } from './tagCounts';

/** Geofabrik's US regions sit beside the states' folder, not in it (`north-america/us/` holds states only). */
export const GEOFABRIK = 'https://download.geofabrik.de/north-america';
/** The US in four extracts, a few GB each (Geofabrik's sub-regions). */
export const US_PARTS = ['us-northeast', 'us-midwest', 'us-south', 'us-west'];
/**
 * How long one extract may take to download at most: the polite fetch's 75 s is for a query, and its signal also ends
 * the body, which cut every multi-GB download short (run 9, Nov 11). 45 minutes cut us-west short while it was still
 * arriving (Nov 16), losing the three extracts already read: the limit that matters is a stall, this only a ceiling
 * inside the job's 300 minutes.
 */
export const DOWNLOAD_MAX_MS = 150 * 60_000;
/** A download that receives nothing for this long has stalled and is cut off (and asked once more). */
export const STALL_MS = 5 * 60_000;
/** Tries per extract: a stalled or refused download is asked once more before the run gives up. */
const TRIES = 2;

/**
 * Nov 17: writes a download's body to `file`, aborting `controller` (the request) when no data arrives for `stallMs`;
 * a steady download takes as long as it needs.
 */
export async function saveStream(body: NodeJS.ReadableStream, file: string, controller: AbortController, stallMs = STALL_MS): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const stall = new Promise<never>((_, reject) => {
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const e = new Error(`download stalled: nothing for ${Math.round(stallMs / 1000)} s`);
        controller.abort(e);
        (body as unknown as { destroy?: (e: Error) => void }).destroy?.(e);
        reject(e);
      }, stallMs);
    };
    arm();
    body.on('data', arm);
  });
  try {
    await Promise.race([pipeline(body as never, createWriteStream(file)), stall]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One filter set: osmium tags-filter expressions (`nwr/wikidata`), an optional second pass over what the first kept
 * (osmium ORs the expressions of one pass; two passes AND them), and the raw part name its output is stored under.
 */
export interface Filter {
  name: string;
  expressions: string[];
  then?: string[];
}

function osmium(args: string[]): string {
  const r = spawnSync('osmium', args, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 });
  if (r.error || r.status !== 0) throw new Error(`osmium ${args[0]} failed: ${r.error?.message ?? r.stderr.toString().slice(0, 300)}`);
  return r.stdout.toString();
}

/**
 * OC3: one extract's tag counts, for the owner's review only. One pass over the extract keeps the elements carrying a
 * counted tag (`-R`: not the nodes and members they only refer to); `tags-count` on that small file gives `all`, and on
 * its elements that carry `wikidata` gives `withWikidata`.
 */
function countExtract(pbf: string, dir: string, part: string, table: Record<string, readonly string[]>) {
  if (!Object.values(table).some((vs) => vs.length)) throw new Error('nothing to count');
  const kept = join(dir, `counts-${part}.osm.pbf`);
  const wd = join(dir, `counts-${part}.wikidata.osm.pbf`);
  try {
    osmium(['tags-filter', pbf, '-R', ...countFilter(table), '-o', kept, '--overwrite']);
    const all = parseTagsCount(osmium(['tags-count', kept, ...countExpressions(table)]));
    osmium(['tags-filter', kept, '-R', 'nwr/wikidata', '-o', wd, '--overwrite']);
    const withWikidata = parseTagsCount(osmium(['tags-count', wd, ...countExpressions(table)]));
    return partCounts(all, withWikidata, table);
  } finally {
    rmSync(kept, { force: true });
    rmSync(wd, { force: true });
  }
}

/**
 * SK2, SK3: one extract's shop counts, for the owner's review only: every value of `shop` and `craft` among the elements
 * that carry one, and the second-hand among those.
 */
export function countShopsIn(pbf: string, dir: string, part: string): ShopCounts {
  const kept = join(dir, `shops-count-${part}.osm.pbf`);
  const second = join(dir, `shops-count-${part}.second.osm.pbf`);
  try {
    osmium(['tags-filter', pbf, '-R', ...shopCountFilter(), '-o', kept, '--overwrite']);
    const all = parseTagsCount(osmium(['tags-count', kept, ...shopCountExpressions()]));
    osmium(['tags-filter', kept, '-R', ...SECOND_HAND_FILTER, '-o', second, '--overwrite']);
    const secondHand = parseTagsCount(osmium(['tags-count', second, ...shopCountExpressions()]));
    // SK9: the other kinds of stop, counted on the extract itself (no file of them is written: there are millions).
    const places = parseTagsCount(osmium(['tags-count', '-m', String(MIN_PER_EXTRACT), pbf, ...placeCountExpressions()]));
    return partShopCounts(all, secondHand, undefined, places);
  } finally {
    rmSync(kept, { force: true });
    rmSync(second, { force: true });
  }
}

/**
 * RD7: downloads each US part, applies every filter to it, stores each filter's GeoJSON lines as a raw part
 * (`<filter>-<part>.geojsonl`), and deletes the extract before the next. Throws when a part can't be had (the run then
 * uses this source's last good answers, PP14). OC3, OC4: with `counts`, also counts those tags in each extract, kept as
 * the run's note `tagCounts:<part>` (never a raw part); a count that fails is logged and changes nothing else (OC7).
 */
export async function filterExtracts(ctx: FetchContext, filters: Filter[], parts = US_PARTS, counts?: Record<string, readonly string[]>) {
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
      let res: Response | null = null;
      let saved = false;
      for (let attempt = 1; attempt <= TRIES && !saved; attempt++) {
        const controller = new AbortController();
        try {
          res = await ctx.http(`${GEOFABRIK}/${part}-latest.osm.pbf`, { headers, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(DOWNLOAD_MAX_MS)]) });
          if (res.status === 304 && held) break;
          if (!res.ok || !res.body) throw new Error(`${part}: Geofabrik answered ${res.status}`);
          await saveStream(Readable.fromWeb(res.body as never), pbf, controller);
          saved = true;
        } catch (e) {
          if (attempt === TRIES) throw e;
          ctx.log(`osm: ${part} failed (${String((e as Error)?.message ?? e)}); asking once more`);
        }
      }
      if (!res) throw new Error(`${part}: no answer`);
      if (res.status === 304 && held) {
        for (const f of filters) ctx.carry(`${f.name}-${part}.geojsonl`);
        if (etag) ctx.setMeta(`etag:${part}`, etag);
        if (modified) ctx.setMeta(`modified:${part}`, modified);
        // OC4: its counts are carried with its answers.
        const note = prev.meta[`${COUNTS_NOTE}${part}`];
        if (counts && note != null) ctx.setMeta(`${COUNTS_NOTE}${part}`, note);
        // SK5: and its shop counts.
        const shopNote = prev.meta[`${SHOP_COUNTS_NOTE}${part}`];
        if (counts && shopNote != null) ctx.setMeta(`${SHOP_COUNTS_NOTE}${part}`, shopNote);
        ctx.log(`osm: ${part} unchanged since ${prev.run}, its answers carried`);
        continue;
      }
      const tag = res.headers.get('etag');
      const mod = res.headers.get('last-modified');
      if (tag) ctx.setMeta(`etag:${part}`, tag);
      if (mod) ctx.setMeta(`modified:${part}`, mod);
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
      if (counts) {
        try {
          ctx.setMeta(`${COUNTS_NOTE}${part}`, JSON.stringify(countExtract(pbf, dir, part, counts)));
        } catch (e) {
          // OC7: the counts are only for the owner's review; a failure leaves this run with none, and nothing else.
          ctx.log(`osm: ${part} tag counts failed (${String((e as Error)?.message ?? e)}); this run reports no counts`);
        }
        try {
          ctx.setMeta(`${SHOP_COUNTS_NOTE}${part}`, JSON.stringify(countShopsIn(pbf, dir, part)));
        } catch (e) {
          // SK8: for the owner's review only; a failure leaves this run with none, and nothing else.
          ctx.log(`osm: ${part} shop counts failed (${String((e as Error)?.message ?? e)}); this run reports no shop counts`);
        }
      }
      rmSync(pbf, { force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
