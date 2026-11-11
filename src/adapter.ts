// The adapter contract (decision 0108): a source's declaration plus two functions. This is the only place a source's
// quirks live; nothing after `adapt` knows which source a candidate came from except by its name.
import type { RawPart, RawStore } from './rawStore';
import type { Declaration } from './schema';

/** A region's boxes, [west, south, east, north]. */
export type Box = [number, number, number, number];

export interface FetchContext {
  /** The boxes to fetch. */
  area: Box[];
  /** This run's id (the version, YYYYMMDD[.n]). */
  run: string;
  /** Writes one raw answer for this source and run. */
  put(part: string, body: string): void;
  /** The source's polite fetch (PP3). */
  http(url: string, init?: RequestInit): Promise<Response>;
  /** The time, for logs only. */
  log(line: string): void;
  /** CF1: this source's earlier complete run, to ask only what changed since; null on a first run. */
  previous: PreviousRun | null;
  /** CF4: the ISO week of this run, for the safety sweep's share. */
  week: number;
  /** CF4: a sweep by hand of this box, or null. */
  box: Box | null;
  /** CF5: carries an answer of the earlier run into this one, with its time and hash. */
  carry(part: string): void;
  /** CF4: this run starts when the earlier one did, so the next run's changes are still asked from there. */
  keepClock(): void;
  /** CF3: records a note about this run beside its answers (never an answer itself). */
  setMeta(key: string, value: string): void;
  /** RB5: whether the earlier complete run fetched with the same fingerprint, so its answers can stand for unchanged files. */
  sameFetch: boolean;
}

/** CF1: what a fetch may read of its source's earlier complete run. */
export interface PreviousRun {
  run: string;
  /** When its fetch began; null when the store can't say. */
  startedAt: string | null;
  parts: RawPart[];
  read(part: string): string;
  /** CF3: the notes it recorded. */
  meta: Record<string, string>;
}

/** CF5: one raw answer, as `settle` reads it. */
export interface RawAnswer {
  part: string;
  fetchedAt: string;
  raw: string;
}

export interface Adapter {
  declaration: Declaration;
  /** Writes raw answers for the area; throws when it can't finish (the run then falls back, PP14). */
  fetch(ctx: FetchContext): Promise<void>;
  /**
   * RB2: what this source's fetch asks for, as a string (its queries, its filters, its files). A run that fetched the
   * source records it; when it changes, a push fetches the source again (RB3). Absent: stale only with no run.
   */
  fetchKey?(area: Box[]): string;
  /** One raw answer's candidates, unchecked: the runner checks each against the schema (PP4). */
  adapt(raw: string, part: string, fetchedAt: string): unknown[];
  /**
   * CF5: when present, the run's candidates from all its answers at once, in place of `adapt` per answer: for a
   * source whose answers build on each other (a changes answer over an older sweep), the newest about an item wins.
   */
  settle?(answers: RawAnswer[], area: Box[]): unknown[];
}

export type { RawStore };
