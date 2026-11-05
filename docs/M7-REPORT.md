# M7 — Real-device readiness and gameplay polish

Branch `claude/galactic-frontier-m2-m6-jaqnfn`, on top of the verified M3–M6 state (`2fd3af6`).
M2 and the M3–M6 gameplay are unchanged except for the defects listed under "Bugs found". Nothing here touches the main
OrbitBTC app, any production service, or `main`.

> **No real Android phone was available.** Everything below was built and tested in the cloud (GitHub Actions + a container
> with software-rendered Chromium). The APK has been built and structurally verified but **never run on an Android runtime**.
> No frame rate in this document is a measurement of real hardware — see §6 and `docs/PHONE-TESTING.md`.

## 1. Android debug APK
- `android/` is a self-contained Gradle project (AGP 8.5.2, Gradle 8.9 wrapper, Kotlin, min SDK 24, target 34).
- A minimal WebView host (`MainActivity.kt`): the game is **bundled in the APK** and served from `https://appassets.androidplatform.net`
  by `WebViewAssetLoader`; every other request is answered with an empty 403; navigation away from the bundle is refused;
  `file://` and content access are off; mixed content is blocked. **No `INTERNET` permission** — the app cannot reach a server.
  Only `VIBRATE` is requested. Landscape-only, immersive, screen kept on, crash-recovery on WebView renderer loss.
- One JS bridge, `window.OrbitBtcGame` (the contract the game already feature-detected): haptics, landscape lock, exit, safe-area
  insets, plus `deviceInfo()`, `thermalStatus()`, `saveReport()`, `shareReport()` for the performance recorder.
- App id `com.orbitbtc.galacticfrontier.standalone.debug`: installs beside, never over, any real OrbitBTC app.
- Built **both** in this container (6.4 MB; verified with `aapt2`/`apksigner`: only `VIBRATE`, min 24/target 34, debug-signed,
  bundled game byte-identical to the release bundle, no test hooks) **and on GitHub Actions** (artifact `galactic-frontier-android-debug-apk`).
- Verified in a browser from the same `https` origin the WebView uses: only that host is contacted, saves persist across a reload, no CSP errors.

## 2. Release web preview
- `npm run build:release` → `dist/web/index.html` (one offline file). Built by CI as artifact `galactic-frontier-web-preview`.
- Test hooks (`window.__GF`, teleports, time scale, aim helpers, contract setup) moved to `src/core/debugHooks.ts` and are
  **compiled out** of release/Android bundles via a build-time `__GF_DEBUG__=false`. `tests/release-build.test.ts` fails the build if any
  hook string reappears, and checks the strict Content-Security-Policy (`default-src 'none'`, no network).
- Run in a browser under that CSP: no console/CSP errors, zero network requests, `window.__GF` undefined even with `?debug=1`.

## 3. Journey and contract end-to-end tests
All run in headless Chromium against the real game. Assists are declared in each script's header.

| Test | What it plays | Result |
|---|---|---|
| `scripts/journey-test.cjs` (14 required steps) | dock → map → warp → pirate → combat → reward → scan → dock → save/reload | see §3.1 |
| `scripts/contracts-e2e.cjs station` | "Hold the Dock": 3 waves (3 scouts; 2 interceptors + 2 scouts; raider + 3 hunters), station ally, dock for reward | **8/8** — 11 kills; shield low 45, hull never below max; station untouched |
| `scripts/contracts-e2e.cjs escort` | "Lantern Run": freighter + 4-ship ambush; forced freighter loss → reset; real win; dock | **6/6** — freighter ended at full 320 hull |
| `scripts/contracts-e2e.cjs boss` | "The Iron Choir": Threnody dreadnought on Noctaris | **9/9** — killed in 484 s, phases 1→2→3, all 8 hardpoints shot off, *Titanfall* unlocked, reward paid; **5 hull/shield top-ups (declared assist)** |

Assists, so nothing is overstated: test hooks install upgrade levels and mark prerequisite contracts done; `aimAtTarget()` points the
nose (mouse aiming at 1–5 fps is impractical); teleports skip the final approach to the dock; the escort failure is injected by
destroying the freighter through the combat system's own damage path; the **boss run tops up hull/shield when the hull is low**
because a browser pilot cannot evade like a human. Enemy AI, weapons, hits, shields, hardpoints, phases, drone launches,
contract progression, rewards, XP and saving are all the normal game code with real held-fire input.

### 3.1 Journey on all three graphics profiles
JOURNEY_TABLE

