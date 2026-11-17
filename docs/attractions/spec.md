# More attractions, the data side (AT)

Nov 17, 2026 · the owner, from the app's `specs/more-attractions` (its decision on the same day).

Contract v6 asks Wikidata for conventional attractions it measured on Nov 17 and the archive left out: every museum by
type (5,866 US museums with coordinates; 942 reached the pack, only through a listing), every kind of garden, nature
reserves and wildlife refuges, amusement and water parks, suspension bridges, piers and boardwalks, national monuments.
Source and licence unchanged (Wikidata, CC0). Type decides (0103); nothing is fetched only to sort a place (the app's 0117).

## Decisions (the owner's calls, Nov 17)

- **Wikidata types this round**; outside sources (Smithsonian sculptures, state markers, city public art) wait until each
  licence is confirmed at its source.
- **Every museum by type, Culture only unless listed**: a museum that enters by its listing keeps the class `museum` (and
  the app's History bar, PK1); one that enters by type is `museum_by_type`.
- **Nature reserves and gardens, no parks** (the map's tiles carry parks).
- **Amusement and theme parks with zoos and aquariums.**

## Criteria

- **AT1** contract v6: the classes `museum_by_type`, `nature_reserve`, `amusement_park`, `pier`; `CONTRACT_VERSION` 6 (v5 went to the stores pack).
- **AT2** a museum of any of the pinned museum types enters as `museum_by_type`; a listed or Landmark museum stays
  `museum`, whatever else it is typed.
- **AT3** a garden of the pinned garden types (garden, sculpture, memorial, public, Chinese, peace and Japanese gardens
  outside Japan, with v4's botanical, arboretum, Japanese and rose) is `garden`; an urban park, an orchard and a garden
  square are not.
- **AT4** nature reserves, National Wildlife Refuges, wildlife refuges and areas, national preserves and ecological
  reserves are `nature_reserve`; Research Natural Areas, biosphere reserves and marine sanctuaries are not asked.
- **AT5** amusement, water, theme, animal theme and marine mammal parks are `amusement_park`; piers and boardwalks are
  `pier`; suspension bridges are `bridge`; national monuments are `monument`.
- **AT6** the new types are asked whole by country on the first run that knows them (CF3), with no other change to the
  fetch.
