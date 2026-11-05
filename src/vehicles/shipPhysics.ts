import { clamp, damp, smoothstep, wrapAngle } from "../core/random";
import type { Vec3Like } from "../core/worldConfig";

export type ShipState = "docked" | "undocking" | "flying" | "landing" | "landed" | "takingOff" | "docking";

export interface ShipControls {
  /** -1..1: throttle down/up rate. */
  throttle: number;
  /** -1..1: yaw (turn) rate. */
  yaw: number;
  /** -1..1: pitch rate (positive = nose up). */
  pitch: number;
  /** -1..1: vertical thrusters (positive = up). */
  lift: number;
  boost: boolean;
  /** Direct steering from mouse/touch drag, in radians this frame. */
  aimYaw: number;
  aimPitch: number;
}

export const NO_CONTROLS: ShipControls = { throttle: 0, yaw: 0, pitch: 0, lift: 0, boost: false, aimYaw: 0, aimPitch: 0 };

export interface ShipEnvironment {
  groundAt(x: number, z: number): number;
  normalYAt(x: number, z: number): number;
  liquidLevel: number;
  padPosition: Vec3Like;
  padYaw: number;
  stationCenter: Vec3Like;
  stationRadius: number;
  flightRadius: number;
  maxAltitude: number;
}

export type ShipEvent =
  | { type: "landed" }
  | { type: "tookOff" }
  | { type: "docked" }
  | { type: "undocked" }
  | { type: "impact"; damage: number }
  | { type: "boundary" }
  | { type: "destroyed" };

interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
}

interface Transition {
  t: number;
  dur: number;
  from: Pose;
  to: Pose;
  endState: ShipState;
  endEvent: ShipEvent;
}

export type CheckResult = { ok: true } | { ok: false; reason: string };

/** Height of the hull origin above the ground when resting on its skids. */
export const GEAR_HEIGHT = 1.7;
export const MAX_SPEED = 75;
export const BOOST_SPEED = 140;

/** Arcade flight model + landing/docking state machine. No rendering. */
export class ShipPhysics {
  state: ShipState = "docked";
  x = 0;
  y = 0;
  z = 0;
  yaw = 0;
  pitch = 0;
  roll = 0;
  speed = 0;
  vy = 0;
  throttle = 0;
  /** Engine upgrade multiplier on cruise/boost speed (1 = M2 handling). */
  speedScale = 1;
  hull = 100;
  maxHull = 100;
  private transition: Transition | null = null;
  private boundaryCooldown = 0;

  get isTransitioning(): boolean {
    return this.transition !== null;
  }
  get transitionProgress(): number {
    return this.transition ? this.transition.t / this.transition.dur : 0;
  }

  forward(): Vec3Like {
    const cp = Math.cos(this.pitch);
    return { x: Math.sin(this.yaw) * cp, y: Math.sin(this.pitch), z: Math.cos(this.yaw) * cp };
  }

  agl(env: ShipEnvironment): number {
    return this.y - GEAR_HEIGHT - env.groundAt(this.x, this.z);
  }

  dockPoint(env: ShipEnvironment): Vec3Like {
    return { x: env.padPosition.x, y: env.padPosition.y + GEAR_HEIGHT, z: env.padPosition.z };
  }

  distanceToDock(env: ShipEnvironment): number {
    const d = this.dockPoint(env);
    return Math.hypot(this.x - d.x, this.y - d.y, this.z - d.z);
  }

  placeDocked(env: ShipEnvironment): void {
    const d = this.dockPoint(env);
    Object.assign(this, { x: d.x, y: d.y, z: d.z, yaw: env.padYaw, pitch: 0, roll: 0, speed: 0, vy: 0, throttle: 0 });
    this.state = "docked";
    this.transition = null;
  }

  placeLanded(env: ShipEnvironment, x: number, z: number, yaw: number): void {
    Object.assign(this, { x, z, y: env.groundAt(x, z) + GEAR_HEIGHT, yaw, pitch: 0, roll: 0, speed: 0, vy: 0, throttle: 0 });
    this.state = "landed";
    this.transition = null;
  }

