using System;
using System.Collections.Generic;
using System.IO;
using GF.Core;
using GF.World;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.SceneManagement;

namespace GF.EditorTools
{
    /// <summary>
    /// One-click, reproducible build of the Aetherion slice: texture arrays, materials, rock prefabs (LODGroup),
    /// URP settings, post-processing, sky and the scene itself.
    ///   Unity -batchmode -projectPath unity -executeMethod GF.EditorTools.AetherionBuilder.BuildAll -quit
    /// Inputs come from scripts/premium (fetch-polyhaven.mjs, blender/convert_rocks.py, export-planet-data.ts).
    /// </summary>
    public static class AetherionBuilder
    {
        const string PH = "Assets/ThirdParty/PolyHaven";
        const string Gen = "Assets/Generated";
        static readonly string[] GroundLayers = { "forest_ground_04", "brown_mud_leaves_01", "aerial_rocks_02", "dry_ground_rocks" };
        static readonly string[] RockIds = { "namaqualand_boulder_02", "namaqualand_boulder_03", "namaqualand_boulder_05", "boulder_01", "namaqualand_cliff_01", "rock_07" };

        [MenuItem("Tools/Galactic Frontier/Build Aetherion Scene")]
        public static void BuildAll()
        {
            Directory.CreateDirectory(Gen);
            AssetDatabase.Refresh();
            ConfigureRenderPipeline();
            var terrainMat = BuildTerrainMaterial();
            var grassMat = BuildGrassMaterial();
            var waterMat = BuildWaterMaterial();
            var rocks = BuildRockPrefabs();
            AstronautBuilder.Build();
            BuildScene(terrainMat, grassMat, waterMat, rocks);
            AssetDatabase.SaveAssets();
            Debug.Log("[GF] Aetherion scene built: Assets/Scenes/Aetherion.unity");
        }

        // ------------------------------------------------------------------ render pipeline
        static void ConfigureRenderPipeline()
        {
            PlayerSettings.colorSpace = ColorSpace.Linear;
            var asset = GraphicsSettings.currentRenderPipeline as UniversalRenderPipelineAsset;
            if (asset == null) { Debug.LogWarning("[GF] No URP asset active; create the project from the Universal 3D template."); return; }
            asset.supportsCameraDepthTexture = true;      // water depth / foam
            asset.supportsHDR = true;
            asset.msaaSampleCount = 4;
            asset.shadowDistance = 160f;
            asset.shadowCascadeCount = 3;
            asset.shadowDepthBias = 1.2f;
            asset.shadowNormalBias = 1.6f;
            asset.mainLightShadowmapResolution = 4096;
            asset.shadowCascadeCount = 4;
            asset.renderScale = 1f;
            EditorUtility.SetDirty(asset);
        }

        // ------------------------------------------------------------------ textures / materials
        static Texture2DArray BuildArray(string suffix, bool srgb, string assetName)
        {
            string path = $"{Gen}/{assetName}.asset";
            var existing = AssetDatabase.LoadAssetAtPath<Texture2DArray>(path);
            if (existing != null) AssetDatabase.DeleteAsset(path);
            Texture2DArray arr = null;
            for (int i = 0; i < GroundLayers.Length; i++)
            {
                string id = GroundLayers[i];
                string file = $"{PH}/Textures/{id}/{id}_{suffix}_1k.jpg";
                var tmp = new Texture2D(2, 2, TextureFormat.RGBA32, false, !srgb);
                if (!ImageConversion.LoadImage(tmp, File.ReadAllBytes(file))) throw new Exception("cannot load " + file);
                if (arr == null)
                {
                    arr = new Texture2DArray(tmp.width, tmp.height, GroundLayers.Length, TextureFormat.RGBA32, true, !srgb)
                    { wrapMode = TextureWrapMode.Repeat, filterMode = FilterMode.Trilinear, anisoLevel = 8 };
                }
                arr.SetPixels32(tmp.GetPixels32(), i, 0);
                UnityEngine.Object.DestroyImmediate(tmp);
            }
            arr.Apply(true, false);
            AssetDatabase.CreateAsset(arr, path);
            return arr;
        }

        static Color C(float[] c, float mul = 1f) => new Color(c[0] * mul, c[1] * mul, c[2] * mul, 1f);

        static Material MakeMaterial(string name, string shader)
        {
            string path = $"{Gen}/{name}.mat";
            var sh = Shader.Find(shader) ?? throw new Exception("shader not found: " + shader);
            var m = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (m == null) { m = new Material(sh); AssetDatabase.CreateAsset(m, path); } else m.shader = sh;
            return m;
        }

