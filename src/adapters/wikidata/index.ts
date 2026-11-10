// The Wikidata adapter (decision 0108): today's places-archive fetch (PW14) behind the adapter contract. It knows
// SPARQL, P31 classes and Wikidata's "gone" signals; it hands on candidates in the archive's own vocabulary and
// nothing about articles or popularity (PW7).
//
// Changes first (CF1-CF5, decision 0120 in the app repo): a first run sweeps every cell; after that, a weekly run asks
// each pinned class, by country, for what was modified since the earlier run began, checks the held items for any
// modified away, merged or deleted, sweeps one cell in thirteen as a backstop, and carries the earlier answers it did
// not re-ask. `settle` replays every answer in time order, so the newest answer about an item wins.
import { classify, gone, listing } from './classify.mjs';
import type { Adapter, Box, FetchContext, RawAnswer } from '../../adapter';
import { SourceTimeout } from '../../http';
import { ALL_TARGETS, cellQuery, cellsFor, changesQuery, heldQuery, itemsFrom, parseAnswer, splitCell, type WikidataItem } from './query';

export { ALL_TARGETS };

const ENDPOINT = 'https://query.wikidata.org/sparql';
const STEP_DEG = 2;
const MAX_SPLITS = 4;
/** CF1: the region's countries (P17); the US only for now. */
const COUNTRIES = ['Q30'];
/** CF1: changes are asked from this long before the earlier run began, for the query service's lag. */
const MARGIN_MS = 24 * 3600_000;
/** CF1: held items checked per query. */
const IDS_PER_QUERY = 400;
/** CF4: the safety sweep covers one cell in this many each week, so every cell once a quarter. */
export const SWEEP_WEEKS = 13;
/** CF3: the note of the classes a run asked, so the next asks a newly pinned one whole. */
const ASKED = 'asked';

export const partOf = ([w, s, e, n]: Box) => `cell_${w}_${s}_${e}_${n}.json`;
const boxOf = (part: string): Box | null => {
  const m = /^cell_(-?[\d.]+)_(-?[\d.]+)_(-?[\d.]+)_(-?[\d.]+)\.json$/.exec(part);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] : null;
};

/** CF4: this week's share of the safety sweep, as cell indices. */
export const sweepShare = (cells: number, week: number): number[] =>
  Array.from({ length: cells }, (_, i) => i).filter((i) => i % SWEEP_WEEKS === week % SWEEP_WEEKS);

/** CF1: the time the changes are asked from, as the service writes times. */
const sinceOf = (startedAt: string) => new Date(Date.parse(startedAt) - MARGIN_MS).toISOString().replace(/\.\d{3}Z$/, 'Z');
const inside = ([w, s, e, n]: Box, lon: number, lat: number) => lon >= w && lon <= e && lat >= s && lat <= n;
const within = (outer: Box, inner: Box) => inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3];
const overlaps = (a: Box, b: Box) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

async function ask(ctx: FetchContext, query: string): Promise<string> {
  const res = await ctx.http(ENDPOINT, {
    method: 'POST',
    headers: { accept: 'application/sparql-results+json', 'content-type': 'application/x-www-form-urlencoded' },
    body: `query=${encodeURIComponent(query)}`,
  });
  return res.text();
}

/** One cell, split in four while it times out; each answer kept under its own box's name (or `name`'s). */
async function fetchCell(ctx: FetchContext, cell: Box, depth: number, targets?: string[], name: (b: Box) => string = partOf): Promise<void> {
  let body: string;
  try {
    body = await ask(ctx, cellQuery(cell, targets));
    // RD5: a timeout after the answer began cuts its JSON off: that is a timeout too, and the cell is split.
    if (parseAnswer(body) == null) throw new SourceTimeout(`cell ${cell.join(',')}: the answer was cut off`);
  } catch (e) {
    if (!(e instanceof SourceTimeout)) throw e;
    if (depth >= MAX_SPLITS) throw new Error(`cell ${cell.join(',')} still times out at depth ${depth}`);
    for (const q of splitCell(cell)) await fetchCell(ctx, q as Box, depth + 1, targets, name);
    return;
  }
  ctx.put(name(cell), body);
}

