using System;

namespace GF.Planet
{
    /// <summary>
    /// Equal-angle cube-sphere. A point is addressed by (face, u, v) with u,v in [-1,1]. Everything is a pure function
    /// of the cube point, so two patches meeting on an edge or corner compute bit-identical directions for the same
    /// physical point - this is what makes the surface crack-free by construction.
    /// </summary>
    public static class CubeSphere
    {
        public const int FaceCount = 6;
        // face normal, u axis, v axis (cube point = n + wu*U + wv*V)
        static readonly Vec3d[] N = { new Vec3d(1, 0, 0), new Vec3d(-1, 0, 0), new Vec3d(0, 1, 0), new Vec3d(0, -1, 0), new Vec3d(0, 0, 1), new Vec3d(0, 0, -1) };
        static readonly Vec3d[] U = { new Vec3d(0, 0, -1), new Vec3d(0, 0, 1), new Vec3d(1, 0, 0), new Vec3d(1, 0, 0), new Vec3d(1, 0, 0), new Vec3d(-1, 0, 0) };
        static readonly Vec3d[] V = { new Vec3d(0, 1, 0), new Vec3d(0, 1, 0), new Vec3d(0, 0, -1), new Vec3d(0, 0, 1), new Vec3d(0, 1, 0), new Vec3d(0, 1, 0) };
        const double QuarterPi = Math.PI / 4.0;

        public static Vec3d FaceNormal(int face) => N[face];
        public static Vec3d FaceU(int face) => U[face];
        public static Vec3d FaceV(int face) => V[face];
        public static double UnwarpPublic(double c) => Unwarp(c);

        static double Warp(double t) => Math.Tan(t * QuarterPi);
        static double Unwarp(double c) => Math.Atan(c) / QuarterPi;

        /// <summary>Unit direction for a face coordinate.</summary>
        public static Vec3d Direction(int face, double u, double v)
        {
            Vec3d c = N[face] + U[face] * Warp(u) + V[face] * Warp(v);
            return c.Normalized;
        }

        /// <summary>Inverse mapping: unit direction -> face and (u,v) in [-1,1].</summary>
        public static void FromDirection(Vec3d d, out int face, out double u, out double v)
        {
            double ax = Math.Abs(d.x), ay = Math.Abs(d.y), az = Math.Abs(d.z);
            if (ax >= ay && ax >= az) face = d.x >= 0 ? 0 : 1;
            else if (ay >= az) face = d.y >= 0 ? 2 : 3;
            else face = d.z >= 0 ? 4 : 5;
            double m = Math.Max(ax, Math.Max(ay, az));
            Vec3d cube = d / m;
            Vec3d rel = cube - N[face];
            u = Unwarp(rel.Dot(U[face]));
            v = Unwarp(rel.Dot(V[face]));
        }
    }

    /// <summary>One quadtree node: face + level + integer cell. Stable id used for streaming, authoring and networking.</summary>
    public readonly struct PatchId : IEquatable<PatchId>
    {
        public readonly byte face, level; public readonly int ix, iy;
        public PatchId(int face, int level, int ix, int iy) { this.face = (byte)face; this.level = (byte)level; this.ix = ix; this.iy = iy; }
        public bool Equals(PatchId o) => face == o.face && level == o.level && ix == o.ix && iy == o.iy;
        public override bool Equals(object obj) => obj is PatchId p && Equals(p);
        public override int GetHashCode() => (face * 397 ^ level) * 7919 ^ (ix * 73856093) ^ (iy * 19349663);
        public override string ToString() => $"F{face}/L{level}/{ix},{iy}";
        public (double u0, double u1, double v0, double v1) Range()
        {
            double n = 1 << level;
            return (-1 + 2 * ix / n, -1 + 2 * (ix + 1) / n, -1 + 2 * iy / n, -1 + 2 * (iy + 1) / n);
        }
        public Vec3d CenterDirection() { var r = Range(); return CubeSphere.Direction(face, (r.u0 + r.u1) * 0.5, (r.v0 + r.v1) * 0.5); }
        public PatchId Child(int i) => new PatchId(face, level + 1, ix * 2 + (i & 1), iy * 2 + (i >> 1));
        public PatchId Parent => new PatchId(face, level - 1, ix >> 1, iy >> 1);
    }
}
