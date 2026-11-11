// The OpenStreetMap filter for the locating adapter (the app's decision 0142): the monuments and memorials the weekly
// extract pass keeps, so the raw store, saved in the state pre-release, stays small. What the adapter then reads of
// them (the value table, access, lifecycle tags) is in `./places.ts`.
import type { Filter } from './extract';

/** Every element tagged `historic=monument` or `historic=memorial`, wikidata tag or not. */
export const PLACES_FILTER: Filter = { name: 'places', expressions: ['nwr/historic=monument,memorial'] };
