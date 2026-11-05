# Premium Android Overhaul — Phase 0 report (workstation, audit, engine recommendation)

Date: 2026-11-06 · Branch: `premium/android-overhaul` · Baseline tag: `baseline/babylon-2c5f274` (local, not pushed)

> **Status of claims.** Everything in §1–§3 was read from the machine, the repository or the GitHub API today.
> Everything in §4–§6 about Unity / Unreal / Babylon on Android is **my engineering assessment, not a measurement**.
> No engine has been installed or benchmarked on this PC yet and no Android device has been used. The recommendation
> is therefore a *hypothesis to be confirmed by a proof of concept* (§5), as the directive requires.

## 1. Development PC (measured)

| Item | Value |
|---|---|
| OS | Windows 11 Pro 10.0.26200 |
| CPU | AMD Ryzen 7 7700X3D, 8 cores / 16 threads |
| GPU | AMD Radeon RX 9070 XT (+ integrated Radeon) |
| RAM | **15.1 GB** — adequate for Unity + Android Studio; tight for Unreal Engine 5 editor + Android cooking |
| Disk | C: 469 GB free of ~930 GB — enough for Unity (~25 GB with Android module) *and* Unreal (~100 GB) |
| Already present | Git 2.56, Node, Python 3.11, .NET, winget, Epic Games Launcher (Cyberpunk 2077 and a second Epic game installed — untouched) |
| Missing at start | JDK, Android SDK/NDK/adb, Android Studio, Blender, GitHub CLI, Unity Hub |
| Installed in this session (winget, official IDs) | GitHub CLI, Temurin JDK 17, Blender, Android Studio, Unity Hub — see §7 for results |

## 2. Repository state (verified)

* Remote: `KennyPVTHax/galactic-frontier`. Heads: `main` (`dfaf2f5`, M2 import), `baseline/m2-source-2026-11-05` (same), `claude/galactic-frontier-m2-m6-jaqnfn`.
* **Actual development HEAD: `2c5f274`** ("hero-asset test tolerates slow CI runners"), one commit after the tnnv integration `05c8495`.
  Cloned to `C:\Users\user\dev\galactic-frontier`.
* Draft PR #1 (open): "M7 + M8 + Android Full …".
* CI (GitHub API): `6ab179a` and `7f46e22` green; `05c8495` **failed** (hero-asset test timing on slow runners); the fix commit `2c5f274`
  had its workflow runs *still in progress* when last queried, so **I cannot yet say HEAD is green**. Re-check before relying on it.
* Size: ~22,900 lines of TypeScript in `src/` (86 files), 18 test files, 13 Android wrapper files, one 22.7 MB asset (tnnv GLB).
* **Preserved:** local lightweight tag `baseline/babylon-2c5f274`; all work happens on `premium/android-overhaul`. Nothing has been pushed.

## 3. Audit — what exists and what is reusable

Architecture (from `docs/M8-REPORT.md`, confirmed by file layout): a **shared gameplay core** enforced by `tests/architecture.test.ts`
and a golden **rules fingerprint** (`src/shared/rules.ts`, `tests/golden/rules-fingerprint.json`), plus presentation layers.

| System | Where | Engine-independent? | Port strategy if the engine changes |
|---|---|---|---|
| Rules manifest (resources, upgrades, missions, contracts, progression, hazards, enemies, weapons, planets, farming) | `src/shared/rules.ts`, `src/gameplay/*`, `src/universe/*` | Yes (pure TS, no Babylon/DOM) | Export to canonical JSON once; engine loads it as data. Fingerprint becomes a cross-language conformance check |
| Combat simulation | `src/combat/{ai,combatSystem,enemyTypes,encounters,weapons,damage,…}` | Mostly (renderer/HUD files are not) | Port sim to C#; golden-trace tests (same seed → same events) |
| Ship physics | `src/vehicles/shipPhysics.ts` | Yes | Port with trace tests |
| Heightfield / world generation | `src/world/heightfield.ts`, `src/core/random.ts` | Yes — **deterministic, defines where deposits/POIs/mission targets are** | Port bit-for-bit (seeded RNG); verify by sampling heights/positions against TS output. This is what keeps resources, POIs and saves valid |
| Save system v4 + migrations, sync protocol/ledger | `src/persistence/saveSystem.ts`, `src/sync/*` | Yes | Port migrations; fixture saves from every version as tests |
| Player controller | `src/player/player.ts` (143 lines) | Mostly | Re-implement against engine physics; keep numeric constants identical |
| Rendering, materials, sky, weather, FX, HUD, touch UI | `src/graphics`, `src/world/{planet,sky,weather,space,station}`, `src/ui`, `src/input` | **No** (Babylon/DOM) | Replace — this is the part the overhaul wants to change anyway |
| Astronaut presentation | `src/presentation/full/*` | No | Replace (see §3.1) |

