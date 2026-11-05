using System;
using System.Collections.Generic;
using System.IO;
using GF.Authoring;
using GF.Core;
using GF.Planet;
using UnityEditor;
using UnityEngine;

namespace GF.EditorTools
{
    /// <summary>Tiny object whose only job is to give Unity's Undo system a revision number we can follow.</summary>
    public sealed class WorldEditorUndoProxy : ScriptableObject { public int revision; }

    /// <summary>
    /// The editing session behind the World Editor window: a live preview of the streamed planet in the Scene view,
    /// ray-picking on the sphere, brushes, props, save/load and Unity Undo/Redo. The preview shows exactly what the game
    /// builds (same quadtree, same field, same materials); it is hidden (HideAndDontSave) and never saved into your scene.
    /// </summary>
    public sealed class WorldEditorSession
    {
        public const string DefaultAuthoredPath = "Assets/Resources/Authored/aetherion.gfworld.bytes";
        public static string AuthoredPath = DefaultAuthoredPath;      // tests redirect this so they never touch the owner's real world
        public const double PlanetRadius = 10000;
        public const uint WorldSeed = 52841;

        public PlanetData Planet;
        public AnchorFrame Anchor;
        public AetherionField BaseField;
        public AuthoredField Field;
        public AuthoredWorld World;
        public PlanetQuadtree Tree;
        public PropStreamer Props;
        public SphereGrass Grass;
        public GameObject Root;
        public Light Sun, SkyLight;
        public readonly Dictionary<string, GameObject> Library = new Dictionary<string, GameObject>();
        public bool Valid => Root != null;

        sealed class Step { public string label; public Action undo, redo; public Vec3d center; public double radius; }
        readonly List<Step> steps = new List<Step>(); int applied;
        WorldEditorUndoProxy proxy;
        double lastTick;
        Material skyBackup; bool ambientBackupSet; UnityEngine.Rendering.AmbientMode ambientBackup; Color ambientColorBackup; bool fogBackup; Material prevSky;

        static readonly int GUp = Shader.PropertyToID("_GF_Up"), GSun = Shader.PropertyToID("_GF_SunDir"), GCenter = Shader.PropertyToID("_GF_PlanetCenter");

        // ------------------------------------------------------------------ lifetime
        public static WorldEditorSession Open(uint seed = WorldSeed, bool preview = true)
        {
            var s = new WorldEditorSession();
            s.Planet = AetherionBuilderBridge.LoadPlanet();
            s.Anchor = new AnchorFrame(new Vec3d(0.62, 0.40, 0.67).Normalized, PlanetRadius);
            s.BaseField = new AetherionField(s.Planet, s.Anchor, seed);
            s.World = LoadWorld(seed);
            s.Field = new AuthoredField(s.BaseField, s.World);
            s.proxy = ScriptableObject.CreateInstance<WorldEditorUndoProxy>(); s.proxy.hideFlags = HideFlags.HideAndDontSave;
            s.LoadLibrary();
            if (preview) s.BuildPreview();
            return s;
        }

        public static AuthoredWorld LoadWorld(uint seed)
        {
            if (File.Exists(AuthoredPath))
                using (var fs = File.OpenRead(AuthoredPath)) return AuthoredIO.Read(fs);
            return new AuthoredWorld { PlanetId = "aetherion", BaseSeedAtAuthoring = seed };
        }

        void LoadLibrary()
        {
            foreach (var guid in AssetDatabase.FindAssets("t:Prefab Rock_", new[] { "Assets/Generated/Prefabs" }))
            {
                var path = AssetDatabase.GUIDToAssetPath(guid); var go = AssetDatabase.LoadAssetAtPath<GameObject>(path);
                if (go != null) Library[go.name] = go;
            }
        }

