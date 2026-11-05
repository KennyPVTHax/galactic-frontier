# OrbitBtc · Galactic Frontier — M3–M6 (planets, combat, missions)

> **M7 (real-device readiness):** standalone **Android debug APK** + offline **web preview** built by GitHub Actions
> (`.github/workflows/m7-build.yml`), a real-device **performance recorder**, planet-swap leak fixes, a playable dreadnought,
> and browser E2E tests. Start with [docs/PHONE-TESTING.md](docs/PHONE-TESTING.md) and [docs/M7-REPORT.md](docs/M7-REPORT.md).
> `npm run build:release` / `build:android-assets` (no test hooks) · `npm run test:leaks` · `npm run test:contracts -- station|escort|boss`.

Original third-person space exploration game (TypeScript + Babylon.js 9). Built on the verified M2 baseline
(`galactic-frontier-m2-baseline`). **Start with [docs/M3-M6-REPORT.md](docs/M3-M6-REPORT.md)** for what is playable, the test and
benchmark numbers, bugs found, and the honest list of what is *not* done (notably: no real-device testing).

- **Six worlds** (Veyra-7 + Aetherion, Kryos, Pyron, Zephyria, Noctaris), star map and warp travel; weather and hazards per planet.
- **Space combat**: five hostile ship types, explicit AI states, shields/hull, lock-on, squadron and dreadnought-boss logic.
- **11 contracts**, pilot XP/ranks, achievements, ship upgrades (shield/weapons/engine), cosmetic paints, save schema v3.
- **Three render tiers**: Telegram Basic · Desktop Enhanced · Android Extreme HD (manual choice in Settings, adaptive resolution).
- Rewards are virtual in-game resources/XP only. Nothing touches OrbitBtc balances or backend (see `docs/INTEGRATION.md` §11).

```bash
npm install
npm run dev                  # http://localhost:5173
npm run build                # dist/lib + dist/preview/index.html (single playable file) + types
npm test                     # 60 unit tests (needs no browser)
npm run build:preview && npm run test:journey   # the 14-step required journey in headless Chromium
npm run test:browser         # M1 smoke test (unchanged)        npm run test:m2    # M2 suite
npm run bench                # per-tier benchmark (software GL numbers are comparison-only)
```
Headless Chromium note: the browser scripts use the Playwright version pinned in `package.json`. If its browser download is
unavailable, preload a shim that sets `executablePath` to an installed Chromium.

**New controls:** `M` star map · `J` contracts & pilot log · `LMB` fire in flight · `T` cycle/lock target · touch: **Fire / Target / Map**.
Preview URL flags (unchanged): `?quality=basic|enhanced|ultra`, `?touch=1`, `?start=new|continue`, `?debug=1` (test helpers; never ship enabled).

---

# Milestone 2 documentation (still accurate)

## Milestone 2 (landscape & visual fidelity)

Galactic Frontier is an original third-person space exploration game (TypeScript + Babylon.js), built as a standalone
module. M2 is a visual and orientation upgrade on top of the M1 gameplay that the owner tested. Gameplay, missions,
saves and the reward contract are unchanged. The OrbitBtc production website, backend and Android release branch were not modified.

All assets are original and procedural (geometry, shaders, runtime-generated textures). No third-party models or textures.

## What M2 adds

- **One scene, three rendering profiles**: Telegram Basic, PC Enhanced, Android Ultra. The platform picks the default;
  hardware capability and the player's device setting decide the effective tier. Switching is live (no reload).
- **Realism**: PBR materials with a sky reflection probe and computed sky ambient; splat-textured terrain (soil grain,
  lichen, pebbles, cracks, triplanar rock strata, normal detail); aerial-perspective haze that thickens in valleys;
  Mie sun halo and drifting clouds; ACES tone mapping and colour grading; cascaded shadows on Ultra.
- **World detail**: smoother displaced rocks with far LODs, faceted crystals, new bulb-flora, swaying grass and fronds,
  glow caps by the lakes, wave-normal water with sky reflections, wind-driven dust and gusts, mining debris,
  ship exhaust trails and landing dust.
- **Character**: two-segment limbs (knees, elbows), torso counter-rotation, landing compression, jetpack and sprint
  posture, breathing idle; PBR suit fabric and reflective visor. Ship: PBR hull panels, glass canopy.
- **Landscape everywhere**: Telegram fullscreen + orientation lock (Bot API 8.0+); Android game-Activity bridge;
  mobile-browser fullscreen + orientation lock; rotate prompt where landscape can't be forced; ultrawide HUD frame.
- **Landscape touch controls**: floating left joystick, right-side camera, thumb-arc buttons (Mine, Jump/Jet, Scan, Use,
  Sprint), flight cluster with a throttle slider (10% haptic detents), Boost, Up/Down. Haptics via Telegram, the Android bridge or `navigator.vibrate`.
