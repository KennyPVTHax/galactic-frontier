using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using GF.Authoring;
using GF.Planet;
using UnityEditor;
using UnityEngine;

namespace GF.EditorTools
{
    /// <summary>
    /// Automated persistence / regeneration / streaming test for the World Editor. Runs the real editor session (preview
    /// quadtree, props, grass) in batch mode against a throw-away authored file, never touching the owner's real world.
    ///   Unity -batchmode -projectPath unity -executeMethod GF.EditorTools.WorldEditorTests.RunAll -quit
    /// </summary>
    public static class WorldEditorTests
    {
        static readonly StringBuilder log = new StringBuilder();
        static int failures;
        static void Check(bool ok, string name, string detail = "")
        {
            log.AppendLine($"{(ok ? "PASS" : "FAIL")} {name} {detail}");
            Debug.Log($"[GFTEST] {(ok ? "PASS" : "FAIL")} {name} {detail}");
            if (!ok) failures++;
        }

        public static void RunAll()
        {
            string prev = WorldEditorSession.AuthoredPath;
            string tmp = "Assets/Resources/Authored/_test_world.gfworld.bytes";
            WorldEditorSession.AuthoredPath = tmp;
            if (File.Exists(tmp)) File.Delete(tmp);
            try { Run(); }
            catch (Exception e) { Check(false, "test crashed", e.ToString()); }
            finally
            {
                WorldEditorSession.AuthoredPath = prev;
                if (File.Exists(tmp)) { File.Delete(tmp); if (File.Exists(tmp + ".meta")) File.Delete(tmp + ".meta"); }
            }
            Directory.CreateDirectory("Logs");
            File.WriteAllText("Logs/editor_tests.txt", log.ToString());
            Debug.Log($"[GFTEST] {(failures == 0 ? "ALL PASS" : failures + " FAILED")}");
            EditorApplication.Exit(failures == 0 ? 0 : 1);
        }

        static string VegInfo(WorldEditorSession s, Vec3d d) { s.World.Vegetation(d, out double e, out double pw, out double pd); return $"excl {e:F2} paintW {pw:F2} dens {pd:F2}; h {s.Field.Height(d):F2}"; }

        static Vec3d V(Vector3 v) => new Vec3d(v.x, v.y, v.z);
        static Vector3 P(Vec3d d, double r) => new Vector3((float)(d.x * r), (float)(d.y * r), (float)(d.z * r));

        static void Load(WorldEditorSession s, Vec3d at, double alt = 6)
        {
            var viewer = P(at, WorldEditorSession.PlanetRadius + s.Field.Height(at) + alt);
            s.Tree.Prewarm(viewer); s.Props.Tick(viewer);
            if (s.Grass != null) { s.Grass.KeepPositions = true; for (int i = 0; i < 60; i++) s.Grass.Tick(viewer, null); }
        }

