using System;

namespace GF.Core
{
    /// <summary>
    /// Bit-exact port of src/core/random.ts: mulberry32 PRNG, helpers and 2D simplex noise.
    /// All maths is IEEE double so results match the TypeScript game (golden-tested).
    /// </summary>
    public sealed class SeededRng
    {
        uint a;
        public SeededRng(uint seed) { a = seed; }

        public double Next()
        {
            unchecked
            {
                a += 0x6d2b79f5u;
                uint t = a;
                t = (uint)((int)(t ^ (t >> 15)) * (int)(t | 1u));
                t ^= t + (uint)((int)(t ^ (t >> 7)) * (int)(t | 61u));
                return (double)(t ^ (t >> 14)) / 4294967296.0;
            }
        }
    }

    public static class Mathx
    {
        public static double Clamp(double v, double lo, double hi) => v < lo ? lo : v > hi ? hi : v;
        public static double Lerp(double a, double b, double t) => a + (b - a) * t;
        public static double Smoothstep(double e0, double e1, double x)
        {
            double t = Clamp((x - e0) / (e1 - e0), 0, 1);
            return t * t * (3 - 2 * t);
        }
        public static double Hypot(double x, double y) => Math.Sqrt(x * x + y * y);
        /// <summary>JS "seed ^ k" on numbers, as an unsigned 32-bit value (>>> 0).</summary>
        public static uint XorSeed(double seed, uint k) => unchecked((uint)((int)(long)seed ^ (int)k));
    }

    public sealed class SimplexNoise
    {
        static readonly int[,] Grad2 = { { 1, 1 }, { -1, 1 }, { 1, -1 }, { -1, -1 }, { 1, 0 }, { -1, 0 }, { 0, 1 }, { 0, -1 } };
        readonly byte[] perm = new byte[512];

        public SimplexNoise(uint seed)
        {
            var rng = new SeededRng(seed);
            var p = new byte[256];
            for (int i = 0; i < 256; i++) p[i] = (byte)i;
            for (int i = 255; i > 0; i--)
            {
                int j = (int)Math.Floor(rng.Next() * (i + 1));
                (p[i], p[j]) = (p[j], p[i]);
            }
            for (int i = 0; i < 512; i++) perm[i] = p[i & 255];
        }

        static readonly double F2 = 0.5 * (Math.Sqrt(3) - 1);
        static readonly double G2 = (3 - Math.Sqrt(3)) / 6;

        public double Noise2(double xin, double yin)
        {
            double s = (xin + yin) * F2;
            int i = (int)Math.Floor(xin + s);
            int j = (int)Math.Floor(yin + s);
            double t = (i + j) * G2;
            double x0 = xin - (i - t);
            double y0 = yin - (j - t);
            int i1 = x0 > y0 ? 1 : 0;
            int j1 = x0 > y0 ? 0 : 1;
            double x1 = x0 - i1 + G2;
            double y1 = y0 - j1 + G2;
            double x2 = x0 - 1 + 2 * G2;
            double y2 = y0 - 1 + 2 * G2;
            int ii = i & 255;
            int jj = j & 255;
            double n0 = 0, n1 = 0, n2 = 0;
            double t0 = 0.5 - x0 * x0 - y0 * y0;
            if (t0 > 0)
            {
                int g = perm[ii + perm[jj]] & 7;
                t0 *= t0;
                n0 = t0 * t0 * (Grad2[g, 0] * x0 + Grad2[g, 1] * y0);
            }
            double t1 = 0.5 - x1 * x1 - y1 * y1;
            if (t1 > 0)
            {
                int g = perm[ii + i1 + perm[jj + j1]] & 7;
                t1 *= t1;
                n1 = t1 * t1 * (Grad2[g, 0] * x1 + Grad2[g, 1] * y1);
            }
            double t2 = 0.5 - x2 * x2 - y2 * y2;
            if (t2 > 0)
            {
                int g = perm[ii + 1 + perm[jj + 1]] & 7;
                t2 *= t2;
                n2 = t2 * t2 * (Grad2[g, 0] * x2 + Grad2[g, 1] * y2);
            }
            return 70 * (n0 + n1 + n2);
        }

        public double Fbm(double x, double y, int octaves, double lacunarity = 2, double gain = 0.5)
        {
            double amp = 1, freq = 1, sum = 0, norm = 0;
            for (int o = 0; o < octaves; o++)
            {
                sum += amp * Noise2(x * freq, y * freq);
                norm += amp;
                amp *= gain;
                freq *= lacunarity;
            }
            return sum / norm;
        }

        public double Ridged(double x, double y, int octaves)
        {
            double amp = 0.5, freq = 1, sum = 0, norm = 0, weight = 1;
            for (int o = 0; o < octaves; o++)
            {
                double n = 1 - Math.Abs(Noise2(x * freq, y * freq));
                n *= n * weight;
                weight = Math.Min(1, Math.Max(0, n * 2));
                sum += n * amp;
                norm += amp;
                amp *= 0.5;
                freq *= 2.1;
            }
            return sum / norm;
        }
    }
}
