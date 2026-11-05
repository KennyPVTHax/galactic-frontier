/**
 * Shared surface resources for the Wayfarer and Halcyon Dock (M3).
 *
 * - Procedural, tileable panel textures (albedo / normal / ORM) generated from a
 *   seeded rectangle subdivision: seams, rivets, hatches, stencil blocks, grime.
 *   They are RawTextures (no canvas), so they also work in NullEngine tests and
 *   are re-uploaded by Babylon after a WebGL context loss.
 * - Radial glow texture for additive halos and particles.
 * - Scorch detail map used to show hull damage.
 * - `SurfaceMaterial`: one look with a StandardMaterial (Basic) and a
 *   PBRMaterial (Enhanced / Extreme HD) that can be swapped live and fully disposed.
 *
 * Everything here is original procedural content; no external assets.
 */
import { Color3, Constants, FresnelParameters, Material, PBRMaterial, RawTexture, Scene, StandardMaterial, Texture, type AbstractMesh } from "../engine/babylon";

export type RGB = [number, number, number];

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ texture generation

export type PanelStyle = "ship" | "station";

/** Tileable value noise in [0,1] at integer lattice `cells`. */
function valueNoise(size: number, cells: number, rand: () => number): Float32Array {
  const lat = new Float32Array(cells * cells);
  for (let i = 0; i < lat.length; i++) lat[i] = rand();
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const fy = (y / size) * cells;
    const y0 = Math.floor(fy), ty = fy - y0;
    const sy = ty * ty * (3 - 2 * ty);
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells;
      const x0 = Math.floor(fx), tx = fx - x0;
      const sx = tx * tx * (3 - 2 * tx);
      const a = lat[(y0 % cells) * cells + (x0 % cells)];
      const b = lat[(y0 % cells) * cells + ((x0 + 1) % cells)];
      const c = lat[((y0 + 1) % cells) * cells + (x0 % cells)];
      const d = lat[((y0 + 1) % cells) * cells + ((x0 + 1) % cells)];
      out[y * size + x] = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    }
  }
  return out;
}

export interface PanelPixels {
  albedo: Uint8Array;
  normal: Uint8Array;
  orm: Uint8Array;
}

