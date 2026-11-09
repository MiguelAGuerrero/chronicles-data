// The places pipeline's canonical shape (docs/spec.md, decision 0104 in the app repo): an adapter's declaration, the
// candidates every adapter emits, the places the pipeline makes of them, and a pack's tile feature. One schema for
// every source; `contract/places.schema.json` is its JSON Schema export, committed and served with the archives, so
// any tool can check a file (PP5) and the app can pin it.
//
// PP5: every object is closed, nested ones too, and the only numbers in a candidate, place or feature are the two of
// a position. Nothing here can hold a count, rank, score or popularity, whatever a source offers.
import { z } from 'zod';
import { CLASS_NAMES as NAMES, CONTRACT_VERSION } from './classes';

/** The contract's class vocabulary (PP6, classes.ts): an adapter maps its source's types to these. */
export const CLASS_NAMES = [...NAMES] as [string, ...string[]];

/** What a source may do (PP1, PP7): only `locates` puts a place on the map. */
export const ROLES = ['locates', 'confirms', 'nominates'] as const;
export type Role = (typeof ROLES)[number];

/** License families a pack may hold, one per pack (PP9). */
export const LICENSE_FAMILIES = ['cc0', 'odbl', 'cdla-permissive', 'apache'] as const;
export type LicenseFamily = (typeof LICENSE_FAMILIES)[number];

const position = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const text = z.string().trim().min(1);

/** PP1: everything an adapter must say about its source before it may run. */
export const DeclarationSchema = z
  .strictObject({
    name: z.string().regex(/^[a-z][a-z0-9-]*$/),
    /** The short code a pack's `src` carries (`wd`). */
    code: z.string().regex(/^[a-z]{2,8}$/),
    license: text,
    licenseFamily: z.enum(LICENSE_FAMILIES),
    attribution: text,
    role: z.enum(ROLES),
    /** The hosts it calls, so PP16 can check the app names none of them. */
    hosts: z.array(z.string().regex(/^[a-z0-9.-]+$/)).min(1),
    pace: z.strictObject({ perMinute: z.number().positive(), userAgent: z.string().min(10) }),
    allowed: z.strictObject({
      store: z.boolean(),
      /** Days a raw answer may be kept; null when the license sets no limit. */
      retentionDays: z.number().int().positive().nullable(),
      redistribute: z.boolean(),
      reachPack: z.boolean(),
    }),
    /** The day its terms were read (YYYY-MM-DD). */
    termsChecked: z.iso.date(),
    /** The decision record that admitted it (`0104`); required of a nominating adapter (decision 0104). */
    decision: z.string().regex(/^\d{4}$/).optional(),
  })
  .refine((d) => d.role !== 'nominates' || d.decision != null, { path: ['decision'], message: 'a nominating adapter names the decision record that admitted it' })
  .refine((d) => d.role !== 'nominates' || !d.allowed.reachPack, { path: ['allowed', 'reachPack'], message: 'a nomination never reaches a pack' });
export type Declaration = z.infer<typeof DeclarationSchema>;

/** PP4, PP5: what every adapter emits, whatever its source. */
export const CandidateSchema = z.strictObject({
  source: z.string().regex(/^[a-z][a-z0-9-]*$/),
  sourceId: text,
  name: text,
  at: position.optional(),
  class: z.enum(CLASS_NAMES).optional(),
  signals: z.strictObject({ gone: z.boolean().optional(), heritage: z.boolean().optional() }),
  /** Other sources' IDs for the same thing (`wikidata:Q123`), which a confirming source matches by. */
  sameAs: z.array(z.string().regex(/^[a-z][a-z0-9-]*:.+$/)).optional(),
  /** A link a person can follow; dropped before conflate, never reaches a place (PP5). */
  evidence: z.string().optional(),
  fetchedAt: z.iso.datetime(),
});
export type Candidate = z.infer<typeof CandidateSchema>;

/** A place as the gate sees it and a pack holds it (PP6, PP9). */
export const PlaceSchema = z.strictObject({
  id: z.string().regex(/^p_[0-9a-f]{16}$/),
  name: text,
  at: position,
  class: z.enum(CLASS_NAMES).optional(),
  gone: z.boolean(),
  src: z.string().regex(/^[a-z]{2,8}$/),
  license: z.enum(LICENSE_FAMILIES),
});
export type Place = z.infer<typeof PlaceSchema>;

/** PP9: a pack's tile feature, exactly these four properties (the app's `archivePois.ts` reads them). */
export const FeatureSchema = z.strictObject({ name: text, class: z.enum(CLASS_NAMES), src: z.string(), id: z.string() });

/** The committed JSON Schema (PP5). */
export function jsonSchema() {
  return {
    $comment: 'Generated from src/schema.ts by `npm run contract`; a test fails when they differ (PP5).',
    contractVersion: CONTRACT_VERSION,
    candidate: z.toJSONSchema(CandidateSchema),
    place: z.toJSONSchema(PlaceSchema),
    feature: z.toJSONSchema(FeatureSchema),
  };
}
