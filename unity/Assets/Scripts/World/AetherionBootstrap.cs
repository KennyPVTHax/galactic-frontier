using System.Collections.Generic;
using GF.Core;
using GF.Player;
using UnityEngine;
using UnityEngine.Rendering;

namespace GF.World
{
    /// <summary>
    /// Assembles the Aetherion vertical slice at runtime from canonical data (aetherion.json): terrain, water,
    /// wind grass, rocks, atmosphere, player and camera. Material/asset references are filled in by the editor
    /// scene builder (Tools/Galactic Frontier/Build Aetherion Scene) and serialised on this component.
    /// </summary>
    [DefaultExecutionOrder(-100)]
    public sealed class AetherionBootstrap : MonoBehaviour
    {
        [Header("Data")] public TextAsset PlanetJson;
        [Header("Materials")]
        public Material TerrainMaterial, GrassMaterial, WaterMaterial;
        [Header("Prefabs (optional until imported)")]
        public GameObject[] RockPrefabs;
        public GameObject AstronautPrefab;
        [Header("Look")]
        public Light Sun;
        public float HeightmapCell = 1.25f;
        [Range(0, 3)] public int Quality = 3;   // 0 low .. 3 extreme (flagship)

        public Heightmap Map { get; private set; }
        public PlanetData Planet { get; private set; }
        public PlayerController Player { get; private set; }
        public GrassField Grass { get; private set; }

        void Start()
        {
            var t0 = Time.realtimeSinceStartup;
            Planet = PlanetData.FromJson(PlanetJson.text);
            var model = new TerrainModel(Planet);
            Map = new Heightmap(model, (float)Planet.terrainSize, HeightmapCell);
            Debug.Log($"[GF] heightmap {Map.Res + 1}² baked in {(Time.realtimeSinceStartup - t0) * 1000f:F0} ms, range {Map.Min:F1}..{Map.Max:F1} m");

            SetupAtmosphere();

            var wind = new GameObject("Wind").AddComponent<WindSystem>();
            wind.transform.SetParent(transform);

            // player first (terrain LOD and grass follow it)
            var pgo = new GameObject("Player");
            Player = pgo.AddComponent<PlayerController>();
            Player.Map = Map;
            Player.Gravity = (float)Planet.gravity;
            Player.WalkRadius = (float)Planet.walkRadius;
            Player.LiquidLevel = (float)Planet.liquid.level;
            Player.Place((float)Planet.landingSite.x - 6f, (float)Planet.landingSite.z + 4f, 2.2f);
            if (AstronautPrefab != null)
            {
                var a = Instantiate(AstronautPrefab, pgo.transform);
                a.transform.localPosition = Vector3.zero; a.transform.localRotation = Quaternion.identity;
            }
            else BuildPlaceholderAstronaut(pgo.transform);

            var terrain = new GameObject("Terrain").AddComponent<PlanetTerrain>();
            terrain.transform.SetParent(transform);
            terrain.Map = Map; terrain.TerrainMaterial = TerrainMaterial; terrain.Viewer = Player.transform;
            ApplyQuality(terrain);
            terrain.Build();

            BuildWater();

            var grass = new GameObject("Grass").AddComponent<GrassField>();
            grass.transform.SetParent(transform);
            grass.Map = Map; grass.Mat = GrassMaterial; grass.Viewer = Player.transform;
            grass.WaterLevel = Planet.liquid.level;
            grass.NoGrassCentre = new Vector2((float)Planet.landingSite.x, (float)Planet.landingSite.z);
            Grass = grass;
            ApplyQuality(grass);

            ScatterRocks();

            var cam = Camera.main != null ? Camera.main : new GameObject("Main Camera", typeof(Camera), typeof(AudioListener)) { tag = "MainCamera" }.GetComponent<Camera>();
            cam.nearClipPlane = 0.1f; cam.farClipPlane = 2600f;
            var rig = cam.GetComponent<CameraRig>() ?? cam.gameObject.AddComponent<CameraRig>();
            rig.Target = Player.transform; rig.Map = Map; rig.Yaw = 200f;
            var input = new GameObject("Input").AddComponent<GameInput>();
            input.transform.SetParent(transform);
            var driver = new GameObject("Driver").AddComponent<PlayerDriver>();
            driver.Init(Player, rig, input);

            Debug.Log($"[GF] Aetherion ready in {(Time.realtimeSinceStartup - t0):F2} s");
        }

        void ApplyQuality(PlanetTerrain t)
        {
            t.LodDistances = Quality >= 3 ? new[] { 170f, 330f, 560f, 950f } : Quality == 2 ? new[] { 130f, 260f, 480f, 800f } : new[] { 90f, 190f, 380f, 650f };
        }

        void ApplyQuality(GrassField g)
        {
            switch (Quality)
            {
                case 3: g.DrawRadius = 105f; g.BladesPerSquareMetre = 16f; break;
                case 2: g.DrawRadius = 85f; g.BladesPerSquareMetre = 11f; break;
                case 1: g.DrawRadius = 60f; g.BladesPerSquareMetre = 7f; break;
                default: g.DrawRadius = 40f; g.BladesPerSquareMetre = 4f; break;
            }
        }

