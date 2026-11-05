using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using GF.Core;
using GF.Planet;
using UnityEngine;
using UnityEngine.Rendering;

namespace GF.Authoring
{
    /// <summary>
    /// Controlled grass on the sphere (validation sample, not the full vegetation system). The world is divided into fixed
    /// quadtree cells (face, level 10, ix, iy ~15 m). Each cell's blades are generated deterministically from the cell id,
    /// the planet seed, the procedural meadow mask and the OWNER'S vegetation paint/exclusion, then drawn GPU-instanced
    /// with the wind shader. Cells beyond the draw radius are released (GraphicsBuffer.Release).
    /// </summary>
    [ExecuteAlways]
    public sealed class SphereGrass : MonoBehaviour
    {
        public IPlanetField Field;
        public AuthoredWorld World;
        public double Radius;
        public Material Mat;
        public uint Seed = 7177;
        public int CellLevel = 10, MaxCellsPerTick = 2;
        public float DrawRadius = 75f, BladesPerSquareMetre = 12f;
        [Range(0f, 1f)] public float ProceduralCoverage = 0.35f;     // how much of the planet the procedural meadow mask fills
        public double WaterLevel = -4;
        public float MaxViewerAltitude = 30f;                 // no grass work while flying high (performance guard)
        public bool KeepPositions;                              // tests/editor: keep CPU copies of blade positions
        public readonly Dictionary<PatchId, List<Vector3>> Positions = new Dictionary<PatchId, List<Vector3>>();
        public Vector3 NoGrassCentre; public float NoGrassRadius = 0f;     // world position (optional pad)

        sealed class GCell { public PatchId id; public GraphicsBuffer buf; public int count; public Bounds bounds; public MaterialPropertyBlock mpb = new MaterialPropertyBlock(); public Vec3d dir; }

        readonly Dictionary<PatchId, GCell> cells = new Dictionary<PatchId, GCell>();
        readonly Plane[] frustum = new Plane[6];
        Mesh bladeMesh; Noise3D noise;
        static readonly int BladesId = Shader.PropertyToID("_Blades"), WidthScaleId = Shader.PropertyToID("_WidthScale");
        public int DrawnBlades { get; private set; }
        public int TotalBlades { get; private set; }
        public int LiveCells => cells.Count;
        public int CellsBuilt { get; private set; }
        public int CellsReleased { get; private set; }
        float cellSizeM;

        void OnEnable() { bladeMesh = BuildBladeMesh(); noise = new Noise3D(Seed); }
        void OnDisable() { ReleaseAll(); if (bladeMesh) { if (Application.isPlaying) Destroy(bladeMesh); else DestroyImmediate(bladeMesh); } }

        public void ReleaseAll() { foreach (var c in cells.Values) c.buf?.Release(); cells.Clear(); Positions.Clear(); }

        /// <summary>Blades within radius of a direction (needs KeepPositions).</summary>
        public int CountBlades(Vec3d dir, double radiusM)
        {
            int n = 0; Vec3d c = dir.Normalized;
            foreach (var l in Positions.Values)
                foreach (var p in l)
                {
                    Vec3d pd = new Vec3d(p.x, p.y, p.z).Normalized;
                    if (Math.Acos(Math.Max(-1, Math.Min(1, pd.Dot(c)))) * Radius <= radiusM) n++;
                }
            return n;
        }

        static Mesh BuildBladeMesh()
        {
            var v = new[] { new Vector3(-0.5f, 0, 0), new Vector3(0.5f, 0, 0), new Vector3(-0.5f, 0.33f, 0), new Vector3(0.5f, 0.33f, 0), new Vector3(-0.5f, 0.66f, 0), new Vector3(0.5f, 0.66f, 0), new Vector3(0, 1, 0) };
            var uv = new Vector2[v.Length]; for (int i = 0; i < v.Length; i++) uv[i] = new Vector2(v[i].x + 0.5f, v[i].y);
            var m = new Mesh { name = "grass_blade", hideFlags = HideFlags.HideAndDontSave };
            m.SetVertices(v); m.SetUVs(0, uv); m.SetTriangles(new[] { 0, 2, 1, 1, 2, 3, 2, 4, 3, 3, 4, 5, 4, 6, 5 }, 0);
            m.bounds = new Bounds(new Vector3(0, 0.5f, 0), new Vector3(2, 2, 2)); m.UploadMeshData(true);
            return m;
        }

