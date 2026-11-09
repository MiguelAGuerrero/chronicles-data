// The Wikidata adapter (decision 0107): today's places-archive fetch (PW14) behind the adapter contract. It knows
// SPARQL, P31 classes and Wikidata's "gone" signals; it hands on candidates in the archive's own vocabulary and
// nothing about articles or popularity (PW7).
import { classify, gone } from './classify.mjs';
import type { Adapter, Box, FetchContext } from '../../adapter';
import { SourceTimeout } from '../../http';
import { cellQuery, cellsFor, itemsFrom, splitCell } from './query';

const ENDPOINT = 'https://query.wikidata.org/sparql';
const STEP_DEG = 2;
const MAX_SPLITS = 4;

export const partOf = ([w, s, e, n]: Box) => `cell_${w}_${s}_${e}_${n}.json`;

async function fetchCell(ctx: FetchContext, cell: Box, depth: number): Promise<void> {
  let body: string;
  try {
    const res = await ctx.http(ENDPOINT, {
      method: 'POST',
      headers: { accept: 'application/sparql-results+json', 'content-type': 'application/x-www-form-urlencoded' },
      body: `query=${encodeURIComponent(cellQuery(cell))}`,
    });
    body = await res.text();
  } catch (e) {
    if (!(e instanceof SourceTimeout)) throw e;
    if (depth >= MAX_SPLITS) throw new Error(`cell ${cell.join(',')} still times out at depth ${depth}`);
    for (const q of splitCell(cell)) await fetchCell(ctx, q as Box, depth + 1);
    return;
  }
  ctx.put(partOf(cell), body);
}

export const wikidata: Adapter = {
  declaration: {
    name: 'wikidata',
    code: 'wd',
    license: 'CC0 1.0',
    licenseFamily: 'cc0',
    attribution: 'Wikidata',
    role: 'locates',
    hosts: ['query.wikidata.org'],
    // One query at a time with a 1.5 s pause between, as the places archive's fetch has asked since Nov 6.
    pace: { perMinute: 40, userAgent: 'Chronicles places build (+github.com/MiguelAGuerrero/chronicles; weekly, one query at a time)' },
    allowed: { store: true, retentionDays: null, redistribute: true, reachPack: true },
    termsChecked: '2026-11-09',
  },

  async fetch(ctx) {
    const cells = cellsFor(ctx.area, STEP_DEG) as Box[];
    for (const [i, cell] of cells.entries()) {
      await fetchCell(ctx, cell, 0);
      if (i % 25 === 0) ctx.log(`wikidata: ${i + 1}/${cells.length} cells`);
    }
  },

  adapt(raw, _part, fetchedAt) {
    const bindings = (JSON.parse(raw) as { results: { bindings: unknown[] } }).results.bindings;
    return itemsFrom(bindings as never).map((it) => {
      const cls = classify(it);
      return {
        source: 'wikidata',
        sourceId: it.id,
        name: String(it.name ?? '').trim(),
        ...(Number.isFinite(it.lon) && Number.isFinite(it.lat) ? { at: [it.lon, it.lat] } : {}),
        ...(cls ? { class: cls } : {}),
        signals: { gone: gone(it, cls), heritage: it.nhl },
        evidence: `https://www.wikidata.org/wiki/${it.id}`,
        fetchedAt,
      };
    });
  },
};
