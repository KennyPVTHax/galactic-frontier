/**
 * SpaceEnvironment (M3): asteroid belt + orbital debris + a high-altitude
 * starfield / nebula layer that fades in with camera altitude.
 *
 * - Deterministic from `seed`: the same seed gives the same asteroids on every
 *   tier and device.
 * - "Major" asteroids (`opts.count`, default 48) are drawn on every tier and are
 *   the only ones returned by `asteroidColliders()`, so collision gameplay never
 *   depends on the graphics tier. Higher tiers add small "minor" rocks (≤ 3 m)
 *   and debris shards that are visual only.
 * - Thin instances (one draw per shape variant and LOD), re-bucketed by camera
 *   distance a few times per second; minor rocks are culled at `cullDistance`.
 * - The starfield/nebula is additive, follows the camera (infinite distance),
 *   and is drawn over the planet sky; it never replaces it.
 * - Everything it creates is released by `dispose()` (planet transitions rebuild it).
 */
import { Color3, Matrix, Mesh, MeshBuilder, Quaternion, RawTexture, Scene, Texture, Vector3, VertexData, type Observer } from "../engine/babylon";
import { PROFILES, type GraphicsTier, type RenderProfile } from "../graphics/profiles";
import { SurfaceMaterial, mulberry32, type RGB } from "../graphics/shipFx";

export interface SpacePalette {
  /** Rock tints (picked per asteroid). */
  rock: RGB[];
  /** Debris metal tint. */
  debris: RGB;
  /** Nebula colours (2–3). */
  nebula: RGB[];
  /** Star tint range. */
  stars: [RGB, RGB];
}

export const DEFAULT_SPACE_PALETTE: SpacePalette = {
  rock: [
    [0.46, 0.4, 0.46],
    [0.55, 0.45, 0.42],
    [0.36, 0.36, 0.44],
    [0.5, 0.42, 0.52],
  ],
  debris: [0.7, 0.7, 0.76],
  nebula: [
    [0.85, 0.25, 0.65],
    [0.2, 0.65, 0.9],
    [0.5, 0.3, 0.95],
  ],
  stars: [
    [0.75, 0.85, 1],
    [1, 0.85, 0.75],
  ],
};

export interface SpaceOptions {
  seed: number;
  /** Field centre (x, z used; y is `altitude`). */
  center: Vector3 | { x: number; y: number; z: number };
  /** Outer radius of the belt annulus (m). */
  radius: number;
  /** Mean height of the belt (world y). */
  altitude: number;
  /** Major (colliding) asteroids; 0 = default 48. */
  count: number;
  palette?: Partial<SpacePalette>;
  /** Inner radius of the annulus (default radius × 0.3). */
  innerRadius?: number;
  /** Vertical spread (default 90 m). */
  thickness?: number;
  /** Spheres kept clear of asteroids (station, docking corridor). */
  keepOut?: { x: number; y: number; z: number; r: number }[];
  /** Camera heights where the starfield starts / reaches full strength (default altitude × 0.75 / × 1.6). */
  starFade?: [number, number];
  /** Initial tier (default "enhanced"). */
  tier?: GraphicsTier;
}

export interface SpaceBudget {
  count: number;
  debris: number;
  lodDistance: number;
  cullDistance: number;
  stars: number;
  nebula: boolean;
}

interface Rock {
  pos: Vector3;
  scale: Vector3;
  rot: Quaternion;
  axis: Vector3;
  spin: number;
  angle: number;
  radius: number;
  variant: number;
  color: RGB;
  major: boolean;
}

const VARIANTS = 3;
const MAX_MINOR = 1200;
const MAX_DEBRIS = 600;

function hash3(x: number, y: number, z: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647 + seed * 974634511) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function noise3(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  let r = 0;
  for (let k = 0; k < 8; k++) {
    const dx = k & 1, dy = (k >> 1) & 1, dz = (k >> 2) & 1;
    r += hash3(xi + dx, yi + dy, zi + dz, seed) * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
  }
  return r;
}

