using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using GF.Planet;

namespace GF.Authoring
{
    /// <summary>One authored lattice point. Everything defaults to "no override"; default cells are not stored.</summary>
    public struct Cell
    {
        public float dh;          // metres added to the procedural height
        public uint mat;          // 4 painted layer weights, one byte each (layer0 = low byte)
        public byte ovr;          // how strongly paint replaces the procedural material (0..255)
        public byte veg;          // vegetation density target (0..255) when vegMode == 1
        public byte vegMode;      // 0 none, 1 painted density, 2 excluded
        public bool IsDefault => dh == 0 && mat == 0 && ovr == 0 && veg == 0 && vegMode == 0;
    }

    public sealed class PlacedProp
    {
        public string id;          // stable GUID-like id
        public string kind;        // prefab key, e.g. "rock_boulder_02"
        public double x, y, z;     // unit direction from the planet centre (surface-snapped)
        public float yaw, scale = 1f, sink = 0.1f;
        public bool landmark;      // handcrafted landmark: never touched by procedural generation
        public Vec3d Dir => new Vec3d(x, y, z);
    }

    public sealed class Region
    {
        public string id, name;
        public double x, y, z, radiusM = 150;
        public Vec3d Dir => new Vec3d(x, y, z);
    }

    public interface IPaintSource { bool Any { get; } void Sample(Vec3d dir, out byte w0, out byte w1, out byte w2, out byte w3, out float ovr); }

    /// <summary>
    /// The owner-authored layer for one planet: sparse terrain/material/vegetation lattice + props + regions. It never contains
    /// the procedural base; it only stores overrides relative to it, so regenerating the base keeps every edit.
    /// </summary>
    public sealed class AuthoredWorld : IPaintSource
    {
        public const int FormatVersion = 1;
        public string PlanetId = "aetherion";
        public uint BaseSeedAtAuthoring;
        public readonly Dictionary<long, Cell> Cells = new Dictionary<long, Cell>();
        public readonly List<PlacedProp> Props = new List<PlacedProp>();
        public readonly List<Region> Regions = new List<Region>();
        public int Revision;           // bumps on every change (cache invalidation)
        public bool Dirty;

        public bool Any => Cells.Count > 0;

        public Cell Get(int f, int i, int j) { Cells.TryGetValue(Lattice.Key(f, i, j), out var c); return c; }
        public Cell GetKey(long key) { Cells.TryGetValue(key, out var c); return c; }
        public void SetKey(long key, Cell c) { if (c.IsDefault) Cells.Remove(key); else Cells[key] = c; Revision++; Dirty = true; }

        // ---- bilinear sampling (identical for every LOD and every face, because it only depends on the direction)
        void Corners(Vec3d dir, out int f, out int i0, out int j0, out double tx, out double ty)
        {
            Lattice.Locate(dir, out f, out double fi, out double fj);
            i0 = Math.Max(0, Math.Min(Lattice.M - 1, (int)Math.Floor(fi))); j0 = Math.Max(0, Math.Min(Lattice.M - 1, (int)Math.Floor(fj)));
            tx = fi - i0; ty = fj - j0;
        }

        public double HeightDelta(Vec3d dir)
        {
            if (Cells.Count == 0) return 0;
            Corners(dir, out int f, out int i, out int j, out double tx, out double ty);
            double a = Get(f, i, j).dh, b = Get(f, i + 1, j).dh, c = Get(f, i, j + 1).dh, d = Get(f, i + 1, j + 1).dh;
            if (a == 0 && b == 0 && c == 0 && d == 0) return 0;
            return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
        }

