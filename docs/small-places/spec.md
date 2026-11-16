# Small places, the data side (SL)

Nov 16, 2026 · the owner, from the app's Small places (the app's `specs/small-places`, decision 0182).

OpenStreetMap locates a pinned table of small places of its own: time capsules, plaques, public bookcases, small
memorials, old stones, wayside shrines, artworks of a known type and community gardens. For every other class it still
only confirms Wikidata's places (RD7). An unnamed small place enters with no name; the app names it by its type.

## Why

The owner asked how Pikmin Bloom's postcards reach small things such as a time capsule (the app's
`docs/research/small-places-wayspots.md`). Niantic's Wayspots can't be used; OpenStreetMap's tags cover the same ground,
but a place only OpenStreetMap knows never entered a pack (the app's 0110).

## Vision

The app's gate (0182): aligned if reshaped. A pinned table, an unmapped tag left out, nothing counted; the repetitive
types start off in the app. Nothing here stores a count or a rank (PP5 holds).

## Decisions (the owner's calls)

- Nov 14 (0182): OpenStreetMap contributes places of its own for the pinned table; unnamed ones are named by their type
  (in the app); `access=private|no` keeps a place out.
- Nov 16: **one OSM adapter, its role by class** (over two adapters): it locates the table's classes and confirms the
  rest, so the week's extracts are still downloaded once.
- Nov 16: **a marker is a marker whoever lists it** (type decides, 0103): OSM's plaques take Wikidata's class `marker`;
  the app moves `marker` into "Plaques and markers".
- Defaults taken here: OSM's artworks take the existing classes `mural`, `sculpture` and `statue` (type decides);
  only `relief` and `mosaic` join `sculpture` and `mural`; an artwork of another type, or none, is left out.

## Criteria

- **SL1** a source's declaration may name the classes it locates (`locates`) beside a `confirms` role: its candidates of
  those classes make places, the rest only confirm. The gate still reads no source name (PP6). `locates` is refused on a
  source that already locates or nominates.
- **SL2** the OSM adapter's table, pinned: `memorial=plaque|blue_plaque` → `marker`; `memorial=bench|ghost_bike|stolperstein`
  → `small_memorial`; `historic=milestone|boundary_stone` → `old_stone`; `historic=wayside_shrine|wayside_cross` →
  `wayside_shrine`; `historic=time_capsule` → `time_capsule`; `amenity=public_bookcase` → `public_bookcase`;
  `leisure=garden` with `garden:type=community` → `community_garden`; `tourism=artwork` with `artwork_type`
  `mural|mosaic` → `mural`, `sculpture|relief` → `sculpture`, `statue` → `statue`. Any other tag is no place.
- **SL3** an element tagged `access=private` or `access=no` makes no place.
- **SL4** an element whose `wikidata` tag names an item the build already made a place of is that place, not a second.
- **SL5** a small place may have no name: the candidate, the place and the pack's feature carry `""`; every other class
  still needs a name (PP4 sets aside a nameless one).
- **SL6** two unnamed places of the same class within 10 m are one place; an unnamed place is never the same as a named
  one; named places keep 0103's rule (same name within 50 m).
- **SL7** a way or an area becomes one point inside its bounds (its vertices' mean); a relation without geometry is no place.
- **SL8** a pack with a place OpenStreetMap located is ODbL (RD11).
- **SL9** the fetch keeps the small places' elements in their own raw part beside the confirming one, from the same
  download of each extract; a changed filter fetches again (RB2).
- **SL10** contract v3: the new classes; `locates` in `sources.json`; the feature's `name` may be empty only for the
  small classes.
- **SL11** the review report lists each review area's small places with their class, as the others (RD12), so the owner
  can strike types or places in `edits.json` before a pack with them is published.

## Not here

- Outside the US (the regions are the app's call).
- Overture's places of these types (0109).
