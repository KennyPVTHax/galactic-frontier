using System;
using System.Collections.Generic;
using GF.Authoring;
using UnityEngine;
using UnityEngine.Rendering;

namespace GF.Planet
{
    /// <summary>
    /// Streams the planet surface: a quadtree per cube face, split by distance to the viewer with hysteresis. Patches build
    /// with a per-frame budget; an old patch is only released once every leaf that replaces it exists (no holes). Released
    /// patches have their Mesh and GameObject destroyed, so memory really goes down. The surface is always a pure function of
    /// (procedural field + authored edits), so a patch that streams out and back in is rebuilt identically.
    /// Works in Play mode (Update) and in the editor preview (Tick called from the World Editor).
    /// </summary>
    public sealed class PlanetQuadtree : MonoBehaviour
    {
        public double Radius;
        public IPlanetField Field;
        public IPaintSource Paint;
        public Material Mat;
        public Transform Viewer;
        public int MaxLevel = 9, Quads = 32, BuildsPerFrame = 2;
        public float SplitFactor = 2.2f, MergeFactor = 2.6f, UpdateInterval = 0.1f;
        public HideFlags ObjectFlags = HideFlags.None;     // HideAndDontSave for the editor preview

        sealed class Patch { public GameObject go; public Mesh mesh; public float[] radii; public int verts, tris; public Vec3d centerDir; public double half; }

        readonly HashSet<PatchId> split = new HashSet<PatchId>();
        readonly Dictionary<PatchId, Patch> active = new Dictionary<PatchId, Patch>();
        readonly List<PatchId> desired = new List<PatchId>();
        readonly HashSet<PatchId> desiredSet = new HashSet<PatchId>();
        readonly HashSet<PatchId> dirty = new HashSet<PatchId>();
        float timer;
        public int ActiveCount => active.Count;
        public int DesiredCount => desired.Count;
        public int QueuedCount { get; private set; }
        public int DirtyCount => dirty.Count;
        public int TotalBuilt { get; private set; }
        public int TotalReleased { get; private set; }
        public int TotalRebuilt { get; private set; }
        public long Triangles { get; private set; }
        public long MeshBytes { get; private set; }
        public int[] LevelHistogram = new int[16];
        public float LastBuildMs { get; private set; }
        public float MaxBuildMs { get; private set; }          // worst single synchronous build batch (the streaming hitch metric)

        public IEnumerable<PatchId> ActiveIds => active.Keys;

        static void Kill(UnityEngine.Object o) { if (o == null) return; if (Application.isPlaying) Destroy(o); else DestroyImmediate(o); }

        void Update() { if (Application.isPlaying && Viewer != null) Tick(Viewer.position, Time.deltaTime); }

        public void Tick(Vector3 viewerPos, float dt)
        {
            if (Field == null) return;
            timer -= dt;
            if (timer <= 0) { timer = UpdateInterval; Reselect(viewerPos); }
            BuildQueued(BuildsPerFrame, viewerPos);
            RebuildDirty(BuildsPerFrame);
            ReleaseStale();
        }

        /// <summary>Synchronously build everything currently needed (used at start, after teleports and in tests).</summary>
        public void Prewarm(Vector3 viewerPos)
        {
            Reselect(viewerPos);
            BuildQueued(int.MaxValue, viewerPos);
            RebuildDirty(int.MaxValue);
            ReleaseStale();
        }

        public void Prewarm() { if (Viewer != null) Prewarm(Viewer.position); }

        /// <summary>Authored data changed around a place: rebuild every loaded patch that overlaps it (plus a seam margin).</summary>
        public void Invalidate(Vec3d dir, double radiusM)
        {
            foreach (var kv in active)
            {
                double ang = Math.Acos(Math.Max(-1, Math.Min(1, kv.Value.centerDir.Dot(dir)))) * Radius;
                if (ang <= radiusM + kv.Value.half * 1.8) dirty.Add(kv.Key);
            }
        }

        public void InvalidateAll() { foreach (var k in active.Keys) dirty.Add(k); }

        /// <summary>Drop everything (a full unload). The next Tick/Prewarm rebuilds from data alone.</summary>
        public void UnloadAll()
        {
            foreach (var p in active.Values) { Kill(p.mesh); Kill(p.go); }
            active.Clear(); split.Clear(); dirty.Clear(); desired.Clear(); desiredSet.Clear();
            Triangles = 0; MeshBytes = 0; Array.Clear(LevelHistogram, 0, LevelHistogram.Length);
        }

        static Vec3d V(Vector3 v) => new Vec3d(v.x, v.y, v.z);

