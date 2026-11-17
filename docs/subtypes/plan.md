# Subtypes, the data side: the plan

| File | Change |
|---|---|
| `src/classes.ts` | `CONTRACT_VERSION` 4; the 28 new class names of ST1 in `CLASS_NAMES`, in classification order (ST2); `UNNAMED_CLASSES` extended (ST6) |
| `src/adapters/wikidata/classify.mjs` | `CLASSES`: the new Wikidata types per class, the moves (war memorial, covered bridge, lighthouse, milestone, fire lookout tower, ghost town) out of their old lists; `ORDER` places the new classes before the classes they came from (ST2); `listing()` reads the root-to-class table (ST3) |
| `scripts/places-archive/pin-types.mjs`, `src/adapters/wikidata/public-types.json` | roots gain tavern and inn (entering only as a Landmark or shown open, never public by type) and concert hall; the pinned file gains `classOf` (root to class: bridge, mill, station, lighthouse, civic_building, fort, water_tower, fountain, tavern, battlefield, archaeological_site, concert_hall); re-pinned by running the script (the query service answers from this session) (ST3) |
| `src/adapters/osm/index.ts` | `SMALL_TABLE` becomes the located table of ST1 (plaques to `plaque`); a row may carry `not` (drinking fountains, ST5) and `named` (caves); `SMALL_FILTER` follows (ST4, ST9) |
| `contract/`, `src/contract.ts` | regenerated (`npm run contract`) (ST1) |
| `test/subtypes.test.ts` (new) | ST1-ST10, written first as todos, then made real |
| `test/small.test.ts` | SL2's plaque row now `plaque` (the owner's Nov 17 call supersedes Nov 16's) |
| `README.md` | the contract's v4 line; OSM's located table |

No new dependency. No new source: Wikidata and OpenStreetMap are already declared; their fetch fingerprints change
(the Wikidata class list, the OSM filter), so the next push re-fetches Wikidata (minutes) and the next weekly or hand
run fetches OpenStreetMap (over an hour; RB8).

## Order of work

1. Spec and plan (this), reviewed with the app's.
2. Tests first, committed as todos.
3. Classes, classify, the re-pin, the OSM table; each test made real.
4. `npm run typecheck && npm test && npm run contract`; the app takes contract v4 (its PP17 fails until it does).
5. Merge to `main`: the push re-fetches Wikidata and publishes when a block changed. OpenStreetMap's new rows wait for
   the weekly run (Mondays 07:17 UTC) or a hand run with `sources: osm`, which the owner starts (this session's
   GitHub integration may not dispatch workflows).

## Cost

Wikidata: 28 more P31 values in one query family, a few thousand items in the US (measured on Nov 17: waterfall 823,
botanical garden 704, zoo 337, concert hall and opera house 408, hot spring 170, fountain 165, water tower 146,
watermill 142, remarkable tree 120, carousel 70, …). OpenStreetMap: one wider filter pass over the same extracts;
fountains are the largest row (estimated in the thousands in the US; taginfo is blocked from this session). The pack
grows from 3.1 MB by an estimated 1-3 MB.
