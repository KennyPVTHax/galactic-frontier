import { Color3, Color4, DynamicTexture, Mesh, MeshBuilder, ParticleSystem, Quaternion, Scene, StandardMaterial, Vector3 } from "../engine/babylon";

export function makeParticleTexture(scene: Scene): DynamicTexture {
  const t = new DynamicTexture("gf-particle", { width: 64, height: 64 }, scene, false);
  const ctx = t.getContext() as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.6)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  t.hasAlpha = true;
  t.update();
  return t;
}

/** Mining laser beam + impact sparks. */
export class LaserBeam {
  private readonly beam: Mesh;
  private readonly core: Mesh;
  private readonly mat: StandardMaterial;
  private readonly sparks: ParticleSystem;
  private readonly debris: ParticleSystem;
  private sparkRate = 120;
  private debrisRate = 30;
  private readonly emitter: Vector3 = new Vector3();
  private readonly quat = new Quaternion();
  private t = 0;

  constructor(scene: Scene, particleTex: DynamicTexture, maxSparks: number) {
    this.mat = new StandardMaterial("gf-laser", scene);
    this.mat.emissiveColor = new Color3(0.3, 0.95, 1);
    this.mat.disableLighting = true;
    this.mat.alpha = 0.55;
    const coreMat = new StandardMaterial("gf-laser-core", scene);
    coreMat.emissiveColor = new Color3(0.9, 1, 1);
    coreMat.disableLighting = true;
    this.beam = MeshBuilder.CreateCylinder("gf-laser-beam", { height: 1, diameter: 0.14, tessellation: 8 }, scene);
    this.beam.material = this.mat;
    this.core = MeshBuilder.CreateCylinder("gf-laser-corebeam", { height: 1, diameter: 0.045, tessellation: 6 }, scene);
    this.core.material = coreMat;
    for (const m of [this.beam, this.core]) {
      m.isPickable = false;
      m.setEnabled(false);
      m.rotationQuaternion = new Quaternion();
    }

    this.sparks = new ParticleSystem("gf-sparks", Math.max(10, maxSparks), scene);
    this.sparks.particleTexture = particleTex;
    this.sparks.emitter = this.emitter;
    this.sparks.minSize = 0.05;
    this.sparks.maxSize = 0.18;
    this.sparks.minLifeTime = 0.2;
    this.sparks.maxLifeTime = 0.55;
    this.sparks.emitRate = 0;
    this.sparks.minEmitPower = 2;
    this.sparks.maxEmitPower = 6;
    this.sparks.gravity = new Vector3(0, -9, 0);
    this.sparks.direction1 = new Vector3(-1, 1, -1);
    this.sparks.direction2 = new Vector3(1, 2, 1);
    this.sparks.blendMode = ParticleSystem.BLENDMODE_ADD;
    this.sparks.start();

    // Rock / crystal chips thrown from the impact point (alpha-blended, lit look).
    this.debris = new ParticleSystem("gf-debris", 90, scene);
    this.debris.particleTexture = particleTex;
    this.debris.emitter = this.emitter;
    this.debris.minSize = 0.06;
    this.debris.maxSize = 0.16;
    this.debris.minLifeTime = 0.5;
    this.debris.maxLifeTime = 1.1;
    this.debris.emitRate = 0;
    this.debris.minEmitPower = 1.5;
    this.debris.maxEmitPower = 4;
    this.debris.gravity = new Vector3(0, -14, 0);
    this.debris.direction1 = new Vector3(-1, 1.5, -1);
    this.debris.direction2 = new Vector3(1, 3, 1);
    this.debris.minAngularSpeed = -6;
    this.debris.maxAngularSpeed = 6;
    this.debris.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    this.debris.start();
  }

  setBudget(sparks: number, debris: number): void {
    this.sparkRate = sparks;
    this.debrisRate = debris * 0.6;
  }

  /** heat 0..1 shifts colour from cyan to hot orange. */
  show(from: Vector3, to: Vector3, hit: boolean, heat: number, impact: [number, number, number]): void {
    this.t += 0.016;
    const dir = to.subtract(from);
    const len = dir.length();
    if (len < 0.01) return this.hide();
    dir.scaleInPlace(1 / len);
    Quaternion.FromUnitVectorsToRef(Vector3.Up(), dir, this.quat);
    const mid = from.add(to).scaleInPlace(0.5);
    const wobble = 1 + Math.sin(this.t * 60) * 0.15;
    for (const m of [this.beam, this.core]) {
      m.setEnabled(true);
      m.position.copyFrom(mid);
      m.rotationQuaternion!.copyFrom(this.quat);
      m.scaling.set(wobble, len, wobble);
    }
    const h = Math.min(1, Math.max(0, heat));
    this.mat.emissiveColor.set(0.3 + h * 0.7, 0.95 - h * 0.45, 1 - h * 0.85);
    this.emitter.copyFrom(to);
    this.sparks.emitRate = hit ? this.sparkRate * 0.8 : 0;
    this.debris.emitRate = hit ? this.debrisRate : 0;
    this.debris.color1 = new Color4(impact[0] * 0.55, impact[1] * 0.55, impact[2] * 0.55, 1);
    this.debris.color2 = new Color4(0.22, 0.18, 0.25, 1);
    this.debris.colorDead = new Color4(0.1, 0.08, 0.12, 0);
    this.sparks.color1 = new Color4(impact[0], impact[1], impact[2], 1);
    this.sparks.color2 = new Color4(1, 0.9, 0.7, 1);
    this.sparks.colorDead = new Color4(0, 0, 0, 0);
  }