- **Safe areas**: notch/cutout and gesture-bar insets from CSS `env()`, Telegram (`safeAreaInset` + `contentSafeAreaInset`) or the Android bridge.
- **Performance**: chunked terrain with LOD, instancing, chunked thin-instance decor with culling, bounded particle
  systems, runtime governor (resolution → bloom → particles → shadows → vegetation; memory guard), profiling overlay.

See **docs/M2-REPORT.md** for screenshots, before/after comparison, FPS/memory profile, exact changed files and the
real-device test list. See docs/INTEGRATION.md for platform integration.

---

## M1 baseline

## What is playable

| # | Feature | Where |
|---|---------|-------|
| 1 | Alien planet **Veyra-7**: 1.6 km heightfield terrain, craters, luminous lakes, ridged edge mountains, far backdrop range, boulders, flora, crystal deposits, fog/atmosphere, sun + ambient lighting, procedural sky (stars, galactic band, black hole with accretion disk, ringed gas giant) | `src/world/` |
| 2 | Third-person astronaut: walk, sprint, jump, jetpack (fuel), limb animation, terrain + boulder collision, can stand on rocks | `src/player/` |
| 3 | Keyboard/mouse (pointer lock, right-drag fallback, arrow-key look) and touch (floating joystick, look drag, context buttons) | `src/input/input.ts` |
| 4 | Scanner pulse (tags deposits for 35 s, discovers points of interest) | `core/game.ts → scan()` |
| 5 | Mining laser with energy drain/regen, heat, overheat lockout, beam + sparks; touch aim-assist | `gameplay/miningLaser.ts`, `effects.ts` |
| 6 | Persistent inventory (4 resources, capacity limits) + inventory panel | `gameplay/inventory.ts`, `ui/hud.ts` |
| 7 | Starter ship **Wayfarer**: enter/exit, retracting skids, engine flames | `vehicles/` |
| 8 | Arcade flight: throttle, boost, yaw/pitch, vertical thrusters, banking, terrain-impact damage, landing checks (altitude, speed, slope, liquid), takeoff | `vehicles/shipPhysics.ts` |
| 9 | Orbital station **Halcyon Dock** (rotating ring, docking pad), docking autopilot, terminal with 7 upgrade lines | `world/station.ts`, `gameplay/upgrades.ts` |
| 10 | Intro mission "First Light": launch → land → step out → scan → mine 40 Lumenite + 30 Ferrite → take off → dock → deliver | `gameplay/mission.ts` |
| 11 | Quality presets Low/Medium/High + Auto, DPR cap, adaptive resolution, pause when hidden, context-loss handling | `core/quality.ts` |
| 12 | Versioned save/load (local, memory, remote adapters), migration, autosave; backend client for server-verified mission completion | `persistence/`, `integration/` |

Also: points of interest with lore + one-time caches, deposit regrowth (15 min), compass, mission waypoints, scan markers, settings panel.

## Build & run

```bash
npm install
npm run dev            # http://localhost:5173 (esbuild watch + serve)
npm run build          # dist/lib (ESM module) + dist/preview/index.html (single file) + dist/types
npm test               # unit tests (node:test via tsx)
npm run build:preview && npm run test:browser   # M1 Playwright smoke test (plays the full mission), unchanged
npm run test:m2                                  # M2 suite: landscape, touch, presets, context loss, parity, profiling
npm run compare -- <m1-preview.html>             # before/after renders
node scripts/m2-smoke-timing.cjs <m1-preview.html>  # frames / game time behind the smoke test's wall-clock checks
```

