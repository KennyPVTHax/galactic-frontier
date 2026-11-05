using System;
using System.Collections.Generic;
using static GF.Core.Mathx;

namespace GF.Core
{
    /// <summary>
    /// Faithful port of buildTerrainModel() in src/world/heightfield.ts. The order of every RNG draw and every
    /// height operation matches the TypeScript so resource deposits, POIs and mission targets stay valid.
    /// </summary>
    public sealed class TerrainModel
    {
        public sealed class Crater { public double x, z, r, depth, rim; }
        public sealed class Basin { public double x, z, r, floor; }
        public sealed class Caldera { public double x, z, r, h, pit; }
        public sealed class Pad { public double x, z, inner, outer, h; }
        struct Disc { public double x, z, r; }

        public readonly List<Crater> Craters = new List<Crater>();
        public readonly List<Basin> Basins = new List<Basin>();
        public readonly List<Caldera> Calderas = new List<Caldera>();
        public readonly List<Pad> Pads = new List<Pad>();
        public double SiteBase { get; private set; }
        public double LiquidLevel { get; }

        readonly SimplexNoise n;
        readonly TerrainParams T;
        readonly SiteDef site;
        readonly double level;

        public TerrainModel(PlanetData def)
        {
            T = def.terrain;
            site = def.landingSite;
            level = def.liquid.kind == "none" ? -1e6 : def.liquid.level;
            LiquidLevel = level;
            uint seed = (uint)(long)def.seed;
            n = new SimplexNoise(seed);
            var rng = new SeededRng(XorSeed(def.seed, 0x5eed));

            for (int i = 0; i < T.craters; i++)
            {
                double r = 18 + rng.Next() * 42;
                double x = (rng.Next() * 2 - 1) * T.craterSpread;
                double z = (rng.Next() * 2 - 1) * T.craterSpread;
                double depth = r * (0.18 + rng.Next() * 0.14);
                double rim = r * (0.06 + rng.Next() * 0.05);
                Craters.Add(new Crater { x = x, z = z, r = r, depth = depth, rim = rim });
            }
            if (T.siteCrater) Craters.Add(new Crater { x = site.x + 70, z = site.z - 55, r = 26, depth = 6, rim = 2.2 });

            // feature placement (own stream)
            var frng = new SeededRng(unchecked((uint)((int)(long)def.seed ^ 0xfea7)));
            var keepOut = new List<Disc> { new Disc { x = site.x, z = site.z, r = T.flatOuter + 25 } };
            foreach (var p in def.pois) keepOut.Add(new Disc { x = p.x, z = p.z, r = 34 });

            List<Disc> Place(int count, double minR, double maxR, Func<double> size, double margin)
            {
                var o = new List<Disc>();
                for (int i = 0; i < count; i++)
                {
                    for (int t = 0; t < 40; t++)
                    {
                        double r = size();
                        double a = frng.Next() * Math.PI * 2;
                        double d = minR + Math.Sqrt(frng.Next()) * (maxR - minR);
                        double x = Math.Cos(a) * d, z = Math.Sin(a) * d;
                        bool blocked = false;
                        foreach (var k in keepOut) if (Hypot(x - k.x, z - k.z) < k.r + r * margin) { blocked = true; break; }
                        if (blocked) continue;
                        foreach (var q in o) if (Hypot(x - q.x, z - q.z) < (q.r + r) * 1.15) { blocked = true; break; }
                        if (blocked) continue;
                        o.Add(new Disc { x = x, z = z, r = r });
                        break;
                    }
                }
                return o;
            }

            foreach (var c in Place((int)T.calderas, 220, 500, () => 85 + frng.Next() * 50, 1.5))
                Calderas.Add(new Caldera { x = c.x, z = c.z, r = c.r, h = 55 + frng.Next() * 50, pit = level - 2.5 });
            foreach (var c in Calderas) keepOut.Add(new Disc { x = c.x, z = c.z, r = c.r * 1.5 });
            foreach (var b in Place((int)T.basins, 90, 500, () => T.basinMin + frng.Next() * T.basinRange, 1.05))
                Basins.Add(new Basin { x = b.x, z = b.z, r = b.r, floor = level - T.basinDepth - frng.Next() * T.basinDepth * 0.5 });

            if (T.poiPads)
            {
                foreach (var p in def.pois)
                {
                    double inner = p.id == "kharon" ? 34 : 15, outer = inner + 22;
                    double s = 0;
                    for (int k = 0; k < 8; k++) s += Raw(p.x + Math.Cos(k * 0.785) * inner, p.z + Math.Sin(k * 0.785) * inner);
                    Pads.Add(new Pad { x = p.x, z = p.z, inner = inner, outer = outer,
                        h = Math.Max(Math.Max(s / 8, Raw(p.x, p.z) * 0.5 + (s / 8) * 0.5), level + 2.2) });
                }
            }

            SiteBase = n.Fbm(site.x / 380, site.z / 380, 2) * 6 + 2;
            if (!T.siteCrater) SiteBase = Math.Max(SiteBase + T.siteLift, level + 3.5);
        }

