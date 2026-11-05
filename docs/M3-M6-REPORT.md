# Galactic Frontier M3–M6 — status report

Branch `claude/galactic-frontier-m2-m6-jaqnfn`, built on the verified M2 baseline (`galactic-frontier-m2-baseline`,
commit `dfaf2f5`, source ZIP SHA-256 `e0a43abef35169ca5055c75ffbac73bf863855f8a9bcd7aa33dda5778ba4a63a`).
Everything below was run in headless Chromium (software WebGL / SwiftShader) in a cloud container.
**No real Android phone, Telegram client or GPU was available. Nothing here proves device frame rates.**

## What is playable

| Milestone | Delivered |
|---|---|
| **M3 graphics** | Rebuilt Wayfarer (panel-detail PBR hull, twin cannons, engine lights, 5 paint schemes, shield-ripple + damage FX), upgraded Halcyon Dock, orbital asteroid belt + debris + starfield (`world/space.ts`), warp star-streak effect with FOV kick, new engine/thruster FX, three render tiers (Telegram Basic / Desktop Enhanced / Android Extreme HD) with per-tier budgets for ship detail, asteroids, weather, combat FX, warp |
| **M4 planets** | Data-driven `PlanetDef` universe. Veyra-7 reproduced exactly (terrain identical over 7,812 samples, 334 deposits and 3 POIs identical). Five new original worlds: **Aetherion** (lush forests, lakes, ruins), **Kryos** (ice, frozen lakes, blizzard, cold hazard), **Pyron** (lava fields, ash, heat hazard), **Zephyria** (storms, floating stone, outposts), **Noctaris** (dark hostile fortress world, toxic hazard, danger 5). Star map, warp transitions with in-scene planet swap, planet weather, resource zones, discoverable POIs, suit-integrity hazards |
| **M5 combat** | Pure, deterministic combat sim + renderer + HUD. Five enemy types (Scout drone, Pirate interceptor, Heavy raider, Hunter squadron, Dreadnought boss), explicit AI states PATROL→DETECT→PURSUE→ATTACK→EVADE/RETREAT→RETURN, shields then hull, heat/overheat, target selection + lock + lead marker, squadron formation/flank/retreat, dreadnought hardpoints and phases, explosions, virtual loot/XP |
| **M6 content** | 11 data-driven contracts covering discovery, scanning, extraction, elimination, defense, escort, distress, recovery, investigation and boss missions; pilot XP, 6 ranks, 10 achievements, paint unlocks; three new ship upgrade lines (shield, weapons, engine); save schema v3 with v1/v2 migration |

Rewards are virtual in-game resources and XP only. No Orbit Coins, balances or payment code exists in the game (tests assert no "coin" fields in contracts, enemies, planets or saves). See `docs/INTEGRATION.md` §11.

## Controls added
`M` star map · `J` contracts & pilot log · `LMB` fire (flight) · `T` cycle/lock target. Touch flight cluster gains **Fire / Target / Map**.

## Verification (all run on the final integrated code unless noted)

| Check | Result |
|---|---|
| TypeScript `tsc --noEmit` | clean |
| Unit tests (`npm test`) | **60 / 60** — 37 original M2 + 9 combat + 7 universe + 7 gameplay |
| M1 browser smoke test (`npm run test:browser`, unchanged script) | **25 / 25** |
| M2 browser suite (`npm run test:m2`) | **46 / 46** (one assertion updated: shared save is now schema v3; v2 saves still load) |
| Required gameplay journey (`npm run test:journey`, Basic tier) | **15 / 15**, no page errors |
| Six planets build and swap in a live scene | 0.3–0.7 s each, 0 errors, on Basic/Enhanced/Extreme HD |
| Repeated planet transitions (2 laps × 6 planets, all tiers) | Veyra-7 returns to identical mesh/material/texture counts each lap; 0 unready materials after any swap; 0 errors |
| Android landscape touch layout (Pixel-7 emulation, 863×360) | all flight buttons on screen, ≥44 px, no overlaps with HUD |

