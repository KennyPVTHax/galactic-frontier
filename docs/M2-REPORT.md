# Galactic Frontier — M2 report (landscape & visual fidelity)

Version 0.2.0. Standalone module; OrbitBtc production repositories untouched.

## 1. Scope kept unchanged

These source files are **byte-identical to M1**:

`gameplay/mission.ts`, `gameplay/inventory.ts`, `gameplay/miningLaser.ts`, `gameplay/upgrades.ts`, `gameplay/resources.ts`,
`vehicles/shipPhysics.ts`, `world/heightfield.ts`, `core/worldConfig.ts`, `core/random.ts`, `core/quality.ts`,
`persistence/saveSystem.ts`, `integration/backend.ts`, `player/cameraRig.ts`.

So the following are unchanged: Veyra-7's terrain function, mission ID `intro_first_light_v1` and its objectives
(40 Lumenite + 30 Ferrite), scanner/mining/inventory/upgrade/flight rules, the save schema (still version 2) and the
server-authoritative reward contract. No currencies or Orbit Coin amounts were added. Deposits, points of interest and
boulders replay M1's random sequences, so every deposit ID and position matches M1 saves (tested with a real M1 save).

## 2. What changed

See the "What M2 adds" list in README.md. Exact files:

Line counts are `git diff --numstat` against the M1 deliverable (+ added / − removed).

