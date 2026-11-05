import {
  Color3,
  DirectionalLight,
  HemisphericLight,
  InstancedMesh,
  Matrix,
  Mesh,
  MeshBuilder,
  Quaternion,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
  VertexData,
  type AbstractMesh,
  type Camera,
  type DynamicTexture,
  type Texture,
} from "../engine/babylon";
import { SimplexNoise, createRng, rngRange, smoothstep, clamp, type Rng } from "../core/random";
import { WORLD } from "../core/worldConfig";
import type { ResourceId } from "../gameplay/resources";
import { Heightfield, buildTerrainModel, createTerrainFunction, terrainNum, type HeightFn, type TerrainModel } from "./heightfield";
import { Sky, type SkyColors } from "./sky";
import { WeatherFx } from "./weather";
import { WorldUniforms, makeTexture, sunVector, type GfMaterial, type Look, type MaterialLibrary } from "../graphics/materials";
import { lavaTexture } from "../graphics/texgen";
import { runtimeId, type PlanetDef, type PoiDef, type PoiKind, type Rgb } from "../universe/types";
import { VEYRA7, resourceCounts, type PlanetDefX, type PlanetLook } from "../universe/planets";
import type { RendererWorld } from "../graphics/renderer";

export interface Deposit {
  id: string;
  type: ResourceId;
  position: Vector3;
  /** Targeting radius (m). */
  radius: number;
  amount: number;
  max: number;
  /** Fractional units extracted but not yet stored. */
  carry: number;
  mesh: InstancedMesh;
  baseScale: Vector3;
  depletedAt: number | null;
  collider: Collider | null;
}

export interface Collider {
  x: number;
  z: number;
  r: number;
  top: number;
}

/** Sphere around a floating rock island (Zephyria). Not used for walking; ship physics may ignore it. */
export interface FloatingCollider {
  x: number;
  y: number;
  z: number;
  r: number;
}

export interface ResourceZone {
  type: ResourceId;
  x: number;
  z: number;
  r: number;
  /** Rich zones carry larger deposits (and usually a hazard). */
  rich: boolean;
}

export interface PointOfInterest {
  id: string;
  name: string;
  position: Vector3;
  lore: string;
  loot: Partial<Record<ResourceId, number>>;
  root: TransformNode;
  kind?: PoiKind;
}

/** Collision / gameplay grid is identical in every graphics tier. */
export const TERRAIN_RES = 256;
const CHUNKS = 8;
const HAZARD_RES = 128;
/** "No liquid" sentinel for liquidLevel / landingLiquidLevel (finite, so arithmetic stays safe). */
export const NO_LIQUID = -1e6;

const SUN_DIR = new Vector3(-0.62, 0.4, -0.67).normalize();

/** Veyra-7 sky colours (M1/M2 compatibility export; per-planet colours are on `planet.skyColors`). */
export const SKY_COLORS = {
  zenith: new Color3(0.07, 0.05, 0.2),
  horizon: new Color3(0.78, 0.46, 0.55),
  ground: new Color3(0.14, 0.09, 0.15),
  sun: new Color3(1.0, 0.86, 0.68),
};

