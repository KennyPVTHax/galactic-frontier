using System.Collections.Generic;
using GF.Core;
using UnityEngine;
using UnityEngine.Rendering;

namespace GF.World
{
    /// <summary>
    /// Terrain-aware, GPU-instanced grass. The world is split into cells; cells near the camera get blades
    /// generated (deterministically, from the cell coordinates) into a GraphicsBuffer and drawn with a single
    /// RenderMeshPrimitives call each. Density, height and colour follow meadow patches, slope, shoreline and
    /// the landing pad; far cells draw a prefix of the (shuffled) blade list with wider blades.
    /// </summary>
    public sealed class GrassField : MonoBehaviour
    {
        [Header("Wiring")]
        public Heightmap Map;
        public Material Mat;
        public Transform Viewer;
        public double WaterLevel = -4;
        public Vector2 NoGrassCentre;   // landing pad
        public float NoGrassRadius = 12f;

        [Header("Quality")]
        public float CellSize = 16f;
        public float DrawRadius = 96f;
        public float BladesPerSquareMetre = 14f;
        public int MaxCellsBuiltPerFrame = 2;
        [Range(0.2f, 1f)] public float FarDensity = 0.3f;
        public float MaxSlope = 0.42f;

        sealed class Cell
        {
            public int x, z;
            public GraphicsBuffer buf;
            public int count;
            public Bounds bounds;
            public MaterialPropertyBlock mpb;
        }

        readonly Dictionary<long, Cell> cells = new Dictionary<long, Cell>();
        readonly List<Cell> drawList = new List<Cell>();
        Mesh bladeMesh;
        SimplexNoise patchNoise;
        readonly Plane[] frustum = new Plane[6];
        static readonly int BladesId = Shader.PropertyToID("_Blades");
        static readonly int WidthScaleId = Shader.PropertyToID("_WidthScale");
        public int TotalBlades { get; private set; }
        public int DrawnBlades { get; private set; }
        public int LiveCells => cells.Count;

        void OnEnable()
        {
            bladeMesh = BuildBladeMesh();
            patchNoise = new SimplexNoise(90125u);
        }

        void OnDisable()
        {
            foreach (var c in cells.Values) c.buf?.Release();
            cells.Clear();
            if (bladeMesh) Destroy(bladeMesh);
        }

        // 7 verts / 5 tris: three tapered segments and a tip. uv.y = 0..1 root->tip, x = -0.5..0.5
        static Mesh BuildBladeMesh()
        {
            var v = new[]
            {
                new Vector3(-0.5f, 0.00f, 0), new Vector3(0.5f, 0.00f, 0),
                new Vector3(-0.5f, 0.33f, 0), new Vector3(0.5f, 0.33f, 0),
                new Vector3(-0.5f, 0.66f, 0), new Vector3(0.5f, 0.66f, 0),
                new Vector3( 0.0f, 1.00f, 0),
            };
            var uv = new Vector2[v.Length];
            for (int i = 0; i < v.Length; i++) uv[i] = new Vector2(v[i].x + 0.5f, v[i].y);
            var m = new Mesh { name = "grass_blade" };
            m.SetVertices(v); m.SetUVs(0, uv);
            m.SetTriangles(new[] { 0, 2, 1, 1, 2, 3, 2, 4, 3, 3, 4, 5, 4, 6, 5 }, 0);
            m.bounds = new Bounds(new Vector3(0, 0.5f, 0), new Vector3(2, 2, 2));
            m.UploadMeshData(true);
            return m;
        }

        static float SS(float e0, float e1, float x) { float t = Mathf.Clamp01((x - e0) / (e1 - e0)); return t * t * (3f - 2f * t); }

        static long Key(int x, int z) => ((long)x << 32) ^ (uint)z;

        void LateUpdate()
        {
            if (Map == null || Mat == null || Viewer == null) return;
            var cam = Camera.main;
            Vector3 vp = Viewer.position;
            if (cam != null) GeometryUtility.CalculateFrustumPlanes(cam, frustum);

            int cx0 = Mathf.FloorToInt((vp.x - DrawRadius) / CellSize), cx1 = Mathf.FloorToInt((vp.x + DrawRadius) / CellSize);
            int cz0 = Mathf.FloorToInt((vp.z - DrawRadius) / CellSize), cz1 = Mathf.FloorToInt((vp.z + DrawRadius) / CellSize);

            // build missing cells, nearest first
            var want = new List<(float d, int x, int z)>();
            for (int cz = cz0; cz <= cz1; cz++)
                for (int cx = cx0; cx <= cx1; cx++)
                {
                    float dx = (cx + 0.5f) * CellSize - vp.x, dz = (cz + 0.5f) * CellSize - vp.z;
                    float d = Mathf.Sqrt(dx * dx + dz * dz);
                    if (d > DrawRadius + CellSize) continue;
                    if (!cells.ContainsKey(Key(cx, cz))) want.Add((d, cx, cz));
                }
            want.Sort((a, b) => a.d.CompareTo(b.d));
            for (int i = 0; i < want.Count && i < MaxCellsBuiltPerFrame; i++) BuildCell(want[i].x, want[i].z);

            // evict far cells
            List<long> drop = null;
            foreach (var kv in cells)
            {
                var c = kv.Value;
                float dx = (c.x + 0.5f) * CellSize - vp.x, dz = (c.z + 0.5f) * CellSize - vp.z;
                if (dx * dx + dz * dz > (DrawRadius + CellSize * 3) * (DrawRadius + CellSize * 3))
                    (drop ??= new List<long>()).Add(kv.Key);
            }
            if (drop != null) foreach (var k in drop) { cells[k].buf?.Release(); cells.Remove(k); }

            // draw
            DrawnBlades = 0; TotalBlades = 0;
            var rp = new RenderParams(Mat)
            {
                shadowCastingMode = ShadowCastingMode.Off,
                receiveShadows = true,
                layer = gameObject.layer,
                camera = null,
            };
            foreach (var c in cells.Values)
            {
                TotalBlades += c.count;
                if (c.count == 0) continue;
                float dx = (c.x + 0.5f) * CellSize - vp.x, dz = (c.z + 0.5f) * CellSize - vp.z;
                float d = Mathf.Sqrt(dx * dx + dz * dz);
                if (d > DrawRadius + CellSize) continue;
                if (cam != null && !GeometryUtility.TestPlanesAABB(frustum, c.bounds)) continue;

                float lod = Mathf.InverseLerp(DrawRadius * 0.28f, DrawRadius * 0.9f, d);   // 0 near .. 1 far
                float density = Mathf.Lerp(1f, FarDensity, lod);
                int n = Mathf.Max(1, Mathf.RoundToInt(c.count * density));
                c.mpb.SetFloat(WidthScaleId, 1f / Mathf.Sqrt(density));                     // fewer, slightly wider blades
                rp.matProps = c.mpb;
                rp.worldBounds = c.bounds;
                Graphics.RenderMeshPrimitives(rp, bladeMesh, 0, n);
                DrawnBlades += n;
            }
        }

