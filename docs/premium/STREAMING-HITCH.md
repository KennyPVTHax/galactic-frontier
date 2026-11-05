# Streaming hitch: investigation and plan

Measured on this PC (RX 9070 XT) with `scripts/premium/run-planet.ps1` — 250 m/s fly-over, 6 km, 24 s.
All numbers below come from `docs/premium/screens/planet_tests.json` (`flyover`).

## What the numbers say
| Metric | Value | Reading |
|---|---|---|
| Average frame | 4.2 ms | fine |
| p99 frame | 13.6 ms | patch building shows up here |
| **Worst frame** | **104 ms, at t = 0.05 s** | the *first* frame after the teleport: a cold start (first draw of freshly loaded shaders/meshes), not steady-state streaming. In steady state the worst frames are the 13–20 ms p99 band |
| Synchronous build batches | up to 1,268 ms | these are `Prewarm()` calls (initial load of ~650 patches). Intentional, but they must never happen mid-play |
| **GC collections during the run** | **1,323 in 24 s (one per ~4 frames)** | the real steady-state cost. Every patch build allocates ~300 KB of managed arrays |
| Patches built / released | 6,303 / 6,300 | memory is returned (mesh 54 MB peak → 30 MB) |

## Root causes
1. `PatchMesher.Build` allocates new `Vec3d[]`, `float[]`, `List<int>` and then `Vector3[]` copies per patch (~1,200 vertices): gen-0/1/2 GC churn on the main thread.
2. The whole build (height field, normals, mesh arrays) runs on the main thread inside `Update` (`Parallel.For` only parallelises the height loop, the caller still blocks).
3. The index buffer is rebuilt per patch although it is identical for every patch with the same quad count (only the winding flag differs).
4. Cold start: shaders for newly visible materials/LODs compile on first use.

## Plan (in order; each step is independently measurable)
1. **Static index buffers** (2 cached arrays: normal and flipped winding) shared by all patches. −7,680 ints/patch of garbage.
2. **Pooled work buffers**: `Vec3d[] P/Dir/Nrm`, `float[] pos/nrm`, skirt data in a per-thread pool (`ArrayPool<T>` or a fixed `PatchWorkspace`). Target: zero managed allocations per patch after warm-up.
3. **Job-based preparation, main-thread upload**: run `PatchMesher.Build` on worker threads (`Task.Run` / Unity Jobs + Burst for the noise) writing into pooled `float` buffers; the main thread only does `Mesh.SetVertexBufferData` (or `Mesh.AllocateWritableMeshData` → `ApplyAndDisposeWritableMeshData`) and creates the `GameObject`. Unity objects are only ever touched on the main thread. Add a result queue with a per-frame upload budget (e.g. 2 ms).
4. **Prioritised, cancellable requests**: request queue ordered by distance; cancel work for patches that left the desired set before upload.
5. **Warm-up**: `ShaderVariantCollection` + `Shader.WarmupAllShaders` (or a hidden warm-up camera pass) on the loading screen, so the first frame after a teleport does not compile shaders.
6. **Android budget**: cap triangles (LOD factors + 24-quad patches) and uploads/frame; thermal-aware cap.

## Acceptance targets (re-run the same fly-over)
* GC collections ≤ 50 per 24 s (from 1,323).
* p99 ≤ 8 ms, steady-state worst frame ≤ 16 ms on this PC; first-frame worst ≤ 33 ms with warm-up.
* No synchronous build > 4 ms during play.

Nothing here requires a rendering-engine rewrite. Step 1–2 are small and low risk; step 3 is the real fix.
