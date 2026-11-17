// How an adapter reaches its source (PP3): one request at a time, no faster than its declared pace, with its
// User-Agent, waiting out a 429's or 503's Retry-After and a 502's gateway failure. The runner builds one per adapter; an adapter never calls
// `fetch` itself. Clock and sleep are passed in, so tests run without waiting.
import type { Declaration } from './schema';

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realClock: Clock = { now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };

/** The longest Retry-After honoured, and the wait when a refusal names none. */
export const RETRY_CAP_S = 300;
export const RETRY_DEFAULT_S = 60;
const ATTEMPTS = 5;
/** The first wait after a 502; each further try waits this much longer. */
export const BAD_GATEWAY_WAIT_S = 30;

/** A timeout the caller can act on (a query service's way of saying "ask for less"). */
export class SourceTimeout extends Error {}

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** PP3: a fetch held to one source's declared pace and manners. */
export function politeFetch(decl: Pick<Declaration, 'pace'>, fetchImpl: Fetch, clock: Clock, timeoutMs = 75_000) {
  const gap = 60_000 / decl.pace.perMinute;
  let last = -Infinity;
  let queue: Promise<unknown> = Promise.resolve();

  async function once(url: string, init: RequestInit): Promise<Response> {
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const wait = last + gap - clock.now();
      if (wait > 0) await clock.sleep(wait);
      last = clock.now();
      const headers = new Headers(init.headers);
      headers.set('user-agent', decl.pace.userAgent);
      const res = await fetchImpl(url, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(timeoutMs) }).catch(() => null);
      // RB5: a conditional request's 304 is an answer too: the caller keeps what it has.
      if (res?.ok || res?.status === 304) return res;
      if (res && (res.status === 429 || res.status === 503)) {
        const s = Number(res.headers.get('retry-after'));
        await clock.sleep(Math.min(Number.isFinite(s) && s > 0 ? s : RETRY_DEFAULT_S, RETRY_CAP_S) * 1000);
        continue;
      }
      // A 502 is the source's gateway failing, as Wikidata's query service does under load (two builds lost on Nov 17): waited
      // out and asked again, longer each time; on the last try, a timeout the caller can act on (split the cell, sweep the class).
      if (res && res.status === 502) {
        if (attempt === ATTEMPTS - 1) throw new SourceTimeout(`${url} kept failing at its gateway (502)`);
        await clock.sleep(Math.min(BAD_GATEWAY_WAIT_S * (attempt + 1), RETRY_CAP_S) * 1000);
        continue;
      }
      if (!res || res.status === 500 || res.status === 504) throw new SourceTimeout(`${url} timed out`);
      throw new Error(`${url} answered ${res.status}`);
    }
    throw new Error(`${url} kept refusing`);
  }

  // One request at a time, in the order asked.
  return (url: string, init: RequestInit = {}): Promise<Response> => {
    const next = queue.then(() => once(url, init));
    queue = next.catch(() => undefined);
    return next;
  };
}