/** Generates the panel set (pure function, deterministic for a seed). */
export function generatePanels(size: number, seed: number, style: PanelStyle): PanelPixels {
  const rand = mulberry32(seed);
  const N = size;
  const height = new Float32Array(N * N).fill(1);
  const tone = new Float32Array(N * N).fill(1);
  const rough = new Float32Array(N * N).fill(0.75);
  const px = N / 256; // pixel scale relative to a 256 texture
  const seam = Math.max(1, 1.1 * px);

  type R = { x: number; y: number; w: number; h: number };
  const rects: R[] = [];
  const grid = 2;
  const cell = N / grid;
  const split = (r: R, depth: number) => {
    const min = 10 * px;
    if (depth <= 0 || (r.w < min * 2.4 && r.h < min * 2.4) || (depth < 2 && rand() < 0.3)) return rects.push(r);
    const vertical = r.w > r.h ? rand() < 0.8 : rand() < 0.2;
    const k = 0.3 + rand() * 0.4;
    if (vertical && r.w >= min * 2) {
      const w = Math.round(r.w * k);
      split({ x: r.x, y: r.y, w, h: r.h }, depth - 1);
      split({ x: r.x + w, y: r.y, w: r.w - w, h: r.h }, depth - 1);
    } else if (r.h >= min * 2) {
      const h = Math.round(r.h * k);
      split({ x: r.x, y: r.y, w: r.w, h }, depth - 1);
      split({ x: r.x, y: r.y + h, w: r.w, h: r.h - h }, depth - 1);
    } else rects.push(r);
  };
  for (let gy = 0; gy < grid; gy++) for (let gx = 0; gx < grid; gx++) split({ x: Math.round(gx * cell), y: Math.round(gy * cell), w: Math.round(cell), h: Math.round(cell) }, style === "ship" ? 3 : 2);

  const set = (x: number, y: number, h: number, t: number, ro?: number) => {
    const i = (((y % N) + N) % N) * N + (((x % N) + N) % N);
    height[i] = Math.min(height[i], h);
    tone[i] *= t;
    if (ro !== undefined) rough[i] = ro;
  };
  for (const r of rects) {
    const t = 0.9 + rand() * 0.14;
    const ro = 0.62 + rand() * 0.26;
    const inset = rand() < 0.18; // slightly recessed service panel
    for (let y = 0; y < r.h; y++) {
      for (let x = 0; x < r.w; x++) {
        const d = Math.min(x + 0.5, y + 0.5, r.w - x - 0.5, r.h - y - 0.5);
        const i = (r.y + y) * N + (r.x + x);
        tone[i] = t;
        rough[i] = ro;
        if (d < seam) {
          height[i] = 0.05 + 0.5 * (d / seam);
          tone[i] = t * 0.68;
          rough[i] = 0.9;
        } else if (d < seam * 2.2) {
          height[i] = 0.75 + 0.25 * ((d - seam) / (seam * 1.2));
          tone[i] = t * 0.93;
        } else if (inset) height[i] = 0.82;
      }
    }
    // Rivet rows along long edges.
    if (rand() < 0.55) {
      const step = Math.max(4, Math.round(6 * px));
      const off = Math.round(seam * 3);
      const horiz = r.w > r.h;
      const len = horiz ? r.w : r.h;
      for (let s = off * 2; s < len - off * 2; s += step) {
        for (const side of [off, (horiz ? r.h : r.w) - off - 1]) {
          const cx = horiz ? r.x + s : r.x + side;
          const cy = horiz ? r.y + side : r.y + s;
          set(cx, cy, 1, 0.8, 0.45);
          if (px >= 2) set(cx + 1, cy, 1, 0.85, 0.45);
        }
      }
    }
    // Hatch outline inside larger panels.
    if (r.w > 28 * px && r.h > 22 * px && rand() < 0.45) {
      const hw = Math.round(r.w * (0.35 + rand() * 0.3));
      const hh = Math.round(r.h * (0.3 + rand() * 0.3));
      const hx = r.x + Math.round((r.w - hw) / 2);
      const hy = r.y + Math.round((r.h - hh) / 2);
      for (let x = 0; x < hw; x++) for (const y of [0, hh - 1]) set(hx + x, hy + y, 0.35, 0.7, 0.85);
      for (let y = 0; y < hh; y++) for (const x of [0, hw - 1]) set(hx + x, hy + y, 0.35, 0.7, 0.85);
    }
    // Stencil blocks (read as markings / text at a distance).
    if (r.w > 20 * px && r.h > 10 * px && rand() < 0.3) {
      const bx = r.x + Math.round(seam * 4);
      const by = r.y + Math.round(seam * 4);
      const n = 3 + Math.floor(rand() * 4);
      const bh = Math.max(2, Math.round(2.2 * px));
      let cx = bx;
      for (let k = 0; k < n && cx < r.x + r.w - 6 * px; k++) {
        const bw = Math.max(1, Math.round((1.5 + rand() * 3) * px));
        for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) set(cx + x, by + y, 1, 0.45);
        cx += bw + Math.max(1, Math.round(px));
      }
    }
  }

  const grime = valueNoise(N, 8, rand);
  const fine = valueNoise(N, 32, rand);
  const albedo = new Uint8Array(N * N * 4);
  const orm = new Uint8Array(N * N * 4);
  const normal = new Uint8Array(N * N * 4);
  const strength = style === "ship" ? 2.2 : 2.6;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const g = 0.97 + (grime[i] - 0.5) * 0.1 + (fine[i] - 0.5) * 0.04;
      const v = Math.max(0, Math.min(1, tone[i] * g * (0.86 + 0.14 * height[i])));
      const o = i * 4;
      const c = Math.round(v * 250);
      albedo[o] = c;
      albedo[o + 1] = c;
      albedo[o + 2] = Math.min(255, Math.round(c * 1.02));
      albedo[o + 3] = 255;
      orm[o] = Math.round((0.55 + 0.45 * height[i]) * 255);
      orm[o + 1] = Math.round(Math.min(1, rough[i] * (0.9 + grime[i] * 0.2)) * 255);
      orm[o + 2] = 255;
      orm[o + 3] = 255;
      const hl = height[y * N + ((x + N - 1) % N)], hr = height[y * N + ((x + 1) % N)];
      const hu = height[((y + N - 1) % N) * N + x], hd = height[((y + 1) % N) * N + x];
      let nx = (hl - hr) * strength, ny = (hu - hd) * strength;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      normal[o] = Math.round((nx * 0.5 + 0.5) * 255);
      normal[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normal[o + 2] = Math.round(((nz / len) * 0.5 + 0.5) * 255);
      normal[o + 3] = 255;
    }
  }
  return { albedo, normal, orm };
}

