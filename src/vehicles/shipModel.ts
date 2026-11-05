import {
  Color4,
  Constants,
  Effect,
  Matrix,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  RawTexture,
  Scene,
  ShaderMaterial,
  Texture,
  TransformNode,
  Vector3,
  Vector4,
  VertexData,
} from "../engine/babylon";
import type { MaterialLibrary } from "../graphics/materials";
import { PROFILES, type GraphicsTier } from "../graphics/profiles";
import { SurfaceMaterial, acquirePanels, makeGlowTexture, makeScorchTexture, releasePanels, type PanelSet, type RGB } from "../graphics/shipFx";

// ------------------------------------------------------------------ paint schemes

export interface PaintScheme {
  id: string;
  name: string;
  /** Main hull panels. */
  hull: RGB;
  /** Gunmetal trim: engine pods, tail, gear. */
  trim: RGB;
  /** Stripe, wing leading edges, pod rings. */
  accent: RGB;
  /** Faint self-illumination of the accent paint. */
  accentGlow: RGB;
  /** Engine core / nozzle glow and exhaust tint. */
  engine: RGB;
  /** Canopy inner glow. */
  canopy: RGB;
  /** PBR metal / roughness of the main hull. */
  metallic: number;
  roughness: number;
}

/** Original cosmetic schemes. `wayfarer` is the M2 look and the default. */
export const PAINT_SCHEMES: Record<string, PaintScheme> = {
  wayfarer: { id: "wayfarer", name: "Wayfarer Standard", hull: [0.86, 0.87, 0.92], trim: [0.5, 0.51, 0.58], accent: [0.45, 0.25, 0.9], accentGlow: [0.08, 0.03, 0.2], engine: [0.3, 0.9, 1], canopy: [0.04, 0.25, 0.36], metallic: 0.55, roughness: 0.35 },
  ember: { id: "ember", name: "Ember Run", hull: [0.9, 0.5, 0.26], trim: [0.24, 0.22, 0.24], accent: [1, 0.8, 0.32], accentGlow: [0.2, 0.1, 0.0], engine: [1, 0.62, 0.25], canopy: [0.32, 0.16, 0.04], metallic: 0.45, roughness: 0.38 },
  tidepool: { id: "tidepool", name: "Tidepool", hull: [0.32, 0.72, 0.7], trim: [0.17, 0.25, 0.31], accent: [1, 0.46, 0.5], accentGlow: [0.18, 0.04, 0.05], engine: [0.45, 1, 0.76], canopy: [0.05, 0.3, 0.24], metallic: 0.5, roughness: 0.32 },
  nightjar: { id: "nightjar", name: "Nightjar", hull: [0.2, 0.21, 0.3], trim: [0.1, 0.1, 0.13], accent: [0.95, 0.28, 0.76], accentGlow: [0.22, 0.03, 0.16], engine: [0.95, 0.38, 1], canopy: [0.25, 0.05, 0.3], metallic: 0.7, roughness: 0.45 },
  solstice: { id: "solstice", name: "Solstice", hull: [0.95, 0.92, 0.84], trim: [0.55, 0.44, 0.26], accent: [0.22, 0.74, 0.36], accentGlow: [0.03, 0.14, 0.05], engine: [0.62, 1, 0.42], canopy: [0.12, 0.3, 0.1], metallic: 0.6, roughness: 0.3 },
};

export const DEFAULT_PAINT = "wayfarer";

// ------------------------------------------------------------------ shield shader

const SHIELD_VS = `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
uniform mat4 world;
uniform mat4 worldViewProjection;
varying vec3 vPosL;
varying vec3 vPosW;
varying vec3 vNrmW;
void main() {
  vPosL = position;
  vec4 w = world * vec4(position, 1.0);
  vPosW = w.xyz;
  vNrmW = normalize(mat3(world) * normal);
  gl_Position = worldViewProjection * vec4(position, 1.0);
}`;

const SHIELD_FS = `
precision highp float;
varying vec3 vPosL;
varying vec3 vPosW;
varying vec3 vNrmW;
uniform vec3 cameraPosition;
uniform vec3 uColor;
uniform vec4 uHits[4];
uniform vec4 uStr;
uniform float uFlash;
uniform float uTime;
void main() {
  vec3 p = normalize(vPosL);
  float fres = 1.0 - abs(dot(normalize(vNrmW), normalize(cameraPosition - vPosW)));
  fres = fres * fres * fres;
  float a = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 h = uHits[i];
    if (h.w >= 0.0) {
      float d = distance(p, h.xyz);
      float r = h.w * 2.6;
      float life = clamp(1.0 - h.w / 0.85, 0.0, 1.0);
      float wave = exp(-pow((d - r) * 7.0, 2.0)) * life;
      float spot = exp(-d * d * 14.0) * clamp(1.0 - h.w * 3.0, 0.0, 1.0);
      a += (wave * 0.9 + spot * 1.6) * uStr[i];
    }
  }
  // Cheap hex-ish cell lines (only visible inside the ripple).
  vec2 q = vec2(atan(p.z, p.x) * 6.0, p.y * 9.0);
  vec2 g = abs(fract(q + vec2(0.0, floor(q.x) * 0.5)) - 0.5);
  float cell = smoothstep(0.36, 0.5, max(g.x, g.y));
  float shimmer = 0.75 + 0.25 * sin(uTime * 30.0 + p.y * 40.0);
  float k = a * (0.55 + 0.75 * cell) * shimmer + fres * uFlash * 0.9;
  gl_FragColor = vec4(uColor * k, 1.0);
}`;

let shaderRegistered = false;
function registerShaders(): void {
  if (shaderRegistered) return;
  Effect.ShadersStore["gfShieldVertexShader"] = SHIELD_VS;
  Effect.ShadersStore["gfShieldFragmentShader"] = SHIELD_FS;
  shaderRegistered = true;
}

// ------------------------------------------------------------------ geometry helpers