async function sweep(ctx: FetchContext, cells: Box[], indices: number[]) {
  for (const [n, i] of indices.entries()) {
    await fetchCell(ctx, cells[i], 0);
    if (n % 25 === 0) ctx.log(`wikidata: ${n + 1}/${indices.length} cells`);
  }
}

/** CF5: carries the earlier run's answers this run didn't replace; an answer older than every carried cell is dropped. */
function carryRest(ctx: FetchContext, asked: Box[]) {
  const prev = ctx.previous!;
  const cells = prev.parts.filter((p) => {
    const b = boxOf(p.part);
    return b && !asked.some((a) => within(a, b));
  });
  for (const p of cells) ctx.carry(p.part);
  const oldest = cells.map((p) => p.fetchedAt).sort()[0];
  if (oldest == null) return;
  for (const p of prev.parts) if (/^(changes|held)_/.test(p.part) && p.fetchedAt >= oldest) ctx.carry(p.part);
}

const answersOf = (ctx: FetchContext): RawAnswer[] => ctx.previous!.parts.map((p) => ({ part: p.part, fetchedAt: p.fetchedAt, raw: ctx.previous!.read(p.part) }));

function askedBefore(ctx: FetchContext): Set<string> {
  const prev = ctx.previous!;
  // A run before this slice asked every class it then knew: taken as the current ones.
  return new Set(prev.meta[ASKED] ? (JSON.parse(prev.meta[ASKED]) as string[]) : ALL_TARGETS);
}

type Held = { item: WikidataItem; fetchedAt: string };

