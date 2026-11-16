// The stores pack's canonical shape (ST1, ST2, ST8; the app's QC11, QC40). A store holds exactly an opaque id, a
// name, a position, facets and a src; every object is closed and the only numbers are the two of a position. Nothing
// here can hold a rating, a count of reviews, a price level, popularity, foot traffic, a photo or "open now"; `hours`
// is reserved and not emitted. A store is not a place: it has its own schema and id prefix (`s_`).
import { z } from 'zod';
import { CONTRACT_VERSION } from '../classes';
import { DIMENSIONS, EMITTED, RESERVED_FIELDS, type Dimension } from './dimensions';

const position = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const text = z.string().trim().min(1);

/** The facets of a store: a closed object of the emitted dimensions, each one or more values of its list, once each. */
const facetShape = Object.fromEntries(EMITTED.map((d: Dimension) => {
  const values = DIMENSIONS[d].values as unknown as [string, ...string[]];
  const list = z.array(z.enum(values)).min(1).refine((v) => new Set(v).size === v.length, { message: 'each value once' });
  return [d, d === 'what' ? list : list.optional()];
}));
export const FacetsSchema = z.strictObject(facetShape);

/** What an adapter emits for one shop, before the gate. */
export const StoreCandidateSchema = z.strictObject({
  source: z.string().regex(/^[a-z][a-z0-9-]*$/),
  sourceId: text,
  name: text,
  at: position,
  facets: FacetsSchema,
  fetchedAt: z.iso.datetime(),
});
export type StoreCandidate = z.infer<typeof StoreCandidateSchema>;

/** A store as the pack holds it and the example records show it. */
export const StoreSchema = z.strictObject({
  id: z.string().regex(/^s_[0-9a-f]{16}$/),
  name: text,
  at: position,
  facets: FacetsSchema,
  src: z.string().regex(/^[a-z]{2,8}$/),
});
export type Store = z.infer<typeof StoreSchema>;

/** The tile feature: flat string properties, `what: "antiques,books"` (values joined by a comma). */
export const FeatureSchema = z.strictObject({ name: text, id: z.string(), src: z.string(), what: z.string() });

/** The committed JSON Schema, with the dimensions and what a client does with what it does not know (ST2, ST8). */
export function storesJsonSchema() {
  return {
    $comment: 'Generated from src/stores/schema.ts by `npm run contract`; a test fails when they differ.',
    contractVersion: CONTRACT_VERSION,
    record: z.toJSONSchema(StoreSchema),
    feature: z.toJSONSchema(FeatureSchema),
    dimensions: DIMENSIONS,
    reserved: [...RESERVED_FIELDS],
    encoding: 'A pack feature (layer `stores`, zoom 12) carries flat string properties: name, id, src, and one per emitted dimension holding its values joined by a comma.',
    clients: 'A client ignores a dimension or a value it does not know and reads the rest; an unknown dimension or value never fails a read and never shows. Dimensions are added by contract version only.',
  };
}
