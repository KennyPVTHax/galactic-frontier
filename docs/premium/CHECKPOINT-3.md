# Checkpoint 3 — Galactic Frontier World Editor

**What exists:** an in-Unity editor (**Tools ▸ Galactic Frontier ▸ World Editor**) that lets the owner sculpt, paint, place rocks and paint grass on the spherical Aetherion, save, reload, undo/redo, and play the result. A demo region ("Demo Meadow") is saved. One-click beginner guide: [WORLD-EDITOR-GUIDE.md](WORLD-EDITOR-GUIDE.md).
**What does not exist:** the full vegetation/biome/rock population system (Checkpoint 4), other planets, trees/bushes, mission/gameplay data on the sphere.

## Architecture (the foundation that was fixed before building the editor)
| Layer | Implementation | Persistent? |
|---|---|---|
| 1. Procedural base planet | `AetherionField` (seeded; TypeScript-exact inside the gameplay region) | regenerated from code + seed |
| 2. Owner terrain/material/vegetation overrides | `AuthoredWorld`: **sparse offsets on a fixed global lattice** (32768² per cube face ≈ 0.5 m; integer keys identical across face edges/corners) | yes — `Assets/Resources/Authored/aetherion.gfworld.bytes` (versioned, GZip, 19 B/point before compression) |
| 3. Owner props/landmarks/regions | list in the same file; positions stored as planet-relative directions, surface-snapped at spawn | yes |
| 4. Procedural spawning | grass cells regenerate deterministically from (cell id, seed, authored paint/exclusion) | no — never stored |

The rendered mesh is **never** the source of truth: every patch samples `procedural + authored offsets` as a function of direction, so edits are identical at every LOD, continuous across patch and cube-face boundaries, and a patch that streams out and back in is rebuilt identically.

## Results (this PC, RX 9070 XT; Windows development player; nothing measured on a phone)
| Acceptance test | Evidence |
|---|---|
| 1 Open the editor directly in Unity | real screenshots `screens/cp3/editor_*.jpg`, video `world_editor_demo.mp4` |
| 2 Select a region | Navigate tab: Go/Create/radius/limit-to-region; screenshot 02/03 |
| 3 Sculpt visually | Raise/Lower/Smooth/Flatten; screenshots 03; test: rendered mesh changes +3.60 m where raised |
| 4 Paint ≥ 2 materials | Grass/Dirt/Rock/Sand; screenshot 05; test: rock weight 255, override 1.0 |
| 5 Place/remove realistic rocks | Props tab (Poly Haven CC0 rocks); screenshot 06; placement, move, delete + undo covered by tests |
| 6 Small grass area | Vegetation tab; test: painted patch → 2,802 blades, exclusion zone → 0 |
| 7 Undo/Redo | Unity Ctrl+Z/Y bridge; test: undo of all 10 steps restores the empty world exactly, redo restores exactly |
| 8 Save & reopen | test: save → close → reopen: identical content hash, identical terrain (10010.440 m) and prop ids/positions |
| 9 Regeneration keeps edits | test: new procedural seed → authored offsets preserved to 1.8e-15 m, props preserved; planet base really changed |
| 10 Boundaries seamless | pure test: 0 cracked vertices with edits across the +X/+Z face edge, identical normals; Unity test: rendered surface within 0.12 m of the edited analytic surface over 150 m, crossing the edge |
| 11 Stream out & back | test: far side → props 0, grass near edit 0, fine patches gone; back → props same ids, **no duplicates**, same terrain, same grass paint/exclusion |
| 12 Existing tests still pass | 7/7 boundary walks (feet ≤ 4.5 cm below mesh), 23 pure-math tests, TypeScript height equality 4e-10 m |

Playable Windows preview (`scripts/premium/run-planet.ps1`): demo world loads from the saved file; 12 props live at start; after a 6 km fly-over and return the same 12 props reappear, **0 duplicates** (`planet_tests.json › authoredPropsAfterFlyoverReturn`). Screenshots `screens/cp3/game_*.jpg`.

## Performance (see STREAMING-HITCH.md)
Fly-over 250 m/s: avg 4.2 ms, p99 13.6 ms, mesh memory 54 MB peak → 30 MB. Removing per-sample allocations in paint/vegetation sampling cut the average from 11.8 ms to 4.2 ms. Remaining issues documented with a plan: 104 ms first-frame hitch after a teleport (cold start), 1,323 GC collections / 24 s from per-patch allocation, main-thread patch building. Grass does no work above 30 m (game) / 90 m (editor) altitude. About 1.7 M surface triangles remains too heavy for phones.

## Known limitations (honest)
* Only Aetherion; planet selector shows the others as disabled.
* Painting/sculpt resolution ≈ 0.5 m (lattice), material paint is interpolated per terrain vertex (about 1 m at the finest LOD) — not a texture splat; edges of strokes look soft.
* Flatten is stored as an offset: if the procedural ground underneath is regenerated, the flattened area follows the new ground (documented trade-off for regeneration-safety).
* Authored data is one file per planet (≈ 8 KB per 1,000 painted points after GZip); chunking per region is planned for Checkpoint 4.
* Prop selection picks the nearest *live* prop within 28 px; props outside the spawn range (500 m in the editor) are not selectable until you fly closer.
* Props have no colliders on the sphere yet (the player ignores rocks for now).
* Grass blades look dark in the Scene view at some angles (lighting setup differs from the game camera).
* Only one vegetation type (grass) and two rock categories (boulders, pebbles); no trees/bushes yet.
* The Scene-view tools were verified with real screenshots from a scripted session (`EditorTour`), but **mouse-driven dragging by a human has not been exercised** — the scripted session calls the same stroke/placement code paths the mouse handlers call. Expect small UX issues on first real use.
* Unity may open the Package Manager (deprecated In-App Purchasing warning from the default package set); harmless.
* Android: unchanged since Checkpoint 2 (IL2CPP builds; Gradle step failed on DNS). No phone used.

## Reproduce
```
dotnet run -c Release --project unity/Tools/PlanetMathTests          # 23 pure tests (planet + authoring)
powershell scripts/premium/run-editor-tests.ps1                      # 20 in-Unity World Editor tests
powershell scripts/premium/run-planet.ps1 -Name cp3                  # build Windows player, boundary walks, streaming, demo shots
Unity -batchmode -executeMethod GF.EditorTools.DemoWorldBuilder.Build -quit   # (re)create the demo region
Unity -executeMethod GF.EditorTools.EditorTour.Run                    # scripted real-editor screenshots (needs a visible desktop)
```