Preview URL flags: `?quality=basic|enhanced|ultra` (or M1's `low|medium|high`), `?touch=1` (force touch UI), `?start=new|continue`, `?debug=1` (test helpers on `window.__GF` — never ship enabled).

`dist/preview/index.html` is fully self-contained (≈2.9 MB, ≈680 KB gzipped) and works from `file://`. `dist/preview/embed.html` is the same game without the document skeleton, for hosts that wrap pages themselves.

## Controls

**Desktop:** WASD move · mouse look (click to lock) · hold LMB mine · F scan · Space jump/hold jetpack · Shift sprint · E interact (board/exit/land/dock/terminal) · Tab inventory · Esc settings.
**Ship:** W/S throttle · mouse or A/D steer · arrows pitch/yaw · Space up · C/Ctrl down · Shift boost · E land/dock.
**Touch:** left thumb = floating joystick, right side = look; buttons Mine / Jump(jet) / Scan / Sprint / Use; in the ship a throttle slider (Thr± kept), Up / Down / Boost / Use. In landscape the buttons sit in a thumb arc on the right.

## Platform rules honoured

- Gameplay resources (Ferrite, Carbon, Lumenite, Void Quartz) are separate from Orbit Coins. The client has no coin
  fields, amounts or rates anywhere (a test asserts this).
- Mission completion sends a `MissionCompletionReport` with a **server-issued run id** and telemetry as evidence.
  The server decides any reward; the client only displays the server's message.
- No economic rates or token distributions are defined. `decide_reward()` in the FastAPI reference is deliberately empty of amounts.
- Branding: the UI reads colours/fonts/names from `Theme`. The defaults are placeholder "galaxy / black hole" tokens.
  **Swap in OrbitBtc's approved tokens** via `mountGalacticFrontier(el, { theme: {...} })`. I did not have the approved brand files.

See `docs/INTEGRATION.md` for the React, FastAPI, Telegram and Android WebView integration points.

## Testing status (honest)

### M2 (this milestone)

| Environment | Status |
|---|---|
| Unit tests (21 from M1 unchanged + 16 new) | ✅ 37/37 pass |
| M1 browser smoke test, script unchanged, against the M2 build | ⚠️ 24/25 — **unresolved, timing-sensitive**: "walking moves player" moved 3.0 m (needs > 3 m) because 1500 ms of wall-clock time is only 1–4 software-rendered frames. Not counted as passed. Frame-exact walking and sprint movement is identical to M1 (docs/M2-REPORT.md §3) |
| Gameplay parity: M1 vs M2 Basic / Enhanced / Ultra, identical scripted inputs | ✅ identical flight path, walking (8.006 m / 1.5 s), sprint (14.056 m / 1.5 s), jetpack, mining yield, heat and energy |
| M2 browser suite (`npm run test:m2`): PC 16:9 and 21:9, Android (Pixel 7 emulation), Telegram (mocked WebApp API), rotation, touch joystick/camera/buttons/throttle, live preset switching, context loss, save/reload, M1 save compatibility | ✅ 47/47 (all on the final build) |
| Real Android phone, Android WebView app, Telegram (any client), iOS | ❌ **not tested** — see docs/REAL-DEVICE-TESTS.md |
| Real GPU frame rates (incl. the 30 fps Android Ultra target) | ❌ **not measured** — software-WebGL profiles only (docs/M2-REPORT.md §4) |

### M1

| Environment | Status |
|---|---|
| Unit tests (21) | ✅ pass |
| Headless Chromium, desktop 1280×720, software WebGL2 (SwiftShader) — full mission played with real keyboard/mouse input | ✅ 25/25 checks on Low |
| Same test on High | ⚠️ launch, flight, landing, walking, scan, laser lock-on pass; the run then times out because software rendering of 2048 shadows + glow runs at ~1 fps on the 2-core test machine. No errors were thrown. |
| Live quality switch (Medium → Low) from Settings | ✅ world rebuilds, save resumes, old WebGL context disposed |
| Chromium with Pixel 7 **emulation** (touch events, viewport) | ✅ touch launch, land, exit, joystick, aim-assist mining |
| Real Android phone / Android WebView | ❌ **not tested** |
| Telegram Mini App (iOS/Android/Desktop) | ❌ **not tested** |
| Safari / iOS / Firefox | ❌ **not tested** |
| Real GPU frame rates | ❌ **not measured** — SwiftShader numbers (7–28 fps) are CPU rendering and say nothing about phones |

The smoke test uses debug teleports to skip long flights, and tops up samples after verifying that real mining works.

## Known limitations / next milestones

- The planet is a 1.6 km flat patch with soft boundaries, not a seamless sphere. "Orbit" is a high-altitude station.
- No audio yet; one biome. Terrain is chunked with LOD (M2) but not streamed.
- The ship can't take damage from rocks or the station body beyond a simple sphere.
- HUD panels avoid `backdrop-filter`: blurring over a live WebGL canvas cost ~2 s per frame in testing and is a known mobile GPU drain.
- Server-side anti-cheat is plausibility-only (timing, quotas). It is not proof of play; treat rewards accordingly.
- Built here against Babylon.js 9.33.2 compiled from its official GitHub source, because the npm registry was not reachable from my build machine.
  `npm install` resolves the same version from npm normally.

## M8 — one universe, two visual experiences
See [docs/M8-REPORT.md](docs/M8-REPORT.md): shared gameplay core, Telegram *Lite* package (`npm run build:telegram`), Android/desktop *Full* package with performance-governed cinematic space, cross-platform progression protocol, parity tests (`npm run test:parity`).

## Android Full hero assets
Authored GLB/PBR pipeline (loader, skeleton retargeting, fallbacks, APK packaging): [docs/ASSET-PIPELINE.md](docs/ASSET-PIPELINE.md). Candidate models and licences: [docs/ASSET-RESEARCH.md](docs/ASSET-RESEARCH.md). Visual acceptance standard: [docs/VISUAL-STANDARD.md](docs/VISUAL-STANDARD.md).
