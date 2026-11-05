using System;
using System.IO;
using GF.Authoring;
using GF.Core;
using GF.Player;
using GF.World;
using UnityEngine;

namespace GF.Planet
{
    /// <summary>
    /// Assembles the spherical Aetherion prototype: field, streamed quadtree surface, water sphere, sky aligned to local
    /// up, radial-gravity player + astronaut, camera and a small debug HUD. Scene references are filled by the editor
    /// builder (Tools/Galactic Frontier/Build Planet Scene).
    /// </summary>
    [DefaultExecutionOrder(-100)]
    public sealed class PlanetBootstrap : MonoBehaviour
    {
        [Header("Data")] public TextAsset PlanetJson;
        public Material TerrainMat, WaterMat, SkyMat;
        public GameObject AstronautPrefab;
        public Material GrassMat;
        public GameObject[] PropPrefabs; public string[] PropKeys;
        public bool UseAuthoredWorld = true, EnableGrass = true;
        public Light Sun, SkyLight;
        [Header("Planet")]
        public double PlanetRadius = 10000;
        public Vector3 AnchorDirection = new Vector3(0.62f, 0.40f, 0.67f);
        public uint WorldSeed = 52841;
        [Range(0, 3)] public int Quality = 3;
        public bool ShowDebugHud = true;

        public PlanetData Planet { get; private set; }
        public IPlanetField Field { get; private set; }
        public AetherionField BaseField { get; private set; }
        public AuthoredWorld World { get; private set; }
        public PropStreamer Props { get; private set; }
        public SphereGrass Grass { get; private set; }
        public AnchorFrame Anchor { get; private set; }
        public PlanetQuadtree Tree { get; private set; }
        public SphericalPlayer Player { get; private set; }
        public SphericalCameraRig Rig { get; private set; }
        public GameInput Input { get; private set; }
        public bool Ready { get; private set; }

        Vector3 sunDir = Vector3.up;
        static readonly int GUp = Shader.PropertyToID("_GF_Up"), GSun = Shader.PropertyToID("_GF_SunDir"), GCenter = Shader.PropertyToID("_GF_PlanetCenter");
        float frameMs; string hud = "";

