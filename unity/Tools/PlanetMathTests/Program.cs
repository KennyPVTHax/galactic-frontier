using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json;
using GF.Core;
using GF.Planet;

// Standalone test runner for the engine-independent planet maths (also mirrored as Unity EditMode tests).
//   dotnet run -c Release --project unity/Tools/PlanetMathTests
class G { public P[] heights { get; set; } }
class P { public double x { get; set; } public double z { get; set; } public double h { get; set; } }

static class Program
{
    static int fails = 0;
    static void Check(bool ok, string msg) { Console.WriteLine((ok ? "PASS " : "FAIL ") + msg); if (!ok) fails++; }

    static int Main()
    {
        string root = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "Assets", "GameData"));
        var o = new JsonSerializerOptions { IncludeFields = true, PropertyNameCaseInsensitive = true };
        var planet = JsonSerializer.Deserialize<PlanetData>(File.ReadAllText(Path.Combine(root, "aetherion.json")), o);
        var golden = JsonSerializer.Deserialize<G>(File.ReadAllText(Path.Combine(root, "aetherion.golden.json")), o);
        const double R = 10000;

        // 1. cube-sphere round trip
        var rng = new SeededRng(99); double worst = 0;
        for (int i = 0; i < 20000; i++)
        {
            int f = (int)(rng.Next() * 6); double u = rng.Next() * 2 - 1, v = rng.Next() * 2 - 1;
            var d = CubeSphere.Direction(f, u, v);
            CubeSphere.FromDirection(d, out int fb, out double u2, out double v2);
            var d2 = CubeSphere.Direction(fb, u2, v2);
            worst = Math.Max(worst, (d - d2).Length);
            if (Math.Abs(d.Length - 1) > 1e-12) worst = 1;
        }
        Check(worst < 1e-12, $"cube-sphere round trip max error {worst:E2}");

        // anchor straddling the +X/+Z cube edge so the authored region crosses a face boundary
        var anchorDir = new Vec3d(0.62, 0.40, 0.67).Normalized;
        var anchor = new AnchorFrame(anchorDir, R);
        var field = new AetherionField(planet, anchor, 52841u);

        // 2. migration: flat gameplay coordinates -> sphere -> identical heights to the TypeScript game
        double maxDh = 0; int n = 0; double rtErr = 0;
        foreach (var g in golden.heights)
        {
            double dist = Math.Sqrt(g.x * g.x + g.z * g.z);
            if (dist > 480) continue;
            var dir = anchor.FromLocal(g.x, g.z);
            anchor.ToLocal(dir, out double x2, out double z2);
            rtErr = Math.Max(rtErr, Math.Abs(x2 - g.x) + Math.Abs(z2 - g.z));
            maxDh = Math.Max(maxDh, Math.Abs(field.Height(dir) - g.h)); n++;
        }
        Check(n > 100 && rtErr < 1e-6, $"anchor round trip over {n} gameplay points, max error {rtErr:E2} m");
        Check(maxDh < 1e-6, $"gameplay heights on the sphere equal TypeScript heights: max |dh| {maxDh:E2} m over {n} points (r<480 m)");

        // 3. crack-freeness: every border vertex of every level-3 patch must coincide with a vertex of a neighbour
        int level = 3, cells = 1 << level, N = 32;
        double nrmMismatch = 0; long borderTotal = 0;
        var sw = Stopwatch.StartNew();
        var patches = new List<PatchMeshData>();
        for (int f = 0; f < 6; f++) for (int iy = 0; iy < cells; iy++) for (int ix = 0; ix < cells; ix++)
            patches.Add(PatchMesher.Build(new PatchId(f, level, ix, iy), R, field, N, parallel: true));
        double buildMs = sw.Elapsed.TotalMilliseconds;
        int side = N + 1;
        const double cellSize = 0.01, tol = 0.003;          // 1 cm buckets, 3 mm match tolerance (float32 at 2 km range ~0.2 mm)
        var grid = new Dictionary<(long, long, long), List<(int patch, double x, double y, double z, float nx, float ny, float nz)>>();
        for (int pi = 0; pi < patches.Count; pi++)
        {
            var pm = patches[pi];
            for (int j = 0; j < side; j++) for (int i = 0; i < side; i++)
            {
                if (!(i == 0 || j == 0 || i == N || j == N)) continue;
                int k = (j * side + i) * 3;
                double wx = pm.Center.x + pm.Pos[k], wy = pm.Center.y + pm.Pos[k + 1], wz = pm.Center.z + pm.Pos[k + 2];
                var key = ((long)Math.Floor(wx / cellSize), (long)Math.Floor(wy / cellSize), (long)Math.Floor(wz / cellSize));
                if (!grid.TryGetValue(key, out var lst)) grid[key] = lst = new List<(int, double, double, double, float, float, float)>();
                lst.Add((pi, wx, wy, wz, pm.Nrm[k], pm.Nrm[k + 1], pm.Nrm[k + 2]));
                borderTotal++;
            }
        }
        int orphans = 0;
        foreach (var kv in grid)
            foreach (var e in kv.Value)
            {
                bool partner = false;
                for (int dx = -1; dx <= 1 && !partner; dx++) for (int dy = -1; dy <= 1 && !partner; dy++) for (int dz = -1; dz <= 1 && !partner; dz++)
                {
                    if (!grid.TryGetValue((kv.Key.Item1 + dx, kv.Key.Item2 + dy, kv.Key.Item3 + dz), out var lst)) continue;
                    foreach (var o2 in lst)
                    {
                        if (o2.patch == e.patch) continue;
                        double dd = Math.Abs(o2.x - e.x) + Math.Abs(o2.y - e.y) + Math.Abs(o2.z - e.z);
                        if (dd < tol * 3) { partner = true; nrmMismatch = Math.Max(nrmMismatch, Math.Abs(o2.nx - e.nx) + Math.Abs(o2.ny - e.ny) + Math.Abs(o2.nz - e.nz)); break; }
                    }
                }
                if (!partner) { orphans++; if (orphans <= 4) {
                    double best = 1e9; string who = "";
                    for (int dx = -2; dx <= 2; dx++) for (int dy = -2; dy <= 2; dy++) for (int dz = -2; dz <= 2; dz++)
                        if (grid.TryGetValue((kv.Key.Item1 + dx, kv.Key.Item2 + dy, kv.Key.Item3 + dz), out var l2))
                            foreach (var o3 in l2) { if (o3.patch == e.patch) continue; double dd = Math.Sqrt((o3.x-e.x)*(o3.x-e.x)+(o3.y-e.y)*(o3.y-e.y)+(o3.z-e.z)*(o3.z-e.z)); if (dd < best) { best = dd; who = patches[o3.patch].Id.ToString(); } }
                    Console.WriteLine($"ORPHAN patch {patches[e.patch].Id} at ({e.x:F3},{e.y:F3},{e.z:F3}) nearest other-patch vertex {best*1000:F2} mm ({who})"); } }
            }
        Check(orphans == 0, $"seam test: {patches.Count} patches over all 6 cube faces (incl. 8 corners), {borderTotal} border vertices, cracked (unmatched) vertices = {orphans}");
        Check(nrmMismatch < 1e-3, $"seam normals agree across patches (max diff {nrmMismatch:E2})");
        Console.WriteLine($"INFO built {patches.Count} patches in {buildMs:F0} ms ({buildMs / patches.Count:F2} ms/patch, parallel)");

        {
            double wd = 0; int wj = -1;
            for (int j = 0; j <= 32; j++)
            {
                double v = -1 + 0.25 * j / 32.0;
                var d0 = CubeSphere.Direction(0, -1, v); var d4 = CubeSphere.Direction(4, 1, v);
                double dh = Math.Abs(field.Height(d0) - field.Height(d4));
                if (dh > wd) { wd = dh; wj = j; }
                if (j == 8) Console.WriteLine($"DBG j=8 g0={field.Global(d0):R} g4={field.Global(d4):R} loc0={field.Local.Height(0,0)} ; j=5 d0={d0.x:R},{d0.y:R},{d0.z:R} d4={d4.x:R},{d4.y:R},{d4.z:R} h0={field.Height(d0):R} h4={field.Height(d4):R}");
            }
            Console.WriteLine($"DBG max |h(F0 edge) - h(F4 edge)| = {wd:E3} at j={wj}");
        }
        {
            var nz = new Noise3D(1); double mxn = 0, mn2 = 0; var r3 = new SeededRng(3);
            for (int q = 0; q < 400000; q++) { double v = nz.Noise(r3.Next() * 300, r3.Next() * 300, r3.Next() * 300); mxn = Math.Max(mxn, Math.Abs(v)); mn2 += Math.Abs(v); }
            Console.WriteLine($"DBG noise max |n| = {mxn:F4}, mean |n| = {mn2 / 400000:F4}");
        }
        // 4. winding: sampled triangles point outward
        int bad = 0, tested = 0;
        foreach (var pm in patches.Where((_, idx) => idx % 17 == 0))
            for (int t = 0; t < Math.Min(pm.Tris.Length, 600); t += 3)
            {
                Vec3d a = V(pm, pm.Tris[t]), b = V(pm, pm.Tris[t + 1]), c = V(pm, pm.Tris[t + 2]);
                var cr = (b - a).Cross(c - a);
                if (cr.Length < 1e-9) continue;
                tested++; if (cr.Dot(a + pm.Center) < 0 && t < pm.Quads * pm.Quads * 6) bad++;
            }
        Check(bad == 0, $"all {tested} sampled surface triangles face outward");

        // 5. determinism pins (print so they can be pinned in Unity tests)
        var pins = new[] { new Vec3d(1, 0, 0), new Vec3d(0, 1, 0), new Vec3d(0.3, -0.5, 0.8), new Vec3d(-0.7, 0.2, -0.1), anchorDir };
        foreach (var p in pins) Console.WriteLine($"PIN h({p.Normalized}) = {field.Height(p.Normalized):F9}");
        var f2 = new AetherionField(planet, anchor, 52841u);
        Check(pins.All(p => field.Height(p.Normalized) == f2.Height(p.Normalized)), "height field is deterministic for the same seed");
        var f3 = new AetherionField(planet, anchor, 52842u);
        Check(Math.Abs(f3.Height(pins[1]) - field.Height(pins[1])) > 1e-6, "a different seed changes the world outside the authored region");

        // 6. relief sanity over the globe
        double mn = 1e9, mx = -1e9; var rr = new SeededRng(5);
        for (int i = 0; i < 40000; i++)
        {
            var d = new Vec3d(rr.Next() * 2 - 1, rr.Next() * 2 - 1, rr.Next() * 2 - 1).Normalized;
            double h = field.Height(d); mn = Math.Min(mn, h); mx = Math.Max(mx, h);
        }
        Console.WriteLine($"INFO global relief {mn:F1} .. {mx:F1} m");
        Check(mx < 700 && mn > -120, "global relief is within plausible bounds");

        Console.WriteLine(fails == 0 ? "ALL PASS" : $"{fails} FAILED");
        return fails == 0 ? 0 : 1;
    }

    static Vec3d V(PatchMeshData m, int i) => new Vec3d(m.Pos[i * 3], m.Pos[i * 3 + 1], m.Pos[i * 3 + 2]);
}
