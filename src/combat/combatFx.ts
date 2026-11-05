/**
 * Combat effects: pooled and budgeted so a busy dogfight costs a fixed number
 * of draw calls.
 *
 *  - Bolts: one thin-instanced, additive mesh (per-instance colour) for every projectile.
 *  - Flashes: thin-instanced additive spheres — muzzle flashes, telegraph charge-ups, hit cores.
 *  - Ripples: thin-instanced additive shells — shield impacts on enemies and on the player.
 *  - Debris: thin-instanced tumbling hull chunks with gravity.
 *  - Explosions: a fixed pool of particle bursts (fire / smoke / sparks) plus optional
 *    flash point lights; hit sparks use a small round-robin pool.
 */
import { Color3, Color4, Mesh, MeshBuilder, ParticleSystem, PointLight, RawTexture, Scene, StandardMaterial, Texture, Vector3 } from "../engine/babylon";
import type { BoltKind } from "./weapons";
import type { Vec3 } from "./vec";

export interface CombatFxBudget {
  /** Max projectiles drawn. */
  bolts: number;
  /** Max simultaneous explosion bursts. */
  explosions: number;
  /** 0 basic … 2 ultra: particle counts, debris, flash lights. */
  detail: number;
}

export const DEFAULT_FX_BUDGET: CombatFxBudget = { bolts: 400, explosions: 6, detail: 1 };

export type Rgb = [number, number, number];

export const BOLT_STYLE: Record<BoltKind | "player", { color: Rgb; width: number; lengthMul: number }> = {
  player: { color: [0.45, 1.1, 1.35], width: 0.34, lengthMul: 1 },
  pulse: { color: [0.45, 1.1, 1.35], width: 0.34, lengthMul: 1 },
  laser: { color: [1.4, 0.42, 0.14], width: 0.26, lengthMul: 1 },
  choir: { color: [0.95, 0.5, 1.5], width: 0.3, lengthMul: 1 },
  heavy: { color: [1.5, 0.85, 0.3], width: 1.0, lengthMul: 1 },
  seeker: { color: [1.5, 0.45, 1.0], width: 1.6, lengthMul: 1 },
};

const MAX_BOLTS = 640;
const MAX_FLASHES = 96;
const MAX_RIPPLES = 24;
const MAX_DEBRIS = 160;
const MAX_EXPLOSIONS = 8;