        void BuildPreview()
        {
            Root = new GameObject("GF_WorldEditorPreview") { hideFlags = HideFlags.HideAndDontSave };
            var terrainMat = AssetDatabase.LoadAssetAtPath<Material>("Assets/Generated/Planet_Terrain.mat");
            var grassMat = AssetDatabase.LoadAssetAtPath<Material>("Assets/Generated/Aetherion_Grass.mat");
            var skyMat = AssetDatabase.LoadAssetAtPath<Material>("Assets/Generated/Planet_Sky.mat");
            var waterMat = AssetDatabase.LoadAssetAtPath<Material>("Assets/Generated/Planet_Water.mat");
            Shader.SetGlobalVector(GCenter, new Vector4(0, 0, 0, (float)PlanetRadius));

            Tree = Root.AddComponent<PlanetQuadtree>();
            Tree.Radius = PlanetRadius; Tree.Field = Field; Tree.Paint = World; Tree.Mat = terrainMat; Tree.ObjectFlags = HideFlags.HideAndDontSave;
            Tree.MaxLevel = 9; Tree.BuildsPerFrame = 3; Tree.SplitFactor = 1.9f; Tree.MergeFactor = 2.2f;

            Props = new GameObject("Props") { hideFlags = HideFlags.HideAndDontSave }.AddComponent<PropStreamer>();
            Props.transform.SetParent(Root.transform);
            Props.World = World; Props.Field = Field; Props.Radius = PlanetRadius; Props.ObjectFlags = HideFlags.HideAndDontSave; Props.SpawnRange = 500; Props.DespawnRange = 650;
            foreach (var kv in Library) Props.Library[kv.Key] = kv.Value;

            if (grassMat != null)
            {
                Grass = new GameObject("Grass") { hideFlags = HideFlags.HideAndDontSave }.AddComponent<SphereGrass>();
                Grass.transform.SetParent(Root.transform);
                Grass.Field = Field; Grass.World = World; Grass.Radius = PlanetRadius; Grass.Mat = grassMat; Grass.WaterLevel = Planet.liquid.level; Grass.DrawRadius = 70f; Grass.BladesPerSquareMetre = 9f;
            }

            if (waterMat != null)
            {
                var water = GameObject.CreatePrimitive(PrimitiveType.Sphere); water.name = "Ocean"; water.hideFlags = HideFlags.HideAndDontSave;
                UnityEngine.Object.DestroyImmediate(water.GetComponent<Collider>());
                water.transform.SetParent(Root.transform);
                water.transform.localScale = Vector3.one * (float)(2.0 * (PlanetRadius + Planet.liquid.level));
                var mr = water.GetComponent<MeshRenderer>(); mr.sharedMaterial = waterMat; mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            }

            Sun = new GameObject("Sun") { hideFlags = HideFlags.HideAndDontSave }.AddComponent<Light>(); Sun.type = LightType.Directional; Sun.transform.SetParent(Root.transform);
            var sky = Planet.sky; Sun.color = new Color(sky.sun[0], sky.sun[1], sky.sun[2]); Sun.intensity = 2.5f; Sun.shadows = LightShadows.Soft;
            SkyLight = new GameObject("Skylight") { hideFlags = HideFlags.HideAndDontSave }.AddComponent<Light>(); SkyLight.type = LightType.Directional; SkyLight.transform.SetParent(Root.transform);
            SkyLight.color = new Color(0.55f, 0.70f, 1f); SkyLight.intensity = 0.55f; SkyLight.shadows = LightShadows.None;

            prevSky = RenderSettings.skybox; ambientBackup = RenderSettings.ambientMode; ambientColorBackup = RenderSettings.ambientLight; fogBackup = RenderSettings.fog; ambientBackupSet = true;
            if (skyMat != null) RenderSettings.skybox = skyMat;
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat; RenderSettings.ambientLight = new Color(sky.horizon[0], sky.horizon[1], sky.horizon[2]) * 0.55f;
            RenderSettings.fog = false;

            EditorApplication.update += Update;
            Undo.undoRedoPerformed += OnUndoRedo;
            lastTick = EditorApplication.timeSinceStartup;
        }