/** Lumpy, cratered rock mesh (unit radius), deterministic per seed. */
function rockMesh(name: string, scene: Scene, seed: number, subdivisions: number, flat: boolean): Mesh {
  const m = MeshBuilder.CreateIcoSphere(name, { radius: 1, subdivisions, flat: false }, scene);
  const pos = m.getVerticesData("position")!;
  const rand = mulberry32(seed);
  const craters: [Vector3, number, number][] = [];
  for (let i = 0; i < 5; i++) craters.push([new Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize(), 0.25 + rand() * 0.35, 0.08 + rand() * 0.1]);
  const stretch = new Vector3(0.75 + rand() * 0.6, 0.65 + rand() * 0.4, 0.8 + rand() * 0.5);
  const colors: number[] = [];
  const p = new Vector3();
  for (let i = 0; i < pos.length; i += 3) {
    p.set(pos[i], pos[i + 1], pos[i + 2]).normalize();
    let d = 1 + (noise3(p.x * 1.6 + 7, p.y * 1.6, p.z * 1.6, seed) - 0.5) * 0.55 + (noise3(p.x * 4, p.y * 4, p.z * 4, seed + 1) - 0.5) * 0.18;
    let shade = 1;
    for (const [c, r, depth] of craters) {
      const a = Vector3.Distance(p, c);
      if (a < r) {
        const k = a / r;
        d -= depth * (1 - k * k);
        shade -= 0.25 * (1 - k);
      } else if (a < r * 1.25) d += depth * 0.35 * (1 - (a - r) / (r * 0.25));
    }
    pos[i] = p.x * d * stretch.x;
    pos[i + 1] = p.y * d * stretch.y;
    pos[i + 2] = p.z * d * stretch.z;
    const c = Math.max(0.35, Math.min(1, (0.55 + (d - 0.8) * 0.9) * shade));
    colors.push(c, c, c * 1.02, 1);
  }
  m.setVerticesData("position", pos);
  m.setVerticesData("color", colors);
  const normals: number[] = [];
  VertexData.ComputeNormals(pos, m.getIndices()!, normals);
  m.setVerticesData("normal", normals);
  if (flat) m.convertToFlatShadedMesh();
  m.isPickable = false;
  return m;
}

export class SpaceEnvironment {
  readonly seed: number;
  private readonly scene: Scene;
  private readonly opts: SpaceOptions;
  private readonly palette: SpacePalette;
  private readonly rocks: Rock[] = [];
  private readonly debrisRocks: Rock[] = [];
  private readonly majorCount: number;
  private budget: SpaceBudget;
  private tier: GraphicsTier;
  private enabled = true;

  private readonly rockMat: SurfaceMaterial;
  private readonly debrisMat: SurfaceMaterial;
  private readonly starMat: SurfaceMaterial;
  private readonly nebulaMat: SurfaceMaterial;
  /** [variant][lod] */
  private readonly rockMeshes: Mesh[][] = [];
  private readonly rockBuffers: { m: Float32Array; c: Float32Array }[][] = [];
  private readonly debrisMesh: Mesh;
  private readonly debrisBuf: { m: Float32Array; c: Float32Array };
  private stars: Mesh | null = null;
  private nebula: Mesh | null = null;
  private readonly starTex: RawTexture;
  private nebulaTex: RawTexture | null = null;
  private readonly tmpM = new Matrix();
  private readonly tmpQ = new Quaternion();
  private readonly tmpS = new Vector3();
  private lastCam = new Vector3(Infinity, Infinity, Infinity);
  private bucketT = 0;
  private fade = 0;
  private t = 0;
  private readonly nearIdx: number[][] = [];
  private readonly farIdx: number[][] = [];
  private readonly disposers: Observer<Scene>[] = [];