  /** Drops the ship into free flight (warp arrival). */
  placeFlying(x: number, y: number, z: number, yaw: number, speed = 0): void {
    Object.assign(this, { x, y, z, yaw, pitch: 0, roll: 0, speed, vy: 0, throttle: Math.min(1, speed / MAX_SPEED) });
    this.state = "flying";
    this.transition = null;
  }

  canLand(env: ShipEnvironment): CheckResult {
    if (this.state !== "flying") return { ok: false, reason: "Not in flight" };
    if (this.agl(env) > 18) return { ok: false, reason: "Descend below 18 m" };
    if (this.speed > 18) return { ok: false, reason: "Slow down to land" };
    if (env.groundAt(this.x, this.z) < env.liquidLevel + 0.3) return { ok: false, reason: "Cannot land on liquid" };
    if (env.normalYAt(this.x, this.z) < 0.8) return { ok: false, reason: "Surface too steep" };
    return { ok: true };
  }

  canDock(env: ShipEnvironment): CheckResult {
    if (this.state !== "flying") return { ok: false, reason: "Not in flight" };
    if (this.distanceToDock(env) > 45) return { ok: false, reason: "Approach the docking pad" };
    if (this.speed > 30) return { ok: false, reason: "Slow down to dock" };
    return { ok: true };
  }

  requestLand(env: ShipEnvironment): CheckResult {
    const c = this.canLand(env);
    if (!c.ok) return c;
    const gy = env.groundAt(this.x, this.z) + GEAR_HEIGHT;
    this.begin(
      { x: this.x + Math.sin(this.yaw) * this.speed * 0.4, y: gy, z: this.z + Math.cos(this.yaw) * this.speed * 0.4, yaw: this.yaw, pitch: 0, roll: 0 },
      2.2,
      "landing",
      "landed",
      { type: "landed" },
    );
    // Re-sample ground at the actual touchdown point.
    if (this.transition) this.transition.to.y = env.groundAt(this.transition.to.x, this.transition.to.z) + GEAR_HEIGHT;
    return c;
  }

  requestTakeoff(): CheckResult {
    if (this.state !== "landed") return { ok: false, reason: "Not landed" };
    this.begin({ x: this.x, y: this.y + 11, z: this.z, yaw: this.yaw, pitch: 0.08, roll: 0 }, 1.7, "takingOff", "flying", { type: "tookOff" });
    return { ok: true };
  }

  requestDock(env: ShipEnvironment): CheckResult {
    const c = this.canDock(env);
    if (!c.ok) return c;
    const d = this.dockPoint(env);
    this.begin({ ...d, yaw: env.padYaw, pitch: 0, roll: 0 }, 3, "docking", "docked", { type: "docked" });
    return c;
  }

  requestUndock(env: ShipEnvironment): CheckResult {
    if (this.state !== "docked") return { ok: false, reason: "Not docked" };
    const fx = Math.sin(env.padYaw);
    const fz = Math.cos(env.padYaw);
    this.begin({ x: this.x + fx * 30, y: this.y + 7, z: this.z + fz * 30, yaw: env.padYaw, pitch: -0.05, roll: 0 }, 2.6, "undocking", "flying", {
      type: "undocked",
    });
    return { ok: true };
  }

  private begin(to: Pose, dur: number, during: ShipState, endState: ShipState, endEvent: ShipEvent): void {
    this.transition = {
      t: 0,
      dur,
      from: { x: this.x, y: this.y, z: this.z, yaw: this.yaw, pitch: this.pitch, roll: this.roll },
      to,
      endState,
      endEvent,
    };
    this.state = during;
    this.speed = 0;
    this.vy = 0;
  }