Existing tests that carry over as *specifications*: gameplay, combat, farming, systems, universe, sync, rules-fingerprint (≈127 tests).

### 3.1 Findings relevant to the astronaut complaint (from the code and `docs/ASTRONAUT-TNNV.md`, not yet from footage)

* The GLB has **no animation clips**; all motion is *procedural pose solving* (`gait.ts`, `rigDriver.ts`) driving a 70-joint skeleton. That is the root cause of "unnatural" arms: hand-authored sine-style swing cannot match mocap.
* The author's own notes list as **not done**: finger/grip animation, **twist bones not driven**, no tool prop, no authored clips, **no foot planting**.
* The right arm hangs under an IK chain (`upperarm_ik_r → lowerarm_ik_r`), which the retarget copies pose onto — a likely source of right/left asymmetry.
* The jetpack flame is **two cones** placed on the backpack — the "solid triangular flame" the owner dislikes.
* Texture memory for the suit is ≈140 MB uncompressed (author's estimate): too heavy for mid-range phones without KTX2/ASTC.

Conclusion: the fix is *authored clips + a state machine + IK for feet/hands + soft-particle exhaust*, not tweaking the current solver. This is engine-agnostic work and can start in Blender today (§6).

## 4. Engine assessment (assessment, not measurement)

| Criterion | Babylon.js (WebView) | **Unity 6 + URP** | Unreal Engine 5 |
|---|---|---|---|
| Reuse of working game | Highest — nothing to port | Gameplay core must be ported TS → C# (data-driven, testable) | Same port, plus C++/Blueprint workflow |
| Vegetation / wind | Possible with custom vertex shaders + thin instances; no GPU-driven culling/indirect draw → ceiling on density | GPU instancing / `Graphics.RenderMeshIndirect`, Shader Graph wind, URP terrain details | Best-in-class foliage, but Nanite/Lumen don't run on Android; mobile renderer is a reduced subset |
| Character animation | Hand-rolled; glTF clips possible but no Animator/IK stack | Animator + Animation Rigging (two-bone/foot IK), Mixamo/Blender retarget are routine | Strong (Control Rig), heaviest |
| Terrain & PBR | Custom; texture memory/GC limits in WebView | Terrain + splat layers, ASTC/ETC2, Addressables | Landscape strong; mobile cost high |
| Android memory / thermals | WebView JS heap + WebGL; flagship-only for premium content | Native, IL2CPP arm64, profiler on-device | Native, but large baseline |
| Package size | Small runtime | ≈ 30–50 MB runtime (to be measured); content downloadable via Addressables | Typically larger base APK (to be measured) |
| Native embedding in OrbitBTC | Already a WebView | *Unity as a Library* exists but is single-instance and awkward; **companion APK is simpler** | No supported equivalent; companion APK only |
| Free assets & tooling fit | glTF only | Largest free ecosystem (Poly Haven/ambientCG/Mixamo/Sketchfab all import cleanly); Fab assets must be checked per-license | Fab assets are native, but many are engine-restricted |
| This PC | Fine | Fine (15 GB RAM OK) | Marginal: UE5 editor + Android cook is comfortable at 32 GB |
| Licence cost | $0 | Personal tier free for eligible users (**confirm eligibility/revenue limits at install**) | Free until royalty threshold (confirm current terms) |

### Recommendation (hypothesis)

**Unity 6 (LTS) with URP for the premium Android game**, keeping Babylon.js as the frozen baseline and as the Telegram/Lite and web-preview build.

Why not stay on Babylon: the owner's goals (living grass fields, mocap-quality animation with IK, high-quality PBR terrain, sustained 60 FPS on a thermally limited phone) are
exactly where a WebView ceiling is lowest, and the existing 140 MB astronaut-texture problem shows the memory pressure already. Why not Unreal: Android feature set is a subset of what makes
UE5 attractive, base package and iteration cost are larger, this 15 GB workstation is below comfortable, and there is no supported embedding path.

**Risk that could overturn this:** porting the gameplay core is real work (≈ 23 k TS lines, of which perhaps a third is engine-independent sim). The mitigation is that the rules manifest, the deterministic
world generator and the golden tests make the port *verifiable* rather than a rewrite on trust.

## 5. Proof-of-concept gate (before any irreversible migration)

Separate branch `premium/unity-poc` (Babylon stays untouched). Pass/fail criteria, measured **on the owner's iQOO 13**, not in emulators:

1. Unity project builds a signed arm64 APK from this PC; size recorded.
2. One Aetherion patch: terrain with ≥ 3 PBR layers, ≥ 100 k wind-animated grass blades with gust field, rock set, sun + shadows.
3. tnnv astronaut with **real clips** (idle/walk/run/jump/fall/land/jet), foot IK; jetpack as soft-particle exhaust.
4. Player + deterministic heightfield port: sampled heights and deposit positions match the TS output within 1e-4.
5. Frame-time capture (`?perf`-equivalent): sustained FPS, 1 % lows, memory and 10-minute thermal behaviour recorded.
6. Equivalent Babylon scene improved with the same assets, as the fair comparison (time-boxed).

Decision recorded in `docs/premium/ENGINE-DECISION.md` with the numbers. If Unity fails criterion 5, fall back to the upgraded-Babylon path.

## 6. Work that is engine-independent and can start now

* **Animation:** author/retarget the clip set (Mixamo or Blender-authored) on the tnnv skeleton in Blender; bake to GLB/FBX; record in the asset ledger.
* **Textures:** convert suit textures to KTX2/ASTC variants; pick PBR terrain sets from Poly Haven / ambientCG (CC0).
* **Asset ledger:** `docs/premium/ASSET-LEDGER.md` (created, seeded with the one existing external asset).

## 7. Distribution architecture (design recommendation)

**Approach B — separate, signed companion APK**, launched from an "Install / Play" card in OrbitBTC. Rationale: keeps the OrbitBTC download small (optional install, as required), avoids Unity-as-a-Library lifecycle constraints, and the game gets its own update channel.

* OrbitBTC downloads over HTTPS to app-private storage → checks **SHA-256 against a signed manifest** (Ed25519 manifest signature, key pinned in OrbitBTC) → hands the APK to Android's `PackageInstaller` with the **standard user confirmation**. No silent install.
* Before launching, OrbitBTC verifies the installed package's **signing certificate** matches the pinned one.
* Game content beyond the APK (Addressables bundles) is versioned and hashed in the same manifest; resume/retry via HTTP range requests; rollback by keeping the previous bundle set.
* Saves: companion app owns the save file; OrbitBTC reads status through a signature-protected bound service/ContentProvider. Save compatibility is the existing v4 schema + migrations.
* **To verify before building:** Google's *developer verification* requirements for sideloaded apps on certified Android devices (announced for 2026 rollout) and any impact on independently distributed, installer-initiated APKs. I have not checked current status.
* Prototype will live in an isolated test host app; the production OrbitBTC repo/backend is not touched (directive §14).

## 8. What I need from the owner

1. **Sign in to Unity Hub** (Personal licence) when the Hub opens, and tell me when done; I will then install Unity 6 LTS + Android Build Support from the Hub. I will not handle your credentials.
2. Confirm I may **push** `premium/android-overhaul` and the baseline tag to GitHub (nothing has been pushed).
3. Optionally: gameplay footage of the astronaut problems, and confirmation of your Fab/Epic library items to evaluate.
4. Connect the iQOO 13 with USB debugging when the first APK exists.
