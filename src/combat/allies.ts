/** Friendly freighters / stations that enemies may attack (escort & defence missions). */
import { Durability } from "./damage";
import { copy, normalize, v3, type Vec3 } from "./vec";

export type AllyKind = "freighter" | "station";

export interface AllySpec {
  id: string;
  kind: AllyKind;
  position: Vec3;
  /** Waypoints followed in order at `speed` (freighters). */
  path?: Vec3[];
  /** Loop the path instead of stopping at the end. */
  loop?: boolean;
  speed?: number;
  hull: number;
  shield: number;
  shieldRegen?: number;
  radius?: number;
  name?: string;
}

export class Ally {
  readonly id: string;
  readonly kind: AllyKind;
  readonly name: string;
  readonly pos: Vec3;
  readonly prev: Vec3;
  readonly vel = v3();
  readonly dur: Durability;
  readonly radius: number;
  readonly path: Vec3[];
  readonly loop: boolean;
  speed: number;
  pathIndex = 0;
  /** True once a non-looping path has been completed. */
  arrived = false;
  yaw = 0;

  constructor(spec: AllySpec) {
    this.id = spec.id;
    this.kind = spec.kind;
    this.name = spec.name ?? (spec.kind === "station" ? "Defence platform" : "Survey freighter");
    this.pos = { ...spec.position };
    this.prev = { ...spec.position };
    this.radius = spec.radius ?? (spec.kind === "station" ? 45 : 12);
    this.dur = new Durability({ maxShield: spec.shield, shieldRegen: spec.shieldRegen ?? (spec.kind === "station" ? 6 : 3), shieldDelay: 5, maxHull: spec.hull, armor: spec.kind === "station" ? 2 : 0.5, resistance: spec.kind === "station" ? 0.3 : 0.1 });
    this.path = (spec.path ?? []).map((p) => ({ ...p }));
    this.loop = !!spec.loop;
    this.speed = spec.speed ?? (spec.kind === "freighter" ? 18 : 0);
  }

  get alive(): boolean {
    return this.dur.alive;
  }

  update(dt: number): void {
    copy(this.prev, this.pos);
    this.dur.update(dt);
    this.vel.x = this.vel.y = this.vel.z = 0;
    if (!this.alive || this.arrived || this.speed <= 0 || this.path.length === 0) return;
    const wp = this.path[this.pathIndex];
    const d = { x: wp.x - this.pos.x, y: wp.y - this.pos.y, z: wp.z - this.pos.z };
    const l = normalize(d);
    const step = this.speed * dt;
    if (l <= step) {
      copy(this.pos, wp);
      this.pathIndex++;
      if (this.pathIndex >= this.path.length) {
        if (this.loop) this.pathIndex = 0;
        else this.arrived = true;
      }
    } else {
      this.pos.x += d.x * step;
      this.pos.y += d.y * step;
      this.pos.z += d.z * step;
    }
    if (dt > 0) {
      this.vel.x = (this.pos.x - this.prev.x) / dt;
      this.vel.y = (this.pos.y - this.prev.y) / dt;
      this.vel.z = (this.pos.z - this.prev.z) / dt;
    }
    if (Math.abs(d.x) + Math.abs(d.z) > 1e-6) this.yaw = Math.atan2(d.x, d.z);
  }
}