/** Radial glow (RGB white, alpha falloff) for halos, flares and particles. */
export function glowPixels(size: number, core = 0.18, falloff = 2.2): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  const h = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.min(1, Math.hypot(x - h, y - h) / h);
      const a = Math.pow(1 - r, falloff) * (1 - core) + (r < core ? (1 - r / core) * core : 0);
      const o = (y * size + x) * 4;
      out[o] = out[o + 1] = out[o + 2] = 255;
      out[o + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255);
    }
  }
  return out;
}

/** Detail map (R: diffuse 0.5 = neutral, GB: normal, A: roughness) with burn blotches for hull damage. */
export function scorchPixels(size: number, seed: number): Uint8Array {
  const rand = mulberry32(seed);
  const n = valueNoise(size, 6, rand);
  const f = valueNoise(size, 24, rand);
  const out = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const v = n[i] * 0.75 + f[i] * 0.25;
    const burn = Math.max(0, Math.min(1, (v - 0.48) * 4.5));
    const o = i * 4;
    out[o] = Math.round((0.5 - burn * 0.42) * 255);
    out[o + 1] = 128;
    out[o + 2] = 128;
    out[o + 3] = Math.round((0.5 + burn * 0.4) * 255);
  }
  return out;
}

// ------------------------------------------------------------------ shared GPU resources (ref-counted per scene)

export interface PanelSet {
  key: string;
  albedo: RawTexture;
  normal: RawTexture;
  orm: RawTexture;
  refs: number;
}

const panelCache = new WeakMap<Scene, Map<string, PanelSet>>();

