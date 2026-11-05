using System;
using System.Threading.Tasks;
using GF.Core;
using UnityEngine;

namespace GF.World
{
    /// <summary>
    /// Terrain sampled once from the exact analytic TerrainModel (bit-identical to the TypeScript game) at a fine
    /// grid. Used for mesh building, player ground contact, grass/rock placement. Bilinear lookups are within ~1 cm
    /// of the analytic function on this terrain's smooth features, and the player stands on what is rendered.
    /// </summary>
    public sealed class Heightmap
    {
        public readonly float Size, Cell, Half;
        public readonly int Res;
        readonly float[] h;
        public readonly float Min, Max;
        public readonly TerrainModel Model;

        public Heightmap(TerrainModel model, float size, float cell)
        {
            Model = model; Size = size; Cell = cell; Half = size * 0.5f;
            Res = Mathf.RoundToInt(size / cell);
            int n = Res + 1;
            h = new float[n * n];
            float min = float.MaxValue, max = float.MinValue;
            object gate = new object();
            Parallel.For(0, n, () => (lo: float.MaxValue, hi: float.MinValue), (j, _, acc) =>
            {
                double z = -Half + j * (double)cell;
                for (int i = 0; i < n; i++)
                {
                    float v = (float)model.Height(-Half + i * (double)cell, z);
                    h[j * n + i] = v;
                    if (v < acc.lo) acc.lo = v;
                    if (v > acc.hi) acc.hi = v;
                }
                return acc;
            }, acc => { lock (gate) { if (acc.lo < min) min = acc.lo; if (acc.hi > max) max = acc.hi; } });
            Min = min; Max = max;
        }

        float At(int i, int j)
        {
            i = Mathf.Clamp(i, 0, Res); j = Mathf.Clamp(j, 0, Res);
            return h[j * (Res + 1) + i];
        }

        public float Height(float x, float z)
        {
            float gx = Mathf.Clamp((x + Half) / Cell, 0, Res - 1e-4f);
            float gz = Mathf.Clamp((z + Half) / Cell, 0, Res - 1e-4f);
            int i = (int)gx, j = (int)gz;
            float fx = gx - i, fz = gz - j;
            float a = At(i, j), b = At(i + 1, j), c = At(i, j + 1), d = At(i + 1, j + 1);
            return Mathf.Lerp(Mathf.Lerp(a, b, fx), Mathf.Lerp(c, d, fx), fz);
        }

        /// <summary>Unit surface normal from central differences over <paramref name="e"/> metres.</summary>
        public Vector3 Normal(float x, float z, float e = 0.0f)
        {
            if (e <= 0) e = Cell;
            float hx = Height(x - e, z) - Height(x + e, z);
            float hz = Height(x, z - e) - Height(x, z + e);
            return new Vector3(hx, 2 * e, hz).normalized;
        }

        /// <summary>0 = flat, 1 = vertical (same definition as the TypeScript Heightfield.slopeAt).</summary>
        public float Slope(float x, float z) => 1f - Normal(x, z).y;
    }
}
