using System;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace GF.Planet
{
    /// <summary>Raw mesh arrays for one planet patch; positions are relative to <see cref="Center"/> so floats stay precise.</summary>
    public sealed class PatchMeshData
    {
        public PatchId Id;
        public Vec3d Center;
        public float[] Pos, Nrm;
        public int[] Tris;
        public double MinR, MaxR, HalfSize;
        public int Quads;
        public byte[] Col;      // RGBA painted layer weights per vertex (null when nothing is painted)
        public float[] Ovr;     // paint override strength per vertex
    }

    public static class PatchMesher
    {
        public const int DefaultQuads = 32;

        public static PatchMeshData Build(PatchId id, double radius, IPlanetField field, int N = DefaultQuads, bool parallel = true, GF.Authoring.IPaintSource paint = null)
        {
            var (u0, u1, v0, v1) = id.Range();
            int E = N + 1;                                   // core grid only
            var P = new Vec3d[E * E];
            var Dir = new Vec3d[E * E];
            var Nrm = new Vec3d[E * E];
            double arcSpacing = Math.PI * 0.5 * radius / (1 << id.level) / N;     // metres between vertices
            double eps = arcSpacing / radius;                                    // angular normal-stencil step
            Action<int> row = j =>
            {
                double v = v0 + (v1 - v0) * j / N;
                for (int i = 0; i < E; i++)
                {
                    double u = u0 + (u1 - u0) * i / N;
                    Vec3d d = CubeSphere.Direction(id.face, u, v);
                    Dir[j * E + i] = d;
                    P[j * E + i] = d * (radius + field.Height(d));
                    Nrm[j * E + i] = StencilNormal(field, radius, d, eps);
                }
            };
            if (parallel) Parallel.For(0, E, row); else for (int j = 0; j < E; j++) row(j);

            Vec3d center = id.CenterDirection() * radius;
            int side = N + 1, core = side * side, total = core + 4 * side;
            var pos = new float[total * 3];
            var nrm = new float[total * 3];
            double minR = double.MaxValue, maxR = double.MinValue;

            for (int j = 0; j < side; j++)
                for (int i = 0; i < side; i++)
                {
                    Vec3d p = P[j * E + i], n = Nrm[j * E + i];
                    Vec3d rel = p - center;
                    int k = (j * side + i) * 3;
                    pos[k] = (float)rel.x; pos[k + 1] = (float)rel.y; pos[k + 2] = (float)rel.z;
                    nrm[k] = (float)n.x; nrm[k + 1] = (float)n.y; nrm[k + 2] = (float)n.z;
                    double r = p.Length; if (r < minR) minR = r; if (r > maxR) maxR = r;
                }

            double arc = Math.PI * 0.5 * radius / (1 << id.level);
            double skirt = Math.Max(1.0, arc / N * 1.6);
            for (int t = 0; t < side; t++)
            {
                Skirt(pos, nrm, core + 0 * side + t, (0 * side + t) * 3, center, P, Dir, E, t, 0, skirt);
                Skirt(pos, nrm, core + 1 * side + t, (N * side + t) * 3, center, P, Dir, E, t, N, skirt);
                Skirt(pos, nrm, core + 2 * side + t, (t * side + 0) * 3, center, P, Dir, E, 0, t, skirt);
                Skirt(pos, nrm, core + 3 * side + t, (t * side + N) * 3, center, P, Dir, E, N, t, skirt);
            }

            // Winding: numeric cross(v1-v0, v2-v0) must point outward for Unity's front face.
            var tris = new List<int>(N * N * 6 + N * 4 * 12);
            int mid = (N / 2) * side + (N / 2);
            Vec3d a0 = V(pos, mid), a1 = V(pos, mid + side), a2 = V(pos, mid + 1);
            bool flip = (a1 - a0).Cross(a2 - a0).Dot(Dir[(N / 2) * E + N / 2]) < 0;
            for (int j = 0; j < N; j++)
                for (int i = 0; i < N; i++)
                {
                    int a = j * side + i, b = a + 1, d = a + side, e = d + 1;
                    Tri(tris, a, d, b, flip); Tri(tris, b, d, e, flip);
                }
            for (int t = 0; t < N; t++)
                for (int s = 0; s < 4; s++)
                {
                    int c0, c1;
                    if (s == 0) { c0 = t; c1 = t + 1; }
                    else if (s == 1) { c0 = N * side + t; c1 = c0 + 1; }
                    else if (s == 2) { c0 = t * side; c1 = (t + 1) * side; }
                    else { c0 = t * side + N; c1 = (t + 1) * side + N; }
                    int k0 = core + s * side + t, k1 = k0 + 1;
                    Tri(tris, c0, c1, k0, flip); Tri(tris, c1, k1, k0, flip);     // skirts are double-sided
                    Tri(tris, c0, k0, c1, flip); Tri(tris, c1, k0, k1, flip);
                }

            byte[] col = null; float[] ovrA = null;
            if (paint != null && paint.Any)
            {
                col = new byte[total * 4]; ovrA = new float[total];
                bool any = false;
                for (int j = 0; j < side; j++)
                    for (int i = 0; i < side; i++)
                    {
                        paint.Sample(Dir[j * E + i], out byte q0, out byte q1, out byte q2, out byte q3, out float o);
                        int k = j * side + i; col[k * 4] = q0; col[k * 4 + 1] = q1; col[k * 4 + 2] = q2; col[k * 4 + 3] = q3; ovrA[k] = o; if (o > 0) any = true;
                    }
                // skirt vertices copy their border vertex
                for (int t = 0; t < side; t++)
                {
                    CopyPaint(col, ovrA, core + 0 * side + t, 0 * side + t);
                    CopyPaint(col, ovrA, core + 1 * side + t, N * side + t);
                    CopyPaint(col, ovrA, core + 2 * side + t, t * side + 0);
                    CopyPaint(col, ovrA, core + 3 * side + t, t * side + N);
                }
                if (!any) { col = null; ovrA = null; }
            }
            return new PatchMeshData { Col = col, Ovr = ovrA, Id = id, Center = center, Pos = pos, Nrm = nrm, Tris = tris.ToArray(), MinR = minR, MaxR = maxR, HalfSize = arc * 0.75, Quads = N };
        }

        /// <summary>Normal from a stencil defined only by the surface direction, so every patch (and face) computes the same value for the same point.</summary>
        public static Vec3d StencilNormal(IPlanetField f, double radius, Vec3d d, double eps)
        {
            Vec3d refAxis = Math.Abs(d.y) < 0.9 ? new Vec3d(0, 1, 0) : new Vec3d(1, 0, 0);
            Vec3d t1 = d.Cross(refAxis).Normalized, t2 = d.Cross(t1);
            Vec3d a = Pt(f, radius, (d + t1 * eps).Normalized), b = Pt(f, radius, (d - t1 * eps).Normalized);
            Vec3d c = Pt(f, radius, (d + t2 * eps).Normalized), e = Pt(f, radius, (d - t2 * eps).Normalized);
            Vec3d n = (a - b).Cross(c - e).Normalized;
            return n.Dot(d) < 0 ? -n : n;
        }
        static Vec3d Pt(IPlanetField f, double radius, Vec3d d) => d * (radius + f.Height(d));

        static void CopyPaint(byte[] col, float[] ovr, int dst, int src) { for (int q = 0; q < 4; q++) col[dst * 4 + q] = col[src * 4 + q]; ovr[dst] = ovr[src]; }

        static void Skirt(float[] pos, float[] nrm, int dst, int srcK, Vec3d center, Vec3d[] P, Vec3d[] Dir, int E, int ei, int ej, double depth)
        {
            Vec3d p = P[ej * E + ei] - Dir[ej * E + ei] * depth - center;
            int k = dst * 3;
            pos[k] = (float)p.x; pos[k + 1] = (float)p.y; pos[k + 2] = (float)p.z;
            nrm[k] = nrm[srcK]; nrm[k + 1] = nrm[srcK + 1]; nrm[k + 2] = nrm[srcK + 2];
        }

        static Vec3d V(float[] a, int idx) => new Vec3d(a[idx * 3], a[idx * 3 + 1], a[idx * 3 + 2]);
        static void Tri(List<int> t, int a, int b, int c, bool flip) { if (flip) { t.Add(a); t.Add(c); t.Add(b); } else { t.Add(a); t.Add(b); t.Add(c); } }
    }
}