        static PlanetData LoadPlanet() => PlanetData.FromJson(File.ReadAllText("Assets/GameData/aetherion.json"));

        static Material BuildTerrainMaterial()
        {
            var p = LoadPlanet();
            var m = MakeMaterial("Aetherion_Terrain", "GF/Terrain");
            m.SetTexture("_DiffArr", BuildArray("diff", true, "Ground_Diff"));
            m.SetTexture("_NorArr", BuildArray("nor_gl", false, "Ground_Nor"));
            m.SetTexture("_ArmArr", BuildArray("arm", false, "Ground_Arm"));
            // alien palette: gentle tint of the (temperate) photoscans toward the planet's greens / ochres
            m.SetColor("_Tint0", new Color(0.56f, 0.70f, 0.40f));
            m.SetColor("_Tint1", new Color(0.46f, 0.66f, 0.34f));
            m.SetColor("_Tint2", Color.Lerp(C(p.palette.rock, 1.9f), Color.white, 0.55f));
            m.SetColor("_Tint3", Color.Lerp(C(p.palette.basin, 2.4f), new Color(0.78f, 0.74f, 0.66f), 0.6f));
            m.SetColor("_PeakColor", C(p.palette.peak));
            m.SetFloat("_WaterLevel", (float)p.liquid.level);
            m.SetVector("_PeakRange", new Vector4(95, 150, 0, 0));
            EditorUtility.SetDirty(m);
            return m;
        }

        static Material BuildGrassMaterial()
        {
            var p = LoadPlanet();
            var m = MakeMaterial("Aetherion_Grass", "GF/Grass");
            m.SetColor("_BaseColor", new Color(0.07f, 0.15f, 0.05f));
            m.SetColor("_TipColor", new Color(0.58f, 0.78f, 0.24f));
            m.SetColor("_AccentColor", new Color(0.10f, 0.66f, 0.58f));
            m.SetFloat("_FadeStart", 62f); m.SetFloat("_FadeEnd", 100f);
            EditorUtility.SetDirty(m);
            return m;
        }

        static Material BuildWaterMaterial()
        {
            var p = LoadPlanet();
            var m = MakeMaterial("Aetherion_Water", "GF/Water");
            m.SetColor("_DeepColor", C(p.liquid.color, 0.9f));
            m.SetColor("_ShallowColor", Color.Lerp(C(p.liquid.color, 3.2f), new Color(0.12f, 0.46f, 0.44f), 0.55f));
            EditorUtility.SetDirty(m);
            return m;
        }

        // ------------------------------------------------------------------ rocks
        static GameObject[] BuildRockPrefabs()
        {
            Directory.CreateDirectory($"{Gen}/Prefabs");
            var list = new List<GameObject>();
            foreach (var id in RockIds)
            {
                string l0 = $"{Gen}/Rocks/{id}_LOD0.fbx";
                if (!File.Exists(l0)) { Debug.LogWarning("[GF] missing rock FBX: " + l0); continue; }
                var mat = MakeMaterial($"Rock_{id}", "GF/Rock");
                mat.SetTexture("_BaseMap", AssetDatabase.LoadAssetAtPath<Texture2D>($"{Gen}/Rocks/{id}_diff_1k.jpg"));
                mat.SetTexture("_BumpMap", AssetDatabase.LoadAssetAtPath<Texture2D>($"{Gen}/Rocks/{id}_nor_gl_1k.jpg"));
                mat.SetTexture("_ArmMap", AssetDatabase.LoadAssetAtPath<Texture2D>($"{Gen}/Rocks/{id}_arm_1k.jpg"));
                mat.SetColor("_MossColor", new Color(0.18f, 0.32f, 0.12f));
                mat.SetFloat("_MossAmount", id.Contains("cliff") ? 0.28f : 0.45f);
                EditorUtility.SetDirty(mat);

                var root = new GameObject("Rock_" + id);
                var lods = new List<LOD>();
                float[] screen = { 0.35f, 0.10f, 0.02f };
                for (int i = 0; i < 3; i++)
                {
                    var model = AssetDatabase.LoadAssetAtPath<GameObject>($"{Gen}/Rocks/{id}_LOD{i}.fbx");
                    if (model == null) continue;
                    var inst = (GameObject)PrefabUtility.InstantiatePrefab(model, root.transform);
                    inst.name = $"LOD{i}";
                    var rends = inst.GetComponentsInChildren<MeshRenderer>();
                    foreach (var r in rends) { r.sharedMaterial = mat; r.shadowCastingMode = i < 2 ? ShadowCastingMode.On : ShadowCastingMode.Off; }
                    lods.Add(new LOD(screen[i], rends));
                }
                var group = root.AddComponent<LODGroup>();
                group.SetLODs(lods.ToArray());
                group.RecalculateBounds();
                string pp = $"{Gen}/Prefabs/Rock_{id}.prefab";
                var prefab = PrefabUtility.SaveAsPrefabAsset(root, pp);
                UnityEngine.Object.DestroyImmediate(root);
                list.Add(prefab);
            }
            return list.ToArray();
        }

