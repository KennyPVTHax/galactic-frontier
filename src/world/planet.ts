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
} from "../engine/babylon";
import { SimplexNoise, createRng, rngRange, smoothstep, clamp, type Rng } from "../core/random";
import { WORLD } from "../core/worldConfig";
import type { ResourceId } from "../gameplay/resources";
import { Heightfield, createTerrainFunction, type HeightFn } from "./heightfield";
import { Sky } from "./sky";
import type { GfMaterial, MaterialLibrary } from "../graphics/materials";

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

export interface PointOfInterest {
  id: string;
  name: string;
  position: Vector3;
  lore: string;
  loot: Partial<Record<ResourceId, number>>;
  root: TransformNode;
}

/** Collision / gameplay grid is identical in every graphics tier. */
export const TERRAIN_RES = 256;
const CHUNKS = 8;

const SUN_DIR = new Vector3(-0.62, 0.4, -0.67).normalize();

export const SKY_COLORS = {
  zenith: new Color3(0.07, 0.05, 0.2),
  horizon: new Color3(0.78, 0.46, 0.55),
  ground: new Color3(0.14, 0.09, 0.15),
  sun: new Color3(1.0, 0.86, 0.68),
};

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
  ) {
    const cell = WORLD.terrainSize / CHUNKS;
    const buckets = new Map<string, Float32Array[]>();
    for (const m of matrices) {
      const key = `${Math.floor((m[12] + WORLD.terrainSize / 2) / cell)},${Math.floor((m[14] + WORLD.terrainSize / 2) / cell)}`;
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

/**
 * The planet Veyra-7: terrain, atmosphere, lighting, scenery, resource
 * deposits and points of interest. Rendering + spatial queries.
 */
export class Planet {
  readonly heightFn: HeightFn;
  readonly heightfield: Heightfield;
  readonly terrainChunks: Mesh[] = [];
  readonly sky: Sky;
  readonly sun: DirectionalLight;
  readonly ambient: HemisphericLight;
  readonly deposits: Deposit[] = [];
  readonly pois: PointOfInterest[] = [];
  readonly colliders: Collider[] = [];
  readonly sunDirection = SUN_DIR.clone();
  readonly scatter: ScatterField[] = [];
  /** Instanced source meshes of rocks & deposits (shadow casters / LOD). */
  readonly propSources: Mesh[] = [];
  private readonly propLowLods: Mesh[] = [];
  private grid = new Map<string, Collider[]>();
  private readonly gridCell = 24;
  private readonly noise: SimplexNoise;
  private beaconMeshes: Mesh[] = [];
  private water!: Mesh;
  private waterWaves = true;
  private time = 0;
  private lod = { high: -1, cull: -1, terrain: -1 };

  constructor(
    private readonly scene: Scene,
    private readonly lib: MaterialLibrary,
  ) {
    this.noise = new SimplexNoise(WORLD.seed + 3);
    this.heightFn = createTerrainFunction(WORLD.seed);
    this.heightfield = new Heightfield(this.heightFn, WORLD.terrainSize, TERRAIN_RES);

    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogDensity = 0.0016;
    scene.fogColor = SKY_COLORS.horizon.scale(0.82);
    scene.ambientColor = new Color3(0.25, 0.2, 0.32);

    this.sky = new Sky(scene, SUN_DIR, SKY_COLORS);
    this.sun = new DirectionalLight("gf-sun", SUN_DIR.scale(-1), scene);
    this.sun.intensity = 1.75;
    this.sun.diffuse = new Color3(1.0, 0.86, 0.72);
    this.sun.specular = new Color3(0.6, 0.5, 0.45);
    this.ambient = new HemisphericLight("gf-amb", new Vector3(0, 1, 0), scene);
    this.ambient.intensity = 0.62;
    this.ambient.diffuse = new Color3(0.55, 0.5, 0.86);
    this.ambient.groundColor = new Color3(0.26, 0.16, 0.22);
    this.ambient.specular = Color3.Black();

    this.buildTerrain();
    this.buildLiquid();
    this.buildBackdrop();
    this.buildBoulders();
    this.buildDecor();
    this.buildDeposits();
    this.buildPois();
    this.buildSurveyBeacon();
    // LOD meshes must be attached before the first frame or they render standalone.
    this.setPropLod(70, 480, 380);
    this.setDecorDensity(0.7, 0.45, 260);
  }

  // ---------------------------------------------------------------- queries

  groundAt(x: number, z: number): number {
    return this.heightfield.heightAt(x, z);
  }

  normalYAt(x: number, z: number): number {
    return this.heightfield.normalAt(x, z).y;
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

  update(dt: number, camera: Vector3): void {
    this.time += dt;
    this.sky.update(dt);
    const pulse = 0.55 + 0.45 * Math.sin(this.time * 3);
    for (const m of this.beaconMeshes) m.visibility = pulse;
    if (this.waterWaves) {
      const b = (this.water.material as unknown as { bumpTexture?: { uOffset: number; vOffset: number } | null } | null)?.bumpTexture;
      if (b) {
        b.uOffset = (this.time * 0.006) % 1;
        b.vOffset = (this.time * 0.0045) % 1;
      }
    }
    void camera;
  }

  // ---------------------------------------------------------------- renderer hooks

  setDecorDensity(decor: number, grass: number, distance: number): void {
    const reach: Record<string, number> = { "gf-grass": 0.5, "gf-pebbles": 0.55, "gf-spikes": 0.75, "gf-glowcaps": 0.8, "gf-fronds": 1 };
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
      if (low && high > 0) src.addLODLevel(high, low);
      src.addLODLevel(cull, null);
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

  // ---------------------------------------------------------------- terrain

  private terrainColor(x: number, z: number, h: number, ny: number): [number, number, number] {
    const n = this.noise;
    const v = n.fbm(x / 45, z / 45, 3);
    const v2 = n.noise2(x / 9, z / 9);
    const moss: [number, number, number] = [0.15, 0.36, 0.36];
    const soil: [number, number, number] = [0.46, 0.3, 0.37];
    const rock: [number, number, number] = [0.3, 0.27, 0.37];
    const frost: [number, number, number] = [0.82, 0.78, 0.9];
    const basalt: [number, number, number] = [0.13, 0.12, 0.18];
    const mix3 = (a: number[], b: number[], t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    let c = mix3(moss, soil, smoothstep(-0.2, 0.35, v + (h - 2) * 0.03));
    c = mix3(c, basalt, smoothstep(-2, -9, h) * 0.75);
    const steep = smoothstep(0.86, 0.68, ny);
    c = mix3(c, rock, steep);
    c = mix3(c, frost, smoothstep(70, 130, h + v * 20) * (1 - steep * 0.6));
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
    const mat = this.lib.make("terrain", { albedo: new Color3(1, 1, 1), roughness: 0.94, vertexColors: true, world: { terrain: true, triplanar: true, atmosphere: true } });
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
    const m = MeshBuilder.CreateGround("gf-liquid", { width: WORLD.terrainSize * 1.1, height: WORLD.terrainSize * 1.1, subdivisions: 2 }, this.scene);
    m.position.y = WORLD.liquidLevel;
    const mat = this.lib.make("liquid", {
      albedo: new Color3(0.05, 0.2, 0.26),
      roughness: 0.07,
      metallic: 0,
      emissive: new Color3(0.03, 0.28, 0.32),
      alpha: 0.88,
      maps: "water",
      mapScale: 70,
      world: { atmosphere: true },
    });
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
    for (let ri = 0; ri <= rings; ri++) {
      const t = ri / rings;
      const r = r0 + (r1 - r0) * t;
      for (let s = 0; s <= seg; s++) {
        const a = (s / seg) * Math.PI * 2;
        const ridge = n.ridged(Math.cos(a) * 3 + t * 0.8, Math.sin(a) * 3 + t * 0.8, 5);
        positions.push(Math.cos(a) * r, -40 + Math.sin(t * Math.PI) * (180 + ridge * 520), Math.sin(a) * r);
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
    mat.diffuseColor = new Color3(0.22, 0.14, 0.3);
    mat.emissiveColor = SKY_COLORS.horizon.scale(0.38);
    mat.specularColor = Color3.Black();
    mat.fogEnabled = false;
    mat.backFaceCulling = false;
    mesh.material = mat;
    mesh.applyFog = false;
    mesh.isPickable = false;
    mesh.freezeWorldMatrix();
  }

  // ---------------------------------------------------------------- props

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

  /** Bulb-flora (carbon source): curved stem, veined bulb and drooping leaves. */
  private floraMesh(name: string): Mesh {
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
    this.paint(stem, [0.16, 0.34, 0.27], [0.3, 0.55, 0.4]);
    this.paint(bulb, [0.35, 0.8, 0.48], [0.75, 1.0, 0.7]);
    this.paint(ring, [0.22, 0.5, 0.34]);
    leaves.forEach((l) => this.paint(l, [0.14, 0.4, 0.34]));
    const m = Mesh.MergeMeshes([stem, bulb, ring, ...leaves], true)!;
    m.isPickable = false;
    return m;
  }

  private findSpot(rng: Rng, opts: { minR?: number; maxR: number; cx?: number; cz?: number; minNy?: number; avoidSite?: number; tries?: number }): { x: number; z: number } | null {
    const fn = this.heightFn;
    const cx = opts.cx ?? 0;
    const cz = opts.cz ?? 0;
    for (let t = 0; t < (opts.tries ?? 12); t++) {
      const a = rng() * Math.PI * 2;
      const r = (opts.minR ?? 0) + Math.sqrt(rng()) * (opts.maxR - (opts.minR ?? 0));
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      const h = fn(x, z);
      if (h < WORLD.liquidLevel + 0.6) continue;
      const e = 2;
      const nx = fn(x - e, z) - fn(x + e, z);
      const nz = fn(x, z - e) - fn(x, z + e);
      const ny = (2 * e) / Math.hypot(nx, 2 * e, nz);
      if (ny < (opts.minNy ?? 0.82)) continue;
      const s = WORLD.surveySite;
      if (opts.avoidSite && Math.hypot(x - s.x, z - s.z) < opts.avoidSite) continue;
      if (Math.hypot(x, z) > 600) continue;
      return { x, z };
    }
    return null;
  }

  /** Registers a prop source with a cheap far LOD. */
  private propSource(hi: Mesh, lo: Mesh, mat: GfMaterial): void {
    hi.isVisible = false;
    lo.isVisible = false;
    this.lib.bind(hi, mat);
    this.lib.bind(lo, mat);
    this.propSources.push(hi);
    this.propLowLods.push(lo);
  }

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
    const mat = this.lib.make("boulder", { albedo: new Color3(1, 1, 1), roughness: 0.88, vertexColors: true, world: { terrain: true, triplanar: true, rock: 0.85, atmosphere: true } });
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
    const place = (count: number, opts: Parameters<Planet["findSpot"]>[1], make: (x: number, y: number, z: number) => [number, number, number, number, number] | null) => {
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
    const pebbleMat = this.lib.make("pebble", { albedo: new Color3(1, 1, 1), roughness: 0.9, vertexColors: true, world: { terrain: true, rock: 0.6, atmosphere: true } });
    this.scatter.push(new ScatterField("gf-pebbles", pebble, place(2600, { maxR: 560, minNy: 0.7, tries: 3 }, () => {
      const s = rngRange(rng, 0.12, 0.55);
      return [s * 1.2, s, s * 1.1, rng() * 6.28, s * 0.25];
    }), this.lib, pebbleMat, rng));

    // Crystal spikes
    const spike = MeshBuilder.CreateCylinder("gf-spike", { height: 1, diameterTop: 0, diameterBottom: 0.12, tessellation: 5 }, this.scene);
    spike.position.y = 0.5;
    spike.bakeCurrentTransformIntoVertices();
    this.paint(spike, [0.3, 0.5, 0.48], [0.62, 0.9, 0.85]);
    const spikeMat = this.lib.make("spike", { albedo: new Color3(1, 1, 1), roughness: 0.4, vertexColors: true, emissive: new Color3(0.03, 0.1, 0.09), world: { wind: 0.03, atmosphere: true } });
    this.scatter.push(new ScatterField("gf-spikes", spike, place(2200, { maxR: 540, minNy: 0.74, tries: 3 }, (x, y) => {
      if (y > 30) return null;
      const s = rngRange(rng, 0.5, 1.4);
      return [s, s, s, rng() * 6.28, 0.05];
    }), this.lib, spikeMat, rng));

    // Alien fronds (lowlands)
    const frond = this.frondMesh();
    const frondMat = this.lib.make("frond", { albedo: new Color3(1, 1, 1), roughness: 0.65, vertexColors: true, backFaceCulling: false, world: { wind: 0.05, atmosphere: true } });
    this.scatter.push(new ScatterField("gf-fronds", frond, place(900, { maxR: 520, minNy: 0.82, tries: 4 }, (x, y) => {
      if (y > 12) return null;
      const s = rngRange(rng, 0.8, 1.7);
      return [s, s * rngRange(rng, 0.8, 1.3), s, rng() * 6.28, 0.05];
    }), this.lib, frondMat, rng));

    // Glow caps near the luminous lakes
    const cap = this.glowCapMesh();
    const capMat = this.lib.make("glowcap", { albedo: new Color3(1, 1, 1), roughness: 0.5, vertexColors: true, emissive: new Color3(0.12, 0.24, 0.36), world: { wind: 0.015, atmosphere: true } });
    this.scatter.push(new ScatterField("gf-glowcaps", cap, place(1400, { maxR: 560, minNy: 0.78, tries: 5 }, (x, y) => {
      if (y > WORLD.liquidLevel + 6) return null;
      const s = rngRange(rng, 0.5, 1.2);
      return [s, s, s, rng() * 6.28, 0.02];
    }), this.lib, capMat, rng));

    // Grass tufts (Enhanced / Ultra)
    const tuft = this.grassMesh();
    const grassMat = this.lib.make("grass", { albedo: new Color3(1, 1, 1), roughness: 0.75, vertexColors: true, backFaceCulling: false, world: { wind: 0.16, atmosphere: true } });
    this.scatter.push(new ScatterField("gf-grass", tuft, place(14000, { maxR: 480, minNy: 0.86, tries: 2 }, (x, y, z) => {
      if (y > 20) return null;
      // Grass grows where the ground colour is mossy.
      const v = this.noise.fbm(x / 45, z / 45, 3);
      if (v + (y - 2) * 0.03 > 0.15) return null;
      const s = rngRange(rng, 0.6, 1.25);
      return [s, s * rngRange(rng, 0.7, 1.4), s, rng() * 6.28, 0.04];
    }), this.lib, grassMat, rng));
  }

  /** Alien frond: six arching ribbon leaves (48 triangles). */
  private frondMesh(): Mesh {
    const pos: number[] = [], col: number[] = [], idx: number[] = [], nrm: number[] = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      const len = 1.6 + (i % 3) * 0.35;
      const dx = Math.cos(a), dz = Math.sin(a);
      const px = -dz, pz = dx;
      const base = pos.length / 3;
      for (let k = 0; k <= 4; k++) {
        const t = k / 4;
        const r = t * len * 0.7;
        const y = Math.sin(t * Math.PI * 0.75) * len * 0.75;
        const w = 0.16 * Math.sin((t * 0.85 + 0.1) * Math.PI);
        pos.push(dx * r - px * w, y, dz * r - pz * w, dx * r + px * w, y, dz * r + pz * w);
        const c = [0.22 + t * 0.23, 0.2 + t * 0.55, 0.4 + t * 0.3];
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
    const m = new Mesh("gf-frond-src", this.scene);
    vd.applyToMesh(m);
    m.isPickable = false;
    return m;
  }

  private glowCapMesh(): Mesh {
    const parts: Mesh[] = [];
    const rng = createRng(91);
    for (let i = 0; i < 4; i++) {
      const h = 0.35 + rng() * 0.6;
      const stalk = MeshBuilder.CreateCylinder(`cap-s${i}`, { height: h, diameterTop: 0.05, diameterBottom: 0.08, tessellation: 4 }, this.scene);
      stalk.position.set((rng() - 0.5) * 0.6, h / 2, (rng() - 0.5) * 0.6);
      const capM = MeshBuilder.CreateSphere(`cap-c${i}`, { diameter: 0.34 + rng() * 0.2, segments: 4, slice: 0.5 }, this.scene);
      capM.position.set(stalk.position.x, h, stalk.position.z);
      capM.scaling.y = 0.6;
      this.paint(stalk, [0.3, 0.28, 0.4]);
      this.paint(capM, [0.45, 0.85, 1.0]);
      parts.push(stalk, capM);
    }
    const m = Mesh.MergeMeshes(parts, true)!;
    m.isPickable = false;
    return m;
  }

  private grassMesh(): Mesh {
    const pos: number[] = [], col: number[] = [], idx: number[] = [], nrm: number[] = [];
    const rng = createRng(17);
    for (let b = 0; b < 6; b++) {
      const a = rng() * Math.PI * 2;
      const r = rng() * 0.18;
      const bx = Math.cos(a) * r, bz = Math.sin(a) * r;
      const lean = (rng() - 0.5) * 0.5;
      const h = 0.4 + rng() * 0.35;
      const w = 0.075;
      const px = Math.cos(a + 1.57), pz = Math.sin(a + 1.57);
      const base = pos.length / 3;
      for (let k = 0; k <= 2; k++) {
        const t = k / 2;
        const ww = w * (1.15 - t);
        const cx = bx + Math.cos(a) * lean * t * t, cz = bz + Math.sin(a) * lean * t * t;
        pos.push(cx - px * ww, h * t, cz - pz * ww, cx + px * ww, h * t, cz + pz * ww);
        const c = [0.16 + t * 0.32, 0.38 + t * 0.42, 0.34 + t * 0.24];
        col.push(c[0], c[1], c[2], 1, c[0], c[1], c[2], 1);
        nrm.push(0, 1, 0, 0, 1, 0);
      }
      for (let k = 0; k < 2; k++) {
        const i0 = base + k * 2;
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

  /**
   * Deposits keep M1's exact random sequence so every deposit id, position,
   * size and amount matches existing saves.
   */
  private buildDeposits(): void {
    const rng = createRng(WORLD.seed + 202);
    const site = WORLD.surveySite;

    const vein = (x: number, y: number, z: number): [number, number, number] =>
      Math.sin(x * 5 + y * 3) * Math.cos(z * 4 - y * 2) > 0.35 ? [0.95, 0.46, 0.2] : [0.32, 0.26, 0.3];
    const ferriteHi = this.rockMesh("gf-ferrite", 21, 3, vein);
    const ferriteLo = this.rockMesh("gf-ferrite-lo", 21, 1, vein);
    this.propSource(ferriteHi, ferriteLo, this.lib.make("ferrite", { albedo: new Color3(1, 1, 1), roughness: 0.55, metallic: 0.35, vertexColors: true, emissive: new Color3(0.06, 0.02, 0.0), world: { terrain: true, triplanar: true, rock: 0.6, atmosphere: true } }));

    const lumHi = this.crystalMesh("gf-lumenite", 7, 31, 1.2, 2);
    const lumLo = this.crystalMesh("gf-lumenite-lo", 4, 31, 1.2, 1);
    this.propSource(lumHi, lumLo, this.lib.make("lumenite", { albedo: new Color3(0.25, 0.78, 0.92), roughness: 0.12, metallic: 0.05, emissive: new Color3(0.08, 0.58, 0.76), world: { atmosphere: true } }));

    const carbonHi = this.floraMesh("gf-carbon");
    const carbonLo = this.floraMesh("gf-carbon-lo");
    this.propSource(carbonHi, carbonLo, this.lib.make("carbon", { albedo: new Color3(1, 1, 1), roughness: 0.6, vertexColors: true, emissive: new Color3(0.06, 0.16, 0.08), world: { wind: 0.05, atmosphere: true } }));

    const voidHi = this.crystalMesh("gf-void", 5, 41, 2.0, 2);
    const voidLo = this.crystalMesh("gf-void-lo", 3, 41, 2.0, 1);
    this.propSource(voidHi, voidLo, this.lib.make("voidQuartz", { albedo: new Color3(0.5, 0.3, 0.8), roughness: 0.1, metallic: 0.1, emissive: new Color3(0.36, 0.12, 0.66), world: { atmosphere: true } }));

    const sources: Record<ResourceId, Mesh> = { ferrite: ferriteHi, lumenite: lumHi, carbon: carbonHi, voidQuartz: voidHi };

    const make = (type: ResourceId, idx: number, x: number, z: number, scale: number, amount: number) => {
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
        id: `${type}-${idx}`,
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
    };

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
    const metal = L.make("poi-metal", { albedo: new Color3(0.58, 0.58, 0.64), roughness: 0.45, metallic: 0.8, maps: "hull", mapScale: 1, world: { atmosphere: true } });
    const stone = L.make("poi-stone", { albedo: new Color3(0.1, 0.09, 0.13), roughness: 0.18, metallic: 0.2, emissive: new Color3(0.02, 0.01, 0.05), world: { atmosphere: true } });
    const glass = L.make("poi-glass", { albedo: new Color3(0.4, 0.6, 0.9), roughness: 0.05, alpha: 0.72, emissive: new Color3(0.1, 0.25, 0.45), world: { atmosphere: true } });
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
      this.pois.push({ id, name, position: new Vector3(x, y + 1.5, z), lore, loot, root });
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

  /** Tall light column marking the survey landing zone (visible from orbit). */
  private buildSurveyBeacon(): void {
    const s = WORLD.surveySite;
    const y = this.groundAt(s.x, s.z);
    const mat = new StandardMaterial("gf-beacon-mat", this.scene);
    mat.emissiveColor = new Color3(0.2, 0.9, 1);
    mat.alpha = 0.35;
    mat.disableLighting = true;
    mat.fogEnabled = false;
    const col = MeshBuilder.CreateCylinder("gf-beacon", { height: 260, diameterTop: 0.6, diameterBottom: 1.6, tessellation: 8 }, this.scene);
    col.position.set(s.x, y + 130, s.z);
    col.material = mat;
    col.isPickable = false;
    col.applyFog = false;
    const ringMat = new StandardMaterial("gf-pad-ring", this.scene);
    ringMat.emissiveColor = new Color3(0.25, 0.85, 1);
    ringMat.disableLighting = true;
    const ring = MeshBuilder.CreateTorus("gf-beacon-ring", { diameter: 22, thickness: 0.25, tessellation: 48 }, this.scene);
    ring.position.set(s.x, y + 0.15, s.z);
    ring.material = ringMat;
    ring.isPickable = false;
    this.beaconMeshes.push(col);
  }

  /** Counts for profiling. */
  stats(): { decorInstances: number; deposits: number; terrainChunks: number } {
    return { decorInstances: this.scatter.reduce((n, f) => n + f.instances, 0), deposits: this.deposits.length, terrainChunks: this.terrainChunks.length };
  }

  dispose(): void {
    /* scene.dispose() releases meshes, materials and textures */
  }
}
