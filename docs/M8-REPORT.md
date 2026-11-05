# M8 — One universe, two visual experiences

Branch `claude/galactic-frontier-m2-m6-jaqnfn`, on top of M7 (`410c5aa` was the last CI-verified commit before the M8 packaging work).
Nothing here touches the OrbitBTC app, its backend, any production service or `main`. No backend was deployed; no balances, wallets,
Orbit Coins or payments exist anywhere in this code.

> **No real Android or Telegram device was available in this environment.** Every number below was measured in headless Chromium with a
> software rasteriser (SwiftShader). They compare builds with each other on one machine; none of them is a frame rate for any phone.
> The owner's report of 60 FPS for the M7 APK on an iQOO 13 is theirs and is not verified here.

## 1. Result in one table

| Requirement | State | Evidence |
|---|---|---|
| M7 CI regression resolved first | **Done** — it was a test-budget problem, not a game bug | CI run on `410c5aa`: all 7 jobs green incl. "Contract E2E (station defense + escort)" |
| Shared gameplay core vs presentation | **Done, enforced** | `tests/architecture.test.ts` (import allow-list, banned globals/APIs in core, golden rules fingerprint) |
| Same rules in both packages | **Done, tested on the real bundles** | `scripts/parity-test.cjs`: 17/17 (fingerprint, 41 KB rules manifest byte-identical, stats, farming, inventory, saves) |
| Telegram "Lite" package | **Done, modest** — smaller bundle, locked to the Basic profile, no heavy features compiled in | §3: 21.8 % smaller; same runtime scene cost as Full-at-Basic (see §3.2) |
| Android "Full" cinematic upgrade | **Partly done** — cinematic deep space + a measured-performance controller. Astronaut, vegetation, PBR terrain, weather, ship FX and warp were **not** reworked in M8 | §4 |
| Cross-platform progression | **Designed, implemented as shared reducer + offline ledger + test-only reference server; no real backend** | §5, `docs/CROSS-PLATFORM-PROGRESSION.md` |
| Farming | **Done** — Orbital Harvesters, shared rules, save v4 | `tests/farming.test.ts` (9) |
| Separate Lite / Full benchmarks | **Done, software-rendered only** | §6, `docs/bench-m8-packages.json` |

## 2. Architecture

```
            ┌────────────────────────── shared gameplay core (identical in every package) ──────────────────────────┐
            │ gameplay/*  combat sim (combatSystem, enemyTypes, encounters, weapons)  universe  heightfield          │
            │ shipPhysics  persistence/saveSystem (v4)  sync/*  shared/rules (manifest + fingerprint)  farming       │
            └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
                         ▲                                                              ▲
   LITE (Telegram Mini App)                                          FULL (Android app, desktop, preview)
   src/engine/babylon.lite.ts  — facade without PBR, post pipeline,   src/engine/babylon.ts — everything
     shadow generators, reflection probes, RTT, colour curves          src/presentation/full/* — cinematic deep space +
   render profile locked to `basic`                                       its performance controller
   src/presentation/cinematic.lite.ts — no-op                          graphics tiers basic / enhanced / ultra
```

* **One rules definition.** `src/shared/rules.ts` builds a canonical manifest of every gameplay rule (resources, upgrades, missions, contracts,
  progression, hazards, mining, enemies, encounters, weapons, planets, farming, world config, save version) and hashes it into
  `rulesFingerprint()`. Presentation data (colours, textures, shaders) is deliberately excluded. Any rules change changes the fingerprint
  and fails `tests/golden/rules-fingerprint.json` until the golden file is regenerated on purpose.
* **Boundary test.** `tests/architecture.test.ts` fails if a shared-core module imports Babylon, the DOM, rendering or UI code, uses
  `Math.random`/`Date.now`/`window`, or if the allow-list drifts. It already caught one real leak (`saveSystem` importing `core/quality`).
* **A real bug found by the parity test.** Node and Chromium disagreed by **one ulp** on a trig-derived planet value, so the
  fingerprint differed between environments — every client would have reported `rules-mismatch`. The same difference can occur between
  V8 (Android WebView) and JavaScriptCore (Telegram on iOS). `canonicalJson` now rounds non-integers to 9 decimals; the golden value was
  regenerated (an algorithm change, not a rules change). The sync server has not shipped, so nothing in the field is affected.
* **Build.** `node scripts/build.mjs telegram` → `dist/telegram/index.html` (Lite, test hooks compiled out, strict CSP);
  `release` / `android` → Full. `telegram-test` is Lite *with* test hooks, used only by CI to drive the real Lite code.
  Babylon's WGSL shader copies (~420 KB, unused: the game only creates a WebGL engine) are stripped from **all** packages.

