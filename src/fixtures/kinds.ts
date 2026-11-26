// The fixtures pack's kinds (docs/fixtures/spec.md FX2, FX3, FX14; the app's decisions 0225, 0255, 0268): what a developed
// town is expected to have, the owner's closed list of Nov 25, each from its one OpenStreetMap tag. A kind is added only
// by a contract version (src/classes.ts), never by a record; a client ignores a kind it does not know. Practical
// amenities (toilets, parking, drinking water...) are not on it, and nothing here can ask for one.
import type { Filter } from '../adapters/osm/extract';

export const KINDS = [
  { kind: 'tourist_office', key: 'information', value: 'office' },
  { kind: 'town_hall', key: 'amenity', value: 'townhall' },
  { kind: 'library', key: 'amenity', value: 'library' },
  { kind: 'post_office', key: 'amenity', value: 'post_office' },
  { kind: 'square', key: 'place', value: 'square' },
  { kind: 'market', key: 'amenity', value: 'marketplace' },
  { kind: 'station', key: 'railway', value: 'station' },
  { kind: 'bus_station', key: 'amenity', value: 'bus_station' },
  { kind: 'courthouse', key: 'amenity', value: 'courthouse' },
  { kind: 'community_centre', key: 'amenity', value: 'community_centre' },
  { kind: 'ferry_terminal', key: 'amenity', value: 'ferry_terminal' },
  { kind: 'common', key: 'leisure', value: 'common' },
  { kind: 'bandstand', key: 'leisure', value: 'bandstand' },
] as const;

export type Kind = (typeof KINDS)[number]['kind'];
export const KIND_NAMES = KINDS.map((k) => k.kind) as unknown as [Kind, ...Kind[]];

/**
 * FX14 (decision 0268, "All but heritage"): the tags that make a `railway=station` a preserved or scenic railway's, a place
 * to discover and not a fixture. The kind counts hold none of these keys, so they are not sized.
 */
export const HERITAGE_STATION: readonly (readonly [string, readonly string[]])[] = [
  ['railway:preserved', ['yes']],
  ['usage', ['tourism']],
  ['tourism', ['museum', 'attraction']],
  ['historic', ['railway_station']],
];

/**
 * FX3, FX10: what the shared extract step keeps for fixtures, in the pass it already makes over each extract (osmium ORs
 * one pass's expressions). Derived from KINDS, so the filter cannot drift from the list.
 */
const keys = [...new Set(KINDS.map((k) => k.key))];
export const FIXTURE_FILTER: Filter = {
  name: 'fixtures',
  expressions: keys.map((key) => `nwr/${key}=${KINDS.filter((k) => k.key === key).map((k) => k.value).join(',')}`),
};