        public void Sample(Vec3d dir, out byte w0, out byte w1, out byte w2, out byte w3, out float ovr)
        {
            w0 = w1 = w2 = w3 = 0; ovr = 0;
            if (Cells.Count == 0) return;
            Corners(dir, out int f, out int i, out int j, out double tx, out double ty);
            Cell c00 = Get(f, i, j), c10 = Get(f, i + 1, j), c01 = Get(f, i, j + 1), c11 = Get(f, i + 1, j + 1);
            if (c00.ovr == 0 && c10.ovr == 0 && c01.ovr == 0 && c11.ovr == 0) return;
            double wa = (1 - tx) * (1 - ty), wb = tx * (1 - ty), wc = (1 - tx) * ty, wd = tx * ty;
            double oa = c00.ovr / 255.0 * wa, ob = c10.ovr / 255.0 * wb, oc = c01.ovr / 255.0 * wc, od = c11.ovr / 255.0 * wd;
            double o = oa + ob + oc + od;
            if (o <= 1e-6) return;
            double a0 = (c00.mat & 255) * oa + (c10.mat & 255) * ob + (c01.mat & 255) * oc + (c11.mat & 255) * od;
            double a1 = ((c00.mat >> 8) & 255) * oa + ((c10.mat >> 8) & 255) * ob + ((c01.mat >> 8) & 255) * oc + ((c11.mat >> 8) & 255) * od;
            double a2 = ((c00.mat >> 16) & 255) * oa + ((c10.mat >> 16) & 255) * ob + ((c01.mat >> 16) & 255) * oc + ((c11.mat >> 16) & 255) * od;
            double a3 = ((c00.mat >> 24) & 255) * oa + ((c10.mat >> 24) & 255) * ob + ((c01.mat >> 24) & 255) * oc + ((c11.mat >> 24) & 255) * od;
            ovr = (float)o;
            w0 = (byte)Math.Min(255, a0 / o); w1 = (byte)Math.Min(255, a1 / o); w2 = (byte)Math.Min(255, a2 / o); w3 = (byte)Math.Min(255, a3 / o);
        }

        /// <summary>Vegetation overrides at a direction: exclusion weight (0..1), painted-density weight (0..1) and painted density target (0..1).</summary>
        public void Vegetation(Vec3d dir, out double excl, out double paintW, out double paintDensity)
        {
            excl = paintW = paintDensity = 0;
            if (Cells.Count == 0) return;
            Corners(dir, out int f, out int i, out int j, out double tx, out double ty);
            Cell c00 = Get(f, i, j), c10 = Get(f, i + 1, j), c01 = Get(f, i, j + 1), c11 = Get(f, i + 1, j + 1);
            if (c00.vegMode == 0 && c10.vegMode == 0 && c01.vegMode == 0 && c11.vegMode == 0) return;
            double wa = (1 - tx) * (1 - ty), wb = tx * (1 - ty), wc = (1 - tx) * ty, wd = tx * ty, dsum = 0;
            if (c00.vegMode == 2) excl += wa; else if (c00.vegMode == 1) { paintW += wa; dsum += wa * c00.veg / 255.0; }
            if (c10.vegMode == 2) excl += wb; else if (c10.vegMode == 1) { paintW += wb; dsum += wb * c10.veg / 255.0; }
            if (c01.vegMode == 2) excl += wc; else if (c01.vegMode == 1) { paintW += wc; dsum += wc * c01.veg / 255.0; }
            if (c11.vegMode == 2) excl += wd; else if (c11.vegMode == 1) { paintW += wd; dsum += wd * c11.veg / 255.0; }
            paintDensity = paintW > 1e-6 ? dsum / paintW : 0;
        }

        public bool HasExclusion(Vec3d dir) { Vegetation(dir, out double e, out _, out _); return e > 0.5; }

        // ---- props
        public PlacedProp AddProp(string kind, Vec3d dir, float yaw, float scale, bool landmark = false)
        {
            var p = new PlacedProp { id = Guid.NewGuid().ToString("N").Substring(0, 12), kind = kind, x = dir.x, y = dir.y, z = dir.z, yaw = yaw, scale = scale, landmark = landmark };
            Props.Add(p); Revision++; Dirty = true; return p;
        }
        public bool RemoveProp(string id) { int n = Props.RemoveAll(p => p.id == id); if (n > 0) { Revision++; Dirty = true; } return n > 0; }
        public PlacedProp FindProp(string id) => Props.Find(p => p.id == id);
        public void Touch() { Revision++; Dirty = true; }

