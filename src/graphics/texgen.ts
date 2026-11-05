/**
 * Pure, tileable procedural texture generators (no Babylon / DOM). They return
 * RGBA byte arrays, so they can be unit-tested and uploaded through a canvas.
 * All content is original and generated at runtime: no third-party assets.
 */
import { createRng } from "../core/random";

export type Pixels = Uint8ClampedArray;

/** Periodic value noise in [0,1] with integer `period` cells across the tile. */
export function periodicNoise(seed: number, period: number): (u: number, v: number) => number {
  const rng = createRng(seed);
  const lat = new Float32Array(period * period);
  for (let i = 0; i < lat.length; i++) lat[i] = rng();
  return (u, v) => {
    const x = u * period, y = v * period;
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const w = (i: number) => ((i % period) + period) % period;
    const a = lat[w(yi) * period + w(xi)], b = lat[w(yi) * period + w(xi + 1)];
    const c = lat[w(yi + 1) * period + w(xi)], d = lat[w(yi + 1) * period + w(xi + 1)];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

/** Periodic fractal noise in [0,1]. */
export function periodicFbm(seed: number, basePeriod: number, octaves: number): (u: number, v: number) => number {
  const layers = Array.from({ length: octaves }, (_, o) => periodicNoise(seed + o * 101, basePeriod << o));
  return (u, v) => {
    let s = 0, amp = 0.5, n = 0;
    for (const l of layers) {
      s += l(u, v) * amp;
      n += amp;
      amp *= 0.5;
    }
    return s / n;
  };
}

/** Periodic Worley (cellular) F1 distance, roughly in [0,1]. */
export function periodicWorley(seed: number, cells: number): (u: number, v: number) => number {
  const rng = createRng(seed);
  const pts = new Float32Array(cells * cells * 2);
  for (let i = 0; i < pts.length; i++) pts[i] = rng();
  return (u, v) => {
    const x = u * cells, y = v * cells;
    const xi = Math.floor(x), yi = Math.floor(y);
    let best = 9;
    for (let j = -1; j <= 1; j++)
      for (let i = -1; i <= 1; i++) {
        const cx = xi + i, cy = yi + j;
        const wx = ((cx % cells) + cells) % cells, wy = ((cy % cells) + cells) % cells;
        const px = cx + pts[(wy * cells + wx) * 2], py = cy + pts[(wy * cells + wx) * 2 + 1];
        const d = (px - x) * (px - x) + (py - y) * (py - y);
        if (d < best) best = d;
      }
    return Math.sqrt(best);
  };
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Ground atlas (RGBA, tiled in world space by the terrain shader):
 *  R soil grain · G lichen/moss patches · B layered rock strata · A pebbles & cracks
 * plus a matching height field used for the normal map.
 */
export function groundAtlas(size: number, seed = 11): { rgba: Pixels; height: Float32Array } {
  const grain = periodicFbm(seed, 16, 4);
  const fine = periodicNoise(seed + 7, 64);
  const moss = periodicFbm(seed + 20, 4, 4);
  const warp = periodicFbm(seed + 30, 4, 3);
  const strata = periodicFbm(seed + 40, 8, 3);
  const cells = periodicWorley(seed + 50, 12);
  const cracks = periodicWorley(seed + 60, 6);
  const rgba = new Uint8ClampedArray(size * size * 4);
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const g = grain(u, v) * 0.7 + fine(u, v) * 0.3;
      const m = clamp01((moss(u, v) - 0.42) * 3.2);
      const wv = v + (warp(u, v) - 0.5) * 0.18;
      const band = 0.5 + 0.5 * Math.sin(wv * Math.PI * 2 * 7 + strata(u, v) * 5);
      const s = clamp01(band * 0.55 + strata(u, wv) * 0.45);
      const peb = cells(u, v);
      const pebble = clamp01(1 - peb * 2.4);
      const cr = cracks(u, v);
      const crack = clamp01(1 - Math.abs(cr - 0.62) * 14) * 0.8;
      const a = clamp01(0.55 + pebble * 0.45 - crack * 0.6);
      const i = (y * size + x) * 4;
      rgba[i] = g * 255;
      rgba[i + 1] = m * 255;
      rgba[i + 2] = s * 255;
      rgba[i + 3] = a * 255;
      height[y * size + x] = g * 0.35 + pebble * 0.45 - crack * 0.5 + s * 0.25;
    }
  }
  return { rgba, height };
}

/** Tangent-space normal map from a tileable height field (RGB, A = height). */
export function normalFromHeight(height: Float32Array, size: number, strength: number): Pixels {
  const out = new Uint8ClampedArray(size * size * 4);
  const h = (x: number, y: number) => height[(((y % size) + size) % size) * size + (((x % size) + size) % size)];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * strength;
      const dy = (h(x, y + 1) - h(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      out[i] = (-dx / len * 0.5 + 0.5) * 255;
      out[i + 1] = (-dy / len * 0.5 + 0.5) * 255;
      out[i + 2] = (1 / len * 0.5 + 0.5) * 255;
      out[i + 3] = clamp01(h(x, y)) * 255;
    }
  return out;
}

/** Rolling-wave height field for the luminous lakes. */
export function waterHeight(size: number, seed = 5): Float32Array {
  const n1 = periodicFbm(seed, 4, 4);
  const n2 = periodicNoise(seed + 9, 16);
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      out[y * size + x] = Math.sin((u + n1(u, v) * 0.35) * Math.PI * 2 * 3) * 0.35 + Math.sin((v * 2 + u) * Math.PI * 2 * 2 + n2(u, v) * 3) * 0.25 + n1(u, v) * 0.6;
    }
  return out;
}

/**
 * Hull panels: albedo (RGB) and a packed ORM-style map
 * (R occlusion, G roughness, B metallic) for metal-roughness PBR.
 */
export function hullPanels(size: number, seed = 3): { albedo: Pixels; orm: Pixels; height: Float32Array } {
  const rng = createRng(seed);
  const wear = periodicFbm(seed + 1, 8, 4);
  const grime = periodicFbm(seed + 2, 4, 3);
  const albedo = new Uint8ClampedArray(size * size * 4);
  const orm = new Uint8ClampedArray(size * size * 4);
  const height = new Float32Array(size * size);
  // Panel grid with a few split panels for an irregular plate layout.
  const cols = 6, rows = 6;
  const tint = Array.from({ length: cols * rows }, () => 0.92 + rng() * 0.08);
  const splits = Array.from({ length: cols * rows }, () => (rng() < 0.35 ? 0.3 + rng() * 0.4 : -1));
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const cx = Math.floor(u * cols), cy = Math.floor(v * rows);
      const fu = u * cols - cx, fv = v * rows - cy;
      const id = cy * cols + cx;
      const sp = splits[id];
      const seamU = Math.min(fu, 1 - fu), seamV = Math.min(fv, 1 - fv);
      let seam = Math.min(seamU, seamV);
      if (sp > 0) seam = Math.min(seam, Math.abs(fu - sp));
      const line = seam < 0.012 ? 1 : 0;
      const rivet = (seamU < 0.05 && seamV > 0.08 && Math.abs((fv * 8) % 1 - 0.5) < 0.12 && Math.abs(seamU - 0.03) < 0.012) ? 1 : 0;
      const w = wear(u, v), gr = grime(u, v);
      const base = tint[id] * (0.86 + w * 0.14) * (1 - gr * 0.18) * (1 - line * 0.55) * (1 - rivet * 0.3);
      const i = (y * size + x) * 4;
      albedo[i] = base * 235;
      albedo[i + 1] = base * 236;
      albedo[i + 2] = base * 242;
      albedo[i + 3] = 255;
      orm[i] = (1 - line * 0.5) * 255;
      orm[i + 1] = clamp01(0.32 + gr * 0.35 + line * 0.3 - w * 0.08) * 255;
      orm[i + 2] = clamp01(0.55 - gr * 0.3) * 255;
      orm[i + 3] = 255;
      height[y * size + x] = -line * 1 - rivet * 0.5 + w * 0.05;
    }
  }
  return { albedo, orm, height };
}

