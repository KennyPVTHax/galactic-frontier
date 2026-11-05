using System;

namespace GF.Planet
{
    /// <summary>
    /// Maps the original flat gameplay coordinates (x east, z north, metres) onto the sphere with an azimuthal-
    /// equidistant projection around an anchor direction. Radial distance from the anchor is exact; this is the
    /// documented migration for POIs, deposits, mission targets and saved positions.
    /// </summary>
    public sealed class AnchorFrame
    {
        public readonly Vec3d Up, East, North;
        public readonly double Radius;

        public AnchorFrame(Vec3d anchorDirection, double radius)
        {
            Up = anchorDirection.Normalized; Radius = radius;
            Vec3d east = new Vec3d(0, 1, 0).Cross(Up);
            if (east.Length < 1e-6) east = new Vec3d(1, 0, 0);
            East = east.Normalized;
            Vec3d north = Up.Cross(East).Normalized;
            North = East.Cross(north).Dot(Up) < 0 ? -north : north;
        }

        public Vec3d FromLocal(double x, double z)
        {
            double d = Math.Sqrt(x * x + z * z);
            if (d < 1e-9) return Up;
            double th = d / Radius;
            Vec3d b = East * (x / d) + North * (z / d);
            return (Up * Math.Cos(th) + b * Math.Sin(th)).Normalized;
        }

        public void ToLocal(Vec3d dir, out double x, out double z)
        {
            double c = Math.Max(-1, Math.Min(1, dir.Dot(Up)));
            double th = Math.Acos(c);
            double e = dir.Dot(East), n = dir.Dot(North);
            double len = Math.Sqrt(e * e + n * n);
            if (len < 1e-12 || th < 1e-12) { x = 0; z = 0; return; }
            x = Radius * th * e / len; z = Radius * th * n / len;
        }
    }
}
