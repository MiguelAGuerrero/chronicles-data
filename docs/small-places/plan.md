# Small places, the data side: the plan

| File | Change |
|---|---|
| `src/classes.ts` | `CONTRACT_VERSION` 3; `small_memorial`, `old_stone`, `wayside_shrine`, `time_capsule`, `public_bookcase`, `community_garden`; `UNNAMED_CLASSES` (those, `marker`, `mural`, `sculpture`, `statue`) (SL5, SL10) |
| `src/schema.ts` | the declaration's optional `locates` (classes), only with `confirms` (SL1); a candidate's, place's and feature's `name` may be `""` for an unnamed class (SL5) |
| `src/conflate.ts` | a candidate's role by its class (SL1); a locating candidate whose `sameAs` names a place already made is aliased to it (SL4); unnamed twins by class within 10 m, the registry keyed `#<class>` for them (SL6); a located place of a non-CC0 family touches its family (SL8) |
| `src/runner.ts` | `SourceInfo` carries `locates`; the review's locating set by candidate (SL11) |
| `src/adapters/osm/index.ts` | `locates`, the second filter `small`, `adapt` by part (`small-*` locates, the rest confirms), the tag table, access, centroids (SL2, SL3, SL7, SL9) |
| `src/contract.ts`, `contract/` | regenerated (SL10) |
| `test/small.test.ts` (new) | SL1-SL11, written first as todos |
| `README.md` | the role by class, the pack's unnamed places |

No new dependency; `osmium` already runs the shared step.