  constructor(scene: Scene, opts: SpaceOptions) {
    this.scene = scene;
    this.opts = opts;
    this.seed = opts.seed;
    this.palette = { ...DEFAULT_SPACE_PALETTE, ...(opts.palette ?? {}) };
    this.tier = opts.tier ?? "enhanced";
    this.budget = budgetOf(PROFILES[this.tier]);
    this.majorCount = Math.max(1, opts.count > 0 ? opts.count : 48);
    this.generate();

    const pbr = PROFILES[this.tier].pbr;
    this.rockMat = new SurfaceMaterial("space-rock", scene, { color: [1, 1, 1], roughness: 0.92, metallic: 0.05, env: 0.6 }, null);
    this.debrisMat = new SurfaceMaterial("space-debris", scene, { color: [...this.palette.debris], roughness: 0.4, metallic: 0.8, env: 1.2 }, null);
    this.rockMat.setMode(pbr);
    this.debrisMat.setMode(pbr);
    this.starTex = this.makeStarTexture();
    this.starMat = new SurfaceMaterial("space-stars", scene, { color: [1, 1, 1], roughness: 1, metallic: 0, unlit: true, additive: true, opacity: this.starTex, alpha: 0, backFaceCulling: false }, null);
    this.nebulaMat = new SurfaceMaterial("space-nebula", scene, { color: [1, 1, 1], roughness: 1, metallic: 0, unlit: true, additive: true, alpha: 0, backFaceCulling: false }, null);

    for (let v = 0; v < VARIANTS; v++) {
      const hi = rockMesh(`space-rock-${v}-hi`, scene, this.seed * 31 + v, 3, false);
      const lo = rockMesh(`space-rock-${v}-lo`, scene, this.seed * 31 + v, 1, true);
      const list = [hi, lo];
      const bufs: { m: Float32Array; c: Float32Array }[] = [];
      const cap = this.majorCount + MAX_MINOR;
      for (const m of list) {
        this.rockMat.bind(m);
        const b = { m: new Float32Array(cap * 16), c: new Float32Array(cap * 4) };
        m.thinInstanceSetBuffer("matrix", b.m, 16, false);
        m.thinInstanceSetBuffer("color", b.c, 4, false);
        m.thinInstanceCount = 0;
        m.alwaysSelectAsActiveMesh = true;
        m.doNotSyncBoundingInfo = true;
        bufs.push(b);
      }
      this.rockMeshes.push(list);
      this.rockBuffers.push(bufs);
      this.nearIdx.push([]);
      this.farIdx.push([]);
    }
    // Debris shards: thin elongated plates.
    this.debrisMesh = MeshBuilder.CreateBox("space-debris", { width: 1, height: 0.12, depth: 0.45 }, scene);
    this.debrisMesh.isPickable = false;
    this.debrisMat.bind(this.debrisMesh);
    this.debrisBuf = { m: new Float32Array(MAX_DEBRIS * 16), c: new Float32Array(MAX_DEBRIS * 4) };
    this.debrisMesh.thinInstanceSetBuffer("matrix", this.debrisBuf.m, 16, false);
    this.debrisMesh.thinInstanceSetBuffer("color", this.debrisBuf.c, 4, false);
    this.debrisMesh.thinInstanceCount = 0;
    this.debrisMesh.alwaysSelectAsActiveMesh = true;
    this.debrisMesh.doNotSyncBoundingInfo = true;

    this.rebuildSky();
    this.writeDebris();
  }

  // ---------------------------------------------------------------- generation