        double Raw(double x, double z)
        {
            double px = x, pz = z;
            if (T.warp > 0)
            {
                px = x + n.Noise2(x / 420 + 17, z / 420 - 4) * T.warp;
                pz = z + n.Noise2(x / 420 - 9, z / 420 + 23) * T.warp;
            }
            double h = n.Fbm(px / T.baseScale, pz / T.baseScale, 5) * T.baseAmp + n.Fbm(px / T.detailScale + 40, pz / T.detailScale - 13, 3) * T.detailAmp;
            double hillMask = Smoothstep(-0.1, 0.55, n.Noise2(px / 620 + 3.1, pz / 620 - 1.7));
            h += n.Ridged(px / T.ridgeScale + 11, pz / T.ridgeScale - 7, 4) * T.ridgeAmp * hillMask;
            double r = Math.Sqrt(x * x + z * z);
            double m = Smoothstep(T.mountainStart, T.mountainEnd, r);
            if (m > 0) h += (n.Ridged(px / T.mountainScale - 3, pz / T.mountainScale + 5, 5) * T.mountainAmp + T.mountainBase) * m;
            foreach (var c in Craters)
            {
                double dx = x - c.x, dz = z - c.z;
                double d2 = dx * dx + dz * dz;
                double lim = c.r * 1.8;
                if (d2 > lim * lim) continue;
                double d = Math.Sqrt(d2) / c.r;
                if (d < 1) h -= c.depth * (1 - d * d);
                double rimT = (d - 1) / 0.28;
                h += c.rim * Math.Exp(-rimT * rimT);
            }
            if (T.terraces > 0)
            {
                double q = h / T.terraceStep;
                double fl = Math.Floor(q);
                double tq = (fl + Smoothstep(0.3, 0.7, q - fl)) * T.terraceStep;
                h += (tq - h) * T.terraces * Smoothstep(4, 22, h);
            }
            if (T.dunes > 0) h += T.dunes * (n.Ridged(x / 46 + 5, z / 24 - 9, 2) - 0.5);
            if (T.rivers > 0 && r < 560)
            {
                double v = Math.Abs(n.Noise2(px / 340 + 7.7, pz / 340 - 3.3));
                double ch = (1 - Smoothstep(T.riverWidth * 0.45, T.riverWidth, v)) * T.rivers * (1 - Smoothstep(470, 560, r));
                if (ch > 0) h += (Math.Min(h, level - T.riverDepth) - h) * ch;
            }
            foreach (var c in Calderas)
            {
                double dx = x - c.x, dz = z - c.z;
                double d = Math.Sqrt(dx * dx + dz * dz) / c.r;
                if (d > 1.6) continue;
                double hh = c.h * (0.85 + 0.3 * n.Noise2(x / 35, z / 35));
                double cone = hh * Math.Pow(1 - Smoothstep(0.3, 1.6, d), 1.6);
                h += cone;
                double pitT = Smoothstep(0.32, 0.17, d);
                if (pitT > 0) h += (c.pit - h) * pitT;
            }
            foreach (var b in Basins)
            {
                double dx = x - b.x, dz = z - b.z;
                double d2 = dx * dx + dz * dz;
                if (d2 > b.r * b.r * 1.44) continue;
                double d = Math.Sqrt(d2) / b.r + n.Noise2(x / 45 + 3, z / 45 - 8) * 0.14;
                double w = Smoothstep(1.05, 0.6, d);
                if (w > 0) h += (Math.Min(h, b.floor + n.Noise2(x / 20, z / 20) * 0.6) - h) * w;
            }
            return h;
        }

        double PadFn(double x, double z)
        {
            double h = Raw(x, z);
            foreach (var p in Pads)
            {
                double dx = x - p.x, dz = z - p.z;
                double d2 = dx * dx + dz * dz;
                if (d2 >= p.outer * p.outer) continue;
                double f = 1 - Smoothstep(p.inner, p.outer, Math.Sqrt(d2));
                h = h * (1 - f) + p.h * f;
            }
            return h;
        }

        /// <summary>Terrain height (metres) at world (x, z). Pure function of the planet data.</summary>
        public double Height(double x, double z)
        {
            double h = PadFn(x, z);
            double dx = x - site.x, dz = z - site.z;
            double d = Math.Sqrt(dx * dx + dz * dz);
            double flat = 1 - Smoothstep(T.flatInner, T.flatOuter, d);
            if (flat <= 0) return h;
            double soft = SiteBase + n.Fbm(x / 60, z / 60, 2) * 0.8;
            return h * (1 - flat) + soft * flat;
        }

        // exposed for tests
        public double NoiseAt(double x, double y) => n.Noise2(x, y);
        public double FbmAt(double x, double y, int o) => n.Fbm(x, y, o);
        public double RidgedAt(double x, double y, int o) => n.Ridged(x, y, o);
    }
}
