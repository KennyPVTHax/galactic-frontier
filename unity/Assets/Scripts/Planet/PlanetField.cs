using System;
using GF.Core;

namespace GF.Planet
{
    public interface IPlanetField
    {
        /// <summary>Terrain height in metres above the reference radius at a unit direction.</summary>
        double Height(Vec3d dir);
    }

    /// <summary>
    /// Aetherion on a sphere: the authored/TypeScript terrain is reproduced exactly inside the anchor region
    /// (gameplay coordinates stay valid) and blends into planet-scale procedural geology outside it. The old
    /// artificial mountain ring is not used; mountain belts come from the global field.
    /// </summary>
    public sealed class AetherionField : IPlanetField
    {
        public readonly AnchorFrame Anchor;
        public readonly TerrainModel Local;
        readonly Noise3D noise;
        public double ExactRadius = 500, BlendEnd = 1150;
        public readonly double Radius;

        public AetherionField(PlanetData def, AnchorFrame anchor, uint worldSeed)
        {
            Anchor = anchor; Radius = anchor.Radius;
            Local = new TerrainModel(def.CloneNoMountains());
            noise = new Noise3D(worldSeed);
        }

        static double Smooth(double e0, double e1, double x) { double t = Math.Max(0, Math.Min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }

        /// <summary>Planet-scale procedural geology: continents, mountain belts, hills, fine relief.</summary>
        public double Global(Vec3d d)
        {
            double cont = noise.Fbm(d.x * 2.6 + 11, d.y * 2.6, d.z * 2.6 - 5, 4);
            double belt = noise.Ridged(d.x * 4.1 - 3, d.y * 4.1 + 7, d.z * 4.1, 5);
            double beltMask = Smooth(0.05, 0.55, noise.Fbm(d.x * 1.7 + 40, d.y * 1.7, d.z * 1.7, 2));
            double hills = noise.Fbm(d.x * 38, d.y * 38 + 9, d.z * 38, 4);
            double fine = noise.Fbm(d.x * 310, d.y * 310, d.z * 310 + 21, 3);
            return -2 + 70 * cont + 260 * Math.Max(0, belt - 0.42) * beltMask + 22 * hills + 2.6 * fine;
        }

        public double Height(Vec3d dir)
        {
            Anchor.ToLocal(dir, out double x, out double z);
            double dist = Math.Sqrt(x * x + z * z);
            if (dist <= ExactRadius) return Local.Height(x, z);
            double g = Global(dir);
            if (dist >= BlendEnd) return g;
            double w = Smooth(ExactRadius, BlendEnd, dist);
            return Local.Height(x, z) * (1 - w) + g * w;
        }
    }
}