  hide(): void {
    this.beam.setEnabled(false);
    this.core.setEnabled(false);
    this.sparks.emitRate = 0;
    this.debris.emitRate = 0;
  }
}

/** Expanding scanner dome + ground ring. */
export class ScanPulse {
  private readonly dome: Mesh;
  private readonly ring: Mesh;
  private readonly domeMat: StandardMaterial;
  private readonly ringMat: StandardMaterial;
  private t = -1;
  private radius = 100;
  private readonly duration = 1.4;

  constructor(scene: Scene) {
    this.domeMat = new StandardMaterial("gf-scan-dome", scene);
    this.domeMat.emissiveColor = new Color3(0.25, 0.85, 1);
    this.domeMat.disableLighting = true;
    this.domeMat.backFaceCulling = false;
    this.domeMat.wireframe = false;
    this.ringMat = this.domeMat.clone("gf-scan-ring");
    this.dome = MeshBuilder.CreateSphere("gf-scan-domemesh", { diameter: 2, segments: 24, slice: 0.5 }, scene);
    this.dome.material = this.domeMat;
    this.ring = MeshBuilder.CreateTorus("gf-scan-ringmesh", { diameter: 2, thickness: 0.03, tessellation: 64 }, scene);
    this.ring.material = this.ringMat;
    for (const m of [this.dome, this.ring]) {
      m.isPickable = false;
      m.setEnabled(false);
    }
  }

  start(origin: Vector3, radius: number): void {
    this.t = 0;
    this.radius = radius;
    this.dome.position.copyFrom(origin);
    this.ring.position.copyFrom(origin);
    this.ring.position.y += 0.3;
  }

  get active(): boolean {
    return this.t >= 0;
  }

  update(dt: number): void {
    if (this.t < 0) return;
    this.t += dt;
    const k = this.t / this.duration;
    if (k >= 1) {
      this.t = -1;
      this.dome.setEnabled(false);
      this.ring.setEnabled(false);
      return;
    }
    const ease = 1 - Math.pow(1 - k, 3);
    const r = Math.max(0.5, ease * this.radius);
    this.dome.setEnabled(true);
    this.ring.setEnabled(true);
    this.dome.scaling.set(r, r * 0.35, r);
    this.ring.scaling.set(r, 1, r);
    this.domeMat.alpha = 0.16 * (1 - k);
    this.ringMat.alpha = 0.9 * (1 - k);
  }
}

/**
 * Ambient dust motes around the camera and low wind gusts that streak across
 * the ground along the wind direction. Capacities are fixed (bounded); the
 * active budget only changes emit rates.
 */
export class EnvironmentFx {
  private readonly dust: ParticleSystem;
  private readonly gusts: ParticleSystem;
  private readonly gustEmitter = new Vector3();
  private budget = { dust: 0, gusts: 0 };

  constructor(
    scene: Scene,
    tex: DynamicTexture,
    private readonly follow: { position: Vector3 },
    private readonly wind: { x: number; z: number },
  ) {
    const dust = new ParticleSystem("gf-dust", 300, scene);
    dust.particleTexture = tex;
    dust.emitter = follow.position as Vector3;
    dust.minEmitBox = new Vector3(-25, -6, -25);
    dust.maxEmitBox = new Vector3(25, 10, 25);
    dust.minSize = 0.04;
    dust.maxSize = 0.12;
    dust.minLifeTime = 4;
    dust.maxLifeTime = 8;
    dust.emitRate = 0;
    dust.minEmitPower = 0.1;
    dust.maxEmitPower = 0.4;
    dust.direction1 = new Vector3(-0.3, -0.2, -0.3);
    dust.direction2 = new Vector3(0.3, 0.4, 0.3);
    dust.color1 = new Color4(1, 0.85, 0.95, 0.35);
    dust.color2 = new Color4(0.7, 0.85, 1, 0.25);
    dust.colorDead = new Color4(0, 0, 0, 0);
    dust.blendMode = ParticleSystem.BLENDMODE_ADD;
    dust.start();
    this.dust = dust;

    const g = new ParticleSystem("gf-gusts", 60, scene);
    g.particleTexture = tex;
    g.emitter = this.gustEmitter;
    g.minEmitBox = new Vector3(-30, 0, -30);
    g.maxEmitBox = new Vector3(30, 1.5, 30);
    g.minSize = 0.6;
    g.maxSize = 1.8;
    g.minScaleX = 3;
    g.maxScaleX = 6;
    g.minLifeTime = 1.2;
    g.maxLifeTime = 2.4;
    g.emitRate = 0;
    g.minEmitPower = 5;
    g.maxEmitPower = 9;
    g.color1 = new Color4(0.85, 0.7, 0.8, 0.12);
    g.color2 = new Color4(0.7, 0.6, 0.75, 0.08);
    g.colorDead = new Color4(0, 0, 0, 0);
    g.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    g.isBillboardBased = true;
    g.billboardMode = ParticleSystem.BILLBOARDMODE_Y;
    g.start();
    this.gusts = g;
  }