/** Six-face slab from 8 corners (b0..b3 bottom, t0..t3 top; 0 root-lead, 1 root-trail, 2 tip-trail, 3 tip-lead). Flat normals, metric UVs. */
function slab(name: string, scene: Scene, c: Vector3[], uvScale = 1 / TILE): Mesh {
  const [b0, b1, b2, b3, t0, t1, t2, t3] = c;
  const faces = [
    [t0, t1, t2, t3],
    [b0, b3, b2, b1],
    [b0, b1, t1, t0],
    [b3, t3, t2, b2],
    [b0, t0, t3, b3],
    [b1, b2, t2, t1],
  ];
  const center = c.reduce((a, v) => a.addInPlace(v), new Vector3()).scaleInPlace(1 / 8);
  const pos: number[] = [], idx: number[] = [], uvs: number[] = [];
  for (const f of faces) {
    const n = Vector3.Cross(f[1].subtract(f[0]), f[2].subtract(f[0]));
    const fc = f[0].add(f[1]).add(f[2]).add(f[3]).scale(0.25);
    // Babylon is left-handed with clockwise front faces: flip so the face looks outward.
    const outward = Vector3.Dot(n, fc.subtract(center)) > 0;
    const q = outward ? [f[0], f[3], f[2], f[1]] : f;
    const base = pos.length / 3;
    const u = Vector3.Distance(q[0], q[1]) * uvScale;
    const v = Vector3.Distance(q[0], q[3]) * uvScale;
    for (const p of q) pos.push(p.x, p.y, p.z);
    uvs.push(0, 0, u, 0, u, v, 0, v);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const vd = new VertexData();
  vd.positions = pos;
  vd.indices = idx;
  vd.uvs = uvs;
  const normals: number[] = [];
  VertexData.ComputeNormals(pos, idx, normals);
  vd.normals = normals;
  const m = new Mesh(name, scene);
  vd.applyToMesh(m);
  return m;
}

/** Tapered slab along X from a root to a tip section (each: x, y, zLead, zTrail, thickness). */
function taper(name: string, scene: Scene, root: [number, number, number, number, number], tip: [number, number, number, number, number]): Mesh {
  const [rx, ry, rl, rt, rh] = root;
  const [tx, ty, tl, tt, th] = tip;
  return slab(name, scene, [
    new Vector3(rx, ry - rh / 2, rl),
    new Vector3(rx, ry - rh / 2, rt),
    new Vector3(tx, ty - th / 2, tt),
    new Vector3(tx, ty - th / 2, tl),
    new Vector3(rx, ry + rh / 2, rl),
    new Vector3(rx, ry + rh / 2, rt),
    new Vector3(tx, ty + th / 2, tt),
    new Vector3(tx, ty + th / 2, tl),
  ]);
}

function scaleUV(m: Mesh, su: number, sv: number): Mesh {
  const uv = m.getVerticesData("uv");
  if (uv) {
    for (let i = 0; i < uv.length; i += 2) {
      uv[i] *= su;
      uv[i + 1] *= sv;
    }
    m.setVerticesData("uv", uv);
  }
  return m;
}

/** Superellipse cross-section loop (closed by the ribbon). */
function section(z: number, w: number, top: number, bot: number, cy: number, n = 2.7, seg = 20): Vector3[] {
  const out: Vector3[] = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    const x = Math.sign(c) * Math.pow(Math.abs(c), 2 / n) * w;
    const yk = Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
    out.push(new Vector3(x, cy + yk * (yk > 0 ? top : bot), z));
  }
  return out;
}

/** Metres per panel-texture tile. */
const TILE = 4.5;

type Group = "core" | "detail" | "ultra" | "gear";
type MatKey = "hull" | "trim" | "accent" | "glass" | "dark" | "glow" | "engine" | "metal";

// ------------------------------------------------------------------ ship

/**
 * Original starter ship "Wayfarer": ~11 m long, nose along +Z.
 *
 * Geometry is built from primitives and lofted sections, then merged per
 * detail group and material (≈10–16 draw calls), so the greebles cost little.
 * Basic shows only the core group with Standard materials; Enhanced adds the
 * detail group; Extreme HD adds micro-greebles and 1024² panel maps.
 */
export class ShipModel {
  readonly root: TransformNode;
  /** Solid meshes (shadow casters). Effects meshes are kept separately. */
  readonly meshes: Mesh[] = [];
  readonly nozzles: TransformNode[] = [];
  /** Weapon muzzle points (left outer, left inner, right inner, right outer). +Z is the firing direction. */
  readonly guns: TransformNode[] = [];
  /** RCS thruster ports (nose and tail quads); ShipFx puffs from these. */
  readonly rcsPorts: TransformNode[] = [];
  paint = DEFAULT_PAINT;
  detail: GraphicsTier = "enhanced";

  private readonly scene: Scene;
  private readonly lib: MaterialLibrary | null;
  private readonly gear: TransformNode;
  private readonly groups = new Map<Group, Mesh[]>();
  private readonly mats = new Map<MatKey, SurfaceMaterial>();
  private readonly fxMats: SurfaceMaterial[] = [];
  private panels: PanelSet | null = null;
  private pbr = false;
  private explicitDetail = false;
  private t = 0;

  // Effects
  private readonly glowTex: RawTexture;
  private readonly flameTex: RawTexture;
  private readonly scorchTex: RawTexture;
  private readonly flames: { outer: Mesh; core: Mesh }[] = [];
  private readonly halos: { mesh: Mesh; base: number; kind: "engine" | "nav" | "strobe" | "beacon" }[] = [];
  private readonly flashes: { mesh: Mesh; t: number }[] = [];
  private readonly engineMat: SurfaceMaterial;
  private readonly flameOuterMat: SurfaceMaterial;
  private readonly flameCoreMat: SurfaceMaterial;
  private readonly haloEngineMat: SurfaceMaterial;
  private readonly flashMat: SurfaceMaterial;

  // Damage / shield
  private hullRatio = 1;
  private shieldRatio = 1;
  private sparks: ParticleSystem | null = null;
  private smoke: ParticleSystem | null = null;
  private readonly sparkEmitter = new Vector3();
  private readonly smokeEmitter = new Vector3();
  private readonly damagePoints: Vector3[] = [new Vector3(1.75, 0.3, -3.6), new Vector3(-1.75, 0.3, -3.2), new Vector3(2.6, 0.0, -1.4), new Vector3(-3.0, 0.0, -1.7), new Vector3(0, 0.9, -1.0), new Vector3(0.6, 0.6, 2.4)];
  private damageCursor = 0;
  private readonly shield: Mesh;
  private readonly shieldMat: ShaderMaterial;
  private readonly hits = new Float32Array(16).fill(-1);
  private readonly hitStr = [0, 0, 0, 0];
  private hitCursor = 0;
  private shieldFlash = 0;
  private readonly shieldScale = new Vector3(6.4, 2.9, 7.6);
  private readonly tmpM = new Matrix();
  private readonly strVec = new Vector4();
  private burst = 0;
  private burstReset = false;