        void Start()
        {
            var t0 = Time.realtimeSinceStartup;
            Planet = PlanetData.FromJson(PlanetJson.text);
            Anchor = new AnchorFrame(new Vec3d(AnchorDirection.x, AnchorDirection.y, AnchorDirection.z), PlanetRadius);
            BaseField = new AetherionField(Planet, Anchor, WorldSeed);
            World = LoadAuthored();
            Field = UseAuthoredWorld ? (IPlanetField)new AuthoredField(BaseField, World) : BaseField;
            Shader.SetGlobalVector(GCenter, new Vector4(0, 0, 0, (float)PlanetRadius));
            TerrainMat.SetFloat("_WaterLevel", (float)Planet.liquid.level);

            // camera
            var cam = Camera.main != null ? Camera.main : new GameObject("Main Camera", typeof(Camera), typeof(AudioListener)) { tag = "MainCamera" }.GetComponent<Camera>();
            cam.nearClipPlane = 0.1f; cam.farClipPlane = 60000f;

            // player
            var pgo = new GameObject("Player");
            Player = pgo.AddComponent<SphericalPlayer>();
            Player.Field = Field; Player.Radius = PlanetRadius; Player.Gravity = (float)Planet.gravity; Player.LiquidLevel = (float)Planet.liquid.level;
            Vec3d spawn = Anchor.FromLocal(Planet.landingSite.x - 6, Planet.landingSite.z + 4);
            var startTxt = Resources.Load<TextAsset>("Authored/start");
            if (startTxt != null) { var q = startTxt.text.Trim().Split(' '); if (q.Length >= 3) spawn = new Vec3d(double.Parse(q[0], System.Globalization.CultureInfo.InvariantCulture), double.Parse(q[1], System.Globalization.CultureInfo.InvariantCulture), double.Parse(q[2], System.Globalization.CultureInfo.InvariantCulture)).Normalized; }
            Vector3 northHint = new Vector3((float)Anchor.North.x, (float)Anchor.North.y, (float)Anchor.North.z);
            Player.PlaceAt(spawn, northHint);
            if (AstronautPrefab != null)
            {
                var a = Instantiate(AstronautPrefab, pgo.transform);
                a.transform.localPosition = Vector3.zero; a.transform.localRotation = Quaternion.identity;
                foreach (var aa in a.GetComponentsInChildren<AstronautAnimator>()) aa.Bind(Player);
            }

            Rig = cam.GetComponent<SphericalCameraRig>() ?? cam.gameObject.AddComponent<SphericalCameraRig>();
            Rig.Target = Player; Rig.Field = Field; Rig.Radius = PlanetRadius; Rig.Forward = Player.FacingDir; Rig.Pitch = 14f;
            cam.transform.position = Player.transform.position + Player.Up * 5f;      // viewer for the first quadtree selection

            // surface
            var treeGo = new GameObject("PlanetSurface");
            Tree = treeGo.AddComponent<PlanetQuadtree>();
            Tree.Radius = PlanetRadius; Tree.Field = Field; Tree.Mat = TerrainMat; Tree.Viewer = cam.transform; Tree.Paint = UseAuthoredWorld ? World : null;
            Tree.MaxLevel = Quality >= 3 ? 9 : Quality == 2 ? 9 : 8;
            Tree.BuildsPerFrame = Quality >= 3 ? 3 : 2;
            Tree.SplitFactor = Quality >= 3 ? 1.9f : Quality == 2 ? 1.6f : Quality == 1 ? 1.3f : 1.1f;
            Tree.MergeFactor = Tree.SplitFactor + 0.3f;
            Tree.Prewarm();

            // wind, authored props and controlled grass
            new GameObject("Wind").AddComponent<WindSystem>().transform.SetParent(transform);
            Props = new GameObject("Props").AddComponent<PropStreamer>(); Props.transform.SetParent(transform);
            Props.World = World; Props.Field = Field; Props.Radius = PlanetRadius;
            if (PropPrefabs != null) for (int i = 0; i < PropPrefabs.Length && i < PropKeys.Length; i++) Props.Library[PropKeys[i]] = PropPrefabs[i];
            if (EnableGrass && GrassMat != null)
            {
                Grass = new GameObject("Grass").AddComponent<SphereGrass>(); Grass.transform.SetParent(transform);
                Grass.Field = Field; Grass.World = World; Grass.Radius = PlanetRadius; Grass.Mat = GrassMat; Grass.WaterLevel = Planet.liquid.level;
                Grass.DrawRadius = Quality >= 3 ? 80f : Quality == 2 ? 60f : 40f; Grass.BladesPerSquareMetre = Quality >= 3 ? 12f : 8f;
            }

            // water
            var water = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            water.name = "Ocean"; Destroy(water.GetComponent<Collider>());
            water.transform.SetParent(transform);
            water.transform.localScale = Vector3.one * (float)(2.0 * (PlanetRadius + Planet.liquid.level));
            var mr = water.GetComponent<MeshRenderer>();
            mr.sharedMaterial = WaterMat; mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off; mr.receiveShadows = false;

            // sky + atmosphere
            RenderSettings.skybox = SkyMat;
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
            var sky = Planet.sky;
            RenderSettings.ambientLight = new Color(sky.horizon[0], sky.horizon[1], sky.horizon[2]) * 0.55f * sky.ambientScale;
            RenderSettings.fog = true; RenderSettings.fogMode = FogMode.ExponentialSquared;
            RenderSettings.fogColor = new Color(sky.horizon[0], sky.horizon[1], sky.horizon[2]) * 0.92f;
            RenderSettings.fogDensity = 0.00055f * sky.fogScale;
            if (Sun != null) { Sun.color = new Color(sky.sun[0], sky.sun[1], sky.sun[2]); Sun.intensity = 2.5f * sky.sunScale; Sun.shadows = LightShadows.Soft; Sun.shadowStrength = 0.92f; }
            if (SkyLight != null) { SkyLight.color = new Color(0.55f, 0.70f, 1f); SkyLight.intensity = 0.55f; SkyLight.shadows = LightShadows.None; }

            Input = new GameObject("Input").AddComponent<GameInput>();
            Input.transform.SetParent(transform);
            UpdateAtmosphere(true);
            Ready = true;
            Debug.Log($"[GF] planet ready in {(Time.realtimeSinceStartup - t0):F2} s; R={PlanetRadius} m, patches {Tree.ActiveCount}, tris {Tree.Triangles}");
        }

