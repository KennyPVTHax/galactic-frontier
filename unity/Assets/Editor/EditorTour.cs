using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using GF.Authoring;
using GF.Planet;
using UnityEditor;
using UnityEditorInternal;
using UnityEngine;

namespace GF.EditorTools
{
    /// <summary>
    /// Developer tool: drives the REAL World Editor window and Scene view through a scripted editing session and captures
    /// what is on screen after each stage (screenshots + numbered frames for a video). It only uses a throw-away authored
    /// file. Start it WITHOUT -batchmode:   Unity -projectPath unity -executeMethod GF.EditorTools.EditorTour.Run
    /// </summary>
    public static class EditorTour
    {
        static WorldEditorWindow win; static WorldEditorSession S; static SceneView sv;
        static int stage, wait, frameNo; static string outDir; static string prevAuthored;
        static Vec3d spot; static List<PlacedProp> placed = new List<PlacedProp>();
        static readonly List<Action> script = new List<Action>();
        static int shotsLeftInStage;

        public static void Run()
        {
            outDir = Path.GetFullPath("Captures/editor_tour"); if (Directory.Exists(outDir)) Directory.Delete(outDir, true); Directory.CreateDirectory(outDir);
            Directory.CreateDirectory(outDir + "/frames");
            prevAuthored = WorldEditorSession.AuthoredPath;
            WorldEditorSession.AuthoredPath = "Assets/Resources/Authored/_tour_world.gfworld.bytes";
            if (File.Exists(WorldEditorSession.AuthoredPath)) File.Delete(WorldEditorSession.AuthoredPath);

            EditorApplication.delayCall += Begin;
        }

        static void Begin()
        {
            var main = EditorGUIUtility.GetMainWindowPosition();
            sv = EditorWindow.GetWindow<SceneView>(); sv.titleContent = new GUIContent("Scene");
            win = EditorWindow.GetWindow<WorldEditorWindow>(); win.position = new Rect(main.x + main.width - 520, main.y + 60, 500, main.height - 100);
            Layout();
            win.AutoStart(); S = win.Session;
            spot = S.Anchor.FromLocal(-40, 55);
            BuildScript();
            EditorApplication.update += Tick;
        }

        static void Layout()
        {
            var main = EditorGUIUtility.GetMainWindowPosition();
            sv.position = new Rect(main.x + 8, main.y + 70, main.width * 0.64f, main.height - 110);
            win.position = new Rect(main.x + main.width * 0.64f + 14, main.y + 70, main.width * 0.35f, main.height - 110);
            try { var st = sv.sceneViewState; var f = st.GetType().GetField("showGrid"); if (f != null) f.SetValue(st, false); var pr = st.GetType().GetProperty("showGrid"); if (pr != null && pr.CanWrite) pr.SetValue(st, false); sv.sceneViewState = st; } catch { }
            sv.drawGizmos = true; sv.Show(); win.Show(); win.Focus();
        }

        static void ClosePackageManager()
        {
            foreach (var w in Resources.FindObjectsOfTypeAll<EditorWindow>()) if (w != null && w.GetType().Name.Contains("PackageManager")) w.Close();
        }

        static Vec3d Off(double e, double n) => S.Anchor.FromLocal(-40 + e, 55 + n);

        static void Hover(Vec3d d) { win.AutoHover = d; }

        static void Stage(string name, int settleFrames, Action action)
        {
            script.Add(() => { action(); wait = settleFrames; });
            script.Add(() => { Capture(name); });
        }

        static void Dabs(BrushSettings b, Func<int, Vec3d> pos, int n, string label)
        {
            // many small scripted dabs, with a video frame every few of them
            script.Add(() => { S.BeginStroke(label, b, pos(0)); });
            for (int i = 0; i < n; i++)
            {
                int k = i;
                script.Add(() => { var p = pos(k); Hover(p); S.Dab(p, b, 0.05); S.Tree.Prewarm(S.ViewerPosition()); wait = 1; if (k % 3 == 0) CaptureFrame(); });
            }
            script.Add(() => { S.EndStroke(); });
        }

