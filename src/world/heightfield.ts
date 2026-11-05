import { SimplexNoise, createRng, smoothstep, clamp } from "../core/random";
import { WORLD } from "../core/worldConfig";
import type { PlanetDef } from "../universe/types";

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

// ------------------------------------------------------------------ data-driven terrain (M4)

/** Flat-floored depression filled by the planet liquid (lake, frozen lake, lava field, acid marsh). */
export interface Basin {
  x: number;
  z: number;
  r: number;
  /** Absolute floor height. */
  floor: number;
}

/** Volcanic cone with a lava pit. */
export interface Caldera {
  x: number;
  z: number;
  r: number;
  h: number;
  /** Absolute pit floor height. */
  pit: number;
}

/** Small flat, dry pad (points of interest stand on these). */
export interface Pad {
  x: number;
  z: number;
  inner: number;
  outer: number;
  h: number;
}

export interface TerrainModel {
  fn: HeightFn;
  craters: Crater[];
  basins: Basin[];
  calderas: Caldera[];
  pads: Pad[];
  /** Landing basin height (before small detail noise). */
  siteBase: number;
}

type TerrainDefLike = Pick<PlanetDef, "seed" | "terrain" | "landingSite" | "liquid" | "pois">;

/** Numeric terrain extra with a default (TerrainParams allows free-form keys). */
export function terrainNum(def: Pick<PlanetDef, "terrain">, key: string, fallback: number): number {
  const v = def.terrain[key];
  return typeof v === "number" ? v : fallback;
}

/**
 * Data-driven terrain for any PlanetDef. With Veyra-7's parameters every
 * operation runs in the same order as `createTerrainFunction`, so the result
 * is bit-identical (tested). New worlds add optional features after the
 * legacy terms: domain warp, terraces, dunes, rivers, liquid basins,
 * calderas and flat POI pads. Feature placement uses its own RNG stream.
 */