        static float SS(float e0, float e1, float x) { float t = Mathf.Clamp01((x - e0) / (e1 - e0)); return t * t * (3f - 2f * t); }

        /// <summary>Authored vegetation changed here: regenerate the affected cells.</summary>
        public void Invalidate(Vec3d dir, double radiusM)
        {
            var drop = new List<PatchId>();
            foreach (var kv in cells)
                if (Math.Acos(Math.Max(-1, Math.Min(1, kv.Value.dir.Dot(dir)))) * Radius <= radiusM + cellSizeM * 1.2) drop.Add(kv.Key);
            foreach (var k in drop) { cells[k].buf?.Release(); cells.Remove(k); Positions.Remove(k); }
        }

        public void Tick(Vector3 viewer, Camera cam)
        {
            if (Field == null || World == null || Mat == null || bladeMesh == null) return;
            cellSizeM = (float)(Math.PI * 0.5 * Radius / (1 << CellLevel));
            Vec3d vd = new Vec3d(viewer.x, viewer.y, viewer.z).Normalized;
            if (viewer.magnitude - (Radius + Field.Height(vd)) > MaxViewerAltitude) { if (cells.Count > 0) ReleaseAll(); DrawnBlades = 0; TotalBlades = 0; return; }
            // gather wanted cells by sampling a tangent-plane grid around the viewer (works across cube-face edges)
            var want = new Dictionary<PatchId, float>();
            Vec3d t1 = vd.Cross(Math.Abs(vd.y) < 0.9 ? new Vec3d(0, 1, 0) : new Vec3d(1, 0, 0)).Normalized, t2 = vd.Cross(t1);
            int n = Mathf.CeilToInt(DrawRadius / (cellSizeM * 0.6f)) + 1;
            int n2 = n;
            for (int a = -n2; a <= n2; a++) for (int b = -n2; b <= n2; b++)
            {
                double ox = a * cellSizeM * 0.6, oz = b * cellSizeM * 0.6;
                double dist = Math.Sqrt(ox * ox + oz * oz); if (dist > DrawRadius + cellSizeM) continue;
                Vec3d d = (vd + (t1 * ox + t2 * oz) / Radius).Normalized;
                CubeSphere.FromDirection(d, out int f, out double u, out double v);
                int cn = 1 << CellLevel;
                var id = new PatchId(f, CellLevel, Math.Min(cn - 1, Math.Max(0, (int)Math.Floor((u + 1) * 0.5 * cn))), Math.Min(cn - 1, Math.Max(0, (int)Math.Floor((v + 1) * 0.5 * cn))));
                if (!want.ContainsKey(id)) want[id] = (float)dist;
            }
            // build missing, nearest first
            var missing = new List<KeyValuePair<PatchId, float>>();
            foreach (var kv in want) if (!cells.ContainsKey(kv.Key)) missing.Add(kv);
            missing.Sort((x, y) => x.Value.CompareTo(y.Value));
            for (int i = 0; i < missing.Count && i < MaxCellsPerTick; i++) BuildCell(missing[i].Key);
            // release cells that left the radius
            List<PatchId> drop = null;
            foreach (var kv in cells) if (!want.ContainsKey(kv.Key)) (drop ??= new List<PatchId>()).Add(kv.Key);
            if (drop != null) foreach (var k in drop) { cells[k].buf?.Release(); cells.Remove(k); Positions.Remove(k); CellsReleased++; }
            Draw(viewer, cam);
        }