        static void BuildScript()
        {
            Stage("01_world_editor_open_globe", 40, () => { win.AutoGlobe(); win.AutoTab(0); win.AutoStatus("Aetherion loaded. The whole planet is visible; use Go to > Landing site or New region to start."); });
            Stage("02_fly_to_region_patch_boundaries", 70, () => { win.AutoPatches(true); win.AutoGo(spot, 90); win.AutoStatus("Terrain patch boundaries on: each coloured square is one streamed terrain patch."); });
            script.Add(() => { win.AutoPatches(false); win.AutoGo(Off(0, 0), 55); wait = 60; });
            script.Add(() => { win.AutoTab(1); win.AutoBrush(18, 8, BrushKind.Raise, 0, 0); S.AddRegion("My first region", spot, 70); win.AutoRegion(0); wait = 20; });

            // sculpt a hill
            var raise = new BrushSettings { Kind = BrushKind.Raise, RadiusM = 18, Strength = 8 };
            Dabs(raise, k => Off(Math.Sin(k * 0.5) * 3, 6 + Math.Cos(k * 0.5) * 3), 36, "Raise");
            Stage("03_sculpt_raise", 40, () => { win.AutoStatus("Raise: dragging the brush raised a hill. Ctrl flips to Lower, Shift smooths."); });
            var smooth = new BrushSettings { Kind = BrushKind.Smooth, RadiusM = 22, Strength = 8 };
            Dabs(smooth, k => Off(0, 6), 12, "Smooth");
            var flat = new BrushSettings { Kind = BrushKind.Flatten, RadiusM = 7, Strength = 8 };
            Dabs(flat, k => Off(0, 6), 14, "Flatten");
            Stage("04_sculpt_smooth_flatten", 40, () => { win.AutoStatus("Smooth and Flatten: the summit now has a level pad."); });

            // paint
            script.Add(() => { win.AutoTab(2); win.AutoGo(Off(5, 3), 32); wait = 70; });
            var rock = new BrushSettings { Kind = BrushKind.PaintMaterial, RadiusM = 12, Strength = 8, Layer = 2 };
            Dabs(rock, k => Off(9 + k * 0.7, 3 + k * 0.4), 14, "Paint rock");
            var sand = new BrushSettings { Kind = BrushKind.PaintMaterial, RadiusM = 6, Strength = 10, Layer = 3 };
            Dabs(sand, k => Off(-16 + k * 1.6, -4 + Math.Sin(k * 0.6) * 3), 14, "Paint sand");
            var dirt = new BrushSettings { Kind = BrushKind.PaintMaterial, RadiusM = 2.6, Strength = 10, Layer = 1 };
            Dabs(dirt, k => Off(-3 + k * 0.9, -3 + k * 1.1), 14, "Paint dirt path");
            Stage("05_paint_materials", 40, () => { win.AutoBrush(12, 8, BrushKind.Raise, 2, 0); win.AutoStatus("Paint: rock on the shoulder, sand along the stream bed, a dirt path up the hill."); });

            // props
            script.Add(() => { win.AutoTab(3); win.AutoGo(Off(4, 7), 20); wait = 80; });
            script.Add(() =>
            {
                var keys = S.Library.Keys.OrderBy(x => x).ToList();
                string b = keys.FirstOrDefault(x => x.Contains("boulder_03")) ?? keys[0], c = keys.FirstOrDefault(x => x.Contains("cliff")) ?? keys[0], p = keys.FirstOrDefault(x => x.Contains("rock_07")) ?? keys[0];
                placed.Add(S.PlaceProp(c, Off(11, 8), 200, 1.3f, true)); placed.Add(S.PlaceProp(b, Off(5, 12), 40, 1.5f)); placed.Add(S.PlaceProp(b, Off(14, 1), 110, 1.1f));
                for (int i = 0; i < 4; i++) placed.Add(S.PlaceProp(p, Off(-14 + i * 6, -5 + i), i * 70, 2.4f));
                win.AutoSelectProp(placed[1].id); S.Props.Tick(S.ViewerPosition()); wait = 30;
            });
            Stage("06_props_placed_selected", 40, () => { win.AutoStatus("Props: a landmark outcrop, two boulders and pebbles placed; one is selected (move/rotate handles)."); });
            script.Add(() => { var mv = placed[1]; S.MoveProp(mv, Off(2, 15), 75f, 1.8f); S.Props.Tick(S.ViewerPosition()); wait = 25; });
            Stage("07_prop_moved", 30, () => { win.AutoStatus("Moved the selected boulder; Ctrl+Z puts it back."); });

            // vegetation
            script.Add(() => { win.AutoTab(4); win.AutoGo(Off(-2, -3), 20); wait = 80; });
            var grass = new BrushSettings { Kind = BrushKind.PaintVegetation, RadiusM = 14, Strength = 10, VegDensity = 0.95 };
            Dabs(grass, k => Off(-6 + k * 1.5, -12 + Math.Sin(k * 0.5) * 3), 12, "Grass");
            var ex = new BrushSettings { Kind = BrushKind.ExcludeVegetation, RadiusM = 9, Strength = 10 };
            Dabs(ex, k => Off(0, 6), 4, "Exclude");
            script.Add(() => { for (int i = 0; i < 120; i++) S.Grass.Tick(S.ViewerPosition(), SceneView.lastActiveSceneView.camera); wait = 40; });
            Stage("08_vegetation_grass_and_exclusion", 50, () => { win.AutoStatus("Vegetation: a painted grass meadow, and a cleared 'keep clear' circle on the summit."); });

            // save, reload
            script.Add(() => { S.Save(); S.ReloadFromDisk(); win.AutoStatus("Saved and reloaded from disk: " + S.World.Summary()); wait = 60; });
            Stage("09_saved_and_reloaded", 60, () => { });
            script.Add(() => { win.AutoHover = null; wait = 5; });
        }