  setBudget(dust: number, gusts: number): void {
    this.budget = { dust, gusts };
  }

  /** @param groundY ground height under the camera @param gustiness 0..1 slowly varying */
  update(groundY: number, gustiness: number, onFoot: boolean): void {
    this.dust.emitRate = this.budget.dust / 6;
    const w = this.wind;
    this.dust.gravity = new Vector3(w.x * 0.25, 0.02, w.z * 0.25);
    const p = this.follow.position;
    this.gustEmitter.set(p.x - w.x * 20, groundY + 0.2, p.z - w.z * 20);
    this.gusts.direction1 = new Vector3(w.x * 0.9, 0.02, w.z * 0.9);
    this.gusts.direction2 = new Vector3(w.x * 1.1, 0.08, w.z * 1.1);
    this.gusts.emitRate = onFoot ? this.budget.gusts * gustiness * 0.5 : 0;
  }
}

/** Engine exhaust trails and landing dust for the Wayfarer. */
export class ShipFx {
  private readonly exhaust: ParticleSystem[] = [];
  private readonly emitters: Vector3[] = [];
  private readonly ground: ParticleSystem;
  private readonly groundEmitter = new Vector3();
  private budget = 0;

  constructor(
    scene: Scene,
    tex: DynamicTexture,
    private readonly nozzles: { getAbsolutePosition(): Vector3 }[],
  ) {
    for (let i = 0; i < nozzles.length; i++) {
      const e = new Vector3();
      const ps = new ParticleSystem(`gf-exhaust${i}`, 150, scene);
      ps.particleTexture = tex;
      ps.emitter = e;
      ps.minSize = 0.25;
      ps.maxSize = 0.7;
      ps.minLifeTime = 0.15;
      ps.maxLifeTime = 0.45;
      ps.emitRate = 0;
      ps.minEmitPower = 6;
      ps.maxEmitPower = 12;
      ps.color1 = new Color4(0.45, 0.85, 1, 0.9);
      ps.color2 = new Color4(0.7, 0.5, 1, 0.7);
      ps.colorDead = new Color4(0.1, 0.05, 0.2, 0);
      ps.blendMode = ParticleSystem.BLENDMODE_ADD;
      ps.start();
      this.exhaust.push(ps);
      this.emitters.push(e);
    }
    const g = new ParticleSystem("gf-landing-dust", 140, scene);
    g.particleTexture = tex;
    g.emitter = this.groundEmitter;
    g.createCylinderEmitter(3, 0.2, 1, 0);
    g.minSize = 1.2;
    g.maxSize = 3.2;
    g.minLifeTime = 0.8;
    g.maxLifeTime = 1.8;
    g.emitRate = 0;
    g.minEmitPower = 4;
    g.maxEmitPower = 9;
    g.color1 = new Color4(0.7, 0.55, 0.65, 0.3);
    g.color2 = new Color4(0.5, 0.45, 0.55, 0.22);
    g.colorDead = new Color4(0.3, 0.25, 0.3, 0);
    g.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    g.start();
    this.ground = g;
  }

  setBudget(exhaust: number): void {
    this.budget = exhaust;
  }

  /** @param back unit vector pointing out of the nozzles */
  update(active: boolean, throttle: number, boosting: boolean, back: Vector3, groundY: number, shipY: number, shipX: number, shipZ: number): void {
    const rate = active ? this.budget * (0.25 + throttle * 0.75) * (boosting ? 1.5 : 1) * 0.5 : 0;
    this.nozzles.forEach((n, i) => {
      this.emitters[i].copyFrom(n.getAbsolutePosition());
      const ps = this.exhaust[i];
      ps.emitRate = rate;
      ps.direction1 = back.scale(1).add(new Vector3(-0.08, -0.08, -0.08));
      ps.direction2 = back.scale(1).add(new Vector3(0.08, 0.08, 0.08));
    });
    const agl = shipY - groundY;
    const near = active && agl < 16 ? 1 - agl / 16 : 0;
    this.groundEmitter.set(shipX, groundY + 0.3, shipZ);
    this.ground.emitRate = near * Math.min(this.budget, 160) * 0.6;
  }
}