### The journey test
Start docked in the Wayfarer → undock → open star map → select Aetherion → warp → a pirate Ashveil Lancet appears → it detects and attacks (AI states observed) → shield drains → player fires (LMB) and lands hits → it is destroyed → XP + loot → land, step out, scan → warp home and dock → contract completes with a virtual reward → save, reload, state restored.
Debug helpers are used only to skip long flights (teleports) and to keep the nose on the target (mouse aiming at 1–5 fps is impractical). Damage, AI, shields, rewards, contracts and saves run through the normal game code.

### Benchmark (`npm run bench`, 10 s of flight, SwiftShader CPU rendering)
| Profile | Load | Avg FPS | 1 % low FPS | p95 frame | Peak JS heap | Draw calls | Triangles | Texture memory |
|---|---|---|---|---|---|---|---|---|
| Telegram Basic | 1682 ms | 4.47 | 2.4 | 400 ms | 75.7 MB | 84 | 82k | 4 MB |
| Desktop Enhanced | 2327 ms | 1.37 | 0.86 | 1166.7 ms | 78.4 MB | 116 | 231k | 104.6 MB |
| Android Extreme HD | 3306 ms | 0.76 | 0.63 | 1583.4 ms | 98.8 MB | 163 | 392k | 103.9 MB |

**The FPS numbers are software rendering on a 4-core CPU. They only rank the tiers against each other on this machine; they are not a measure of any phone or GPU, and the original "≈60 FPS" claim for M2 remains unverified by me.** Draw calls, triangles, heap and texture memory are real counts and are useful. Raw data: `docs/m6-benchmark.json`.

## Bugs found and fixed during integration (worth knowing)
1. **PBR materials went permanently unready after the first planet swap** on Enhanced / Extreme HD: `Planet.dispose()` disposed Babylon's scene-wide environment-BRDF lookup texture (created lazily inside the first Planet constructor). Fixed, and the benchmark now counts unready materials after every swap.
2. A duplicate opaque shield sphere (combat renderer) filled the chase camera on every shield hit.
3. Aetherion tree generation crashed (merging meshes with different vertex attributes).
4. The ship's dark underside disappeared against dark terrain in combat views (small self-lit fill added to PBR ship materials).
5. Combat HUD overlapped toasts / touch buttons / the ship; relocated and checked numerically.

## Honest limitations / not done
- **No real-device testing** (Android phone, WebView, Telegram, iOS, Safari). Extreme HD "60 FPS on flagships" is a design target, not a measurement.
- WebGL only; WebGPU not attempted.
- Asteroids and planet props are visual only for the ship (no ship–asteroid collision yet).
- Textures are procedural; there is no compressed (KTX2/ASTC) texture path.
- Noctaris is very dark; the acid lake is garish. Art direction pass pending.
- Journey test used Basic tier only; Enhanced and Extreme HD were exercised by combat/warp/benchmark runs but not the full journey.
- The warp-effect post-process (`profile.warpFx.post`), heat haze and renderer screen effects planned for Extreme HD are not implemented; only star-streak warp, FOV kick and a HUD damage vignette are.
- Stations other than Halcyon Dock, boarding/derelict interiors and audio do not exist.
- Dreadnought boss and station-defense / escort encounters are unit-tested at the simulation level and wired to contracts, but were not played through in the browser end to end.
- Agents A (planets), B (graphics) and C (combat) were interrupted by a usage limit before finishing; their work was integrated and completed by the coordinator. Agent-B items not delivered: `warpFx` (written by the coordinator), renderer post effects, `tests/m3-graphics.test.ts`. Agent-A and Agent-C deliverables not written by them: `tests/universe.test.ts`, `tests/combat.test.ts`, `combatHud.ts` (all now written).