        // ------------------------------------------------------------------ scene
        static void BuildScene(Material terrain, Material grass, Material water, GameObject[] rocks)
        {
            var p = LoadPlanet();
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

            // sky + environment
            var sky = new Material(Shader.Find("Skybox/Procedural"));
            sky.SetFloat("_SunSize", 0.045f); sky.SetFloat("_SunSizeConvergence", 6f);
            sky.SetFloat("_AtmosphereThickness", 1.08f);
            sky.SetColor("_SkyTint", new Color(0.46f, 0.58f, 0.78f));
            sky.SetColor("_GroundColor", C(p.sky.ground, 1.6f));
            sky.SetFloat("_Exposure", 1.25f);
            string skyPath = $"{Gen}/Aetherion_Sky.mat";
            AssetDatabase.DeleteAsset(skyPath);
            AssetDatabase.CreateAsset(sky, skyPath);
            RenderSettings.skybox = sky;
            RenderSettings.ambientMode = AmbientMode.Skybox;
            RenderSettings.defaultReflectionMode = DefaultReflectionMode.Skybox;
            RenderSettings.defaultReflectionResolution = 256;
            RenderSettings.reflectionIntensity = 1f;

            // sun
            var sunGo = new GameObject("Sun");
            var sun = sunGo.AddComponent<Light>();
            sun.type = LightType.Directional;
            sunGo.AddComponent<UniversalAdditionalLightData>();
            RenderSettings.sun = sun;

            // camera
            var camGo = new GameObject("Main Camera") { tag = "MainCamera" };
            var cam = camGo.AddComponent<Camera>();
            cam.clearFlags = CameraClearFlags.Skybox;
            cam.fieldOfView = 62f;
            camGo.AddComponent<AudioListener>();
            var cd = camGo.AddComponent<UniversalAdditionalCameraData>();
            cd.renderPostProcessing = true;
            cd.antialiasing = AntialiasingMode.SubpixelMorphologicalAntiAliasing;

            // post-processing volume
            var profile = ScriptableObject.CreateInstance<VolumeProfile>();
            var tm = profile.Add<Tonemapping>(true); tm.mode.Override(TonemappingMode.ACES);
            var bloom = profile.Add<Bloom>(true); bloom.threshold.Override(1.05f); bloom.intensity.Override(0.28f); bloom.scatter.Override(0.62f);
            var ca = profile.Add<ColorAdjustments>(true); ca.postExposure.Override(0.15f); ca.contrast.Override(10f); ca.saturation.Override(8f);
            var vg = profile.Add<Vignette>(true); vg.intensity.Override(0.16f); vg.smoothness.Override(0.5f);
            string vpPath = $"{Gen}/Aetherion_Volume.asset";
            AssetDatabase.DeleteAsset(vpPath);
            AssetDatabase.CreateAsset(profile, vpPath);
            var volGo = new GameObject("Global Volume");
            var vol = volGo.AddComponent<Volume>(); vol.isGlobal = true; vol.sharedProfile = profile; vol.priority = 1;

            // bootstrap
            var bgo = new GameObject("Aetherion");
            var boot = bgo.AddComponent<AetherionBootstrap>();
            boot.PlanetJson = AssetDatabase.LoadAssetAtPath<TextAsset>("Assets/GameData/aetherion.json");
            boot.TerrainMaterial = terrain; boot.GrassMaterial = grass; boot.WaterMaterial = water;
            boot.RockPrefabs = rocks; boot.Sun = sun;
            var ph = MakeMaterial("Placeholder", "Universal Render Pipeline/Lit"); ph.SetColor("_BaseColor", new Color(0.85f, 0.87f, 0.9f)); boot.PlaceholderMaterial = ph;
            bgo.AddComponent<AutoCapture>();
            string astro = $"{Gen}/Prefabs/Astronaut.prefab";
            if (File.Exists(astro)) boot.AstronautPrefab = AssetDatabase.LoadAssetAtPath<GameObject>(astro);

            Directory.CreateDirectory("Assets/Scenes");
            string sp = "Assets/Scenes/Aetherion.unity";
            EditorSceneManager.SaveScene(scene, sp);
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(sp, true) };
        }