  constructor(scene: Scene, lib?: MaterialLibrary | null) {
    this.scene = scene;
    this.lib = lib ?? null;
    registerShaders();
    const P = PAINT_SCHEMES[DEFAULT_PAINT];

    this.glowTex = makeGlowTexture(scene, "ship-glow-tex", 64);
    this.flameTex = this.makeFlameTexture();
    this.scorchTex = makeScorchTexture(scene, "ship-scorch", 128);

    // Initial tier follows the shared material library until setDetail() is called.
    const auto = this.autoTier();
    this.detail = auto;
    this.pbr = PROFILES[auto].pbr;
    this.panels = acquirePanels(scene, panelSize(auto), "ship");

    const mk = (key: MatKey, look: ConstructorParameters<typeof SurfaceMaterial>[2]) => {
      const m = new SurfaceMaterial(`ship-${key}`, scene, look, look.panels ? this.panels : null);
      m.setMode(this.pbr);
      this.mats.set(key, m);
      return m;
    };
    // Sky fill (env) is raised: the chase camera mostly sees the ship from its unlit back.
    mk("hull", { color: [...P.hull], roughness: P.roughness, metallic: P.metallic, panels: true, env: 1.6, clearCoat: 0.12, scorch: this.scorchTex });
    mk("trim", { color: [...P.trim], roughness: 0.48, metallic: 0.4, panels: true, env: 1.6, emissive: [0.035, 0.035, 0.05], scorch: this.scorchTex });
    mk("accent", { color: [...P.accent], roughness: 0.3, metallic: 0.4, emissive: [...P.accentGlow], env: 1.6 });
    mk("glass", { color: [0.02, 0.05, 0.08], roughness: 0.04, metallic: 1, emissive: [...P.canopy], env: 2 });
    mk("dark", { color: [0.1, 0.1, 0.12], roughness: 0.6, metallic: 0.5, env: 1.2 });
    mk("metal", { color: [0.72, 0.72, 0.76], roughness: 0.25, metallic: 0.95, env: 1.6 });
    mk("glow", { color: [0.85, 0.4, 1], roughness: 1, metallic: 0, unlit: true });
    this.engineMat = mk("engine", { color: [...P.engine], roughness: 1, metallic: 0, unlit: true });
    const fx = (name: string, color: RGB, opacity?: Texture, alpha = 1, soft = false) => {
      const m = new SurfaceMaterial(name, scene, { color, roughness: 1, metallic: 0, unlit: true, additive: true, opacity, alpha, backFaceCulling: false, softEdges: soft }, null);
      this.fxMats.push(m);
      return m;
    };
    this.flameOuterMat = fx("ship-flame", [...P.engine], this.flameTex, 0.38, true);
    this.flameCoreMat = fx("ship-flame-core", [0.85, 0.95, 1], this.flameTex, 0.75, true);
    this.haloEngineMat = fx("ship-halo-engine", [...P.engine], this.glowTex, 0.9);
    this.flashMat = fx("ship-muzzle", [1, 0.85, 0.55], this.glowTex, 1);

    this.root = new TransformNode("wayfarer", scene);
    this.gear = new TransformNode("ship-gear", scene);
    this.gear.parent = this.root;

    this.build();

    // Shield bubble (hidden until hit).
    this.shieldMat = new ShaderMaterial("ship-shield", scene, { vertex: "gfShield", fragment: "gfShield" }, {
      attributes: ["position", "normal"],
      uniforms: ["world", "worldViewProjection", "cameraPosition", "uColor", "uHits", "uStr", "uFlash", "uTime"],
      needAlphaBlending: true,
    });
    this.shieldMat.alphaMode = Constants.ALPHA_ADD;
    this.shieldMat.disableDepthWrite = true;
    this.shieldMat.backFaceCulling = true;
    this.shieldMat.setVector3("uColor", new Vector3(0.35, 0.85, 1));
    this.shieldMat.setArray4("uHits", Array.from(this.hits));
    this.shieldMat.setVector4("uStr", new Vector4(0, 0, 0, 0));
    this.shieldMat.setFloat("uFlash", 0);
    this.shieldMat.setFloat("uTime", 0);
    this.shield = MeshBuilder.CreateSphere("ship-shield", { diameter: 2, segments: 20 }, scene);
    this.shield.scaling.copyFrom(this.shieldScale);
    this.shield.position.set(0, 0.1, 0.2);
    this.shield.material = this.shieldMat;
    this.shield.parent = this.root;
    this.shield.isPickable = false;
    this.shield.setEnabled(false);

    this.applyDetail(auto, this.pbr);
  }

  // ---------------------------------------------------------------- build