        void Reselect(Vector3 viewerPos)
        {
            desired.Clear(); desiredSet.Clear();
            Vec3d viewer = V(viewerPos);
            for (int f = 0; f < CubeSphere.FaceCount; f++) Select(new PatchId(f, 0, 0, 0), viewer);
            foreach (var d in desired) desiredSet.Add(d);
            int q = 0; foreach (var d in desired) if (!active.ContainsKey(d)) q++;
            QueuedCount = q;
        }

        void Select(PatchId n, Vec3d viewer)
        {
            double size = Math.PI * 0.5 * Radius / (1 << n.level);
            Vec3d c = n.CenterDirection() * Radius;
            double dist = Math.Max(0, (viewer - c).Length - size * 0.7);
            double thr = (split.Contains(n) ? MergeFactor : SplitFactor) * size;
            if (n.level < MaxLevel && dist < thr)
            {
                split.Add(n);
                for (int i = 0; i < 4; i++) Select(n.Child(i), viewer);
            }
            else { split.Remove(n); desired.Add(n); }
        }

        void BuildQueued(int budget, Vector3 viewerPos)
        {
            if (QueuedCount == 0) return;
            Vec3d viewer = V(viewerPos);
            var todo = new List<PatchId>();
            foreach (var d in desired) if (!active.ContainsKey(d)) todo.Add(d);
            todo.Sort((a, b) => (a.CenterDirection() * Radius - viewer).Length.CompareTo((b.CenterDirection() * Radius - viewer).Length));
            var sw = System.Diagnostics.Stopwatch.StartNew();
            int built = 0;
            foreach (var id in todo)
            {
                if (built >= budget) break;
                active[id] = CreatePatch(id); TotalBuilt++; built++;
            }
            LastBuildMs = (float)sw.Elapsed.TotalMilliseconds; MaxBuildMs = Mathf.Max(MaxBuildMs, LastBuildMs);
            QueuedCount = Mathf.Max(0, todo.Count - built);
        }

        void RebuildDirty(int budget)
        {
            if (dirty.Count == 0) return;
            var list = new List<PatchId>(dirty); int n = 0;
            foreach (var id in list)
            {
                if (n >= budget) break;
                dirty.Remove(id);
                if (!active.TryGetValue(id, out var old)) continue;
                var fresh = CreatePatch(id);
                Account(old, -1); Kill(old.mesh); Kill(old.go);
                active[id] = fresh; TotalRebuilt++; n++;
            }
        }

        void Account(Patch p, int sign)
        {
            Triangles += sign * p.tris; MeshBytes += sign * (p.verts * 24L + p.tris * 6L);
        }

        Patch CreatePatch(PatchId id)
        {
            var data = PatchMesher.Build(id, Radius, Field, Quads, true, Paint);
            int vc = data.Pos.Length / 3;
            var verts = new Vector3[vc]; var norms = new Vector3[vc];
            Vector3 mn = new Vector3(float.MaxValue, float.MaxValue, float.MaxValue), mx = -mn;
            for (int i = 0; i < vc; i++)
            {
                var p = new Vector3(data.Pos[i * 3], data.Pos[i * 3 + 1], data.Pos[i * 3 + 2]);
                verts[i] = p; norms[i] = new Vector3(data.Nrm[i * 3], data.Nrm[i * 3 + 1], data.Nrm[i * 3 + 2]);
                mn = Vector3.Min(mn, p); mx = Vector3.Max(mx, p);
            }
            var mesh = new Mesh { name = "patch_" + id, hideFlags = ObjectFlags };
            mesh.indexFormat = vc > 65000 ? IndexFormat.UInt32 : IndexFormat.UInt16;
            mesh.SetVertices(verts); mesh.SetNormals(norms);
            if (data.Col != null)
            {
                var cols = new Color32[vc]; var uv = new Vector2[vc];
                for (int i = 0; i < vc; i++) { cols[i] = new Color32(data.Col[i * 4], data.Col[i * 4 + 1], data.Col[i * 4 + 2], data.Col[i * 4 + 3]); uv[i] = new Vector2(data.Ovr[i], 0); }
                mesh.SetColors(cols); mesh.SetUVs(0, uv);
            }
            mesh.SetTriangles(data.Tris, 0, false);
            mesh.bounds = new Bounds((mn + mx) * 0.5f, (mx - mn) + Vector3.one * 4f);
            mesh.UploadMeshData(true);

            var go = new GameObject("P_" + id) { hideFlags = ObjectFlags };
            go.transform.SetParent(transform, false);
            go.transform.position = new Vector3((float)data.Center.x, (float)data.Center.y, (float)data.Center.z);
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var mr = go.AddComponent<MeshRenderer>();
            mr.sharedMaterial = Mat;
            mr.shadowCastingMode = id.level >= MaxLevel - 3 ? ShadowCastingMode.On : ShadowCastingMode.Off;

            int side = Quads + 1; var radii = new float[side * side];
            for (int k = 0; k < radii.Length; k++)
            {
                double x = data.Center.x + data.Pos[k * 3], y = data.Center.y + data.Pos[k * 3 + 1], z = data.Center.z + data.Pos[k * 3 + 2];
                radii[k] = (float)Math.Sqrt(x * x + y * y + z * z);
            }
            var patch = new Patch { go = go, mesh = mesh, radii = radii, verts = vc, tris = data.Tris.Length / 3, centerDir = id.CenterDirection(), half = data.HalfSize };
            Account(patch, +1); LevelHistogram[Mathf.Min(15, id.level)]++;
            return patch;
        }

