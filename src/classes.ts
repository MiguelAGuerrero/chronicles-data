// The class names a place may carry: the contract's vocabulary (decision 0107 in the app repo). The data repo owns
// it; the app maps each name to its own category and kind (its `archivePois.ts`) and pins a copy of this list
// through `contract/places.schema.json`. A new name is a contract change: bump CONTRACT_VERSION and tell the app.
export const CONTRACT_VERSION = 1;

/** In the order a Wikidata place is classified (classify.mjs's ORDER), then the listed-building fallback. */
export const CLASS_NAMES = [
  'monument', 'memorial', 'statue', 'marker',
  'mural', 'sculpture',
  'overlook', 'tower',
  'folly', 'novelty_building', 'roadside_giant', 'natural_oddity', 'odd_engineering', 'marks_a_fact', 'art_environment', 'ruin',
  'heritage_building',
] as const;
export type ClassName = (typeof CLASS_NAMES)[number];