/** Suit fabric weave height field. */
export function fabricHeight(size: number): Float32Array {
  const out = new Float32Array(size * size);
  const n = periodicNoise(77, 32);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const a = Math.sin(u * Math.PI * 2 * 48) * Math.sin(v * Math.PI * 2 * 48);
      out[y * size + x] = (a > 0 ? a : a * 0.6) * 0.5 + n(u, v) * 0.5;
    }
  return out;
}

/** Packs a height field into a grey RGBA image (for previews and detail maps). */
export function grey(height: Float32Array, size: number, lo = 0, hi = 1): Pixels {
  const out = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const g = clamp01((height[i] - lo) / (hi - lo)) * 255;
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = g;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/**
 * Molten lava (sRGB RGBA, tileable): dark cooling crust plates split by bright
 * veins, with hotter pools. Used as an emissive map on lava liquids.
 */
export function lavaTexture(size: number, seed = 23): Pixels {
  const warp = periodicFbm(seed, 4, 3);
  const veins = periodicFbm(seed + 5, 6, 4);
  const pools = periodicFbm(seed + 9, 3, 3);
  const cells = periodicWorley(seed + 13, 10);
  const out = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const w = warp(u, v);
      const n = veins(u + (w - 0.5) * 0.12, v - (w - 0.5) * 0.12);
      const vein = clamp01(1 - Math.abs(n - 0.5) * 16);
      const cell = clamp01(cells(u, v) * 1.6);
      const pool = clamp01((pools(u, v) - 0.56) * 5);
      const heat = clamp01(vein * 0.9 + pool * 0.8 + cell * cell * 0.25);
      const i = (y * size + x) * 4;
      // Crust → orange → yellow-white.
      out[i] = (0.12 + heat * 0.88) * 255;
      out[i + 1] = (0.03 + heat * heat * 0.62) * 255;
      out[i + 2] = (0.02 + heat * heat * heat * 0.32) * 255;
      out[i + 3] = 255;
    }
  return out;
}
