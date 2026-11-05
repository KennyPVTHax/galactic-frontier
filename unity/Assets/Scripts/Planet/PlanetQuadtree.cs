using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace GF.Planet
{
    /// <summary>
    /// Streams the planet surface: a quadtree per cube face, split by distance to the viewer with hysteresis
    /// (split at 2.2x patch size, merge at 2.6x). Patches build with a per-frame budget; an old patch is only
    /// released once every leaf that replaces it exists (no holes). Released patches have their Mesh and
    /// GameObject destroyed, so memory really goes down.
    /// </summary>
    public sealed class PlanetQuadtree : MonoBehaviour
    {
        public double Radius;
        public IPlanetField Field;
        public Material Mat;
        public Transform Viewer;
        public int MaxLevel = 9, Quads = 32, BuildsPerFrame = 2;
        public float SplitFactor = 2.2f, MergeFactor = 2.6f, UpdateInterval = 0.1f;

        sealed class Patch { public GameObject go; public Mesh mesh; public float[] radii; public int verts, tris; }

        readonly HashSet<PatchId> split = new HashSet<PatchId>();
        readonly Dictionary<PatchId, Patch> active = new Dictionary<PatchId, Patch>();
        readonly List<PatchId> desired = new List<PatchId>();
        readonly HashSet<PatchId> desiredSet = new HashSet<PatchId>();
        float timer;
        public int ActiveCount => active.Count;
        public int DesiredCount => desired.Count;
        public int QueuedCount { get; private set; }
        public int TotalBuilt { get; private set; }
        public int TotalReleased { get; private set; }
        public long Triangles { get; private set; }
        public long MeshBytes { get; private set; }
        public int[] LevelHistogram = new int[16];
        public float LastBuildMs { get; private set; }

        void Update()
        {
            if (Viewer == null || Field == null) return;
            timer -= Time.deltaTime;
            if (timer <= 0) { timer = UpdateInterval; Reselect(); }
            BuildQueued(BuildsPerFrame);
            ReleaseStale();
        }

        /// <summary>Synchronously build everything currently needed (used at start and for tests).</summary>
        public void Prewarm()
        {
            Reselect();
            BuildQueued(int.MaxValue);
            ReleaseStale();
        }

        static Vec3d V(Vector3 v) => new Vec3d(v.x, v.y, v.z);

        void Reselect()
        {
            desired.Clear(); desiredSet.Clear();
            Vec3d viewer = V(Viewer.position);
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

        void BuildQueued(int budget)
        {
            if (QueuedCount == 0) return;
            Vec3d viewer = V(Viewer.position);
            var todo = new List<PatchId>();
            foreach (var d in desired) if (!active.ContainsKey(d)) todo.Add(d);
            todo.Sort((a, b) => (a.CenterDirection() * Radius - viewer).Length.CompareTo((b.CenterDirection() * Radius - viewer).Length));
            var sw = System.Diagnostics.Stopwatch.StartNew();
            int built = 0;
            foreach (var id in todo)
            {
                if (built >= budget) break;
                CreatePatch(id); built++;
            }
            LastBuildMs = (float)sw.Elapsed.TotalMilliseconds;
            QueuedCount = Mathf.Max(0, todo.Count - built);
        }

        void CreatePatch(PatchId id)
        {
            var data = PatchMesher.Build(id, Radius, Field, Quads, true);
            int vc = data.Pos.Length / 3;
            var verts = new Vector3[vc]; var norms = new Vector3[vc];
            Vector3 mn = new Vector3(float.MaxValue, float.MaxValue, float.MaxValue), mx = -mn;
            for (int i = 0; i < vc; i++)
            {
                var p = new Vector3(data.Pos[i * 3], data.Pos[i * 3 + 1], data.Pos[i * 3 + 2]);
                verts[i] = p; norms[i] = new Vector3(data.Nrm[i * 3], data.Nrm[i * 3 + 1], data.Nrm[i * 3 + 2]);
                mn = Vector3.Min(mn, p); mx = Vector3.Max(mx, p);
            }
            var mesh = new Mesh { name = "patch_" + id };
            mesh.indexFormat = vc > 65000 ? IndexFormat.UInt32 : IndexFormat.UInt16;
            mesh.SetVertices(verts); mesh.SetNormals(norms); mesh.SetTriangles(data.Tris, 0, false);
            mesh.bounds = new Bounds((mn + mx) * 0.5f, (mx - mn) + Vector3.one * 4f);
            mesh.UploadMeshData(true);       // free the CPU copy: GPU memory only

            var go = new GameObject("P_" + id);
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
            active[id] = new Patch { go = go, mesh = mesh, radii = radii, verts = vc, tris = data.Tris.Length / 3 };
            TotalBuilt++;
            Triangles += data.Tris.Length / 3;
            MeshBytes += vc * (12 + 12) + data.Tris.Length * 2;
            LevelHistogram[Mathf.Min(15, id.level)]++;
        }

        static bool Overlaps(PatchId a, PatchId b)
        {
            if (a.face != b.face) return false;
            if (a.level <= b.level) { int s = b.level - a.level; return (b.ix >> s) == a.ix && (b.iy >> s) == a.iy; }
            else { int s = a.level - b.level; return (a.ix >> s) == b.ix && (a.iy >> s) == b.iy; }
        }

        List<PatchId> stale = new List<PatchId>();
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
                int vc = patch.verts; long tri = patch.tris;
                Triangles -= tri; MeshBytes -= vc * 24 + tri * 6; LevelHistogram[Mathf.Min(15, p.level)]--;
                Destroy(patch.mesh); Destroy(patch.go);
                active.Remove(p); TotalReleased++;
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

        void OnDestroy() { foreach (var p in active.Values) { if (p.mesh) Destroy(p.mesh); } }
    }
}