        static void Tick()
        {
            try
            {
                ClosePackageManager(); if (stage < 3 || stage % 25 == 0) Layout();
                SceneView.RepaintAll(); win.Repaint();
                if (wait > 0) { wait--; return; }
                if (stage >= script.Count) { Finish(); return; }
                var a = script[stage++]; a();
            }
            catch (Exception e) { Debug.LogError("[GFTOUR] " + e); Finish(); }
        }

        static Texture2D screen;
        static void Capture(string name)
        {
            var path = Path.Combine(outDir, name + ".png"); SaveShot(path);
        }
        static void CaptureFrame() { SaveShot(Path.Combine(outDir, "frames", $"f{frameNo++:D4}.png")); }

        static void SaveShot(string path)
        {
            var r = EditorGUIUtility.GetMainWindowPosition(); float ppp = EditorGUIUtility.pixelsPerPoint;
            int w = Mathf.RoundToInt(r.width * ppp), h = Mathf.RoundToInt(r.height * ppp);
            var px = InternalEditorUtility.ReadScreenPixel(new Vector2(r.x * ppp, r.y * ppp), w, h);
            if (screen == null || screen.width != w || screen.height != h) screen = new Texture2D(w, h, TextureFormat.RGBA32, false);
            screen.SetPixels(px); screen.Apply();
            File.WriteAllBytes(path, screen.EncodeToPNG());
        }

        static void Finish()
        {
            EditorApplication.update -= Tick;
            File.WriteAllText(Path.Combine(outDir, "tour_summary.txt"), S.Summary());
            S.Close();
            WorldEditorSession.AuthoredPath = prevAuthored;
            string t = "Assets/Resources/Authored/_tour_world.gfworld.bytes"; if (File.Exists(t)) { File.Delete(t); if (File.Exists(t + ".meta")) File.Delete(t + ".meta"); }
            Debug.Log("[GFTOUR] done: " + outDir);
            EditorApplication.Exit(0);
        }
    }
}