function makeParticleTexture(scene: Scene): RawTexture {
  const S = 32;
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const dx = (x + 0.5) / S - 0.5, dy = (y + 0.5) / S - 0.5;
      const r = Math.min(1, Math.hypot(dx, dy) * 2);
      const a = Math.pow(1 - r, 1.8);
      const i = (y * S + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  const t = RawTexture.CreateRGBATexture(data, S, S, scene, false, false, Texture.BILINEAR_SAMPLINGMODE);
  t.name = "gf-combat-particle";
  t.hasAlpha = true;
  return t;
}

/** A unit mesh drawn as N thin instances with per-instance matrix + colour. */
class InstanceField {
  readonly matrices: Float32Array;
  readonly colors: Float32Array;
  count = 0;

  constructor(
    readonly mesh: Mesh,
    readonly cap: number,
  ) {
    this.matrices = new Float32Array(cap * 16);
    this.colors = new Float32Array(cap * 4);
    mesh.thinInstanceSetBuffer("matrix", this.matrices, 16, false);
    mesh.thinInstanceSetBuffer("color", this.colors, 4, false);
    mesh.thinInstanceCount = 0;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.isPickable = false;
    mesh.doNotSyncBoundingInfo = true;
  }

  begin(): void {
    this.count = 0;
  }

  /** Oriented, non-uniformly scaled instance: local Z along `d` (unit). */
  pushOriented(cx: number, cy: number, cz: number, dx: number, dy: number, dz: number, width: number, length: number, r: number, g: number, b: number): boolean {
    if (this.count >= this.cap) return false;
    // x = normalize(up × d); fall back to +X when d is vertical.
    let xx = dz, xy = 0, xz = -dx;
    let xl = Math.hypot(xx, xz);
    if (xl < 1e-5) {
      xx = 1;
      xz = 0;
      xl = 1;
    }
    xx /= xl;
    xz /= xl;
    // y = d × x
    const yx = dy * xz - dz * xy, yy = dz * xx - dx * xz, yz = dx * xy - dy * xx;
    const m = this.matrices, o = this.count * 16;
    m[o] = xx * width;
    m[o + 1] = xy * width;
    m[o + 2] = xz * width;
    m[o + 3] = 0;
    m[o + 4] = yx * width;
    m[o + 5] = yy * width;
    m[o + 6] = yz * width;
    m[o + 7] = 0;
    m[o + 8] = dx * length;
    m[o + 9] = dy * length;
    m[o + 10] = dz * length;
    m[o + 11] = 0;
    m[o + 12] = cx;
    m[o + 13] = cy;
    m[o + 14] = cz;
    m[o + 15] = 1;
    this.color(r, g, b);
    return true;
  }

  /** Uniformly scaled instance, optionally tumbled by `spinA` about a fixed diagonal axis. */
  pushScaled(cx: number, cy: number, cz: number, s: number, r: number, g: number, b: number, spinA = 0): boolean {
    if (this.count >= this.cap) return false;
    const m = this.matrices, o = this.count * 16;
    if (spinA === 0) {
      m.fill(0, o, o + 16);
      m[o] = m[o + 5] = m[o + 10] = s;
    } else {
      // Axis-angle rotation about n = (1,1,1)/√3.
      const n = 0.5773502692, c = Math.cos(spinA), sn = Math.sin(spinA), t = 1 - c;
      const d = t * n * n, e = sn * n;
      m[o] = (c + d) * s;
      m[o + 1] = (d + e) * s;
      m[o + 2] = (d - e) * s;
      m[o + 3] = 0;
      m[o + 4] = (d - e) * s;
      m[o + 5] = (c + d) * s;
      m[o + 6] = (d + e) * s;
      m[o + 7] = 0;
      m[o + 8] = (d + e) * s;
      m[o + 9] = (d - e) * s;
      m[o + 10] = (c + d) * s;
      m[o + 11] = 0;
    }
    m[o + 12] = cx;
    m[o + 13] = cy;
    m[o + 14] = cz;
    m[o + 15] = 1;
    this.color(r, g, b);
    return true;
  }

  private color(r: number, g: number, b: number): void {
    const c = this.colors, o = this.count * 4;
    c[o] = r;
    c[o + 1] = g;
    c[o + 2] = b;
    c[o + 3] = 1;
    this.count++;
  }

  end(): void {
    this.mesh.thinInstanceCount = this.count;
    if (this.count > 0) {
      this.mesh.thinInstanceBufferUpdated("matrix");
      this.mesh.thinInstanceBufferUpdated("color");
    }
    this.mesh.isVisible = this.count > 0;
  }
}

interface Flash {
  x: number;
  y: number;
  z: number;
  follow: Vec3 | null;
  size: number;
  life: number;
  max: number;
  c: Rgb;
  grow: boolean;
}

interface Ripple {
  follow: Vec3 | null;
  x: number;
  y: number;
  z: number;
  radius: number;
  life: number;
  max: number;
  c: Rgb;
}

interface Chunk {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  spin: number;
  a: number;
  size: number;
  life: number;
  c: Rgb;
}

interface Burst {
  fire: ParticleSystem;
  smoke: ParticleSystem;
  sparks: ParticleSystem;
  emitter: Vector3;
  busyUntil: number;
}

interface Pending {
  at: number;
  x: number;
  y: number;
  z: number;
  radius: number;
  tint: Rgb;
}

export class CombatFx {
  readonly texture: RawTexture;
  private readonly bolts: InstanceField;
  private readonly flashes: InstanceField;
  private readonly ripples: InstanceField;
  private readonly debris: InstanceField;
  private readonly materials: StandardMaterial[] = [];
  private readonly flashList: Flash[] = [];
  private readonly rippleList: Ripple[] = [];
  private readonly chunkList: Chunk[] = [];
  private readonly bursts: Burst[] = [];
  private readonly sparkPool: { ps: ParticleSystem; emitter: Vector3 }[] = [];
  private sparkNext = 0;
  private readonly lights: { light: PointLight; life: number; max: number; peak: number }[] = [];
  private readonly pending: Pending[] = [];
  private time = 0;
  budget: CombatFxBudget = { ...DEFAULT_FX_BUDGET };
  private rnd = 1;

  constructor(
    private readonly scene: Scene,
    opts: { lights?: number; budget?: Partial<CombatFxBudget> } = {},
  ) {
    this.budget = { ...this.budget, ...(opts.budget ?? {}) };
    this.texture = makeParticleTexture(scene);
    const additive = (name: string, backFaces = false): StandardMaterial => {
      const m = new StandardMaterial(name, scene);
      m.disableLighting = true;
      m.diffuseColor = new Color3(0, 0, 0);
      m.specularColor = new Color3(0, 0, 0);
      m.emissiveColor = new Color3(1, 1, 1);
      m.alpha = 0.999;
      m.alphaMode = 1; // Constants.ALPHA_ADD
      m.backFaceCulling = !backFaces;
      m.disableDepthWrite = true;
      this.materials.push(m);
      return m;
    };
    const boltMesh = MeshBuilder.CreateCylinder("gf-combat-bolts", { height: 1, diameter: 1, tessellation: 6 }, scene);
    boltMesh.rotation.x = Math.PI / 2;
    boltMesh.bakeCurrentTransformIntoVertices();
    boltMesh.material = additive("gf-combat-bolt-mat");
    this.bolts = new InstanceField(boltMesh, MAX_BOLTS);

    const flashMesh = MeshBuilder.CreateSphere("gf-combat-flashes", { diameter: 1, segments: 6 }, scene);
    flashMesh.material = additive("gf-combat-flash-mat");
    this.flashes = new InstanceField(flashMesh, MAX_FLASHES);

    const rippleMesh = MeshBuilder.CreateSphere("gf-combat-ripples", { diameter: 2, segments: 10 }, scene);
    const rm = additive("gf-combat-ripple-mat", true);
    rm.wireframe = false;
    rippleMesh.material = rm;
    this.ripples = new InstanceField(rippleMesh, MAX_RIPPLES);

    const chunkMesh = MeshBuilder.CreateBox("gf-combat-debris", { width: 1, height: 0.5, depth: 1.4 }, scene);
    const cm = new StandardMaterial("gf-combat-debris-mat", scene);
    cm.diffuseColor = new Color3(1, 1, 1);
    cm.specularColor = new Color3(0.2, 0.2, 0.2);
    cm.emissiveColor = new Color3(0.25, 0.12, 0.06);
    this.materials.push(cm);
    chunkMesh.material = cm;
    this.debris = new InstanceField(chunkMesh, MAX_DEBRIS);

    for (let i = 0; i < MAX_EXPLOSIONS; i++) this.bursts.push(this.makeBurst(i));
    for (let i = 0; i < 4; i++) {
      const emitter = new Vector3();
      const ps = this.makeSystem(`gf-combat-sparks${i}`, 60, emitter, ParticleSystem.BLENDMODE_ADD);
      ps.minSize = 0.15;
      ps.maxSize = 0.45;
      ps.minLifeTime = 0.15;
      ps.maxLifeTime = 0.45;
      ps.minEmitPower = 10;
      ps.maxEmitPower = 30;
      ps.direction1 = new Vector3(-1, -1, -1);
      ps.direction2 = new Vector3(1, 1, 1);
      ps.color1 = new Color4(1, 0.85, 0.5, 1);
      ps.color2 = new Color4(1, 0.5, 0.2, 1);
      ps.colorDead = new Color4(0.3, 0.05, 0, 0);
      this.sparkPool.push({ ps, emitter });
    }
    const nLights = Math.max(0, Math.min(3, opts.lights ?? 0));
    for (let i = 0; i < nLights; i++) {
      const l = new PointLight(`gf-combat-flashlight${i}`, new Vector3(0, -1e4, 0), scene);
      l.intensity = 0;
      l.diffuse = new Color3(1, 0.6, 0.3);
      l.specular = new Color3(0.4, 0.25, 0.1);
      l.range = 120;
      this.lights.push({ light: l, life: 0, max: 1, peak: 0 });
    }
  }

  private random(): number {
    // Tiny LCG: deterministic FX jitter without touching the sim rng.
    this.rnd = (this.rnd * 1664525 + 1013904223) >>> 0;
    return this.rnd / 4294967296;
  }

  private makeSystem(name: string, cap: number, emitter: Vector3, blend: number): ParticleSystem {
    const ps = new ParticleSystem(name, cap, this.scene);
    ps.particleTexture = this.texture;
    ps.emitter = emitter;
    ps.emitRate = 0;
    ps.manualEmitCount = 0;
    ps.blendMode = blend;
    ps.minEmitBox = new Vector3(0, 0, 0);
    ps.maxEmitBox = new Vector3(0, 0, 0);
    ps.updateSpeed = 0.016;
    ps.start();
    return ps;
  }

  private makeBurst(i: number): Burst {
    const emitter = new Vector3(0, -1e4, 0);
    const fire = this.makeSystem(`gf-combat-fire${i}`, 120, emitter, ParticleSystem.BLENDMODE_ADD);
    fire.color1 = new Color4(1, 0.75, 0.35, 1);
    fire.color2 = new Color4(1, 0.4, 0.12, 1);
    fire.colorDead = new Color4(0.25, 0.05, 0.02, 0);
    fire.minLifeTime = 0.35;
    fire.maxLifeTime = 0.9;
    fire.direction1 = new Vector3(-1, -1, -1);
    fire.direction2 = new Vector3(1, 1, 1);
    fire.minAngularSpeed = -2;
    fire.maxAngularSpeed = 2;
    const smoke = this.makeSystem(`gf-combat-smoke${i}`, 60, emitter, ParticleSystem.BLENDMODE_STANDARD);
    smoke.color1 = new Color4(0.18, 0.16, 0.17, 0.55);
    smoke.color2 = new Color4(0.1, 0.09, 0.1, 0.45);
    smoke.colorDead = new Color4(0.05, 0.05, 0.05, 0);
    smoke.minLifeTime = 1.2;
    smoke.maxLifeTime = 2.6;
    smoke.direction1 = new Vector3(-1, -0.5, -1);
    smoke.direction2 = new Vector3(1, 1.2, 1);
    smoke.gravity = new Vector3(0, 2, 0);
    const sparks = this.makeSystem(`gf-combat-xsparks${i}`, 80, emitter, ParticleSystem.BLENDMODE_ADD);
    sparks.color1 = new Color4(1, 0.9, 0.6, 1);
    sparks.color2 = new Color4(1, 0.6, 0.25, 1);
    sparks.colorDead = new Color4(0.4, 0.1, 0, 0);
    sparks.minLifeTime = 0.4;
    sparks.maxLifeTime = 1.1;
    sparks.direction1 = new Vector3(-1, -1, -1);
    sparks.direction2 = new Vector3(1, 1, 1);
    sparks.gravity = new Vector3(0, -14, 0);
    return { fire, smoke, sparks, emitter, busyUntil: 0 };
  }

  setBudget(b: Partial<CombatFxBudget>): void {
    this.budget = { ...this.budget, ...b };
    this.budget.bolts = Math.max(0, Math.min(MAX_BOLTS, this.budget.bolts));
    this.budget.explosions = Math.max(1, Math.min(MAX_EXPLOSIONS, this.budget.explosions));
  }

  // ------------------------------------------------------------------ emitters

  /** Draws the projectile list (call once per frame). */
  drawBolts(list: readonly { x: number; y: number; z: number; vx: number; vy: number; vz: number; speed: number; length: number; kind: BoltKind; owner: string }[], camera?: Vec3): void {
    const f = this.bolts;
    f.begin();
    const cap = this.budget.bolts;
    let n = 0;
    for (const p of list) {
      if (n >= cap) break;
      if (camera) {
        const dx = p.x - camera.x, dy = p.y - camera.y, dz = p.z - camera.z;
        if (dx * dx + dy * dy + dz * dz > 1600 * 1600) continue;
      }
      const s = p.speed || 1;
      const dx = p.vx / s, dy = p.vy / s, dz = p.vz / s;
      const st = BOLT_STYLE[p.owner === "player" ? "player" : p.kind];
      const L = p.length * st.lengthMul;
      f.pushOriented(p.x - dx * L * 0.5, p.y - dy * L * 0.5, p.z - dz * L * 0.5, dx, dy, dz, st.width, L, st.color[0], st.color[1], st.color[2]);
      n++;
    }
    f.end();
  }

  flash(p: Vec3, size: number, color: Rgb, life = 0.07, grow = false, follow: Vec3 | null = null): void {
    if (this.flashList.length >= MAX_FLASHES) this.flashList.shift();
    this.flashList.push({ x: p.x, y: p.y, z: p.z, follow, size, life, max: life, c: color, grow });
  }

  ripple(center: Vec3, radius: number, color: Rgb, follow: Vec3 | null = null): void {
    if (this.rippleList.length >= MAX_RIPPLES) this.rippleList.shift();
    this.rippleList.push({ follow, x: center.x, y: center.y, z: center.z, radius, life: 0.35, max: 0.35, c: color });
  }

  sparks(p: Vec3, count: number, color?: Rgb): void {
    const s = this.sparkPool[this.sparkNext++ % this.sparkPool.length];
    s.emitter.set(p.x, p.y, p.z);
    if (color) s.ps.color1 = new Color4(color[0], color[1], color[2], 1);
    s.ps.manualEmitCount = Math.round(count * (0.5 + this.budget.detail * 0.35));
  }

  /** Explosion sized by ship radius; big ships chain several staggered bursts. */
  explode(p: Vec3, radius: number, tint: Rgb = [1, 0.55, 0.2], chain = 0): void {
    this.burst(p.x, p.y, p.z, radius, tint);
    for (let i = 0; i < chain; i++) {
      const a = this.random() * Math.PI * 2, r = radius * (0.4 + this.random() * 0.7);
      this.pending.push({ at: this.time + 0.18 + i * (0.22 + this.random() * 0.15), x: p.x + Math.cos(a) * r, y: p.y + (this.random() - 0.5) * radius * 0.6, z: p.z + Math.sin(a) * r, radius: radius * 0.6, tint });
    }
    const chunks = Math.round(Math.min(40, 3 + radius * 1.2) * (this.budget.detail >= 1 ? 1 : 0.5));
    for (let i = 0; i < chunks; i++) {
      if (this.chunkList.length >= MAX_DEBRIS) this.chunkList.shift();
      const sp = 8 + radius * (1.2 + this.random() * 2);
      const th = this.random() * Math.PI * 2, ph = (this.random() - 0.3) * Math.PI;
      this.chunkList.push({
        x: p.x,
        y: p.y,
        z: p.z,
        vx: Math.cos(th) * Math.cos(ph) * sp,
        vy: Math.sin(ph) * sp + 4,
        vz: Math.sin(th) * Math.cos(ph) * sp,
        spin: (this.random() - 0.5) * 12,
        a: this.random() * 6,
        size: Math.max(0.3, radius * (0.08 + this.random() * 0.14)),
        life: 1.6 + this.random() * 1.4,
        c: [0.32 + this.random() * 0.1, 0.3, 0.32],
      });
    }
  }

  private burst(x: number, y: number, z: number, radius: number, tint: Rgb): void {
    const active = this.bursts.filter((b) => b.busyUntil > this.time).length;
    let b = this.bursts.find((s) => s.busyUntil <= this.time);
    if (!b || active >= this.budget.explosions) b = this.bursts.reduce((a, c) => (c.busyUntil < a.busyUntil ? c : a));
    b.busyUntil = this.time + 2.2;
    b.emitter.set(x, y, z);
    const k = 0.45 + this.budget.detail * 0.3;
    const r = Math.max(1, radius);
    b.fire.minSize = r * 0.5;
    b.fire.maxSize = r * 1.5;
    b.fire.minEmitPower = r * 1.2;
    b.fire.maxEmitPower = r * 4;
    b.fire.color1 = new Color4(Math.min(1, tint[0] + 0.2), Math.min(1, tint[1] + 0.2), Math.min(1, tint[2] + 0.15), 1);
    b.fire.manualEmitCount = Math.round(Math.min(120, 24 + r * 3) * k);
    b.smoke.minSize = r * 0.8;
    b.smoke.maxSize = r * 2.2;
    b.smoke.minEmitPower = r * 0.4;
    b.smoke.maxEmitPower = r * 1.4;
    b.smoke.manualEmitCount = this.budget.detail >= 1 ? Math.round(Math.min(60, 8 + r * 1.5) * k) : 0;
    b.sparks.minSize = Math.max(0.15, r * 0.05);
    b.sparks.maxSize = Math.max(0.4, r * 0.14);
    b.sparks.minEmitPower = r * 3;
    b.sparks.maxEmitPower = r * 9;
    b.sparks.manualEmitCount = Math.round(Math.min(80, 16 + r * 2.5) * k);
    this.flash({ x, y, z }, r * 3.2, [tint[0] * 1.4, tint[1] * 1.3, tint[2] * 1.2], 0.28);
    const l = this.lights.find((s) => s.life <= 0) ?? this.lights[0];
    if (l && this.budget.detail >= 1) {
      l.light.position.set(x, y, z);
      l.light.range = Math.max(60, r * 14);
      l.life = l.max = 0.45;
      l.peak = Math.min(6, 1.5 + r * 0.15);
    }
  }

  // ------------------------------------------------------------------ per frame

  update(dt: number): void {
    this.time += dt;
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      if (p.at <= this.time) {
        this.burst(p.x, p.y, p.z, p.radius, p.tint);
        this.pending.splice(i, 1);
      }
    }
    // Flashes
    const ff = this.flashes;
    ff.begin();
    for (let i = this.flashList.length - 1; i >= 0; i--) {
      const f = this.flashList[i];
      f.life -= dt;
      if (f.life <= 0) {
        this.flashList.splice(i, 1);
        continue;
      }
      const k = f.life / f.max;
      const s = f.grow ? f.size * (0.25 + (1 - k) * 0.9) : f.size * (0.6 + k * 0.4);
      const fade = f.grow ? 0.5 + (1 - k) * 0.7 : k;
      const px = f.follow ? f.follow.x : f.x, py = f.follow ? f.follow.y : f.y, pz = f.follow ? f.follow.z : f.z;
      ff.pushScaled(px, py, pz, s, f.c[0] * fade, f.c[1] * fade, f.c[2] * fade);
    }
    ff.end();
    // Ripples
    const rf = this.ripples;
    rf.begin();
    for (let i = this.rippleList.length - 1; i >= 0; i--) {
      const r = this.rippleList[i];
      r.life -= dt;
      if (r.life <= 0) {
        this.rippleList.splice(i, 1);
        continue;
      }
      const k = r.life / r.max;
      const s = r.radius * (1.02 + (1 - k) * 0.25);
      const px = r.follow ? r.follow.x : r.x, py = r.follow ? r.follow.y : r.y, pz = r.follow ? r.follow.z : r.z;
      rf.pushScaled(px, py, pz, s, r.c[0] * k * 0.55, r.c[1] * k * 0.55, r.c[2] * k * 0.55);
    }
    rf.end();
    // Debris
    const df = this.debris;
    df.begin();
    for (let i = this.chunkList.length - 1; i >= 0; i--) {
      const c = this.chunkList[i];
      c.life -= dt;
      if (c.life <= 0) {
        this.chunkList.splice(i, 1);
        continue;
      }
      c.vy -= 14 * dt;
      c.vx *= 1 - 0.3 * dt;
      c.vz *= 1 - 0.3 * dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.z += c.vz * dt;
      c.a += c.spin * dt;
      df.pushScaled(c.x, c.y, c.z, c.size * Math.min(1, c.life * 2), c.c[0], c.c[1], c.c[2], c.a);
    }
    df.end();
    for (const l of this.lights) {
      if (l.life > 0) {
        l.life -= dt;
        const k = Math.max(0, l.life / l.max);
        l.light.intensity = l.peak * k * k;
      } else if (l.light.intensity !== 0) l.light.intensity = 0;
    }
  }

  /** Live FX element counts (tests / perf overlay). */
  stats(): { bolts: number; flashes: number; ripples: number; debris: number; bursts: number } {
    return { bolts: this.bolts.count, flashes: this.flashes.count, ripples: this.ripples.count, debris: this.debris.count, bursts: this.bursts.filter((b) => b.busyUntil > this.time).length };
  }

  clear(): void {
    this.flashList.length = 0;
    this.rippleList.length = 0;
    this.chunkList.length = 0;
    this.pending.length = 0;
    for (const b of this.bursts) {
      b.busyUntil = 0;
      b.fire.reset();
      b.smoke.reset();
      b.sparks.reset();
    }
  }

  dispose(): void {
    for (const f of [this.bolts, this.flashes, this.ripples, this.debris]) f.mesh.dispose();
    for (const m of this.materials) m.dispose();
    for (const b of this.bursts) {
      b.fire.dispose(false);
      b.smoke.dispose(false);
      b.sparks.dispose(false);
    }
    for (const s of this.sparkPool) s.ps.dispose(false);
    for (const l of this.lights) l.light.dispose();
    this.texture.dispose();
    this.bursts.length = 0;
    this.sparkPool.length = 0;
    this.lights.length = 0;
  }
}