function raw(scene: Scene, name: string, px: Uint8Array, size: number, srgb: boolean): RawTexture {
  const t = RawTexture.CreateRGBATexture(px, size, size, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
  t.name = name;
  t.wrapU = t.wrapV = Texture.WRAP_ADDRESSMODE;
  t.gammaSpace = srgb;
  t.anisotropicFilteringLevel = 4;
  return t;
}

export function acquirePanels(scene: Scene, size: number, style: PanelStyle): PanelSet {
  let m = panelCache.get(scene);
  if (!m) panelCache.set(scene, (m = new Map()));
  const key = `${style}-${size}`;
  let s = m.get(key);
  if (!s) {
    const px = generatePanels(size, style === "ship" ? 0x5a1e : 0x7d0c, style);
    s = {
      key,
      albedo: raw(scene, `gf-panel-${key}-a`, px.albedo, size, true),
      normal: raw(scene, `gf-panel-${key}-n`, px.normal, size, false),
      orm: raw(scene, `gf-panel-${key}-orm`, px.orm, size, false),
      refs: 0,
    };
    m.set(key, s);
  }
  s.refs++;
  return s;
}

export function releasePanels(scene: Scene, s: PanelSet | null | undefined): void {
  if (!s) return;
  s.refs--;
  if (s.refs > 0) return;
  s.albedo.dispose();
  s.normal.dispose();
  s.orm.dispose();
  panelCache.get(scene)?.delete(s.key);
}

export function makeGlowTexture(scene: Scene, name: string, size = 64, core = 0.18, falloff = 2.2): RawTexture {
  const t = RawTexture.CreateRGBATexture(glowPixels(size, core, falloff), size, size, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
  t.name = name;
  t.hasAlpha = true;
  t.wrapU = t.wrapV = Texture.CLAMP_ADDRESSMODE;
  return t;
}

export function makeScorchTexture(scene: Scene, name: string, size = 128, seed = 0x51c): RawTexture {
  const t = RawTexture.CreateRGBATexture(scorchPixels(size, seed), size, size, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
  t.name = name;
  t.gammaSpace = false;
  t.wrapU = t.wrapV = Texture.WRAP_ADDRESSMODE;
  return t;
}

// ------------------------------------------------------------------ dual (Standard / PBR) material

export interface SurfaceLook {
  color: RGB;
  roughness: number;
  metallic: number;
  emissive?: RGB;
  /** Use the panel texture set. */
  panels?: boolean;
  /** Own colour map instead of the panel set (unlit: shown as-is, lit: albedo). */
  map?: Texture;
  /** PBR environment (sky reflection) multiplier. */
  env?: number;
  /** Unlit emissive look (lights, glass glow, flames); always a StandardMaterial. */
  unlit?: boolean;
  /** Additive blending (with `unlit`). */
  additive?: boolean;
  alpha?: number;
  /** Opacity / glow texture for unlit additive looks. */
  opacity?: Texture;
  /** Fade alpha at grazing angles (soft plume edges) via an opacity Fresnel. */
  softEdges?: boolean;
  /** Clear-coat layer on PBR (glossy paint over metal). */
  clearCoat?: number;
  /** Damage detail map. */
  scorch?: Texture;
  backFaceCulling?: boolean;
}

/** One look, Standard on Basic and PBR on Enhanced / Extreme HD, swapped live on every bound mesh. */
export class SurfaceMaterial {
  std: StandardMaterial | null = null;
  pbr: PBRMaterial | null = null;
  private readonly bound = new Set<AbstractMesh>();
  private mode = false;
  private damage = 0;

  constructor(
    readonly name: string,
    private readonly scene: Scene,
    readonly look: SurfaceLook,
    private panels: PanelSet | null,
  ) {}

  bind(mesh: AbstractMesh): void {
    this.bound.add(mesh);
    mesh.material = this.current();
  }

  current(): Material {
    if (this.mode && !this.look.unlit) return (this.pbr ??= this.createPbr());
    return (this.std ??= this.createStd());
  }

  setMode(pbr: boolean): void {
    if (pbr === this.mode) return;
    this.mode = pbr;
    const m = this.current();
    for (const mesh of this.bound) if (!mesh.isDisposed()) mesh.material = m;
  }

  /** Re-points both materials at a different panel set (texture resolution change). */
  setPanels(p: PanelSet | null): void {
    this.panels = p;
    if (this.std) this.mapsStd(this.std);
    if (this.pbr) this.mapsPbr(this.pbr);
  }

  setColor(c: RGB, emissive?: RGB): void {
    this.look.color = c;
    if (emissive) this.look.emissive = emissive;
    if (this.std) this.colorStd(this.std);
    if (this.pbr) this.colorPbr(this.pbr);
  }

  /** 0..1 burn / scorch amount. */
  setDamage(k: number): void {
    this.damage = k;
    for (const m of [this.std, this.pbr]) if (m && this.look.scorch) m.detailMap.diffuseBlendLevel = k;
    if (this.pbr && this.look.scorch) this.pbr.detailMap.roughnessBlendLevel = k;
  }

  private colorStd(s: StandardMaterial): void {
    const L = this.look;
    const c = new Color3(...L.color);
    if (L.unlit) {
      // Unlit: colour (x map, sampled as the diffuse texture) is emitted as-is.
      s.emissiveColor = c;
      s.diffuseColor = Color3.Black();
      return;
    }
    s.diffuseColor = c;
    const spec = (1 - L.roughness) * (0.3 + L.metallic * 0.55);
    s.specularColor = Color3.Lerp(new Color3(1, 1, 1), c, L.metallic * 0.6).scale(spec);
    s.specularPower = Math.max(12, Math.min(256, 2 / Math.max(0.02, L.roughness ** 4) - 2));
    s.emissiveColor = L.emissive ? new Color3(...L.emissive) : Color3.Black();
  }

  private colorPbr(p: PBRMaterial): void {
    const L = this.look;
    p.albedoColor = new Color3(...L.color).toLinearSpace();
    const glow = L.emissive ? new Color3(...L.emissive).toLinearSpace().scale(1.8) : Color3.Black();
    // Small self-lit fill so hulls stay readable from below / in shadow (combat views often see the underside
    // against dark terrain). ~7% of the albedo; the accent glow and lights are unchanged.
    p.emissiveColor = glow.add(p.albedoColor.scale(0.07));
  }

  private createStd(): StandardMaterial {
    const L = this.look;
    const s = new StandardMaterial(`${this.name}-std`, this.scene);
    this.colorStd(s);
    if (L.unlit) {
      s.disableLighting = true;
      if (L.additive) {
        s.alphaMode = Constants.ALPHA_ADD;
        s.disableDepthWrite = true;
      }
      if (L.opacity) {
        s.opacityTexture = L.opacity;
        s.alpha = L.alpha ?? 1;
      } else if (L.alpha !== undefined) s.alpha = L.alpha;
      s.fogEnabled = !L.additive;
      if (L.softEdges) {
        const f = new FresnelParameters();
        f.leftColor = Color3.Black();
        f.rightColor = Color3.White();
        f.bias = 0.05;
        f.power = 1.6;
        s.opacityFresnelParameters = f;
      }
    } else if (L.alpha !== undefined) s.alpha = L.alpha;
    if (L.backFaceCulling === false) s.backFaceCulling = false;
    this.mapsStd(s);
    if (L.scorch) {
      s.detailMap.texture = L.scorch;
      s.detailMap.isEnabled = true;
      s.detailMap.diffuseBlendLevel = this.damage;
      s.detailMap.bumpLevel = 0;
    }
    return s;
  }

  private mapsStd(s: StandardMaterial): void {
    if (this.look.map) s.diffuseTexture = this.look.map;
    if (!this.look.panels) return;
    s.diffuseTexture = this.panels?.albedo ?? null;
    // Basic keeps a light bump only (Standard lighting exaggerates normal maps at 256 px).
    s.bumpTexture = this.panels?.normal ?? null;
  }

  private createPbr(): PBRMaterial {
    const L = this.look;
    const p = new PBRMaterial(`${this.name}-pbr`, this.scene);
    this.colorPbr(p);
    p.metallic = L.metallic;
    p.roughness = L.roughness;
    p.environmentIntensity = L.env ?? 1;
    p.directIntensity = 1;
    if (L.alpha !== undefined) p.alpha = L.alpha;
    if (L.backFaceCulling === false) p.backFaceCulling = false;
    if (L.clearCoat) {
      p.clearCoat.isEnabled = true;
      p.clearCoat.intensity = L.clearCoat;
      p.clearCoat.roughness = 0.12;
    }
    this.mapsPbr(p);
    if (L.scorch) {
      p.detailMap.texture = L.scorch;
      p.detailMap.isEnabled = true;
      p.detailMap.diffuseBlendLevel = this.damage;
      p.detailMap.roughnessBlendLevel = this.damage;
      p.detailMap.bumpLevel = 0;
    }
    return p;
  }

  private mapsPbr(p: PBRMaterial): void {
    if (this.look.map) p.albedoTexture = this.look.map;
    if (!this.look.panels) return;
    const P = this.panels;
    p.albedoTexture = P?.albedo ?? null;
    p.bumpTexture = P?.normal ?? null;
    p.metallicTexture = P?.orm ?? null;
    p.useRoughnessFromMetallicTextureGreen = true;
    p.useMetallnessFromMetallicTextureBlue = true;
    p.useAmbientOcclusionFromMetallicTextureRed = true;
    // ORM green averages ~0.72; scale so the look's roughness is the mean.
    p.roughness = Math.min(1, this.look.roughness / 0.72);
    p.metallic = this.look.metallic;
  }

  dispose(): void {
    // Textures are shared (panel cache / owner); dispose materials only.
    this.std?.dispose(false, false);
    this.pbr?.dispose(false, false);
    this.std = null;
    this.pbr = null;
    this.bound.clear();
  }
}
