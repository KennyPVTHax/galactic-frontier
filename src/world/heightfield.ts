import { SimplexNoise, createRng, smoothstep, clamp } from "../core/random";
import { WORLD } from "../core/worldConfig";

export type HeightFn = (x: number, z: number) => number;

interface Crater {
  x: number;
  z: number;
  r: number;
  depth: number;
  rim: number;
}

/**
 * Analytic terrain shape for Veyra-7. Pure function of (x, z) and seed so the
 * same planet is generated on every device and in tests.
 */
export function createTerrainFunction(seed: number = WORLD.seed): HeightFn {
  const n = new SimplexNoise(seed);
  const rng = createRng(seed ^ 0x5eed);
  const site = WORLD.surveySite;
  const craters: Crater[] = [];
  for (let i = 0; i < 9; i++) {
    const r = 18 + rng() * 42;
    craters.push({
      x: (rng() * 2 - 1) * 480,
      z: (rng() * 2 - 1) * 480,
      r,
      depth: r * (0.18 + rng() * 0.14),
      rim: r * (0.06 + rng() * 0.05),
    });
  }
  // One guaranteed crater near the survey site: it is where Void Quartz forms.
  craters.push({ x: site.x + 70, z: site.z - 55, r: 26, depth: 6, rim: 2.2 });

  const raw = (x: number, z: number): number => {
    let h = n.fbm(x / 380, z / 380, 5) * 14 + n.fbm(x / 90 + 40, z / 90 - 13, 3) * 3.2;
    const hillMask = smoothstep(-0.1, 0.55, n.noise2(x / 620 + 3.1, z / 620 - 1.7));
    h += n.ridged(x / 260 + 11, z / 260 - 7, 4) * 30 * hillMask;
    const r = Math.sqrt(x * x + z * z);
    const m = smoothstep(540, 780, r);
    if (m > 0) h += (n.ridged(x / 170 - 3, z / 170 + 5, 5) * 200 + 35) * m;
    for (const c of craters) {
      const dx = x - c.x;
      const dz = z - c.z;
      const d2 = dx * dx + dz * dz;
      const lim = c.r * 1.8;
      if (d2 > lim * lim) continue;
      const d = Math.sqrt(d2) / c.r;
      if (d < 1) h -= c.depth * (1 - d * d);
      const rimT = (d - 1) / 0.28;
      h += c.rim * Math.exp(-rimT * rimT);
    }
    return h;
  };

  // Gentle, flat-ish landing basin at the survey site.
  const siteBase = n.fbm(site.x / 380, site.z / 380, 2) * 6 + 2;
  return (x: number, z: number): number => {
    const h = raw(x, z);
    const dx = x - site.x;
    const dz = z - site.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    const flat = 1 - smoothstep(30, 75, d);
    if (flat <= 0) return h;
    const soft = siteBase + n.fbm(x / 60, z / 60, 2) * 0.8;
    return h * (1 - flat) + soft * flat;
  };
}

/**
 * Sampled grid matching the rendered terrain mesh exactly, so feet, ship skids
 * and camera never float above or sink below the visible triangles.
 */
export class Heightfield {
  readonly size: number;
  readonly res: number;
  readonly cell: number;
  readonly half: number;
  readonly heights: Float32Array;
  minHeight = Infinity;
  maxHeight = -Infinity;

  constructor(fn: HeightFn, size: number, res: number) {
    this.size = size;
    this.res = res;
    this.cell = size / res;
    this.half = size / 2;
    const n = res + 1;
    this.heights = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const h = fn(-this.half + i * this.cell, -this.half + j * this.cell);
        this.heights[j * n + i] = h;
        if (h < this.minHeight) this.minHeight = h;
        if (h > this.maxHeight) this.maxHeight = h;
      }
    }
  }

  private at(i: number, j: number): number {
    const n = this.res + 1;
    i = clamp(i, 0, this.res);
    j = clamp(j, 0, this.res);
    return this.heights[j * n + i];
  }

  /** Height on the triangle surface. Triangles split along the (i,j)-(i+1,j+1) diagonal. */
  heightAt(x: number, z: number): number {
    const gx = clamp((x + this.half) / this.cell, 0, this.res - 1e-6);
    const gz = clamp((z + this.half) / this.cell, 0, this.res - 1e-6);
    const i = Math.floor(gx);
    const j = Math.floor(gz);
    const fx = gx - i;
    const fz = gz - j;
    const h00 = this.at(i, j);
    const h10 = this.at(i + 1, j);
    const h01 = this.at(i, j + 1);
    const h11 = this.at(i + 1, j + 1);
    if (fx > fz) return h00 + (h10 - h00) * fx + (h11 - h10) * fz;
    return h00 + (h11 - h01) * fx + (h01 - h00) * fz;
  }

  /** Surface normal (unit) via central differences. */
  normalAt(x: number, z: number): { x: number; y: number; z: number } {
    const e = this.cell;
    const hx = this.heightAt(x - e, z) - this.heightAt(x + e, z);
    const hz = this.heightAt(x, z - e) - this.heightAt(x, z + e);
    const ny = 2 * e;
    const len = Math.hypot(hx, ny, hz);
    return { x: hx / len, y: ny / len, z: hz / len };
  }

  /** 0 = flat, 1 = vertical. */
  slopeAt(x: number, z: number): number {
    return 1 - this.normalAt(x, z).y;
  }

  /** Vertex normal for mesh building. */
  vertexNormal(i: number, j: number): [number, number, number] {
    const hx = this.at(i - 1, j) - this.at(i + 1, j);
    const hz = this.at(i, j - 1) - this.at(i, j + 1);
    const ny = 2 * this.cell;
    const len = Math.hypot(hx, ny, hz);
    return [hx / len, ny / len, hz / len];
  }
}
