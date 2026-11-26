// The class names a place may carry: the contract's vocabulary (decision 0108 in the app repo). The data repo owns
// it; the app maps each name to its own category and kind (its `archivePois.ts`) and pins a copy of this list
// through `contract/places.schema.json`. A new name is a contract change: bump CONTRACT_VERSION and tell the app.
// v2 (Remarkable and public, RD13): the listed places' classes by type, and `heritage_building` renamed
// `building_structure`, since no class name may name a register or significance (the data side of the app's RP18).
// v3 (Small places, SL10; the app's decision 0183): OpenStreetMap's small places, and an empty name for them.
// v4 (Subtypes, ST1; the app's decision 0191): classes by what a place is, new Wikidata types, OSM's wider table;
// published once the app that reads it shipped (Nov 17).
// v5 (the stores pack, docs/stores/spec.md; written as v3 on its branch, before v3 and v4 landed): a separate stores layer with
// its own schema, dimensions (`what` emitted, `how` reserved) and manifest key `stores`; the places classes are unchanged.
// v6 (More attractions, AT1; the app's specs/more-attractions): museums by type, nature reserves, amusement parks, piers.
// v7 (more-attractions audit 18, AT9; the owner, Nov 18): `natural_monument`, the US national monuments that are natural places.
// v8 (typed bridges, AT10; the owner, Nov 18): `suspension_bridge`, a suspension bridge that enters by type, not a listing.
// v9 (the fixtures pack, docs/fixtures/spec.md; the app's specs/town-fixtures and decision 0268): a third layer, a town's
// fixtures by kind, with its own schema and manifest key `fixtures`; the places classes and the stores are unchanged.
export const CONTRACT_VERSION = 9;

/** In the order a Wikidata place is classified (classify.mjs's ORDER), then the listed places' classes by type. */
export const CLASS_NAMES = [
  'monument', 'memorial', 'statue', 'marker',
  'mural', 'sculpture',
  'overlook', 'tower',
  'folly', 'novelty_building', 'roadside_giant', 'natural_oddity', 'odd_engineering', 'marks_a_fact', 'art_environment', 'ruin',
  'church', 'cemetery', 'theatre', 'museum', 'historic_site',
  'building_structure',
  // SL2: small places OpenStreetMap locates (a plaque is a `marker`, an artwork a `mural`, `sculpture` or `statue`).
  'small_memorial', 'old_stone', 'wayside_shrine', 'time_capsule', 'public_bookcase', 'community_garden',
  // ST1: subtypes (the app's decision 0191): what a place is, from its type, its listed type's root or its tags.
  'fountain', 'sign', 'plaque', 'war_memorial', 'battlefield', 'archaeological_site', 'bridge', 'mill', 'station', 'lighthouse',
  'civic_building', 'fort', 'water_tower', 'clock_tower', 'tavern', 'historic_machine', 'mausoleum', 'garden', 'waterfall', 'cave',
  'hot_spring', 'old_tree', 'concert_hall', 'observatory', 'carousel', 'zoo', 'fire_tower', 'ghost_town',
  // AT1 (contract v6): conventional attractions asked by type.
  'museum_by_type', 'nature_reserve', 'amusement_park', 'pier',
  // AT9 (contract v7): the natural national monuments, pinned by item.
  'natural_monument',
  // AT10 (contract v8): suspension bridges by type (a listed one is `bridge`, AT7).
  'suspension_bridge',
] as const;
export type ClassName = (typeof CLASS_NAMES)[number];

/** SL5: the classes a place may carry with no name (the app names it by its type); every other class needs one. */
export const UNNAMED_CLASSES: readonly ClassName[] = [
  'marker', 'mural', 'sculpture', 'statue', 'small_memorial', 'old_stone', 'wayside_shrine', 'time_capsule', 'public_bookcase', 'community_garden',
  // ST6: never a water tower or a cave (an unnamed one is a municipal tank or a hole in the ground).
  'fountain', 'plaque', 'war_memorial', 'mill', 'lighthouse', 'historic_machine', 'waterfall', 'hot_spring', 'old_tree', 'carousel',
];