  private build(): void {
    const S = this.scene;
    const parts = new Map<string, Mesh[]>();
    const put = (group: Group, mat: MatKey, m: Mesh) => {
      const k = `${group}|${mat}`;
      if (!parts.has(k)) parts.set(k, []);
      parts.get(k)!.push(m);
      return m;
    };
    const box = (g: Group, mat: MatKey, w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
      const m = MeshBuilder.CreateBox("p", { width: w, height: h, depth: d }, S);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      scaleUV(m, Math.max(w, d) / TILE, Math.max(h, d) / TILE);
      return put(g, mat, m);
    };
    const cyl = (g: Group, mat: MatKey, len: number, d1: number, d2: number, x: number, y: number, z: number, tess = 12) => {
      // Along Z: diameterTop (d2) faces +Z.
      const m = MeshBuilder.CreateCylinder("p", { height: len, diameterTop: d2, diameterBottom: d1, tessellation: tess }, S);
      m.rotation.x = Math.PI / 2;
      m.position.set(x, y, z);
      return put(g, mat, m);
    };

    // --- Fuselage: lofted superellipse sections, nose to tail.
    const prof: [number, number, number, number, number][] = [
      // z, half-width, top, bottom, centre y
      [6.15, 0.03, 0.03, 0.03, 0.06],
      [5.6, 0.22, 0.16, 0.15, 0.04],
      [4.7, 0.5, 0.38, 0.36, 0.03],
      [3.5, 0.8, 0.6, 0.56, 0.04],
      [2.0, 1.0, 0.78, 0.7, 0.06],
      [0.2, 1.2, 0.9, 0.82, 0.04],
      [-1.8, 1.38, 0.98, 0.9, 0.02],
      [-3.4, 1.5, 1.0, 0.95, 0],
      [-4.3, 1.44, 0.95, 0.9, 0],
      [-4.75, 1.3, 0.84, 0.8, 0],
    ];
    const sections = prof.map(([z, w, t, b, c]) => section(z, w * 1.02, t, b, c));
    const body = MeshBuilder.CreateRibbon("p", { pathArray: sections, closePath: true, closeArray: false, sideOrientation: Mesh.DEFAULTSIDE }, S);
    scaleUV(body, 7.5 / TILE, 11 / TILE);
    put("core", "hull", body);
    // Tail bulkhead.
    const bulk = MeshBuilder.CreateCylinder("p", { height: 0.3, diameter: 1, tessellation: 20 }, S);
    bulk.rotation.x = Math.PI / 2;
    bulk.scaling.set(2.5, 1, 1.66);
    bulk.position.set(0, 0, -4.82);
    put("core", "trim", bulk);
    // Tail greebles: APU vent, heat-sink louvres, service hatch.
    cyl("core", "dark", 0.2, 0.5, 0.42, 0, 0.25, -5.0, 12);
    cyl("detail", "metal", 0.12, 0.3, 0.3, 0, 0.25, -5.08, 12);
    for (let k = 0; k < 5; k++) box("detail", "dark", 1.0, 0.05, 0.06, 0, -0.25 - k * 0.11, -4.98);
    box("detail", "trim", 0.5, 0.36, 0.08, 0.75, 0.42, -4.95);
    box("detail", "trim", 0.5, 0.36, 0.08, -0.75, 0.42, -4.95);

    // --- Canopy + frame.
    const canopy = MeshBuilder.CreateSphere("p", { diameter: 1, segments: 24 }, S);
    canopy.scaling.set(1.12, 0.72, 2.7);
    canopy.position.set(0, 0.78, 1.55);
    put("core", "glass", canopy);
    const ell = (k: number, a: number, yk = 1) => new Vector3(Math.cos(a) * 0.565 * k, 0.78 + Math.sin(a) * 0.36 * k * yk, 1.55);
    const frameBase: Vector3[] = [];
    for (let i = 0; i <= 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      frameBase.push(new Vector3(Math.cos(a) * 0.575, 0.8, 1.55 + Math.sin(a) * 1.37));
    }
    put("detail", "trim", MeshBuilder.CreateTube("p", { path: frameBase, radius: 0.045, tessellation: 6 }, S));
    for (const z of [0.35, 1.25]) {
      const hoop: Vector3[] = [];
      const zz = z - 1.55;
      const k = Math.sqrt(Math.max(0, 1 - (zz / 1.35) ** 2));
      for (let i = 0; i <= 12; i++) {
        const v = ell(k * 1.02, (i / 12) * Math.PI);
        v.z = z;
        hoop.push(v);
      }
      put("detail", "trim", MeshBuilder.CreateTube("p", { path: hoop, radius: 0.04, tessellation: 6 }, S));
    }
    const spine: Vector3[] = [];
    for (let i = 0; i <= 16; i++) {
      const zz = -1.3 + (i / 16) * 2.6;
      spine.push(new Vector3(0, 0.78 + 0.36 * 1.03 * Math.sqrt(Math.max(0, 1 - (zz / 1.35) ** 2)), 1.55 + zz));
    }
    put("detail", "trim", MeshBuilder.CreateTube("p", { path: spine, radius: 0.035, tessellation: 6 }, S));

    // --- Dorsal stripe, spine and greebles.
    box("core", "accent", 0.26, 0.06, 5.6, 0, 1.0, -0.9);
    box("detail", "trim", 0.5, 0.16, 2.8, 0, 1.02, -2.4);
    for (let i = 0; i < 4; i++) box("detail", "dark", 0.36, 0.06, 0.18, 0, 1.12, -1.4 - i * 0.5);
    box("ultra", "metal", 0.14, 0.14, 0.5, 0.36, 1.0, -0.4);
    box("ultra", "metal", 0.14, 0.14, 0.5, -0.36, 1.0, -0.4);
    cyl("ultra", "trim", 1.6, 0.08, 0.08, 0.32, 1.02, -2.6, 6);
    cyl("ultra", "trim", 1.6, 0.08, 0.08, -0.32, 1.02, -2.6, 6);
    // Antenna mast.
    const ant = MeshBuilder.CreateCylinder("p", { height: 0.9, diameterTop: 0.02, diameterBottom: 0.06, tessellation: 5 }, S);
    ant.position.set(0.25, 1.4, -0.9);
    ant.rotation.x = -0.5;
    put("detail", "metal", ant);
    // Flank panel inserts (geometric panel lines).
    for (const s of [-1, 1]) {
      box("detail", "dark", 0.04, 0.05, 3.2, s * 1.33, 0.45, -1.4, 0, s * 0.03, 0);
      box("detail", "dark", 0.04, 0.05, 2.4, s * 1.18, -0.45, -0.6, 0, s * 0.05, 0);
      box("detail", "trim", 0.06, 0.32, 0.9, s * 1.42, 0.05, -3.2);
      // Side intakes (scoop + dark mouth + lip).
      const intake = slab("p", S, [
        new Vector3(s * 0.92, -0.5, 2.3), new Vector3(s * 1.05, -0.5, 0.2), new Vector3(s * 1.4, -0.45, 0.2), new Vector3(s * 1.25, -0.45, 2.3),
        new Vector3(s * 0.92, 0.05, 2.3), new Vector3(s * 1.05, 0.12, 0.2), new Vector3(s * 1.4, 0.08, 0.2), new Vector3(s * 1.25, 0.02, 2.3),
      ]);
      put("core", "trim", intake);
      box("core", "dark", 0.28, 0.46, 0.08, s * 1.09, -0.22, 2.33, 0, s * 0.25, 0);
      box("detail", "accent", 0.36, 0.05, 0.12, s * 1.09, 0.06, 2.3, 0, s * 0.25, 0);
      for (let k = 0; k < 3; k++) box("ultra", "metal", 0.03, 0.4, 0.04, s * (1.0 + k * 0.09), -0.22, 2.36, 0, s * 0.25, 0);
      // RCS ports.
      for (const [x, y, z] of [[s * 0.52, 0.18, 4.6], [s * 1.5, 0.35, -4.4]] as const) {
        cyl("ultra", "dark", 0.14, 0.12, 0.08, x, y, z, 8).rotation.set(0, s * Math.PI / 2, 0);
        const p = new TransformNode("ship-rcs-pt", S);
        p.parent = this.root;
        p.position.set(x, y, z);
        this.rcsPorts.push(p);
      }
    }
    // Nose sensor tip + chin.
    cyl("detail", "metal", 0.5, 0.06, 0.01, 0, 0.06, 6.3, 6);
    box("detail", "dark", 0.5, 0.12, 1.2, 0, -0.42, 3.6);

    // --- Wings, tip fins, hardpoints.
    for (const s of [-1, 1]) {
      const wing = taper("p", S, [s * 0.9, -0.22, 0.3, -2.9, 0.24], [s * 4.85, 0.12, -1.65, -2.85, 0.09]);
      put("core", "hull", wing);
      const lead = taper("p", S, [s * 1.2, -0.2, 0.28, -0.1, 0.27], [s * 4.8, 0.13, -1.66, -1.9, 0.11]);
      put("core", "accent", lead);
      // Flap seam and wing panel strips.
      put("detail", "dark", taper("p", S, [s * 1.6, -0.08, -2.35, -2.45, 0.24], [s * 4.3, 0.18, -2.45, -2.55, 0.1]));
      put("detail", "trim", taper("p", S, [s * 2.2, -0.02, -0.9, -1.8, 0.22], [s * 3.6, 0.07, -1.4, -2.2, 0.15]));
      // Tip fin + lights.
      put("core", "trim", slab("p", S, [
        new Vector3(s * 4.8, -0.25, -1.4), new Vector3(s * 4.8, -0.25, -2.95), new Vector3(s * 4.98, 0.9, -2.95), new Vector3(s * 4.98, 0.9, -2.2),
        new Vector3(s * 5.0, -0.25, -1.4), new Vector3(s * 5.0, -0.25, -2.95), new Vector3(s * 5.12, 0.9, -2.95), new Vector3(s * 5.12, 0.9, -2.2),
      ]));
      // Hardpoint: pylon, twin-barrel cannon housing, barrels, muzzle brakes.
      const hx = s * 2.95;
      box("core", "trim", 0.16, 0.34, 1.3, hx, -0.42, -1.0);
      cyl("core", "trim", 1.4, 0.36, 0.3, hx, -0.66, -0.55, 10);
      cyl("detail", "accent", 0.12, 0.38, 0.38, hx, -0.66, -0.95, 12);
      for (const o of [-0.09, 0.09]) {
        const bx = hx + o;
        cyl("core", "metal", 2.0, 0.09, 0.08, bx, -0.66, 1.0, 8);
        cyl("detail", "dark", 0.22, 0.13, 0.13, bx, -0.66, 1.95, 8);
        for (let r = 0; r < 3; r++) box("ultra", "dark", 0.15, 0.02, 0.03, bx, -0.66, 1.88 - r * 0.07);
      }
    }
    // Gun order: left outer, left inner, right inner, right outer.
    for (const x of [-3.04, -2.86, 2.86, 3.04]) {
      const g = new TransformNode("ship-gun", S);
      g.parent = this.root;
      g.position.set(x, -0.66, 2.1);
      this.guns.push(g);
      const flash = MeshBuilder.CreatePlane("ship-muzzle-flash", { size: 1.1 }, S);
      flash.parent = g;
      flash.billboardMode = Mesh.BILLBOARDMODE_ALL;
      flash.isPickable = false;
      this.flashMat.bind(flash);
      flash.setEnabled(false);
      this.flashes.push({ mesh: flash, t: 1 });
    }

    // --- Dorsal fin.
    put("core", "hull", slab("p", S, [
      new Vector3(-0.08, 0.85, -1.9), new Vector3(-0.08, 0.85, -4.4), new Vector3(-0.05, 2.15, -4.6), new Vector3(-0.05, 2.15, -3.6),
      new Vector3(0.08, 0.85, -1.9), new Vector3(0.08, 0.85, -4.4), new Vector3(0.05, 2.15, -4.6), new Vector3(0.05, 2.15, -3.6),
    ]));
    put("core", "accent", slab("p", S, [
      new Vector3(-0.1, 1.55, -3.05), new Vector3(-0.1, 1.55, -4.5), new Vector3(-0.07, 1.75, -4.55), new Vector3(-0.07, 1.75, -3.3),
      new Vector3(0.1, 1.55, -3.05), new Vector3(0.1, 1.55, -4.5), new Vector3(0.07, 1.75, -4.55), new Vector3(0.07, 1.75, -3.3),
    ]));

    // --- Engine pods (lathed nacelles with exhaust bells).
    const podProfile = [
      [0.3, -1.05], [0.5, -1.0], [0.56, -1.25], [0.6, -2.0], [0.62, -3.3], [0.6, -4.2], [0.52, -4.5], [0.58, -4.95], [0.5, -4.98], [0.36, -4.6],
    ].map(([r, z]) => new Vector3(r, -z, 0));
    for (const s of [-1, 1]) {
      const x = s * 1.75, y = -0.1;
      const pod = MeshBuilder.CreateLathe("p", { shape: podProfile, tessellation: 20, sideOrientation: Mesh.DOUBLESIDE }, S);
      pod.rotation.x = -Math.PI / 2;
      pod.position.set(x, y, 0);
      scaleUV(pod, 3.8 / TILE, 4 / TILE);
      put("core", "trim", pod);
      // Intake mouth and fan.
      const mouth = MeshBuilder.CreateDisc("p", { radius: 0.34, tessellation: 16 }, S);
      mouth.position.set(x, y, -0.98);
      mouth.rotation.y = Math.PI;
      put("core", "dark", mouth);
      for (let k = 0; k < 6; k++) box("detail", "metal", 0.05, 0.6, 0.05, x, y, -1.08, 0, 0, (k / 6) * Math.PI);
      // Rings, cooling fins.
      const ring = MeshBuilder.CreateTorus("p", { diameter: 1.24, thickness: 0.12, tessellation: 24 }, S);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(x, y, -2.2);
      put("core", "accent", ring);
      const ring2 = MeshBuilder.CreateTorus("p", { diameter: 1.2, thickness: 0.07, tessellation: 24 }, S);
      ring2.rotation.x = Math.PI / 2;
      ring2.position.set(x, y, -4.15);
      put("detail", "metal", ring2);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        box("detail", "dark", 0.05, 0.16, 0.7, x + Math.cos(a) * 0.63, y + Math.sin(a) * 0.63, -3.6, 0, 0, a);
      }
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + 0.4;
        box("ultra", "metal", 0.06, 0.06, 1.4, x + Math.cos(a) * 0.6, y + Math.sin(a) * 0.6, -2.9, 0, 0, a);
      }
      // Pylon to fuselage.
      box("core", "trim", 0.5, 0.24, 1.8, s * 1.25, -0.1, -2.9);
      // Nozzle: glowing core inside the bell + inner cone.
      const core = MeshBuilder.CreateCylinder("ship-nozzle-core", { height: 0.5, diameterTop: 0.62, diameterBottom: 0.3, tessellation: 16 }, S);
      core.rotation.x = -Math.PI / 2;
      core.position.set(x, y, -4.72);
      core.parent = this.root;
      core.isPickable = false;
      this.engineMat.bind(core);
      this.addGroupMesh("core", core);
      const nz = new TransformNode("ship-nozzle-pt", S);
      nz.parent = this.root;
      nz.position.set(x, y, -5.0);
      this.nozzles.push(nz);
      // Plume: soft outer + hot core cones, additive with a lengthwise falloff texture.
      const outer = MeshBuilder.CreateCylinder("ship-flame", { height: 1, diameterTop: 0.95, diameterBottom: 0.12, tessellation: 14, cap: Mesh.NO_CAP }, S);
      const inner = MeshBuilder.CreateCylinder("ship-flame-core", { height: 1, diameterTop: 0.5, diameterBottom: 0.04, tessellation: 10, cap: Mesh.NO_CAP }, S);
      for (const [m, mat] of [[outer, this.flameOuterMat], [inner, this.flameCoreMat]] as const) {
        m.rotation.x = Math.PI / 2;
        m.position.set(x, y, -5.4);
        m.parent = this.root;
        m.isPickable = false;
        mat.bind(m);
      }
      this.flames.push({ outer, core: inner });
      this.halo(new Vector3(x, y, -5.05), 2.4, this.haloEngineMat, "engine");
    }

    // --- Lights: port red, starboard green, white strobes, belly beacon.
    const lightMat = (name: string, c: RGB) => {
      const m = new SurfaceMaterial(name, S, { color: c, roughness: 1, metallic: 0, unlit: true }, null);
      this.fxMats.push(m);
      return m;
    };
    const haloMat = (name: string, c: RGB) => {
      const m = new SurfaceMaterial(name, S, { color: c, roughness: 1, metallic: 0, unlit: true, additive: true, opacity: this.glowTex, backFaceCulling: false }, null);
      this.fxMats.push(m);
      return m;
    };
    const lamps: [Vector3, RGB, "nav" | "strobe" | "beacon", number][] = [
      [new Vector3(-5.06, 0.95, -2.6), [1, 0.18, 0.2], "nav", 1.1],
      [new Vector3(5.06, 0.95, -2.6), [0.2, 1, 0.45], "nav", 1.1],
      [new Vector3(0, 2.2, -4.6), [1, 1, 1], "strobe", 1.6],
      [new Vector3(-4.9, 0.1, -2.98), [1, 1, 1], "strobe", 1.2],
      [new Vector3(4.9, 0.1, -2.98), [1, 1, 1], "strobe", 1.2],
      [new Vector3(0, -0.98, -1.2), [1, 0.3, 0.25], "beacon", 1.2],
    ];
    const mats = new Map<string, [SurfaceMaterial, SurfaceMaterial]>();
    for (const [p, c, kind, size] of lamps) {
      const key = c.join(",");
      if (!mats.has(key)) mats.set(key, [lightMat(`ship-lamp-${mats.size}`, c), haloMat(`ship-lamp-halo-${mats.size}`, c)]);
      const [lm, hm] = mats.get(key)!;
      const bulb = MeshBuilder.CreateSphere("ship-lamp", { diameter: 0.16, segments: 6 }, S);
      bulb.position.copyFrom(p);
      bulb.parent = this.root;
      bulb.isPickable = false;
      lm.bind(bulb);
      this.addGroupMesh("core", bulb);
      this.halo(p, size, hm, kind);
    }
    // Belly landing light.
    const belly = MeshBuilder.CreateDisc("p", { radius: 0.28, tessellation: 12 }, S);
    belly.rotation.x = Math.PI / 2;
    belly.position.set(0, -0.86, 1.4);
    put("core", "glow", belly);

    // --- Landing gear (retracts in flight).
    for (const s of [-1, 1]) {
      const g: Group = "gear";
      box(g, "trim", 0.24, 0.16, 5.0, s * 1.5, -1.62, 0.2);
      box(g, "dark", 0.3, 0.06, 0.9, s * 1.5, -1.72, 2.3);
      box(g, "dark", 0.3, 0.06, 0.9, s * 1.5, -1.72, -1.9);
      for (const z of [-1.4, 1.8]) {
        const strut = MeshBuilder.CreateCylinder("p", { height: 1.15, diameter: 0.14, tessellation: 8 }, S);
        strut.position.set(s * 1.25, -1.05, z);
        strut.rotation.z = s * 0.35;
        put(g, "metal", strut);
        const piston = MeshBuilder.CreateCylinder("p", { height: 0.6, diameter: 0.22, tessellation: 8 }, S);
        piston.position.set(s * 1.12, -0.85, z);
        piston.rotation.z = s * 0.35;
        put(g, "trim", piston);
      }
    }

    // Merge per group/material.
    for (const [k, list] of parts) {
      const [group, mat] = k.split("|") as [Group, MatKey];
      const merged = Mesh.MergeMeshes(list, true, true);
      if (!merged) continue;
      merged.name = `ship-${group}-${mat}`;
      merged.parent = group === "gear" ? this.gear : this.root;
      merged.isPickable = false;
      this.mats.get(mat)!.bind(merged);
      this.addGroupMesh(group, merged);
      this.meshes.push(merged);
    }
  }

  private addGroupMesh(g: Group, m: Mesh): void {
    if (!this.groups.has(g)) this.groups.set(g, []);
    this.groups.get(g)!.push(m);
  }

  private halo(p: Vector3, size: number, mat: SurfaceMaterial, kind: "engine" | "nav" | "strobe" | "beacon"): void {
    const h = MeshBuilder.CreatePlane("ship-halo", { size: 1 }, this.scene);
    h.position.copyFrom(p);
    h.scaling.setAll(size);
    h.parent = this.root;
    h.billboardMode = Mesh.BILLBOARDMODE_ALL;
    h.isPickable = false;
    mat.bind(h);
    this.halos.push({ mesh: h, base: size, kind });
  }

  private makeFlameTexture(): RawTexture {
    // v: 0 = plume tip, 1 = nozzle. Bright near the nozzle, soft tail, faint banding.
    const w = 8, h = 64;
    const px = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      // RawTexture rows run top-down in v (row 0 = v 1), so row 0 is the nozzle end.
      const v = 1 - y / (h - 1);
      const a = Math.pow(v, 3) * (0.8 + 0.2 * Math.cos(v * 38));
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        px[o] = px[o + 1] = px[o + 2] = 255;
        px[o + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255);
      }
    }
    const t = RawTexture.CreateRGBATexture(px, w, h, this.scene, true, false, Texture.BILINEAR_SAMPLINGMODE);
    t.name = "ship-flame-tex";
    t.hasAlpha = true;
    t.wrapU = Texture.WRAP_ADDRESSMODE;
    t.wrapV = Texture.CLAMP_ADDRESSMODE;
    return t;
  }

  // ---------------------------------------------------------------- public API

  /** Tier the ship should use when nobody called setDetail (follows the material library). */
  private autoTier(): GraphicsTier {
    const L = this.lib;
    if (!L) return "enhanced";
    return L.pbr ? (L.triplanar ? "ultra" : "enhanced") : "basic";
  }

  /**
   * Mesh detail and shading: Basic = core meshes + Standard materials + 256² maps,
   * Enhanced = + detail greebles, PBR, 512², Extreme HD = + micro greebles, 1024².
   * `pbr` defaults to the tier's profile value. Call before `Renderer.apply` so
   * shadow casters are collected with the final mesh set.
   */
  setDetail(tier: GraphicsTier, pbr = PROFILES[tier].pbr): void {
    this.explicitDetail = true;
    this.applyDetail(tier, pbr);
  }

  private applyDetail(tier: GraphicsTier, pbr: boolean): void {
    this.detail = tier;
    this.pbr = pbr;
    const size = panelSize(tier);
    if (!this.panels || !this.panels.key.endsWith(`-${size}`)) {
      const old = this.panels;
      this.panels = acquirePanels(this.scene, size, "ship");
      for (const m of this.mats.values()) if (m.look.panels) m.setPanels(this.panels);
      releasePanels(this.scene, old);
    }
    for (const m of this.mats.values()) m.setMode(pbr);
    const on = (g: Group) => g === "core" || g === "gear" || (g === "detail" && tier !== "basic") || (g === "ultra" && tier === "ultra");
    for (const [g, list] of this.groups) for (const m of list) m.setEnabled(on(g));
    for (const h of this.halos) h.mesh.setEnabled(h.kind === "engine" || tier !== "basic" || h.kind === "nav");
  }

  /** Cosmetic paint (unknown ids fall back to the default scheme). */
  setPaint(id: string): void {
    const P = PAINT_SCHEMES[id] ?? PAINT_SCHEMES[DEFAULT_PAINT];
    this.paint = P.id;
    const m = this.mats;
    const hull = m.get("hull")!;
    hull.look.metallic = P.metallic;
    hull.look.roughness = P.roughness;
    hull.setColor([...P.hull]);
    // Metal/roughness of an existing PBR material.
    if (hull.pbr) {
      hull.pbr.metallic = P.metallic;
      hull.pbr.roughness = Math.min(1, P.roughness / 0.72);
    }
    m.get("trim")!.setColor([...P.trim]);
    m.get("accent")!.setColor([...P.accent], [...P.accentGlow]);
    m.get("glass")!.setColor([0.02, 0.05, 0.08], [...P.canopy]);
    this.engineMat.setColor([...P.engine]);
    this.flameOuterMat.setColor([...P.engine]);
    this.haloEngineMat.setColor([...P.engine]);
  }

  setPose(x: number, y: number, z: number, yaw: number, pitch: number, roll: number): void {
    this.root.position.set(x, y, z);
    this.root.rotation.set(-pitch, yaw, roll);
  }

  /** Brief muzzle flash at gun `index` (call when a bolt is fired from `guns[index]`). */
  muzzleFlash(index: number): void {
    const f = this.flashes[((index % this.flashes.length) + this.flashes.length) % this.flashes.length];
    if (!f) return;
    f.t = 0;
    f.mesh.setEnabled(true);
  }

  /**
   * Visible wear from hull integrity (1 = pristine): scorch maps from 85 %,
   * sparks below 60 %, smoke below 40 %, heavy smoke and flickering lights below 20 %.
   */
  setDamage(hullRatio: number): void {
    this.hullRatio = Math.max(0, Math.min(1, hullRatio));
    const d = 1 - this.hullRatio;
    const scorch = Math.max(0, Math.min(1, (d - 0.15) / 0.75));
    this.mats.get("hull")!.setDamage(scorch * 0.95);
    this.mats.get("trim")!.setDamage(scorch * 0.8);
    if (this.hullRatio < 0.6 && !this.sparks) this.createDamageFx();
    if (this.sparks) this.sparks.emitRate = this.hullRatio < 0.6 ? (0.6 - this.hullRatio) * (this.detail === "basic" ? 40 : 90) : 0;
    if (this.smoke) {
      const k = this.hullRatio < 0.4 ? (0.4 - this.hullRatio) / 0.4 : 0;
      this.smoke.emitRate = k * (this.detail === "basic" ? 14 : 32);
      const dark = this.hullRatio < 0.2 ? 0.25 : 0.55;
      this.smoke.color1 = new Color4(dark, dark, dark * 1.05, 0.55);
      this.smoke.color2 = new Color4(dark * 0.6, dark * 0.6, dark * 0.65, 0.45);
    }
  }

  /** Shield charge 0..1: tints the bubble (cyan → amber when low); 0 = no bubble, hits spark the hull. */
  setShieldLevel(ratio: number): void {
    this.shieldRatio = Math.max(0, Math.min(1, ratio));
    const r = this.shieldRatio;
    this.shieldMat.setVector3("uColor", new Vector3(0.35 + (1 - r) * 0.65, 0.85 - (1 - r) * 0.35, 1 - (1 - r) * 0.8));
  }

  /** Shield impact ripple at a world-space point (strength 0..1). */
  shieldHit(worldPoint: Vector3, strength: number): void {
    const k = Math.max(0, Math.min(1, strength));
    if (this.shieldRatio <= 0.001) {
      // No shield: the hull takes it.
      if (!this.sparks) this.createDamageFx();
      this.sparkEmitter.copyFrom(worldPoint);
      this.burst = Math.round(8 + k * 24);
      return;
    }
    this.root.computeWorldMatrix(true);
    this.root.getWorldMatrix().invertToRef(this.tmpM);
    const local = Vector3.TransformCoordinates(worldPoint, this.tmpM).subtractInPlace(this.shield.position);
    local.x /= this.shieldScale.x;
    local.y /= this.shieldScale.y;
    local.z /= this.shieldScale.z;
    if (local.lengthSquared() < 1e-6) local.set(0, 0, 1);
    local.normalize();
    const i = this.hitCursor++ % 4;
    this.hits.set([local.x, local.y, local.z, 0], i * 4);
    this.hitStr[i] = (0.35 + 0.65 * k) * (0.4 + 0.6 * this.shieldRatio);
    this.shieldFlash = Math.max(this.shieldFlash, 0.25 + 0.5 * k);
    this.shield.setEnabled(true);
  }

  private createDamageFx(): void {
    const S = this.scene;
    const sp = new ParticleSystem("ship-sparks", this.detail === "basic" ? 40 : 90, S);
    sp.particleTexture = this.glowTex;
    sp.emitter = this.sparkEmitter;
    sp.minSize = 0.04;
    sp.maxSize = 0.14;
    sp.minLifeTime = 0.15;
    sp.maxLifeTime = 0.5;
    sp.minEmitPower = 3;
    sp.maxEmitPower = 8;
    sp.direction1 = new Vector3(-1, 0.4, -1);
    sp.direction2 = new Vector3(1, 1.6, 1);
    sp.gravity = new Vector3(0, -6, 0);
    sp.color1 = new Color4(1, 0.85, 0.45, 1);
    sp.color2 = new Color4(1, 0.55, 0.2, 1);
    sp.colorDead = new Color4(0.3, 0.05, 0, 0);
    sp.blendMode = ParticleSystem.BLENDMODE_ADD;
    sp.emitRate = 0;
    sp.start();
    this.sparks = sp;
    const sm = new ParticleSystem("ship-smoke", this.detail === "basic" ? 30 : 70, S);
    sm.particleTexture = this.glowTex;
    sm.emitter = this.smokeEmitter;
    sm.minSize = 0.5;
    sm.maxSize = 1.4;
    sm.minScaleX = sm.minScaleY = 1;
    sm.addSizeGradient(0, 0.6);
    sm.addSizeGradient(1, 2.6);
    sm.minLifeTime = 0.9;
    sm.maxLifeTime = 2.0;
    sm.minEmitPower = 0.5;
    sm.maxEmitPower = 1.5;
    sm.direction1 = new Vector3(-0.3, 0.6, -0.3);
    sm.direction2 = new Vector3(0.3, 1.2, 0.3);
    sm.colorDead = new Color4(0.1, 0.1, 0.1, 0);
    sm.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    sm.emitRate = 0;
    sm.start();
    this.smoke = sm;
    this.setDamage(this.hullRatio);
  }

  /** @param throttle 0..1 @param gearDown 0 (retracted) .. 1 (deployed) */
  animate(dt: number, throttle: number, boosting: boolean, gearDown: number, active: boolean): void {
    this.t += dt;
    if (!this.explicitDetail && this.lib) {
      const want = this.autoTier();
      if (want !== this.detail || PROFILES[want].pbr !== this.pbr) this.applyDetail(want, PROFILES[want].pbr);
    }
    const thr = Math.max(0, Math.min(1, throttle));
    const flick = 0.92 + Math.random() * 0.16;
    // Plume length grows with throttle; boost lengthens and whitens the core (afterburner).
    const len = active ? 0.5 + thr * (boosting ? 5.4 : 2.8) : 0;
    for (const f of this.flames) {
      for (const [m, k, w] of [[f.outer, 1, 1], [f.core, boosting ? 0.8 : 0.6, boosting ? 1.15 : 1]] as const) {
        const l = len * k * flick;
        m.setEnabled(l > 0.05);
        m.scaling.set(w * (0.85 + thr * 0.25), l, w * (0.85 + thr * 0.25));
        m.position.z = -5.0 - l / 2;
      }
    }
    this.flameTex.vOffset = (this.t * 2.3) % 1;
    // Engine core glow brightness tracks throttle (also when parked: dim idle glow).
    const P = PAINT_SCHEMES[this.paint];
    const e = active ? 0.55 + thr * 0.45 + (boosting ? 0.25 : 0) : 0.28;
    const eng = this.engineMat.std;
    if (eng) eng.emissiveColor.set(Math.min(1, P.engine[0] * e + (boosting ? 0.25 : 0)), Math.min(1, P.engine[1] * e + (boosting ? 0.2 : 0)), Math.min(1, P.engine[2] * e + (boosting ? 0.15 : 0)));
    const core = this.flameCoreMat.std;
    if (core) core.alpha = boosting ? 1 : 0.8;

    // Lights: nav steady (flicker when badly damaged), strobes double-flash, belly beacon pulses.
    const ph = this.t % 1.4;
    const strobe = ph < 0.05 || (ph > 0.16 && ph < 0.21);
    const beacon = Math.max(0, Math.sin(this.t * 4.5));
    const broken = this.hullRatio < 0.2 && Math.random() < 0.25;
    for (const h of this.halos) {
      let s = 1;
      if (h.kind === "engine") s = active ? 0.7 + thr * 0.5 + (boosting ? 0.35 : 0) : 0;
      else if (h.kind === "strobe") s = strobe && active ? 1 : 0;
      else if (h.kind === "beacon") s = active ? beacon : 0;
      else if (h.kind === "nav") s = broken ? 0.2 : 1;
      h.mesh.isVisible = s > 0.02;
      h.mesh.scaling.setAll(h.base * Math.max(0.02, s) * (h.kind === "engine" ? flick : 1));
    }

    // Muzzle flashes (~70 ms).
    for (const f of this.flashes) {
      if (f.t >= 1) continue;
      f.t += dt / 0.07;
      if (f.t >= 1) {
        f.mesh.setEnabled(false);
        continue;
      }
      const s = (1 - f.t) * (0.8 + Math.random() * 0.5);
      f.mesh.scaling.setAll(s);
      f.mesh.rotation.z = Math.random() * Math.PI;
    }

    // Gear.
    const g = Math.max(0.05, gearDown);
    this.gear.scaling.set(1, g, 1);
    this.gear.position.y = (1 - g) * -0.2;

    // Damage emitters follow random hull points.
    if (this.sparks || this.smoke) {
      this.root.computeWorldMatrix(true);
      const wm = this.root.getWorldMatrix();
      if (this.sparks && this.burst > 0) {
        // One-shot burst at the impact point; manualEmitCount must be reset or emitRate stops working.
        this.sparks.manualEmitCount = this.burst;
        this.burst = 0;
        this.burstReset = true;
      } else if (this.sparks && this.burstReset) {
        this.sparks.manualEmitCount = -1;
        this.burstReset = false;
      } else if (this.sparks && this.sparks.emitRate > 0 && Math.random() < 0.15) {
        this.damageCursor = (this.damageCursor + 1 + Math.floor(Math.random() * 3)) % this.damagePoints.length;
        Vector3.TransformCoordinatesToRef(this.damagePoints[this.damageCursor], wm, this.sparkEmitter);
      }
      if (this.smoke) Vector3.TransformCoordinatesToRef(this.damagePoints[this.hullRatio < 0.2 ? 0 : 1], wm, this.smokeEmitter);
    }

    // Shield ripple ages.
    if (this.shield.isEnabled()) {
      let any = false;
      for (let i = 0; i < 4; i++) {
        const o = i * 4 + 3;
        if (this.hits[o] < 0) continue;
        this.hits[o] += dt;
        if (this.hits[o] > 0.85) this.hits[o] = -1;
        else any = true;
      }
      this.shieldFlash = Math.max(0, this.shieldFlash - dt * 1.8);
      if (!any && this.shieldFlash <= 0) this.shield.setEnabled(false);
      else {
        const cam = this.scene.activeCamera;
        if (cam) this.shieldMat.setVector3("cameraPosition", cam.globalPosition);
        this.shieldMat.setArray4("uHits", Array.from(this.hits));
        this.shieldMat.setVector4("uStr", this.strVec.set(this.hitStr[0], this.hitStr[1], this.hitStr[2], this.hitStr[3]));
        this.shieldMat.setFloat("uFlash", this.shieldFlash);
        this.shieldMat.setFloat("uTime", this.t);
      }
    }
  }

  /** Disposes every mesh, material, texture and particle system the ship created. */
  dispose(): void {
    this.sparks?.dispose(false);
    this.smoke?.dispose(false);
    this.sparks = this.smoke = null;
    this.root.dispose(false, false);
    for (const m of this.mats.values()) m.dispose();
    for (const m of this.fxMats) m.dispose();
    this.shieldMat.dispose(true, false);
    this.glowTex.dispose();
    this.flameTex.dispose();
    this.scorchTex.dispose();
    releasePanels(this.scene, this.panels);
    this.panels = null;
    this.meshes.length = 0;
    this.groups.clear();
  }
}

function panelSize(t: GraphicsTier): number {
  return t === "basic" ? 256 : t === "enhanced" ? 512 : 1024;
}
