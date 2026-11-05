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
        public Material PlaceholderMaterial;
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
                foreach (var aa in a.GetComponentsInChildren<AstronautAnimator>()) aa.Player = Player;
            }
            else BuildPlaceholderAstronaut(pgo.transform, PlaceholderMaterial);

            var terrain = new GameObject("Terrain").AddComponent<PlanetTerrain>();
            terrain.transform.SetParent(transform);
            terrain.Map = Map; terrain.TerrainMaterial = TerrainMaterial; terrain.Viewer = Player.transform;
            ApplyQuality(terrain);
            terrain.Build();

            bool Flag(string f) => System.Array.Exists(System.Environment.GetCommandLineArgs(), a => a == f);
            if (!Flag("-gfnowater")) BuildWater();

            var grass = new GameObject("Grass").AddComponent<GrassField>();
            grass.enabled = !Flag("-gfnograss");
            grass.transform.SetParent(transform);
            grass.Map = Map; grass.Mat = GrassMaterial; grass.Viewer = Player.transform;
            grass.WaterLevel = Planet.liquid.level;
            grass.NoGrassCentre = new Vector2((float)Planet.landingSite.x, (float)Planet.landingSite.z);
            grass.NoGrassRadius = 4f;
            Grass = grass;
            ApplyQuality(grass);

            if (!System.Array.Exists(System.Environment.GetCommandLineArgs(), a => a == "-gfnorocks")) ScatterRocks();
            if (System.Array.Exists(System.Environment.GetCommandLineArgs(), a => a == "-gfnopost")) foreach (var v in FindObjectsByType<UnityEngine.Rendering.Volume>(FindObjectsSortMode.None)) v.enabled = false;

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
            t.LodDistances = Quality >= 3 ? new[] { 120f, 300f, 1100f, 3000f } : Quality == 2 ? new[] { 100f, 240f, 900f, 3000f } : new[] { 80f, 180f, 600f, 1500f };
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
            RenderSettings.ambientIntensity = sky.ambientScale * 1.45f;
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
            var site = new Vector3((float)Planet.landingSite.x, 0, (float)Planet.landingSite.z);
            var keepOut = new List<Vector3> { site };
            foreach (var p in Planet.pois) keepOut.Add(new Vector3((float)p.x, 0, (float)p.z));
            var noise = new SimplexNoise(4242u);
            int placed = 0;

            var boulders = new List<GameObject>(); GameObject cliff = null, pebble = null;
            foreach (var pf in RockPrefabs)
            {
                if (pf.name.Contains("cliff")) cliff = pf; else if (pf.name.Contains("rock_07")) pebble = pf; else boulders.Add(pf);
            }
            if (boulders.Count == 0) return;

            void Put(GameObject prefab, float x, float z, float scale, float sink, bool collide)
            {
                float y = Map.Height(x, z);
                var rot = Quaternion.Euler((float)rng.Next() * 7f - 3.5f, (float)rng.Next() * 360f, (float)rng.Next() * 7f - 3.5f);
                var go = Instantiate(prefab, new Vector3(x, y - sink * scale, z), rot, root);
                go.transform.localScale = Vector3.one * scale;
                if (collide)
                {
                    var b = new Bounds(go.transform.position, Vector3.zero);
                    foreach (var r in go.GetComponentsInChildren<Renderer>()) b.Encapsulate(r.bounds);
                    Player.Colliders.Add(new RockCollider { x = x, z = z, r = Mathf.Min(b.extents.x, b.extents.z) * 0.8f, top = b.max.y - 0.1f * scale });
                }
                placed++;
            }

            bool Free(float x, float z, float clear)
            {
                if (Map.Height(x, z) < Planet.liquid.level + 0.3f) return false;
                foreach (var k in keepOut) if ((new Vector3(x, 0, z) - k).sqrMagnitude < clear * clear) return false;
                return true;
            }

            // 1) hero zone: clustered boulders + pebble fields around the landing site
            int heroTarget = Quality >= 2 ? 90 : 45, tries = 0, heroPlaced = 0;
            while (heroPlaced < heroTarget && tries++ < heroTarget * 60)
            {
                float ang = (float)rng.Next() * Mathf.PI * 2f, rad = Mathf.Lerp(22f, 230f, Mathf.Sqrt((float)rng.Next()));
                float x = site.x + Mathf.Cos(ang) * rad, z = site.z + Mathf.Sin(ang) * rad;
                float cluster = (float)noise.Noise2(x / 38.0, z / 38.0) * 0.5f + 0.5f;
                if ((float)rng.Next() > Mathf.Pow(cluster, 2.2f) * 1.6f) continue;
                if (!Free(x, z, 22f)) continue;
                var prefab = boulders[Mathf.Min(boulders.Count - 1, (int)((float)rng.Next() * boulders.Count))];
                float sc = Mathf.Lerp(0.7f, 2.4f, Mathf.Pow((float)rng.Next(), 1.8f));
                Put(prefab, x, z, sc, 0.14f, sc > 1.0f);
                int kids = sc > 1.4f ? 3 : 1;
                for (int k = 0; k < kids; k++)
                {
                    float a2 = (float)rng.Next() * Mathf.PI * 2f, d2 = (1.1f + (float)rng.Next() * 1.6f) * sc;
                    float xx = x + Mathf.Cos(a2) * d2, zz = z + Mathf.Sin(a2) * d2;
                    if (!Free(xx, zz, 20f)) continue;
                    Put(boulders[(int)((float)rng.Next() * boulders.Count) % boulders.Count], xx, zz, Mathf.Lerp(0.35f, 0.8f, (float)rng.Next()), 0.12f, false);
                }
                heroPlaced++;
            }
            if (pebble != null)
            {
                int pebbles = Quality >= 2 ? 900 : 350; tries = 0; int pp = 0;
                while (pp < pebbles && tries++ < pebbles * 12)
                {
                    float ang = (float)rng.Next() * Mathf.PI * 2f, rad = Mathf.Lerp(8f, 130f, Mathf.Sqrt((float)rng.Next()));
                    float x = site.x + Mathf.Cos(ang) * rad, z = site.z + Mathf.Sin(ang) * rad;
                    if (!Free(x, z, 9f)) continue;
                    Put(pebble, x, z, Mathf.Lerp(1.2f, 4.5f, Mathf.Pow((float)rng.Next(), 2f)), 0.3f, false);
                    pp++;
                }
            }

            // 2) global distribution: favours cliffs and ridges, a few meadow boulders
            int target = Quality >= 2 ? 200 : 90; tries = 0; int far = 0;
            while (far < target && tries++ < target * 50)
            {
                float x = ((float)rng.Next() * 2 - 1) * (float)Planet.walkRadius * 1.15f;
                float z = ((float)rng.Next() * 2 - 1) * (float)Planet.walkRadius * 1.15f;
                float slope = Map.Slope(x, z);
                float chance = Mathf.Lerp(0.05f, 1f, SmoothStep(0.05f, 0.3f, slope));
                if ((float)rng.Next() > chance || !Free(x, z, 30f)) continue;
                bool big = cliff != null && slope > 0.12f && (float)rng.Next() < 0.28f;
                var prefab = big ? cliff : boulders[Mathf.Min(boulders.Count - 1, (int)((float)rng.Next() * boulders.Count))];
                float sc = big ? Mathf.Lerp(1.2f, 3.2f, (float)rng.Next()) : Mathf.Lerp(0.6f, 3.0f, Mathf.Pow((float)rng.Next(), 2.0f));
                Put(prefab, x, z, sc, big ? 0.08f : 0.14f, sc > 1.0f);
                far++;
            }
            Debug.Log($"[GF] rocks placed: {placed} (hero boulders {heroPlaced}), colliders: {Player.Colliders.Count}");
        }

        static float SmoothStep(float e0, float e1, float x) { float t = Mathf.Clamp01((x - e0) / (e1 - e0)); return t * t * (3f - 2f * t); }

        /// <summary>Capsule stand-in so the slice is playable before the astronaut pipeline lands.</summary>
        static void BuildPlaceholderAstronaut(Transform parent, Material mat)
        {
            var body = GameObject.CreatePrimitive(PrimitiveType.Capsule);
            Destroy(body.GetComponent<Collider>());
            body.name = "PlaceholderAstronaut";
            if (mat != null) body.GetComponent<MeshRenderer>().sharedMaterial = mat;
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