        public void Close()
        {
            EditorApplication.update -= Update; Undo.undoRedoPerformed -= OnUndoRedo;
            if (Grass != null) Grass.ReleaseAll();
            if (Tree != null) Tree.UnloadAll();
            if (Props != null) Props.ClearAll();
            if (Root != null) UnityEngine.Object.DestroyImmediate(Root);
            if (ambientBackupSet) { RenderSettings.skybox = prevSky; RenderSettings.ambientMode = ambientBackup; RenderSettings.ambientLight = ambientColorBackup; RenderSettings.fog = fogBackup; ambientBackupSet = false; }
            if (proxy != null) UnityEngine.Object.DestroyImmediate(proxy);
            Root = null;
        }

        // ------------------------------------------------------------------ per-frame preview
        public Vector3 ViewerPosition()
        {
            var sv = SceneView.lastActiveSceneView;
            return sv != null ? sv.camera.transform.position : new Vector3(0, 0, (float)PlanetRadius * 3);
        }

        void Update()
        {
            if (Root == null) return;
            var sv = SceneView.lastActiveSceneView; if (sv == null) return;
            double now = EditorApplication.timeSinceStartup; float dt = (float)Math.Min(0.2, now - lastTick); lastTick = now;
            Vector3 v = sv.camera.transform.position;
            Tree.Tick(v, dt);
            Props.Tick(v);
            if (Grass != null) Grass.Tick(v, sv.camera);

            Vector3 up = v.normalized;
            Vector3 east = Vector3.Cross(Vector3.up, up); if (east.sqrMagnitude < 0.01f) east = Vector3.Cross(Vector3.right, up); east.Normalize();
            Vector3 north = Vector3.Cross(east, up); var s = Planet.sky.sunDir;
            Vector3 sunDir = (east * s[0] + up * s[1] + north * -s[2]).normalized;
            Sun.transform.rotation = Quaternion.LookRotation(-sunDir, up); SkyLight.transform.rotation = Quaternion.LookRotation(-up, Vector3.Cross(up, east));
            float alt = v.magnitude - (float)PlanetRadius; float atmo = Mathf.Clamp01(1f - (alt - 500f) / 4500f);
            Shader.SetGlobalVector(GUp, new Vector4(up.x, up.y, up.z, atmo)); Shader.SetGlobalVector(GSun, sunDir);
            Shader.SetGlobalVector(GCenter, new Vector4(0, 0, 0, (float)PlanetRadius));
            if (Tree.QueuedCount > 0 || Tree.DirtyCount > 0) SceneView.RepaintAll();
        }

        // ------------------------------------------------------------------ picking on the sphere
        public bool Raycast(Ray ray, out Vec3d dir, out double height)
        {
            dir = default; height = 0;
            Vec3d o = new Vec3d(ray.origin.x, ray.origin.y, ray.origin.z), d = new Vec3d(ray.direction.x, ray.direction.y, ray.direction.z).Normalized;
            double shell = PlanetRadius + 420;
            double b = o.Dot(d), c = o.Dot(o) - shell * shell, disc = b * b - c;
            if (disc < 0) return false;
            double t0 = Math.Max(0, -b - Math.Sqrt(disc)), t1 = -b + Math.Sqrt(disc);
            if (t1 < 0) return false;
            double t = t0, prevT = t0; bool prevAbove = true;
            for (int i = 0; i < 4000 && t <= t1; i++)
            {
                Vec3d p = o + d * t; double r = p.Length; Vec3d pd = p / r;
                double alt = r - (PlanetRadius + Field.Height(pd));
                if (alt <= 0)
                {
                    if (i == 0 && prevAbove) { }
                    double lo = prevT, hi = t;
                    for (int k = 0; k < 18; k++) { double m = (lo + hi) * 0.5; Vec3d q = o + d * m; double rq = q.Length; if (rq - (PlanetRadius + Field.Height(q / rq)) > 0) lo = m; else hi = m; }
                    Vec3d hit = o + d * hi; dir = hit.Normalized; height = Field.Height(dir); return true;
                }
                prevT = t; prevAbove = true;
                t += Math.Max(0.35, Math.Min(80.0, alt * 0.35));
            }
            return false;
        }

