# OpenStreetMap shop counts, for the owner's review (SK)

Nov 18, 2026 · the owner.

The owner, on the outing's shop chips (thrifting, antiques, books): "I want to ensure that we're comprehensive in our shop
listing ... we need to ensure that refinement makes sense there rather than it being ad hoc, because each thing you would
like to see is a facet of our data." Asked how the list of kinds should be decided: **measure the data first**.

The stores pack keeps eleven `shop=` values and eight `craft=` values, chosen by hand (docs/stores/spec.md). Before that
list is redrawn as two facets (what a shop sells, and how it sells it), the OpenStreetMap run counts, for the US, every
value of `shop` and of `craft`, and how many elements of each also say they sell second-hand.

**The counts are for the owner's review only**, as the tag counts of docs/osm-tag-counts are: written to
`out/report.json` and nowhere else, never in a pack, a release, the manifest, the registry or a raw part. They decide,
gate and rank nothing; the list of kinds drawn from them is the owner's, by a contract version.

## Criteria

- **SK1** every value of `shop` and of `craft` is counted, not a pinned list: `osmium tags-count` with `shop=*` and
  `craft=*`.
- **SK2** each extract is counted in the pass the run already makes over it (never downloaded again): one
  `tags-filter -R nwr/shop nwr/craft` keeps the elements carrying either; `tags-count` on that small file gives `all`.
- **SK3** `secondHand` is the count among those elements that also carry `second_hand=only` or `second_hand=yes`
  (`tags-filter -R` on the small file, then `tags-count`), so the report shows how far "how it sells" is recorded beside
  "what it sells".
- **SK4** a value carried by fewer than three elements of an extract is left out of that extract's counts (misspellings
  and one-offs), so a value's total may be under its true count by at most eight; the report says so.
- **SK5** each extract's counts are a note of the run (`shopCounts:<part>`), never a raw answer; an extract unchanged
  since the copy held carries its note with its answers.
- **SK6** the run's counts are the sum over the four US extracts; if any extract's note is missing or unreadable there
  are none that run: a part of the US is never reported as the whole.
- **SK7** the report holds them as `osmKindCounts: { minPerExtract: 3, tags: { "shop=books": { "all": n, "secondHand": m, "withHours": h }, ... } }`,
  the tags ordered by `all`, largest first, then by name; only from a run that asked OpenStreetMap and fetched it itself
  (as OC6).
- **SK9** (the owner, Nov 18: "shops are one type of store, but attractions and galleries and other sorts of stops, museums,
  things you can enter are also under consideration"; asked, **widen the count**) every value of `tourism`, `historic`,
  `leisure` and `amenity` is counted too, with `tags-count` on the extract itself (those elements are millions, so no
  file of them is written); they carry `secondHand: 0`. The same floor of three per extract applies.
- **SK10** (the owner, Nov 18: "there has to be some consideration on operational hours as well") each tag also carries
  `withHours`: the count among its elements that carry `opening_hours` (`tags-filter -R nwr/opening_hours` over the extract,
  then `tags-count` on that file), so the owner sees how far hours are recorded for each kind before anything is built on them.
- **SK12** (the owner, Nov 18: "farmers markets, boutiques, gift shops, visitor centers, and other ... stops that aren't quite
  stores ... but are well-known attractions") `information` is counted too: a visitor centre is `tourism=information` with
  `information=visitor_centre`, which the value of `tourism` alone does not tell from a signpost. A farmers' market
  (`amenity=marketplace`), a boutique and a gift shop (`shop=boutique`, `shop=gift`) are already among the keys counted.
- **SK11** an extract whose kinds were never counted is asked for whole on the next run that asks OpenStreetMap, even if
  unchanged since the copy held, so the counts do not wait for the extract to change; once its note exists it is asked only
  if it changed, as before (RB5).
- **SK8** a count that fails is logged and changes nothing else: no raw part, no place, no store, no fetch fingerprint.

## Not in this slice

Redrawing the stores contract's dimensions (`what`, and the reserved `how`); the app's chips; any shop beyond
OpenStreetMap; counts outside the US.