  private generate(): void {
    const o = this.opts;
    const rand = mulberry32(o.seed ^ 0x9e3779b9);
    const cx = o.center.x, cz = o.center.z;
    const inner = o.innerRadius ?? o.radius * 0.3;
    const thick = o.thickness ?? 90;
    const keep = o.keepOut ?? [];
    const pal = { ...DEFAULT_SPACE_PALETTE, ...(o.palette ?? {}) };
    const place = (major: boolean, list: Rock[], n: number, rMin: number, rMax: number, inR: number, outR: number, th: number) => {
      let guard = 0;
      while (list.length < n && guard++ < n * 30) {
        const a = rand() * Math.PI * 2;
        const rr = Math.sqrt(inR * inR + rand() * (outR * outR - inR * inR));
        const g = (rand() + rand() + rand() - 1.5) / 1.5;
        const pos = new Vector3(cx + Math.cos(a) * rr, o.altitude + g * th * 0.5, cz + Math.sin(a) * rr);
        const size = rMin + Math.pow(rand(), major ? 1.8 : 1.3) * (rMax - rMin);
        if (keep.some((k) => Vector3.Distance(pos, new Vector3(k.x, k.y, k.z)) < k.r + size * 1.4)) continue;
        if (major && list.some((r) => Vector3.Distance(r.pos, pos) < r.radius + size + 6)) continue;
        const sx = 0.8 + rand() * 0.45, sy = 0.7 + rand() * 0.4, sz = 0.8 + rand() * 0.45;
        const rot = Quaternion.RotationYawPitchRoll(rand() * 6.28, rand() * 6.28, rand() * 6.28);
        const axis = new Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
        const tint = pal.rock[Math.floor(rand() * pal.rock.length)];
        const k = 0.85 + rand() * 0.3;
        list.push({
          pos,
          scale: new Vector3(size * sx, size * sy, size * sz),
          rot,
          axis,
          spin: (rand() - 0.5) * (major ? 0.12 : 0.5),
          angle: 0,
          // Shapes are stretched up to ~1.35 along an axis; the collider covers the bulk.
          radius: size * Math.max(sx, sy, sz) * 0.95,
          variant: Math.floor(rand() * VARIANTS),
          color: [tint[0] * k, tint[1] * k, tint[2] * k],
          major,
        });
      }
    };
    place(true, this.rocks, this.majorCount, 4, 22, inner, o.radius, thick);
    place(false, this.rocks, this.majorCount + MAX_MINOR, 0.6, 3, inner * 0.8, o.radius * 1.1, thick * 1.3);
    // Debris: thin band nearer the centre (old station orbit), small metal shards.
    const drand = mulberry32(o.seed ^ 0x51ed);
    for (let i = 0; i < MAX_DEBRIS; i++) {
      const a = drand() * Math.PI * 2;
      const rr = inner * 0.6 + drand() * (o.radius * 0.7 - inner * 0.6);
      const pos = new Vector3(cx + Math.cos(a) * rr, o.altitude + (drand() - 0.5) * thick * 0.35, cz + Math.sin(a) * rr);
      if (keep.some((k) => Vector3.Distance(pos, new Vector3(k.x, k.y, k.z)) < k.r)) continue;
      const s = 0.25 + drand() * 1.4;
      this.debrisRocks.push({
        pos,
        scale: new Vector3(s, s, s),
        rot: Quaternion.RotationYawPitchRoll(drand() * 6.28, drand() * 6.28, drand() * 6.28),
        axis: new Vector3(drand() - 0.5, drand() - 0.5, drand() - 0.5).normalize(),
        spin: (drand() - 0.5) * 1.5,
        angle: 0,
        radius: s,
        variant: 0,
        color: [1, 1, 1],
        major: false,
      });
    }
  }

