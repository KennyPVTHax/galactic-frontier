# Checkpoint 2 — spherical Aetherion prototype

**Scope claim:** one prototype planet (Aetherion, R = 10 km) built from connected terrain patches with radial gravity.
It is **not** seven planets and not yet a game level: no grass, rocks, missions or mining on the sphere yet.

## What was demonstrated (all measured on this PC, RX 9070 XT, D3D12, 1080p, Windows development player)

| Requirement | Result | Evidence |
|---|---|---|
| Continuous spherical surface, no cracks | 384 patches (all 6 cube faces, all 8 corners): **0 cracked border vertices of 49,152**; shared-edge heights agree to 4e-13 m; seam normals identical | `unity/Tools/PlanetMathTests` (`dotnet run -c Release`) |
| Gameplay coordinates preserved | Old flat `(x,z)` mapped to the sphere; heights equal the TypeScript game to **4e-10 m** over 200 goldens (r < 480 m) | same test |
| Radial gravity, local frames, movement across boundaries | 7 sprint walks (≈ 170–225 m each) across a face edge, two cube corners, both face-centre "poles", the authored region and the antipode: grounded 100 % of ticks; feet never more than **4.5 cm below the rendered mesh**; every walk streamed in (0 unstreamed samples) | `docs/premium/screens/planet_tests.json`, screenshots |
| Streaming + memory release | 250 m/s fly-over, 6 km: **6,441 patches built, 6,438 released**; mesh memory peak 55 MB → 30 MB after stopping; avg frame 3.4 ms (≈ 300 fps), p99 12.3 ms | `planet_tests.json` → `flyover` |
| Low-detail silhouette | Orbit view = 24 patches / 61 k triangles / 1 MB; surface view ≈ 690 patches / 1.7 M triangles | HUD in screenshots |
| Space ↔ surface | Sky/fog fade out between 0.5 and 5 km altitude into stars; sun terminator visible | `p3/10_globe_anchor.png`, `12_globe_corner.png` |

## Known limitations (honest list)
* One 97 ms frame hitch during the fly-over (patch generation is on the main thread with a per-frame budget); needs async/job-based building for Android.
* 1.7 M triangles at the surface is too heavy for phones; LOD factors and patch resolution need an Android profile.
* Not yet on the sphere: grass, rock scatter, colliders for rocks, mining, missions, weather, day/night rotation. Grass cells must be re-addressed by `(face, level, ix, iy)`.
* Terrain material uses triplanar blending (more texture samples than the flat shader); no mobile optimisation yet.
* Global geology is a first pass (gentle relief, ~45 % of the surface under the −4 m waterline would be sea in theory; visible seas are small). Biomes, climate bands and the owner's authored regions come in Checkpoints 3–4.
* Face-edge seams are crack-free by construction, but a visible LOD pop remains when patches split (skirts only, no geomorphing).
* `PatchMeshData` normals use a direction-only stencil; LOD borders between different levels can differ slightly in shading.
* Android APK: IL2CPP compile succeeded; Gradle failed on DNS (`dl.google.com`) — retry pending.
* SSAO feature disabled (it threw every frame when its resources were stripped).

## Reproduce
```
node scripts/premium/fetch-polyhaven.mjs          # CC0 textures/rocks
npx tsx scripts/premium/export-planet-data.ts     # canonical Aetherion data + goldens
dotnet run -c Release --project unity/Tools/PlanetMathTests
powershell scripts/premium/run-planet.ps1 -Name myrun   # builds scene + player, runs tests, writes screenshots + planet_tests.json
```
