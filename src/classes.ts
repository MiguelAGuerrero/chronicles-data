// The class names a place may carry: the contract's vocabulary (decision 0108 in the app repo). The data repo owns
// it; the app maps each name to its own category and kind (its `archivePois.ts`) and pins a copy of this list
// through `contract/places.schema.json`. A new name is a contract change: bump CONTRACT_VERSION and tell the app.
// v2 (Remarkable and public, RD13): the listed places' classes by type, and `heritage_building` renamed
// `building_structure`, since no class name may name a register or significance (the data side of the app's RP18).
export const CONTRACT_VERSION = 2;

/** In the order a Wikidata place is classified (classify.mjs's ORDER), then the listed places' classes by type. */
export const CLASS_NAMES = [
  'monument', 'memorial', 'statue', 'marker',
  'mural', 'sculpture',
  'overlook', 'tower',
  'folly', 'novelty_building', 'roadside_giant', 'natural_oddity', 'odd_engineering', 'marks_a_fact', 'art_environment', 'ruin',
  'church', 'cemetery', 'theatre', 'museum', 'historic_site',
  'building_structure',
] as const;
export type ClassName = (typeof CLASS_NAMES)[number];
