using System;

namespace GF.Planet
{
    /// <summary>Double-precision 3-vector for planet maths (no UnityEngine dependency, so it is unit-testable anywhere).</summary>
    public readonly struct Vec3d
    {
        public readonly double x, y, z;
        public Vec3d(double x, double y, double z) { this.x = x; this.y = y; this.z = z; }
        public static Vec3d operator +(Vec3d a, Vec3d b) => new Vec3d(a.x + b.x, a.y + b.y, a.z + b.z);
        public static Vec3d operator -(Vec3d a, Vec3d b) => new Vec3d(a.x - b.x, a.y - b.y, a.z - b.z);
        public static Vec3d operator -(Vec3d a) => new Vec3d(-a.x, -a.y, -a.z);
        public static Vec3d operator *(Vec3d a, double s) => new Vec3d(a.x * s, a.y * s, a.z * s);
        public static Vec3d operator *(double s, Vec3d a) => a * s;
        public static Vec3d operator /(Vec3d a, double s) => new Vec3d(a.x / s, a.y / s, a.z / s);
        public double Dot(Vec3d b) => x * b.x + y * b.y + z * b.z;
        public Vec3d Cross(Vec3d b) => new Vec3d(y * b.z - z * b.y, z * b.x - x * b.z, x * b.y - y * b.x);
        public double Length => Math.Sqrt(x * x + y * y + z * z);
        public Vec3d Normalized { get { double l = Length; return l > 0 ? this / l : this; } }
        public static Vec3d Lerp(Vec3d a, Vec3d b, double t) => a + (b - a) * t;
        public override string ToString() => $"({x:F4}, {y:F4}, {z:F4})";
    }
}
