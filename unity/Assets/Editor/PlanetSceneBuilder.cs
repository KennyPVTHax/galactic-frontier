using System.IO;
using GF.Core;
using GF.Planet;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace GF.EditorTools
{
    /// <summary>Builds the spherical Aetherion prototype scene.  Unity -batchmode -executeMethod GF.EditorTools.PlanetSceneBuilder.BuildAll</summary>
    public static class PlanetSceneBuilder
    {
        const string Gen = "Assets/Generated";
        const string ScenePath = "Assets/Scenes/AetherionPlanet.unity";

        [MenuItem("Tools/Galactic Frontier/Build Planet Scene")]
        public static void BuildAll()
        {
            Directory.CreateDirectory(Gen);
            AssetDatabase.Refresh();
            AetherionBuilder.ConfigureRenderPipeline();
            var flatTerrain = AetherionBuilder.BuildTerrainMaterial();     // also (re)builds the texture arrays
            var flatWater = AetherionBuilder.BuildWaterMaterial();
            var astro = AstronautBuilder.Build();
            var rocks = AetherionBuilder.BuildRockPrefabs();
            var grass = AetherionBuilder.BuildGrassMaterial();
            Directory.CreateDirectory("Assets/Resources/Authored");
            var p = AetherionBuilder.LoadPlanet();

            var terrain = AetherionBuilder.MakeMaterial("Planet_Terrain", "GF/PlanetTerrain"); terrain.CopyPropertiesFromMaterial(flatTerrain);
            var water = AetherionBuilder.MakeMaterial("Planet_Water", "GF/PlanetWater"); water.CopyPropertiesFromMaterial(flatWater);
            var sky = AetherionBuilder.MakeMaterial("Planet_Sky", "GF/PlanetSky");
            sky.SetColor("_Zenith", AetherionBuilder.C(p.sky.zenith)); sky.SetColor("_Horizon", AetherionBuilder.C(p.sky.horizon));
            sky.SetColor("_GroundCol", AetherionBuilder.C(p.sky.ground, 1.4f)); sky.SetColor("_SunColor", AetherionBuilder.C(p.sky.sun));
            EditorUtility.SetDirty(terrain); EditorUtility.SetDirty(water); EditorUtility.SetDirty(sky);

            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

            var sunGo = new GameObject("Sun"); var sun = sunGo.AddComponent<Light>(); sun.type = LightType.Directional; sunGo.AddComponent<UniversalAdditionalLightData>();
            RenderSettings.sun = sun;
            var skyGo = new GameObject("Skylight"); var skyL = skyGo.AddComponent<Light>(); skyL.type = LightType.Directional; skyGo.AddComponent<UniversalAdditionalLightData>();

            var camGo = new GameObject("Main Camera") { tag = "MainCamera" };
            var cam = camGo.AddComponent<Camera>(); cam.clearFlags = CameraClearFlags.Skybox; cam.fieldOfView = 62f; camGo.AddComponent<AudioListener>();
            var cd = camGo.AddComponent<UniversalAdditionalCameraData>(); cd.renderPostProcessing = true; cd.antialiasing = AntialiasingMode.SubpixelMorphologicalAntiAliasing;

            var profile = AssetDatabase.LoadAssetAtPath<VolumeProfile>($"{Gen}/Aetherion_Volume.asset");
            if (profile != null)
            {
                var volGo = new GameObject("Global Volume"); var vol = volGo.AddComponent<Volume>(); vol.isGlobal = true; vol.sharedProfile = profile; vol.priority = 1;
            }

            var bgo = new GameObject("Planet");
            var boot = bgo.AddComponent<PlanetBootstrap>();
            boot.PlanetJson = AssetDatabase.LoadAssetAtPath<TextAsset>("Assets/GameData/aetherion.json");
            boot.TerrainMat = terrain; boot.WaterMat = water; boot.SkyMat = sky; boot.AstronautPrefab = astro; boot.Sun = sun; boot.SkyLight = skyL;
            boot.GrassMat = grass; boot.PropPrefabs = rocks; boot.PropKeys = System.Array.ConvertAll(rocks, r => r.name);
            bgo.AddComponent<SphereTestRunner>();

            Directory.CreateDirectory("Assets/Scenes");
            EditorSceneManager.SaveScene(scene, ScenePath);
            var scenes = new System.Collections.Generic.List<EditorBuildSettingsScene> { new EditorBuildSettingsScene(ScenePath, true) };
            if (File.Exists("Assets/Scenes/Aetherion.unity")) scenes.Add(new EditorBuildSettingsScene("Assets/Scenes/Aetherion.unity", true));
            EditorBuildSettings.scenes = scenes.ToArray();
            AssetDatabase.SaveAssets();
            Debug.Log("[GF] planet scene built: " + ScenePath);
        }

        [MenuItem("Tools/Galactic Frontier/Build Windows Planet Player")]
        public static void BuildWindows()
        {
            var opts = new BuildPlayerOptions
            {
                scenes = new[] { ScenePath },
                locationPathName = "Builds/WinPlanet/GalacticFrontierPlanet.exe",
                target = BuildTarget.StandaloneWindows64,
                options = BuildOptions.Development,
            };
            var rep = BuildPipeline.BuildPlayer(opts);
            Debug.Log("[GF] Windows planet build: " + rep.summary.result + ", " + rep.summary.totalSize / (1024 * 1024) + " MB");
            if (rep.summary.result != UnityEditor.Build.Reporting.BuildResult.Succeeded) EditorApplication.Exit(1);
        }
    }
}
