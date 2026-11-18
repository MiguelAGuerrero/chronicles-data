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
  `pier`; suspension bridges are `bridge` (`suspension_bridge` from v8, AT10); national monuments are `monument`.
- **AT6** the new types are asked whole by country on the first run that knows them (CF3), with no other change to the
  fetch.

## Audit (Nov 18)

Two findings of the more-attractions audit. AT7 and AT8 add or rename no class; AT9 (the owner's answer to audit 16,
Nov 18) adds `natural_monument`, so the contract goes to version 7 (`CONTRACT_VERSION` 7). The app ships v7 before the
data does.

- **AT7** (audit 15, 17) a listed or Landmark place keeps the class its listing gives it (`listing()`), whatever v6 type it
  also carries: it is classified as if the v6 types did not exist. The listing's class wins over `museum_by_type`,
  `amusement_park`, `nature_reserve` and `pier`, and (the owner, Nov 18: "Yes, every new type") over national monument
  Q893745, suspension bridge Q12570 and the garden types v6 added. Castle Clinton, Fort McHenry and the Statue of Liberty
  National Monument take their listing's class again. A listed
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
  is not possible, and reading another property only to sort a place is ruled out (the app's 0117). AT9 answers it.
- **AT9** (audit 18; the owner, Nov 18: "Own subtype under Nature") the US national monuments that are natural places
  are a new class, `natural_monument`, never `monument`. Wikidata cannot tell them by type (about 20 of the 25 natural
  ones are typed only national monument), so they are pinned by item (QID) from the Nov 18 lookup: 24 items, the fossil
  beds, volcanoes, reefs, caves, canyons, forests and wild lands among the 76, with the four AT8's types caught except
  Timpanogos Cave, which stays `cave` (a show cave is a cave, by type). El Morro, Scotts Bluff and Russell Cave are
  natural features kept for their history and stay as they were. A pinned item that is listed or a Landmark keeps its
  listing's class (AT7). It needs a name (it is not among the classes that may come unnamed). The class is new:
  contract v7.

## Typed bridges (Nov 18)

The owner, Nov 18: a bridge that enters only by a v6 Wikidata type gets a class of its own, which the app does not
count toward History, as typed museums (`museum_by_type`) and piers already are. The contract goes to version 8
(`CONTRACT_VERSION` 8).

- **AT10** a suspension bridge (Q12570) with no NRHP listing or Landmark designation is `suspension_bridge`, never
  `bridge`. A covered bridge (Q1825472, from v4) stays `bridge`, and wins over `suspension_bridge` when an item is
  typed both (`bridge` comes first in ORDER): a covered bridge is historic by nature. A listed or Landmark place keeps
  its listing's class (AT7), so a listed suspension bridge is `bridge` when its listing's root maps to `bridge`, or
  whatever else its listing gives. It needs a name, as `bridge` does (it is not among the classes that may come
  unnamed). The class is new: contract v8.

  The name: Q12570 is the only v6 bridge type, and the fetch asks P31 directly, never a subclass. Of its subclasses
  only self-anchored suspension bridge (Q7448015) has US items with coordinates (3), and those are not asked; rope,
  chain and simple suspension bridges have none. So the class names what it holds, `suspension_bridge`, not a
  catch-all `bridge_by_type`; a later bridge type gets its own name or renames this one in a new contract version.

  A lookup on Nov 18 (`?item wdt:P31 wd:Q12570 ; wdt:P17 wd:Q30 ; wdt:P625 ?c`, listing as the fetch reads it: an
  NRHP statement with no end time, or NHL) found 122 US suspension bridges: 41 listed or Landmarks (3 Landmarks, the
  Brooklyn Bridge among them), all `bridge` by their listing's root; 81 unlisted, all `suspension_bridge` (none is
  also typed a covered bridge or an earlier class), of which 80 carry a name and enter (the George Washington,
  Verrazzano-Narrows and Williamsburg bridges among them) and one (Q15825753) has no English label and is left out.
