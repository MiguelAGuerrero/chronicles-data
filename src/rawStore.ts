// The raw store (PP2): each source's answers exactly as received, by run, with the time and a SHA-256, so every
// stage after fetch reads files and never the network. Layout: <dir>/<source>/<run>/<part>, and an index.json per
// run listing its parts. A run that finished writes `complete: true`; only a complete run is used as a fallback (PP14).
// A run may carry an earlier run's answer forward (CF5): the copy keeps its original time and hash, and says where it
// came from, so a run's own start is when its fetch began, not when its oldest answer was asked.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface RawPart {
  part: string;
  sha256: string;
  fetchedAt: string;
  /** CF5: the run this answer was first fetched in, when it was carried forward. */
  carriedFrom?: string;
}

interface RunIndex {
  parts: RawPart[];
  complete: boolean;
  /** CF1: when this run's fetch began (an earlier run's, for a sweep by hand that keeps the changes clock, CF4). */
  startedAt?: string;
  /** CF3: what the source records about the run beside its answers (Wikidata: the classes it asked). Never an answer. */
  meta?: Record<string, string>;
}

const SAFE = /^[A-Za-z0-9._-]+$/;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * Run order (YYYYMMDD.n): by date, then run number, as numbers. Compared as text, `20261111.14` came before
 * `20261111.8`, so keeping the newest three runs deleted the run just fetched (runs 10 and 14, Nov 11).
 */
export function compareRuns(a: string, b: string): number {
  const [ad, an] = a.split('.');
  const [bd, bn] = b.split('.');
  return Number(ad) - Number(bd) || Number(an ?? 0) - Number(bn ?? 0) || (a < b ? -1 : a > b ? 1 : 0);
}

export function createRawStore(dir: string) {
  const runDir = (source: string, run: string) => {
    if (!SAFE.test(source) || !SAFE.test(run)) throw new Error(`bad raw store path: ${source}/${run}`);
    return join(dir, source, run);
  };
  const indexOf = (source: string, run: string): RunIndex => {
    const f = join(runDir(source, run), 'index.json');
    return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as RunIndex) : { parts: [], complete: false };
  };
  const writeIndex = (source: string, run: string, ix: RunIndex) => {
    mkdirSync(runDir(source, run), { recursive: true });
    writeFileSync(join(runDir(source, run), 'index.json'), `${JSON.stringify(ix, null, 1)}\n`);
  };

  const runs = (source: string): string[] => {
    const d = join(dir, source);
    return existsSync(d) ? readdirSync(d).filter((r) => SAFE.test(r)).sort(compareRuns) : [];
  };

  return {
    /** Keeps one answer; a part written twice in a run keeps the last. */
    put(source: string, run: string, part: string, body: string, fetchedAt: string): RawPart {
      if (!SAFE.test(part) || part === 'index.json') throw new Error(`bad raw part name: ${part}`);
      const d = runDir(source, run);
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, part), body);
      const ix = indexOf(source, run);
      const entry = { part, sha256: sha(body), fetchedAt };
      ix.parts = [...ix.parts.filter((p) => p.part !== part), entry];
      writeIndex(source, run, ix);
      return entry;
    },
    /** CF1: records when a run's fetch began; a run that has a start keeps it. */
    start(source: string, run: string, startedAt: string) {
      const ix = indexOf(source, run);
      if (!ix.startedAt) writeIndex(source, run, { ...ix, startedAt });
    },
    /** CF4: sets a run's start outright (a sweep by hand keeps the earlier run's, so the changes clock doesn't move). */
    setStart(source: string, run: string, startedAt: string) {
      writeIndex(source, run, { ...indexOf(source, run), startedAt });
    },
    /** CF1: when a run's fetch began: its recorded start, else the earliest answer it fetched itself; null if neither. */
    startedAt(source: string, run: string): string | null {
      const ix = indexOf(source, run);
      if (ix.startedAt) return ix.startedAt;
      const own = ix.parts.filter((p) => !p.carriedFrom).map((p) => p.fetchedAt).sort();
      return own[0] ?? null;
    },
    /** CF3: records a note about a run beside its answers. */
    setMeta(source: string, run: string, key: string, value: string) {
      const ix = indexOf(source, run);
      writeIndex(source, run, { ...ix, meta: { ...(ix.meta ?? {}), [key]: value } });
    },
    meta(source: string, run: string): Record<string, string> {
      return { ...(indexOf(source, run).meta ?? {}) };
    },
    /** CF5: copies an earlier run's answer into this run, with its time and hash, checked against that hash. */
    carry(source: string, from: string, to: string, part: string): RawPart {
      const entry = indexOf(source, from).parts.find((p) => p.part === part);
      if (!entry) throw new Error(`no raw part ${source}/${from}/${part} to carry`);
      const body = readFileSync(join(runDir(source, from), part), 'utf8');
      if (sha(body) !== entry.sha256) throw new Error(`raw part ${source}/${from}/${part} does not match its hash`);
      const d = runDir(source, to);
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, part), body);
      const ix = indexOf(source, to);
      const copy: RawPart = { part, sha256: entry.sha256, fetchedAt: entry.fetchedAt, carriedFrom: entry.carriedFrom ?? from };
      ix.parts = [...ix.parts.filter((p) => p.part !== part), copy];
      writeIndex(source, to, ix);
      return copy;
    },
    /** Marks a run's fetch as finished, so it can stand in for a later failed one. */
    complete(source: string, run: string) {
      writeIndex(source, run, { ...indexOf(source, run), complete: true });
    },
    parts(source: string, run: string): RawPart[] {
      return [...indexOf(source, run).parts].sort((a, b) => (a.part < b.part ? -1 : 1));
    },
    /** A part's text, checked against its hash. */
    read(source: string, run: string, part: string): string {
      const entry = indexOf(source, run).parts.find((p) => p.part === part);
      if (!entry) throw new Error(`no raw part ${source}/${run}/${part}`);
      const body = readFileSync(join(runDir(source, run), part), 'utf8');
      if (sha(body) !== entry.sha256) throw new Error(`raw part ${source}/${run}/${part} does not match its hash`);
      return body;
    },
    runs,
    /** The newest complete run before `before` (PP14), or null; `before` ending in `~` includes that run itself. */
    lastComplete(source: string, before: string): string | null {
      const upTo = before.endsWith('~');
      const base = upTo ? before.slice(0, -1) : before;
      return runs(source).filter((r) => (upTo ? compareRuns(r, base) <= 0 : compareRuns(r, base) < 0) && indexOf(source, r).complete).at(-1) ?? null;
    },
    /** PP1: deletes a source's runs whose newest answer is older than its retention. */
    prune(source: string, retentionDays: number | null, now: number) {
      if (retentionDays == null) return;
      for (const r of runs(source)) {
        const fetched = indexOf(source, r).parts.map((p) => Date.parse(p.fetchedAt)).filter(Number.isFinite);
        const newest = fetched.length ? Math.max(...fetched) : 0;
        if (now - newest > retentionDays * 86_400_000) rmSync(runDir(source, r), { recursive: true, force: true });
      }
    },
    /** PP15: keeps a source's newest `n` runs, so the saved state stays a few weeks long. */
    keepNewest(source: string, n: number) {
      for (const r of runs(source).slice(0, Math.max(0, runs(source).length - n))) rmSync(runDir(source, r), { recursive: true, force: true });
    },
    sources(): string[] {
      return existsSync(dir) ? readdirSync(dir).filter((s) => SAFE.test(s)).sort() : [];
    },
  };
}

export type RawStore = ReturnType<typeof createRawStore>;