        // ------------------------------------------------------------------ steps (undo/redo)
        void Register(string label, Action undo, Action redo, Vec3d center, double radius)
        {
            if (applied < steps.Count) steps.RemoveRange(applied, steps.Count - applied);
            steps.Add(new Step { label = label, undo = undo, redo = redo, center = center, radius = radius }); applied = steps.Count;
            if (proxy != null) { Undo.RecordObject(proxy, "GF " + label); proxy.revision = applied; EditorUtility.SetDirty(proxy); }
        }

        void OnUndoRedo()
        {
            if (proxy == null) return;
            int target = Mathf.Clamp(proxy.revision, 0, steps.Count);
            while (applied > target) { var s = steps[applied - 1]; s.undo(); Refresh(s.center, s.radius); applied--; }
            while (applied < target) { var s = steps[applied]; s.redo(); Refresh(s.center, s.radius); applied++; }
            SceneView.RepaintAll();
        }

        public void Refresh(Vec3d center, double radius)
        {
            Tree?.Invalidate(center, radius); Grass?.Invalidate(center, radius);
            Props?.ClearAll();      // props re-spawn from data on the next tick (cheap, avoids stale transforms)
        }

        // ------------------------------------------------------------------ strokes
        StrokeRecord current; double flattenTarget;
        public void BeginStroke(string label, BrushSettings b, Vec3d at)
        {
            current = new StrokeRecord { Label = label };
            flattenTarget = PlanetRadius + Field.Height(at);
        }

        public void Dab(Vec3d at, BrushSettings b, double dt)
        {
            if (current == null) BeginStroke(b.Kind.ToString(), b, at);
            if (b.Kind == BrushKind.Flatten) b.FlattenTargetR = flattenTarget;
            BrushEngine.Dab(World, Field, PlanetRadius, at, b, dt, current);
            Tree.Invalidate(at, b.RadiusM); Grass?.Invalidate(at, b.RadiusM);
        }

        public void EndStroke()
        {
            if (current == null) return;
            var rec = current; current = null;
            if (rec.IsEmpty) return;
            Register(rec.Label, () => BrushEngine.Undo(World, rec), () => BrushEngine.Redo(World, rec), rec.Center, rec.Radius + 2);
            World.Dirty = true;
        }

        // ------------------------------------------------------------------ props
        public PlacedProp PlaceProp(string kind, Vec3d dir, float yaw, float scale, bool landmark = false)
        {
            var p = World.AddProp(kind, dir, yaw, scale, landmark);
            Register("Place " + kind, () => World.RemoveProp(p.id), () => { if (World.FindProp(p.id) == null) World.Props.Add(p); World.Touch(); }, dir, 10);
            Props?.Tick(ViewerPosition()); return p;
        }

        public void DeleteProp(string id)
        {
            var p = World.FindProp(id); if (p == null) return;
            Register("Delete " + p.kind, () => { if (World.FindProp(p.id) == null) World.Props.Add(p); World.Touch(); Props?.Refresh(p.id); }, () => { World.RemoveProp(p.id); Props?.Refresh(p.id); }, p.Dir, 10);
            World.RemoveProp(id); Props?.Refresh(id);
        }

        public void MoveProp(PlacedProp p, Vec3d newDir, float newYaw, float newScale)
        {
            Vec3d od = p.Dir; float oy = p.yaw, os = p.scale;
            p.x = newDir.x; p.y = newDir.y; p.z = newDir.z; p.yaw = newYaw; p.scale = newScale; World.Touch(); Props?.Refresh(p.id);
            Register("Move " + p.kind,
                () => { p.x = od.x; p.y = od.y; p.z = od.z; p.yaw = oy; p.scale = os; World.Touch(); Props?.Refresh(p.id); },
                () => { p.x = newDir.x; p.y = newDir.y; p.z = newDir.z; p.yaw = newYaw; p.scale = newScale; World.Touch(); Props?.Refresh(p.id); }, newDir, 10);
        }