        // ---- binary persistence (versioned, deterministic order)
        public void Write(Stream s)
        {
            using (var w = new BinaryWriter(s, Encoding.UTF8, true))
            {
                w.Write(Encoding.ASCII.GetBytes("GFAW")); w.Write(FormatVersion); w.Write(PlanetId); w.Write(BaseSeedAtAuthoring); w.Write(Lattice.M);
                w.Write(Regions.Count);
                foreach (var r in Regions) { w.Write(r.id); w.Write(r.name ?? ""); w.Write(r.x); w.Write(r.y); w.Write(r.z); w.Write(r.radiusM); }
                w.Write(Props.Count);
                foreach (var p in Props) { w.Write(p.id); w.Write(p.kind); w.Write(p.x); w.Write(p.y); w.Write(p.z); w.Write(p.yaw); w.Write(p.scale); w.Write(p.sink); w.Write(p.landmark); }
                var keys = new List<long>(Cells.Keys); keys.Sort();
                w.Write(keys.Count);
                foreach (var k in keys) { var c = Cells[k]; w.Write(k); w.Write(c.dh); w.Write(c.mat); w.Write(c.ovr); w.Write(c.veg); w.Write(c.vegMode); }
            }
        }

        public static AuthoredWorld Read(Stream s)
        {
            var aw = new AuthoredWorld();
            using (var r = new BinaryReader(s, Encoding.UTF8, true))
            {
                var magic = Encoding.ASCII.GetString(r.ReadBytes(4));
                if (magic != "GFAW") throw new InvalidDataException("not a Galactic Frontier authored world file");
                int ver = r.ReadInt32();
                if (ver > FormatVersion) throw new InvalidDataException("authored world version " + ver + " is newer than this build supports (" + FormatVersion + ")");
                aw.PlanetId = r.ReadString(); aw.BaseSeedAtAuthoring = r.ReadUInt32();
                int m = r.ReadInt32(); if (m != Lattice.M) throw new InvalidDataException("lattice resolution mismatch: " + m);
                int nr = r.ReadInt32();
                for (int i = 0; i < nr; i++) aw.Regions.Add(new Region { id = r.ReadString(), name = r.ReadString(), x = r.ReadDouble(), y = r.ReadDouble(), z = r.ReadDouble(), radiusM = r.ReadDouble() });
                int np = r.ReadInt32();
                for (int i = 0; i < np; i++) aw.Props.Add(new PlacedProp { id = r.ReadString(), kind = r.ReadString(), x = r.ReadDouble(), y = r.ReadDouble(), z = r.ReadDouble(), yaw = r.ReadSingle(), scale = r.ReadSingle(), sink = r.ReadSingle(), landmark = r.ReadBoolean() });
                int nc = r.ReadInt32();
                for (int i = 0; i < nc; i++) { long k = r.ReadInt64(); aw.Cells[k] = new Cell { dh = r.ReadSingle(), mat = r.ReadUInt32(), ovr = r.ReadByte(), veg = r.ReadByte(), vegMode = r.ReadByte() }; }
            }
            aw.Dirty = false;
            return aw;
        }

        /// <summary>Order-independent content hash, used by persistence/regeneration tests.</summary>
        public ulong ContentHash()
        {
            ulong h = 1469598103934665603UL;
            Action<ulong> mix = v => { h ^= v; h *= 1099511628211UL; };
            var keys = new List<long>(Cells.Keys); keys.Sort();
            foreach (var k in keys) { var c = Cells[k]; mix((ulong)k); mix((ulong)BitConverter.SingleToInt32Bits(c.dh)); mix(c.mat); mix(c.ovr); mix(c.veg); mix(c.vegMode); }
            var props = new List<PlacedProp>(Props); props.Sort((a, b) => string.CompareOrdinal(a.id, b.id));
            foreach (var p in props) { mix((ulong)p.id.GetHashCode()); mix((ulong)BitConverter.DoubleToInt64Bits(p.x)); mix((ulong)BitConverter.DoubleToInt64Bits(p.y)); mix((ulong)BitConverter.DoubleToInt64Bits(p.z)); mix((ulong)BitConverter.SingleToInt32Bits(p.yaw)); mix((ulong)BitConverter.SingleToInt32Bits(p.scale)); }
            return h;
        }

        public string Summary() => $"{Cells.Count} lattice points, {Props.Count} props, {Regions.Count} regions, rev {Revision}";
    }

    /// <summary>The procedural planet plus the owner's edits. Same function of direction at every LOD -> seamless.</summary>
    public sealed class AuthoredField : IPlanetField
    {
        public readonly IPlanetField Baseline;
        public readonly AuthoredWorld World;
        public AuthoredField(IPlanetField baseline, AuthoredWorld world) { Baseline = baseline; World = world; }
        public double Height(Vec3d dir) => Baseline.Height(dir) + World.HeightDelta(dir);
    }
}