        void Draw(Vector3 viewer, Camera cam)
        {
            DrawnBlades = 0; TotalBlades = 0;
            if (cam != null) GeometryUtility.CalculateFrustumPlanes(cam, frustum);
            var rp = new RenderParams(Mat) { shadowCastingMode = ShadowCastingMode.Off, receiveShadows = true, layer = 0 };
            foreach (var c in cells.Values)
            {
                TotalBlades += c.count; if (c.count == 0) continue;
                float d = Vector3.Distance(c.bounds.center, viewer);
                if (d > DrawRadius + cellSizeM) continue;
                if (cam != null && !GeometryUtility.TestPlanesAABB(frustum, c.bounds)) continue;
                float lod = Mathf.InverseLerp(DrawRadius * 0.3f, DrawRadius * 0.95f, d);
                float density = Mathf.Lerp(1f, 0.3f, lod);
                int count = Mathf.Max(1, Mathf.RoundToInt(c.count * density));
                c.mpb.SetFloat(WidthScaleId, 1f / Mathf.Sqrt(density));
                rp.matProps = c.mpb; rp.worldBounds = c.bounds;
                Graphics.RenderMeshPrimitives(rp, bladeMesh, 0, count); DrawnBlades += count;
            }
        }

        void BuildCell(PatchId id)
        {
            var (u0, u1, v0, v1) = id.Range();
            const int G = 33;
            var dirs = new Vec3d[G * G]; var hs = new double[G * G];
            Parallel.For(0, G, j => { for (int i = 0; i < G; i++) { var d = CubeSphere.Direction(id.face, u0 + (u1 - u0) * i / (G - 1), v0 + (v1 - v0) * j / (G - 1)); dirs[j * G + i] = d; hs[j * G + i] = Field.Height(d); } });

            var cell = new GCell { id = id, dir = id.CenterDirection() };
            double area = cellSizeM * cellSizeM;
            int target = Mathf.RoundToInt((float)area * BladesPerSquareMetre);
            int grid = Mathf.CeilToInt(Mathf.Sqrt(target));
            var rng = new SeededRng(unchecked((uint)(id.face * 73856093) ^ (uint)(id.ix * 19349663) ^ (uint)(id.iy * 83492791) ^ Seed ^ 0x9e3779b9u));
            var data = new List<Vector4>(target * 2);
            float minY = float.MaxValue, maxY = float.MinValue; Vector3 mn = new Vector3(1e9f, 1e9f, 1e9f), mx = -mn; float maxH = 0;
            for (int j = 0; j < grid; j++)
                for (int i = 0; i < grid; i++)
                {
                    double a = (i + rng.Next()) / grid, b = (j + rng.Next()) / grid;
                    double yawR = rng.Next(), hR = rng.Next(), wR = rng.Next(), sR = rng.Next(), lR = rng.Next(), keepR = rng.Next();
                    double gi = a * (G - 1), gj = b * (G - 1); int i0 = Math.Min(G - 2, (int)gi), j0 = Math.Min(G - 2, (int)gj); double tx = gi - i0, ty = gj - j0;
                    Vec3d dir = (Vec3d.Lerp(Vec3d.Lerp(dirs[j0 * G + i0], dirs[j0 * G + i0 + 1], tx), Vec3d.Lerp(dirs[(j0 + 1) * G + i0], dirs[(j0 + 1) * G + i0 + 1], tx), ty)).Normalized;
                    double h = (hs[j0 * G + i0] * (1 - tx) + hs[j0 * G + i0 + 1] * tx) * (1 - ty) + (hs[(j0 + 1) * G + i0] * (1 - tx) + hs[(j0 + 1) * G + i0 + 1] * tx) * ty;
                    if (h < WaterLevel + 0.35) continue;
                    // slope from the grid
                    double hx = hs[j0 * G + i0 + 1] - hs[j0 * G + i0], hy = hs[(j0 + 1) * G + i0] - hs[j0 * G + i0];
                    double spacing = cellSizeM / (G - 1);
                    double slope = 1.0 - 1.0 / Math.Sqrt(1 + (hx * hx + hy * hy) / (spacing * spacing));
                    if (slope > 0.42) continue;
                    Vec3d pw = dir * Radius;
                    double big = noise.Fbm(pw.x / 70.0, pw.y / 70.0, pw.z / 70.0, 3) * 0.5 + 0.5;
                    double small = noise.Noise(pw.x / 9.0 + 50, pw.y / 9.0, pw.z / 9.0 - 20) * 0.5 + 0.5;
                    double meadow = 0.18 + 0.82 * SS(0.05f, 0.30f, (float)(big + (small - 0.5) * 0.25));
                    double cover = SS((float)(0.75 - 0.6 * ProceduralCoverage), (float)(0.9 - 0.6 * ProceduralCoverage), (float)big);
                    double proc = meadow * cover;
                    proc *= 1.0 - SS((float)(0.42 * 0.6), 0.42f, (float)slope);
                    proc *= SS(0f, 1.2f, (float)(h - WaterLevel));
                    World.Vegetation(dir, out double excl, out double paintW, out double paintD);
                    if (excl > 0.5) continue;
                    double density = proc * (1 - paintW) + paintD * paintW;
                    if (keepR > density) continue;

                    double rr = Radius + h;
                    Vector3 pos = new Vector3((float)(dir.x * rr), (float)(dir.y * rr), (float)(dir.z * rr));
                    if (NoGrassRadius > 0 && (pos - NoGrassCentre).magnitude < NoGrassRadius) continue;
                    double tall = SS(0.25f, 0.8f, (float)big);
                    float height = Mathf.Lerp(0.28f, 0.95f, (float)Math.Max(tall, paintW * 0.7)) * Mathf.Lerp(0.7f, 1.25f, (float)hR) * Mathf.Lerp(1f, 0.55f, SS(0.15f, 0.42f, (float)slope));
                    float width = Mathf.Lerp(0.045f, 0.085f, (float)wR) * Mathf.Lerp(0.8f, 1.3f, (float)tall);
                    data.Add(new Vector4(pos.x, pos.y, pos.z, (float)yawR * Mathf.PI * 2f));
                    if (KeepPositions) { if (!Positions.TryGetValue(id, out var pl)) Positions[id] = pl = new List<Vector3>(); pl.Add(pos); }
                    data.Add(new Vector4(height, width, (float)sR, ((float)lR - 0.5f) * 0.55f));
                    mn = Vector3.Min(mn, pos); mx = Vector3.Max(mx, pos); maxH = Mathf.Max(maxH, height);
                }
            // shuffle so any prefix is a fair sample
            int count = data.Count / 2;
            for (int i = count - 1; i > 0; i--) { int j = (int)(rng.Next() * (i + 1)); (data[2 * i], data[2 * j]) = (data[2 * j], data[2 * i]); (data[2 * i + 1], data[2 * j + 1]) = (data[2 * j + 1], data[2 * i + 1]); }
            cell.count = count;
            if (count > 0)
            {
                cell.buf = new GraphicsBuffer(GraphicsBuffer.Target.Structured, count * 2, 16);
                cell.buf.SetData(data);
                cell.mpb.SetBuffer(BladesId, cell.buf);
                Vector3 up = new Vector3((float)cell.dir.x, (float)cell.dir.y, (float)cell.dir.z);
                cell.bounds = new Bounds((mn + mx) * 0.5f + up * (maxH * 0.5f), (mx - mn) + Vector3.one * (maxH * 1.4f + 1.5f));
            }
            else cell.bounds = new Bounds(Vector3.zero, Vector3.zero);
            cells[id] = cell; CellsBuilt++;
        }
    }
}