        void SetupAtmosphere()
        {
            var sky = Planet.sky;
            if (Sun != null)
            {
                Vector3 toSun = new Vector3(sky.sunDir[0], sky.sunDir[1], sky.sunDir[2]).normalized;
                Sun.transform.rotation = Quaternion.LookRotation(-toSun, Vector3.up);
                Sun.color = new Color(sky.sun[0], sky.sun[1], sky.sun[2]);
                Sun.intensity = 2.6f * sky.sunScale;
                Sun.shadows = LightShadows.Soft;
                Sun.shadowStrength = 0.92f;
            }
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.ExponentialSquared;
            RenderSettings.fogColor = new Color(sky.horizon[0], sky.horizon[1], sky.horizon[2]) * 0.92f;
            RenderSettings.fogDensity = 0.00055f * sky.fogScale;
            RenderSettings.ambientIntensity = sky.ambientScale;
        }

        void BuildWater()
        {
            if (WaterMaterial == null) return;
            var go = GameObject.CreatePrimitive(PrimitiveType.Quad);
            go.name = "Water";
            Destroy(go.GetComponent<Collider>());
            go.transform.SetParent(transform);
            go.transform.position = new Vector3(0, (float)Planet.liquid.level, 0);
            go.transform.rotation = Quaternion.Euler(90, 0, 0);
            go.transform.localScale = new Vector3((float)Planet.terrainSize, (float)Planet.terrainSize, 1);
            var mr = go.GetComponent<MeshRenderer>();
            mr.sharedMaterial = WaterMaterial; mr.shadowCastingMode = ShadowCastingMode.Off; mr.receiveShadows = false;
        }

        /// <summary>
        /// Deterministic rock scatter (own RNG stream, never touches gameplay RNG). Rocks register circle
        /// colliders with the player exactly like the TypeScript boulders.
        /// </summary>
        void ScatterRocks()
        {
            if (RockPrefabs == null || RockPrefabs.Length == 0) return;
            var rng = new SeededRng(0xA37E510u);
            var root = new GameObject("Rocks").transform; root.SetParent(transform);
            int placed = 0, tries = 0;
            int target = Quality >= 2 ? 260 : 120;
            var keepOut = new List<Vector3> { new Vector3((float)Planet.landingSite.x, 0, (float)Planet.landingSite.z) };
            foreach (var p in Planet.pois) keepOut.Add(new Vector3((float)p.x, 0, (float)p.z));
            while (placed < target && tries++ < target * 40)
            {
                float x = ((float)rng.Next() * 2 - 1) * (float)Planet.walkRadius * 1.15f;
                float z = ((float)rng.Next() * 2 - 1) * (float)Planet.walkRadius * 1.15f;
                float pick = (float)rng.Next(), yaw = (float)rng.Next() * 360f, sc = Mathf.Lerp(0.5f, 2.6f, Mathf.Pow((float)rng.Next(), 2.2f));
                float y = Map.Height(x, z);
                if (y < Planet.liquid.level + 0.3f) continue;
                float slope = Map.Slope(x, z);
                // prefer cliffs and ridges, but leave some boulders on meadows
                float chance = Mathf.Lerp(0.08f, 1f, Mathf.SmoothStep(0.05f, 0.3f, slope));
                if ((float)rng.Next() > chance) continue;
                bool blocked = false;
                foreach (var k in keepOut) if ((new Vector3(x, 0, z) - k).sqrMagnitude < 30f * 30f) { blocked = true; break; }
                if (blocked) continue;

                var prefab = RockPrefabs[Mathf.Min(RockPrefabs.Length - 1, (int)(pick * RockPrefabs.Length))];
                var go = Instantiate(prefab, new Vector3(x, y - 0.12f * sc, z), Quaternion.Euler((float)rng.Next() * 8f - 4f, yaw, (float)rng.Next() * 8f - 4f), root);
                go.transform.localScale = Vector3.one * sc;
                var b = new Bounds(go.transform.position, Vector3.zero);
                foreach (var r in go.GetComponentsInChildren<Renderer>()) b.Encapsulate(r.bounds);
                if (sc > 1.0f) Player.Colliders.Add(new RockCollider { x = x, z = z, r = Mathf.Min(b.extents.x, b.extents.z) * 0.8f, top = b.max.y - 0.1f * sc });
                placed++;
            }
            Debug.Log($"[GF] rocks placed: {placed}, colliders: {Player.Colliders.Count}");
        }

        /// <summary>Capsule stand-in so the slice is playable before the astronaut pipeline lands.</summary>
        static void BuildPlaceholderAstronaut(Transform parent)
        {
            var body = GameObject.CreatePrimitive(PrimitiveType.Capsule);
            Destroy(body.GetComponent<Collider>());
            body.name = "PlaceholderAstronaut";
            body.transform.SetParent(parent, false);
            body.transform.localPosition = new Vector3(0, 0.9f, 0);
            body.transform.localScale = new Vector3(0.6f, 0.9f, 0.6f);
        }
    }

    /// <summary>Glue: feeds input to the camera, then to the player (camera yaw defines movement direction).</summary>
    public sealed class PlayerDriver : MonoBehaviour
    {
        PlayerController player; CameraRig rig; GameInput input;
        public void Init(PlayerController p, CameraRig r, GameInput i) { player = p; rig = r; input = i; }
        void Update()
        {
            if (player == null) return;
            var f = input.Frame;
            rig.Look(f.lookX, -f.lookY);
            player.Tick(Mathf.Min(Time.deltaTime, 0.05f), f, rig.YawRadians, f.mine);
        }
    }
}