        public Region AddRegion(string name, Vec3d dir, double radius)
        {
            var r = new Region { id = "r" + (World.Regions.Count + 1), name = name, x = dir.x, y = dir.y, z = dir.z, radiusM = radius };
            World.Regions.Add(r); World.Touch(); return r;
        }

        // ------------------------------------------------------------------ persistence
        public void Save()
        {
            Directory.CreateDirectory(Path.GetDirectoryName(AuthoredPath));
            World.BaseSeedAtAuthoring = WorldSeed;
            using (var fs = File.Create(AuthoredPath)) AuthoredIO.Write(World, fs);
            if (AuthoredPath == DefaultAuthoredPath) File.WriteAllText("Assets/GameData/aetherion.authored.summary.txt", Summary());
            if (AuthoredPath.StartsWith("Assets/")) { AssetDatabase.ImportAsset(AuthoredPath); AssetDatabase.Refresh(); }
            World.Dirty = false;
        }

        public string Summary()
        {
            var sb = new System.Text.StringBuilder();
            sb.AppendLine("Galactic Frontier authored world (human-readable summary; the real data is " + AuthoredPath + ")");
            sb.AppendLine($"planet={World.PlanetId} format={AuthoredWorld.FormatVersion} baseSeed={World.BaseSeedAtAuthoring} lattice={Lattice.M}");
            sb.AppendLine($"lattice points: {World.Cells.Count}   props: {World.Props.Count}   regions: {World.Regions.Count}   hash: {World.ContentHash():X16}");
            foreach (var r in World.Regions) sb.AppendLine($"region {r.id} '{r.name}' dir=({r.x:F6},{r.y:F6},{r.z:F6}) radius={r.radiusM} m");
            foreach (var p in World.Props) sb.AppendLine($"prop {p.id} {p.kind} dir=({p.x:F6},{p.y:F6},{p.z:F6}) yaw={p.yaw:F1} scale={p.scale:F2}{(p.landmark ? " LANDMARK" : "")}");
            return sb.ToString();
        }

        /// <summary>Throw away the in-memory world and read it back from disk (what a restart would see).</summary>
        public void ReloadFromDisk()
        {
            var fresh = LoadWorld(WorldSeed);
            World.Cells.Clear(); foreach (var kv in fresh.Cells) World.Cells[kv.Key] = kv.Value;
            World.Props.Clear(); World.Props.AddRange(fresh.Props); World.Regions.Clear(); World.Regions.AddRange(fresh.Regions);
            World.Touch(); World.Dirty = false; steps.Clear(); applied = 0;
            Tree?.InvalidateAll(); Grass?.ReleaseAll(); Props?.ClearAll();
        }

        public bool UndoOnce() { if (applied <= 0) return false; var s = steps[applied - 1]; s.undo(); Refresh(s.center, s.radius); applied--; if (proxy != null) proxy.revision = applied; return true; }
        public bool RedoOnce() { if (applied >= steps.Count) return false; var s = steps[applied]; s.redo(); Refresh(s.center, s.radius); applied++; if (proxy != null) proxy.revision = applied; return true; }

        public Vec3d Spawn() => Anchor.FromLocal(Planet.landingSite.x - 6, Planet.landingSite.z + 4);
        public int UndoDepth => applied;
        public int RedoDepth => steps.Count - applied;
        public string LastStepLabel => applied > 0 ? steps[applied - 1].label : "";
    }

    /// <summary>Small bridge so the editor assembly does not need to know how the flat builder loads planet data.</summary>
    internal static class AetherionBuilderBridge
    {
        public static PlanetData LoadPlanet() => PlanetData.FromJson(File.ReadAllText("Assets/GameData/aetherion.json"));
    }
}