        static bool Overlaps(PatchId a, PatchId b)
        {
            if (a.face != b.face) return false;
            if (a.level <= b.level) { int s = b.level - a.level; return (b.ix >> s) == a.ix && (b.iy >> s) == a.iy; }
            else { int s = a.level - b.level; return (a.ix >> s) == b.ix && (a.iy >> s) == b.iy; }
        }

        readonly List<PatchId> stale = new List<PatchId>();
        void ReleaseStale()
        {
            stale.Clear();
            foreach (var kv in active) if (!desiredSet.Contains(kv.Key)) stale.Add(kv.Key);
            foreach (var p in stale)
            {
                bool covered = true;
                foreach (var d in desired) if (Overlaps(p, d) && !active.ContainsKey(d)) { covered = false; break; }
                if (!covered) continue;
                var patch = active[p];
                Account(patch, -1); LevelHistogram[Mathf.Min(15, p.level)]--;
                Kill(patch.mesh); Kill(patch.go);
                active.Remove(p); dirty.Remove(p); TotalReleased++;
            }
        }

        /// <summary>Radius of the *rendered* surface under a direction (bilinear over the patch grid), or NaN if not streamed in.</summary>
        public double SampleMeshRadius(Vec3d dir)
        {
            CubeSphere.FromDirection(dir, out int face, out double u, out double v);
            for (int level = MaxLevel; level >= 0; level--)
            {
                int n = 1 << level;
                int ix = Math.Min(n - 1, Math.Max(0, (int)Math.Floor((u + 1) * 0.5 * n)));
                int iy = Math.Min(n - 1, Math.Max(0, (int)Math.Floor((v + 1) * 0.5 * n)));
                var id = new PatchId(face, level, ix, iy);
                if (!active.TryGetValue(id, out var patch)) continue;
                var (u0, u1, v0, v1) = id.Range();
                double fu = (u - u0) / (u1 - u0) * Quads, fv = (v - v0) / (v1 - v0) * Quads;
                int i = Math.Min(Quads - 1, Math.Max(0, (int)fu)), j = Math.Min(Quads - 1, Math.Max(0, (int)fv));
                double tu = fu - i, tv = fv - j; int side = Quads + 1;
                double r00 = patch.radii[j * side + i], r10 = patch.radii[j * side + i + 1], r01 = patch.radii[(j + 1) * side + i], r11 = patch.radii[(j + 1) * side + i + 1];
                return (r00 * (1 - tu) + r10 * tu) * (1 - tv) + (r01 * (1 - tu) + r11 * tu) * tv;
            }
            return double.NaN;
        }

        /// <summary>Patch outlines for the editor's "show patch boundaries" overlay: 4 world-space corners per patch, plus level.</summary>
        public void GetOutlines(List<(Vector3[] corners, int level)> into)
        {
            foreach (var id in active.Keys)
            {
                var (u0, u1, v0, v1) = id.Range();
                var cs = new Vector3[4];
                double[] us = { u0, u1, u1, u0 }, vs = { v0, v0, v1, v1 };
                for (int k = 0; k < 4; k++)
                {
                    Vec3d d = CubeSphere.Direction(id.face, us[k], vs[k]);
                    double r = Radius + Field.Height(d) + 0.3;
                    cs[k] = new Vector3((float)(d.x * r), (float)(d.y * r), (float)(d.z * r));
                }
                into.Add((cs, id.level));
            }
        }

        void OnDestroy() { foreach (var p in active.Values) Kill(p.mesh); }
    }
}
