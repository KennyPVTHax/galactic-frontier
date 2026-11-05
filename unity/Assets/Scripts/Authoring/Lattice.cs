using System;
using System.Collections.Generic;
using GF.Planet;

namespace GF.Authoring
{
    /// <summary>
    /// The fixed global authoring lattice: 32768 x 32768 points per cube face (~0.48 m at a face centre). A point is addressed
    /// by (face, i, j) but identified by an INTEGER key built from its three cube-axis indices, so the same physical point
    /// on a face edge or corner has exactly one key whichever face reaches it. No floating-point quantisation involved.
    /// </summary>
    public static class Lattice
    {
        public const int M = 32768, Half = M / 2;
        static readonly int[,] N = { { 1, 0, 0 }, { -1, 0, 0 }, { 0, 1, 0 }, { 0, -1, 0 }, { 0, 0, 1 }, { 0, 0, -1 } };
        static readonly int[,] U = { { 0, 0, -1 }, { 0, 0, 1 }, { 1, 0, 0 }, { 1, 0, 0 }, { 1, 0, 0 }, { -1, 0, 0 } };
        static readonly int[,] V = { { 0, 1, 0 }, { 0, 1, 0 }, { 0, 0, -1 }, { 0, 0, 1 }, { 0, 1, 0 }, { 0, 1, 0 } };

        public static long Key(int f, int i, int j)
        {
            int di = i - Half, dj = j - Half;
            int x = N[f, 0] * Half + U[f, 0] * di + V[f, 0] * dj;
            int y = N[f, 1] * Half + U[f, 1] * di + V[f, 1] * dj;
            int z = N[f, 2] * Half + U[f, 2] * di + V[f, 2] * dj;
            return ((long)(x + 16384) << 32) | ((long)(y + 16384) << 16) | (long)(z + 16384);
        }

        public static Vec3d PointDirection(int f, int i, int j) => CubeSphere.Direction(f, -1.0 + 2.0 * i / M, -1.0 + 2.0 * j / M);

        /// <summary>Fractional lattice coordinates of a direction on its own face.</summary>
        public static void Locate(Vec3d dir, out int face, out double fi, out double fj)
        {
            CubeSphere.FromDirection(dir, out face, out double u, out double v);
            fi = (u + 1) * 0.5 * M; fj = (v + 1) * 0.5 * M;
        }

        /// <summary>Lattice points within <paramref name="radiusM"/> of a centre (all faces involved, border points de-duplicated).</summary>
        public static List<(int f, int i, int j, long key, Vec3d dir, double dist)> Window(Vec3d c, double radiusM, double planetRadius)
        {
            var result = new List<(int, int, int, long, Vec3d, double)>();
            var seen = new HashSet<long>();
            double th = radiusM / planetRadius;
            int w = (int)Math.Ceiling(1.9 * th / ((Math.PI / 2) / M)) + 2;
            for (int f = 0; f < CubeSphere.FaceCount; f++)
            {
                Vec3d n = CubeSphere.FaceNormal(f);
                double d = c.Dot(n);
                if (d <= 0.2) continue;
                Vec3d rel = c / d - n;
                double u = CubeSphere.UnwarpPublic(rel.Dot(CubeSphere.FaceU(f))), v = CubeSphere.UnwarpPublic(rel.Dot(CubeSphere.FaceV(f)));
                int ci = (int)Math.Round((u + 1) * 0.5 * M), cj = (int)Math.Round((v + 1) * 0.5 * M);
                for (int j = Math.Max(0, cj - w); j <= Math.Min(M, cj + w); j++)
                    for (int i = Math.Max(0, ci - w); i <= Math.Min(M, ci + w); i++)
                    {
                        long k = Key(f, i, j);
                        if (!seen.Add(k)) continue;
                        Vec3d p = PointDirection(f, i, j);
                        double dist = Math.Acos(Math.Max(-1, Math.Min(1, p.Dot(c)))) * planetRadius;
                        if (dist <= radiusM) result.Add((f, i, j, k, p, dist));
                    }
            }
            return result;
        }
    }
}
