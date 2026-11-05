using System;
using System.IO;
using GF.Core;
using NUnit.Framework;
using UnityEngine;

namespace GF.Tests
{
    /// <summary>
    /// Proves the C# terrain port reproduces the TypeScript game: same RNG, same noise, same heights at the
    /// golden sample points (including every Aetherion POI and the landing site). Golden data is produced by
    /// scripts/premium/export-planet-data.ts.
    /// </summary>
    public class TerrainParityTests
    {
        [Serializable] class Pt { public double x, z, h; }
        [Serializable] class NPt { public double x, y, n, f, r; }
        [Serializable] class Golden { public double seed; public double[] rngSeq; public NPt[] noiseSamples; public Pt[] heights; }

        static string DataPath(string file) => Path.GetFullPath(Path.Combine(Application.dataPath, "GameData", file));

        PlanetData planet;
        Golden golden;
        TerrainModel model;

        [OneTimeSetUp]
        public void Load()
        {
            planet = PlanetData.FromJson(File.ReadAllText(DataPath("aetherion.json")));
            golden = JsonUtility.FromJson<Golden>(File.ReadAllText(DataPath("aetherion.golden.json")));
            model = new TerrainModel(planet);
        }

        [Test] public void Rng_MatchesMulberry32()
        {
            var r = new SeededRng(12345);
            for (int i = 0; i < golden.rngSeq.Length; i++)
                Assert.AreEqual(golden.rngSeq[i], r.Next(), 0.0, $"rng[{i}]");
        }

        [Test] public void Noise_MatchesSimplex()
        {
            foreach (var s in golden.noiseSamples)
            {
                Assert.AreEqual(s.n, model.NoiseAt(s.x / 50, s.y / 50), 1e-9);
                Assert.AreEqual(s.f, model.FbmAt(s.x / 80, s.y / 80, 5), 1e-9);
                Assert.AreEqual(s.r, model.RidgedAt(s.x / 90, s.y / 90, 4), 1e-9);
            }
        }

        [Test] public void Heights_MatchTypeScript()
        {
            double worst = 0;
            foreach (var p in golden.heights)
            {
                double d = Math.Abs(model.Height(p.x, p.z) - p.h);
                worst = Math.Max(worst, d);
                Assert.Less(d, 1e-6, $"height at ({p.x:F2},{p.z:F2}) ts={p.h} cs={model.Height(p.x, p.z)}");
            }
            TestContext.WriteLine($"max |dh| over {golden.heights.Length} samples = {worst:E2} m");
        }

        [Test] public void Features_MatchPlacement()
        {
            Assert.AreEqual(7, model.Basins.Count, "basins");
            Assert.AreEqual(6, model.Pads.Count, "poi pads");
            Assert.AreEqual(2, model.Craters.Count, "craters");
        }
    }
}