  private makeStarTexture(): RawTexture {
    const n = 32;
    const px = new Uint8Array(n * n * 4);
    const h = (n - 1) / 2;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const dx = (x - h) / h, dy = (y - h) / h;
        const r = Math.hypot(dx, dy);
        // Core + faint cross flare.
        const a = Math.max(Math.exp(-r * r * 18), Math.exp(-dx * dx * 300) * Math.exp(-dy * dy * 6) * 0.35, Math.exp(-dy * dy * 300) * Math.exp(-dx * dx * 6) * 0.35);
        const o = (y * n + x) * 4;
        px[o] = px[o + 1] = px[o + 2] = 255;
        px[o + 3] = Math.round(Math.min(1, a) * 255);
      }
    }
    const t = RawTexture.CreateRGBATexture(px, n, n, this.scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
    t.name = "space-star-tex";
    t.hasAlpha = true;
    t.wrapU = t.wrapV = Texture.CLAMP_ADDRESSMODE;
    return t;
  }

  private makeNebulaTexture(): RawTexture {
    const n = 128;
    const px = new Uint8Array(n * n * 4);
    const pal = this.palette.nebula;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const u = x / n, v = y / n;
        const f = noise3(u * 4, v * 4, 0.5, this.seed) * 0.55 + noise3(u * 9, v * 9, 1.5, this.seed) * 0.3 + noise3(u * 21, v * 21, 2.5, this.seed) * 0.15;
        const r = Math.hypot(u - 0.5, v - 0.5) * 2;
        const a = Math.max(0, f - 0.42) * 2.2 * Math.max(0, 1 - r * r);
        const mix = noise3(u * 2.5, v * 2.5, 7.5, this.seed);
        const c0 = pal[0], c1 = pal[1 % pal.length];
        const o = (y * n + x) * 4;
        px[o] = Math.round((c0[0] * (1 - mix) + c1[0] * mix) * 255);
        px[o + 1] = Math.round((c0[1] * (1 - mix) + c1[1] * mix) * 255);
        px[o + 2] = Math.round((c0[2] * (1 - mix) + c1[2] * mix) * 255);
        px[o + 3] = Math.round(Math.min(1, a) * 255);
      }
    }
    const t = RawTexture.CreateRGBATexture(px, n, n, this.scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
    t.name = "space-nebula-tex";
    t.hasAlpha = true;
    t.wrapU = t.wrapV = Texture.CLAMP_ADDRESSMODE;
    return t;
  }

  /** Builds the star / nebula meshes for the current budget. */
  private rebuildSky(): void {
    this.stars?.dispose(false, false);
    this.stars = null;
    this.nebula?.dispose(false, false);
    this.nebula = null;
    const S = this.scene;
    const R = 3600;
    const n = this.budget.stars;
    if (n > 0) {
      const rand = mulberry32(this.seed ^ 0x57a5);
      const pos: number[] = [], col: number[] = [], uv: number[] = [], idx: number[] = [];
      const [c0, c1] = this.palette.stars;
      const d = new Vector3(), t1 = new Vector3(), t2 = new Vector3(), up = new Vector3(0, 1, 0), alt = new Vector3(1, 0, 0);
      for (let i = 0; i < n; i++) {
        // Denser band (galactic plane) tilted across the sky.
        let y = rand() * 2 - 1;
        if (rand() < 0.45) y = (rand() - 0.5) * 0.25;
        const th = rand() * Math.PI * 2;
        const r = Math.sqrt(1 - y * y);
        d.set(Math.cos(th) * r, y, Math.sin(th) * r);
        // Tilt the band.
        const ty = d.y * 0.88 + d.z * 0.47, tz = d.z * 0.88 - d.y * 0.47;
        d.set(d.x, ty, tz);
        Vector3.CrossToRef(d, Math.abs(d.y) > 0.9 ? alt : up, t1);
        t1.normalize();
        Vector3.CrossToRef(d, t1, t2);
        const size = (rand() < 0.04 ? 30 : 8 + rand() * 9) * 0.5;
        const k = rand();
        const b = 0.35 + Math.pow(rand(), 3) * 0.65;
        const base = pos.length / 3;
        for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          pos.push(d.x * R + (t1.x * su + t2.x * sv) * size, d.y * R + (t1.y * su + t2.y * sv) * size, d.z * R + (t1.z * su + t2.z * sv) * size);
          col.push((c0[0] * (1 - k) + c1[0] * k) * b, (c0[1] * (1 - k) + c1[1] * k) * b, (c0[2] * (1 - k) + c1[2] * k) * b, 1);
          uv.push((su + 1) / 2, (sv + 1) / 2);
        }
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
      const m = new Mesh("space-stars", S);
      const vd = new VertexData();
      vd.positions = pos;
      vd.colors = col;
      vd.uvs = uv;
      vd.indices = idx;
      vd.applyToMesh(m);
      m.infiniteDistance = true;
      m.isPickable = false;
      m.alwaysSelectAsActiveMesh = true;
      m.applyFog = false;
      this.starMat.bind(m);
      this.stars = m;
    }
    if (this.budget.nebula) {
      this.nebulaTex ??= this.makeNebulaTexture();
      const nm = this.nebulaMat.std ?? (this.nebulaMat.current() as unknown as { opacityTexture: Texture | null; diffuseTexture: Texture | null });
      void nm;
      const parts: Mesh[] = [];
      const rand = mulberry32(this.seed ^ 0x2eb1);
      for (let i = 0; i < 4; i++) {
        const p = MeshBuilder.CreatePlane("space-nebula-part", { size: 1 }, S);
        const th = rand() * Math.PI * 2;
        const y = 0.15 + rand() * 0.6;
        const r = Math.sqrt(1 - y * y);
        const dir = new Vector3(Math.cos(th) * r, y, Math.sin(th) * r);
        p.position.copyFrom(dir.scale(R * 0.95));
        p.lookAt(Vector3.Zero());
        p.rotate(new Vector3(0, 0, 1), rand() * 6.28);
        p.scaling.set(1500 + rand() * 1400, 900 + rand() * 900, 1);
        parts.push(p);
      }
      const merged = Mesh.MergeMeshes(parts, true, true);
      if (merged) {
        merged.name = "space-nebula";
        merged.infiniteDistance = true;
        merged.isPickable = false;
        merged.alwaysSelectAsActiveMesh = true;
        merged.applyFog = false;
        this.nebulaMat.bind(merged);
        const std = this.nebulaMat.std!;
        std.diffuseTexture = this.nebulaTex;
        std.opacityTexture = this.nebulaTex;
        std.emissiveColor = new Color3(1, 1, 1);
        this.nebula = merged;
      }
    }
    this.applyFade();
  }

  private writeDebris(): void {
    const n = Math.min(this.budget.debris, this.debrisRocks.length);
    const b = this.debrisBuf;
    const tint = this.palette.debris;
    for (let i = 0; i < n; i++) {
      const r = this.debrisRocks[i];
      this.compose(r, b.m, i);
      const k = 0.6 + ((i * 37) % 10) / 25;
      b.c.set([tint[0] * k, tint[1] * k, tint[2] * k, 1], i * 4);
    }
    this.debrisMesh.thinInstanceCount = n;
    this.debrisMesh.thinInstanceBufferUpdated("matrix");
    this.debrisMesh.thinInstanceBufferUpdated("color");
    this.debrisMesh.setEnabled(this.enabled && n > 0);
  }

  private compose(r: Rock, out: Float32Array, i: number): void {
    Quaternion.RotationAxisToRef(r.axis, r.angle, this.tmpQ);
    this.tmpQ.multiplyInPlace(r.rot);
    Matrix.ComposeToRef(r.scale, this.tmpQ, r.pos, this.tmpM);
    this.tmpM.copyToArray(out, i * 16);
  }

  // ---------------------------------------------------------------- budget / detail

  setBudget(b: Partial<SpaceBudget>): void {
    const prev = this.budget;
    this.budget = { ...prev, ...b, count: Math.max(0, b.count ?? prev.count), debris: Math.min(MAX_DEBRIS, Math.max(0, b.debris ?? prev.debris)) };
    if (this.budget.stars !== prev.stars || this.budget.nebula !== prev.nebula) this.rebuildSky();
    if (this.budget.debris !== prev.debris) this.writeDebris();
    this.lastCam.set(Infinity, Infinity, Infinity);
  }

  /** Applies the tier's asteroid / star budget and shading model. */
  setDetail(tier: GraphicsTier, profile: RenderProfile = PROFILES[tier]): void {
    this.tier = tier;
    this.rockMat.setMode(profile.pbr);
    this.debrisMat.setMode(profile.pbr);
    this.setBudget(budgetOf(profile));
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    for (const list of this.rockMeshes) for (const m of list) m.setEnabled(on && m.thinInstanceCount > 0);
    this.debrisMesh.setEnabled(on && this.debrisMesh.thinInstanceCount > 0);
    this.applyFade();
  }

  /** Major asteroids as spheres (world space). Identical on every tier for a given seed. */
  asteroidColliders(): { x: number; y: number; z: number; r: number }[] {
    return this.rocks.filter((r) => r.major).map((r) => ({ x: r.pos.x, y: r.pos.y, z: r.pos.z, r: r.radius }));
  }

  /** Drawn counts (for profiling / tests). */
  stats(): { major: number; minor: number; debris: number; stars: number; nebula: boolean; drawn: number; starAlpha: number } {
    let drawn = 0;
    for (const list of this.rockMeshes) for (const m of list) drawn += m.isEnabled() ? m.thinInstanceCount : 0;
    return { major: this.majorCount, minor: Math.max(0, Math.min(MAX_MINOR, this.budget.count - this.majorCount)), debris: this.debrisMesh.thinInstanceCount, stars: this.budget.stars, nebula: this.budget.nebula, drawn, starAlpha: this.fade };
  }

  // ---------------------------------------------------------------- per frame

  update(dt: number, cameraPos: Vector3): void {
    this.t += dt;
    if (!this.enabled) return;
    // Starfield fade with camera altitude.
    const [f0, f1] = this.opts.starFade ?? [this.opts.altitude * 0.75, this.opts.altitude * 1.6];
    const k = Math.max(0, Math.min(1, (cameraPos.y - f0) / Math.max(1, f1 - f0)));
    const fade = k * k * (3 - 2 * k);
    if (Math.abs(fade - this.fade) > 0.002) {
      this.fade = fade;
      this.applyFade();
    }

    for (const r of this.rocks) r.angle += r.spin * dt;
    this.bucketT -= dt;
    const moved = Vector3.DistanceSquared(cameraPos, this.lastCam) > 15 * 15;
    if (moved || this.bucketT <= 0) {
      this.bucketT = 0.4;
      this.lastCam.copyFrom(cameraPos);
      this.bucket(cameraPos);
    }
    // Rewrite matrices (rotation) for near rocks every frame, far ones at bucket time only.
    for (let v = 0; v < VARIANTS; v++) {
      const near = this.nearIdx[v];
      if (near.length === 0) continue;
      const b = this.rockBuffers[v][0];
      for (let i = 0; i < near.length; i++) this.compose(this.rocks[near[i]], b.m, i);
      this.rockMeshes[v][0].thinInstanceBufferUpdated("matrix");
    }
    if (this.budget.debris > 0 && this.tier !== "basic") {
      const n = this.debrisMesh.thinInstanceCount;
      for (let i = 0; i < n; i++) {
        const r = this.debrisRocks[i];
        r.angle += r.spin * dt;
        this.compose(r, this.debrisBuf.m, i);
      }
      this.debrisMesh.thinInstanceBufferUpdated("matrix");
    }
  }

  private bucket(cam: Vector3): void {
    const total = Math.min(this.rocks.length, Math.max(this.majorCount, this.budget.count));
    const lod2 = this.budget.lodDistance * this.budget.lodDistance;
    const cull2 = this.budget.cullDistance * this.budget.cullDistance;
    for (let v = 0; v < VARIANTS; v++) {
      this.nearIdx[v].length = 0;
      this.farIdx[v].length = 0;
    }
    for (let i = 0; i < total; i++) {
      const r = this.rocks[i];
      const d2 = Vector3.DistanceSquared(r.pos, cam);
      // Major rocks are never culled (they are collidable); minor ones beyond cull distance are skipped.
      if (!r.major && d2 > cull2) continue;
      // Size-aware LOD: big rocks stay detailed further out.
      const near = d2 < lod2 * Math.max(1, r.radius / 6);
      (near ? this.nearIdx : this.farIdx)[r.variant].push(i);
    }
    for (let v = 0; v < VARIANTS; v++) {
      for (const [lod, list] of [[0, this.nearIdx[v]], [1, this.farIdx[v]]] as const) {
        const m = this.rockMeshes[v][lod];
        const b = this.rockBuffers[v][lod];
        for (let i = 0; i < list.length; i++) {
          const r = this.rocks[list[i]];
          this.compose(r, b.m, i);
          b.c.set([r.color[0], r.color[1], r.color[2], 1], i * 4);
        }
        m.thinInstanceCount = list.length;
        m.thinInstanceBufferUpdated("matrix");
        m.thinInstanceBufferUpdated("color");
        m.setEnabled(this.enabled && list.length > 0);
      }
    }
  }

  private applyFade(): void {
    const on = this.enabled && this.fade > 0.01;
    if (this.stars) {
      this.stars.setEnabled(on);
      if (this.starMat.std) this.starMat.std.alpha = this.fade;
    }
    if (this.nebula) {
      this.nebula.setEnabled(on);
      if (this.nebulaMat.std) this.nebulaMat.std.alpha = this.fade * 0.55;
    }
  }

  dispose(): void {
    for (const o of this.disposers) this.scene.onBeforeRenderObservable.remove(o);
    for (const list of this.rockMeshes) for (const m of list) m.dispose(false, false);
    this.debrisMesh.dispose(false, false);
    this.stars?.dispose(false, false);
    this.nebula?.dispose(false, false);
    this.rockMat.dispose();
    this.debrisMat.dispose();
    this.starMat.dispose();
    this.nebulaMat.dispose();
    this.starTex.dispose();
    this.nebulaTex?.dispose();
    this.rockMeshes.length = 0;
  }
}

export function budgetOf(p: RenderProfile): SpaceBudget {
  return { count: p.asteroids.count, debris: p.asteroids.debris, lodDistance: p.asteroids.lodDistance, cullDistance: p.asteroids.cullDistance, stars: p.space.stars, nebula: p.space.nebula };
}
