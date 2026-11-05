# Integration guide

The game is a self-contained module. It exposes one function and a few adapters. Nothing in the OrbitBtc production apps
needs to change until you choose to integrate.

```
┌──────────── OrbitBtc React app ────────────┐        ┌────── OrbitBtc FastAPI ──────┐
│ <GalacticFrontierView/>                     │        │ /galactic-frontier/...       │
│   mountGalacticFrontier(el, {               │  HTTPS │  POST missions/start         │
│     backend: HttpBackendClient ─────────────┼───────▶│  POST missions/complete      │
│     saveAdapter: RemoteSaveAdapter          │        │  GET/PUT saves/{slot}        │
│     theme, onEvent })                       │        │  decide_reward()  ← OrbitBtc │
└─────────────────────────────────────────────┘        └──────────────────────────────┘
```

## 1. Mounting (React)

```ts
import { mountGalacticFrontier } from "@orbitbtc/galactic-frontier";
const handle = await mountGalacticFrontier(containerEl, { backend, saveAdapter, theme, onEvent });
// on unmount:
await handle.save(); handle.dispose();
```

A full component is in `integration-examples/GalacticFrontierView.tsx`. The container must have a size; the game fills it
(`position:fixed; inset:0` is typical). `dispose()` releases WebGL, DOM, listeners and pointer lock.

### Options

| Option | Purpose |
|---|---|
| `backend` | `BackendClient`. Default `OfflineBackend` (no network, no rewards). Use `HttpBackendClient` in production. |
| `saveAdapter` | `LocalStorageSaveAdapter` (default), `RemoteSaveAdapter(backend)`, `MemorySaveAdapter`, or your own. |
| `saveSlot` | Separate save per user if several users share a device. |
| `quality` | Force `low/medium/high`; otherwise Auto + the player's setting. |
| `theme` | Brand tokens (`brandName`, colours, `fontFamily`). |
| `onEvent` | `ready`, `missionStep`, `missionComplete`, `saved`, `contextLost`, `error` for analytics/UI. |
| `autoStart` | `"new"` / `"continue"` to skip the title screen. |

## 2. Backend contract

Reference implementation: `integration-examples/fastapi_galactic_frontier.py` (standalone, not wired in).

1. **Start**: `POST /galactic-frontier/missions/start {missionId}` → `{runId}`. The server records `issued_at` and the user.
2. **Complete**: `POST /galactic-frontier/missions/complete` with `MissionCompletionReport`:
   `missionId, runId, idempotencyKey (=runId), clientStartedAt, clientCompletedAt, stepCompletedAt, telemetry{distanceOnFootM, distanceFlownM, scans, collected{...}}, clientVersion`.
   Response: `{status: "accepted" | "pending_review" | "rejected", message}`. The game shows `message` verbatim.
3. Retries: a report that failed to send is retried on the next session. The server must answer duplicates idempotently.

Server-side checks in the reference: run belongs to user, single use, elapsed time on the **server clock**, required samples
and a scan present. Client telemetry is evidence, never authority.

**Rewards.** `decide_reward()` is intentionally empty of amounts. OrbitBtc decides whether a completed expedition earns
anything, how much, and through which ledger. Nothing in the client grants or displays a coin amount of its own.

**Auth headers.** `HttpBackendClient({ baseUrl, getAuthHeaders })`. On the website, return `{ Authorization: "Bearer …" }`.
In Telegram, return `{ "X-Telegram-Init-Data": Telegram.WebApp.initData }` and validate it server-side (HMAC, reference included).
Never embed the bot token or secrets in the client.

## 3. Saves

`SaveData` is versioned (`SAVE_VERSION = 2`) and passes through `migrateSave()`, which validates every field, clamps
numbers, drops unknown keys and upgrades v1 data. A save made mid-flight resumes docked. Treat cloud saves as untrusted
player state. Never derive balances from them.

## 4. Graphics tiers and devices (M2)

One shared scene, three rendering profiles (`src/graphics/profiles.ts`):