        // ------------------------------------------------------------------ player builds
        [MenuItem("Tools/Galactic Frontier/Build Windows Capture Player")]
        public static void BuildWindows()
        {
            var opts = new BuildPlayerOptions
            {
                scenes = new[] { "Assets/Scenes/Aetherion.unity" },
                locationPathName = "Builds/Win/GalacticFrontier.exe",
                target = BuildTarget.StandaloneWindows64,
                options = BuildOptions.Development,
            };
            var rep = BuildPipeline.BuildPlayer(opts);
            Debug.Log("[GF] Windows build: " + rep.summary.result + ", " + rep.summary.totalSize / (1024 * 1024) + " MB");
            if (rep.summary.result != UnityEditor.Build.Reporting.BuildResult.Succeeded) EditorApplication.Exit(1);
        }

        [MenuItem("Tools/Galactic Frontier/Build Android APK (debug)")]
        public static void BuildAndroid()
        {
            PlayerSettings.SetApplicationIdentifier(UnityEditor.Build.NamedBuildTarget.Android, "com.orbitbtc.galacticfrontier.premium");
            PlayerSettings.productName = "Galactic Frontier";
            PlayerSettings.companyName = "OrbitBTC";
            PlayerSettings.SetScriptingBackend(UnityEditor.Build.NamedBuildTarget.Android, ScriptingImplementation.IL2CPP);
            PlayerSettings.Android.targetArchitectures = AndroidArchitecture.ARM64;
            PlayerSettings.Android.minSdkVersion = AndroidSdkVersions.AndroidApiLevel28;
            PlayerSettings.SetUseDefaultGraphicsAPIs(BuildTarget.Android, false);
            PlayerSettings.SetGraphicsAPIs(BuildTarget.Android, new[] { GraphicsDeviceType.Vulkan });
            var opts = new BuildPlayerOptions
            {
                scenes = new[] { "Assets/Scenes/Aetherion.unity" },
                locationPathName = "Builds/Android/GalacticFrontier-debug.apk",
                target = BuildTarget.Android,
                options = BuildOptions.Development,
            };
            var rep = BuildPipeline.BuildPlayer(opts);
            Debug.Log("[GF] Android build: " + rep.summary.result + ", " + rep.summary.totalSize / (1024 * 1024) + " MB");
            if (rep.summary.result != UnityEditor.Build.Reporting.BuildResult.Succeeded) EditorApplication.Exit(1);
        }
    }

    /// <summary>Import settings for generated/third-party assets so builds are deterministic.</summary>
    public sealed class GfAssetPostprocessor : AssetPostprocessor
    {
        void OnPreprocessModel()
        {
            if (!assetPath.StartsWith("Assets/Generated/Rocks")) return;
            var mi = (ModelImporter)assetImporter;
            mi.materialImportMode = ModelImporterMaterialImportMode.None;
            mi.importTangents = ModelImporterTangents.CalculateMikk;
            mi.importNormals = ModelImporterNormals.Import;
            mi.meshCompression = ModelImporterMeshCompression.Off;
            mi.importCameras = false; mi.importLights = false; mi.importBlendShapes = false; mi.importVisibility = false;
            mi.isReadable = false;
        }

        void OnPreprocessTexture()
        {
            if (assetPath.StartsWith("Assets/Generated/Astronaut/Textures"))
            {
                var at = (TextureImporter)assetImporter;
                at.sRGBTexture = assetPath.Contains("_base");
                at.textureType = TextureImporterType.Default;
                at.maxTextureSize = 2048; at.mipmapEnabled = true; at.anisoLevel = 8;
                at.textureCompression = TextureImporterCompression.CompressedHQ;
                return;
            }
            if (!(assetPath.StartsWith("Assets/Generated/Rocks") || assetPath.StartsWith("Assets/ThirdParty/PolyHaven"))) return;
            var ti = (TextureImporter)assetImporter;
            bool colour = assetPath.Contains("_diff_");
            ti.sRGBTexture = colour;
            ti.textureType = TextureImporterType.Default;
            ti.maxTextureSize = 1024;
            ti.mipmapEnabled = true;
            ti.anisoLevel = 8;
            ti.textureCompression = TextureImporterCompression.CompressedHQ;
        }
    }
}
