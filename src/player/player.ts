import { Scene, Vector3 } from "../engine/babylon";
import { clamp, damp, wrapAngle } from "../core/random";
import { WORLD } from "../core/worldConfig";
import type { InputFrame } from "../input/input";
import type { Collider } from "../world/planet";
import { Astronaut } from "../presentation/astronaut";
import type { MaterialLibrary } from "../graphics/materials";

export interface PlayerWorld {
  groundAt(x: number, z: number): number;
  normalYAt(x: number, z: number): number;
  collidersNear(x: number, z: number): Collider[];
}

const WALK = 5.5;
const SPRINT = 10;
const JUMP_V = 6.8;
const RADIUS = 0.4;

export class Player {
  readonly model: Astronaut;
  readonly position = new Vector3();
  readonly velocity = new Vector3();
  facing = 0;
  grounded = true;
  jetting = false;
  jetFuel = 100;
  maxJetFuel = 100;
  jetThrust = 25;
  /** Per-planet surface rules (M4); defaults are Veyra-7. */
  liquidLevel: number = WORLD.liquidLevel;
  gravity: number = WORLD.gravity;
  walkRadius: number = WORLD.walkRadius;
  private sinceJump = 99;
  private groundedTime = 0;
  /** Extra colliders (e.g. the parked ship). */
  extraColliders: Collider[] = [];

  constructor(scene: Scene, lib: MaterialLibrary) {
    this.model = new Astronaut(scene, lib);
  }

  place(x: number, z: number, world: PlayerWorld, yaw = 0): void {
    this.position.set(x, world.groundAt(x, z), z);
    this.velocity.setAll(0);
    this.facing = yaw;
    this.grounded = true;
    this.syncModel();
  }

  private supportHeight(x: number, z: number, world: PlayerWorld, y: number): number {
    let g = world.groundAt(x, z);
    const all = [...world.collidersNear(x, z), ...this.extraColliders];
    for (const c of all) {
      const d = Math.hypot(x - c.x, z - c.z);
      if (d < c.r * 0.75 && y >= c.top - 0.35) g = Math.max(g, c.top);
    }
    return g;
  }

  /** Returns horizontal metres travelled this tick. */
  update(dt: number, input: InputFrame, camYaw: number, world: PlayerWorld, aiming: boolean, aimPitch: number): number {
    const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
    const rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
    let mx = fx * input.moveY + rx * input.moveX;
    let mz = fz * input.moveY + rz * input.moveX;
    const mlen = Math.hypot(mx, mz);
    if (mlen > 1) {
      mx /= mlen;
      mz /= mlen;
    }
    const ny = world.normalYAt(this.position.x, this.position.z);
    const slopeFactor = clamp((ny - 0.55) / 0.3, 0.3, 1);
    const wading = world.groundAt(this.position.x, this.position.z) < this.liquidLevel ? 0.55 : 1;
    const speed = (input.sprint && !aiming ? SPRINT : WALK) * slopeFactor * wading;
    const accel = this.grounded ? 45 : 9;
    const tvx = mx * speed;
    const tvz = mz * speed;
    const k = Math.min(1, accel * dt / Math.max(0.001, speed));
    this.velocity.x += (tvx - this.velocity.x) * (this.grounded ? Math.min(1, k * 2) : damp(1.2, dt));
    this.velocity.z += (tvz - this.velocity.z) * (this.grounded ? Math.min(1, k * 2) : damp(1.2, dt));

    // Jump / jetpack
    this.sinceJump += dt;
    if (this.grounded && input.jumpPressed) {
      this.velocity.y = JUMP_V;
      this.grounded = false;
      this.sinceJump = 0;
    }
    this.jetting = false;
    if (!this.grounded && input.jumpHeld && this.sinceJump > 0.22 && this.jetFuel > 0) {
      this.jetting = true;
      this.velocity.y = Math.min(9, this.velocity.y + this.jetThrust * dt);
      this.jetFuel = Math.max(0, this.jetFuel - 30 * dt);
      this.velocity.x += mx * 6 * dt;
      this.velocity.z += mz * 6 * dt;
    }
    this.velocity.y -= this.gravity * dt;

    const ox = this.position.x, oz = this.position.z;
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    this.position.y += this.velocity.y * dt;

    // Horizontal collisions
    const cols = [...world.collidersNear(this.position.x, this.position.z), ...this.extraColliders];
    for (const c of cols) {
      if (this.position.y >= c.top - 0.35) continue;
      const dx = this.position.x - c.x;
      const dz = this.position.z - c.z;
      const d = Math.hypot(dx, dz);
      const min = c.r + RADIUS;
      if (d < min && d > 1e-4) {
        this.position.x = c.x + (dx / d) * min;
        this.position.z = c.z + (dz / d) * min;
      }
    }

    // Soft world boundary
    const r = Math.hypot(this.position.x, this.position.z);
    if (r > this.walkRadius) {
      this.position.x *= this.walkRadius / r;
      this.position.z *= this.walkRadius / r;
    }

    // Ground
    const g = this.supportHeight(this.position.x, this.position.z, world, this.position.y);
    if (this.position.y <= g) {
      this.position.y = g;
      if (this.velocity.y < 0) this.velocity.y = 0;
      this.grounded = true;
    } else if (this.grounded && this.velocity.y <= 0 && this.position.y - g < 0.6) {
      // Stick to the ground when walking downhill.
      this.position.y = g;
      this.velocity.y = 0;
    } else {
      this.grounded = false;
    }
    if (this.grounded) {
      this.groundedTime += dt;
      if (this.groundedTime > 0.4) this.jetFuel = Math.min(this.maxJetFuel, this.jetFuel + 38 * dt);
    } else this.groundedTime = 0;

    // Facing
    const hs = Math.hypot(this.velocity.x, this.velocity.z);
    if (aiming) this.facing += wrapAngle(camYaw - this.facing) * damp(14, dt);
    else if (hs > 0.4 && mlen > 0.05) this.facing += wrapAngle(Math.atan2(this.velocity.x, this.velocity.z) - this.facing) * damp(10, dt);

    this.model.animate(dt, hs, this.grounded, this.jetting, aiming, aimPitch, this.velocity.y);
    this.syncModel();
    return Math.hypot(this.position.x - ox, this.position.z - oz);
  }

  syncModel(): void {
    this.model.root.position.copyFrom(this.position);
    this.model.root.rotation.y = this.facing;
  }
}
