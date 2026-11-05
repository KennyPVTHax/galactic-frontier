# Spherical planet architecture (Checkpoint 2)

Status: prototype on Aetherion only. Nothing here claims seven planets exist.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Surface | **Cube-sphere**, equal-angle mapping (`tan(u·π/4)`), 6 faces, **quadtree per face**, 32×32-quad patches | Uniform patch shapes, trivial neighbour lookup, no pole singularity (unlike lat/long), standard for streamed planets |
| Seams | Every patch samples the **same analytic function of the unit direction** on a grid whose edge points are computed identically from the cube point → equal-level neighbours share bit-identical edge vertices and normals (normals use an extended 1-ring sample). LOD steps are hidden by **skirts** | Cracks are impossible by construction at equal level; skirts cover T-junctions. Tested numerically (`PlanetMathTests`) |
| Height source | `PlanetField.Height(dir)`: authored/TS terrain inside the *anchor region*, global procedural noise outside, smooth blend between | Keeps every gameplay coordinate valid while removing the artificial mountain wall |
| Gameplay coordinates | **Azimuthal-equidistant projection around an anchor direction** `A`. Old flat `(x,z)` metres ↔ great-circle offset: `dist = √(x²+z²)`, bearing from local east/north at `A`. Radial distances are exact; tangential distortion ≈ `1 − (d/R)²/6` (0.1 % at 800 m on R = 10 km) | POIs, deposits, mission targets, heightfield goldens keep their meaning. Migration is a pure function (`AnchorFrame`) and is unit-tested against the TypeScript heights |
| Radius | **R = 10 000 m** (game scale, circumference 62.8 km ≈ 2.8 h at walking speed, minutes by ship) | Real globe behaviour, still circumnavigable |
| Precision | Float vertex positions are stored **relative to the patch centre**; world coordinates stay < 10.3 km where float resolution is ≈ 1 mm, so **no floating-origin shifting is needed at this radius**. Gameplay math (`Vec3d`) is double. A re-centring hook is reserved for larger worlds | Avoids the complexity until it is actually needed |
| Gravity / frames | Radial gravity; `up = normalize(p − centre)`; movement in the tangent plane; the camera keeps a **parallel-transported forward vector** (no gimbal at poles) | Correct across face edges, corners and poles |
| LOD | Distance-based quadtree split (`dist < size·2.2` split, `> size·2.6` merge → hysteresis), max level 9 (≈ 0.96 m vertex spacing) | No load/unload oscillation at boundaries |
| Streaming | Leaf set diffed every 0.1 s; patch meshes built with a per-frame budget (heights evaluated with `Parallel.For`); unused patch meshes are **destroyed** (`Mesh` released), not disabled | Real memory release; debug counters shown |
| Underground (future) | Reserved: voxel/volumetric chunks keyed by `(face, level, ix, iy, layer)` with the same direction function and local gravity. Not implemented | Heightfields cannot represent tunnels |
| Online determinism | World = `(seed, rulesVersion, authoredOverrides)`; all noise is integer-seeded and double-precision; `PlanetMathTests` pin golden values | Same layout on every client |

## Known limitations of the first prototype
* Grass, rock scatter and astronaut are not yet ported to the sphere (grass cells need `(face, level, ix, iy)` addressing — next step).
* Sun follows the player (always day); day/night and planet rotation come later.
* Skirts, not geomorphing; a pop is possible when a patch splits.
* Only Aetherion is defined. Slot 7 is intentionally empty.
