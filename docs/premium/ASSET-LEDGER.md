# Asset ledger

Every external asset used by the premium overhaul is recorded here **before** it is committed.
Rules: commercial use allowed; redistribution inside an APK allowed; engine restrictions checked (especially Fab/Epic); attribution text captured; modifications listed.

| Asset | Creator | Source URL | Licence | Attribution required | Version / date fetched | Modifications | Used in | Status |
|---|---|---|---|---|---|---|---|---|
| Spacesuit (Confederation of Planets) | tnnv | https://sketchfab.com/3d-models/spacesuit-confederation-of-planets-da7b5c14bc634f8283e2d21343afa7cc (author: https://sketchfab.com/tnnv) | CC BY 4.0 | Yes — in-game credits + `CREDITS.md` | 2026-11-05 (SHA-256 `b7f82d87…ce7bcf31`) | None to the file; runtime posing only. Planned: animation clips, KTX2 texture variants | Astronaut | Integrated (Babylon); animation not approved |

## Candidate sources (to be evaluated, nothing downloaded yet)

| Source | Typical licence | Check before use |
|---|---|---|
| Poly Haven | CC0 | None (attribution optional) |
| ambientCG | CC0 | None |
| Adobe Mixamo | Royalty-free incl. commercial use, Adobe terms | Confirm terms for redistribution of animation data inside a shipped game; account sign-in by owner |
| Sketchfab | Per-model CC licence | Per-model; reject NC / ND / unclear |
| Fab / Epic library | Per-listing: some "standard" (engine-restricted to Unreal), some usable in any engine | Read each listing's licence; do not assume Unreal-only content may be used in Unity |

## Added 2026-11-06 (premium Unity slice)

| Asset | Creator | Source | Licence | Notes |
|---|---|---|---|---|
| Universal Animation Library [Standard] (clips: Idle, Walk, Jog, Sprint, Jump start/loop/land, Interact, Pistol aim, Idle torch) | Quaternius | https://opengameart.org/content/universal-animation-library | CC0 1.0 | Zip SHA-256 `18FF1A72…A3AC2`. Retargeted onto the tnnv skeleton in Blender (`scripts/premium/blender/retarget_astronaut.py`); raw files not committed (`unity/SourceAssets/`) |
| Universal Animation Library 2 [Standard] (clips: TreeChopping_Loop → Mine, NinjaJump_Idle, Chest_Open) | Quaternius | https://opengameart.org/content/universal-animation-library-2 | CC0 1.0 | Zip SHA-256 `EC0E40D6…1A9217` |
| Poly Haven rocks: boulder_01, rock_07, namaqualand_boulder_02/03/05, namaqualand_cliff_01 | Poly Haven artists (see `_provenance.json`) | https://polyhaven.com | CC0 1.0 | 1k textures; fetched + MD5-verified by `scripts/premium/fetch-polyhaven.mjs`; decimated to 3 LODs in Blender |
| Poly Haven ground textures: forest_ground_04, brown_mud_leaves_01, aerial_rocks_02, dry_ground_rocks | Poly Haven artists | https://polyhaven.com | CC0 1.0 | Same pipeline |
