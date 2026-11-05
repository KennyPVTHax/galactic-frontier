# M3–M6 workstreams and file ownership

All workstreams branch from the verified M2 baseline (`galactic-frontier-m2-baseline`, commit `dfaf2f5`)
plus the integration-contract commit that adds this file. Each workstream edits only the files it owns.
Shared contracts are extended by adding optional fields, never by renaming.

| Workstream | Owner | Owns (write) | Reads (contract) |
|---|---|---|---|
| A · Procedural universe | universe agent | `src/world/planet.ts`, `src/world/heightfield.ts`, `src/world/sky.ts`, `src/world/weather.ts`, `src/graphics/materials.ts`, `src/graphics/texgen.ts`, `src/universe/planets.ts`, `tests/universe.test.ts` | `src/universe/types.ts` |
| B · Graphics | graphics agent | `src/vehicles/shipModel.ts`, `src/world/station.ts`, `src/world/space.ts`, `src/graphics/warpFx.ts`, `src/graphics/shipFx.ts`, `src/graphics/profiles.ts`, `src/graphics/governor.ts`, `src/gameplay/effects.ts`, renderer post-processing (`src/graphics/renderer.ts` except `setWorld`), `tests/m3-graphics.test.ts` | `RendererWorld`, `WorldLighting` |
| C · Combat | combat agent | `src/combat/**` (except `ids.ts`), `tests/combat.test.ts` | `src/combat/ids.ts` |
| D · Exploration & gameplay | coordinator | `src/gameplay/contracts.ts`, `src/gameplay/progression.ts`, `src/gameplay/hazards.ts`, `src/gameplay/upgrades.ts`, `src/gameplay/resources.ts`, `src/gameplay/inventory.ts` | all |
| E · Cross-platform | coordinator | `src/input/input.ts`, `src/ui/**`, `src/platform/**` | all |
| F · QA & integration | coordinator | `src/core/game.ts`, `src/persistence/**`, `src/universe/types.ts`, `src/combat/ids.ts`, `src/engine/babylon.ts`*, `scripts/**`, `docs/**`, `README.md` | all |

\* `src/engine/babylon.ts` is append-only for every workstream (add exports, never remove).

Integration order: contracts → A, B, C in parallel (isolated worktrees) → coordinator merges A, then C, then B
into `claude/galactic-frontier-m2-m6-jaqnfn`, re-running the full M1/M2 suites after each merge.
