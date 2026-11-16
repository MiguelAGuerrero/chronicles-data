// The stores contract's dimensions (ST2): what a client may filter a store by. A dimension is added, and a value
// added to its closed list, only by a contract version (src/classes.ts), never by a record. A client ignores a
// dimension or value it does not know. `how` is declared so a later version can emit it without renaming anything.
export const DIMENSIONS = {
  /** What a shop sells. `second_hand` is thrift and charity shops; `antiques` and `vintage` (curated dealers) are their own. */
  what: { emitted: true, values: ['antiques', 'vintage', 'books', 'records', 'maps', 'art_supplies', 'crafts', 'second_hand'] },
  /** Reserved: how it sells (the owner's example, "vintage versus thrift"). Not emitted in v1. */
  how: { emitted: false, values: ['vintage', 'thrift', 'new'] },
} as const;

export type Dimension = keyof typeof DIMENSIONS;
export const EMITTED = (Object.keys(DIMENSIONS) as Dimension[]).filter((d) => DIMENSIONS[d].emitted);

/** Reserved field names of the record: not emitted in v1, and the schema rejects them. */
export const RESERVED_FIELDS = ['hours'] as const;

export type What = (typeof DIMENSIONS.what.values)[number];
