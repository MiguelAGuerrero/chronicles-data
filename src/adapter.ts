// The adapter contract (decision 0104): a source's declaration plus two functions. This is the only place a source's
// quirks live; nothing after `adapt` knows which source a candidate came from except by its name.
import type { RawStore } from './rawStore';
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
}

export interface Adapter {
  declaration: Declaration;
  /** Writes raw answers for the area; throws when it can't finish (the run then falls back, PP14). */
  fetch(ctx: FetchContext): Promise<void>;
  /** One raw answer's candidates, unchecked: the runner checks each against the schema (PP4). */
  adapt(raw: string, part: string, fetchedAt: string): unknown[];
}

export type { RawStore };