export function buildTerrainModel(def: TerrainDefLike): TerrainModel {
  const seed = def.seed;
  const T = def.terrain;
  const num = (k: string, d: number) => terrainNum(def, k, d);
  const n = new SimplexNoise(seed);
  const rng = createRng(seed ^ 0x5eed);
  const site = def.landingSite;
  const level = def.liquid.kind === "none" ? -1e6 : def.liquid.level;

  const baseScale = num("baseScale", 380);
  const detailScale = num("detailScale", 90);
  const ridgeScale = num("ridgeScale", 260);
  const mountainScale = num("mountainScale", 170);
  const mountainStart = num("mountainStart", 540);
  const mountainEnd = num("mountainEnd", 780);
  const mountainBase = num("mountainBase", 35);
  const craterSpread = num("craterSpread", 480);
  const flatInner = num("flatInner", 30);
  const flatOuter = num("flatOuter", 75);
  const warp = num("warp", 0);
  const terraces = num("terraces", 0);
  const terraceStep = num("terraceStep", 12);
  const dunes = num("dunes", 0);
  const rivers = num("rivers", 0);
  const riverWidth = num("riverWidth", 0.025);
  const riverDepth = num("riverDepth", 3);

  const craters: Crater[] = [];
  for (let i = 0; i < T.craters; i++) {
    const r = 18 + rng() * 42;
    craters.push({
      x: (rng() * 2 - 1) * craterSpread,
      z: (rng() * 2 - 1) * craterSpread,
      r,
      depth: r * (0.18 + rng() * 0.14),
      rim: r * (0.06 + rng() * 0.05),
    });
  }
  if (T.siteCrater === true) craters.push({ x: site.x + 70, z: site.z - 55, r: 26, depth: 6, rim: 2.2 });

  // ---- feature placement (separate stream; Veyra-7 places none)
  const frng = createRng((seed ^ 0xfea7) >>> 0);
  const keepOut = [{ x: site.x, z: site.z, r: flatOuter + 25 }, ...def.pois.map((p) => ({ x: p.x, z: p.z, r: 34 }))];
  const place = (count: number, minR: number, maxR: number, size: (i: number) => number, margin: number): { x: number; z: number; r: number }[] => {
    const out: { x: number; z: number; r: number }[] = [];
    for (let i = 0; i < count; i++) {
      for (let t = 0; t < 40; t++) {
        const r = size(i);
        const a = frng() * Math.PI * 2;
        const d = minR + Math.sqrt(frng()) * (maxR - minR);
        const x = Math.cos(a) * d, z = Math.sin(a) * d;
        if (keepOut.some((k) => Math.hypot(x - k.x, z - k.z) < k.r + r * margin)) continue;
        if (out.some((o) => Math.hypot(x - o.x, z - o.z) < (o.r + r) * 1.15)) continue;
        out.push({ x, z, r });
        break;
      }
    }
    return out;
  };
  const calderas: Caldera[] = place(num("calderas", 0), 220, 500, () => 85 + frng() * 50, 1.5).map((c) => ({
    ...c,
    h: 55 + frng() * 50,
    pit: level - 2.5,
  }));
  for (const c of calderas) keepOut.push({ x: c.x, z: c.z, r: c.r * 1.5 });
  const basinMin = num("basinMin", 40), basinRange = num("basinRange", 50), basinDepth = num("basinDepth", 4);
  const basins: Basin[] = place(num("basins", 0), 90, 500, () => basinMin + frng() * basinRange, 1.05).map((b) => ({
    ...b,
    floor: level - basinDepth - frng() * basinDepth * 0.5,
  }));

  const raw = (x: number, z: number): number => {
    let px = x, pz = z;
    if (warp > 0) {
      px = x + n.noise2(x / 420 + 17, z / 420 - 4) * warp;
      pz = z + n.noise2(x / 420 - 9, z / 420 + 23) * warp;
    }
    let h = n.fbm(px / baseScale, pz / baseScale, 5) * T.baseAmp + n.fbm(px / detailScale + 40, pz / detailScale - 13, 3) * T.detailAmp;
    const hillMask = smoothstep(-0.1, 0.55, n.noise2(px / 620 + 3.1, pz / 620 - 1.7));
    h += n.ridged(px / ridgeScale + 11, pz / ridgeScale - 7, 4) * T.ridgeAmp * hillMask;
    const r = Math.sqrt(x * x + z * z);
    const m = smoothstep(mountainStart, mountainEnd, r);
    if (m > 0) h += (n.ridged(px / mountainScale - 3, pz / mountainScale + 5, 5) * T.mountainAmp + mountainBase) * m;
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
    if (terraces > 0) {
      const q = h / terraceStep;
      const fl = Math.floor(q);
      const tq = (fl + smoothstep(0.3, 0.7, q - fl)) * terraceStep;
      h += (tq - h) * terraces * smoothstep(4, 22, h);
    }
    if (dunes > 0) h += dunes * (n.ridged(x / 46 + 5, z / 24 - 9, 2) - 0.5);
    if (rivers > 0 && r < 560) {
      const v = Math.abs(n.noise2(px / 340 + 7.7, pz / 340 - 3.3));
      const ch = (1 - smoothstep(riverWidth * 0.45, riverWidth, v)) * rivers * (1 - smoothstep(470, 560, r));
      if (ch > 0) h += (Math.min(h, level - riverDepth) - h) * ch;
    }
    for (const c of calderas) {
      const dx = x - c.x, dz = z - c.z;
      const d = Math.sqrt(dx * dx + dz * dz) / c.r;
      if (d > 1.6) continue;
      const hh = c.h * (0.85 + 0.3 * n.noise2(x / 35, z / 35));
      const cone = hh * Math.pow(1 - smoothstep(0.3, 1.6, d), 1.6);
      h += cone;
      const pitT = smoothstep(0.32, 0.17, d);
      if (pitT > 0) h += (c.pit - h) * pitT;
    }
    for (const b of basins) {
      const dx = x - b.x, dz = z - b.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > b.r * b.r * 1.44) continue;
      const d = Math.sqrt(d2) / b.r + n.noise2(x / 45 + 3, z / 45 - 8) * 0.14;
      const w = smoothstep(1.05, 0.6, d);
      if (w > 0) h += (Math.min(h, b.floor + n.noise2(x / 20, z / 20) * 0.6) - h) * w;
    }
    return h;
  };

  // Flat, dry pads under points of interest (new worlds only).
  const pads: Pad[] = [];
  const padFn = (x: number, z: number): number => {
    let h = raw(x, z);
    for (const p of pads) {
      const dx = x - p.x, dz = z - p.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= p.outer * p.outer) continue;
      const f = 1 - smoothstep(p.inner, p.outer, Math.sqrt(d2));
      h = h * (1 - f) + p.h * f;
    }
    return h;
  };
  if (T.poiPads === true) {
    for (const p of def.pois) {
      const inner = p.id === "kharon" ? 34 : 15, outer = inner + 22;
      // Average the raw height so the pad sits naturally in the slope, then keep it dry.
      let s = 0;
      for (let k = 0; k < 8; k++) s += raw(p.x + Math.cos(k * 0.785) * inner, p.z + Math.sin(k * 0.785) * inner);
      pads.push({ x: p.x, z: p.z, inner, outer, h: Math.max(s / 8, raw(p.x, p.z) * 0.5 + (s / 8) * 0.5, level + 2.2) });
    }
  }

  // Gentle, flat-ish landing basin at the landing site (dry on every world).
  let siteBase = n.fbm(site.x / 380, site.z / 380, 2) * 6 + 2;
  if (T.siteCrater !== true) siteBase = Math.max(siteBase + num("siteLift", 0), level + 3.5);
  const fn = (x: number, z: number): number => {
    const h = padFn(x, z);
    const dx = x - site.x;
    const dz = z - site.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    const flat = 1 - smoothstep(flatInner, flatOuter, d);
    if (flat <= 0) return h;
    const soft = siteBase + n.fbm(x / 60, z / 60, 2) * 0.8;
    return h * (1 - flat) + soft * flat;
  };
  return { fn, craters, basins, calderas, pads, siteBase };
}

/** Height function for a planet def (Veyra-7: identical to `createTerrainFunction()`). */
export function createPlanetTerrain(def: TerrainDefLike): HeightFn {
  return buildTerrainModel(def).fn;
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