type V3 = [number, number, number];
const c3 = (c: Rgb | V3) => new Color3(c[0], c[1], c[2]);
const mix3 = (a: number[], b: number[], t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Resolves a def's optional look against values derived from its sky/palette. */
export function planetLook(def: PlanetDef): PlanetLook {
  const s = def.sky;
  const L = (def as PlanetDefX).look ?? {};
  const lerp = (a: Rgb, b: Rgb, t: number): Rgb => mix3(a, b, t);
  const scale = (a: Rgb, k: number): Rgb => [a[0] * k, a[1] * k, a[2] * k];
  return {
    sunDiffuse: s.sun,
    sunSpecular: scale(s.sun, 0.6),
    ambientSky: lerp(s.zenith, s.horizon, 0.6),
    ambientGround: scale(s.ground, 1.6),
    sceneAmbient: scale(lerp(s.zenith, s.horizon, 0.4), 0.6),
    haze: scale(s.horizon, 0.82),
    hazeSun: s.sun,
    hazeFalloff: 0.012,
    fog: scale(L.haze ?? s.horizon, L.haze ? 1 : 0.82),
    backdrop: scale(s.ground, 1.5),
    backdropGlow: 0.38,
    backdropHeight: 1,
    clouds: 0,
    cloudCover: 0.5,
    cloudTint: [1, 1, 1],
    giantA: [0.36, 0.55, 0.78],
    giantB: [0.62, 0.48, 0.82],
    ring: [0.85, 0.72, 0.95],
    giantDir: [0.75, 0.3, -0.58],
    holeDir: [-0.55, 0.42, 0.72],
    liquidAlbedo: def.liquid.color,
    liquidEmissive: scale(def.liquid.color, def.liquid.emissive * 0.3),
    liquidAlpha: 0.88,
    liquidRoughness: 0.07,
    shore: def.palette.mid,
    shoreWidth: 0,
    terrainRoughness: 0.94,
    sparkle: 0,
    beacon: [0.2, 0.9, 1],
    accent: [1, 0.55, 0.25],
    ...L,
  };
}

/**
 * Decorative thin-instance field split into spatial chunks so each chunk is
 * frustum- and distance-culled on its own. Density is changed live through
 * thinInstanceCount (instances are shuffled, so any prefix is a fair sample).
 */
class ScatterField {
  readonly chunks: { mesh: Mesh; count: number }[] = [];
  private cull = -1;

  constructor(
    readonly name: string,
    private readonly source: Mesh,
    matrices: Float32Array[],
    lib: MaterialLibrary,
    mat: GfMaterial,
    rng: Rng,
    size: number = WORLD.terrainSize,
  ) {
    const cell = size / CHUNKS;
    const buckets = new Map<string, Float32Array[]>();
    for (const m of matrices) {
      const key = `${Math.floor((m[12] + size / 2) / cell)},${Math.floor((m[14] + size / 2) / cell)}`;
      (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(m);
    }
    for (const [key, list] of buckets) {
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
      const mesh = source.clone(`${name}-${key}`, null, true) as Mesh;
      // Thin-instance buffers live on the geometry: each chunk needs its own copy,
      // otherwise chunks read each other's matrices (zero matrices -> w=0 blow-ups).
      mesh.makeGeometryUnique();
      const buf = new Float32Array(list.length * 16);
      list.forEach((m, i) => buf.set(m, i * 16));
      mesh.thinInstanceSetBuffer("matrix", buf, 16, true);
      mesh.thinInstanceRefreshBoundingInfo(false);
      mesh.isPickable = false;
      mesh.isVisible = true;
      mesh.freezeWorldMatrix();
      mesh.alwaysSelectAsActiveMesh = false;
      lib.bind(mesh, mat);
      this.chunks.push({ mesh, count: list.length });
    }
    source.setEnabled(false);
  }

  setDensity(fraction: number): void {
    for (const c of this.chunks) {
      const n = Math.round(c.count * clamp(fraction, 0, 1));
      c.mesh.thinInstanceCount = n;
      c.mesh.setEnabled(n > 0);
    }
  }

  setCullDistance(d: number): void {
    if (d === this.cull) return;
    this.cull = d;
    for (const c of this.chunks) {
      c.mesh.removeLODLevel(null as unknown as Mesh);
      c.mesh.addLODLevel(d, null);
    }
  }

  get instances(): number {
    return this.chunks.reduce((n, c) => n + c.mesh.thinInstanceCount, 0);
  }
}

type SpotOpts = { minR?: number; maxR: number; cx?: number; cz?: number; minNy?: number; avoidSite?: number; tries?: number; minH?: number; maxH?: number };
type PartMat = GfMaterial | StandardMaterial;

/** Collects primitive parts per material and merges them into one mesh per material (few draw calls per structure). */
class Kit {
  private readonly parts = new Map<PartMat, Mesh[]>();
  readonly colliders: { x: number; z: number; r: number; h: number }[] = [];
  private n = 0;

  constructor(
    private readonly scene: Scene,
    private readonly name: string,
  ) {}

  add<M extends Mesh>(m: M, mat: PartMat): M {
    (this.parts.get(mat) ?? this.parts.set(mat, []).get(mat)!).push(m);
    return m;
  }
  private id(): string {
    return `${this.name}-p${this.n++}`;
  }
  private place(m: Mesh, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): Mesh {
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    return m;
  }
  box(w: number, h: number, d: number, x: number, y: number, z: number, mat: PartMat, ry = 0, rx = 0, rz = 0): Mesh {
    return this.add(this.place(MeshBuilder.CreateBox(this.id(), { width: w, height: h, depth: d }, this.scene), x, y, z, rx, ry, rz), mat);
  }
  cyl(h: number, top: number, bot: number, tess: number, x: number, y: number, z: number, mat: PartMat, rx = 0, ry = 0, rz = 0): Mesh {
    return this.add(this.place(MeshBuilder.CreateCylinder(this.id(), { height: h, diameterTop: top, diameterBottom: bot, tessellation: tess }, this.scene), x, y, z, rx, ry, rz), mat);
  }
  sphere(d: number, seg: number, x: number, y: number, z: number, mat: PartMat, slice = 1, sy = 1): Mesh {
    const m = this.place(MeshBuilder.CreateSphere(this.id(), { diameter: d, segments: seg, slice }, this.scene), x, y, z);
    m.scaling.y = sy;
    return this.add(m, mat);
  }
  torus(d: number, t: number, x: number, y: number, z: number, mat: PartMat, rx = 0, rz = 0): Mesh {
    return this.add(this.place(MeshBuilder.CreateTorus(this.id(), { diameter: d, thickness: t, tessellation: 24 }, this.scene), x, y, z, rx, 0, rz), mat);
  }
  /** Straight strut between two local points. */
  strut(a: Vector3, b: Vector3, d: number, mat: PartMat, tess = 6): Mesh {
    const len = Vector3.Distance(a, b);
    const m = MeshBuilder.CreateCylinder(this.id(), { height: len, diameter: d, tessellation: tess }, this.scene);
    m.position.copyFrom(a.add(b).scale(0.5));
    const dir = b.subtract(a).normalize();
    const axis = Vector3.Cross(Vector3.Up(), dir);
    const ang = Math.acos(clamp(Vector3.Dot(Vector3.Up(), dir), -1, 1));
    m.rotationQuaternion = axis.lengthSquared() < 1e-8 ? Quaternion.Identity() : Quaternion.RotationAxis(axis.normalize(), ang);
    return this.add(m, mat);
  }
  collide(x: number, z: number, r: number, h: number): void {
    this.colliders.push({ x, z, r, h });
  }

  /** Merges parts per material under `root`. Returns the merged meshes keyed by material. */
  build(root: TransformNode, bind: (m: Mesh, mat: PartMat) => void): Map<PartMat, Mesh> {
    const out = new Map<PartMat, Mesh>();
    let i = 0;
    for (const [mat, list] of this.parts) {
      const merged = list.length === 1 ? list[0] : Mesh.MergeMeshes(list, true, true)!;
      merged.name = `${this.name}-m${i++}`;
      merged.parent = root;
      merged.isPickable = false;
      bind(merged, mat);
      out.set(mat, merged);
    }
    return out;
  }
}

/**
 * A planet: terrain, atmosphere, lighting, scenery, resource deposits and
 * points of interest, built from a PlanetDef. Rendering + spatial queries.
 * `new Planet(scene, lib)` builds Veyra-7 exactly as M1/M2 did.
 */
export class Planet {
  readonly def: PlanetDef;
  readonly look: PlanetLook;
  readonly heightFn: HeightFn;
  readonly heightfield: Heightfield;
  readonly terrain: TerrainModel;
  readonly terrainChunks: Mesh[] = [];
  readonly sky: Sky;
  readonly sun: DirectionalLight;
  readonly ambient: HemisphericLight;
  readonly deposits: Deposit[] = [];
  readonly pois: PointOfInterest[] = [];
  readonly colliders: Collider[] = [];
  /** Floating islands (Zephyria): spheres the ship may avoid; never block walking. */
  readonly floatingColliders: FloatingCollider[] = [];
  readonly resourceZones: ResourceZone[] = [];
  readonly sunDirection: Vector3;
  readonly scatter: ScatterField[] = [];
  /** Instanced source meshes of rocks, flora & deposits (shadow casters / LOD). */
  readonly propSources: Mesh[] = [];
  /** Sky colours for the renderer's image-based light. */
  readonly skyColors: SkyColors;
  /** Multipliers on the render profile (feed to Renderer.setWorld). */
  readonly lighting: { sun: number; ambient: number; fog: number };
  /** Ground below this is liquid you wade through (water, lumen, lava, acid). NO_LIQUID when none / frozen. */
  readonly liquidLevel: number;
  /** Landing is refused where ground < this (+ ship margin). Frozen lakes are landable (NO_LIQUID). */
  readonly landingLiquidLevel: number;
  /** Weather created by createWeather (disposed with the planet). */
  weather: WeatherFx | null = null;
  /** Construction time (ms). */
  readonly buildMs: number;
  private readonly propLowLods: Mesh[] = [];
  private readonly propLodScale: { high: number; cull: number }[] = [];
  private grid = new Map<string, Collider[]>();
  private readonly gridCell = 24;
  private readonly noise: SimplexNoise;
  private beaconMeshes: Mesh[] = [];
  private blinkers: { mesh: Mesh; phase: number; rate: number }[] = [];
  private spinners: { node: TransformNode | Mesh; rate: number }[] = [];
  private water: Mesh | null = null;
  private waterWaves = true;
  private lavaTex: DynamicTexture | null = null;
  private time = 0;
  private lod = { high: -1, cull: -1, terrain: -1 };
  private readonly legacy: boolean;
  private readonly level: number;
  private readonly keepClear: { x: number; z: number; r: number }[] = [];
  private readonly gfMats: GfMaterial[] = [];
  private hazardGrid: Float32Array | null = null;
  private liquidDist: Float32Array | null = null;
  private readonly owned: { meshes: AbstractMesh[]; materials: unknown[]; textures: unknown[]; lights: unknown[]; nodes: TransformNode[]; particles: unknown[] };
  private disposed = false;
  private readonly sources: Record<string, Mesh> = {};

  constructor(
    private readonly scene: Scene,
    private readonly lib: MaterialLibrary,
    def: PlanetDef = VEYRA7,
  ) {
    const t0 = performance.now();
    const before = {
      meshes: new Set(scene.meshes),
      materials: new Set(scene.materials),
      textures: new Set(scene.textures),
      lights: new Set(scene.lights),
      nodes: new Set(scene.transformNodes),
      particles: new Set(scene.particleSystems),
    };
    this.def = def;
    this.look = planetLook(def);
    this.legacy = def.id === "veyra7";
    this.level = def.liquid.kind === "none" ? NO_LIQUID : def.liquid.level;
    this.liquidLevel = def.liquid.kind === "none" ? NO_LIQUID : def.liquid.level;
    this.landingLiquidLevel = def.liquid.kind === "none" || def.liquid.kind === "ice" ? NO_LIQUID : def.liquid.level;
    this.noise = new SimplexNoise(def.seed + 3);
    this.terrain = buildTerrainModel(def);
    this.heightFn = this.legacy ? createTerrainFunction(def.seed) : this.terrain.fn;
    this.heightfield = new Heightfield(this.heightFn, def.terrainSize, TERRAIN_RES);
    this.sunDirection = this.legacy ? SUN_DIR.clone() : new Vector3(...def.sky.sunDir).normalize();
    const s = def.sky;
    this.skyColors = { zenith: c3(s.zenith), horizon: c3(s.horizon), ground: c3(s.ground), sun: c3(s.sun) };
    this.lighting = { sun: s.sunScale, ambient: s.ambientScale, fog: s.fogScale };

    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogDensity = 0.0016;
    const L = this.look;
    this.sky = new Sky(scene, this.sunDirection, this.skyColors, s.stars, this.legacy ? {} : {
      baseClouds: L.clouds,
      cloudCover: L.cloudCover,
      cloudTint: c3(L.cloudTint),
      giantA: c3(L.giantA),
      giantB: c3(L.giantB),
      ring: c3(L.ring),
      giantDir: new Vector3(...L.giantDir),
      holeDir: new Vector3(...L.holeDir),
    });
    this.sun = new DirectionalLight("gf-sun", this.sunDirection.scale(-1), scene);
    this.sun.intensity = 1.75;
    this.sun.diffuse = c3(L.sunDiffuse);
    this.sun.specular = c3(L.sunSpecular);
    this.ambient = new HemisphericLight("gf-amb", new Vector3(0, 1, 0), scene);
    this.ambient.intensity = 0.62;
    this.ambient.diffuse = c3(L.ambientSky);
    this.ambient.groundColor = c3(L.ambientGround);
    this.ambient.specular = Color3.Black();
    this.applyAtmosphere();

    this.buildTerrain();
    this.buildLiquid();
    this.buildBackdrop();
    if (this.legacy) {
      this.buildBoulders();
      this.buildDecor();
      this.buildDeposits();
      this.buildPois();
    } else {
      for (const p of def.pois) this.keepClear.push({ x: p.x, z: p.z, r: p.id === "kharon" ? 52 : 22 });
      this.buildLiquidDistance();
      this.buildRocks();
      this.buildBiomeProps();
      this.buildBiomeDecor();
      this.buildGenericDeposits();
      this.buildGenericPois();
      this.buildHazard();
    }
    this.buildSurveyBeacon();
    // LOD meshes must be attached before the first frame or they render standalone.
    this.setPropLod(70, 480, 380);
    this.setDecorDensity(0.7, 0.45, 260);

    this.owned = {
      meshes: scene.meshes.filter((m) => !before.meshes.has(m)),
      materials: scene.materials.filter((m) => !before.materials.has(m)),
      textures: scene.textures.filter((t) => !before.textures.has(t)),
      lights: scene.lights.filter((l) => !before.lights.has(l)),
      nodes: scene.transformNodes.filter((n) => !before.nodes.has(n)),
      particles: scene.particleSystems.filter((p) => !before.particles.has(p)),
    };
    this.buildMs = performance.now() - t0;
  }

  // ---------------------------------------------------------------- queries

  groundAt(x: number, z: number): number {
    const h = this.heightfield.heightAt(x, z);
    return this.def.liquid.kind === "ice" && h < this.level ? this.level : h;
  }

  normalYAt(x: number, z: number): number {
    if (this.def.liquid.kind === "ice" && this.heightfield.heightAt(x, z) < this.level) return 1;
    return this.heightfield.normalAt(x, z).y;
  }

  /** True where the visible surface is liquid you would sink into (not ice). */
  isLiquidAt(x: number, z: number): boolean {
    return this.heightfield.heightAt(x, z) < this.liquidLevel;
  }

  /** Environmental hazard intensity 0..1 at a point (cold, heat, storm, toxic). 0 at the landing site core. */
  hazardAt(x: number, z: number): number {
    const g = this.hazardGrid;
    if (!g) return 0;
    const size = this.def.terrainSize;
    const cell = size / HAZARD_RES;
    const gx = clamp((x + size / 2) / cell - 0.5, 0, HAZARD_RES - 1.001);
    const gz = clamp((z + size / 2) / cell - 0.5, 0, HAZARD_RES - 1.001);
    const i = Math.floor(gx), j = Math.floor(gz);
    const fx = gx - i, fz = gz - j;
    const a = g[j * HAZARD_RES + i], b = g[j * HAZARD_RES + i + 1];
    const c = g[(j + 1) * HAZARD_RES + i], d = g[(j + 1) * HAZARD_RES + i + 1];
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  }

  collidersNear(x: number, z: number): Collider[] {
    const out: Collider[] = [];
    const cx = Math.floor(x / this.gridCell);
    const cz = Math.floor(z / this.gridCell);
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++) {
        const list = this.grid.get(`${cx + i},${cz + j}`);
        if (list) out.push(...list);
      }
    return out;
  }

  addCollider(c: Collider): void {
    this.colliders.push(c);
    const key = `${Math.floor(c.x / this.gridCell)},${Math.floor(c.z / this.gridCell)}`;
    const list = this.grid.get(key) ?? [];
    list.push(c);
    this.grid.set(key, list);
  }

  removeCollider(c: Collider): void {
    const key = `${Math.floor(c.x / this.gridCell)},${Math.floor(c.z / this.gridCell)}`;
    const list = this.grid.get(key);
    if (list) this.grid.set(key, list.filter((x) => x !== c));
    const i = this.colliders.indexOf(c);
    if (i >= 0) this.colliders.splice(i, 1);
  }

  refreshDeposit(d: Deposit): void {
    const alive = d.amount > 0 && d.depletedAt === null;
    d.mesh.setEnabled(alive);
    if (!alive) {
      if (d.collider) this.removeCollider(d.collider);
      return;
    }
    const k = 0.4 + 0.6 * (d.amount / d.max);
    d.mesh.scaling.copyFrom(d.baseScale.scale(k));
    if (d.collider && !this.colliders.includes(d.collider)) this.addCollider(d.collider);
    if (d.collider) d.collider.r = d.radius * 0.8 * k;
  }

  regrow(d: Deposit): void {
    d.amount = d.max;
    d.depletedAt = null;
    d.carry = 0;
    this.refreshDeposit(d);
  }

  /**
   * Creates this planet's weather (null for "none"), owned and disposed by the
   * planet and driven by `update()` with WorldUniforms.wind.
   */
  createWeather(camera: Camera | { position: Vector3 }, particleTexture: Texture | null = null): WeatherFx | null {
    this.weather?.dispose();
    this.weather = null;
    if (this.def.weather.kind === "none" || this.def.weather.intensity <= 0) return null;
    this.weather = new WeatherFx(this.scene, particleTexture, camera as { position: Vector3 }, this.def.weather.kind, this.def.weather.intensity);
    return this.weather;
  }

  update(dt: number, camera: Vector3): void {
    this.time += dt;
    this.sky.update(dt);
    const pulse = 0.55 + 0.45 * Math.sin(this.time * 3);
    for (const m of this.beaconMeshes) m.visibility = pulse;
    for (const b of this.blinkers) b.mesh.visibility = Math.sin(this.time * b.rate + b.phase) > 0.2 ? 1 : 0.12;
    for (const s of this.spinners) s.node.rotation.y += s.rate * dt;
    if (this.waterWaves && this.water) {
      const b = (this.water.material as unknown as { bumpTexture?: { uOffset: number; vOffset: number } | null } | null)?.bumpTexture;
      if (b) {
        b.uOffset = (this.time * 0.006) % 1;
        b.vOffset = (this.time * 0.0045) % 1;
      }
    }
    if (this.lavaTex) {
      this.lavaTex.uOffset = (this.time * 0.0016) % 1;
      this.lavaTex.vOffset = (Math.sin(this.time * 0.05) * 0.01 + this.time * 0.0009) % 1;
    }
    if (this.weather) {
      const w = WorldUniforms.wind;
      this.weather.update(dt, { x: w.x, z: w.y, strength: w.z });
      this.sky.setFlash(this.weather.flash);
    }
    void camera;
  }

  // ---------------------------------------------------------------- renderer hooks

  /** Sets this planet's haze / sun colours on WorldUniforms and the scene fog & ambient colours. */
  applyAtmosphere(): void {
    const L = this.look;
    this.scene.fogColor = this.legacy ? SKY_COLORS.horizon.scale(0.82) : c3(L.fog);
    this.scene.ambientColor = c3(L.sceneAmbient);
    WorldUniforms.haze.set(L.haze[0], L.haze[1], L.haze[2]);
    WorldUniforms.sunColor.set(L.hazeSun[0], L.hazeSun[1], L.hazeSun[2]);
    WorldUniforms.atmos.y = L.hazeFalloff;
    WorldUniforms.atmos.z = this.def.liquid.kind === "none" ? 0 : this.def.liquid.level;
    sunVector(this.sunDirection);
  }

  /** Everything Renderer.setWorld needs for this planet. */
  rendererWorld(): RendererWorld {
    const c = this.skyColors;
    return { sun: this.sun, ambient: this.ambient, skyMesh: this.sky.mesh, sky: { zenith: c.zenith, horizon: c.horizon, ground: c.ground, sun: c.sun, sunDir: this.sunDirection }, lighting: { ...this.lighting } };
  }

  setDecorDensity(decor: number, grass: number, distance: number): void {
    const reach: Record<string, number> = {
      "gf-grass": 0.5,
      "gf-pebbles": 0.55,
      "gf-spikes": 0.75,
      "gf-glowcaps": 0.8,
      "gf-fronds": 1,
      "gf-flowers": 0.6,
      "gf-snowtufts": 0.6,
      "gf-frost": 0.7,
      "gf-shrubs": 0.9,
      "gf-embers": 0.9,
      "gf-shards": 0.75,
      "gf-sails": 1,
      "gf-bulbs": 0.9,
      "gf-thorns": 0.9,
      "gf-vents": 0.9,
    };
    for (const f of this.scatter) {
      f.setDensity(f.name === "gf-grass" ? grass : decor);
      f.setCullDistance(distance * (reach[f.name] ?? 1));
    }
  }

  setPropLod(high: number, cull: number, terrainLod: number): void {
    if (this.lod.high === high && this.lod.cull === cull && this.lod.terrain === terrainLod) return;
    this.lod = { high, cull, terrain: terrainLod };
    this.propSources.forEach((src, i) => {
      for (const l of [...src.getLODLevels()]) src.removeLODLevel(l.mesh as Mesh);
      const low = this.propLowLods[i];
      const k = this.propLodScale[i] ?? { high: 1, cull: 1 };
      if (low && high > 0) src.addLODLevel(high * k.high, low);
      src.addLODLevel(cull * k.cull, null);
    });
    for (const c of this.terrainChunks) {
      for (const l of [...c.getLODLevels()]) c.removeLODLevel(l.mesh as Mesh);
      const low = c.metadata?.low as Mesh | undefined;
      if (low) c.addLODLevel(terrainLod, low);
    }
  }

  setWater(reflections: boolean, waves: boolean): void {
    this.waterWaves = waves;
    void reflections;
  }

  shadowReceivers(): AbstractMesh[] {
    const out: AbstractMesh[] = [];
    for (const c of this.terrainChunks) out.push(c, ...(c.metadata?.low ? [c.metadata.low as Mesh] : []));
    out.push(...this.propSources, ...this.propLowLods);
    return out;
  }

  // ---------------------------------------------------------------- materials

  /** Planet-owned library material (released on dispose). */
  private mat(name: string, look: Look): GfMaterial {
    const m = this.lib.make(name, look);
    this.gfMats.push(m);
    return m;
  }

  private std(name: string, emissive: Color3, opts: { alpha?: number; fog?: boolean } = {}): StandardMaterial {
    const m = new StandardMaterial(name, this.scene);
    m.emissiveColor = emissive;
    m.disableLighting = true;
    if (opts.alpha !== undefined) m.alpha = opts.alpha;
    if (opts.fog === false) m.fogEnabled = false;
    return m;
  }

  private bindPart = (m: Mesh, mat: PartMat): void => {
    if (mat instanceof StandardMaterial) m.material = mat;
    else this.lib.bind(m, mat);
  };

  // ---------------------------------------------------------------- terrain

  private terrainColor(x: number, z: number, h: number, ny: number): V3 {
    const n = this.noise;
    const P = this.def.palette;
    const v = n.fbm(x / 45, z / 45, 3);
    const v2 = n.noise2(x / 9, z / 9);
    const Lq = this.def.liquid.level;
    let c = mix3(P.low, P.mid, smoothstep(-0.2, 0.35, v + (h - 2) * 0.03));
    c = mix3(c, P.basin, smoothstep(Lq + 3, Lq - 4, h) * 0.75);
    const sw = this.look.shoreWidth;
    if (sw > 0) c = mix3(c, this.look.shore, smoothstep(Lq + sw + 1.2, Lq + 0.4, h + v * 0.8) * smoothstep(Lq - 2.5, Lq - 0.2, h));
    const steep = smoothstep(0.86, 0.68, ny);
    c = mix3(c, P.rock, steep);
    c = mix3(c, P.peak, smoothstep(terrainNum(this.def, "peakStart", 70), terrainNum(this.def, "peakEnd", 130), h + v * 20) * (1 - steep * 0.6));
    if (this.def.biome === "frozen") {
      // Snow settles on every gentle slope; wind-scoured blue ice on the steep ones.
      const snow = smoothstep(0.78, 0.9, ny) * (0.75 + 0.25 * v2);
      c = mix3(c, P.low, snow * 0.85);
    } else if (this.def.biome === "exotic") {
      // Banded sandstone strata on the terraces.
      const band = 0.5 + 0.5 * Math.sin(h * 0.9 + v * 2);
      c = mix3(c, [P.rock[0] * 1.25, P.rock[1] * 1.1, P.rock[2] * 1.05], band * steep * 0.55);
    } else if (this.def.biome === "hostile") {
      c = mix3(c, [0.24, 0.07, 0.06], smoothstep(0.55, 0.9, v2) * steep * 0.5);
    }
    const k = 0.9 + v2 * 0.1;
    return [c[0] * k, c[1] * k, c[2] * k];
  }

  /** One chunk mesh at `step` resolution with a skirt that hides LOD cracks. */
  private chunkMesh(ci: number, cj: number, step: number, skirt: number): Mesh {
    const hf = this.heightfield;
    const n = hf.res + 1;
    const per = hf.res / CHUNKS;
    const i0 = ci * per, j0 = cj * per;
    const cnt = per / step + 1;
    const pos: number[] = [], nrm: number[] = [], col: number[] = [], idx: number[] = [];
    const vert = (i: number, j: number, drop: number) => {
      const h = hf.heights[j * n + i];
      const x = -hf.half + i * hf.cell, z = -hf.half + j * hf.cell;
      const nn = hf.vertexNormal(i, j);
      const c = this.terrainColor(x, z, h, nn[1]);
      pos.push(x, h - drop, z);
      nrm.push(nn[0], nn[1], nn[2]);
      col.push(c[0], c[1], c[2], 1);
      return pos.length / 3 - 1;
    };
    for (let b = 0; b < cnt; b++) for (let a = 0; a < cnt; a++) vert(i0 + a * step, j0 + b * step, 0);
    for (let b = 0; b < cnt - 1; b++)
      for (let a = 0; a < cnt - 1; a++) {
        const p = b * cnt + a, q = p + 1, r = p + cnt, s = r + 1;
        idx.push(p, q, s, p, s, r);
      }
    if (skirt > 0) {
      const edge = (list: [number, number][], flip: boolean) => {
        const base = list.map(([a, b]) => b * cnt + a);
        const low = list.map(([a, b]) => vert(i0 + a * step, j0 + b * step, skirt));
        for (let k = 0; k < list.length - 1; k++) {
          const t = [base[k], base[k + 1], low[k + 1], base[k], low[k + 1], low[k]];
          idx.push(...(flip ? [t[0], t[2], t[1], t[3], t[5], t[4]] : t));
        }
      };
      const L = (f: (k: number) => [number, number]) => Array.from({ length: cnt }, (_, k) => f(k));
      edge(L((k) => [k, 0]), true);
      edge(L((k) => [k, cnt - 1]), false);
      edge(L((k) => [0, k]), false);
      edge(L((k) => [cnt - 1, k]), true);
    }
    const vd = new VertexData();
    vd.positions = pos;
    vd.normals = nrm;
    vd.colors = col;
    vd.indices = idx;
    const mesh = new Mesh(`gf-terrain-${ci}-${cj}-s${step}`, this.scene);
    vd.applyToMesh(mesh, false);
    mesh.isPickable = false;
    mesh.freezeWorldMatrix();
    return mesh;
  }

  private buildTerrain(): void {
    const L = this.look;
    const mat = this.legacy
      ? this.mat("terrain", { albedo: new Color3(1, 1, 1), roughness: 0.94, vertexColors: true, world: { terrain: true, triplanar: true, atmosphere: true } })
      : this.mat(`terrain-${this.def.id}`, {
          albedo: new Color3(1, 1, 1),
          roughness: L.terrainRoughness,
          vertexColors: true,
          world: { terrain: true, triplanar: true, atmosphere: true, ...(L.sparkle > 0 ? { sparkle: L.sparkle } : {}) },
        });
    for (let cj = 0; cj < CHUNKS; cj++)
      for (let ci = 0; ci < CHUNKS; ci++) {
        const hi = this.chunkMesh(ci, cj, 1, 0);
        const lo = this.chunkMesh(ci, cj, 2, 3);
        hi.metadata = { low: lo };
        this.lib.bind(hi, mat);
        this.lib.bind(lo, mat);
        lo.setEnabled(true);
        this.terrainChunks.push(hi);
      }
  }

  private buildLiquid(): void {
    const kind = this.def.liquid.kind;
    if (kind === "none") return;
    const size = this.def.terrainSize;
    const m = MeshBuilder.CreateGround("gf-liquid", { width: size * 1.1, height: size * 1.1, subdivisions: 2 }, this.scene);
    m.position.y = this.def.liquid.level;
    const L = this.look;
    let mat: GfMaterial;
    if (this.legacy) {
      mat = this.mat("liquid", {
        albedo: new Color3(0.05, 0.2, 0.26),
        roughness: 0.07,
        metallic: 0,
        emissive: new Color3(0.03, 0.28, 0.32),
        alpha: 0.88,
        maps: "water",
        mapScale: 70,
        world: { atmosphere: true },
      });
    } else if (kind === "lava") {
      const ts = 128;
      this.lavaTex = makeTexture(this.scene, `gf-lava-${this.def.id}`, lavaTexture(ts, this.def.seed & 0xffff), ts, false);
      this.lavaTex.uScale = this.lavaTex.vScale = (size * 1.1) / 46;
      mat = this.mat(`liquid-${this.def.id}`, {
        albedo: c3(L.liquidAlbedo),
        roughness: L.liquidRoughness,
        metallic: 0,
        emissive: c3(L.liquidEmissive).scale(0.35),
        emissiveMap: this.lavaTex,
        emissiveMapLevel: 1.9,
        world: { atmosphere: true },
      });
    } else {
      mat = this.mat(`liquid-${this.def.id}`, {
        albedo: c3(L.liquidAlbedo),
        roughness: L.liquidRoughness,
        metallic: kind === "ice" ? 0.05 : 0,
        emissive: c3(L.liquidEmissive),
        alpha: L.liquidAlpha,
        maps: "water",
        mapScale: kind === "ice" ? 34 : 70,
        envIntensity: kind === "water" ? 1.35 : 1.1,
        world: { atmosphere: true },
      });
    }
    this.lib.bind(m, mat);
    m.isPickable = false;
    m.freezeWorldMatrix();
    this.water = m;
  }

  /** Far mountain silhouettes around the play area (no fog, pre-hazed colour). */
  private buildBackdrop(): void {
    const seg = 180, rings = 5, r0 = 1500, r1 = 2700;
    const positions: number[] = [];
    const indices: number[] = [];
    const n = this.noise;
    const hk = this.look.backdropHeight;
    for (let ri = 0; ri <= rings; ri++) {
      const t = ri / rings;
      const r = r0 + (r1 - r0) * t;
      for (let s = 0; s <= seg; s++) {
        const a = (s / seg) * Math.PI * 2;
        const ridge = n.ridged(Math.cos(a) * 3 + t * 0.8, Math.sin(a) * 3 + t * 0.8, 5);
        positions.push(Math.cos(a) * r, -40 + Math.sin(t * Math.PI) * (180 + ridge * 520) * hk, Math.sin(a) * r);
      }
    }
    for (let ri = 0; ri < rings; ri++)
      for (let s = 0; s < seg; s++) {
        const a = ri * (seg + 1) + s, b = a + 1, c = a + seg + 1, d = c + 1;
        indices.push(a, b, d, a, d, c);
      }
    const vd = new VertexData();
    vd.positions = positions;
    vd.indices = indices;
    const normals: number[] = [];
    VertexData.ComputeNormals(positions, indices, normals);
    vd.normals = normals;
    const mesh = new Mesh("gf-backdrop", this.scene);
    vd.applyToMesh(mesh);
    const mat = new StandardMaterial("gf-backdrop-mat", this.scene);
    mat.diffuseColor = c3(this.look.backdrop);
    mat.emissiveColor = this.skyColors.horizon.scale(this.look.backdropGlow);
    mat.specularColor = Color3.Black();
    mat.fogEnabled = false;
    mat.backFaceCulling = false;
    mesh.material = mat;
    mesh.applyFog = false;
    mesh.isPickable = false;
    mesh.freezeWorldMatrix();
  }

  // ---------------------------------------------------------------- mesh generators

  /** Smooth, multi-octave displaced rock. `colorize` paints vertex colours. */
  private rockMesh(name: string, seed: number, subdivisions: number, colorize: (x: number, y: number, z: number) => [number, number, number]): Mesh {
    const m = MeshBuilder.CreateIcoSphere(name, { radius: 1, subdivisions: Math.max(1, subdivisions), flat: subdivisions <= 1 }, this.scene);
    const pos = m.getVerticesData("position")!;
    const n = new SimplexNoise(seed);
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i], y = pos[i + 1], z = pos[i + 2];
      let d = 1 + (n.noise2(x * 1.3 + y, z * 1.3 - y) + n.noise2(y * 1.1 + 7, x * 1.1 - z)) * 0.14;
      d += (n.noise2(x * 3.7 + 11, z * 3.7 + y * 2) * 0.05 + n.noise2(y * 4.1, x * 4.1 + 3) * 0.035);
      let yy = y * d * 0.74;
      // Flattened, slightly sheared top facets read as weathered strata.
      if (yy > 0.52) yy = 0.52 + (yy - 0.52) * 0.35;
      if (yy < -0.35) yy = -0.35 + (yy + 0.35) * 0.3;
      pos[i] = x * d;
      pos[i + 1] = yy;
      pos[i + 2] = z * d;
    }
    m.setVerticesData("position", pos);
    const colors: number[] = [];
    for (let i = 0; i < pos.length; i += 3) {
      const c = colorize(pos[i], pos[i + 1], pos[i + 2]);
      colors.push(c[0], c[1], c[2], 1);
    }
    m.setVerticesData("color", colors);
    const normals: number[] = [];
    VertexData.ComputeNormals(pos, m.getIndices()!, normals);
    m.setVerticesData("normal", normals);
    m.isPickable = false;
    return m;
  }

  /** Hexagonal crystal cluster with bevelled tips on a rock socket. */
  private crystalMesh(name: string, shards: number, seed: number, tall: number, detail: number): Mesh {
    const rng = createRng(seed);
    const parts: Mesh[] = [];
    for (let i = 0; i < shards; i++) {
      const h = (0.8 + rng() * 1.2) * tall;
      const r = 0.16 + rng() * 0.16;
      const body = MeshBuilder.CreateCylinder(`${name}-s${i}`, { height: h, diameterTop: r * 1.5, diameterBottom: r * 2, tessellation: 6, subdivisions: detail }, this.scene);
      const tip = MeshBuilder.CreateCylinder(`${name}-t${i}`, { height: r * 2.6, diameterTop: r * 0.25, diameterBottom: r * 1.5, tessellation: 6 }, this.scene);
      tip.position.y = h / 2 + r * 1.3;
      const shard = Mesh.MergeMeshes([body, tip], true)!;
      shard.position.y = h / 2;
      shard.bakeCurrentTransformIntoVertices();
      shard.rotation.z = (rng() - 0.5) * 0.9;
      shard.rotation.x = (rng() - 0.5) * 0.9;
      shard.rotation.y = rng() * 6.28;
      shard.position.x = (rng() - 0.5) * 0.7;
      shard.position.z = (rng() - 0.5) * 0.7;
      parts.push(shard);
    }
    const merged = Mesh.MergeMeshes(parts, true)!;
    merged.isPickable = false;
    return merged;
  }

  private paint(m: Mesh, c: [number, number, number], tip?: [number, number, number]): void {
    const pos = m.getVerticesData("position")!;
    let maxY = -Infinity, minY = Infinity;
    for (let i = 1; i < pos.length; i += 3) {
      maxY = Math.max(maxY, pos[i]);
      minY = Math.min(minY, pos[i]);
    }
    const arr: number[] = [];
    for (let i = 0; i < pos.length; i += 3) {
      const t = tip ? (pos[i + 1] - minY) / Math.max(1e-3, maxY - minY) : 0;
      const k = tip ? t * t : 0;
      arr.push(c[0] + ((tip?.[0] ?? 0) - c[0]) * k, c[1] + ((tip?.[1] ?? 0) - c[1]) * k, c[2] + ((tip?.[2] ?? 0) - c[2]) * k, 1);
    }
    m.setVerticesData("color", arr);
  }

  /**
   * Merges procedural parts after normalising their vertex attributes (Babylon refuses to merge
   * meshes with different attribute sets, e.g. a sphere with UVs and a hand-built mesh without).
   */
  private mergeParts(parts: Mesh[]): Mesh {
    for (const m of parts) {
      const n = m.getTotalVertices();
      if (!m.isVerticesDataPresent("uv")) m.setVerticesData("uv", new Array(n * 2).fill(0));
      if (!m.isVerticesDataPresent("color")) m.setVerticesData("color", new Array(n * 4).fill(1));
      for (const kind of ["uv2", "tangent", "matricesIndices", "matricesWeights"]) if (m.isVerticesDataPresent(kind)) m.removeVerticesData(kind);
    }
    return Mesh.MergeMeshes(parts, true, true)!;
  }

  /** Bakes a part's transform and paints it, ready for merging. */
  private part(m: Mesh, c: V3, tip?: V3): Mesh {
    m.bakeCurrentTransformIntoVertices();
    this.paint(m, c, tip);
    return m;
  }

  /** Bulb-flora (carbon source): curved stem, veined bulb and drooping leaves. */
  private floraMesh(name: string, tint?: { stem: V3; bulb: V3; tip: V3; leaf: V3 }): Mesh {
    const T = tint ?? { stem: [0.16, 0.34, 0.27], bulb: [0.35, 0.8, 0.48], tip: [0.75, 1.0, 0.7], leaf: [0.14, 0.4, 0.34] };
    const path = Array.from({ length: 7 }, (_, i) => new Vector3(Math.sin(i * 0.3) * 0.12, i * 0.27, 0));
    const stem = MeshBuilder.CreateTube(`${name}-stem`, { path, radiusFunction: (i) => 0.13 - i * 0.012, tessellation: 7, cap: 1 }, this.scene);
    const bulb = MeshBuilder.CreateSphere(`${name}-bulb`, { diameter: 1.05, segments: 10 }, this.scene);
    bulb.position.set(Math.sin(1.8) * 0.12, 1.92, 0);
    bulb.scaling.y = 1.25;
    const ring = MeshBuilder.CreateTorus(`${name}-ring`, { diameter: 0.7, thickness: 0.12, tessellation: 14 }, this.scene);
    ring.position.copyFrom(bulb.position).addInPlaceFromFloats(0, -0.5, 0);
    const leaves: Mesh[] = [];
    for (let i = 0; i < 5; i++) {
      const leaf = MeshBuilder.CreateSphere(`${name}-leaf${i}`, { diameter: 1, segments: 6 }, this.scene);
      leaf.scaling.set(1.05, 0.1, 0.36);
      const a = (i / 5) * Math.PI * 2;
      leaf.position.set(Math.cos(a) * 0.5, 0.16, Math.sin(a) * 0.5);
      leaf.rotation.set(0, -a, -0.35);
      leaves.push(leaf);
    }
    this.paint(stem, T.stem, [0.3, 0.55, 0.4]);
    this.paint(bulb, T.bulb, T.tip);
    this.paint(ring, [0.22, 0.5, 0.34]);
    leaves.forEach((l) => this.paint(l, T.leaf));
    const m = Mesh.MergeMeshes([stem, bulb, ring, ...leaves], true)!;
    m.isPickable = false;
    return m;
  }

  /** Arching ribbon leaves (six per frond by default, 8 triangles each). */
  private frondMesh(opts?: { name?: string; leaves?: number; len?: number; width?: number; base?: V3; delta?: V3 }): Mesh {
    const nL = opts?.leaves ?? 6, baseLen = opts?.len ?? 1.6, wd = opts?.width ?? 0.16;
    const B = opts?.base ?? [0.22, 0.2, 0.4], D = opts?.delta ?? [0.23, 0.55, 0.3];
    const pos: number[] = [], col: number[] = [], idx: number[] = [], nrm: number[] = [];
    for (let i = 0; i < nL; i++) {
      const a = (i / nL) * Math.PI * 2 + 0.3;
      const len = baseLen + (i % 3) * 0.35 * (baseLen / 1.6);
      const dx = Math.cos(a), dz = Math.sin(a);
      const px = -dz, pz = dx;
      const base = pos.length / 3;
      for (let k = 0; k <= 4; k++) {
        const t = k / 4;
        const r = t * len * 0.7;
        const y = Math.sin(t * Math.PI * 0.75) * len * 0.75;
        const w = wd * Math.sin((t * 0.85 + 0.1) * Math.PI);
        pos.push(dx * r - px * w, y, dz * r - pz * w, dx * r + px * w, y, dz * r + pz * w);
        const c = [B[0] + t * D[0], B[1] + t * D[1], B[2] + t * D[2]];
        col.push(c[0], c[1], c[2], 1, c[0], c[1], c[2], 1);
        nrm.push(0, 1, 0, 0, 1, 0);
      }
      for (let k = 0; k < 4; k++) {
        const i0 = base + k * 2;
        idx.push(i0, i0 + 1, i0 + 3, i0, i0 + 3, i0 + 2);
      }
    }
    const vd = new VertexData();
    vd.positions = pos;
    vd.colors = col;
    vd.indices = idx;
    vd.normals = nrm;
    const m = new Mesh(opts?.name ?? "gf-frond-src", this.scene);
    vd.applyToMesh(m);
    m.isPickable = false;
    return m;
  }

  private glowCapMesh(stalkC: V3 = [0.3, 0.28, 0.4], capC: V3 = [0.45, 0.85, 1.0]): Mesh {
    const parts: Mesh[] = [];
    const rng = createRng(91);
    for (let i = 0; i < 4; i++) {
      const h = 0.35 + rng() * 0.6;
      const stalk = MeshBuilder.CreateCylinder(`cap-s${i}`, { height: h, diameterTop: 0.05, diameterBottom: 0.08, tessellation: 4 }, this.scene);
      stalk.position.set((rng() - 0.5) * 0.6, h / 2, (rng() - 0.5) * 0.6);
      const capM = MeshBuilder.CreateSphere(`cap-c${i}`, { diameter: 0.34 + rng() * 0.2, segments: 4, slice: 0.5 }, this.scene);
      capM.position.set(stalk.position.x, h, stalk.position.z);
      capM.scaling.y = 0.6;
      this.paint(stalk, stalkC);
      this.paint(capM, capC);
      parts.push(stalk, capM);
    }
    const m = Mesh.MergeMeshes(parts, true)!;
    m.isPickable = false;
    return m;
  }

  private grassMesh(base: V3 = [0.16, 0.38, 0.34], delta: V3 = [0.32, 0.42, 0.24], height = 1): Mesh {
    const pos: number[] = [], col: number[] = [], idx: number[] = [], nrm: number[] = [];
    const rng = createRng(17);
    for (let b = 0; b < 6; b++) {
      const a = rng() * Math.PI * 2;
      const r = rng() * 0.18;
      const bx = Math.cos(a) * r, bz = Math.sin(a) * r;
      const lean = (rng() - 0.5) * 0.5;
      const h = (0.4 + rng() * 0.35) * height;
      const w = 0.075;
      const px = Math.cos(a + 1.57), pz = Math.sin(a + 1.57);
      const base0 = pos.length / 3;
      for (let k = 0; k <= 2; k++) {
        const t = k / 2;
        const ww = w * (1.15 - t);
        const cx = bx + Math.cos(a) * lean * t * t, cz = bz + Math.sin(a) * lean * t * t;
        pos.push(cx - px * ww, h * t, cz - pz * ww, cx + px * ww, h * t, cz + pz * ww);
        const c = [base[0] + t * delta[0], base[1] + t * delta[1], base[2] + t * delta[2]];
        col.push(c[0], c[1], c[2], 1, c[0], c[1], c[2], 1);
        nrm.push(0, 1, 0, 0, 1, 0);
      }
      for (let k = 0; k < 2; k++) {
        const i0 = base0 + k * 2;
        idx.push(i0, i0 + 1, i0 + 3, i0, i0 + 3, i0 + 2);
      }
    }
    const vd = new VertexData();
    vd.positions = pos;
    vd.colors = col;
    vd.indices = idx;
    vd.normals = nrm;
    const m = new Mesh("gf-grass-src", this.scene);
    vd.applyToMesh(m);
    m.isPickable = false;
    return m;
  }

  /** Three small flowers (stem ribbons + petal fans) in mixed colours. */
  private flowerMesh(petals: V3[]): Mesh {
    const pos: number[] = [], col: number[] = [], idx: number[] = [], nrm: number[] = [];
    const rng = createRng(29);
    for (let f = 0; f < 3; f++) {
      const bx = (rng() - 0.5) * 0.5, bz = (rng() - 0.5) * 0.5;
      const h = 0.35 + rng() * 0.3;
      const pc = petals[f % petals.length];
      let b0 = pos.length / 3;
      pos.push(bx - 0.02, 0, bz, bx + 0.02, 0, bz, bx - 0.012, h, bz, bx + 0.012, h, bz);
      for (let k = 0; k < 4; k++) col.push(0.2, 0.42 + k * 0.04, 0.24, 1), nrm.push(0, 1, 0);
      idx.push(b0, b0 + 1, b0 + 3, b0, b0 + 3, b0 + 2);
      b0 = pos.length / 3;
      pos.push(bx, h + 0.02, bz);
      col.push(pc[0] * 1.3, pc[1] * 1.3, pc[2] * 1.3, 1);
      nrm.push(0, 1, 0);
      const np = 6;
      for (let p = 0; p < np; p++) {
        const a = (p / np) * Math.PI * 2;
        pos.push(bx + Math.cos(a) * 0.12, h + 0.05, bz + Math.sin(a) * 0.12);
        col.push(pc[0], pc[1], pc[2], 1);
        nrm.push(0, 1, 0);
      }
      for (let p = 0; p < np; p++) idx.push(b0, b0 + 1 + p, b0 + 1 + ((p + 1) % np));
    }
    const vd = new VertexData();
    vd.positions = pos;
    vd.colors = col;
    vd.indices = idx;
    vd.normals = nrm;
    const m = new Mesh("gf-flower-src", this.scene);
    vd.applyToMesh(m);
    m.isPickable = false;
    return m;
  }

  /** Spiky cluster of thin cones (shrubs, thorns, frost, obsidian shards, basalt spikes). */
  private spikeCluster(name: string, seed: number, count: number, h: [number, number], r: number, spread: number, lean: number, c: V3, tip: V3, tess = 4): Mesh {
    const rng = createRng(seed);
    const parts: Mesh[] = [];
    for (let i = 0; i < count; i++) {
      const hh = h[0] + rng() * (h[1] - h[0]);
      const m = MeshBuilder.CreateCylinder(`${name}-${i}`, { height: hh, diameterTop: 0, diameterBottom: r * (0.6 + rng() * 0.8), tessellation: tess }, this.scene);
      m.position.y = hh / 2;
      m.bakeCurrentTransformIntoVertices();
      m.rotation.set((rng() - 0.5) * lean, rng() * 6.28, (rng() - 0.5) * lean);
      m.position.set((rng() - 0.5) * spread, 0, (rng() - 0.5) * spread);
      parts.push(this.part(m, c, tip));
    }
    const out = Mesh.MergeMeshes(parts, true)!;
    out.name = name;
    out.isPickable = false;
    return out;
  }

  /** Tube along a path with vertex colours, optionally noise-displaced. */
  private tubeMesh(name: string, path: Vector3[], radius: (t: number) => number, tess: number, c: V3, tip?: V3, wobble = 0, seed = 1): Mesh {
    const m = MeshBuilder.CreateTube(name, { path, radiusFunction: (i) => radius(i / Math.max(1, path.length - 1)), tessellation: tess, cap: 3 }, this.scene);
    if (wobble > 0) {
      const n = new SimplexNoise(seed);
      const pos = m.getVerticesData("position")!;
      for (let i = 0; i < pos.length; i += 3) {
        const x = pos[i], y = pos[i + 1], z = pos[i + 2];
        pos[i] += n.noise2(y * 0.35 + z * 0.2, x * 0.3) * wobble;
        pos[i + 1] += n.noise2(x * 0.3 + 5, z * 0.3) * wobble * 0.6;
        pos[i + 2] += n.noise2(x * 0.25 - 3, y * 0.35) * wobble;
      }
      m.setVerticesData("position", pos);
      const normals: number[] = [];
      VertexData.ComputeNormals(pos, m.getIndices()!, normals);
      m.setVerticesData("normal", normals);
    }
    this.paint(m, c, tip);
    m.isPickable = false;
    return m;
  }

  /** Natural arch: thick displaced tube over a half circle, legs sunk into the ground. */
  private archMesh(name: string, span: number, height: number, thick: number, seed: number, c: V3, tip: V3, tess = 10, steps = 16): Mesh {
    const path = Array.from({ length: steps + 1 }, (_, i) => {
      const a = Math.PI * (i / steps);
      return new Vector3(-Math.cos(a) * span * 0.5, Math.sin(a) * height - 3, 0);
    });
    return this.tubeMesh(name, path, (t) => thick * (1.3 - 0.55 * Math.sin(t * Math.PI)), tess, c, tip, thick * 0.35, seed);
  }

  // ---------------------------------------------------------------- placement

  private findSpot(rng: Rng, opts: SpotOpts): { x: number; z: number } | null {
    const fn = this.heightFn;
    const cx = opts.cx ?? 0;
    const cz = opts.cz ?? 0;
    const level = this.legacy ? WORLD.liquidLevel : this.def.liquid.level;
    for (let t = 0; t < (opts.tries ?? 12); t++) {
      const a = rng() * Math.PI * 2;
      const r = (opts.minR ?? 0) + Math.sqrt(rng()) * (opts.maxR - (opts.minR ?? 0));
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      const h = fn(x, z);
      if (h < level + 0.6) continue;
      const e = 2;
      const nx = fn(x - e, z) - fn(x + e, z);
      const nz = fn(x, z - e) - fn(x, z + e);
      const ny = (2 * e) / Math.hypot(nx, 2 * e, nz);
      if (ny < (opts.minNy ?? 0.82)) continue;
      const s = this.legacy ? WORLD.surveySite : this.def.landingSite;
      if (opts.avoidSite && Math.hypot(x - s.x, z - s.z) < opts.avoidSite) continue;
      if (Math.hypot(x, z) > 600) continue;
      if (!this.legacy) {
        if (opts.minH !== undefined && h < opts.minH) continue;
        if (opts.maxH !== undefined && h > opts.maxH) continue;
        if (this.keepClear.some((k) => Math.hypot(x - k.x, z - k.z) < k.r)) continue;
      }
      return { x, z };
    }
    return null;
  }

  /** Registers a prop source with a cheap far LOD. `lod` scales the LOD/cull distances for big props. */
  private propSource(hi: Mesh, lo: Mesh, mat: GfMaterial, lod?: { high: number; cull: number }): void {
    hi.isVisible = false;
    lo.isVisible = false;
    this.lib.bind(hi, mat);
    this.lib.bind(lo, mat);
    this.propSources.push(hi);
    this.propLowLods.push(lo);
    this.propLodScale.push(lod ?? { high: 1, cull: 1 });
  }

  /** Instances a prop source at a spot (sunk by `sink`·scale), with an optional cylinder collider. */
  private instance(src: Mesh, name: string, x: number, z: number, scale: V3, yaw: number, sink: number, collider?: { r: number; top: number }, y?: number): InstancedMesh {
    const inst = src.createInstance(name);
    const gy = y ?? this.groundAt(x, z);
    inst.position.set(x, gy - sink * scale[1], z);
    inst.scaling.set(scale[0], scale[1], scale[2]);
    inst.rotation.y = yaw;
    inst.isPickable = false;
    inst.freezeWorldMatrix();
    if (collider) this.addCollider({ x, z, r: collider.r, top: gy + collider.top });
    return inst;
  }

  private scatterField(name: string, src: Mesh, mat: GfMaterial, rng: Rng, count: number, opts: SpotOpts, make: (x: number, y: number, z: number) => [number, number, number, number, number] | null): void {
    const mtx = new Matrix();
    const quat = new Quaternion();
    const out: Float32Array[] = [];
    for (let i = 0; i < count; i++) {
      const p = this.findSpot(rng, opts);
      if (!p) continue;
      const y = this.groundAt(p.x, p.z);
      const r = make(p.x, y, p.z);
      if (!r) continue;
      const [sx, sy, sz, yaw, sink] = r;
      Quaternion.RotationYawPitchRollToRef(yaw, (rng() - 0.5) * 0.25, (rng() - 0.5) * 0.25, quat);
      Matrix.ComposeToRef(new Vector3(sx, sy, sz), quat, new Vector3(p.x, y - sink, p.z), mtx);
      out.push(new Float32Array(mtx.toArray()));
    }
    src.name = `${name}-src`;
    this.scatter.push(new ScatterField(name, src, out, this.lib, mat, rng, this.def.terrainSize));
  }

  // ---------------------------------------------------------------- Veyra-7 (legacy, bit-identical to M2)

  /**
   * Boulders replay M1's random sequence (as at the Medium preset) so they sit
   * exactly where M1 players saw them, independent of the graphics tier.
   */
  private buildBoulders(): void {
    const rng = createRng(WORLD.seed + 101);
    for (let i = 0; i < 1400; i++) {
      const p = this.findSpot(rng, { maxR: 520, minNy: 0.7, tries: 4 });
      if (!p) continue;
      rng();
      rng();
      rng();
      rng();
      rng();
    }
    const tint = (x: number, y: number): [number, number, number] => {
      const t = clamp(y * 0.5 + 0.5, 0, 1);
      return [0.3 + t * 0.12 + x * 0.01, 0.27 + t * 0.08, 0.36 + t * 0.1];
    };
    const hi = this.rockMesh("gf-boulder", 9, 3, tint);
    const lo = this.rockMesh("gf-boulder-lo", 9, 1, tint);
    const mat = this.mat("boulder", { albedo: new Color3(1, 1, 1), roughness: 0.88, vertexColors: true, world: { terrain: true, triplanar: true, rock: 0.85, atmosphere: true } });
    this.propSource(hi, lo, mat);
    for (let i = 0; i < 150; i++) {
      const p = this.findSpot(rng, { maxR: 600, minNy: 0.72, avoidSite: 40 });
      if (!p) continue;
      const s = rngRange(rng, 1.8, 6.5);
      const inst = hi.createInstance(`gf-boulder-${i}`);
      const y = this.groundAt(p.x, p.z);
      inst.position.set(p.x, y + s * 0.25, p.z);
      inst.scaling.set(s * rngRange(rng, 0.8, 1.3), s * rngRange(rng, 0.7, 1.2), s * rngRange(rng, 0.8, 1.3));
      inst.rotation.y = rng() * 6.28;
      inst.isPickable = false;
      inst.freezeWorldMatrix();
      this.addCollider({ x: p.x, z: p.z, r: s * 0.95, top: y + s * 0.95 });
    }
  }

  /** Decorative scatter: pebbles, spikes, alien fronds, glow caps, grass tufts. */
  private buildDecor(): void {
    const rng = createRng(WORLD.seed + 404);
    const mtx = new Matrix();
    const quat = new Quaternion();
    const place = (count: number, opts: SpotOpts, make: (x: number, y: number, z: number) => [number, number, number, number, number] | null) => {
      const out: Float32Array[] = [];
      for (let i = 0; i < count; i++) {
        const p = this.findSpot(rng, opts);
        if (!p) continue;
        const y = this.groundAt(p.x, p.z);
        const r = make(p.x, y, p.z);
        if (!r) continue;
        const [sx, sy, sz, yaw, sink] = r;
        Quaternion.RotationYawPitchRollToRef(yaw, (rng() - 0.5) * 0.25, (rng() - 0.5) * 0.25, quat);
        Matrix.ComposeToRef(new Vector3(sx, sy, sz), quat, new Vector3(p.x, y - sink, p.z), mtx);
        out.push(new Float32Array(mtx.toArray()));
      }
      return out;
    };

    // Pebbles
    const pebble = this.rockMesh("gf-pebble", 5, 0, (x, y) => [0.4 + y * 0.05, 0.34, 0.44]);
    const pebbleMat = this.mat("pebble", { albedo: new Color3(1, 1, 1), roughness: 0.9, vertexColors: true, world: { terrain: true, rock: 0.6, atmosphere: true } });
    this.scatter.push(new ScatterField("gf-pebbles", pebble, place(2600, { maxR: 560, minNy: 0.7, tries: 3 }, () => {
      const s = rngRange(rng, 0.12, 0.55);
      return [s * 1.2, s, s * 1.1, rng() * 6.28, s * 0.25];
    }), this.lib, pebbleMat, rng));

    // Crystal spikes
    const spike = MeshBuilder.CreateCylinder("gf-spike", { height: 1, diameterTop: 0, diameterBottom: 0.12, tessellation: 5 }, this.scene);
    spike.position.y = 0.5;
    spike.bakeCurrentTransformIntoVertices();
    this.paint(spike, [0.3, 0.5, 0.48], [0.62, 0.9, 0.85]);
    const spikeMat = this.mat("spike", { albedo: new Color3(1, 1, 1), roughness: 0.4, vertexColors: true, emissive: new Color3(0.03, 0.1, 0.09), world: { wind: 0.03, atmosphere: true } });
    this.scatter.push(new ScatterField("gf-spikes", spike, place(2200, { maxR: 540, minNy: 0.74, tries: 3 }, (x, y) => {
      if (y > 30) return null;
      const s = rngRange(rng, 0.5, 1.4);
      return [s, s, s, rng() * 6.28, 0.05];
    }), this.lib, spikeMat, rng));

    // Alien fronds (lowlands)
    const frond = this.frondMesh();
    const frondMat = this.mat("frond", { albedo: new Color3(1, 1, 1), roughness: 0.65, vertexColors: true, backFaceCulling: false, world: { wind: 0.05, atmosphere: true } });
    this.scatter.push(new ScatterField("gf-fronds", frond, place(900, { maxR: 520, minNy: 0.82, tries: 4 }, (x, y) => {
      if (y > 12) return null;
      const s = rngRange(rng, 0.8, 1.7);
      return [s, s * rngRange(rng, 0.8, 1.3), s, rng() * 6.28, 0.05];
    }), this.lib, frondMat, rng));

    // Glow caps near the luminous lakes
    const cap = this.glowCapMesh();
    const capMat = this.mat("glowcap", { albedo: new Color3(1, 1, 1), roughness: 0.5, vertexColors: true, emissive: new Color3(0.12, 0.24, 0.36), world: { wind: 0.015, atmosphere: true } });
    this.scatter.push(new ScatterField("gf-glowcaps", cap, place(1400, { maxR: 560, minNy: 0.78, tries: 5 }, (x, y) => {
      if (y > WORLD.liquidLevel + 6) return null;
      const s = rngRange(rng, 0.5, 1.2);
      return [s, s, s, rng() * 6.28, 0.02];
    }), this.lib, capMat, rng));

    // Grass tufts (Enhanced / Ultra)
    const tuft = this.grassMesh();
    const grassMat = this.mat("grass", { albedo: new Color3(1, 1, 1), roughness: 0.75, vertexColors: true, backFaceCulling: false, world: { wind: 0.16, atmosphere: true } });
    this.scatter.push(new ScatterField("gf-grass", tuft, place(14000, { maxR: 480, minNy: 0.86, tries: 2 }, (x, y, z) => {
      if (y > 20) return null;
      // Grass grows where the ground colour is mossy.
      const v = this.noise.fbm(x / 45, z / 45, 3);
      if (v + (y - 2) * 0.03 > 0.15) return null;
      const s = rngRange(rng, 0.6, 1.25);
      return [s, s * rngRange(rng, 0.7, 1.4), s, rng() * 6.28, 0.04];
    }), this.lib, grassMat, rng));
  }

  /** Shared deposit meshes (visual language is the same on every world). */
  private depositSources(): Record<ResourceId, Mesh> {
    const sfx = this.legacy ? "" : `-${this.def.id}`;
    const rock = this.def.palette.rock;
    const vein = this.legacy
      ? (x: number, y: number, z: number): [number, number, number] => (Math.sin(x * 5 + y * 3) * Math.cos(z * 4 - y * 2) > 0.35 ? [0.95, 0.46, 0.2] : [0.32, 0.26, 0.3])
      : (x: number, y: number, z: number): [number, number, number] =>
          Math.sin(x * 5 + y * 3) * Math.cos(z * 4 - y * 2) > 0.35 ? [0.95, 0.46, 0.2] : [rock[0] * 0.6 + 0.13, rock[1] * 0.6 + 0.1, rock[2] * 0.6 + 0.11];
    const ferriteHi = this.rockMesh("gf-ferrite", 21, 3, vein);
    const ferriteLo = this.rockMesh("gf-ferrite-lo", 21, 1, vein);
    this.propSource(ferriteHi, ferriteLo, this.mat(`ferrite${sfx}`, { albedo: new Color3(1, 1, 1), roughness: 0.55, metallic: 0.35, vertexColors: true, emissive: new Color3(0.06, 0.02, 0.0), world: { terrain: true, triplanar: true, rock: 0.6, atmosphere: true } }));

    const lumHi = this.crystalMesh("gf-lumenite", 7, 31, 1.2, 2);
    const lumLo = this.crystalMesh("gf-lumenite-lo", 4, 31, 1.2, 1);
    this.propSource(lumHi, lumLo, this.mat(`lumenite${sfx}`, { albedo: new Color3(0.25, 0.78, 0.92), roughness: 0.12, metallic: 0.05, emissive: new Color3(0.08, 0.58, 0.76), world: { atmosphere: true } }));

    const frosty = this.def.biome === "frozen";
    const ash = this.def.biome === "volcanic" || this.def.biome === "hostile";
    const tint = frosty
      ? { stem: [0.3, 0.42, 0.5] as V3, bulb: [0.55, 0.85, 0.9] as V3, tip: [0.9, 1, 1] as V3, leaf: [0.32, 0.46, 0.55] as V3 }
      : ash
        ? { stem: [0.24, 0.22, 0.16] as V3, bulb: [0.62, 0.78, 0.3] as V3, tip: [0.9, 1, 0.55] as V3, leaf: [0.22, 0.28, 0.14] as V3 }
        : undefined;
    const carbonHi = this.floraMesh("gf-carbon", tint);
    const carbonLo = this.floraMesh("gf-carbon-lo", tint);
    this.propSource(carbonHi, carbonLo, this.mat(`carbon${sfx}`, { albedo: new Color3(1, 1, 1), roughness: 0.6, vertexColors: true, emissive: new Color3(0.06, 0.16, 0.08), world: { wind: 0.05, atmosphere: true } }));

    const voidHi = this.crystalMesh("gf-void", 5, 41, 2.0, 2);
    const voidLo = this.crystalMesh("gf-void-lo", 3, 41, 2.0, 1);
    this.propSource(voidHi, voidLo, this.mat(`voidQuartz${sfx}`, { albedo: new Color3(0.5, 0.3, 0.8), roughness: 0.1, metallic: 0.1, emissive: new Color3(0.36, 0.12, 0.66), world: { atmosphere: true } }));

    return { ferrite: ferriteHi, lumenite: lumHi, carbon: carbonHi, voidQuartz: voidHi };
  }

  /** Creates one deposit (shared by the legacy and generic layouts; consumes one rng() for yaw). */
  private makeDeposit(sources: Record<ResourceId, Mesh>, rng: Rng, type: ResourceId, idx: number, x: number, z: number, scale: number, amount: number): void {
    const y = this.groundAt(x, z);
    const mesh = sources[type].createInstance(`gf-dep-${type}-${idx}`);
    const base = type === "ferrite" ? new Vector3(scale * 1.2, scale, scale * 1.1) : new Vector3(scale, scale, scale);
    mesh.position.set(x, y + (type === "ferrite" ? scale * 0.3 : -0.1), z);
    mesh.rotation.y = rng() * Math.PI * 2;
    mesh.scaling.copyFrom(base);
    mesh.isPickable = false;
    const radius = type === "ferrite" ? scale * 1.15 : type === "carbon" ? scale * 0.9 : scale * 0.95;
    const center = new Vector3(x, y + (type === "ferrite" ? scale * 0.4 : type === "voidQuartz" ? scale * 1.4 : scale * 0.9), z);
    const dep: Deposit = {
      id: runtimeId(this.def.id, `${type}-${idx}`),
      type,
      position: center,
      radius,
      amount,
      max: amount,
      carry: 0,
      mesh,
      baseScale: base,
      depletedAt: null,
      collider: type === "ferrite" ? { x, z, r: scale * 0.95, top: y + scale } : null,
    };
    if (dep.collider) this.addCollider(dep.collider);
    this.deposits.push(dep);
  }

  /**
   * Deposits keep M1's exact random sequence so every deposit id, position,
   * size and amount matches existing saves.
   */
  private buildDeposits(): void {
    const rng = createRng(WORLD.seed + 202);
    const site = WORLD.surveySite;
    const sources = this.depositSources();
    const make = (type: ResourceId, idx: number, x: number, z: number, scale: number, amount: number) => this.makeDeposit(sources, rng, type, idx, x, z, scale, amount);

    let li = 0, fi = 0, ci = 0, vi = 0;
    for (let i = 0; i < 22; i++) {
      const p = this.findSpot(rng, { cx: site.x, cz: site.z, minR: 16, maxR: 110, minNy: 0.8, tries: 20 });
      if (p) make("lumenite", li++, p.x, p.z, rngRange(rng, 0.9, 1.4), Math.round(rngRange(rng, 10, 18)));
    }
    for (let i = 0; i < 14; i++) {
      const p = this.findSpot(rng, { cx: site.x, cz: site.z, minR: 18, maxR: 110, minNy: 0.78, tries: 20 });
      if (p) make("ferrite", fi++, p.x, p.z, rngRange(rng, 1.1, 1.8), Math.round(rngRange(rng, 12, 22)));
    }
    for (let i = 0; i < 20; i++) {
      const p = this.findSpot(rng, { cx: site.x, cz: site.z, minR: 15, maxR: 120, minNy: 0.8, tries: 20 });
      if (p) make("carbon", ci++, p.x, p.z, rngRange(rng, 0.8, 1.3), Math.round(rngRange(rng, 6, 12)));
    }
    for (let i = 0; i < 5; i++) {
      const p = this.findSpot(rng, { cx: site.x + 70, cz: site.z - 55, maxR: 14, minNy: 0.6, tries: 20 });
      if (p) make("voidQuartz", vi++, p.x, p.z, rngRange(rng, 0.8, 1.1), Math.round(rngRange(rng, 3, 6)));
    }
    for (let i = 0; i < 60; i++) {
      const p = this.findSpot(rng, { maxR: 590, minNy: 0.8, avoidSite: 20 });
      if (p) make("lumenite", li++, p.x, p.z, rngRange(rng, 0.9, 1.6), Math.round(rngRange(rng, 10, 24)));
    }
    for (let i = 0; i < 80; i++) {
      const p = this.findSpot(rng, { maxR: 590, minNy: 0.76, avoidSite: 20 });
      if (p) make("ferrite", fi++, p.x, p.z, rngRange(rng, 1.1, 2.2), Math.round(rngRange(rng, 14, 32)));
    }
    for (let i = 0; i < 130; i++) {
      const p = this.findSpot(rng, { maxR: 560, minNy: 0.84, avoidSite: 20 });
      if (p && this.heightFn(p.x, p.z) < 25) make("carbon", ci++, p.x, p.z, rngRange(rng, 0.8, 1.5), Math.round(rngRange(rng, 6, 14)));
    }
    for (let i = 0; i < 18; i++) {
      const p = this.findSpot(rng, { maxR: 580, minNy: 0.6 });
      if (p && this.heightFn(p.x, p.z) < 0) make("voidQuartz", vi++, p.x, p.z, rngRange(rng, 0.8, 1.3), Math.round(rngRange(rng, 3, 7)));
    }
  }

  private buildPois(): void {
    const site = WORLD.surveySite;
    const L = this.lib;
    const metal = this.mat("poi-metal", { albedo: new Color3(0.58, 0.58, 0.64), roughness: 0.45, metallic: 0.8, maps: "hull", mapScale: 1, world: { atmosphere: true } });
    const stone = this.mat("poi-stone", { albedo: new Color3(0.1, 0.09, 0.13), roughness: 0.18, metallic: 0.2, emissive: new Color3(0.02, 0.01, 0.05), world: { atmosphere: true } });
    const glass = this.mat("poi-glass", { albedo: new Color3(0.4, 0.6, 0.9), roughness: 0.05, alpha: 0.72, emissive: new Color3(0.1, 0.25, 0.45), world: { atmosphere: true } });
    const glow = new StandardMaterial("gf-poi-glow", this.scene);
    glow.emissiveColor = new Color3(1, 0.55, 0.25);
    glow.disableLighting = true;
    const rune = new StandardMaterial("gf-poi-rune", this.scene);
    rune.emissiveColor = new Color3(0.55, 0.3, 1);
    rune.disableLighting = true;
    const voidM = new StandardMaterial("gf-poi-void", this.scene);
    voidM.diffuseColor = Color3.Black();
    voidM.specularColor = Color3.Black();
    voidM.disableLighting = true;

    const place = (id: string, name: string, x: number, z: number, lore: string, loot: PointOfInterest["loot"], build: (root: TransformNode) => void) => {
      const root = new TransformNode(`gf-poi-${id}`, this.scene);
      const y = this.groundAt(x, z);
      root.position.set(x, y, z);
      build(root);
      const d = this.def.pois.find((p) => p.id === id);
      this.pois.push({ id, name, position: new Vector3(x, y + 1.5, z), lore, loot, root, kind: d?.kind });
      this.addCollider({ x, z, r: 2.2, top: y + 3 });
    };

    place(
      "probe",
      "Derelict Survey Probe",
      site.x + 55,
      site.z + 70,
      "A pre-colony survey probe, power cell still faintly warm. Its log mentions 'violet crystals in the eastern crater'.",
      { ferrite: 20, lumenite: 10 },
      (root) => {
        const body = MeshBuilder.CreateCylinder("probe-body", { height: 2.4, diameter: 1.6, tessellation: 14 }, this.scene);
        body.rotation.z = 1.2;
        body.position.y = 0.9;
        const dish = MeshBuilder.CreateCylinder("probe-dish", { height: 0.2, diameterTop: 2.4, diameterBottom: 0.6, tessellation: 20 }, this.scene);
        dish.position.set(1.4, 1.6, 0.3);
        dish.rotation.z = -0.6;
        const light = MeshBuilder.CreateSphere("probe-light", { diameter: 0.35 }, this.scene);
        light.position.set(-0.9, 1.4, 0);
        light.material = glow;
        for (let i = 0; i < 3; i++) {
          const leg = MeshBuilder.CreateCylinder(`probe-leg${i}`, { height: 1.8, diameter: 0.12 }, this.scene);
          leg.position.set(Math.cos(i * 2.1) * 0.9, 0.5, Math.sin(i * 2.1) * 0.9);
          leg.rotation.set(Math.sin(i * 2.1) * 0.6, 0, -Math.cos(i * 2.1) * 0.6);
          L.bind(leg, metal);
          leg.parent = root;
        }
        L.bind(body, metal);
        L.bind(dish, metal);
        [body, dish, light].forEach((m) => (m.parent = root));
        this.beaconMeshes.push(light);
      },
    );

    place(
      "monolith",
      "Silent Monolith",
      190,
      -300,
      "Seamless obsidian. Faint glyphs trace an orbit around a dark centre — someone here once watched a black hole.",
      { voidQuartz: 3 },
      (root) => {
        const slab = MeshBuilder.CreateBox("mono", { width: 2.2, height: 9, depth: 0.8 }, this.scene);
        slab.position.y = 4.2;
        slab.rotation.z = 0.06;
        L.bind(slab, stone);
        slab.parent = root;
        const ring = MeshBuilder.CreateTorus("mono-ring", { diameter: 1.4, thickness: 0.08, tessellation: 32 }, this.scene);
        ring.position.set(0, 6.2, 0.42);
        ring.rotation.x = Math.PI / 2;
        ring.material = rune;
        ring.parent = root;
        const core = MeshBuilder.CreateDisc("mono-core", { radius: 0.35, tessellation: 24 }, this.scene);
        core.position.set(0, 6.2, 0.43);
        core.rotation.y = Math.PI;
        core.material = voidM;
        core.parent = root;
      },
    );

    place(
      "spires",
      "Glass Spire Garden",
      -380,
      150,
      "Hollow glass spires hum when wind passes through. Carbon-rich spores drift between them.",
      { carbon: 30, lumenite: 6 },
      (root) => {
        const rng = createRng(77);
        for (let i = 0; i < 9; i++) {
          const h = 5 + rng() * 9;
          const sp = MeshBuilder.CreateCylinder(`spire${i}`, { height: h, diameterTop: 0.05, diameterBottom: 0.9 + rng() * 0.6, tessellation: 6 }, this.scene);
          sp.position.set((rng() - 0.5) * 9, h / 2, (rng() - 0.5) * 9);
          sp.rotation.z = (rng() - 0.5) * 0.2;
          L.bind(sp, glass);
          sp.parent = root;
        }
      },
    );

    for (const p of this.pois) for (const m of p.root.getChildMeshes()) m.isPickable = false;
  }

  /** Tall light column marking the landing zone (visible from orbit). */
  private buildSurveyBeacon(): void {
    const s = this.legacy ? WORLD.surveySite : this.def.landingSite;
    const y = this.groundAt(s.x, s.z);
    const bc = this.look.beacon;
    const mat = new StandardMaterial("gf-beacon-mat", this.scene);
    mat.emissiveColor = c3(bc);
    mat.alpha = 0.35;
    mat.disableLighting = true;
    mat.fogEnabled = false;
    const col = MeshBuilder.CreateCylinder("gf-beacon", { height: 260, diameterTop: 0.6, diameterBottom: 1.6, tessellation: 8 }, this.scene);
    col.position.set(s.x, y + 130, s.z);
    col.material = mat;
    col.isPickable = false;
    col.applyFog = false;
    const ringMat = new StandardMaterial("gf-pad-ring", this.scene);
    ringMat.emissiveColor = this.legacy ? new Color3(0.25, 0.85, 1) : c3(bc).scale(1.05);
    ringMat.disableLighting = true;
    const ring = MeshBuilder.CreateTorus("gf-beacon-ring", { diameter: 22, thickness: 0.25, tessellation: 48 }, this.scene);
    ring.position.set(s.x, y + 0.15, s.z);
    ring.material = ringMat;
    ring.isPickable = false;
    this.beaconMeshes.push(col);
  }

  // ---------------------------------------------------------------- new worlds: shared builders

  /** Distance (m) from every hazard-grid cell to the nearest liquid cell (lava / acid / water / ice). */
  private buildLiquidDistance(): void {
    if (this.def.liquid.kind === "none") return;
    const N = HAZARD_RES, size = this.def.terrainSize, cell = size / N;
    const d = new Float32Array(N * N);
    const INF = 1e9;
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const x = -size / 2 + (i + 0.5) * cell, z = -size / 2 + (j + 0.5) * cell;
        d[j * N + i] = this.heightfield.heightAt(x, z) < this.def.liquid.level ? 0 : INF;
      }
    const D1 = cell, D2 = cell * Math.SQRT2;
    const at = (i: number, j: number) => (i < 0 || j < 0 || i >= N || j >= N ? INF : d[j * N + i]);
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const k = j * N + i;
        d[k] = Math.min(d[k], at(i - 1, j) + D1, at(i, j - 1) + D1, at(i - 1, j - 1) + D2, at(i + 1, j - 1) + D2);
      }
    for (let j = N - 1; j >= 0; j--)
      for (let i = N - 1; i >= 0; i--) {
        const k = j * N + i;
        d[k] = Math.min(d[k], at(i + 1, j) + D1, at(i, j + 1) + D1, at(i + 1, j + 1) + D2, at(i - 1, j + 1) + D2);
      }
    this.liquidDist = d;
  }

  private liquidDistanceAt(x: number, z: number): number {
    const d = this.liquidDist;
    if (!d) return 1e9;
    const size = this.def.terrainSize, cell = size / HAZARD_RES;
    const i = clamp(Math.floor((x + size / 2) / cell), 0, HAZARD_RES - 1), j = clamp(Math.floor((z + size / 2) / cell), 0, HAZARD_RES - 1);
    return d[j * HAZARD_RES + i];
  }

  private buildHazard(): void {
    const H = this.def.hazard;
    if (H.kind === "none" || H.intensity <= 0) return;
    const N = HAZARD_RES, size = this.def.terrainSize, cell = size / N;
    const g = new Float32Array(N * N);
    const site = this.def.landingSite;
    const lv = this.def.liquid.level;
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const x = -size / 2 + (i + 0.5) * cell, z = -size / 2 + (j + 0.5) * cell;
        const h = this.heightfield.heightAt(x, z);
        const ld = this.liquidDist ? this.liquidDist[j * N + i] : 1e9;
        const ny = this.heightfield.normalAt(x, z).y;
        const gust = 0.5 + 0.5 * this.noise.noise2(x / 260 + 4, z / 260 - 2);
        let v = 0;
        if (H.kind === "heat") v = h < lv ? 1 : 0.08 + 0.92 * Math.pow(Math.max(0, 1 - ld / 42), 1.4);
        else if (H.kind === "cold") v = 0.3 + 0.55 * smoothstep(5, 110, h) + 0.15 * gust * (1 - ny + 0.3);
        else if (H.kind === "storm") v = 0.25 + 0.5 * smoothstep(0, 90, h) + 0.25 * gust;
        else if (H.kind === "toxic") v = h < lv ? 1 : Math.max(0.18 + 0.12 * gust, 0.9 * Math.max(0, 1 - ld / 32), h < lv + 5 ? 0.5 : 0);
        if (H.kind !== "heat" && H.kind !== "toxic") v *= H.intensity / 0.6;
        else if (h >= lv) v *= Math.min(1, H.intensity + 0.15);
        // The landing-site core is sheltered (survey shelters, cleared ground).
        const ds = Math.hypot(x - site.x, z - site.z);
        v *= smoothstep(site.radius * 0.3, site.radius * 1.05, ds);
        g[j * N + i] = clamp(v, 0, 1);
      }
    this.hazardGrid = g;
  }

  /** Generic boulders tinted from the palette (biome variants: snow caps, basalt, sandstone). */
  private buildRocks(): void {
    const P = this.def.palette;
    const biome = this.def.biome;
    const rng = createRng(this.def.seed + 101);
    const tint = (x: number, y: number, z: number): [number, number, number] => {
      const t = clamp(y * 0.5 + 0.5, 0, 1);
      const r = P.rock;
      let c: V3 = [r[0] * (0.85 + t * 0.4) + x * 0.01, r[1] * (0.85 + t * 0.35), r[2] * (0.85 + t * 0.35)];
      if (biome === "frozen" && y > 0.22 + Math.sin(x * 4 + z * 3) * 0.06) c = [0.88, 0.92, 0.98];
      if (biome === "lush" && y > 0.3) c = mix3(c, P.low, 0.55);
      if (biome === "exotic") c = mix3(c, [0.72, 0.5, 0.42], 0.5 + 0.5 * Math.sin(y * 9));
      return c;
    };
    const hi = this.rockMesh("gf-boulder", this.def.seed % 97, 3, tint);
    const lo = this.rockMesh("gf-boulder-lo", this.def.seed % 97, 1, tint);
    const rough = biome === "frozen" ? 0.6 : biome === "hostile" ? 0.7 : 0.88;
    const mat = this.mat(`boulder-${this.def.id}`, { albedo: new Color3(1, 1, 1), roughness: rough, vertexColors: true, world: { terrain: true, triplanar: true, rock: 0.85, atmosphere: true } });
    this.propSource(hi, lo, mat);
    const count = biome === "hostile" ? 170 : biome === "exotic" ? 120 : 150;
    for (let i = 0; i < count; i++) {
      const p = this.findSpot(rng, { maxR: 600, minNy: 0.72, avoidSite: 45 });
      if (!p) continue;
      const s = rngRange(rng, 1.6, 6.2);
      const sx = s * rngRange(rng, 0.8, 1.3), sy = s * rngRange(rng, 0.7, 1.2), sz = s * rngRange(rng, 0.8, 1.3);
      this.instance(hi, `gf-boulder-${i}`, p.x, p.z, [sx, sy, sz], rng() * 6.28, -0.25 * (s / sy), { r: s * 0.95, top: s * 0.95 });
    }
  }

  private buildBiomeProps(): void {
    switch (this.def.biome) {
      case "lush":
        return this.buildForest();
      case "frozen":
        return this.buildIceFormations();
      case "volcanic":
        return this.buildVolcanicProps();
      case "exotic":
        return this.buildSkyReef();
      case "hostile":
        return this.buildSpikeFields();
      default:
        return;
    }
  }

  // ---------------------------------------------------------------- Aetherion: alien forest

  private treeMeshes(lowDetail: boolean): Mesh[] {
    const sfx = lowDetail ? "-lo" : "";
    const tess = lowDetail ? 4 : 7;
    const out: Mesh[] = [];
    // 1. Lantern willow: curved trunk, drooping strands ending in glowing pods.
    {
      const parts: Mesh[] = [];
      const trunkPath = Array.from({ length: 7 }, (_, i) => new Vector3(Math.sin(i * 0.38) * 0.7, i * 1.35, Math.cos(i * 0.5) * 0.2 - 0.2));
      parts.push(this.tubeMesh(`tw-trunk${sfx}`, trunkPath, (t) => 0.5 - t * 0.3, tess, [0.3, 0.22, 0.2], [0.42, 0.32, 0.26]));
      const top = trunkPath[6];
      const crown = MeshBuilder.CreateSphere(`tw-crown${sfx}`, { diameter: 4.2, segments: lowDetail ? 4 : 8 }, this.scene);
      crown.position.copyFrom(top).addInPlaceFromFloats(0, 0.6, 0);
      crown.scaling.y = 0.55;
      parts.push(this.part(crown, [0.12, 0.42, 0.36], [0.3, 0.66, 0.5]));
      const strands = lowDetail ? 4 : 9;
      for (let s = 0; s < strands; s++) {
        const a = (s / strands) * Math.PI * 2 + 0.2;
        const r0 = 1.6, r1 = 3.4 + (s % 3) * 0.3;
        const path = [0, 1, 2, 3, 4].map((k) => {
          const t = k / 4;
          const r = r0 + (r1 - r0) * Math.sin(t * Math.PI * 0.5);
          return new Vector3(top.x + Math.cos(a) * r, top.y + 0.6 - t * t * 5.2, top.z + Math.sin(a) * r);
        });
        if (!lowDetail) parts.push(this.tubeMesh(`tw-strand${s}`, path, (t) => 0.09 - t * 0.04, 4, [0.16, 0.46, 0.38], [0.36, 0.72, 0.56]));
        const pod = MeshBuilder.CreateSphere(`tw-pod${s}${sfx}`, { diameter: 0.55, segments: 4 }, this.scene);
        pod.position.copyFrom(path[4]);
        parts.push(this.part(pod, [0.85, 1.0, 0.6]));
      }
      const m = this.mergeParts(parts);
      m.name = `gf-tree-willow${sfx}`;
      out.push(m);
    }
    // 2. Parasol pine: tall straight trunk with tiered flat canopies.
    {
      const parts: Mesh[] = [];
      const trunk = MeshBuilder.CreateCylinder(`tp-trunk${sfx}`, { height: 12, diameterTop: 0.28, diameterBottom: 0.62, tessellation: tess }, this.scene);
      trunk.position.y = 6;
      parts.push(this.part(trunk, [0.34, 0.24, 0.22], [0.46, 0.36, 0.3]));
      const tiers: [number, number][] = [[7.4, 6.4], [9.6, 4.8], [11.6, 3.0]];
      for (const [h, d] of tiers) {
        const tier = MeshBuilder.CreateCylinder(`tp-tier${h}${sfx}`, { height: 1.1, diameterTop: d * 0.55, diameterBottom: d, tessellation: lowDetail ? 6 : 12 }, this.scene);
        tier.position.y = h;
        parts.push(this.part(tier, [0.08, 0.3, 0.28], [0.22, 0.58, 0.44]));
      }
      const m = this.mergeParts(parts);
      m.name = `gf-tree-parasol${sfx}`;
      out.push(m);
    }
    // 3. Bulbcrown: stout trunk splitting into three branches with round canopies.
    {
      const parts: Mesh[] = [];
      const trunk = MeshBuilder.CreateCylinder(`tb-trunk${sfx}`, { height: 3.6, diameterTop: 0.9, diameterBottom: 1.4, tessellation: tess }, this.scene);
      trunk.position.y = 1.8;
      parts.push(this.part(trunk, [0.36, 0.28, 0.22]));
      for (let b = 0; b < 3; b++) {
        const a = b * 2.094 + 0.4;
        const tip = new Vector3(Math.cos(a) * 2.2, 6.4 + (b % 2) * 0.8, Math.sin(a) * 2.2);
        if (!lowDetail) parts.push(this.tubeMesh(`tb-br${b}`, [new Vector3(0, 3.2, 0), new Vector3(Math.cos(a) * 1.1, 4.8, Math.sin(a) * 1.1), tip], (t) => 0.38 - t * 0.18, 6, [0.36, 0.28, 0.22]));
        const ball = this.rockMesh(`tb-ball${b}${sfx}`, 61 + b, lowDetail ? 1 : 2, (x, y) => (y > 0 ? [0.5, 0.68, 0.22] : [0.3, 0.46, 0.16]));
        ball.scaling.set(2.4, 2.6, 2.4);
        ball.position.copyFrom(tip).addInPlaceFromFloats(0, 0.6, 0);
        ball.bakeCurrentTransformIntoVertices();
        parts.push(ball);
      }
      const m = this.mergeParts(parts);
      m.name = `gf-tree-bulb${sfx}`;
      out.push(m);
    }
    // 4. Spiral fernwood: helical trunk crowned with long magenta fern fans.
    {
      const parts: Mesh[] = [];
      const path = Array.from({ length: 9 }, (_, i) => new Vector3(Math.cos(i * 0.9) * 0.45, i * 0.95, Math.sin(i * 0.9) * 0.45));
      parts.push(this.tubeMesh(`tf-trunk${sfx}`, path, (t) => 0.32 - t * 0.18, tess, [0.3, 0.2, 0.28], [0.5, 0.3, 0.42]));
      const fan = this.frondMesh({ name: `tf-fan${sfx}`, leaves: lowDetail ? 5 : 9, len: 3.6, width: 0.42, base: [0.42, 0.14, 0.38], delta: [0.48, 0.42, 0.36] });
      fan.position.copyFrom(path[8]);
      fan.bakeCurrentTransformIntoVertices();
      parts.push(fan);
      const m = this.mergeParts(parts);
      m.name = `gf-tree-fern${sfx}`;
      out.push(m);
    }
    for (const m of out) m.isPickable = false;
    return out;
  }

  private buildForest(): void {
    const his = this.treeMeshes(false);
    const los = this.treeMeshes(true);
    const mat = this.mat(`tree-${this.def.id}`, { albedo: new Color3(1, 1, 1), roughness: 0.72, vertexColors: true, backFaceCulling: false, emissive: new Color3(0.03, 0.05, 0.03), world: { wind: 0.0022, atmosphere: true } });
    his.forEach((h, i) => this.propSource(h, los[i], mat, { high: 1.6, cull: 1.35 }));
    this.sources.willow = his[0];
    const rng = createRng(this.def.seed + 505);
    const counts = [80, 130, 90, 80];
    const colliderR = [0.5, 0.45, 0.8, 0.4];
    const topH = [7, 11, 5, 7];
    const n = this.noise;
    let k = 0;
    his.forEach((src, v) => {
      for (let i = 0; i < counts[v] * 3 && k < 2000; i++) {
        const p = this.findSpot(rng, { maxR: 590, minNy: 0.8, avoidSite: 70, minH: this.def.liquid.level + 1.2, maxH: 75 });
        if (!p) continue;
        // Forests grow in noise-defined groves.
        const grove = n.noise2(p.x / 210 + v * 3.3, p.z / 210 - v * 1.7);
        if (grove < 0.05 || rng() > 0.6) continue;
        const s = rngRange(rng, 0.75, 1.35);
        this.instance(src, `gf-tree-${v}-${k++}`, p.x, p.z, [s, s * rngRange(rng, 0.85, 1.15), s], rng() * 6.28, 0.1, { r: colliderR[v] * s, top: topH[v] * s });
        if (--counts[v] <= 0) break;
      }
    });
  }

  // ---------------------------------------------------------------- Kryos: ice spires, arches, overhangs

  private buildIceFormations(): void {
    const iceMat = this.mat(`ice-${this.def.id}`, { albedo: new Color3(0.68, 0.86, 1), roughness: 0.08, metallic: 0.1, emissive: new Color3(0.05, 0.13, 0.2), vertexColors: true, world: { atmosphere: true } });
    // Spires: tall faceted crystal clusters.
    const spireHi = this.crystalMesh("gf-icespire", 6, 71, 4.5, 1);
    const spireLo = this.crystalMesh("gf-icespire-lo", 3, 71, 4.5, 1);
    this.paint(spireHi, [0.62, 0.8, 0.95], [0.92, 0.98, 1]);
    this.paint(spireLo, [0.62, 0.8, 0.95], [0.92, 0.98, 1]);
    this.propSource(spireHi, spireLo, iceMat, { high: 1.5, cull: 1.4 });
    // Arches: two variants of wind-carved ice.
    const archHi = this.archMesh("gf-icearch", 18, 11, 2.2, 5, [0.55, 0.72, 0.88], [0.9, 0.96, 1]);
    const archLo = this.archMesh("gf-icearch-lo", 18, 11, 2.2, 5, [0.55, 0.72, 0.88], [0.9, 0.96, 1], 5, 8);
    this.propSource(archHi, archLo, iceMat, { high: 2.2, cull: 1.8 });
    this.sources.arch = archHi;
    // Overhang: leaning slab on a pillar with icicles: a walk-in ice shelter.
    const overhang = (lo: boolean): Mesh => {
      const parts: Mesh[] = [];
      const slab = this.rockMesh(`gf-overhang-slab${lo ? "-lo" : ""}`, 83, lo ? 1 : 2, (x, y) => (y > 0.2 ? [0.9, 0.94, 1] : [0.5, 0.68, 0.86]));
      slab.scaling.set(8, 1.6, 5.5);
      slab.rotation.z = 0.22;
      slab.position.set(1.5, 5.2, 0);
      slab.bakeCurrentTransformIntoVertices();
      parts.push(slab);
      const pillar = MeshBuilder.CreateCylinder("gf-oh-pillar", { height: 6, diameterTop: 1.6, diameterBottom: 2.6, tessellation: lo ? 5 : 8 }, this.scene);
      pillar.position.set(-4.5, 2.6, 0);
      parts.push(this.part(pillar, [0.5, 0.66, 0.82], [0.7, 0.85, 0.96]));
      if (!lo)
        for (let i = 0; i < 7; i++) {
          const ic = MeshBuilder.CreateCylinder(`gf-oh-ic${i}`, { height: 1.4 + (i % 3) * 0.6, diameterTop: 0.35, diameterBottom: 0, tessellation: 4 }, this.scene);
          ic.position.set(-1 + i * 1.1, 4.2 - (i % 3) * 0.3, ((i * 37) % 5) - 2.2);
          parts.push(this.part(ic, [0.8, 0.92, 1]));
        }
      const m = this.mergeParts(parts);
      m.name = `gf-overhang${lo ? "-lo" : ""}`;
      return m;
    };
    const ohHi = overhang(false), ohLo = overhang(true);
    this.propSource(ohHi, ohLo, iceMat, { high: 2, cull: 1.6 });

    const rng = createRng(this.def.seed + 606);
    let n = 0;
    for (let i = 0; i < 240 && n < 95; i++) {
      const p = this.findSpot(rng, { maxR: 590, minNy: 0.74, avoidSite: 70 });
      if (!p) continue;
      if (this.noise.noise2(p.x / 160 + 9, p.z / 160) < -0.1) continue;
      const s = rngRange(rng, 0.7, 1.6);
      this.instance(spireHi, `gf-icespire-${n++}`, p.x, p.z, [s, s * rngRange(rng, 0.9, 1.5), s], rng() * 6.28, 0.15, { r: 1.1 * s, top: 7 * s });
    }
    for (let i = 0, a = 0; i < 80 && a < 10; i++) {
      const p = this.findSpot(rng, { minR: 100, maxR: 560, minNy: 0.8, avoidSite: 90 });
      if (!p) continue;
      const s = rngRange(rng, 0.8, 1.3), yaw = rng() * Math.PI;
      this.instance(archHi, `gf-icearch-${a++}`, p.x, p.z, [s, s, s], yaw, 0);
      for (const side of [-1, 1]) this.addCollider({ x: p.x + Math.cos(yaw) * side * 9 * s, z: p.z - Math.sin(yaw) * side * 9 * s, r: 2.6 * s, top: this.groundAt(p.x, p.z) + 9 * s });
    }
    for (let i = 0, o = 0; i < 80 && o < 9; i++) {
      const p = this.findSpot(rng, { minR: 90, maxR: 560, minNy: 0.78, avoidSite: 90 });
      if (!p) continue;
      const s = rngRange(rng, 0.9, 1.4), yaw = rng() * 6.28;
      this.instance(ohHi, `gf-overhang-${o++}`, p.x, p.z, [s, s, s], yaw, 0.2);
      this.addCollider({ x: p.x + Math.cos(yaw) * -4.5 * s, z: p.z - Math.sin(yaw) * -4.5 * s, r: 1.4 * s, top: this.groundAt(p.x, p.z) + 6.5 * s });
    }
  }

  // ---------------------------------------------------------------- Pyron: basalt columns, vents

  private buildVolcanicProps(): void {
    const basalt = (lo: boolean): Mesh => {
      const rng = createRng(97);
      const parts: Mesh[] = [];
      const nCol = lo ? 5 : 11;
      for (let i = 0; i < nCol; i++) {
        const a = i * 2.39996, r = Math.sqrt(i) * 0.95;
        const h = 2 + rng() * 5.5;
        const c = MeshBuilder.CreateCylinder(`gf-bc${i}`, { height: h, diameter: 1.05, tessellation: 6 }, this.scene);
        c.position.set(Math.cos(a) * r, h / 2 - 0.4, Math.sin(a) * r);
        parts.push(this.part(c, [0.12, 0.11, 0.11], [0.3, 0.27, 0.26]));
      }
      const m = this.mergeParts(parts);
      m.name = `gf-basalt${lo ? "-lo" : ""}`;
      return m;
    };
    const bMat = this.mat(`basalt-${this.def.id}`, { albedo: new Color3(1, 1, 1), roughness: 0.7, vertexColors: true, world: { atmosphere: true } });
    const bHi = basalt(false), bLo = basalt(true);
    this.propSource(bHi, bLo, bMat, { high: 1.5, cull: 1.3 });
    const vent = (lo: boolean): Mesh => {
      const parts: Mesh[] = [];
      const cone = MeshBuilder.CreateCylinder("gf-vent-cone", { height: 2.4, diameterTop: 1.1, diameterBottom: 4.2, tessellation: lo ? 6 : 12 }, this.scene);
      cone.position.y = 1.0;
      parts.push(this.part(cone, [0.14, 0.11, 0.1], [0.36, 0.22, 0.16]));
      const glow = MeshBuilder.CreateCylinder("gf-vent-glow", { height: 0.2, diameter: 1.0, tessellation: lo ? 6 : 12 }, this.scene);
      glow.position.y = 2.18;
      parts.push(this.part(glow, [1.6, 0.7, 0.2]));
      const m = this.mergeParts(parts);
      m.name = `gf-vent${lo ? "-lo" : ""}`;
      return m;
    };
    const vMat = this.mat(`vent-${this.def.id}`, { albedo: new Color3(1, 1, 1), roughness: 0.8, vertexColors: true, emissive: new Color3(0.08, 0.03, 0.01), world: { atmosphere: true } });
    const vHi = vent(false), vLo = vent(true);
    this.propSource(vHi, vLo, vMat);
    const rng = createRng(this.def.seed + 707);
    for (let i = 0, n = 0; i < 300 && n < 80; i++) {
      const p = this.findSpot(rng, { maxR: 590, minNy: 0.72, avoidSite: 60 });
      if (!p) continue;
      const s = rngRange(rng, 0.8, 1.6);
      this.instance(bHi, `gf-basalt-${n++}`, p.x, p.z, [s, s * rngRange(rng, 0.8, 1.4), s], rng() * 6.28, 0, { r: 2.4 * s, top: 4 * s });
    }
    for (let i = 0, n = 0; i < 300 && n < 46; i++) {
      const p = this.findSpot(rng, { maxR: 580, minNy: 0.8, avoidSite: 70 });
      if (!p) continue;
      if (this.liquidDistanceAt(p.x, p.z) > 90 && rng() > 0.3) continue;
      const s = rngRange(rng, 0.7, 1.4);
      this.instance(vHi, `gf-vent-${n++}`, p.x, p.z, [s, s, s], rng() * 6.28, 0.1, { r: 1.6 * s, top: 2.2 * s });
    }
  }

  // ---------------------------------------------------------------- Zephyria: floating islands & arches

  private islandMesh(name: string, seed: number, sub: number): Mesh {
    const P = this.def.palette;
    const m = MeshBuilder.CreateIcoSphere(name, { radius: 1, subdivisions: sub, flat: sub <= 1 }, this.scene);
    const pos = m.getVerticesData("position")!;
    const n = new SimplexNoise(seed);
    const col: number[] = [];
    for (let i = 0; i < pos.length; i += 3) {
      let x = pos[i], y = pos[i + 1], z = pos[i + 2];
      const d = 1 + n.noise2(x * 1.7 + y, z * 1.7 - y) * 0.16 + n.noise2(x * 4 + 3, z * 4 - y) * 0.05;
      x *= d;
      z *= d;
      if (y > 0) y = 0.18 + y * 0.12 + n.noise2(x * 2, z * 2) * 0.05;
      else {
        const t = -y;
        y = -t * (1.9 + n.noise2(x * 2.2, z * 2.2) * 0.5);
        x *= 1 - t * 0.72;
        z *= 1 - t * 0.72;
      }
      pos[i] = x;
      pos[i + 1] = y;
      pos[i + 2] = z;
      let c: V3;
      if (y > 0.16) c = mix3(P.low, [0.55, 0.42, 0.66], 0.3 + 0.3 * n.noise2(x * 3, z * 3));
      else if (Math.sin(y * 9 + x * 2) > 0.86) c = [0.35, 0.85, 0.95];
      else c = mix3(P.rock, P.basin, clamp(-y / 2, 0, 0.7));
      col.push(c[0], c[1], c[2], 1);
    }
    m.setVerticesData("position", pos);
    m.setVerticesData("color", col);
    const normals: number[] = [];
    VertexData.ComputeNormals(pos, m.getIndices()!, normals);
    m.setVerticesData("normal", normals);
    m.isPickable = false;
    return m;
  }

  private buildSkyReef(): void {
    const isMat = this.mat(`island-${this.def.id}`, { albedo: new Color3(1, 1, 1), roughness: 0.86, vertexColors: true, emissive: new Color3(0.02, 0.04, 0.05), world: { atmosphere: true } });
    const islands: Mesh[] = [];
    for (let v = 0; v < 3; v++) {
      const hi = this.islandMesh(`gf-island${v}`, this.def.seed + v * 13, 3);
      const lo = this.islandMesh(`gf-island${v}-lo`, this.def.seed + v * 13, 1);
      this.propSource(hi, lo, isMat, { high: 4, cull: 3.2 });
      islands.push(hi);
    }
    const rockC = this.def.palette.rock;
    const archHi = this.archMesh("gf-stonearch", 30, 22, 3.2, 9, [rockC[0] * 0.9, rockC[1] * 0.9, rockC[2] * 0.9], [0.8, 0.62, 0.55]);
    const archLo = this.archMesh("gf-stonearch-lo", 30, 22, 3.2, 9, [rockC[0] * 0.9, rockC[1] * 0.9, rockC[2] * 0.9], [0.8, 0.62, 0.55], 5, 8);
    const arMat = this.mat(`stonearch-${this.def.id}`, { albedo: new Color3(1, 1, 1), roughness: 0.85, vertexColors: true, world: { terrain: true, triplanar: true, rock: 0.9, atmosphere: true } });
    this.propSource(archHi, archLo, arMat, { high: 3, cull: 2.6 });
    this.sources.arch = archHi;
    // Coil stalks: helical stems topped with a glowing bulb.
    const coil = (lo: boolean): Mesh => {
      const parts: Mesh[] = [];
      const steps = lo ? 6 : 14;
      const path = Array.from({ length: steps }, (_, i) => {
        const t = i / (steps - 1);
        return new Vector3(Math.cos(t * 12) * 0.35 * (1 - t * 0.5), t * 4.5, Math.sin(t * 12) * 0.35 * (1 - t * 0.5));
      });
      parts.push(this.tubeMesh(`gf-coil-stem${lo ? "-lo" : ""}`, path, (t) => 0.16 - t * 0.08, lo ? 4 : 6, [0.2, 0.5, 0.55], [0.85, 0.5, 0.8]));
      const bulb = MeshBuilder.CreateSphere("gf-coil-bulb", { diameter: 0.9, segments: lo ? 3 : 6 }, this.scene);
      bulb.position.y = 4.7;
      parts.push(this.part(bulb, [1, 0.75, 0.95]));
      const m = this.mergeParts(parts);
      m.name = `gf-coil${lo ? "-lo" : ""}`;
      return m;
    };
    const coMat = this.mat(`coil-${this.def.id}`, { albedo: new Color3(1, 1, 1), roughness: 0.5, vertexColors: true, emissive: new Color3(0.1, 0.06, 0.12), world: { wind: 0.012, atmosphere: true } });
    const coHi = coil(false), coLo = coil(true);
    this.propSource(coHi, coLo, coMat);

    const rng = createRng(this.def.seed + 808);
    const nIsl = terrainNum(this.def, "floating", 20);
    for (let i = 0, k = 0; i < nIsl * 6 && k < nIsl; i++) {
      const a = rng() * Math.PI * 2, r = 110 + Math.sqrt(rng()) * 460;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const site = this.def.landingSite;
      if (Math.hypot(x - site.x, z - site.z) < 130) continue;
      if (this.floatingColliders.some((f) => Math.hypot(f.x - x, f.z - z) < f.r + 40)) continue;
      const s = rngRange(rng, 10, 30);
      const y = Math.max(this.groundAt(x, z), this.def.liquid.level) + rngRange(rng, 55, 210);
      const src = islands[k % 3];
      const inst = this.instance(src, `gf-island-${k++}`, x, z, [s, s * rngRange(rng, 0.8, 1.2), s * rngRange(rng, 0.85, 1.15)], rng() * 6.28, 0, undefined, y);
      void inst;
      this.floatingColliders.push({ x, y: y - s * 0.5, z, r: s * 1.05 });
    }
    for (let i = 0, k = 0; i < 90 && k < terrainNum(this.def, "arches", 6); i++) {
      const p = this.findSpot(rng, { minR: 120, maxR: 560, minNy: 0.8, avoidSite: 100 });
      if (!p) continue;
      const s = rngRange(rng, 0.8, 1.35), yaw = rng() * Math.PI;
      this.instance(archHi, `gf-stonearch-${k++}`, p.x, p.z, [s, s, s], yaw, 0);
      for (const side of [-1, 1]) this.addCollider({ x: p.x + Math.cos(yaw) * side * 15 * s, z: p.z - Math.sin(yaw) * side * 15 * s, r: 3.8 * s, top: this.groundAt(p.x, p.z) + 18 * s });
    }
    for (let i = 0, k = 0; i < 400 && k < 150; i++) {
      const p = this.findSpot(rng, { maxR: 580, minNy: 0.82, avoidSite: 50 });
      if (!p) continue;
      if (this.noise.noise2(p.x / 120 - 4, p.z / 120 + 2) < 0) continue;
      const s = rngRange(rng, 0.7, 1.5);
      this.instance(coHi, `gf-coil-${k++}`, p.x, p.z, [s, s, s], rng() * 6.28, 0.05, { r: 0.35 * s, top: 4.5 * s });
    }
  }

  // ---------------------------------------------------------------- Noctaris: basalt spike fields

  private buildSpikeFields(): void {
    const mat = this.mat(`spikes-${this.def.id}`, { albedo: new Color3(1, 1, 1), roughness: 0.4, metallic: 0.15, vertexColors: true, emissive: new Color3(0.03, 0.0, 0.0), world: { atmosphere: true } });
    const hi = this.spikeCluster("gf-blackspike", 131, 7, [3, 9], 1.6, 2.4, 0.5, [0.07, 0.06, 0.08], [0.45, 0.1, 0.1], 5);
    const lo = this.spikeCluster("gf-blackspike-lo", 131, 3, [3, 9], 1.6, 2.4, 0.5, [0.07, 0.06, 0.08], [0.45, 0.1, 0.1], 4);
    this.propSource(hi, lo, mat, { high: 1.5, cull: 1.3 });
    const rng = createRng(this.def.seed + 909);
    for (let i = 0, n = 0; i < 400 && n < 130; i++) {
      const p = this.findSpot(rng, { maxR: 590, minNy: 0.7, avoidSite: 60 });
      if (!p) continue;
      if (this.noise.noise2(p.x / 140 + 1, p.z / 140 + 6) < -0.2) continue;
      const s = rngRange(rng, 0.7, 1.7);
      this.instance(hi, `gf-blackspike-${n++}`, p.x, p.z, [s, s * rngRange(rng, 0.8, 1.5), s], rng() * 6.28, 0.1, { r: 1.5 * s, top: 6 * s });
    }
  }

  // ---------------------------------------------------------------- decor scatter per biome

  private buildBiomeDecor(): void {
    const rng = createRng(this.def.seed + 404);
    const P = this.def.palette;
    const id = this.def.id;
    const Lq = this.def.liquid.level;
    const pebMat = this.mat(`pebble-${id}`, { albedo: new Color3(1, 1, 1), roughness: 0.9, vertexColors: true, world: { terrain: true, rock: 0.6, atmosphere: true } });
    const pebbleTint = (y: number): [number, number, number] => [P.rock[0] * 1.2 + y * 0.05, P.rock[1] * 1.2, P.rock[2] * 1.2];
    const pebbles = (count: number) =>
      this.scatterField("gf-pebbles", this.rockMesh("gf-pebble", 5, 0, (x, y) => pebbleTint(y)), pebMat, rng, count, { maxR: 560, minNy: 0.7, tries: 3 }, () => {
        const s = rngRange(rng, 0.12, 0.55);
        return [s * 1.2, s, s * 1.1, rng() * 6.28, s * 0.25];
      });
    const grass = (count: number, base: V3, delta: V3, height: number, maxH: number) => {
      const gm = this.mat(`grass-${id}`, { albedo: new Color3(1, 1, 1), roughness: 0.75, vertexColors: true, backFaceCulling: false, world: { wind: 0.16, atmosphere: true } });
      this.scatterField("gf-grass", this.grassMesh(base, delta, height), gm, rng, count, { maxR: 480, minNy: 0.86, tries: 2, minH: Lq + 0.8, maxH }, (x, y, z) => {
        const v = this.noise.fbm(x / 45, z / 45, 3);
        if (v + (y - 2) * 0.03 > 0.2) return null;
        const s = rngRange(rng, 0.6, 1.25);
        return [s, s * rngRange(rng, 0.7, 1.4), s, rng() * 6.28, 0.04];
      });
    };
    switch (this.def.biome) {
      case "lush": {
        pebbles(1800);
        grass(15000, [0.12, 0.36, 0.2], [0.3, 0.45, 0.18], 1.15, 60);
        const fm = this.mat(`frond-${id}`, { albedo: new Color3(1, 1, 1), roughness: 0.65, vertexColors: true, backFaceCulling: false, world: { wind: 0.05, atmosphere: true } });
        this.scatterField("gf-fronds", this.frondMesh({ base: [0.1, 0.3, 0.2], delta: [0.2, 0.42, 0.22] }), fm, rng, 1600, { maxR: 540, minNy: 0.8, tries: 4, minH: Lq + 0.6, maxH: 50 }, () => {
          const s = rngRange(rng, 0.8, 1.8);
          return [s, s * rngRange(rng, 0.8, 1.3), s, rng() * 6.28, 0.05];
        });
        const flm = this.mat(`flower-${id}`, { albedo: new Color3(1, 1, 1), roughness: 0.6, vertexColors: true, backFaceCulling: false, emissive: new Color3(0.06, 0.05, 0.05), world: { wind: 0.12, atmosphere: true } });
        this.scatterField("gf-flowers", this.flowerMesh([[1, 0.45, 0.7], [1, 0.85, 0.3], [0.55, 0.7, 1]]), flm, rng, 2600, { maxR: 520, minNy: 0.86, tries: 3, minH: Lq + 0.8, maxH: 40 }, (x, y, z) => {
          if (this.noise.noise2(x / 60 + 11, z / 60) < 0.1) return null;
          const s = rngRange(rng, 0.8, 1.4);
          return [s, s, s, rng() * 6.28, 0.02];
        });
        const cm = this.mat(`glowcap-${id}`, { albedo: new Color3(1, 1, 1), roughness: 0.5, vertexColors: true, emissive: new Color3(0.1, 0.22, 0.18), world: { wind: 0.015, atmosphere: true } });
        this.scatterField("gf-glowcaps", this.glowCapMesh([0.36, 0.3, 0.22], [0.6, 1, 0.75]), cm, rng, 900, { maxR: 560, minNy: 0.78, tries: 5, minH: Lq + 0.3, maxH: Lq + 7 }, () => {
          const s = rngRange(rng, 0.5, 1.2);
          return [s, s, s, rng() * 6.28, 0.02];
        });
        break;
      }
      case "frozen": {
        const snowMat = this.mat(`snowtuft-${id}`, { albedo: new Color3(1, 1, 1), roughness: 0.55, vertexColors: true, world: { atmosphere: true } });
        this.scatterField("gf-snowtufts", this.rockMesh("gf-snowtuft", 7, 1, (x, y) => (y > 0 ? [0.95, 0.97, 1] : [0.78, 0.85, 0.95])), snowMat, rng, 2800, { maxR: 560, minNy: 0.78, tries: 3 }, () => {
          const s = rngRange(rng, 0.4, 1.4);
          return [s * 1.6, s * 0.45, s * 1.2, rng() * 6.28, s * 0.12];
        });
        pebbles(1600);
        const frMat = this.mat(`frost-${id}`, { albedo: new Color3(1, 1, 1), roughness: 0.15, metallic: 0.1, vertexColors: true, emissive: new Color3(0.05, 0.1, 0.14), world: { atmosphere: true } });
        this.scatterField("gf-frost", this.spikeCluster("gf-frostcrystal", 141, 5, [0.4, 1.2], 0.14, 0.5, 0.9, [0.55, 0.75, 0.92], [0.95, 1, 1], 4), frMat, rng, 2200, { maxR: 560, minNy: 0.72, tries: 3 }, () => {
          const s = rngRange(rng, 0.6, 1.6);
          return [s, s, s, rng() * 6.28, 0.05];
        });
        grass(6000, [0.5, 0.58, 0.68], [0.36, 0.34, 0.3], 0.7, 40);
        const shMat = this.mat(`shrub-${id}`, { albedo: new Color3(1, 1, 1), roughness: 0.8, vertexColors: true, world: { wind: 0.03, atmosphere: true } });
        this.scatterField("gf-shrubs", this.spikeCluster("gf-deadshrub", 151, 7, [0.6, 1.4], 0.08, 0.3, 1.4, [0.3, 0.28, 0.3], [0.6, 0.62, 0.7], 3), shMat, rng, 800, { maxR: 560, minNy: 0.8, tries: 3, maxH: 40 }, () => {
          const s = rngRange(rng, 0.7, 1.5);
          return [s, s, s, rng() * 6.28, 0.05];
        });
        break;
      }
      case "volcanic": {
        pebbles(2600);
        const emMat = this.mat(`ember-${id}`, { albedo: new Color3(0.4, 0.14, 0.05), roughness: 0.6, vertexColors: true, emissive: new Color3(0.9, 0.3, 0.06), world: { atmosphere: true } });
        this.scatterField("gf-embers", this.rockMesh("gf-emberstone", 19, 0, (x, y) => (y > 0.1 ? [0.35, 0.2, 0.15] : [1, 0.55, 0.2])), emMat, rng, 2000, { maxR: 560, minNy: 0.72, tries: 3 }, (x, y, z) => {
          if (this.liquidDistanceAt(x, z) > 70 && rng() > 0.35) return null;
          const s = rngRange(rng, 0.2, 0.8);
          return [s * 1.2, s * 0.8, s, rng() * 6.28, s * 0.2];
        });
        const obMat = this.mat(`obsidian-${id}`, { albedo: new Color3(1, 1, 1), roughness: 0.12, metallic: 0.2, vertexColors: true, world: { atmosphere: true } });
        this.scatterField("gf-shards", this.spikeCluster("gf-obsidian", 161, 4, [0.6, 1.8], 0.4, 0.6, 0.8, [0.04, 0.035, 0.05], [0.22, 0.16, 0.22], 4), obMat, rng, 1400, { maxR: 560, minNy: 0.74, tries: 3 }, () => {
          const s = rngRange(rng, 0.6, 1.5);
          return [s, s, s, rng() * 6.28, 0.1];
        });
        const shMat = this.mat(`shrub-${id}`, { albedo: new Color3(1, 1, 1), roughness: 0.9, vertexColors: true, world: { wind: 0.02, atmosphere: true } });
        this.scatterField("gf-shrubs", this.spikeCluster("gf-charshrub", 171, 8, [0.5, 1.5], 0.09, 0.3, 1.5, [0.08, 0.06, 0.05], [0.3, 0.12, 0.06], 3), shMat, rng, 900, { maxR: 560, minNy: 0.8, tries: 3 }, () => {
          const s = rngRange(rng, 0.7, 1.5);
          return [s, s, s, rng() * 6.28, 0.05];
        });
        break;
      }
      case "exotic": {
        pebbles(2000);
        grass(10000, [0.32, 0.18, 0.42], [0.4, 0.3, 0.32], 1.1, 80);
        const sailMat = this.mat(`sail-${id}`, { albedo: new Color3(1, 1, 1), roughness: 0.5, vertexColors: true, backFaceCulling: false, emissive: new Color3(0.05, 0.03, 0.06), world: { wind: 0.06, atmosphere: true } });
        this.scatterField("gf-sails", this.frondMesh({ name: "gf-sail", leaves: 3, len: 2.6, width: 0.34, base: [0.26, 0.48, 0.6], delta: [0.6, 0.3, 0.32] }), sailMat, rng, 1400, { maxR: 540, minNy: 0.82, tries: 3, minH: Lq + 0.8 }, () => {
          const s = rngRange(rng, 0.8, 1.6);
          return [s * 0.6, s * rngRange(rng, 1.2, 1.9), s * 0.6, rng() * 6.28, 0.05];
        });
        const bulbMat = this.mat(`bulb-${id}`, { albedo: new Color3(1, 1, 1), roughness: 0.45, vertexColors: true, emissive: new Color3(0.16, 0.12, 0.2), world: { wind: 0.03, atmosphere: true } });
        this.scatterField("gf-bulbs", this.glowCapMesh([0.35, 0.3, 0.45], [1, 0.7, 0.95]), bulbMat, rng, 1000, { maxR: 560, minNy: 0.8, tries: 4, minH: Lq + 0.4 }, () => {
          const s = rngRange(rng, 0.8, 1.8);
          return [s, s * 1.5, s, rng() * 6.28, 0.02];
        });
        break;
      }
      case "hostile": {
        pebbles(2600);
        grass(5000, [0.16, 0.1, 0.08], [0.24, 0.1, 0.05], 0.85, 60);
        const thMat = this.mat(`thorn-${id}`, { albedo: new Color3(1, 1, 1), roughness: 0.6, vertexColors: true, emissive: new Color3(0.04, 0, 0), world: { wind: 0.02, atmosphere: true } });
        this.scatterField("gf-thorns", this.spikeCluster("gf-thornbush", 181, 9, [0.5, 1.6], 0.1, 0.4, 1.6, [0.12, 0.03, 0.04], [0.5, 0.08, 0.1], 3), thMat, rng, 1500, { maxR: 560, minNy: 0.76, tries: 3 }, () => {
          const s = rngRange(rng, 0.7, 1.6);
          return [s, s, s, rng() * 6.28, 0.05];
        });
        const vMat = this.mat(`toxvent-${id}`, { albedo: new Color3(1, 1, 1), roughness: 0.5, vertexColors: true, emissive: new Color3(0.2, 0.5, 0.08), world: { atmosphere: true } });
        this.scatterField("gf-vents", this.glowCapMesh([0.14, 0.12, 0.1], [0.55, 1, 0.3]), vMat, rng, 900, { maxR: 560, minNy: 0.78, tries: 4 }, (x, y, z) => {
          if (this.liquidDistanceAt(x, z) > 60 && rng() > 0.25) return null;
          const s = rngRange(rng, 0.6, 1.4);
          return [s, s, s, rng() * 6.28, 0.02];
        });
        break;
      }
      default:
        pebbles(2000);
    }
  }

  // ---------------------------------------------------------------- deposits (new worlds)

  private buildGenericDeposits(): void {
    const def = this.def;
    const rng = createRng(def.seed + 202);
    const sources = this.depositSources();
    const counts = resourceCounts(def);
    const rich = def.resources.richness;
    const site = def.landingSite;
    const lv = def.liquid.level;
    const idx: Record<ResourceId, number> = { ferrite: 0, carbon: 0, lumenite: 0, voidQuartz: 0 };
    const range: Record<ResourceId, { scale: [number, number]; amount: [number, number]; minNy: number }> = {
      lumenite: { scale: [0.9, 1.6], amount: [10, 24], minNy: 0.8 },
      ferrite: { scale: [1.1, 2.2], amount: [14, 32], minNy: 0.76 },
      carbon: { scale: [0.8, 1.5], amount: [6, 14], minNy: 0.82 },
      voidQuartz: { scale: [0.8, 1.3], amount: [3, 7], minNy: 0.6 },
    };
    const make = (type: ResourceId, x: number, z: number, k: number) => {
      const R = range[type];
      this.makeDeposit(sources, rng, type, idx[type]++, x, z, rngRange(rng, R.scale[0], R.scale[1]) * (k > 1.2 ? 1.12 : 1), Math.round(rngRange(rng, R.amount[0], R.amount[1]) * rich * k));
    };
    const fits = (type: ResourceId, x: number, z: number) => {
      const h = this.heightFn(x, z);
      if (type === "carbon") return h < 30;
      if (type === "voidQuartz") return h < lv + 14 || this.liquidDistanceAt(x, z) < 50;
      return true;
    };
    const types = (Object.keys(counts) as ResourceId[]).filter((t) => counts[t] > 0);
    const left = { ...counts };
    // 1. Starter cluster around the landing site (never Void Quartz: it should be found).
    for (const t of types) {
      if (t === "voidQuartz") continue;
      const n = Math.min(left[t], Math.round(counts[t] * 0.14));
      for (let i = 0; i < n; i++) {
        const p = this.findSpot(rng, { cx: site.x, cz: site.z, minR: 18, maxR: 115, minNy: range[t].minNy, tries: 20 });
        if (p) make(t, p.x, p.z, 1), left[t]--;
      }
    }
    // 2. Resource zones: clustered, richer deposits. Volcanic/hostile ferrite & quartz zones hug the lava/acid.
    const dangerousZones = def.biome === "volcanic" || def.biome === "hostile";
    const weights = def.resources.weights;
    const maxW = Math.max(...types.map((t) => weights[t] ?? 0));
    for (const t of types) {
      const nz = (weights[t] ?? 0) >= maxW * 0.8 ? 2 : 1;
      for (let z = 0; z < nz; z++) {
        let best: { x: number; z: number } | null = null;
        let bestScore = -Infinity;
        for (let k = 0; k < 24; k++) {
          const p = this.findSpot(rng, { minR: 170, maxR: 520, minNy: 0.78, tries: 10, avoidSite: 150 });
          if (!p || !fits(t, p.x, p.z)) continue;
          if (this.resourceZones.some((r) => Math.hypot(r.x - p.x, r.z - p.z) < r.r + 70)) continue;
          const ld = this.liquidDistanceAt(p.x, p.z);
          const score = dangerousZones && (t === "ferrite" || t === "voidQuartz") ? -Math.abs(ld - 26) : rng();
          if (score > bestScore) (bestScore = score), (best = p);
        }
        if (!best) continue;
        const zr = rngRange(rng, 45, 70);
        const isRich = dangerousZones || t === "voidQuartz" || z === 0;
        this.resourceZones.push({ type: t, x: best.x, z: best.z, r: zr, rich: isRich });
        const n = Math.min(left[t], Math.round(counts[t] * (0.42 / nz)));
        for (let i = 0; i < n; i++) {
          const p = this.findSpot(rng, { cx: best.x, cz: best.z, maxR: zr, minNy: range[t].minNy - 0.08, tries: 14 });
          if (p) make(t, p.x, p.z, isRich ? 1.5 : 1.15), left[t]--;
        }
      }
    }
    // 3. Scattered remainder.
    for (const t of types) {
      for (let i = 0, guard = 0; left[t] > 0 && guard < counts[t] * 4; guard++) {
        const p = this.findSpot(rng, { maxR: 590, minNy: range[t].minNy, avoidSite: 25 });
        if (!p || !fits(t, p.x, p.z)) continue;
        make(t, p.x, p.z, 1);
        left[t]--;
        i++;
      }
    }
  }

  // ---------------------------------------------------------------- points of interest (new worlds)

  private buildGenericPois(): void {
    const id = this.def.id;
    const L = this.look;
    const P = this.def.palette;
    const hostile = this.def.biome === "hostile";
    const M = {
      metal: this.mat(`poi-metal-${id}`, { albedo: hostile ? new Color3(0.2, 0.19, 0.22) : new Color3(0.58, 0.58, 0.64), roughness: 0.45, metallic: 0.8, maps: "hull", mapScale: 1, world: { atmosphere: true } }),
      dark: this.mat(`poi-dark-${id}`, { albedo: new Color3(0.09, 0.085, 0.1), roughness: 0.5, metallic: 0.6, world: { atmosphere: true } }),
      stone: this.mat(`poi-stone-${id}`, {
        albedo: this.def.biome === "lush" ? new Color3(0.62, 0.66, 0.58) : new Color3(P.rock[0] * 1.5 + 0.08, P.rock[1] * 1.5 + 0.08, P.rock[2] * 1.5 + 0.08),
        roughness: 0.8,
        world: { terrain: true, triplanar: true, rock: 0.9, atmosphere: true },
      }),
      glass: this.mat(`poi-glass-${id}`, { albedo: new Color3(0.4, 0.6, 0.9), roughness: 0.05, alpha: 0.72, emissive: new Color3(0.1, 0.25, 0.45), world: { atmosphere: true } }),
      alien: this.mat(`poi-alien-${id}`, { albedo: new Color3(0.78, 0.74, 0.86), roughness: 0.22, metallic: 0.65, emissive: c3(L.accent).scale(0.12), world: { atmosphere: true } }),
      obsidian: this.mat(`poi-obsidian-${id}`, { albedo: new Color3(0.05, 0.04, 0.06), roughness: 0.1, metallic: 0.3, emissive: new Color3(0.04, 0.01, 0.0), world: { atmosphere: true } }),
      glow: this.std(`gf-poi-glow-${id}`, c3(L.accent)),
      warn: this.std(`gf-poi-warn-${id}`, new Color3(1, 0.08, 0.05)),
      hot: this.std(`gf-poi-hot-${id}`, new Color3(1, 0.5, 0.12)),
    };
    let outpostIdx = 0;
    for (const d of this.def.pois) {
      const rid = runtimeId(this.def.id, d.id);
      const root = new TransformNode(`gf-poi-${rid}`, this.scene);
      const y = this.groundAt(d.x, d.z);
      root.position.set(d.x, y, d.z);
      const site = this.def.landingSite;
      root.rotation.y = Math.atan2(site.x - d.x, site.z - d.z);
      const kit = new Kit(this.scene, `gf-poi-${rid}`);
      const lights: Mesh[] = [];
      const warn: Mesh[] = [];
      this.buildPoiKind(d, kit, M, lights, warn, outpostIdx);
      if (d.kind === "outpost") outpostIdx++;
      for (const l of lights) kit.add(l, M.glow);
      for (const w of warn) kit.add(w, M.warn);
      const merged = kit.build(root, this.bindPart);
      const warnMesh = merged.get(M.warn);
      if (warnMesh) this.blinkers.push({ mesh: warnMesh, phase: d.x * 0.01, rate: 2.6 });
      const glowMesh = merged.get(M.glow);
      if (glowMesh && d.kind !== "stronghold") this.beaconMeshes.push(glowMesh);
      for (const m of merged.values()) m.freezeWorldMatrix();
      const cos = Math.cos(root.rotation.y), sin = Math.sin(root.rotation.y);
      for (const c of kit.colliders) {
        // Local (x, z) rotated by the root yaw (Babylon: x' = x cos + z sin, z' = -x sin + z cos).
        const wx = d.x + c.x * cos + c.z * sin, wz = d.z - c.x * sin + c.z * cos;
        this.addCollider({ x: wx, z: wz, r: c.r, top: y + c.h });
      }
      if (!kit.colliders.length) this.addCollider({ x: d.x, z: d.z, r: 2.2, top: y + 3 });
      this.pois.push({ id: rid, name: d.name, position: new Vector3(d.x, y + 1.5, d.z), lore: d.lore, loot: d.loot, root, kind: d.kind });
    }
    for (const p of this.pois) for (const m of p.root.getChildMeshes()) m.isPickable = false;
  }

  private buildPoiKind(d: PoiDef, k: Kit, M: Record<"metal" | "dark" | "stone" | "glass" | "alien" | "obsidian", GfMaterial> & Record<"glow" | "warn" | "hot", StandardMaterial>, lights: Mesh[], warn: Mesh[], outpostIdx: number): void {
    const sc = this.scene;
    const rng = createRng(this.def.seed ^ (d.x * 31 + d.z * 17));
    const lamp = (x: number, y: number, z: number, list: Mesh[], dia = 0.4) => {
      const m = MeshBuilder.CreateSphere(`${d.id}-lamp${list.length}`, { diameter: dia, segments: 4 }, sc);
      m.position.set(x, y, z);
      list.push(m);
    };
    const biome = this.def.biome;
    switch (d.kind) {
      case "facility": {
        // Survey station: main module, dome, antenna, side tanks, landing struts.
        k.box(11, 3.6, 6, 0, 2.4, 0, M.metal);
        k.box(11.4, 0.4, 6.4, 0, 4.4, 0, M.dark);
        k.sphere(6, 12, 6.2, 1.2, 0, M.glass, 0.5);
        k.cyl(2.2, 6.4, 6.6, 16, 6.2, 0.4, 0, M.metal);
        k.cyl(10, 0.18, 0.3, 6, -4, 9.4, -1.8, M.metal);
        k.cyl(0.2, 2.6, 0.5, 14, -4, 13.6, -1.8, M.metal, 0.5);
        for (const s of [-1, 1]) k.cyl(5, 1.6, 1.6, 10, -2, 1.2, s * 4.2, M.dark, 0, 0, Math.PI / 2);
        for (const x of [-5, 5]) for (const z of [-2.6, 2.6]) k.cyl(1.4, 0.3, 0.5, 6, x, 0.4, z, M.dark);
        if (biome === "frozen") k.box(11.6, 0.5, 6.6, 0, 4.85, 0, M.stone);
        lamp(-4, 14.4, -1.8, lights, 0.5);
        lamp(5.6, 3.6, 3.1, lights);
        k.collide(0, 0, 6.2, 4.6);
        k.collide(6.2, 0, 3.4, 3.5);
        k.collide(-2, 4.2, 1.8, 2.2);
        k.collide(-2, -4.2, 1.8, 2.2);
        break;
      }
      case "miningStation": {
        // Extraction rig: derrick, tanks, pipes, conveyor ramp.
        const top = new Vector3(0, 15, 0);
        for (let i = 0; i < 4; i++) {
          const a = i * Math.PI / 2 + Math.PI / 4;
          k.strut(new Vector3(Math.cos(a) * 4, 0, Math.sin(a) * 4), top, 0.45, M.metal);
        }
        for (const h of [4, 8, 11.5]) {
          const r = 4 * (1 - h / 15) * Math.SQRT2;
          k.box(r * 1.05, 0.25, 0.25, 0, h, r / 2, M.metal);
          k.box(r * 1.05, 0.25, 0.25, 0, h, -r / 2, M.metal);
        }
        k.box(2, 1.6, 2, 0, 15.4, 0, M.dark);
        k.cyl(14, 0.6, 0.6, 8, 0, 7, 0, M.dark);
        for (let i = 0; i < 3; i++) k.cyl(5.5, 3, 3, 14, 8, 2.75, -4 + i * 4, M.metal);
        k.cyl(9, 0.5, 0.5, 8, 4.5, 4.6, 0, M.dark, 0, 0, Math.PI / 2);
        k.box(1.6, 0.4, 14, -6, 3, 4, M.dark, 0, -0.38);
        k.box(5, 2.6, 4, -6, 1.3, -4, M.metal);
        if (biome === "volcanic" || biome === "frozen") k.cyl(0.6, 3, 3.4, 16, 0, 0.3, 0, M.dark);
        lamp(0, 16.6, 0, lights, 0.6);
        lamp(8, 5.8, -4, lights);
        lamp(8, 5.8, 4, lights);
        if (biome === "volcanic") {
          // Molten feed pool under the derrick.
          const pool = MeshBuilder.CreateCylinder(`${d.id}-melt`, { height: 0.2, diameter: 2.6, tessellation: 16 }, sc);
          pool.position.set(0, 0.5, 0);
          k.add(pool, M.hot);
        }
        k.collide(0, 0, 4, 6);
        for (let i = 0; i < 3; i++) k.collide(8, -4 + i * 4, 1.8, 5.5);
        k.collide(-6, -4, 3, 2.6);
        break;
      }
      case "ruin": {
        // Broken fluted columns, a fallen lintel, a cracked platform.
        k.box(16, 0.8, 12, 0, 0.1, 0, M.stone);
        const n = 8;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          const x = Math.cos(a) * 6.2, z = Math.sin(a) * 4.6;
          const h = rng() < 0.35 ? 1.2 + rng() * 2 : 4 + rng() * 4.5;
          k.cyl(h, 0.9, 1.1, 10, x, h / 2 + 0.4, z, M.stone);
          k.collide(x, z, 0.8, h + 0.4);
        }
        k.cyl(6, 0.9, 0.9, 10, 2, 1, 6.6, M.stone, 0, 0.6, Math.PI / 2);
        k.box(7.5, 1.1, 1.4, -1.5, 8.4, -4.6, M.stone);
        k.cyl(8, 1.2, 1.3, 10, -5, 4.4, -4.6, M.stone);
        k.cyl(8, 1.2, 1.3, 10, 2, 4.4, -4.6, M.stone);
        k.collide(-5, -4.6, 1, 8.4);
        k.collide(2, -4.6, 1, 8.4);
        // Glowing glyph on the altar.
        k.box(2, 1.2, 1.2, 0, 1.1, 0, M.stone);
        lamp(0, 2, 0, lights, 0.6);
        break;
      }
      case "landmark":
        this.buildLandmark(d, k, M, lights);
        break;
      case "wreck": {
        // A crashed hull, broken wing and scattered plating.
        k.cyl(14, 3.2, 4.2, 12, 0, 1.6, 0, M.metal, Math.PI / 2 - 0.12, 0.3, 0.25);
        k.cyl(3, 1.4, 3.2, 12, -0.4, 2.4, 8.2, M.dark, Math.PI / 2 - 0.12, 0.3, 0.25);
        k.box(9, 0.4, 3.2, 4.2, 0.9, -1, M.metal, 0.3, 0, 0.35);
        k.box(5, 0.3, 2.6, -4.8, 0.3, 3, M.metal, 1.2, 0.1, -0.2);
        for (let i = 0; i < 6; i++) k.box(0.8 + rng() * 1.6, 0.2, 0.6 + rng(), (rng() - 0.5) * 18, 0.2, (rng() - 0.5) * 14, M.dark, rng() * 3, rng() * 0.4);
        lamp(-0.6, 3.4, -5.6, lights, 0.45);
        k.collide(0, 0, 3.6, 3.6);
        k.collide(1.3, 4.2, 3, 3.2);
        k.collide(-1.2, -4.2, 3, 3.2);
        break;
      }
      case "cache": {
        k.box(1.8, 1.1, 1.2, 0, 0.55, 0, M.metal, 0.3);
        k.box(1.86, 0.12, 1.26, 0, 0.9, 0, M.dark, 0.3);
        k.cyl(3, 0.08, 0.12, 5, 1.4, 1.5, 0.4, M.dark);
        lamp(1.4, 3.1, 0.4, lights, 0.35);
        k.collide(0, 0, 1.3, 1.2);
        break;
      }
      case "outpost":
        if (biome === "hostile") this.buildAshveilOutpost(k, M, lights, warn, rng);
        else if (outpostIdx % 2 === 0) {
          // Alien spindle tower with floating rings.
          k.cyl(1.2, 9, 10, 6, 0, 0.6, 0, M.alien);
          k.cyl(26, 0.3, 2.6, 6, 0, 13.6, 0, M.alien);
          for (let i = 0; i < 3; i++) k.torus(5 - i * 1.2, 0.28, 0, 7 + i * 6, 0, M.alien, 0.2 * (i - 1), 0.15 * i);
          lamp(0, 27.2, 0, lights, 0.9);
          for (let i = 0; i < 6; i++) lamp(Math.cos(i * 1.047) * 4.4, 1.3, Math.sin(i * 1.047) * 4.4, lights, 0.35);
          k.collide(0, 0, 2.2, 26);
        } else {
          // Alien dome with a tether climbing to the sky.
          k.sphere(12, 14, 0, 0, 0, M.alien, 0.5, 0.75);
          k.cyl(1.4, 13, 13.6, 20, 0, 0.3, 0, M.stone);
          k.cyl(140, 0.35, 0.5, 6, 0, 74, 0, M.alien);
          for (let i = 0; i < 6; i++) lamp(Math.cos(i * 1.047) * 6.6, 0.9, Math.sin(i * 1.047) * 6.6, lights, 0.4);
          lamp(0, 4.6, 0, lights, 0.7);
          k.collide(0, 0, 6.2, 4.4);
        }
        break;
      case "stronghold":
        this.buildStronghold(k, M, lights, warn);
        break;
      case "monolith": {
        k.box(2.2, 9, 0.8, 0, 4.2, 0, M.obsidian, 0, 0, 0.06);
        k.torus(1.4, 0.08, 0, 6.2, 0.42, M.glow as unknown as GfMaterial, Math.PI / 2);
        k.collide(0, 0, 1.6, 9);
        break;
      }
      default: {
        // Anomaly / orbital debris: a floating crystal with rings.
        const c = this.crystalMesh(`${d.id}-anomaly`, 5, 7, 2, 1);
        c.position.y = 2.5;
        k.add(c, M.alien);
        k.torus(5, 0.12, 0, 3.5, 0, M.alien, 0.4);
        lamp(0, 5.5, 0, lights, 0.7);
        k.collide(0, 0, 1.6, 4);
      }
    }
  }

  private buildLandmark(d: PoiDef, k: Kit, M: Record<"metal" | "dark" | "stone" | "glass" | "alien" | "obsidian", GfMaterial> & Record<"glow" | "warn" | "hot", StandardMaterial>, lights: Mesh[]): void {
    const sc = this.scene;
    switch (this.def.biome) {
      case "lush": {
        // The Elder Canopy: a vast lantern willow.
        const src = this.sources.willow;
        if (src) {
          const inst = src.createInstance(`${d.id}-elder`);
          inst.position.set(d.x, this.groundAt(d.x, d.z) - 0.6, d.z);
          inst.scaling.setAll(3.8);
          inst.isPickable = false;
          inst.freezeWorldMatrix();
        }
        k.torus(9, 0.18, 0, 0.25, 0, M.stone);
        for (let i = 0; i < 8; i++) lamp(Math.cos(i * 0.785) * 4.5, 0.35, Math.sin(i * 0.785) * 4.5, lights);
        k.collide(0, 0, 2.2, 30);
        return;
      }
      case "frozen": {
        // The Frozen Choir: a ring of ice arches around a central spire.
        const src = this.sources.arch;
        const gy = this.groundAt(d.x, d.z);
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          const x = d.x + Math.cos(a) * 15, z = d.z + Math.sin(a) * 15;
          if (src) {
            const inst = src.createInstance(`${d.id}-arch${i}`);
            inst.position.set(x, gy - 0.3, z);
            inst.rotation.y = -a + Math.PI / 2;
            inst.scaling.setAll(0.75);
            inst.isPickable = false;
            inst.freezeWorldMatrix();
          }
        }
        const spire = this.crystalMesh(`${d.id}-spire`, 7, 13, 4, 1);
        spire.scaling.setAll(1.8);
        this.paint(spire, [0.62, 0.82, 1], [0.95, 1, 1]);
        k.add(spire, M.glass);
        lamp(0, 0.6, 0, lights, 0.8);
        k.collide(0, 0, 2, 12);
        return;
      }
      case "volcanic": {
        // The Obsidian Throne: a split volcanic plug shaped like a seat.
        const block = (sx: number, sy: number, sz: number, x: number, y: number, z: number, seed: number) => {
          const r = this.rockMesh(`${d.id}-blk${seed}`, seed, 2, (px, py) => (py > 0.4 ? [0.1, 0.08, 0.1] : [0.05, 0.04, 0.06]));
          r.scaling.set(sx, sy, sz);
          r.position.set(x, y, z);
          k.add(r, M.obsidian);
        };
        block(9, 5, 7, 0, 2, 0, 3);
        block(9, 14, 3, 0, 8, -4.5, 4);
        block(2.4, 6, 6, -5.2, 4.2, 0.5, 5);
        block(2.4, 6, 6, 5.2, 4.2, 0.5, 6);
        for (let i = 0; i < 14; i++) {
          const n = MeshBuilder.CreateIcoSphere(`${d.id}-nug${i}`, { radius: 0.25 + (i % 3) * 0.08, subdivisions: 1, flat: true }, sc);
          n.position.set(4.8 + ((i * 7) % 5) * 0.2, 7.8 + (i % 4) * 0.25, ((i * 3) % 5) * 0.3 - 0.4);
          k.add(n, M.hot);
        }
        k.collide(0, 0, 5, 4.5);
        k.collide(0, -4.5, 4.5, 14);
        return;
      }
      case "exotic": {
        // The Hanging Gate: a stone arch floating above the plain.
        const src = this.sources.arch;
        const gy = this.groundAt(d.x, d.z);
        if (src) {
          const inst = src.createInstance(`${d.id}-gate`);
          inst.position.set(d.x, gy + 18, d.z);
          inst.scaling.setAll(0.9);
          inst.rotation.y = Math.atan2(this.def.landingSite.x - d.x, this.def.landingSite.z - d.z) + Math.PI / 2;
          inst.isPickable = false;
          inst.freezeWorldMatrix();
        }
        for (let i = 0; i < 5; i++) {
          const r = this.rockMesh(`${d.id}-shard${i}`, 40 + i, 1, () => [0.55, 0.42, 0.5]);
          r.scaling.setAll(1.2 + i * 0.3);
          r.position.set(Math.cos(i * 1.3) * 9, 4 + i * 2.6, Math.sin(i * 1.3) * 9);
          k.add(r, M.stone);
        }
        k.cyl(0.5, 8, 9, 16, 0, 0.2, 0, M.alien);
        lamp(0, 1, 0, lights, 1);
        k.collide(0, 0, 4.4, 1.2);
        return;
      }
      default: {
        k.box(2.2, 9, 0.8, 0, 4.2, 0, M.obsidian);
        lamp(0, 6.2, 0.5, lights);
        k.collide(0, 0, 1.6, 9);
      }
    }

    function lamp(x: number, y: number, z: number, list: Mesh[], dia = 0.4) {
      const m = MeshBuilder.CreateSphere(`${d.id}-lamp${list.length}`, { diameter: dia, segments: 4 }, sc);
      m.position.set(x, y, z);
      list.push(m);
    }
  }

  /** Ashveil syndicate outpost: fence, watch towers, gun post, fuel tanks, red warning lamps. */
  private buildAshveilOutpost(k: Kit, M: Record<"metal" | "dark", GfMaterial>, lights: Mesh[], warn: Mesh[], rng: Rng): void {
    const sc = this.scene;
    const lamp = (x: number, y: number, z: number, list: Mesh[], dia = 0.45) => {
      const m = MeshBuilder.CreateSphere(`ashveil-lamp${list.length}`, { diameter: dia, segments: 4 }, sc);
      m.position.set(x, y, z);
      list.push(m);
    };
    // Fence posts ring.
    for (let i = 0; i < 14; i++) {
      if (i === 0 || i === 1) continue;
      const a = (i / 14) * Math.PI * 2;
      k.cyl(2.6, 0.22, 0.22, 4, Math.cos(a) * 14, 1.3, Math.sin(a) * 14, M.dark);
      k.box(6.4, 0.25, 0.12, Math.cos(a + 0.22) * 13.8, 2.1, Math.sin(a + 0.22) * 13.8, M.dark, -(a + 0.22) + Math.PI / 2);
      k.collide(Math.cos(a) * 14, Math.sin(a) * 14, 1.4, 2.6);
    }
    // Two watch towers.
    for (const s of [-1, 1]) {
      const tx = s * 8, tz = -6;
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.strut(new Vector3(tx + dx * 1.6, 0, tz + dz * 1.6), new Vector3(tx + dx * 1, 9, tz + dz * 1), 0.3, M.dark);
      k.box(3.4, 2.2, 3.4, tx, 10, tz, M.metal);
      k.box(3.8, 0.3, 3.8, tx, 11.3, tz, M.dark);
      lamp(tx, 11.8, tz, warn, 0.6);
      k.collide(tx, tz, 2, 11);
    }
    // Barracks and fuel tanks.
    k.box(9, 3, 4.5, 0, 1.5, 4, M.metal);
    k.box(9.4, 0.3, 4.9, 0, 3.1, 4, M.dark);
    for (let i = 0; i < 3; i++) k.cyl(4, 2.2, 2.2, 12, -6 + i * 2.6, 2, -1, M.dark, 0, 0, 0);
    // Gun post.
    k.cyl(1.6, 2.4, 3, 10, 4, 0.8, -1, M.dark);
    k.box(1.8, 1, 1.8, 4, 2.1, -1, M.metal);
    k.cyl(3.2, 0.28, 0.28, 6, 4, 2.4, -2.6, M.dark, Math.PI / 2 - 0.25);
    lamp(-4.6, 3.3, 6.2, warn);
    lamp(4.6, 3.3, 6.2, warn);
    lamp(0, 3.5, 4, lights, 0.35);
    void rng;
    k.collide(0, 4, 4.8, 3.2);
    k.collide(-3.4, -1, 3.4, 4);
    k.collide(4, -1, 1.8, 2.6);
  }

  /** Ashveil Bastion: curtain wall with towers, a central keep and a docking spire. */
  private buildStronghold(k: Kit, M: Record<"metal" | "dark", GfMaterial>, lights: Mesh[], warn: Mesh[]): void {
    const sc = this.scene;
    const lamp = (x: number, y: number, z: number, list: Mesh[], dia = 0.7) => {
      const m = MeshBuilder.CreateSphere(`bastion-lamp${list.length}`, { diameter: dia, segments: 4 }, sc);
      m.position.set(x, y, z);
      list.push(m);
    };
    const R = 30, segs = 16;
    for (let i = 0; i < segs; i++) {
      if (i === 0) continue; // gate gap faces the landing site
      const a0 = ((i - 0.5) / segs) * Math.PI * 2 + Math.PI / 2, a1 = ((i + 0.5) / segs) * Math.PI * 2 + Math.PI / 2;
      const am = (a0 + a1) / 2;
      const len = 2 * R * Math.sin(Math.PI / segs) + 0.4;
      k.box(len, 8, 2.2, Math.cos(am) * R, 4, Math.sin(am) * R, M.dark, -am + Math.PI / 2);
      k.box(len, 0.8, 2.8, Math.cos(am) * R, 8.3, Math.sin(am) * R, M.metal, -am + Math.PI / 2);
      for (const t of [-0.33, 0, 0.33]) {
        const a = am + (t * Math.PI * 2) / segs;
        k.collide(Math.cos(a) * R, Math.sin(a) * R, 2.6, 8.6);
      }
    }
    // Corner towers.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const x = Math.cos(a) * R, z = Math.sin(a) * R;
      k.cyl(16, 4.4, 5.6, 8, x, 8, z, M.dark);
      k.cyl(1.4, 6.4, 6, 8, x, 16.6, z, M.metal);
      lamp(x, 17.8, z, warn);
      k.collide(x, z, 3.2, 17);
    }
    // Gate towers flanking the opening.
    for (const s of [-1, 1]) {
      const a = Math.PI / 2 + (s * Math.PI) / segs;
      const x = Math.cos(a) * R, z = Math.sin(a) * R;
      k.cyl(12, 3.2, 4, 8, x, 6, z, M.dark);
      lamp(x, 12.6, z, warn, 0.8);
      k.collide(x, z, 2.4, 12.5);
    }
    // Keep and docking spire.
    k.box(16, 12, 16, 0, 6, -4, M.metal);
    k.box(17, 1, 17, 0, 12.4, -4, M.dark);
    k.box(10, 5, 10, 0, 15.4, -4, M.dark);
    k.cyl(42, 1.2, 3.4, 8, 0, 33, -4, M.dark);
    k.cyl(0.6, 12, 12, 16, 0, 40, -4, M.metal);
    lamp(0, 54.6, -4, warn, 1.2);
    lamp(0, 40.6, 2, warn, 0.8);
    lamp(0, 40.6, -10, warn, 0.8);
    for (let i = 0; i < 6; i++) lamp(-6 + i * 2.4, 9, 4.1, lights, 0.45);
    k.collide(0, -4, 9, 18);
    // Hangar pad lights inside the walls.
    for (let i = 0; i < 6; i++) lamp(Math.cos(i * 1.047) * 8, 0.3, 14 + Math.sin(i * 1.047) * 5, warn, 0.4);
  }

  /** Counts for profiling. */
  stats(): { decorInstances: number; deposits: number; terrainChunks: number; propInstances: number; pois: number; buildMs: number } {
    return {
      decorInstances: this.scatter.reduce((n, f) => n + f.instances, 0),
      deposits: this.deposits.length,
      terrainChunks: this.terrainChunks.length,
      propInstances: this.propSources.reduce((n, s) => n + s.instances.length, 0),
      pois: this.pois.length,
      buildMs: Math.round(this.buildMs),
    };
  }

  /**
   * Frees every mesh, material, texture, light, particle system and node this
   * planet created (MaterialLibrary materials it made are released through
   * `lib.release`; shared library materials and SurfaceTextures are untouched).
   * Safe to call twice. Call after Renderer.setWorld has moved to the next planet.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.weather?.dispose();
    this.weather = null;
    const o = this.owned;
    for (const m of o.meshes) if (!m.isDisposed()) m.dispose(false, false);
    for (const n of o.nodes) if (!n.isDisposed()) n.dispose(false, false);
    const libOwned = new Set<unknown>();
    for (const m of this.gfMats) for (const x of [m.std, m.pbr]) if (x) libOwned.add(x);
    for (const m of this.gfMats) this.lib.release(m);
    this.gfMats.length = 0;
    const scene = this.scene;
    for (const m of o.materials) if (!libOwned.has(m) && scene.materials.includes(m as never)) (m as { dispose(a?: boolean, b?: boolean): void }).dispose(false, false); // keep cached effects: they are shared with other PBR materials (the ship)
    for (const t of o.textures) {
      if (!scene.textures.includes(t as never)) continue;
      // Babylon creates the environment BRDF lookup lazily when the first PBR material is built, which can
      // happen inside a Planet constructor. It is scene-wide: disposing it makes every PBR material unready.
      if (/EnvironmentBRDF/i.test((t as { name?: string }).name ?? "")) continue;
      if (this.lib.isView(t)) this.lib.disposeView(t as Texture);
      else (t as { dispose(): void }).dispose();
    }
    this.lavaTex?.dispose();
    this.lavaTex = null;
    for (const p of o.particles) (p as { dispose(): void }).dispose();
    for (const l of o.lights) (l as { dispose(): void }).dispose();
    this.sky.dispose();
    this.deposits.length = 0;
    this.pois.length = 0;
    this.colliders.length = 0;
    this.grid.clear();
    this.scatter.length = 0;
    this.beaconMeshes = [];
    this.blinkers = [];
    this.spinners = [];
    this.water = null;
  }
}