| Status | File | + / − | What |
|---|---|---|---|
| Added | `src/graphics/profiles.ts` | +230 | tiers, platform defaults, capability ceiling, fallbacks |
| Added | `src/graphics/governor.ts` | +108 | frame-rate / memory governor |
| Added | `src/graphics/renderer.ts` | +382 | live profile application, post, shadows, env probe, stats |
| Added | `src/graphics/materials.ts` | +484 | Standard ⇄ PBR material library, world shader plugin (Basic keeps M1's flat water) |
| Added | `src/graphics/texgen.ts` | +202 | tileable procedural textures |
| Added | `src/platform/platform.ts` | +301 | platform detection, GPU probe, landscape, insets, haptics |
| Added | `src/persistence/devicePrefs.ts` | +54 | device-local graphics preferences |
| Modified | `src/world/planet.ts` | +509 / −235 | chunked terrain + LOD, props, vegetation, water, scatter fields |
| Modified | `src/core/game.ts` | +193 / −89 | renderer/platform/orientation integration, throttle slider, wind, effects |
| Modified | `src/gameplay/effects.ts` | +183 / −25 | debris, dust, gusts, exhaust, landing dust (fixed capacities) |
| Modified | `src/player/astronaut.ts` | +165 / −101 | two-segment limbs, blended animation, PBR suit |
| Modified | `src/ui/hud.ts` | +71 / −18 | HUD frame, insets, rotate prompt, graphics settings, perf overlay |
| Modified | `src/input/input.ts` | +71 / −11 | landscape cluster hooks, throttle slider, haptics |
| Modified | `src/ui/styles.ts` | +53 / −2 | landscape layout, safe areas, slider, rotate prompt |
| Modified | `src/world/sky.ts` | +30 / −5 | Mie halo, optical-depth gradient, clouds |
| Modified | `src/engine/babylon.ts` | +20 / −1 | new Babylon imports |
| Modified | `src/vehicles/shipModel.ts` | +20 / −20 | PBR hull/canopy, gunmetal trim and sky fill, nozzle points |
| Modified | `src/world/station.ts` | +9 / −7 | library materials |
| Modified | `src/index.ts` | +6 | profile exports, `__gfSave` for the Android back button |
| Modified | `src/player/player.ts` | +4 / −3 | passes the material library and vertical speed to the model (movement code unchanged) |
| Modified | `src/main.ts` | +1 / −1 | accepts tier names in `?quality=` |
| Added | `tests/m2-graphics.test.ts`, `tests/m2-platform.test.ts` | +95, +134 | 16 unit tests |
| Added | `scripts/m2-validate.cjs`, `scripts/m2-compare.cjs`, `scripts/m2-smoke-timing.cjs` | +522, +98, +63 | browser validation, before/after renders, smoke-test timing diagnostic |
| Added | `integration-examples/android/*` | +158 | reference game Activity, manifest snippet, bridge doc |
| Added | `docs/M2-REPORT.md`, `docs/REAL-DEVICE-TESTS.md`, `docs/m2-screenshots/*` | | this report, device checklist, screenshots |
| Modified | `README.md`, `docs/INTEGRATION.md`, `package.json` (0.2.0, scripts) | | |
| Unchanged | `tests/gameplay.test.ts`, `tests/systems.test.ts`, `scripts/smoke-test.cjs`, `scripts/build.mjs`, `index.html`, `tsconfig.json`, `integration-examples/GalacticFrontierView.tsx`, `integration-examples/fastapi_galactic_frontier.py` | | byte-identical |

## 3. Validation (headless Chromium + SwiftShader, device emulation)

All results below are from the final build. Run with `npm run test:m2` (scripts/m2-validate.cjs). Raw output: `test-results/m2/m2-results.json`.

| Suite | Result |
|---|---|
| Unit tests (21 M1, unchanged + 16 M2) | ✅ 37/37 |
| M1 browser smoke test (script unchanged, run against the M2 build, Low → Basic) | ⚠️ 24/25 — **unresolved, timing-sensitive**: "walking moves player" moved 3.0 m (needs > 3 m). It holds W + Shift for 1500 ms of wall-clock time, which is 1–4 rendered frames in software WebGL. Frame-exact parity shows identical walking and sprint movement in M1 and every M2 tier; see the timing table below. Not counted as passed. |
| M2 browser checks (emulation) | ✅ 47/47 |

| | Check | Detail |
|---|---|---|
| ✅ | pc-16x9: auto tier follows desktop default + hardware limit | basic (desktop default enhanced, limited by hardware) |
| ✅ | 16:9: HUD uses full width | frame inset 0px |
| ✅ | pc-16x9: no page errors |  |
| ✅ | pc-ultrawide-21x9: auto tier follows desktop default + hardware limit | basic (desktop default enhanced, limited by hardware) |
| ✅ | ultrawide: HUD kept inside a central frame | frame inset 38px |
| ✅ | pc-ultrawide-21x9: no page errors |  |
| ✅ | Android: platform detected as android-browser | android-browser |
| ✅ | Android: landscape layout active | {"landscape":true,"rotateHint":false,"fullscreen":false,"orientationLocked":false,"insets":{"top":0,"right":0,"bottom":0 |
| ✅ | Android: no page errors |  |
| ✅ | Telegram: platform detected | telegram |
| ✅ | Telegram: auto tier is Telegram Basic | basic (telegram default) |
| ✅ | Telegram: fullscreen requested inside the start tap | ready,expand,disableVerticalSwipes,requestFullscreen,lockOrientation |
| ✅ | Telegram: vertical swipes disabled |  |
| ✅ | Telegram: orientation locked (device already landscape) |  |
| ✅ | Telegram: HUD applies safe-area + content-safe-area insets | 46px |
| ✅ | Telegram: no page errors |  |
| ✅ | live switch → basic: state, deposits, terrain and laser stats unchanged | post=false shadows=none |
| ✅ | live switch → enhanced: state, deposits, terrain and laser stats unchanged | post=true shadows=single |
| ✅ | live switch → ultra: state, deposits, terrain and laser stats unchanged | post=true shadows=cascaded |
| ✅ | live switch → basic: state, deposits, terrain and laser stats unchanged | post=false shadows=none |
| ✅ | switching changes rendering (Basic: no post/shadows, Ultra: cascaded + post) |  |
| ✅ | live switch keeps a single canvas / no reload |  |
| ✅ | Settings select applies preset live |  |
| ✅ | WebGL context loss → restore: rendering resumes | {"during":1,"after":21,"lostFlag":false} |
| ✅ | context loss: game state preserved |  |
| ✅ | shared save keeps the M1 schema (version 2, no graphics tier inside) | keys: version,savedAt,mode,player,ship,inventory,upgrades,mission,depleted,partial,discoveredPois,lootedPois,settings |
| ✅ | reload: device graphics preference restored | enhanced |
| ✅ | reload: inventory and mission restored |  |
| ✅ | presets/context/save: no page errors |  |
| ✅ | M1 save loads in M2: mode, inventory, upgrades, mission step |  |
| ✅ | M1 save: deposit ids map to the same deposits (depleted / partial) | {"lum0":0,"fer1":9,"fer1max":17} |
| ✅ | M1 save compat: no page errors |  |
| ✅ | portrait phone: rotate prompt shown in game |  |
| ✅ | rotate to landscape: prompt hidden, landscape HUD |  |
| ✅ | rotate: canvas resized | 437 → 891 px |
| ✅ | rotate: game state preserved (mission, inventory, position) | launch/launch lum 7/7 |
| ✅ | landscape joystick moves the player | 3.3 m |
| ✅ | right-side drag rotates the camera | Δyaw 0.93 rad |
| ✅ | on-foot buttons: ≥44 px, on screen, no overlaps | use:54 scan:50 sprint:47 jump:59 fire:73 |
| ✅ | Mine button mines with aim assist |  |
| ✅ | touch buttons give haptic feedback | 1 vibrations |
| ✅ | flight: throttle slider visible in landscape |  |
| ✅ | throttle slider sets ship throttle to the dragged value (80%) without overshoot | throttle 80% |
| ✅ | orientation/touch: no page errors |  |
| ✅ | gameplay parity M2 basic vs M1 (medium): flight, walking, jetpack, mining yield, heat, energy | sprint 1.5 s 14.056/14.056 m @ 10/10 m/s, walk 1.5 s 8.006/8.006 m @ 5.5/5.5 m/s, ferrite 15/15, jet 8.451/8.451 |
| ✅ | gameplay parity M2 enhanced vs M1 (medium): flight, walking, jetpack, mining yield, heat, energy | sprint 1.5 s 14.056/14.056 m @ 10/10 m/s, walk 1.5 s 8.006/8.006 m @ 5.5/5.5 m/s, ferrite 15/15, jet 8.451/8.451 |
| ✅ | gameplay parity M2 ultra vs M1 (medium): flight, walking, jetpack, mining yield, heat, energy | sprint 1.5 s 14.056/14.056 m @ 10/10 m/s, walk 1.5 s 8.006/8.006 m @ 5.5/5.5 m/s, ferrite 15/15, jet 8.451/8.451 |

Test changes during validation (assertions unchanged): the landscape joystick and throttle-slider checks used to read state after a fixed wall-clock delay. They failed under software rendering (joystick 1.6 m against the 2 m requirement on an earlier build; throttle 52% while still ramping), so they now wait on game state with a timeout. The joystick still requires more than 2 m of movement. The throttle check now also requires no overshoot past the dragged value (74–86% for a drag to 80%).

**Gameplay parity** (identical inputs at a fixed 60 Hz step; flight from the dock, 1.5 s walk, 1.5 s sprint, jetpack burn, 6 s of laser fire on the same Ferrite deposit through the real game update):

| Build | Flight end (x,y,z) | Walk 1.5 s | Sprint 1.5 s | Jetpack height | Fuel | Ferrite | Heat | Energy |
|---|---|---|---|---|---|---|---|---|
| M1 (medium) | -116.938,327.301,64.16 | 8.006 m (5.5 m/s) | 14.056 m (10 m/s) | 8.451 m | 100 | 15 | 37.4 | 68.25 |
| M2 basic | -116.938,327.301,64.16 | 8.006 m (5.5 m/s) | 14.056 m (10 m/s) | 8.451 m | 100 | 15 | 37.4 | 68.25 |
| M2 enhanced | -116.938,327.301,64.16 | 8.006 m (5.5 m/s) | 14.056 m (10 m/s) | 8.451 m | 100 | 15 | 37.4 | 68.25 |
| M2 ultra | -116.938,327.301,64.16 | 8.006 m (5.5 m/s) | 14.056 m (10 m/s) | 8.451 m | 100 | 15 | 37.4 | 68.25 |

**M1 smoke test, wall-clock walking check (unresolved, timing-sensitive).** The unchanged smoke test holds W + Shift for 1500 ms of wall-clock time and needs > 3 m. Result on the final build: walking moves player — moved 3.0 m. The same input repeated in both builds on the same machine (`scripts/m2-smoke-timing.cjs`):

| Build | Trial | Frames rendered | Game time simulated | Distance | Peak speed |
|---|---|---|---|---|---|
| M1 (low) | 1 | 3 | 0.45 s | 4.5 m | 10 m/s |
| M1 (low) | 2 | 4 | 0.469 s | 3.03 m | 10 m/s |
| M1 (low) | 3 | 4 | 0.6 s | 6 m | 10 m/s |
| M2 (low → Basic) | 1 | 2 | 0.3 s | 3 m | 10 m/s |
| M2 (low → Basic) | 2 | 1 | 0.15 s | 1.5 m | 10 m/s |
| M2 (low → Basic) | 3 | 2 | 0.3 s | 3 m | 10 m/s |

Frame-exact parity (above) shows identical walking and sprint distance and speed over exactly 1.5 s of game time in M1 and every M2 tier. This check is classified as a timing-sensitive test issue, not a pass.

Screenshots: `docs/m2-screenshots/` (landscape Telegram Basic, Android Ultra, PC 16:9 and 21:9, touch controls) and the before/after grid `docs/m2-screenshots/before-after-grid.jpg`.

## 4. Profile per tier

Same view (Survey Site Alpha, on foot), 1280×720 CSS px, adaptive quality off.

| Tier | Load | CPU per frame (update + submit) | Draw calls | Triangles | Decor instances | GPU textures + targets | JS heap | Shadows |
|---|---|---|---|---|---|---|---|---|
| Telegram Basic | 2.0 s | 4.1 ms | 80 | 106k | 2.1k | 1.8 MB | 65 MB | none |
| PC Enhanced | 2.7 s | 8.4 ms | 157 | 203k | 8.1k | 82 MB | 93 MB | 2048 map |
| Android Ultra | 3.9 s | 9.1 ms | 287 | 350k | 14.6k | 82 MB | 93 MB | 3 × 1024 cascades |

- Whole frames took 0.86 s / 1.55 s / 3.37 s in SwiftShader (software rasterisation on a 2-core VM). These are **not** device
  frame rates. On real GPUs the rasterisation part is far cheaper; CPU time, draw calls, triangles and memory are the
  numbers to budget against.
- Texture figures count every unique GPU texture and render target, including shadow maps and post-processing targets
  (half-float on desktop, 8-bit on mobile). Ultra measured as a desktop here; on phones its post targets are 8-bit.
- Optimisations made during profiling: decor meshes cut from 288/42/80 to 48/24/20 triangles (fronds/grass/pebbles)
  with per-type cull distances (−42% software frame time on Ultra); cascades 2048→1024 and MSAA 4→2 (shadow + MSAA memory
  from ~100 MB to ~25 MB).
- 30 fps on high-end Android in Ultra is the target, not a measured result: Ultra's CPU frame (update + draw submission) was 9–15 ms across runs on this VM, which
  leaves headroom on a flagship phone; GPU time must be measured on devices (see REAL-DEVICE-TESTS.md). The governor drops
  resolution, then bloom, particles, shadow detail and vegetation if a device falls below 30 fps.

## 5. Real-device tests still required

See docs/REAL-DEVICE-TESTS.md. None of Android (app or browser), Telegram (Android/iOS) or iOS was run on physical hardware.

## 6. Known limitations

- Fullscreen/orientation behaviour inside claude.ai's artifact preview is restricted by that sandbox; test on the real hosts.
- Telegram orientation lock locks the current orientation only (by design of the Telegram API).
- Textures are procedural, so texture compression (KTX2) doesn't apply yet.
- Flying toward the sun, the ship's back is in shadow. It now reads as dark gunmetal with a stronger sky fill (it was flat black in M1 and early M2), but it is still the darkest object on screen.
