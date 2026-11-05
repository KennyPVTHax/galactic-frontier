using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace GF.World
{
    /// <summary>
    /// Renders the baked Heightmap as a grid of chunk meshes with distance LOD and skirts that hide LOD cracks.
    /// Visual and gameplay ground are the same data, so feet never float above or sink below what is drawn.
    /// </summary>
    public sealed class PlanetTerrain : MonoBehaviour
    {
        public Heightmap Map;
        public Material TerrainMaterial;
        public Transform Viewer;
        public int ChunksPerSide = 16;
        public float[] LodDistances = { 150f, 300f, 520f, 900f };   // LOD0..LOD4 boundaries
        public int MaxRebuildsPerFrame = 3;
        public int ShadowLodMax = 2;

        sealed class Chunk
        {
            public int cx, cz, lod = -1;
            public GameObject go;
            public MeshFilter mf;
            public MeshRenderer mr;
            public Vector3 center;
        }

        readonly List<Chunk> chunks = new List<Chunk>();
        float chunkSize;
        int cellsPerChunk;
        float nextCheck;

        public void Build()
        {
            chunkSize = Map.Size / ChunksPerSide;
            cellsPerChunk = Mathf.RoundToInt(chunkSize / Map.Cell);
            for (int cz = 0; cz < ChunksPerSide; cz++)
                for (int cx = 0; cx < ChunksPerSide; cx++)
                {
                    var go = new GameObject($"Terrain_{cx}_{cz}");
                    go.transform.SetParent(transform, false);
                    var ch = new Chunk { cx = cx, cz = cz, go = go };
                    ch.mf = go.AddComponent<MeshFilter>();
                    ch.mr = go.AddComponent<MeshRenderer>();
                    ch.mr.sharedMaterial = TerrainMaterial;
                    float x0 = -Map.Half + cx * chunkSize, z0 = -Map.Half + cz * chunkSize;
                    ch.center = new Vector3(x0 + chunkSize * 0.5f, Map.Height(x0 + chunkSize * 0.5f, z0 + chunkSize * 0.5f), z0 + chunkSize * 0.5f);
                    chunks.Add(ch);
                }
            nextCheck = 0;
            Refresh(int.MaxValue);
        }

        void Update()
        {
            if (Map == null || Viewer == null || Time.time < nextCheck) return;
            nextCheck = Time.time + 0.2f;
            Refresh(MaxRebuildsPerFrame);
        }

        int WantedLod(float d)
        {
            for (int i = 0; i < LodDistances.Length; i++) if (d < LodDistances[i]) return i;
            return LodDistances.Length;
        }

        void Refresh(int budget)
        {
            Vector3 v = Viewer != null ? Viewer.position : Vector3.zero;
            // closest chunks first so the ground under the player is always sharp
            chunks.Sort((a, b) => Dist2(a, v).CompareTo(Dist2(b, v)));
            foreach (var c in chunks)
            {
                float d = Mathf.Max(0, Mathf.Sqrt(Dist2(c, v)) - chunkSize * 0.7f);
                int lod = WantedLod(d);
                if (lod == c.lod) continue;
                if (budget-- <= 0) break;
                c.mf.sharedMesh = BuildMesh(c, lod);
                c.lod = lod;
                c.mr.shadowCastingMode = lod <= ShadowLodMax ? ShadowCastingMode.On : ShadowCastingMode.Off;
            }
        }

        static float Dist2(Chunk c, Vector3 v) { float dx = c.center.x - v.x, dz = c.center.z - v.z; return dx * dx + dz * dz; }

        Mesh BuildMesh(Chunk c, int lod)
        {
            int step = 1 << lod;
            while (cellsPerChunk % step != 0) step >>= 1;
            int n = cellsPerChunk / step;            // quads per side
            int side = n + 1;
            float cell = Map.Cell * step;
            float x0 = -Map.Half + c.cx * chunkSize, z0 = -Map.Half + c.cz * chunkSize;
            float skirt = Mathf.Max(1.5f, cell * 0.75f);

            int core = side * side;
            int total = core + 4 * side;
            var verts = new Vector3[total];
            var norms = new Vector3[total];
            float ne = Map.Cell * Mathf.Min(step, 2);

            for (int j = 0; j < side; j++)
                for (int i = 0; i < side; i++)
                {
                    float x = x0 + i * cell, z = z0 + j * cell;
                    int k = j * side + i;
                    verts[k] = new Vector3(x, Map.Height(x, z), z);
                    norms[k] = Map.Normal(x, z, ne);
                }
            // skirts: S(z0 edge), N, W, E
            int s0 = core;
            for (int i = 0; i < side; i++)
            {
                int a = i;                    // z = z0 row
                int b = (side - 1) * side + i; // z = z1 row
                int w = i * side;             // x = x0 col
                int e = i * side + (side - 1);// x = x1 col
                verts[s0 + i] = verts[a] - new Vector3(0, skirt, 0); norms[s0 + i] = norms[a];
                verts[s0 + side + i] = verts[b] - new Vector3(0, skirt, 0); norms[s0 + side + i] = norms[b];
                verts[s0 + 2 * side + i] = verts[w] - new Vector3(0, skirt, 0); norms[s0 + 2 * side + i] = norms[w];
                verts[s0 + 3 * side + i] = verts[e] - new Vector3(0, skirt, 0); norms[s0 + 3 * side + i] = norms[e];
            }

            var tris = new List<int>(n * n * 6 + 4 * n * 6);
            for (int j = 0; j < n; j++)
                for (int i = 0; i < n; i++)
                {
                    int a = j * side + i, b = a + 1, d = a + side, e = d + 1;
                    // winding for upward-facing (left-handed, Unity) triangles
                    tris.Add(a); tris.Add(d); tris.Add(b);
                    tris.Add(b); tris.Add(d); tris.Add(e);
                }
            for (int i = 0; i < n; i++)
            {
                // south edge (z0): faces -z
                tris.Add(i); tris.Add(i + 1); tris.Add(s0 + i);
                tris.Add(i + 1); tris.Add(s0 + i + 1); tris.Add(s0 + i);
                // north edge (z1): faces +z
                int nb = (side - 1) * side;
                tris.Add(nb + i + 1); tris.Add(nb + i); tris.Add(s0 + side + i);
                tris.Add(nb + i + 1); tris.Add(s0 + side + i); tris.Add(s0 + side + i + 1);
                // west edge (x0): faces -x
                tris.Add(i * side); tris.Add(s0 + 2 * side + i); tris.Add((i + 1) * side);
                tris.Add((i + 1) * side); tris.Add(s0 + 2 * side + i); tris.Add(s0 + 2 * side + i + 1);
                // east edge (x1): faces +x
                tris.Add(i * side + side - 1); tris.Add((i + 1) * side + side - 1); tris.Add(s0 + 3 * side + i);
                tris.Add((i + 1) * side + side - 1); tris.Add(s0 + 3 * side + i + 1); tris.Add(s0 + 3 * side + i);
            }

            var m = new Mesh { name = $"terrain_{c.cx}_{c.cz}_L{lod}" };
            m.indexFormat = total > 65000 ? IndexFormat.UInt32 : IndexFormat.UInt16;
            m.SetVertices(verts);
            m.SetNormals(norms);
            m.SetTriangles(tris, 0, false);
            m.bounds = new Bounds(new Vector3(x0 + chunkSize * 0.5f, (Map.Min + Map.Max) * 0.5f, z0 + chunkSize * 0.5f),
                                  new Vector3(chunkSize, Map.Max - Map.Min + skirt + 2, chunkSize));
            m.UploadMeshData(true);
            return m;
        }
    }
}