## 4. Gameplay bugs found by the new tests (all fixed)
1. **The dreadnought could not be beaten.** Its hardpoints (shield-generator spire, missile racks) sit *inside* its 30 m collision
   sphere, so every player bolt was absorbed by the body first: aimed at the generator, **963 hits landed on the hull, 7 on a turret and
   0 on the generator**, so the shield never dropped. Separately, armor 4 + 30 % resistance reduced 7–13-damage pulse hits to ~1–5.
   Fix: bolts collide with a 0.4× core sphere (`BOSS_CORE_FRACTION`), armor/resistance 2 / 0.2. Measured with a simulated pilot over 10 seeds:
   a fully upgraded pilot who shoots the spire first and evades wins 10/10 (median 368 game-seconds); body-only strafing wins 0/10;
   mid-level upgrades lose. Unit tests lock this in.
2. **An escort could be "won" with the freighter dead** if it died by any path other than a bolt hit; and a lost freighter left the old ambush
   alive while spawning a second. Now the contract fails if the freighter is dead when the ambush clears, and the old ambush is removed.
3. Journey step 7 polled a transient AI state; it flaked on GitHub's faster runner (the enemy went detect→pursue→attack between polls).
   It now reads the game's own bounded AI-transition log.

## 5. Noctaris readability (hostile mood kept)
Data-only: ambient/sun fill, palette, sky horizon, haze and fog lifted; acid lake changed from a neon emissive sheet to a murky toxic
green with a corroded-crust shoreline; combat HUD marks **every** on-screen hostile (not just the locked target) and only draws
off-screen arrows for ships that are hunting you. Measured on the 3D view (luma < 0.06 = crushed black): flight **98 % → 39 %**, acid marsh
**89 % → 46 %**, combat **75 % → 40 %**, no clipping. It is still a dark crimson world; the measurement is reproducible with
`scripts/noctaris-shots.cjs` + `scripts/lumstats.py` (screenshots are kept out of git).

## 6. Memory and resource leaks
Method: 5 laps through all six planets with a hostile spawned on each, forced GC at every Veyra-7 checkpoint, plus `WeakRef`s on everything a swap should free.
- Scene object counts (meshes, materials, textures, lights, particle systems, nodes, geometries, GPU textures, observers) were already
  **stable** after the first lap — the earlier "no leak" conclusion held for counts.
- **But the post-GC JS heap kept growing and old suns/sky meshes stayed reachable.** Heap-snapshot retaining paths showed disposed meshes kept
  alive by Babylon's compiled-shader cache that still listed the old sun in `_lightSources` (meshes were disposed *before* their lights).
  Fix: release shadows/lights first (`Renderer.releaseWorld`, `Planet.releaseLights`) and strip light/material references from disposed planet meshes.
- Result (Enhanced, MB after GC): before 71.8 → 78.0 → 81.2 → 84.1 → 85.2 → 86.2; after 71.8 → 76.2 → 78.2 → 79.5 → 79.5 → 79.9.
  Growth laps 3→5 fell from +2.0 to +0.4 MB; old planets, heightfields, suns, ambient lights, sky meshes, orbital environments, weather and enemies are all collected (0 of 30 retained).
- `npm run test:leaks` (CI job `leaks`) asserts steady object counts, < 3 MB heap growth from lap 3, and zero retained old objects. It **fails on the pre-fix commit** (old suns/ambient lights retained) — verified.

## 7. Real-device performance instrumentation
`src/core/perfRecorder.ts` + `src/ui/perfOverlay.ts` (Settings → *Performance stats*, or `?perf=1`, or `adb … --ez perf true`):
Record/Stop with a live FPS readout, then a report with **average FPS, 1 % low FPS, frame-time p50/p95/p99/max, % of frames > 16.7 / 33.3 ms,
JS heap (start/peak/end), resolution-scale min/avg/end, Android thermal status, 10-second windows** (to see throttling over time), the graphics
preset and why it was chosen, DPR, canvas size, GPU renderer string, WebView version, SoC/model/RAM/refresh rate (from the APK bridge) and the scene's
mesh/draw-call/triangle counts. Export: Copy JSON, Android share sheet, or save to the app's files folder.
The report marks itself `trustworthy: false` with explicit caveats when the renderer is software (SwiftShader/llvmpipe), when fewer than 600 frames
were recorded, or when the platform is not Android. **It never claims a performance level**; 8 unit tests cover the statistics.

## 8. Limitations
- APK never executed on Android; WebGL2 availability, WebView version behaviour, touch ergonomics and real performance are unverified.
- No real-device (or even GPU) frame rates exist for any tier.
- Boss E2E uses hull top-ups; the escort failure is injected; journeys use teleports/aim-assist (all declared).
- Extreme HD warp post-process and heat haze are still not implemented; no audio; debug-signed APK only; WebView debugging is enabled in the debug APK (by design, for `chrome://inspect`).
- CI journey on Enhanced/Extreme HD and the boss E2E run only on manual dispatch (`full_e2e`) because software rendering is slow.
