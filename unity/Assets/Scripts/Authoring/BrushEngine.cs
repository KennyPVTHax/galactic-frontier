using System;
using System.Collections.Generic;
using GF.Planet;

namespace GF.Authoring
{
    public enum BrushKind { Raise, Lower, Smooth, Flatten, PaintMaterial, EraseMaterial, PaintVegetation, ExcludeVegetation, EraseVegetation }

    public sealed class BrushSettings
    {
        public BrushKind Kind = BrushKind.Raise;
        public double RadiusM = 12;
        public double Strength = 3;        // metres/second for raise/lower; blend rate/second for the others
        public int Layer;                  // material layer 0..3 (grass, dirt, rock, sand)
        public double VegDensity = 0.8;    // painted vegetation density 0..1
        public double FlattenTargetR = double.NaN;   // set at stroke start for Flatten (absolute radius from the planet centre)
    }

    /// <summary>Everything a stroke changed, so it can be undone/redone exactly.</summary>
    public sealed class StrokeRecord
    {
        public readonly Dictionary<long, (bool existed, Cell cell)> Before = new Dictionary<long, (bool, Cell)>();
        public readonly Dictionary<long, (bool existed, Cell cell)> After = new Dictionary<long, (bool, Cell)>();
        public Vec3d MinDir, MaxDir; public Vec3d Center; public double Radius;
        public string Label = "Stroke";
        public bool IsEmpty => Before.Count == 0;
    }

    /// <summary>Terrain/paint/vegetation brushes working in true spherical geometry on the global lattice.</summary>
    public static class BrushEngine
    {
        public const double MaxDelta = 250.0;

        static double Falloff(double dist, double radius) { double s = Math.Max(0, 1 - dist / radius); return s * s * (3 - 2 * s); }

        /// <summary>Apply one dab. dt scales the strength (seconds since the previous dab). Returns number of lattice points touched.</summary>
        public static int Dab(AuthoredWorld world, IPlanetField effective, double planetRadius, Vec3d center, BrushSettings b, double dt, StrokeRecord rec)
        {
            var pts = Lattice.Window(center, b.RadiusM, planetRadius);
            if (rec != null) { rec.Center = center; rec.Radius = Math.Max(rec.Radius, b.RadiusM); }
            var updates = new List<(long key, Cell cell)>(pts.Count);

            double[] eff = null;
            if (b.Kind == BrushKind.Smooth)
            {
                // snapshot of the effective surface around each point (before this dab changes anything)
                eff = new double[pts.Count * 5];
                double step = 0.5 * planetRadius * (Math.PI / 2) / Lattice.M * 2;      // ~1 lattice spacing in metres
                for (int n = 0; n < pts.Count; n++)
                {
                    Vec3d d = pts[n].dir;
                    Vec3d t1 = d.Cross(Math.Abs(d.y) < 0.9 ? new Vec3d(0, 1, 0) : new Vec3d(1, 0, 0)).Normalized, t2 = d.Cross(t1);
                    double e = step / planetRadius * 2.0;
                    eff[n * 5] = effective.Height(d);
                    eff[n * 5 + 1] = effective.Height((d + t1 * e).Normalized); eff[n * 5 + 2] = effective.Height((d - t1 * e).Normalized);
                    eff[n * 5 + 3] = effective.Height((d + t2 * e).Normalized); eff[n * 5 + 4] = effective.Height((d - t2 * e).Normalized);
                }
            }

            for (int n = 0; n < pts.Count; n++)
            {
                var p = pts[n];
                double w = Falloff(p.dist, b.RadiusM);
                if (w <= 1e-4) continue;
                Cell c = world.GetKey(p.key);
                double a = Math.Min(1.0, b.Strength * w * dt);
                switch (b.Kind)
                {
                    case BrushKind.Raise: c.dh = (float)Math.Min(MaxDelta, c.dh + b.Strength * w * dt); break;
                    case BrushKind.Lower: c.dh = (float)Math.Max(-MaxDelta, c.dh - b.Strength * w * dt); break;
                    case BrushKind.Flatten:
                        {
                            double h = effective.Height(p.dir);
                            double target = b.FlattenTargetR - planetRadius;
                            c.dh = (float)Math.Max(-MaxDelta, Math.Min(MaxDelta, c.dh + (target - h) * Math.Min(1.0, a * 2.5)));
                            break;
                        }
                    case BrushKind.Smooth:
                        {
                            double avg = (eff[n * 5] * 2 + eff[n * 5 + 1] + eff[n * 5 + 2] + eff[n * 5 + 3] + eff[n * 5 + 4]) / 6.0;
                            c.dh = (float)Math.Max(-MaxDelta, Math.Min(MaxDelta, c.dh + (avg - eff[n * 5]) * Math.Min(1.0, a * 3.0)));
                            break;
                        }
                    case BrushKind.PaintMaterial:
                        {
                            uint[] wv = { c.mat & 255, (c.mat >> 8) & 255, (c.mat >> 16) & 255, (c.mat >> 24) & 255 };
                            double sum = wv[0] + wv[1] + wv[2] + wv[3];
                            double[] nw = new double[4];
                            for (int k = 0; k < 4; k++) nw[k] = sum > 0 ? wv[k] / sum : (k == b.Layer ? 1 : 0);
                            for (int k = 0; k < 4; k++) nw[k] = nw[k] * (1 - a) + (k == b.Layer ? a : 0);
                            double ns = nw[0] + nw[1] + nw[2] + nw[3];
                            uint packed = 0; for (int k = 0; k < 4; k++) packed |= (uint)Math.Min(255, Math.Round(nw[k] / ns * 255.0)) << (8 * k);
                            c.mat = packed; c.ovr = (byte)Math.Min(255, c.ovr + a * 255.0 + 1);
                            break;
                        }
                    case BrushKind.EraseMaterial:
                        {
                            int o = (int)(c.ovr - a * 255.0 - 1); if (o <= 0) { c.ovr = 0; c.mat = 0; } else c.ovr = (byte)o;
                            break;
                        }
                    case BrushKind.PaintVegetation:
                        {
                            double oldD = c.vegMode == 1 ? c.veg / 255.0 : 0;
                            double nv = oldD * (1 - a) + b.VegDensity * a;
                            c.vegMode = 1; c.veg = (byte)Math.Max(1, Math.Min(255, Math.Round(nv * 255.0)));
                            break;
                        }
                    case BrushKind.ExcludeVegetation: if (w > 0.35) { c.vegMode = 2; c.veg = 0; } break;
                    case BrushKind.EraseVegetation: if (w > 0.35) { c.vegMode = 0; c.veg = 0; } break;
                }
                updates.Add((p.key, c));
            }

            foreach (var (key, cell) in updates)
            {
                if (rec != null && !rec.Before.ContainsKey(key)) { bool had = world.Cells.TryGetValue(key, out var old); rec.Before[key] = (had, old); }
                world.SetKey(key, cell);
                if (rec != null) rec.After[key] = (!cell.IsDefault, cell);
            }
            return updates.Count;
        }

        public static void Undo(AuthoredWorld world, StrokeRecord rec)
        {
            foreach (var kv in rec.Before) { if (kv.Value.existed) world.Cells[kv.Key] = kv.Value.cell; else world.Cells.Remove(kv.Key); }
            world.Touch();
        }

        public static void Redo(AuthoredWorld world, StrokeRecord rec)
        {
            foreach (var kv in rec.After) { if (kv.Value.existed) world.Cells[kv.Key] = kv.Value.cell; else world.Cells.Remove(kv.Key); }
            world.Touch();
        }
    }
}