        void BuildCell(int cx, int cz)
        {
            var cell = new Cell { x = cx, z = cz, mpb = new MaterialPropertyBlock() };
            float x0 = cx * CellSize, z0 = cz * CellSize;
            float area = CellSize * CellSize;
            int target = Mathf.RoundToInt(area * BladesPerSquareMetre);
            var rng = new SeededRng(unchecked((uint)(cx * 73856093) ^ (uint)(cz * 19349663) ^ 0x9e3779b9u));

            var data = new List<Vector4>(target * 2);
            float minY = float.MaxValue, maxY = float.MinValue, maxH = 0;
            int grid = Mathf.CeilToInt(Mathf.Sqrt(target));
            float step = CellSize / grid;
            for (int j = 0; j < grid; j++)
                for (int i = 0; i < grid; i++)
                {
                    // jittered grid: even coverage, no clumping artefacts
                    float x = x0 + (i + (float)rng.Next()) * step;
                    float z = z0 + (j + (float)rng.Next()) * step;
                    float yawR = (float)rng.Next(), hR = (float)rng.Next(), wR = (float)rng.Next(), sR = (float)rng.Next(), lR = (float)rng.Next(), keepR = (float)rng.Next();

                    float y = Map.Height(x, z);
                    if (y < WaterLevel + 0.35f) continue;
                    float slope = Map.Slope(x, z);
                    if (slope > MaxSlope) continue;

                    // meadow patches: large tall-grass banks, short lawns, and bare soil
                    float big = (float)patchNoise.Fbm(x / 70.0, z / 70.0, 3) * 0.5f + 0.5f;
                    float small = (float)patchNoise.Noise2(x / 9.0 + 50, z / 9.0 - 20) * 0.5f + 0.5f;
                    float dens = Mathf.Lerp(0.18f, 1f, SS(0.05f, 0.30f, big + (small - 0.5f) * 0.25f));
                    dens *= 1f - SS(MaxSlope * 0.6f, MaxSlope, slope);
                    dens *= SS(0f, 1.2f, y - (float)WaterLevel);              // thins out at the shore
                    float pad = Vector2.Distance(new Vector2(x, z), NoGrassCentre);
                    dens *= SS(NoGrassRadius, NoGrassRadius + 14f, pad);
                    if (keepR > dens) continue;

                    float tall = SS(0.25f, 0.8f, big);
                    float height = Mathf.Lerp(0.28f, 0.95f, tall) * Mathf.Lerp(0.7f, 1.25f, hR);
                    height *= Mathf.Lerp(1f, 0.55f, SS(0.15f, 0.42f, slope));
                    float width = Mathf.Lerp(0.045f, 0.085f, wR) * Mathf.Lerp(0.8f, 1.3f, tall);

                    data.Add(new Vector4(x, y - 0.02f, z, yawR * Mathf.PI * 2f));
                    data.Add(new Vector4(height, width, sR, (lR - 0.5f) * 0.55f));
                    if (y < minY) minY = y; if (y > maxY) maxY = y; if (height > maxH) maxH = height;
                }

            // shuffle so any prefix is a fair sample (used for far LOD)
            int count = data.Count / 2;
            for (int i = count - 1; i > 0; i--)
            {
                int j = (int)(rng.Next() * (i + 1));
                (data[2 * i], data[2 * j]) = (data[2 * j], data[2 * i]);
                (data[2 * i + 1], data[2 * j + 1]) = (data[2 * j + 1], data[2 * i + 1]);
            }

            cell.count = count;
            if (count > 0)
            {
                cell.buf = new GraphicsBuffer(GraphicsBuffer.Target.Structured, count * 2, 16);
                cell.buf.SetData(data);
                cell.mpb.SetBuffer(BladesId, cell.buf);
                cell.bounds = new Bounds(new Vector3(x0 + CellSize * 0.5f, (minY + maxY) * 0.5f + maxH * 0.5f, z0 + CellSize * 0.5f),
                                         new Vector3(CellSize + 2.5f, (maxY - minY) + maxH + 1.5f, CellSize + 2.5f));
            }
            cells[Key(cx, cz)] = cell;
        }
    }
}
