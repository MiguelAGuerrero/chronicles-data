# OpenStreetMap tag counts, for the owner's review (OC)

Nov 18, 2026 · the owner.

The weekly OpenStreetMap run measures, for the US, how many elements carry each conventional-attraction tag, and how
many of those also carry a `wikidata` tag, so the owner can judge what OpenStreetMap holds that Wikidata may not.

**The counts are for the owner's review only.** They are written to `out/report.json` (the `report` workflow artifact,
RD12) and nowhere else: never in a pack, a release, the manifest, the registry or a raw part. They never decide, gate
or rank a place: a structured type decides (the app's 0103), and nothing is a count or a score. Changing them changes
no place.

## Criteria

- **OC1** the tags counted are pinned: `tourism=museum|attraction|theme_park|zoo|aquarium|viewpoint|gallery|artwork`,
  `leisure=nature_reserve|garden|park|water_park`, `man_made=pier`,
  `historic=memorial|monument|ruins|fort|castle|archaeological_site|ship|wreck|building|manor`,
  `natural=cave_entrance` and `waterway=waterfall` (OpenStreetMap's waterfall is a `waterway`, as SL2 reads it).
- **OC2** the counts are read from `osmium tags-count` (its lines are `count<TAB>"key"<TAB>"value"`; a tag no element
  carries has no line and counts 0). Its expressions take no object-type prefix: `nwr/tourism=museum` matches nothing.
- **OC3** each extract is counted in the pass the run already makes over it, never downloaded again: one
  `tags-filter -R` over the extract keeps the elements carrying a counted tag; `tags-count` on that small file gives
  `all`; `tags-filter -R nwr/wikidata` on it, then `tags-count`, gives `withWikidata`. `-R` keeps out the nodes and
  members an element only refers to, so each count is of elements that carry the tag themselves.
- **OC4** each extract's counts are kept as a note of the run (`tagCounts:<part>`), never as a raw answer, so no
  adapter reads them; an extract unchanged since the copy held (RB5) carries its note with its answers.
- **OC5** the run's counts are the sum over the four US extracts, every pinned tag present (0 when none carries it). If
  any extract's note is missing, or counted another set of tags, there are no counts that run: a part of the US is
  never reported as the whole.
- **OC6** the report holds them as `osmTagCounts: { "tourism=museum": { "all": n, "withWikidata": m }, ... }`. A run
  that does not fetch OpenStreetMap (a push, a hand run naming other sources, `--no-fetch`, a fetch that failed and fell
  back) writes no `osmTagCounts` and does not fail.
- **OC7** counting never changes what the run keeps: the raw parts are the same with or without it, and a count that
  fails is logged and leaves that run with no counts; the fetch goes on and the places are built as before.