/** CF2, CF5: every answer replayed in time order: what the newest said about each item, inside the area. */
export function settleItems(answers: RawAnswer[], area: Box[]): Held[] {
  // A cell sweep replaces its box; a check removes; any other answer (a changes answer, or one named otherwise) adds.
  const kind = (part: string) => (part.startsWith('cell_') ? 2 : part.startsWith('held_') ? 1 : 0);
  const events = [...answers]
    .sort((a, b) => (a.fetchedAt < b.fetchedAt ? -1 : a.fetchedAt > b.fetchedAt ? 1 : kind(a.part) - kind(b.part) || (a.part < b.part ? -1 : 1)));
  const state = new Map<string, Held>();
  const returned = new Map<string, Set<string>>();
  for (const a of events) {
    const bindings = (JSON.parse(a.raw) as { results: { bindings: never[] } }).results.bindings;
    if (a.part.startsWith('cell_')) {
      // A sweep is the whole truth inside its box: what it didn't return there is gone.
      const box = boxOf(a.part)!;
      for (const [id, h] of state) if (inside(box, h.item.lon, h.item.lat)) state.delete(id);
      for (const item of itemsFrom(bindings)) state.set(item.id, { item, fetchedAt: a.fetchedAt });
    } else if (kind(a.part) === 0) {
      const run = a.part.startsWith('changes_') ? a.part.split('_')[1] : '';
      if (!returned.has(run)) returned.set(run, new Set());
      for (const item of itemsFrom(bindings)) {
        state.set(item.id, { item, fetchedAt: a.fetchedAt });
        returned.get(run)!.add(item.id);
      }
    } else {
      const [, run, sinceS] = a.part.replace(/\.json$/, '').split('_');
      const since = Number(sinceS) * 1000;
      for (const b of bindings as { item?: { value: string }; m?: { value: string } }[]) {
        const id = String(b.item?.value ?? '').replace(/^.*\//, '');
        const m = b.m?.value;
        if (!m || (Date.parse(m) > since && !returned.get(run)?.has(id))) state.delete(id);
      }
    }
  }
  return [...state.values()]
    .filter((h) => area.some((b) => inside(b, h.item.lon, h.item.lat)))
    .sort((a, b) => (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0));
}

function candidateOf(it: WikidataItem, fetchedAt: string) {
  const cls = classify(it);
  // RD1, RD8: how a listed place enters, when its class is the listing's (a listing never changes 0103's class).
  const l = listing(it);
  const how = l && l.cls === cls ? l : null;
  return {
    source: 'wikidata',
    sourceId: it.id,
    name: String(it.name ?? '').trim(),
    ...(Number.isFinite(it.lon) && Number.isFinite(it.lat) ? { at: [it.lon, it.lat] } : {}),
    ...(cls ? { class: cls } : {}),
    signals: { gone: gone(it, cls), heritage: it.nhl, listed: it.listed, ...(how ? { publicType: how.publicType, needsOpen: how.needsOpen } : {}) },
    evidence: `https://www.wikidata.org/wiki/${it.id}`,
    fetchedAt,
  };
}

/** CF5: the candidates every answer settles to. */
export const settleParts = (answers: RawAnswer[], area: Box[]) => settleItems(answers, area).map((h) => candidateOf(h.item, h.fetchedAt));

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
    const all = cells.map((_, i) => i);
    // CF4: no earlier run: every cell.
    if (!ctx.previous) {
      await sweep(ctx, cells, all);
      ctx.setMeta(ASKED, JSON.stringify(ALL_TARGETS));
      return;
    }
    // CF4: a sweep by hand: the box's cells, the rest carried, the changes clock kept.
    if (ctx.box) {
      const asked = all.filter((i) => overlaps(cells[i], ctx.box!));
      await sweep(ctx, cells, asked);
      carryRest(ctx, asked.map((i) => cells[i]));
      ctx.setMeta(ASKED, JSON.stringify([...askedBefore(ctx)]));
      ctx.keepClock();
      return;
    }
    // CF1, CF3: each target's changes by country since the earlier run began; a newly pinned class whole.
    const startedAt = ctx.previous.startedAt;
    if (!startedAt) throw new Error('the earlier run has no start: sweep by hand, or start again with no state');
    const since = sinceOf(startedAt);
    const known = askedBefore(ctx);
    for (const target of ALL_TARGETS) {
      for (const country of COUNTRIES) {
        const whole = !known.has(target);
        const name = `changes_${ctx.run}_${target}_${country}`;
        try {
          ctx.put(`${name}.json`, await ask(ctx, changesQuery(target, country, whole ? null : since)));
        } catch (e) {
          if (!(e instanceof SourceTimeout) || !whole) throw e;
          // A new class too big to ask whole: swept cell by cell for itself, its answers kept as changes.
          for (const cell of cells) await fetchCell(ctx, cell, 0, [target], ([w, s, ee, n]) => `${name}_${w}_${s}_${ee}_${n}.json`);
        }
      }
    }
    // CF2: the held items modified since, merged or deleted.
    const held = settleItems(answersOf(ctx), ctx.area).map((h) => h.item.id);
    const sinceS = Math.floor(Date.parse(since) / 1000);
    for (let i = 0; i < held.length; i += IDS_PER_QUERY) {
      ctx.put(`held_${ctx.run}_${sinceS}_${i / IDS_PER_QUERY}.json`, await ask(ctx, heldQuery(held.slice(i, i + IDS_PER_QUERY), since)));
    }
    // CF4: this week's share of the safety sweep; CF5: the rest carried.
    const share = sweepShare(cells.length, ctx.week);
    await sweep(ctx, cells, share);
    carryRest(ctx, share.map((i) => cells[i]));
    ctx.setMeta(ASKED, JSON.stringify(ALL_TARGETS));
  },

  adapt(raw, _part, fetchedAt) {
    const bindings = parseAnswer(raw) ?? [];
    return itemsFrom(bindings as never).map((it) => candidateOf(it, fetchedAt));
  },

  settle: (answers, area) => settleParts(answers, area),
};
