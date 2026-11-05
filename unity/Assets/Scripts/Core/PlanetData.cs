using System;
#if UNITY_5_3_OR_NEWER
using UnityEngine;
#endif

namespace GF.Core
{
    /// <summary>JSON shape written by scripts/premium/export-planet-data.ts (source of truth = TypeScript game).</summary>
    [Serializable]
    public class TerrainParams
    {
        // Required by every planet
        public double baseAmp, detailAmp, ridgeAmp, mountainAmp;
        public int craters;
        // Optional with TS defaults (terrainNum fallbacks)
        public double baseScale = 380, detailScale = 90, ridgeScale = 260, mountainScale = 170;
        public double mountainStart = 540, mountainEnd = 780, mountainBase = 35, craterSpread = 480;
        public double flatInner = 30, flatOuter = 75, warp = 0, terraces = 0, terraceStep = 12, dunes = 0;
        public double rivers = 0, riverWidth = 0.025, riverDepth = 3, calderas = 0;
        public double basins = 0, basinMin = 40, basinRange = 50, basinDepth = 4, siteLift = 0;
        public bool siteCrater = false, poiPads = false;
        public TerrainParams ShallowClone() => (TerrainParams)MemberwiseClone();
    }

    [Serializable] public class LiquidDef { public string kind; public double level; public float[] color; public float emissive; }
    [Serializable] public class SiteDef { public string name; public double x, z, radius; }
    [Serializable] public class ArrivalDef { public double x, y, z, yaw; }
    [Serializable] public class PoiData { public string id, name, kind; public double x, z; }
    [Serializable] public class SkyData
    {
        public float[] zenith, horizon, ground, sun, sunDir;
        public float stars, fogScale, sunScale, ambientScale;
    }
    [Serializable] public class PaletteData { public float[] low, mid, rock, peak, basin; }
    [Serializable] public class WeatherData { public string kind; public float intensity; }

    [Serializable]
    public class PlanetData
    {
        public string id, name;
        public double seed;
        public double terrainSize, walkRadius, flightRadius, maxAltitude, gravity;
        public LiquidDef liquid;
        public SiteDef landingSite;
        public ArrivalDef arrival;
        public WeatherData weather;
        public SkyData sky;
        public TerrainParams terrain;
        public PaletteData palette;
        public PoiData[] pois;

        /// <summary>Same planet without the artificial edge-mountain ring (identical for r &lt; 540 m).</summary>
        public PlanetData CloneNoMountains()
        {
            var p = (PlanetData)MemberwiseClone();
            p.terrain = terrain.ShallowClone();
            p.terrain.mountainAmp = 0; p.terrain.mountainBase = 0;
            return p;
        }

#if UNITY_5_3_OR_NEWER
        public static PlanetData FromJson(string json) => JsonUtility.FromJson<PlanetData>(json);
#endif
    }
}
