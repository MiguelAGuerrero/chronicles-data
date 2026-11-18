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

## Audit (Nov 18)

Two findings of the more-attractions audit. Neither adds or renames a class, so the contract stays at version 6 and
`CONTRACT_VERSION` does not change.

- **AT7** (audit 15) a listed or Landmark place keeps the class its listing gives it (`listing()`), whatever v6 type it
  also carries: the listing's class wins over `museum_by_type`, `amusement_park`, `nature_reserve` and `pier`. A listed
  church or theatre that is also typed a museum stays `church` or `theatre`; a Landmark amusement park (Kennywood) is
  `building_structure` again, as before v6. AT2's listed museum is the case where the listing's class is `museum`.
- **AT8** (audit 16) national monument (Q893745) makes a `monument` only on its own terms: an item typed a statue as well
  stays `statue`, and a national monument that is a natural area (typed a protected area, a nature reserve, a natural
  landscape or monument, a biosphere reserve, a canyon, a volcano, a mountain, a forest, a coral reef or a cave, or any
  of the archive's nature classes) makes no `monument` place; it takes the class of whatever else it is typed, or none.
  Either way an item that is also typed a monument or an obelisk stays `monument`.

  A lookup on Nov 18 found the 76 US national monuments with coordinates: none is typed a statue (the Statue of Liberty
  National Monument is typed only national monument and National Park System unit); 19 are typed archaeological sites,
  three historic districts (never a place, RD4). Of some 25 natural ones, only three carry a natural type (Colorado:
  natural landscape; Organ Pipe Cactus: biosphere reserve; Virgin Islands Coral Reef: coral reef) and one a nature class
  (Timpanogos Cave: show cave, so `cave`). The others (Cedar Breaks, Devils Tower, Muir Woods, Jewel Cave, the fossil
  beds and so on) are typed only as national monuments and still enter as `monument`: telling them apart by type alone
  is not possible, and reading another property only to sort a place is ruled out (the app's 0117). That is left to the
  owner.
