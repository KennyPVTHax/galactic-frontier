using System;
using GF.Core;

namespace GF.Planet
{
    /// <summary>Deterministic 3D simplex noise (Gustavson) for sphere-surface terrain; double precision, integer-seeded.</summary>
    public sealed class Noise3D
    {
        static readonly int[][] Grad = {
            new[]{1,1,0}, new[]{-1,1,0}, new[]{1,-1,0}, new[]{-1,-1,0}, new[]{1,0,1}, new[]{-1,0,1},
            new[]{1,0,-1}, new[]{-1,0,-1}, new[]{0,1,1}, new[]{0,-1,1}, new[]{0,1,-1}, new[]{0,-1,-1} };
        readonly byte[] perm = new byte[512];
        readonly byte[] permMod12 = new byte[512];

        public Noise3D(uint seed)
        {
            var rng = new SeededRng(seed);
            var p = new byte[256];
            for (int i = 0; i < 256; i++) p[i] = (byte)i;
            for (int i = 255; i > 0; i--) { int j = (int)Math.Floor(rng.Next() * (i + 1)); (p[i], p[j]) = (p[j], p[i]); }
            for (int i = 0; i < 512; i++) { perm[i] = p[i & 255]; permMod12[i] = (byte)(perm[i] % 12); }
        }

        const double F3 = 1.0 / 3.0, G3 = 1.0 / 6.0;

        public double Noise(double xin, double yin, double zin)
        {
            double s = (xin + yin + zin) * F3;
            int i = (int)Math.Floor(xin + s), j = (int)Math.Floor(yin + s), k = (int)Math.Floor(zin + s);
            double t = (i + j + k) * G3;
            double x0 = xin - (i - t), y0 = yin - (j - t), z0 = zin - (k - t);
            int i1, j1, k1, i2, j2, k2;
            if (x0 >= y0)
            {
                if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
                else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
                else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
            }
            else
            {
                if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
                else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
                else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
            }
            double x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
            double x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
            double x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
            int ii = i & 255, jj = j & 255, kk = k & 255;
            double n0 = Corner(x0, y0, z0, permMod12[ii + perm[jj + perm[kk]]]);
            double n1 = Corner(x1, y1, z1, permMod12[ii + i1 + perm[jj + j1 + perm[kk + k1]]]);
            double n2 = Corner(x2, y2, z2, permMod12[ii + i2 + perm[jj + j2 + perm[kk + k2]]]);
            double n3 = Corner(x3, y3, z3, permMod12[ii + 1 + perm[jj + 1 + perm[kk + 1]]]);
            return 77.0 * (n0 + n1 + n2 + n3);
        }

        static double Corner(double x, double y, double z, int gi)
        {
            double t = 0.5 - x * x - y * y - z * z;
            if (t < 0) return 0;
            t *= t;
            var g = Grad[gi];
            return t * t * (g[0] * x + g[1] * y + g[2] * z);
        }

        public double Fbm(double x, double y, double z, int octaves, double lac = 2.0, double gain = 0.5)
        {
            double amp = 1, f = 1, sum = 0, norm = 0;
            for (int o = 0; o < octaves; o++) { sum += amp * Noise(x * f, y * f, z * f); norm += amp; amp *= gain; f *= lac; }
            return sum / norm;
        }

        public double Ridged(double x, double y, double z, int octaves)
        {
            double amp = 0.5, f = 1, sum = 0, norm = 0, w = 1;
            for (int o = 0; o < octaves; o++)
            {
                double n = 1 - Math.Abs(Noise(x * f, y * f, z * f)); n *= n * w;
                w = Math.Min(1, Math.Max(0, n * 2));
                sum += n * amp; norm += amp; amp *= 0.5; f *= 2.1;
            }
            return sum / norm;
        }
    }
}