  update(dt: number, c: ShipControls, env: ShipEnvironment): ShipEvent[] {
    const events: ShipEvent[] = [];
    this.boundaryCooldown = Math.max(0, this.boundaryCooldown - dt);

    if (this.transition) {
      const tr = this.transition;
      tr.t = Math.min(tr.dur, tr.t + dt);
      const k = smoothstep(0, 1, tr.t / tr.dur);
      this.x = tr.from.x + (tr.to.x - tr.from.x) * k;
      this.y = tr.from.y + (tr.to.y - tr.from.y) * k;
      this.z = tr.from.z + (tr.to.z - tr.from.z) * k;
      this.yaw = tr.from.yaw + wrapAngle(tr.to.yaw - tr.from.yaw) * k;
      this.pitch = tr.from.pitch + (tr.to.pitch - tr.from.pitch) * k;
      this.roll = tr.from.roll + (tr.to.roll - tr.from.roll) * k;
      if (tr.t >= tr.dur) {
        this.transition = null;
        this.state = tr.endState;
        if (tr.endState === "flying") {
          this.throttle = tr.endEvent.type === "undocked" ? 0.25 : 0.1;
          this.speed = tr.endEvent.type === "undocked" ? 18 : 0;
        }
        events.push(tr.endEvent);
      }
      return events;
    }

    if (this.state !== "flying") return events;

    // --- Orientation
    this.yaw = wrapAngle(this.yaw + c.yaw * 1.15 * dt + c.aimYaw);
    this.pitch = clamp(this.pitch + c.pitch * 0.95 * dt + c.aimPitch, -1.05, 1.05);
    const turnRate = c.yaw * 1.15 + c.aimYaw / Math.max(dt, 1e-3);
    const rollTarget = clamp(-turnRate * 0.35, -0.75, 0.75);
    this.roll += (rollTarget - this.roll) * damp(4, dt);

    // --- Speed
    this.throttle = clamp(this.throttle + c.throttle * 0.7 * dt, 0, 1);
    const target = this.throttle * (c.boost ? BOOST_SPEED : MAX_SPEED) * this.speedScale;
    const accel = c.boost ? 55 : 32;
    if (this.speed < target) this.speed = Math.min(target, this.speed + accel * dt);
    else this.speed = Math.max(target, this.speed - 40 * dt);
    this.vy += (c.lift * 20 - this.vy) * damp(4, dt);

    // --- Integrate
    const f = this.forward();
    const vx = f.x * this.speed;
    const vyTotal = f.y * this.speed + this.vy;
    const vz = f.z * this.speed;
    this.x += vx * dt;
    this.y += vyTotal * dt;
    this.z += vz * dt;

    // --- Terrain
    const minY = env.groundAt(this.x, this.z) + GEAR_HEIGHT + 0.4;
    if (this.y < minY) {
      if (vyTotal < -11) {
        const damage = Math.round((-vyTotal - 11) * 2.2 + this.speed * 0.12);
        this.applyDamage(damage, events);
        this.speed *= 0.45;
      }
      this.y = minY;
      if (this.pitch < 0) this.pitch *= 0.5;
      this.vy = Math.max(0, this.vy);
    }

    // --- Station hull
    const sc = env.stationCenter;
    const dx = this.x - sc.x, dy = this.y - sc.y, dz = this.z - sc.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < env.stationRadius && d > 1e-3) {
      const push = env.stationRadius / d;
      this.x = sc.x + dx * push;
      this.y = sc.y + dy * push;
      this.z = sc.z + dz * push;
      if (this.speed > 30) this.applyDamage(Math.round((this.speed - 30) * 0.6), events);
      this.speed *= 0.4;
    }

    // --- Flight envelope
    const r = Math.hypot(this.x, this.z);
    if (r > env.flightRadius) {
      this.x *= env.flightRadius / r;
      this.z *= env.flightRadius / r;
      if (this.boundaryCooldown <= 0) {
        events.push({ type: "boundary" });
        this.boundaryCooldown = 4;
      }
    }
    if (this.y > env.maxAltitude) {
      this.y = env.maxAltitude;
      this.vy = Math.min(0, this.vy);
    }
    return events;
  }

  private applyDamage(damage: number, events: ShipEvent[]): void {
    if (damage <= 0) return;
    this.hull = Math.max(0, this.hull - damage);
    events.push({ type: "impact", damage });
    if (this.hull <= 0) events.push({ type: "destroyed" });
  }
}