## 3. Telegram Lite

### 3.1 What it is
The Lite bundle is built from the same game code with a different engine facade. `PBRMaterial`, `DefaultRenderingPipeline`, both shadow generators,
`ReflectionProbe`, `RenderTargetTexture`, `PostProcess`, `ColorCurves` and the spherical-harmonics classes are replaced by stubs that throw if
constructed, so neither their code nor their shaders ship. The Lite package resolves every graphics setting to the `basic` profile
(`LITE_TIER_CEILING`); the Settings screen lists only that preset. `tests/package-boundary.test.ts` builds both real bundles and checks the
module list in the esbuild metafile.

| Bundle (minified JS inlined in one HTML file) | Size |
|---|---|
| Before M8 preview build | 3,133 KB |
| Full (`release`, WGSL stripped) | 2,718 KB |
| **Lite (`telegram`)** | **2,126 KB** (−21.8 % vs Full) |

Lite journey (the 14 required steps, real keyboard/mouse/UI input, teleport and aim assists as declared in the script) on the real Lite bundle: **15/15**.

### 3.2 What it is not (honest)
* The residual 2.1 MB is mostly Babylon's core (materials, meshes, engine, particles). Going materially lower would mean replacing Babylon, which is out of scope.
* Lite's *runtime* scene is the existing Basic profile and costs the same as Full-at-Basic: **83 draw calls, 80 k triangles, 4 MB textures in both**
  (§6). I did not write a separate low-poly terrain or compact Telegram UI in M8; the Basic profile already uses 256 px textures, 35 % decor, no grass,
  no shadows/post and the compact HUD. So Lite's gain today is download/parse size, memory that never allocates for features it cannot use, and a hard
  guarantee that heavy rendering cannot be enabled. Further Lite-only work (stylised flat-shaded terrain, a Lite ship/sky, compact CSS) is still open.
* The Telegram Mini App wrapper itself (initData, `WebApp` API, safe areas in Telegram) is not part of this repo; Lite runs in any browser.

## 4. Android Full — cinematic deep space, governed by measurement

Added (Full only, `src/presentation/full/`): a procedural sky-dome shader with a **galaxy band and dust lanes, two-tint nebulae, gas clouds and three
distant lit planets with atmosphere rims**, original and generated in code (no downloaded assets, nothing licensed). It is visible when the ship is high
above a planet, fades with altitude, and reads nothing from gameplay.

* **Independently scalable:** level 0 (off, zero cost) … 3. One shader program serves every level (octaves/features are uniforms), so changing level never recompiles a shader.
* **Never assumed:** `CinematicController` (pure, 8 unit tests) starts at 0 and records a level-0 baseline; it raises one level only after a clean measured
  window (≤ 1 % missed frames, p99 within 1.25 × the frame period, ≥ 8 s after a 3 s settle), then **verifies** the new level and rolls it back on missed
  frames; a level that is rolled back twice is blocked for the session. It never promotes on software renderers, with any adaptive-quality reduction active,
  at thermal status ≥ MODERATE, or above the tier ceiling (Basic 0, Enhanced 1, Ultra 2, 3 only on an identified flagship GPU), and drops immediately at SEVERE.
  A device that never has a clean window never leaves level 0.
* **Why miss-rate, not headroom:** with vsync a GPU that is 40 % idle and one that is 1 % idle both show 16.7 ms frames at 60 Hz, so frame time cannot reveal
  headroom; try-then-verify-and-roll-back is the honest design. The perf recorder report now includes the controller's level, baseline and change log.
* **Overrides:** `?cinematic=off` or `?cinematic=0..3` pins a level (tests, screenshots).
* **Measured:** screenshots at each level (software rendering) show the effect and that Lite is unaffected. I could **not** measure the GPU cost of level 1–3: the benchmark flight
  stays below the altitude where the dome is visible, and the software rasteriser says nothing about a phone's GPU. The numbers in §6 for "cinematic=0 vs 3" are therefore
  *not* a cost measurement. The controller exists because that cost is unknown until it is measured on the device; the first thing to do on the iQOO 13 is a recorded flight above the
  station with `?perf=1` at levels 0 and 3.
* **Visual quality caveat:** the first cut is nebula-heavy; the galaxy band is subtle from the starting orbit. It needs an art pass on a real display.

Not done in M8 (the brief lists them for the Full experience): upgraded astronaut model/animation, realistic alien vegetation, PBR terrain materials (rock/sand/snow/lava/ice/water),
upgraded ship/combat effects, volumetric-looking weather and the cinematic warp tunnel. Existing M3–M7 Extreme HD features are unchanged.
Per the brief these should only be raised after the sustained-FPS / 1 %-low / thermal measurements from a real device exist; the controller and the recorder are the means to get them.