| Tier | Platform default for | Key features |
|---|---|---|
| Telegram Basic | Telegram Mini App | Standard materials, vertex-colour terrain + grain, no shadows, no post-processing, 35% decor, DPR ≤ 1.25, 85% render scale |
| PC Enhanced | Desktop, iOS browsers | PBR + sky reflection probe, splat-textured terrain with normal detail, aerial perspective, 2048 shadow map, ACES tone mapping + grading, FXAA, bloom, clouds, grass, water waves |
| Android Ultra | Android app / browser | Enhanced + triplanar rock, cascaded shadows (3 × 1024), MSAA ×2 + sharpen, 1024 textures, full vegetation, longer LOD ranges |

- **Effective tier** = player's device setting, else the platform default limited by GPU capability
  (`capabilityCeiling`: WebGL2, texture size, renderer string, memory, cores). A player can pick any tier on any
  device; capable desktops can run Ultra.
- Graphics preferences are **device-local** (`orbitbtc.galacticFrontier.device` in localStorage), not part of the shared save.
  A Telegram phone on Basic never pushes Basic onto the same account's PC.
- `QualityGovernor` protects a frame-rate floor: render resolution first, then bloom → particles → shadows → vegetation;
  a memory-pressure step halves textures. Sustained frame-rate loss after warm-up (how thermal throttling shows up) uses the same path.
- Tier changes apply live (no reload, game state untouched).

## 5. Landscape per platform (M2)

`src/platform/platform.ts` (`OrientationController`), called from the tap that starts the game:

| Platform | What happens |
|---|---|
| Telegram (Bot API 8.0+) | `requestFullscreen()`, `disableVerticalSwipes()`; `lockOrientation()` once the device is in landscape (Telegram locks the *current* orientation, it cannot rotate the device). Older clients: `expand()` + rotate prompt. Insets = `safeAreaInset` + `contentSafeAreaInset`. |
| Android app | Separate game Activity, `sensorLandscape`, immersive, cutout-aware. JS bridge `window.OrbitBtcGame` + `window.__gfSetInsets(...)`. See `integration-examples/android/`. |
| Mobile browsers | Fullscreen API + `screen.orientation.lock("landscape")` (Android Chrome). iOS Safari cannot lock: rotate prompt. |
| Desktop | Widescreen layouts; on ultrawide the HUD stays inside a central ≈2.25:1 frame. Field of view is Hor+ (wider screens see more). |

Rotation never reloads the game. Portrait remains playable after "Play in portrait".

## 6. Telegram Mini App (not yet tested on a device)

- Load `https://telegram.org/js/telegram-web-app.js` in the host page. The game feature-detects `Telegram.WebApp`
  (platform ≠ "unknown") and does the fullscreen / swipe / orientation calls itself on the start tap.
- Fullscreen and `lockOrientation` need Bot API 8.0+ clients. On older clients the game falls back to `expand()` and a rotate prompt.
- Pass `Telegram.WebApp.initData` as `X-Telegram-Init-Data` and validate it server-side (HMAC, reference included).
  Never embed the bot token in the client.
- Telegram haptics (`HapticFeedback`) are used for touch buttons and the throttle slider.

## 7. Android WebView (not yet tested on a device)

- Use the reference game Activity in `integration-examples/android/` (separate screen, landscape, immersive, cutout insets,
  gesture-exclusion for the joystick, `configChanges` so rotation never reloads the WebView).
- `javaScriptEnabled` and `domStorageEnabled` are required (saves and device preferences).
- WebGL availability and performance depend on the device GPU driver and WebView version.

## 8. Performance safeguards

- Per tier: DPR cap (1.25 / 1.75 / 2), render scale, texture size (256 / 512 / 1024), shadow mode, post-processing, decor
  density and cull distance, prop / terrain LOD distances, particle budgets (all particle systems have fixed capacities).
- Terrain is 64 chunks with two LODs (full / half resolution, skirts hide cracks), each frustum-culled.
- Rocks and deposits are instanced with a far LOD and a cull distance; decor is chunked thin instances with per-chunk
  culling (one draw call per visible chunk).
