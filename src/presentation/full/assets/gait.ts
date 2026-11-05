/**
 * Pure locomotion state machine shared by every skinned character: turns the game's few inputs (speed, grounded, jetting, aiming…) into
 * joint angles. It has no engine dependency, so it is unit-tested directly; `rigDriver.ts` applies the angles to whatever humanoid skeleton
 * the asset ships with. Same inputs and blend behaviour as the procedural astronaut, so gameplay-facing timing is unchanged.
 */
import { damp } from "../../../core/random";

export interface Pose {
  /** Hips height offset (m) and rotation (rad), model space. */
  hipsY: number; hipsX: number; hipsY_rot: number; hipsZ: number;
  chestX: number; chestY: number; chestZ: number;
  headX: number; headY: number; headZ: number;
  /** Per side [left, right]. */
  thighX: [number, number]; thighZ: [number, number];
  shinX: [number, number]; ankleX: [number, number];
  armX: [number, number]; armZ: [number, number]; foreX: [number, number];
  /** 0 = open hand … 1 = fist. */
  grip: [number, number];
  /** Backpack inertia lag (rad). */
  packX: number;
  /** Jet flame intensity 0..1 and gimbal angle. */
  jet: number; gimbal: number;
}

export class GaitState {
  private phase = 0;
  private t = 0;
  private wRun = 0;
  private wAir = 0;
  private wJet = 0;
  private wAim = 0;
  private landing = 0;
  private wasGrounded = true;
  private lastVy = 0;
  private packLag = 0;
  private prevRun = 0;
  private lookYaw = 0;

  update(dt: number, speed: number, grounded: boolean, jetting: boolean, aiming: boolean, aimPitch: number, vy = 0): Pose {
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
    const p: Pose = {
      hipsY: 0, hipsX: 0, hipsY_rot: 0, hipsZ: 0, chestX: 0, chestY: 0, chestZ: 0, headX: 0, headY: 0, headZ: 0,
      thighX: [0, 0], thighZ: [0, 0], shinX: [0, 0], ankleX: [0, 0], armX: [0, 0], armZ: [0, 0], foreX: [0, 0], grip: [0, 0], packX: 0, jet: 0, gimbal: 0,
    };
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const ph = s * side;
      const lift = Math.max(0, Math.cos(this.phase + (side > 0 ? 0 : Math.PI)));
      const airTuck = this.wAir * (0.5 - this.wJet * 0.35);
      const th = ph * stride - airTuck * (i === 0 ? 0.9 : 0.4) - this.landing * 0.45 + this.wJet * 0.15;
      const sn = lift * stride * 1.3 + airTuck * (i === 0 ? 1.2 : 0.7) + this.landing * 0.9 + this.wJet * 0.25;
      p.thighX[i] = th;
      p.shinX[i] = sn;
      p.ankleX[i] = -(th + sn) * 0.9 + Math.max(0, -ph) * stride * 0.35 + this.wAir * 0.35 + this.wJet * 0.25;
      p.thighZ[i] = side * -0.03 * (1 - this.wAir) + side * this.wAir * -0.06;
      p.armX[i] = -ph * stride * 0.9 + this.wAir * 0.35 - this.wJet * 0.2;
      p.armZ[i] = side * (0.1 + this.wAir * 0.35 + this.wJet * 0.25);
      p.foreX[i] = -(0.18 + this.wRun * 0.75 * move + this.wAir * 0.3);
      p.grip[i] = Math.max(0, Math.min(1, 0.35 + this.wRun * 0.25 - this.wAir * 0.2));
    }
    // Aim pose overrides the right arm (index 1) and tightens its grip; the left arm half-raises.
    p.armX[1] = p.armX[1] * (1 - this.wAim) + (-Math.PI / 2 + aimPitch) * this.wAim;
    p.armZ[1] = p.armZ[1] * (1 - this.wAim) + 0.04 * this.wAim;
    p.foreX[1] = p.foreX[1] * (1 - this.wAim);
    p.grip[1] = p.grip[1] * (1 - this.wAim) + 0.9 * this.wAim;
    p.armX[0] = p.armX[0] * (1 - this.wAim * 0.6) + -0.7 * this.wAim * 0.6;

    const bob = grounded ? Math.abs(c) * 0.05 * move * (0.6 + this.wRun) : 0;
    const idle = 1 - move;
    const breathe = Math.sin(this.t * 1.8) * 0.008 * idle;
    const sway = Math.sin(this.t * 0.7) * 0.012 * idle;
    p.hipsY = bob + breathe - this.landing * 0.16;
    p.hipsX = this.wRun * 0.16 + this.wJet * 0.22 + this.landing * 0.12;
    p.hipsY_rot = s * 0.08 * stride;
    p.hipsZ = sway + c * 0.025 * stride;
    p.chestY = -s * 0.14 * stride;
    p.chestX = breathe * 2 + this.wAim * 0.05;
    p.chestZ = -sway * 1.2 - c * 0.02 * stride;
    this.lookYaw += (Math.sin(this.t * 0.35) * 0.35 * idle - this.lookYaw) * damp(2, dt);
    p.headX = aiming ? aimPitch * 0.5 : -p.hipsX * 0.6;
    p.headY = p.chestY * -0.7 + this.lookYaw;
    p.headZ = -p.chestZ * 0.5;
    const acc = (this.wRun - this.prevRun) / Math.max(dt, 1e-3);
    this.prevRun = this.wRun;
    this.packLag += (Math.max(-0.5, Math.min(0.5, -acc * 0.05)) - this.packLag) * damp(6, dt);
    p.packX = this.packLag + this.wJet * -0.05;
    p.jet = this.wJet > 0.05 ? this.wJet : 0;
    p.gimbal = -p.hipsX * 0.5 + Math.sin(this.t * 9) * 0.06;
    return p;
  }
}
