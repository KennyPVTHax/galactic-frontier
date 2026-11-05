import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode, Vector3 } from "../engine/babylon";
import { damp } from "../core/random";
import type { MaterialLibrary } from "../graphics/materials";

/**
 * Procedural, original astronaut. Two-segment limbs (hip/knee, shoulder/elbow)
 * driven by a phase-based gait with smoothed state blending: idle breathing,
 * walk/sprint lean, airborne tuck, jetpack posture, landing compression and
 * an aiming pose for the mining laser.
 */
export class Astronaut {
  readonly root: TransformNode;
  readonly meshes: Mesh[] = [];
  readonly muzzle: TransformNode;
  private readonly hips: TransformNode;
  private readonly chest: TransformNode;
  private readonly head: TransformNode;
  private readonly thigh: [TransformNode, TransformNode];
  private readonly shin: [TransformNode, TransformNode];
  private readonly upperArm: [TransformNode, TransformNode];
  private readonly forearm: [TransformNode, TransformNode];
  private readonly flames: Mesh[] = [];
  private phase = 0;
  private t = 0;
  // Smoothed blend weights
  private wRun = 0;
  private wAir = 0;
  private wJet = 0;
  private wAim = 0;
  private landing = 0;
  private wasGrounded = true;
  private lastVy = 0;