- `QualityGovernor` (see §4) lowers resolution, then effects. Frame delta is clamped. Rendering stops while hidden.
  Context loss is recovered by Babylon; procedural textures are canvas-backed so they re-upload.
- No full-screen blur in the HUD (`backdrop-filter` removed in M1). Bloom is half-resolution and is the first effect the governor drops.
- Textures are generated at runtime, so there is nothing to ship in KTX2/ASTC yet. If authored assets replace the procedural
  ones, ship them compressed (KTX2 + Basis) and keep the same per-tier sizes.

## 9. Unified backend across platforms

Every platform uses the same `BackendClient` contract (unchanged since M1): same account (Bearer token or Telegram initData,
validated server-side), the same server-issued mission run ids, the same `MissionCompletionReport`, the same saves through
`RemoteSaveAdapter`. Graphics tiers do not change any gameplay number. A browser test plays identical inputs through M1 and every
M2 tier and requires identical flight path, jetpack height, mining yield, heat and energy.

## 10. Module map

```
src/index.ts                public API (mountGalacticFrontier + adapters)
src/core/game.ts            orchestrator: modes, loop, interactions, HUD binding, save, debug hooks
src/core/quality.ts         M1 presets (kept for compatibility), theme tokens
src/graphics/profiles.ts    M2 tiers, platform defaults, capability ceiling, per-feature fallbacks
src/graphics/governor.ts    runtime frame-rate / memory governor
src/graphics/renderer.ts    applies a profile live: post pipeline, shadows, env probe, resolution, stats
src/graphics/materials.ts   material library (Standard ⇄ PBR), world shader plugin (splat, triplanar, aerial perspective, wind)
src/graphics/texgen.ts      tileable procedural textures (ground, normals, water, hull panels, fabric)
src/platform/platform.ts    platform detection, GPU probe, landscape/fullscreen, safe areas, haptics
src/persistence/devicePrefs.ts  device-local graphics preferences
src/core/worldConfig.ts     planet/station/site layout
src/world/                  heightfield (pure), planet (terrain, props, deposits, POIs), sky shader, station
src/player/                 astronaut model, controller, camera rig
src/vehicles/               ship physics (pure), ship model
src/gameplay/               resources, inventory, mining laser, upgrades, mission (all pure), effects
src/persistence/            save schema, migration, adapters
src/integration/backend.ts  BackendClient, OfflineBackend, HttpBackendClient, report builder
src/ui/                     DOM HUD + CSS
tests/                      unit tests;  scripts/smoke-test.cjs  browser playthrough
```

## 11. Game ↔ OrbitBtc interface, version 1.1 (M3–M6)

The game stays a separately maintained module. M3–M6 change **nothing** on the OrbitBtc platform: no new endpoints are
required, and the M1 `BackendClient` contract (v1.0) is still the only server surface. Version 1.1 only adds client-side,
informational events and save fields.

| Surface | v1.0 (M1/M2) | v1.1 (M3–M6) | Server action required |
|---|---|---|---|
| `BackendClient.startMission` / `submitMissionCompletion` | First Light only | unchanged — frontier contracts are **not** submitted | none |
| `MissionCompletionReport` | unchanged | unchanged | none |
| Save blob (`SaveData`) | schema v2 | schema v3: `universe`, `progression`, `contracts` added; v1/v2 migrate on load | treat as opaque, untrusted player state |
| `onEvent` | ready, missionStep, missionComplete, saved, contextLost, error | + `warp {from, to}`, `contractComplete {id}` | optional analytics only |

Rules that still hold:

- Contract rewards, combat loot and pilot XP are **virtual gameplay values** stored in the player's save. They are not
  Orbit Coins, carry no exchange rate and are never sent as a reward claim. Unit tests assert that contract data, loot and
  new saves contain no coin fields.
- If OrbitBtc later wants server-verified contracts, add a `submitContractCompletion` method to `BackendClient` behind a new
  interface version (v2.0) and keep v1.1 clients working; do not reuse `submitMissionCompletion`.
- `RemoteSaveAdapter` still stores the whole save blob; servers must never derive balances from it.
