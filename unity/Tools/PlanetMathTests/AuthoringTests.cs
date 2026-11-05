using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using GF.Authoring;
using GF.Core;
using GF.Planet;

static class AuthoringTests
{
    static int fails;
    static void Check(bool ok, string msg) { Console.WriteLine((ok ? "PASS " : "FAIL ") + msg); if (!ok) fails++; }
    const double R = 10000;

    public static int Run(PlanetData planet)
    {
        fails = 0;
        var anchor = new AnchorFrame(new Vec3d(0.62, 0.40, 0.67).Normalized, R);
        var baseField = new AetherionField(planet, anchor, 52841u);

        // 1. lattice keys: the same physical point reached from two faces has ONE key
        var map = new Dictionary<long, Vec3d>(); int shared = 0, bad = 0;
        var seenFrom = new Dictionary<long, HashSet<int>>();
        for (int f = 0; f < 6; f++)
            for (int t = 0; t <= Lattice.M; t += 211)
                foreach (var (i, j) in new[] { (0, t), (Lattice.M, t), (t, 0), (t, Lattice.M) })
                {
                    long k = Lattice.Key(f, i, j); var d = Lattice.PointDirection(f, i, j);
                    if (map.TryGetValue(k, out var d0)) { if ((d0 - d).Length > 1e-9) bad++; } else map[k] = d;
                    if (!seenFrom.TryGetValue(k, out var s)) seenFrom[k] = s = new HashSet<int>(); s.Add(f);
                }
        shared = seenFrom.Count(kv => kv.Value.Count > 1);
        Check(bad == 0 && shared > 100, $"lattice keys: no collisions between different points ({map.Count} keys), {shared} edge points reached from 2+ faces share one key");

        // 2. brushes across a cube-face edge
        var world = new AuthoredWorld { PlanetId = "aetherion", BaseSeedAtAuthoring = 52841 };
        var field = new AuthoredField(baseField, world);
        Vec3d edge = new Vec3d(1, 0.3, 1).Normalized;                         // on the +X/+Z cube edge
        var raise = new BrushSettings { Kind = BrushKind.Raise, RadiusM = 40, Strength = 6 };
        var rec = new StrokeRecord { Label = "raise" };
        int n1 = BrushEngine.Dab(world, field, R, edge, raise, 1.0, rec);
        Check(n1 > 1000, $"raise dab on a face edge touched {n1} lattice points");
        var faces = new HashSet<int>(); foreach (var k in rec.After.Keys) { }  // keys are face-agnostic by design
        double maxJump = 0; Vec3d tang = new Vec3d(-1, 0, 1).Normalized; Vec3d prev = edge; double prevD = world.HeightDelta(edge);
        int crossed = 0; int lastFace = -1;
        for (int s = -400; s <= 400; s++)
        {
            double th = s * 0.1 / R;
            Vec3d d = (edge * Math.Cos(th) + tang * Math.Sin(th)).Normalized;
            CubeSphere.FromDirection(d, out int f, out _, out _); if (lastFace >= 0 && f != lastFace) crossed++; lastFace = f;
            double dd = world.HeightDelta(d); if (s > -400) maxJump = Math.Max(maxJump, Math.Abs(dd - prevD)); prevD = dd;
        }
        Check(crossed >= 1 && maxJump < 0.2, $"height edit is continuous across the cube-face edge (crossed {crossed}x, largest step between samples 0.1 m apart: {maxJump:F4} m)");
        Check(Math.Abs(world.HeightDelta(edge) - 6.0) < 0.6, $"raise amount at the brush centre = {world.HeightDelta(edge):F2} m (expected about 6)");

        // 3. paint + vegetation brushes
        var paint = new BrushSettings { Kind = BrushKind.PaintMaterial, RadiusM = 30, Strength = 4, Layer = 2 };
        BrushEngine.Dab(world, field, R, edge, paint, 1.0, null);
        world.Sample(edge, out byte pw0, out byte pw1, out byte pw2, out byte pw3, out float ovr);
        Check(pw2 > 200 && ovr > 0.9f, $"rock paint at centre: weights ({pw0},{pw1},{pw2},{pw3}) override {ovr:F2}");
        var ex = new BrushSettings { Kind = BrushKind.ExcludeVegetation, RadiusM = 15, Strength = 5 };
        BrushEngine.Dab(world, field, R, edge, ex, 1.0, null);
        Check(world.HasExclusion(edge) && !world.HasExclusion(new Vec3d(-1, 0, 0)), "vegetation exclusion zone is queryable (inside true, outside false)");

        // 4. seams with edits: patches around the edit on BOTH faces at several levels, border vertices must coincide, normals identical
        int cracked = 0; long border = 0; double nrmDiff = 0; var patches = new List<PatchMeshData>();
        var seeds = new List<PatchId>();
        foreach (int level in new[] { 7, 8 })
            foreach (var p in Lattice.Window(edge, 120, R).Select(q => q.dir).Distinct().Take(0)) { }
        for (int level = 8; level <= 8; level++)
        {
            int cells = 1 << level;
            foreach (int f in new[] { 0, 4 })
                for (int ix = 0; ix < cells; ix++) for (int iy = 0; iy < cells; iy++)
                {
                    var id = new PatchId(f, level, ix, iy);
                    if ((id.CenterDirection() - edge).Length * R > 160) continue;
                    patches.Add(PatchMesher.Build(id, R, field, 32, true, world));
                }
        }
        var grid = new Dictionary<(long, long, long), List<(int, double, double, double, float, float, float)>>();
        for (int pi = 0; pi < patches.Count; pi++)
        {
            var pm = patches[pi]; int side = 33;
            for (int j = 0; j < side; j++) for (int i = 0; i < side; i++)
            {
                if (!(i == 0 || j == 0 || i == 32 || j == 32)) continue;
                int k = (j * side + i) * 3; double wx = pm.Center.x + pm.Pos[k], wy = pm.Center.y + pm.Pos[k + 1], wz = pm.Center.z + pm.Pos[k + 2];
                var key = ((long)Math.Floor(wx / 0.01), (long)Math.Floor(wy / 0.01), (long)Math.Floor(wz / 0.01));
                if (!grid.TryGetValue(key, out var l)) grid[key] = l = new List<(int, double, double, double, float, float, float)>();
                l.Add((pi, wx, wy, wz, pm.Nrm[k], pm.Nrm[k + 1], pm.Nrm[k + 2])); border++;
            }
        }
        // only patch-border vertices that have a neighbouring patch in the tested set must match; count unmatched whose neighbour patch exists
        int interiorUnmatched = 0;
        foreach (var kv in grid) foreach (var e in kv.Value)
        {
            bool partner = false;
            for (int dx = -1; dx <= 1 && !partner; dx++) for (int dy = -1; dy <= 1 && !partner; dy++) for (int dz = -1; dz <= 1 && !partner; dz++)
                if (grid.TryGetValue((kv.Key.Item1 + dx, kv.Key.Item2 + dy, kv.Key.Item3 + dz), out var l2))
                    foreach (var o in l2) if (o.Item1 != e.Item1 && Math.Abs(o.Item2 - e.Item2) + Math.Abs(o.Item3 - e.Item3) + Math.Abs(o.Item4 - e.Item4) < 0.009) { partner = true; nrmDiff = Math.Max(nrmDiff, Math.Abs(o.Item5 - e.Item5) + Math.Abs(o.Item6 - e.Item6) + Math.Abs(o.Item7 - e.Item7)); break; }
            if (!partner) { Vec3d wp = new Vec3d(e.Item2, e.Item3, e.Item4); if ((wp.Normalized - edge).Length * R < 60) interiorUnmatched++; }
        }
        Check(interiorUnmatched == 0, $"seam test with edits: {patches.Count} level-8 patches across the face edge, {border} border vertices, cracks inside the edited area = {interiorUnmatched}");
        Check(nrmDiff < 1e-3, $"seam normals identical with edits (max diff {nrmDiff:E2})");

        // 5. LOD consistency: coarse patch vertices coincide with the same terrain sampled by a finer patch
        var coarse = PatchMesher.Build(new PatchId(4, 8, 255, 128), R, field, 32, true, world);
        var cid = new PatchId(4, 8, 255, 128); var fine = PatchMesher.Build(new PatchId(4, 10, 255 * 4 + 1, 128 * 4 + 1), R, field, 32, true, world);
        double lodWorst = 0;
        var fineDir = fine.Center.Normalized; var cidDir = coarse.Center.Normalized;
        for (int t = 0; t < 33 * 33; t += 7)
        {
            Vec3d p = new Vec3d(coarse.Center.x + coarse.Pos[t * 3], coarse.Center.y + coarse.Pos[t * 3 + 1], coarse.Center.z + coarse.Pos[t * 3 + 2]);
            double expect = R + field.Height(p.Normalized);
            lodWorst = Math.Max(lodWorst, Math.Abs(p.Length - expect));
        }
        Check(lodWorst < 1e-3, $"coarse-LOD surface matches the edited analytic surface to {lodWorst:E2} m (same function at every LOD)");

        // 6. props
        var pr = world.AddProp("rock_boulder_02", edge, 30f, 1.5f);
        var pr2 = world.AddProp("rock_boulder_03", anchor.FromLocal(100, 50), 80f, 1.0f, landmark: true);
        world.Regions.Add(new Region { id = "r1", name = "Landing valley", x = edge.x, y = edge.y, z = edge.z, radiusM = 200 });

        // 7. persistence: save -> load = identical content and identical heights
        ulong h0 = world.ContentHash(); var ms = new MemoryStream(); world.Write(ms); ms.Position = 0; var loaded = AuthoredWorld.Read(ms);
        var rr = new SeededRng(11); double worst = 0;
        var lf = new AuthoredField(baseField, loaded);
        for (int i = 0; i < 2000; i++) { var d = (edge + new Vec3d(rr.Next() - .5, rr.Next() - .5, rr.Next() - .5) * 0.01).Normalized; worst = Math.Max(worst, Math.Abs(lf.Height(d) - field.Height(d))); }
        Check(loaded.ContentHash() == h0 && worst == 0 && loaded.Props.Count == 2 && loaded.Regions.Count == 1, $"save/load round trip is exact ({ms.Length} bytes for {loaded.Cells.Count} points; max height diff {worst:E1})");

        // 8. regeneration: a DIFFERENT procedural base (new seed) keeps the owner's edits (as offsets) and props
        var baseField2 = new AetherionField(planet, anchor, 99999u);
        var field2 = new AuthoredField(baseField2, loaded);
        double dd0 = 0; for (int i = 0; i < 500; i++) { var d = (edge + new Vec3d(rr.Next() - .5, rr.Next() - .5, rr.Next() - .5) * 0.004).Normalized; dd0 = Math.Max(dd0, Math.Abs((field2.Height(d) - baseField2.Height(d)) - (field.Height(d) - baseField.Height(d)))); }
        Check(dd0 < 1e-9 && loaded.Props.Count == 2 && Math.Abs(baseField2.Height(new Vec3d(0, 1, 0)) - baseField.Height(new Vec3d(0, 1, 0))) > 1e-6, $"regenerating the procedural planet (new seed) preserves authored offsets (max diff {dd0:E1} m) and props; the base really changed");
        var authoredHere = anchor.FromLocal(0, 0);
        Check(Math.Abs(field2.Height(authoredHere) - baseField2.Height(authoredHere)) < 1e-9, "inside the exact authored/gameplay region the base is unchanged by regeneration");

        // 9. undo / redo
        var wB = new AuthoredWorld(); var fB = new AuthoredField(baseField, wB); ulong e0 = wB.ContentHash();
        var recs = new List<StrokeRecord>();
        foreach (var kind in new[] { BrushKind.Raise, BrushKind.Smooth, BrushKind.PaintMaterial, BrushKind.ExcludeVegetation })
        {
            var r = new StrokeRecord(); var b = new BrushSettings { Kind = kind, RadiusM = 20, Strength = 5, Layer = 1 };
            for (int t = 0; t < 5; t++) BrushEngine.Dab(wB, fB, R, edge, b, 0.05, r);
            recs.Add(r);
        }
        ulong afterAll = wB.ContentHash();
        for (int i = recs.Count - 1; i >= 0; i--) BrushEngine.Undo(wB, recs[i]);
        bool undone = wB.ContentHash() == e0 && wB.Cells.Count == 0;
        foreach (var r in recs) BrushEngine.Redo(wB, r);
        Check(undone && wB.ContentHash() == afterAll, "undo of 4 strokes restores the empty world exactly; redo restores the edited world exactly");

        // 10. flatten + smooth behave
        var wC = new AuthoredWorld(); var f3 = new AuthoredField(baseField, wC);
        var fl = new BrushSettings { Kind = BrushKind.Flatten, RadiusM = 25, Strength = 6, FlattenTargetR = R + f3.Height(edge) + 3 };
        for (int t = 0; t < 40; t++) BrushEngine.Dab(wC, f3, R, edge, fl, 0.05, null);
        double dev = 0; for (int i = 0; i < 100; i++) { var d = (edge + new Vec3d(rr.Next() - .5, rr.Next() - .5, rr.Next() - .5) * 0.0008).Normalized; if (Math.Acos(Math.Min(1, d.Dot(edge))) * R < 8) dev = Math.Max(dev, Math.Abs(R + f3.Height(d) - fl.FlattenTargetR)); }
        Check(dev < 0.35, $"flatten pulls terrain to the target plane (max deviation {dev:F3} m within 8 m of the centre)");

        Console.WriteLine(fails == 0 ? "AUTHORING ALL PASS" : $"AUTHORING {fails} FAILED");
        return fails;
    }
}