        static void Run()
        {
            const double R = WorldEditorSession.PlanetRadius;
            Vec3d spot = new Vec3d(1, 0.3, 1).Normalized;                     // on the +X/+Z cube-face edge

            var s = WorldEditorSession.Open();
            Check(s.Valid && s.Tree != null && s.Props != null, "editor session opens with a live preview");
            Load(s, spot);
            double baseR = s.Tree.SampleMeshRadius(spot);
            Check(!double.IsNaN(baseR), "preview streams terrain around the chosen spot", $"patches {s.Tree.ActiveCount}");
            double h0 = s.Field.Height(spot);

            // ---------------- edit: sculpt, paint, vegetation, props (all through the same calls the Scene-view tools use)
            var raise = new BrushSettings { Kind = BrushKind.Raise, RadiusM = 28, Strength = 6 };
            s.BeginStroke("Raise", raise, spot); for (int i = 0; i < 12; i++) s.Dab(spot, raise, 0.05); s.EndStroke();
            var flat = new BrushSettings { Kind = BrushKind.Flatten, RadiusM = 14, Strength = 6 };
            s.BeginStroke("Flatten", flat, spot); for (int i = 0; i < 20; i++) s.Dab(spot, flat, 0.05); s.EndStroke();
            Vec3d side = s.Anchor.FromLocal(0, 0);                                 // inside the authored gameplay region
            var rock = new BrushSettings { Kind = BrushKind.PaintMaterial, RadiusM = 22, Strength = 5, Layer = 2 };
            s.BeginStroke("Paint rock", rock, spot); for (int i = 0; i < 8; i++) s.Dab(spot, rock, 0.05); s.EndStroke();
            var sand = new BrushSettings { Kind = BrushKind.PaintMaterial, RadiusM = 10, Strength = 6, Layer = 3 };
            Vec3d sandAt = (spot + new Vec3d(0.0009, 0, -0.0009)).Normalized;
            s.BeginStroke("Paint sand", sand, sandAt); for (int i = 0; i < 8; i++) s.Dab(sandAt, sand, 0.05); s.EndStroke();
            Vec3d grassAt = (spot + new Vec3d(-0.002, 0.0004, 0.002)).Normalized, exclAt = (spot + new Vec3d(0.002, 0, -0.002)).Normalized;
            var gv = new BrushSettings { Kind = BrushKind.PaintVegetation, RadiusM = 14, Strength = 6, VegDensity = 0.9 };
            s.BeginStroke("Grass", gv, grassAt); for (int i = 0; i < 10; i++) s.Dab(grassAt, gv, 0.05); s.EndStroke();
            var ex = new BrushSettings { Kind = BrushKind.ExcludeVegetation, RadiusM = 12, Strength = 6 };
            s.BeginStroke("Exclude", ex, exclAt); for (int i = 0; i < 4; i++) s.Dab(exclAt, ex, 0.05); s.EndStroke();
            var keys = s.Library.Keys.OrderBy(k => k).ToList();
            var placed = new List<PlacedProp>();
            Vec3d[] at = { spot, (spot + new Vec3d(0.0004, 0, 0.0004)).Normalized, (spot + new Vec3d(-0.0006, 0.0001, 0.0002)).Normalized };
            for (int i = 0; i < at.Length; i++) placed.Add(s.PlaceProp(keys[i % keys.Count], at[i], 20 + 40 * i, 1.2f + 0.3f * i));
            var mover = placed[2]; s.MoveProp(mover, (mover.Dir + new Vec3d(0.0003, 0, 0)).Normalized, 99f, 1.6f);
            s.AddRegion("Test region", spot, 120);
            Check(s.World.Cells.Count > 5000 && s.World.Props.Count == 3 && s.UndoDepth >= 9, "edits recorded", s.World.Summary() + $", undo depth {s.UndoDepth}");

            Load(s, spot);
            double afterR = s.Tree.SampleMeshRadius(spot), anaR = R + s.Field.Height(spot);
            Check(Math.Abs(afterR - anaR) < 0.1 && Math.Abs((afterR - baseR)) > 1.0, "rendered terrain shows the sculpt", $"mesh {afterR:F2} vs analytic {anaR:F2}, change {afterR - baseR:+0.00;-0.00} m");
            Check(s.Grass.CountBlades(grassAt, 10) > 40, "painted grass patch produces blades", $"{s.Grass.CountBlades(grassAt, 10)} blades; cells live {s.Grass.LiveCells}, built {s.Grass.CellsBuilt}, total blades {s.Grass.TotalBlades}, exclusion-test {s.Grass.CountBlades(exclAt, 6)}; veg at paint centre: " + VegInfo(s, grassAt));
            Check(s.Grass.CountBlades(exclAt, 6) == 0, "exclusion zone has no vegetation", $"{s.Grass.CountBlades(exclAt, 6)} blades");
            Check(s.Props.LiveCount == 3, "3 placed props spawned", $"live {s.Props.LiveCount}");

            // continuity of what is DRAWN across the cube-face edge
            double worst = 0; int cross = 0, lastF = -1;
            Vec3d tang = new Vec3d(-1, 0, 1).Normalized;
            for (int i = -300; i <= 300; i++)
            {
                double th = i * 0.25 / R; Vec3d d = (spot * Math.Cos(th) + tang * Math.Sin(th)).Normalized;
                CubeSphere.FromDirection(d, out int f, out _, out _); if (lastF >= 0 && f != lastF) cross++; lastF = f;
                double m = s.Tree.SampleMeshRadius(d); if (double.IsNaN(m)) continue; worst = Math.Max(worst, Math.Abs(m - (R + s.Field.Height(d))));
            }
            Check(cross >= 1 && worst < 0.25, "drawn surface is continuous across the cube-face edge and matches the edited terrain", $"worst mesh-vs-analytic {worst:F3} m over 150 m, crossed {cross}x");

            // ---------------- undo / redo (the same steps Ctrl+Z / Ctrl+Y replay)
            ulong edited = s.World.ContentHash(); int depth = s.UndoDepth;
            while (s.UndoOnce()) { }
            Check(s.World.Cells.Count == 0 && s.World.Props.Count == 0, "undo of every step returns to the untouched planet");
            while (s.RedoOnce()) { }
            Check(s.World.ContentHash() == edited && s.UndoDepth == depth, "redo restores every edit exactly");

            // ---------------- save, unload everything, reopen from disk
            s.Save(); ulong savedHash = s.World.ContentHash(); long size = new FileInfo(WorldEditorSession.AuthoredPath).Length;
            Check(File.Exists(WorldEditorSession.AuthoredPath) && size > 100, "world saved to disk", $"{size / 1024} KB for {s.World.Cells.Count} points");
            Load(s, spot);
            var propIds = s.World.Props.Select(p => p.id).OrderBy(x => x).ToList();
            var propPos = new Dictionary<string, Vector3>(); foreach (var kv in s.Props.Live) propPos[kv.Key] = kv.Value.go.transform.position;
            var liveObjs = s.Props.Live.Select(kv => kv.Value.go).ToList();
            s.Close();
            Check(liveObjs.All(g => g == null), "closing the session releases every prop instance");

            var s2 = WorldEditorSession.Open();
            Check(s2.World.ContentHash() == savedHash && s2.World.Props.Count == 3 && s2.World.Regions.Count == 1, "reopening restores every edit, prop and region exactly", $"hash {s2.World.ContentHash():X}");
            Load(s2, spot);
            double reR = s2.Tree.SampleMeshRadius(spot);
            Check(Math.Abs(reR - afterR) < 1e-3, "terrain after reload is identical to before saving", $"{reR:F3} vs {afterR:F3}");
            var ids2 = s2.Props.Live.Select(kv => kv.Key).OrderBy(x => x).ToList();
            Check(ids2.SequenceEqual(propIds) && s2.Props.Live.All(kv => (kv.Value.go.transform.position - propPos[kv.Key]).magnitude < 0.002f), "props return at the same ids and positions (moved rock stays moved)");

            // ---------------- stream out and back in (do not keep edited regions loaded)
            long meshBefore = s2.Tree.MeshBytes; int patchesBefore = s2.Tree.ActiveCount;
            var farViewer = P(new Vec3d(-spot.x, -spot.y, -spot.z), R + 60);
            s2.Tree.Prewarm(farViewer); s2.Props.Tick(farViewer); for (int i = 0; i < 10; i++) s2.Grass.Tick(farViewer, null);
            bool detailGone = !s2.Tree.ActiveIds.Any(id => id.level >= 8 && (id.CenterDirection() - spot).Length * R < 400);
            Check(s2.Props.LiveCount == 0 && detailGone && s2.Grass.LiveCells == 0, "flying to the far side releases the edited region's props, grass and fine terrain", $"live props {s2.Props.LiveCount}, grass cells {s2.Grass.LiveCells}, patches {s2.Tree.ActiveCount}");
            var near = P(spot, R + s2.Field.Height(spot) + 6);
            s2.Tree.Prewarm(near); s2.Props.Tick(near); for (int i = 0; i < 60; i++) s2.Grass.Tick(near, null);
            var ids3 = s2.Props.Live.Select(kv => kv.Key).OrderBy(x => x).ToList();
            var markers = s2.Props.GetComponentsInChildren<PlacedPropMarker>(true);
            Check(ids3.SequenceEqual(propIds) && markers.Length == 3 && s2.Props.transform.childCount == 3 && markers.Select(m => m.Id).Distinct().Count() == 3, "coming back restores the props with no duplicates", $"markers {markers.Length}, children {s2.Props.transform.childCount}");
            double r3 = s2.Tree.SampleMeshRadius(spot);
            Check(Math.Abs(r3 - afterR) < 1e-3, "coming back restores the exact sculpted terrain", $"{r3:F3}");
            Check(s2.Grass.CountBlades(exclAt, 6) == 0 && s2.Grass.CountBlades(grassAt, 10) > 40, "grass paint and exclusion are identical after streaming back");

            // ---------------- regeneration: a different procedural base keeps the owner's work
            var s3Base = new AetherionField(s2.Planet, s2.Anchor, 424242u);
            var f3 = new AuthoredField(s3Base, s2.World);
            double dd = 0; var rr = new System.Random(5);
            for (int i = 0; i < 300; i++) { var d = (spot + new Vec3d(rr.NextDouble() - .5, rr.NextDouble() - .5, rr.NextDouble() - .5) * 0.0012).Normalized; dd = Math.Max(dd, Math.Abs((f3.Height(d) - s3Base.Height(d)) - (s2.Field.Height(d) - s2.BaseField.Height(d)))); }
            Check(dd < 1e-9 && s2.World.Props.Count == 3, "regenerating the procedural planet with a new seed keeps authored offsets and props", $"max diff {dd:E1} m");
            s2.Close();
            var s4 = WorldEditorSession.Open(424242u);
            Load(s4, spot);
            Check(s4.World.ContentHash() == savedHash && Math.Abs(s4.Tree.SampleMeshRadius(spot) - (R + s4.Field.Height(spot))) < 0.1, "a regenerated world still loads every saved edit and renders it");
            s4.Close();
        }
    }
}