## 5. Cross-platform progression

Design and HTTP contract for the backend team: `docs/CROSS-PLATFORM-PROGRESSION.md`. Summary:

* `src/sync/protocol.ts` — one pure reducer. Clients send **actions** (accept/complete contract, buy upgrade, build/claim harvester, mining report), never outcomes;
  a reward amount does not exist in the event schema. Rewards, costs and prerequisites come from the shared rules.
* Idempotent event ids, per-device sequence + hash chain (gaps, reorders, tampering rejected), rules-fingerprint check (a mismatch is rejected, never re-priced),
  **server-clock** farming (the client clock is ignored), plausibility caps on mining, bounded applied-id table.
* `src/sync/ledger.ts` — offline outbox that re-chains after a rejection or a rebase on the server snapshot. Reference in-memory server lives under `tests/support/` only.
* Reuses save v4 and the migration chain. Farming output is the same four in-game resources as mining; it cannot be exchanged for anything.
* **Not done:** no real server, no authentication, no UI wiring of the ledger into gameplay hooks — all require an approved backend, which was out of scope (and the OrbitBTC backend must not be modified).

## 6. Benchmarks (software rendering only)

Headless Chromium + SwiftShader, 12 s flight, one run each, same machine, run alone (`docs/bench-m8-packages.json`; raw logs in `scripts/benchmark.cjs` format).

| Run | Package | Load | Avg FPS | 1 % low | p95 frame | Heap peak | Draw calls | Triangles | Textures |
|---|---|---|---|---|---|---|---|---|---|
| telegram-lite | Lite | 1.76 s | 4.19 | 2.0 | 283 ms | 90.7 MB | 83 | 80 k | 4 MB |
| telegram-basic | Full @ Basic | 1.47 s | 4.39 | 2.7 | 283 ms | 72.2 MB | 83 | 80 k | 4 MB |
| android-extreme-hd (cinematic 0) | Full @ Ultra | 3.80 s | 0.71 | 0.59 | 1683 ms | 99.2 MB | 163 | 389 k | 104 MB |
| android-extreme-hd (cinematic 3) | Full @ Ultra | 3.61 s | 0.75 | 0.62 | 1617 ms | 99.4 MB | 163 | 392 k | 104 MB |

Reading it honestly: Lite and Full-at-Basic are indistinguishable at runtime within the noise of a single software-rendered run (the heap figure differs by 18 MB the
"wrong" way for Lite, which I attribute to GC timing in single samples, not a real regression, but I have not proven that). The cinematic rows differ only by noise because the dome is not
visible in that flight. **Nothing in this table predicts a real device.** Transitions: 12 planet swaps per run, 0 errors, 0 unready materials; the leak guard is `npm run test:leaks`.

## 7. Tests run on this commit range

* `npm test` — 115/115 (rules/architecture/golden, farming 9, sync 14, package boundary 6, cinematic controller 8, plus M2–M7 suites).
* `scripts/parity-test.cjs` — 17/17 on the real Full and Lite bundles.
* Journey 15/15 on **Lite/basic** and on **Full/ultra** (software rendering; ultra needed the test fix below).
* Test fix: the journey's scan step slept a fixed 0.5 s after pressing F; on a < 1 fps tier that can elapse before one frame runs, so Full/ultra failed that step twice (14/15) before the
  step was changed to wait (bounded) for the game's response. It then passed with 45 tagged. I attribute the two failures to that sleep; the game code path was not changed.
* CI (`.github/workflows/m7-build.yml`) gained: Lite artifact `galactic-frontier-telegram-lite` and job "Lite journey + Lite/Full parity".
* Regression on the final code: M1 browser smoke **25/25**, M2 suite **46/46** (software rendering).

## 8. Known gaps / next steps

1. Run the APK on the iQOO 13 with `?perf=1`/the recorder at cinematic levels 0 and 3 and return the JSON (sustained FPS, 1 % low, frame times, thermal) before any more GPU load is added.
2. Lite-only visual work: flat-shaded stylised terrain, a Lite ship/sky, compact Telegram CSS; measure Lite on a mid-range Android phone inside Telegram.
3. The rest of the Full visual list (astronaut, vegetation, PBR terrain, weather, ship/combat FX, warp) — gated on (1).
4. Approved backend for the sync protocol; wire `SyncLedger` into the gameplay hooks.
5. Journey loot (`lumenite 47` on Lite vs `48` on Full in the journey logs) differs by one unit although XP and the contract reward are identical; I did not trace it
   (it may be scan/deposit timing in the test, not a rule). The parity test, which uses explicit inputs, is identical in both packages.