        public Vec3d WorldDir(Vector3 p) => new Vec3d(p.x, p.y, p.z).Normalized;

        void Update()
        {
            if (!Ready) return;
            frameMs = Mathf.Lerp(frameMs, Time.unscaledDeltaTime * 1000f, 0.05f);
            if (SphereTestRunner.Active) return;
            var f = Input.Frame;
            Rig.Look(f.lookX, -f.lookY);
            Player.Tick(Mathf.Min(Time.deltaTime, 0.05f), f, Rig.TangentForward, f.mine);
        }

        void LateUpdate()
        {
            if (!Ready) return;
            UpdateAtmosphere(false);
            var cam = Camera.main; Vector3 v = cam != null ? cam.transform.position : Player.transform.position;
            if (Grass != null) Grass.Tick(v, cam);
        }

        AuthoredWorld LoadAuthored()
        {
            var ta = Resources.Load<TextAsset>("Authored/aetherion.gfworld");
            if (ta != null && UseAuthoredWorld)
            {
                try { using (var ms = new MemoryStream(ta.bytes)) return AuthoredIO.Read(ms); }
                catch (System.Exception e) { Debug.LogError("[GF] authored world failed to load: " + e.Message); }
            }
            return new AuthoredWorld { PlanetId = "aetherion", BaseSeedAtAuthoring = WorldSeed };
        }

        void UpdateAtmosphere(bool snap)
        {
            Vector3 up = Player.Up;
            Vector3 east = Vector3.Cross(Vector3.up, up); if (east.sqrMagnitude < 0.01f) east = Vector3.Cross(Vector3.right, up);
            east.Normalize(); Vector3 north = Vector3.Cross(east, up);              // local frame
            var s = Planet.sky.sunDir;
            Vector3 target = (east * s[0] + up * s[1] + north * -s[2]).normalized;
            sunDir = snap ? target : Vector3.Slerp(sunDir, target, 1f - Mathf.Exp(-1.5f * Time.deltaTime));
            if (Sun != null) Sun.transform.rotation = Quaternion.LookRotation(-sunDir, up);
            if (SkyLight != null) SkyLight.transform.rotation = Quaternion.LookRotation(-up, Vector3.Cross(up, east));
            Vector3 camPos = Rig != null ? Rig.transform.position : Player.transform.position;
            Vector3 camUp = camPos.normalized;
            float alt = camPos.magnitude - (float)PlanetRadius;
            float atmo = Mathf.Clamp01(1f - (alt - 500f) / 4500f);               // sky/fog fade out between 0.5 km and 5 km
            RenderSettings.fogDensity = 0.00055f * Planet.sky.fogScale * atmo * atmo;
            Shader.SetGlobalVector(GUp, new Vector4(camUp.x, camUp.y, camUp.z, atmo));
            Shader.SetGlobalVector(GSun, sunDir);
        }

        void OnGUI()
        {
            if (!ShowDebugHud || !Ready) return;
            Vec3d d = WorldDir(Player.transform.position);
            CubeSphere.FromDirection(d, out int face, out double u, out double v);
            string lv = ""; for (int i = 0; i < Tree.LevelHistogram.Length; i++) if (Tree.LevelHistogram[i] > 0) lv += $"L{i}:{Tree.LevelHistogram[i]} ";
            hud = $"{frameMs:F1} ms ({1000f / Mathf.Max(0.01f, frameMs):F0} fps)\nface {face} u {u:F3} v {v:F3}   alt {Player.PosD.Length - PlanetRadius:F1} m\n" +
                  $"patches {Tree.ActiveCount} (want {Tree.DesiredCount}, queued {Tree.QueuedCount})  built {Tree.TotalBuilt}  released {Tree.TotalReleased}\n" +
                  $"{lv}\ntris {Tree.Triangles / 1000}k   mesh {Tree.MeshBytes / 1048576f:F1} MB   total {UnityEngine.Profiling.Profiler.GetTotalAllocatedMemoryLong() / 1048576} MB";
            var style = new GUIStyle(GUI.skin.label) { fontSize = 14, normal = { textColor = Color.white } };
            GUI.Label(new Rect(12, 8, 900, 120), hud, style);
        }
    }
}
