using System;
using System.Collections.Generic;
using System.Linq;
using GF.Authoring;
using GF.Planet;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace GF.EditorTools
{
    /// <summary>
    /// Tools > Galactic Frontier > World Editor.
    /// A friendly window + Scene-view brushes for sculpting, painting, props and vegetation on the spherical Aetherion.
    /// Everything you do is saved as owner-authored overrides (never baked into the procedural planet).
    /// </summary>
    public sealed class WorldEditorWindow : EditorWindow
    {
        enum Tab { Navigate, Sculpt, Paint, Props, Vegetation }
        static readonly string[] TabNames = { "Navigate", "Sculpt", "Paint", "Props", "Vegetation" };

        WorldEditorSession S;
        Tab tab = Tab.Navigate;
        Vector2 scroll;
        readonly BrushSettings brush = new BrushSettings();
        BrushKind sculptKind = BrushKind.Raise;
        int paintLayer; bool eraseMat;
        int vegMode;     // 0 paint, 1 exclude, 2 erase
        bool showPatches, limitToRegion, autoSave;
        int selectedRegion = -1;
        string propKind = "Rock_namaqualand_boulder_02";
        float propScaleMin = 0.8f, propScaleMax = 1.6f; bool randomYaw = true, placeAsLandmark;
        string selectedProp;
        string status = "Ready. Open the Navigate tab to start.";
        bool stroking; double lastDab;
        string[] libKeys = new string[0];
        List<(Vector3[] corners, int level)> outlines = new List<(Vector3[], int)>();
        double nextOutline;
        Vec3d? hoverDir; double hoverH;

        // ---- automation hooks (used by EditorTour to produce real screenshots; harmless otherwise)
        internal Vec3d? AutoHover;
        internal WorldEditorSession Session => S;
        internal void AutoStart() { if (S == null) StartSession(); }
        internal void AutoTab(int t) { tab = (Tab)t; }
        internal void AutoGo(Vec3d d, double r) { GoTo(SceneView.lastActiveSceneView, d, r); }
        internal void AutoGlobe() { GoToGlobe(SceneView.lastActiveSceneView); }
        internal void AutoPatches(bool on) { showPatches = on; }
        internal void AutoBrush(double radius, double strength, BrushKind sculpt, int layer, int veg) { brush.RadiusM = radius; brush.Strength = strength; sculptKind = sculpt; paintLayer = layer; vegMode = veg; eraseMat = false; }
        internal void AutoSelectProp(string id) { selectedProp = id; }
        internal void AutoRegion(int i) { selectedRegion = i; }
        internal void AutoStatus(string s) { status = s; }

        static readonly string[] LayerNames = { "Grass", "Dirt", "Rock", "Sand" };
        static readonly Color[] LayerColors = { new Color(.35f, .65f, .25f), new Color(.55f, .38f, .22f), new Color(.6f, .6f, .62f), new Color(.85f, .78f, .52f) };

        [MenuItem("Tools/Galactic Frontier/World Editor")]
        public static void Open() { var w = GetWindow<WorldEditorWindow>("GF World Editor"); w.minSize = new Vector2(360, 520); w.Show(); }

        void OnEnable() { titleContent = new GUIContent("GF World Editor"); SceneView.duringSceneGui += OnScene; }
        void OnDisable() { SceneView.duringSceneGui -= OnScene; if (S != null && S.World != null && S.World.Dirty && autoSave) S.Save(); CloseSession(); }
        void CloseSession() { if (S != null) { S.Close(); S = null; } }

        // ============================================================ window
        void OnGUI()
        {
            EditorGUILayout.Space(4);
            using (new EditorGUILayout.HorizontalScope())
            {
                GUILayout.Label("Planet", GUILayout.Width(50));
                using (new EditorGUI.DisabledScope(true)) EditorGUILayout.Popup(0, new[] { "Aetherion", "Veyra-7 (soon)", "Kryos (soon)", "Pyron (soon)", "Zephyria (soon)", "Noctaris (soon)", "Planet 7 (reserved)" });
                if (S == null) { if (GUILayout.Button("Open planet", GUILayout.Width(100))) StartSession(); }
                else if (GUILayout.Button("Close", GUILayout.Width(60))) CloseSession();
            }
            if (S == null)
            {
                EditorGUILayout.HelpBox("Click 'Open planet' to load Aetherion into the Scene view. Nothing is added to your Unity scene; the planet preview is temporary.", MessageType.Info);
                return;
            }

            // ---- save bar
            using (new EditorGUILayout.HorizontalScope(EditorStyles.helpBox))
            {
                GUI.color = S.World.Dirty ? new Color(1f, .85f, .4f) : Color.white;
                if (GUILayout.Button(S.World.Dirty ? "Save changes *" : "Saved", GUILayout.Height(24))) { S.Save(); status = "Saved: " + S.World.Summary(); }
                GUI.color = Color.white;
                if (GUILayout.Button("Reload from disk", GUILayout.Height(24))) { S.ReloadFromDisk(); status = "Reloaded the saved world."; }
                autoSave = GUILayout.Toggle(autoSave, "Auto-save", GUILayout.Width(80));
            }
            using (new EditorGUILayout.HorizontalScope())
            {
                GUILayout.Label($"Undo {S.UndoDepth}  Redo {S.RedoDepth}", EditorStyles.miniLabel);
                GUILayout.FlexibleSpace();
                GUILayout.Label(S.World.Summary(), EditorStyles.miniLabel);
            }

            tab = (Tab)GUILayout.Toolbar((int)tab, TabNames, GUILayout.Height(26));
            scroll = EditorGUILayout.BeginScrollView(scroll);
            switch (tab)
            {
                case Tab.Navigate: DrawNavigate(); break;
                case Tab.Sculpt: DrawSculpt(); break;
                case Tab.Paint: DrawPaint(); break;
                case Tab.Props: DrawProps(); break;
                case Tab.Vegetation: DrawVegetation(); break;
            }
            EditorGUILayout.EndScrollView();

            using (new EditorGUILayout.VerticalScope(EditorStyles.helpBox))
            {
                GUILayout.Label($"Streaming: {S.Tree.ActiveCount} patches, queued {S.Tree.QueuedCount}, rebuilding {S.Tree.DirtyCount}, {S.Tree.Triangles / 1000}k tris, {S.Tree.MeshBytes / 1048576f:F0} MB  |  props live {S.Props.LiveCount}  grass blades {S.Grass?.DrawnBlades ?? 0}", EditorStyles.miniLabel);
                GUILayout.Label(status, EditorStyles.wordWrappedMiniLabel);
            }
        }

        void StartSession()
        {
            if (!System.IO.File.Exists("Assets/Generated/Planet_Terrain.mat")) { EditorUtility.DisplayDialog("First-time setup", "The planet materials haven't been generated yet. Use Tools > Galactic Frontier > Build Planet Scene once, then open the World Editor again.", "OK"); return; }
            S = WorldEditorSession.Open();
            libKeys = S.Library.Keys.OrderBy(k => k).ToArray();
            if (libKeys.Length > 0 && !S.Library.ContainsKey(propKind)) propKind = libKeys[0];
            var sv = SceneView.lastActiveSceneView ?? GetWindow<SceneView>();
            GoToGlobe(sv);
            status = "Aetherion loaded. Use the Navigate tab to fly somewhere, then pick a tool.";
        }

        // ---------------------------------------------------------------- tabs
        void DrawNavigate()
        {
            EditorGUILayout.LabelField("Go to", EditorStyles.boldLabel);
            using (new EditorGUILayout.HorizontalScope())
            {
                if (GUILayout.Button("Whole planet")) GoToGlobe(SceneView.lastActiveSceneView);
                if (GUILayout.Button("Landing site")) GoTo(SceneView.lastActiveSceneView, S.Spawn(), 60);
                if (GUILayout.Button("Here → surface")) GoToHover();
            }
            using (new EditorGUILayout.HorizontalScope())
            {
                if (GUILayout.Button("Level the view with the planet")) AlignUp(SceneView.lastActiveSceneView);
            }
            showPatches = EditorGUILayout.Toggle("Show terrain patch boundaries", showPatches);

            EditorGUILayout.Space();
            EditorGUILayout.LabelField("Editable regions", EditorStyles.boldLabel);
            for (int i = 0; i < S.World.Regions.Count; i++)
            {
                var r = S.World.Regions[i];
                using (new EditorGUILayout.HorizontalScope())
                {
                    bool sel = GUILayout.Toggle(selectedRegion == i, $"{r.name}  ({r.radiusM:F0} m)", "Button");
                    if (sel) selectedRegion = i;
                    if (GUILayout.Button("Go", GUILayout.Width(40))) GoTo(SceneView.lastActiveSceneView, r.Dir, Math.Max(40, r.radiusM * 0.7));
                    if (GUILayout.Button("X", GUILayout.Width(24)) && EditorUtility.DisplayDialog("Delete region?", "Only the region marker is removed; your edits stay.", "Delete", "Cancel")) { S.World.Regions.RemoveAt(i); S.World.Touch(); selectedRegion = -1; break; }
                }
            }
            if (selectedRegion >= 0 && selectedRegion < S.World.Regions.Count)
            {
                var r = S.World.Regions[selectedRegion];
                r.name = EditorGUILayout.TextField("Name", r.name);
                r.radiusM = EditorGUILayout.Slider("Radius (m)", (float)r.radiusM, 20, 1500);
                limitToRegion = EditorGUILayout.Toggle("Only edit inside this region", limitToRegion);
            }
            using (new EditorGUILayout.HorizontalScope())
            {
                if (GUILayout.Button("New region at the Scene view centre")) NewRegionAtCentre();
            }

            EditorGUILayout.Space();
            EditorGUILayout.LabelField("Play your world", EditorStyles.boldLabel);
            using (new EditorGUILayout.HorizontalScope())
            {
                if (GUILayout.Button("Play here in Unity", GUILayout.Height(28))) PlayHere();
                if (GUILayout.Button("Build Windows preview", GUILayout.Height(28))) BuildWindowsPreview();
            }
            EditorGUILayout.HelpBox("Controls in the Scene view: right-mouse + W/A/S/D to fly, mouse wheel to zoom, Alt + left-drag to orbit. Pick a tool tab, then click-drag on the terrain.", MessageType.None);
        }

        void DrawBrushSizing(bool strength = true)
        {
            brush.RadiusM = EditorGUILayout.Slider("Brush size (m)", (float)brush.RadiusM, 1, 150);
            if (strength) brush.Strength = EditorGUILayout.Slider("Brush strength", (float)brush.Strength, 0.2f, 25f);
            if (limitToRegion && selectedRegion >= 0) EditorGUILayout.HelpBox("Edits are limited to the selected region.", MessageType.None);
        }

        void DrawSculpt()
        {
            EditorGUILayout.LabelField("Sculpt terrain", EditorStyles.boldLabel);
            var kinds = new[] { BrushKind.Raise, BrushKind.Lower, BrushKind.Smooth, BrushKind.Flatten };
            sculptKind = kinds[GUILayout.Toolbar(Array.IndexOf(kinds, sculptKind) < 0 ? 0 : Array.IndexOf(kinds, sculptKind), kinds.Select(k => k.ToString()).ToArray(), GUILayout.Height(28))];
            DrawBrushSizing();
            EditorGUILayout.HelpBox("Left-drag on the terrain to sculpt.\nHold Ctrl to flip Raise/Lower.  Hold Shift to smooth.\nFlatten levels the ground to the height where you start dragging.", MessageType.None);
            if (S.Tree != null) EditorGUILayout.LabelField("Edits are stored as height offsets, so they survive regenerating the procedural planet.", EditorStyles.wordWrappedMiniLabel);
        }

        void DrawPaint()
        {
            EditorGUILayout.LabelField("Paint ground materials", EditorStyles.boldLabel);
            using (new EditorGUILayout.HorizontalScope())
                for (int i = 0; i < 4; i++)
                {
                    GUI.backgroundColor = paintLayer == i && !eraseMat ? LayerColors[i] : Color.white;
                    if (GUILayout.Button(LayerNames[i], GUILayout.Height(30))) { paintLayer = i; eraseMat = false; }
                }
            GUI.backgroundColor = eraseMat ? Color.red : Color.white;
            if (GUILayout.Button("Erase paint (back to procedural)", GUILayout.Height(24))) eraseMat = true;
            GUI.backgroundColor = Color.white;
            DrawBrushSizing();
            EditorGUILayout.HelpBox("Left-drag to paint the chosen material. Painted areas stay exactly as you painted them.", MessageType.None);
        }

        void DrawProps()
        {
            EditorGUILayout.LabelField("Rocks and props", EditorStyles.boldLabel);
            if (libKeys.Length == 0) EditorGUILayout.HelpBox("No prop prefabs found. Run Tools > Galactic Frontier > Build Planet Scene once.", MessageType.Warning);
            int idx = Mathf.Max(0, Array.IndexOf(libKeys, propKind));
            idx = EditorGUILayout.Popup("Prop to place", idx, libKeys.Select(k => k.Replace("Rock_", "")).ToArray());
            if (libKeys.Length > 0) propKind = libKeys[idx];
            EditorGUILayout.MinMaxSlider($"Random size {propScaleMin:F1}-{propScaleMax:F1}", ref propScaleMin, ref propScaleMax, 0.3f, 4f);
            randomYaw = EditorGUILayout.Toggle("Random rotation", randomYaw);
            placeAsLandmark = EditorGUILayout.Toggle("Mark as handcrafted landmark", placeAsLandmark);
            EditorGUILayout.HelpBox("Left-click on the terrain: place.   Click an existing rock: select it, then move it with the arrows.   Delete key or the button below: remove.", MessageType.None);
            var sel = selectedProp != null ? S.World.FindProp(selectedProp) : null;
            if (sel != null)
            {
                EditorGUILayout.LabelField($"Selected: {sel.kind}", EditorStyles.boldLabel);
                float ns = EditorGUILayout.Slider("Size", sel.scale, 0.2f, 6f); float ny = EditorGUILayout.Slider("Rotation", sel.yaw, 0, 360);
                if (Mathf.Abs(ns - sel.scale) > 1e-3f || Mathf.Abs(ny - sel.yaw) > 1e-3f) S.MoveProp(sel, sel.Dir, ny, ns);
                sel.landmark = EditorGUILayout.Toggle("Handcrafted landmark", sel.landmark);
                if (GUILayout.Button("Delete selected")) { S.DeleteProp(sel.id); selectedProp = null; status = "Deleted."; }
            }
            EditorGUILayout.LabelField($"{S.World.Props.Count} placed props in this world.", EditorStyles.miniLabel);
        }

        void DrawVegetation()
        {
            EditorGUILayout.LabelField("Grass and vegetation", EditorStyles.boldLabel);
            vegMode = GUILayout.Toolbar(vegMode, new[] { "Paint grass", "Keep clear (exclude)", "Erase" }, GUILayout.Height(28));
            DrawBrushSizing();
            if (vegMode == 0) brush.VegDensity = EditorGUILayout.Slider("Grass density", (float)brush.VegDensity, 0.05f, 1f);
            EditorGUILayout.HelpBox(vegMode == 0 ? "Left-drag to grow grass where you paint." : vegMode == 1 ? "Left-drag over an area to make sure no procedural vegetation ever spawns there." : "Left-drag to remove your grass paint/exclusion and return the area to procedural rules.", MessageType.None);
        }

        // ---------------------------------------------------------------- navigation helpers
        void GoToGlobe(SceneView sv)
        {
            if (sv == null) return;
            Vector3 n = new Vector3(0.62f, 0.40f, 0.67f).normalized;
            sv.cameraSettings.nearClip = 0.1f; sv.cameraSettings.farClip = 80000f; sv.cameraSettings.speed = 30f;
            sv.LookAt(Vector3.zero, Quaternion.LookRotation(-n, Vector3.up), (float)WorldEditorSession.PlanetRadius * 3.2f, false, false);
        }

        void GoTo(SceneView sv, Vec3d dir, double viewRadius)
        {
            if (sv == null) return;
            dir = dir.Normalized; double h = S.Field.Height(dir); double r = WorldEditorSession.PlanetRadius + h;
            Vector3 up = new Vector3((float)dir.x, (float)dir.y, (float)dir.z), pos = up * (float)r;
            Vector3 north = Vector3.Cross(Vector3.Cross(up, Vector3.up), up); if (north.sqrMagnitude < 0.01f) north = Vector3.forward; north.Normalize();
            Quaternion rot = Quaternion.LookRotation(Quaternion.AngleAxis(55f, Vector3.Cross(up, north)) * north, up);
            sv.cameraSettings.nearClip = 0.05f; sv.cameraSettings.farClip = 80000f; sv.cameraSettings.speed = 25f;
            sv.LookAt(pos, rot, (float)Math.Max(15, viewRadius), false, false);
            S.Tree.Prewarm(sv.camera.transform.position);
        }

        void GoToHover() { if (hoverDir.HasValue) GoTo(SceneView.lastActiveSceneView, hoverDir.Value, 50); else status = "Point the mouse at the planet in the Scene view first."; }

        void AlignUp(SceneView sv)
        {
            if (sv == null) return;
            Vector3 up = sv.camera.transform.position.normalized; Vector3 f = sv.camera.transform.forward;
            sv.rotation = Quaternion.LookRotation(f, up); sv.Repaint();
        }

        void NewRegionAtCentre()
        {
            var sv = SceneView.lastActiveSceneView; if (sv == null) return;
            var ray = new Ray(sv.camera.transform.position, sv.camera.transform.forward);
            if (!S.Raycast(ray, out var d, out _)) { status = "Aim the Scene view at the ground first."; return; }
            var r = S.AddRegion("Region " + (S.World.Regions.Count + 1), d, 150); selectedRegion = S.World.Regions.Count - 1; status = "Created " + r.name + ". Give it a name above.";
        }

        void PlayHere()
        {
            if (S.World.Dirty) S.Save();
            var sv = SceneView.lastActiveSceneView;
            Vec3d dir = hoverDir ?? new Vec3d(sv.camera.transform.position.x, sv.camera.transform.position.y, sv.camera.transform.position.z).Normalized;
            System.IO.File.WriteAllText("Assets/Resources/Authored/start.txt", $"{dir.x.ToString("R", System.Globalization.CultureInfo.InvariantCulture)} {dir.y.ToString("R", System.Globalization.CultureInfo.InvariantCulture)} {dir.z.ToString("R", System.Globalization.CultureInfo.InvariantCulture)}");
            AssetDatabase.Refresh();
            if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return;
            CloseSession();
            EditorSceneManager.OpenScene("Assets/Scenes/AetherionPlanet.unity");
            EditorApplication.EnterPlaymode();
        }

        void BuildWindowsPreview()
        {
            if (S.World.Dirty) S.Save();
            PlanetSceneBuilder.BuildWindows();
            var exe = System.IO.Path.GetFullPath("Builds/WinPlanet/GalacticFrontierPlanet.exe");
            if (System.IO.File.Exists(exe)) System.Diagnostics.Process.Start(exe);
        }

        // ============================================================ Scene view
        bool InRegion(Vec3d d)
        {
            if (!limitToRegion || selectedRegion < 0 || selectedRegion >= S.World.Regions.Count) return true;
            var r = S.World.Regions[selectedRegion];
            return Math.Acos(Math.Max(-1, Math.Min(1, d.Dot(r.Dir.Normalized)))) * WorldEditorSession.PlanetRadius <= r.radiusM;
        }

        BrushSettings ActiveBrush(Event e)
        {
            var b = new BrushSettings { RadiusM = brush.RadiusM, Strength = brush.Strength, Layer = paintLayer, VegDensity = brush.VegDensity };
            switch (tab)
            {
                case Tab.Sculpt:
                    b.Kind = sculptKind;
                    if (e.control && sculptKind == BrushKind.Raise) b.Kind = BrushKind.Lower; else if (e.control && sculptKind == BrushKind.Lower) b.Kind = BrushKind.Raise;
                    if (e.shift) b.Kind = BrushKind.Smooth; break;
                case Tab.Paint: b.Kind = eraseMat ? BrushKind.EraseMaterial : BrushKind.PaintMaterial; break;
                case Tab.Vegetation: b.Kind = vegMode == 0 ? BrushKind.PaintVegetation : vegMode == 1 ? BrushKind.ExcludeVegetation : BrushKind.EraseVegetation; break;
            }
            return b;
        }

        void OnScene(SceneView sv)
        {
            if (S == null || !S.Valid) return;
            Event e = Event.current;
            Handles.BeginGUI();
            GUILayout.BeginArea(new Rect(sv.position.width * 0.5f - 165, 8, 330, 54), EditorStyles.helpBox);
            GUILayout.Label($"GF World Editor — {tab}" + (tab == Tab.Navigate ? "" : "  (left-drag to use)"), EditorStyles.boldLabel);
            GUILayout.Label(hoverDir.HasValue ? $"ground height {hoverH:F1} m" : "point at the planet", EditorStyles.miniLabel);
            GUILayout.EndArea();
            Handles.EndGUI();

            if (showPatches && EditorApplication.timeSinceStartup > nextOutline) { outlines.Clear(); S.Tree.GetOutlines(outlines); nextOutline = EditorApplication.timeSinceStartup + 0.5; }
            if (showPatches)
                foreach (var (c, lvl) in outlines)
                {
                    Handles.color = Color.HSVToRGB((lvl * 0.11f) % 1f, 0.7f, 1f);
                    Handles.DrawAAPolyLine(2.5f, c[0], c[1], c[2], c[3], c[0]);
                }

            // regions
            foreach (var r in S.World.Regions)
            {
                Vector3 up = new Vector3((float)r.x, (float)r.y, (float)r.z).normalized; double h = S.Field.Height(r.Dir.Normalized);
                Handles.color = new Color(1f, .8f, .2f, 0.9f);
                Handles.DrawWireDisc(up * (float)(WorldEditorSession.PlanetRadius + h + 0.5), up, (float)r.radiusM);
                Handles.Label(up * (float)(WorldEditorSession.PlanetRadius + h + 6), r.name);
            }

            Ray ray = HandleUtility.GUIPointToWorldRay(e.mousePosition);
            Vec3d dir; double height; bool hit;
            if (AutoHover.HasValue) { dir = AutoHover.Value; height = S.Field.Height(dir); hit = true; } else hit = S.Raycast(ray, out dir, out height);
            hoverDir = hit ? dir : (Vec3d?)null; hoverH = height;

            // brush cursor
            if (hit && tab != Tab.Navigate)
            {
                Vec3d nrm = PatchMesher.StencilNormal(S.Field, WorldEditorSession.PlanetRadius, dir, 0.5 / WorldEditorSession.PlanetRadius);
                Vector3 n = new Vector3((float)nrm.x, (float)nrm.y, (float)nrm.z), p = new Vector3((float)(dir.x * (WorldEditorSession.PlanetRadius + height)), (float)(dir.y * (WorldEditorSession.PlanetRadius + height)), (float)(dir.z * (WorldEditorSession.PlanetRadius + height)));
                bool propTab = tab == Tab.Props;
                Handles.color = propTab ? new Color(.4f, .8f, 1f, .9f) : tab == Tab.Paint && !eraseMat ? LayerColors[paintLayer] : new Color(1f, 1f, 1f, .95f);
                float rad = propTab ? 1.2f : (float)brush.RadiusM;
                Handles.DrawWireDisc(p + n * 0.15f, n, rad); Handles.DrawWireDisc(p + n * 0.15f, n, rad * 0.5f);
                Handles.DrawLine(p, p + n * Mathf.Max(1.5f, rad * 0.25f));
                if (e.type == EventType.MouseMove) sv.Repaint();
            }

            if (tab == Tab.Navigate && !(e.alt)) return;

            int ctrl = GUIUtility.GetControlID(FocusType.Passive);
            if (tab != Tab.Navigate && !e.alt) HandleUtility.AddDefaultControl(ctrl);

            if (tab == Tab.Props) { OnSceneProps(sv, e, hit, dir); return; }
            if (e.alt) return;

            bool inBounds = hit && InRegion(dir);
            if (e.type == EventType.MouseDown && e.button == 0 && hit)
            {
                if (!inBounds) { status = "That spot is outside the selected region."; e.Use(); return; }
                var b = ActiveBrush(e); S.BeginStroke(b.Kind.ToString(), b, dir); stroking = true; lastDab = EditorApplication.timeSinceStartup;
                S.Dab(dir, b, 0.05); e.Use();
            }
            else if (e.type == EventType.MouseDrag && e.button == 0 && stroking)
            {
                if (hit && inBounds)
                {
                    double now = EditorApplication.timeSinceStartup; double dt = Math.Min(0.06, now - lastDab); lastDab = now;
                    var b = ActiveBrush(e); S.Dab(dir, b, Math.Max(0.016, dt));
                }
                e.Use();
            }
            else if (e.type == EventType.MouseUp && e.button == 0 && stroking) { stroking = false; S.EndStroke(); status = $"{S.LastStepLabel}: {S.World.Summary()}"; if (autoSave) S.Save(); e.Use(); Repaint(); }
        }

        void OnSceneProps(SceneView sv, Event e, bool hit, Vec3d dir)
        {
            // highlight / select existing props
            string nearest = null; float best = 28f;
            foreach (var kv in S.Props.Live)
            {
                if (kv.Value.go == null) continue;
                Vector2 sp = HandleUtility.WorldToGUIPoint(kv.Value.go.transform.position + kv.Value.go.transform.up * 0.5f);
                float d = Vector2.Distance(sp, e.mousePosition); if (d < best) { best = d; nearest = kv.Key; }
                if (kv.Key == selectedProp) { Handles.color = new Color(1f, .9f, .2f); Handles.DrawWireDisc(kv.Value.go.transform.position, kv.Value.go.transform.up, 1.5f * Mathf.Max(1f, S.World.FindProp(kv.Key)?.scale ?? 1f)); }
            }

            var sel = selectedProp != null ? S.World.FindProp(selectedProp) : null;
            if (sel != null && S.Props.TryGetLive(sel.id, out var liveGo))
            {
                EditorGUI.BeginChangeCheck();
                Vector3 pos = liveGo.transform.position;
                Vector3 np = Handles.PositionHandle(pos, liveGo.transform.rotation);
                float ny = Handles.RotationHandle(Quaternion.Euler(0, sel.yaw, 0), pos).eulerAngles.y;
                if (EditorGUI.EndChangeCheck())
                {
                    Vec3d nd = new Vec3d(np.x, np.y, np.z).Normalized;
                    S.MoveProp(sel, nd, Mathf.Abs(Mathf.DeltaAngle(ny, sel.yaw)) > 0.01f ? ny : sel.yaw, sel.scale); status = "Moved " + sel.kind;
                }
            }

            if (e.type == EventType.KeyDown && e.keyCode == KeyCode.Delete && sel != null) { S.DeleteProp(sel.id); selectedProp = null; status = "Deleted."; e.Use(); Repaint(); return; }
            if (e.type == EventType.MouseDown && e.button == 0 && !e.alt)
            {
                if (nearest != null) { selectedProp = nearest; status = "Selected " + S.World.FindProp(nearest)?.kind; e.Use(); Repaint(); }
                else if (hit && InRegion(dir) && libKeys.Length > 0)
                {
                    float sc = UnityEngine.Random.Range(propScaleMin, propScaleMax); float yaw = randomYaw ? UnityEngine.Random.Range(0f, 360f) : 0f;
                    var p = S.PlaceProp(propKind, dir, yaw, sc, placeAsLandmark); selectedProp = p.id; status = $"Placed {propKind}."; if (autoSave) S.Save(); e.Use(); Repaint();
                }
            }
        }
    }

}
