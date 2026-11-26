// The fixtures pack's canonical shape (FX1, FX2, FX9, FX12; the app's TF5, TF19). A fixture holds exactly an opaque id, a
// kind, a position, a src and, where it has one, a name; every object is closed and the only numbers are the two of a
// position. Nothing here can hold a rating, a count, visits, opening hours or a link. A fixture is neither a place nor a
// store: its own schema and id prefix (`f_`).
import { z } from 'zod';
import { CONTRACT_VERSION } from '../classes';
import { HERITAGE_STATION, KIND_NAMES, KINDS } from './kinds';

const position = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const text = z.string().trim().min(1);
const kind = z.enum(KIND_NAMES);

/** What an adapter emits for one fixture, before the merge; `item` (a Wikidata id) only joins two of one fixture. */
export const FixtureCandidateSchema = z.strictObject({
  source: z.enum(['osm', 'wikidata']),
  sourceId: text,
  kind,
  at: position,
  name: text.optional(),
  item: z.string().regex(/^Q\d+$/).optional(),
  fetchedAt: z.iso.datetime(),
});
export type FixtureCandidate = z.infer<typeof FixtureCandidateSchema>;

/** A fixture as the pack holds it and the example records show it. */
export const FixtureSchema = z.strictObject({
  id: z.string().regex(/^f_[0-9a-f]{16}$/),
  kind,
  at: position,
  name: text.optional(),
  src: z.enum(['osm', 'wd']),
});
export type Fixture = z.infer<typeof FixtureSchema>;

/** The tile feature: flat string properties; `name` is left out when there is none. */
export const FeatureSchema = z.strictObject({ kind: z.string(), id: z.string(), src: z.string(), name: z.string().optional() });

/** The committed JSON Schema, with the kinds, their tags and what a client does with a kind it does not know (FX2, FX9). */
export function fixturesJsonSchema() {
  return {
    $comment: 'Generated from src/fixtures/schema.ts by `npm run contract`; a test fails when they differ.',
    contractVersion: CONTRACT_VERSION,
    record: z.toJSONSchema(FixtureSchema),
    feature: z.toJSONSchema(FeatureSchema),
    kinds: KINDS.map((k) => ({ kind: k.kind, osm: `${k.key}=${k.value}` })),
    wikidata: { library: 'P31 = Q28564 (public library) exactly, in the US, with a coordinate and an English label; never one dissolved (P576) or closed (P3999)' },
    notFixtures: {
      'information=visitor_centre': 'an attraction\'s visitor centre, a place to discover',
      heritageStation: `a railway=station also tagged ${HERITAGE_STATION.map(([k, vs]) => `${k}=${vs.join('|')}`).join(', ')}`,
    },
    encoding: 'A pack feature (layer `fixtures`, zoom 12) carries flat string properties: kind, id, src (osm or wd), and name when it has one.',
    clients: 'A client ignores a kind it does not know and reads the rest; an unknown kind never fails a read and never shows. Kinds are added by contract version only.',
  };
}