  constructor(scene: Scene, lib: MaterialLibrary) {
    const suit = lib.make("astro-suit", { albedo: new Color3(0.88, 0.86, 0.93), roughness: 0.72, maps: "fabric", mapScale: 7 });
    const accent = lib.make("astro-accent", { albedo: new Color3(0.42, 0.24, 0.86), roughness: 0.42, metallic: 0.2 });
    const dark = lib.make("astro-dark", { albedo: new Color3(0.12, 0.11, 0.16), roughness: 0.5, metallic: 0.5 });
    const visor = lib.make("astro-visor", { albedo: new Color3(0.02, 0.03, 0.05), roughness: 0.04, metallic: 1, emissive: new Color3(0.04, 0.22, 0.3) });
    const glow = new StandardMaterial("astro-glow", scene);
    glow.emissiveColor = new Color3(0.2, 0.95, 1);
    glow.disableLighting = true;
    const flame = new StandardMaterial("astro-flame", scene);
    flame.emissiveColor = new Color3(0.45, 0.8, 1);
    flame.disableLighting = true;
    flame.alpha = 0.75;

    this.root = new TransformNode("astronaut", scene);
    const add = (m: Mesh, parent: TransformNode, mat: ReturnType<MaterialLibrary["make"]> | StandardMaterial) => {
      m.parent = parent;
      if (mat instanceof StandardMaterial) m.material = mat;
      else lib.bind(m, mat);
      m.isPickable = false;
      this.meshes.push(m);
      return m;
    };
    const node = (name: string, parent: TransformNode, x: number, y: number, z = 0) => {
      const n = new TransformNode(name, scene);
      n.parent = parent;
      n.position.set(x, y, z);
      return n;
    };

    this.hips = node("astro-hips", this.root, 0, 0.95);
    this.chest = node("astro-chest", this.hips, 0, 0.1);
    const torso = add(MeshBuilder.CreateCapsule("astro-torso", { height: 0.72, radius: 0.27, tessellation: 16 }, scene), this.chest, suit);
    torso.position.y = 0.28;
    torso.scaling.z = 0.82;
    const belt = add(MeshBuilder.CreateCylinder("astro-belt", { height: 0.13, diameter: 0.5, tessellation: 18 }, scene), this.hips, accent);
    belt.position.y = 0.04;
    belt.scaling.z = 0.82;
    const plate = add(MeshBuilder.CreateBox("astro-plate", { width: 0.34, height: 0.24, depth: 0.08 }, scene), this.chest, dark);
    plate.position.set(0, 0.4, 0.21);
    const chestLight = add(MeshBuilder.CreateBox("astro-chest-light", { width: 0.12, height: 0.04, depth: 0.02 }, scene), this.chest, glow);
    chestLight.position.set(0, 0.43, 0.255);
    for (const sx of [-1, 1]) {
      const pad = add(MeshBuilder.CreateSphere("astro-shoulder", { diameter: 0.2, segments: 10 }, scene), this.chest, accent);
      pad.position.set(sx * 0.3, 0.5, 0);
      pad.scaling.set(1.2, 0.8, 1.1);
    }
    const collar = add(MeshBuilder.CreateTorus("astro-collar", { diameter: 0.34, thickness: 0.07, tessellation: 20 }, scene), this.chest, dark);
    collar.position.y = 0.62;

    this.head = node("astro-head", this.chest, 0, 0.78);
    add(MeshBuilder.CreateSphere("astro-helmet", { diameter: 0.52, segments: 18 }, scene), this.head, suit);
    const visorM = add(MeshBuilder.CreateSphere("astro-visor", { diameter: 0.44, segments: 18 }, scene), this.head, visor);
    visorM.position.set(0, 0, 0.09);
    visorM.scaling.set(0.92, 0.72, 0.85);
    const ant = add(MeshBuilder.CreateCylinder("astro-ant", { height: 0.25, diameter: 0.025 }, scene), this.head, dark);
    ant.position.set(0.17, 0.25, -0.05);
    const antTip = add(MeshBuilder.CreateSphere("astro-ant-tip", { diameter: 0.05 }, scene), this.head, glow);
    antTip.position.set(0.17, 0.38, -0.05);

    const pack = add(MeshBuilder.CreateBox("astro-pack", { width: 0.46, height: 0.56, depth: 0.24 }, scene), this.chest, accent);
    pack.position.set(0, 0.32, -0.3);
    const packTop = add(MeshBuilder.CreateCylinder("astro-tank", { height: 0.42, diameter: 0.12, tessellation: 12 }, scene), this.chest, dark);
    packTop.rotation.z = Math.PI / 2;
    packTop.position.set(0, 0.62, -0.32);
    for (const sx of [-0.13, 0.13]) {
      const noz = add(MeshBuilder.CreateCylinder("astro-noz", { height: 0.14, diameterTop: 0.1, diameterBottom: 0.15, tessellation: 12 }, scene), this.chest, dark);
      noz.position.set(sx, -0.02, -0.33);
      const fl = add(MeshBuilder.CreateCylinder("astro-flame", { height: 0.6, diameterTop: 0.12, diameterBottom: 0, tessellation: 10 }, scene), this.chest, flame);
      fl.position.set(sx, -0.35, -0.33);
      fl.setEnabled(false);
      this.flames.push(fl);
      const lamp = add(MeshBuilder.CreateBox("astro-lamp", { width: 0.06, height: 0.06, depth: 0.02 }, scene), this.chest, glow);
      lamp.position.set(sx, 0.45, -0.43);
    }

    // Two-segment limbs
    const seg = (name: string, parent: TransformNode, len: number, r: number, mat = suit) => {
      const m = add(MeshBuilder.CreateCapsule(`${name}-m`, { height: len, radius: r, tessellation: 12 }, scene), parent, mat);
      m.position.y = -len / 2 + r * 0.6;
      return m;
    };
    const legs = [-1, 1].map((sx) => {
      const hip = node(`astro-hip${sx}`, this.hips, sx * 0.14, 0.02);
      seg(`astro-thigh${sx}`, hip, 0.5, 0.11);
      const knee = node(`astro-knee${sx}`, hip, 0, -0.44);
      seg(`astro-shin${sx}`, knee, 0.5, 0.1);
      const kneePad = add(MeshBuilder.CreateSphere("astro-kneepad", { diameter: 0.15, segments: 8 }, scene), knee, accent);
      kneePad.position.set(0, 0, 0.06);
      const boot = add(MeshBuilder.CreateBox("astro-boot", { width: 0.2, height: 0.16, depth: 0.32 }, scene), knee, dark);
      boot.position.set(0, -0.45, 0.04);
      return [hip, knee] as const;
    });
    this.thigh = [legs[0][0], legs[1][0]];
    this.shin = [legs[0][1], legs[1][1]];
    const arms = [-1, 1].map((sx) => {
      const sh = node(`astro-sh${sx}`, this.chest, sx * 0.36, 0.48);
      seg(`astro-upper${sx}`, sh, 0.36, 0.085);
      const el = node(`astro-elbow${sx}`, sh, 0, -0.31);
      seg(`astro-fore${sx}`, el, 0.34, 0.078);
      const glove = add(MeshBuilder.CreateSphere("astro-glove", { diameter: 0.17, segments: 10 }, scene), el, dark);
      glove.position.y = -0.31;
      return [sh, el] as const;
    });
    this.upperArm = [arms[0][0], arms[1][0]];
    this.forearm = [arms[0][1], arms[1][1]];
    const hand = this.forearm[1];
    const tool = add(MeshBuilder.CreateBox("astro-tool", { width: 0.1, height: 0.12, depth: 0.32 }, scene), hand, dark);
    tool.position.set(0, -0.34, 0.12);
    const barrel = add(MeshBuilder.CreateCylinder("astro-barrel", { height: 0.22, diameter: 0.05, tessellation: 10 }, scene), hand, accent);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, -0.34, 0.36);
    const tip = add(MeshBuilder.CreateSphere("astro-tip", { diameter: 0.06 }, scene), hand, glow);
    tip.position.set(0, -0.34, 0.47);
    this.muzzle = node("astro-muzzle", hand, 0, -0.34, 0.5);
  }

  setVisible(v: boolean): void {
    this.root.setEnabled(v);
  }

  /**
   * @param speed horizontal speed m/s
   * @param vy vertical velocity (for landing compression)
   * @param aimPitch camera pitch while mining (radians, + = down)
   */
  animate(dt: number, speed: number, grounded: boolean, jetting: boolean, aiming: boolean, aimPitch: number, vy = 0): void {
    this.t += dt;
    const k = damp(10, dt);
    this.wRun += (Math.min(1, speed / 10) - this.wRun) * k;
    this.wAir += ((grounded ? 0 : 1) - this.wAir) * damp(8, dt);
    this.wJet += ((jetting ? 1 : 0) - this.wJet) * damp(8, dt);
    this.wAim += ((aiming ? 1 : 0) - this.wAim) * damp(14, dt);
    if (grounded && !this.wasGrounded) this.landing = Math.min(1, Math.max(0.25, -this.lastVy / 12));
    this.wasGrounded = grounded;
    this.lastVy = vy;
    this.landing = Math.max(0, this.landing - dt * 3.5);

    const move = Math.min(1, speed / 2.5);
    this.phase += dt * (3.6 + speed * 1.05) * (grounded ? 1 : 0.15);
    const s = Math.sin(this.phase);
    const c = Math.cos(this.phase);
    const stride = (0.3 + this.wRun * 0.55) * move * (1 - this.wAir);

    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const ph = s * side;
      // Knee bends while the leg swings forward (lift), straight on contact.
      const lift = Math.max(0, Math.cos(this.phase + (side > 0 ? 0 : Math.PI)));
      const airTuck = this.wAir * (0.5 - this.wJet * 0.35);
      this.thigh[i].rotation.x = ph * stride - airTuck * (i === 0 ? 0.9 : 0.4) - this.landing * 0.45 + this.wJet * 0.15;
      this.shin[i].rotation.x = lift * stride * 1.3 + airTuck * (i === 0 ? 1.2 : 0.7) + this.landing * 0.9 + this.wJet * 0.25;
      // Arms counter-swing; elbows bend more when running.
      const armSwing = -ph * stride * 0.9;
      const ua = this.upperArm[i];
      const fa = this.forearm[i];
      ua.rotation.x = armSwing + this.wAir * 0.35 - this.wJet * 0.2;
      ua.rotation.z = side * (0.12 + this.wAir * 0.35 + this.wJet * 0.25);
      fa.rotation.x = -(0.15 + this.wRun * 0.75 * move + this.wAir * 0.3);
    }
    // Aim pose overrides the right arm.
    const ra = this.upperArm[1];
    const rf = this.forearm[1];
    ra.rotation.x = ra.rotation.x * (1 - this.wAim) + (-Math.PI / 2 + aimPitch) * this.wAim;
    ra.rotation.z = ra.rotation.z * (1 - this.wAim) + 0.04 * this.wAim;
    rf.rotation.x = rf.rotation.x * (1 - this.wAim);
    const la = this.upperArm[0];
    la.rotation.x = la.rotation.x * (1 - this.wAim * 0.6) + -0.7 * this.wAim * 0.6;

    const bob = grounded ? Math.abs(c) * 0.05 * move * (0.6 + this.wRun) : 0;
    const breathe = Math.sin(this.t * 1.8) * 0.008 * (1 - move);
    this.hips.position.y = 0.95 + bob + breathe - this.landing * 0.16;
    this.hips.rotation.x = this.wRun * 0.16 + this.wJet * 0.22 + this.landing * 0.12;
    // Torso counter-rotates against the hips for a natural gait.
    this.hips.rotation.y = s * 0.08 * stride;
    this.chest.rotation.y = -s * 0.14 * stride;
    this.chest.rotation.x = breathe * 2 + this.wAim * 0.05;
    this.head.rotation.x = aiming ? aimPitch * 0.5 : -this.hips.rotation.x * 0.6;

    for (const f of this.flames) {
      f.setEnabled(this.wJet > 0.05);
      if (this.wJet > 0.05) f.scaling.y = (0.75 + Math.random() * 0.5) * this.wJet;
    }
  }

  get position(): Vector3 {
    return this.root.position;
  }
}
