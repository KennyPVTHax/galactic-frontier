/**
 * Pooled projectile store. Projectiles are plain objects recycled through a
 * free list; `live` is compacted with swap-remove so iteration stays dense.
 */
import type { BoltKind, WeaponId } from "./weapons";
import type { Vec3 } from "./vec";

export type ProjectileOwner = "player" | "enemy";

export interface Projectile {
  /** Monotonic id (stable while alive; useful for visual interpolation). */
  id: number;
  owner: ProjectileOwner;
  /** Enemy id (or "player") that fired it. */
  sourceId: string;
  weapon: WeaponId;
  kind: BoltKind;
  x: number;
  y: number;
  z: number;
  /** Position at the start of the last step (hit segment start). */
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  speed: number;
  damage: number;
  radius: number;
  /** Remaining life (s). */
  life: number;
  maxLife: number;
  /** Homing turn rate (rad/s); 0 = ballistic. */
  homing: number;
  /** Homing target id ("player" or ally id). */
  targetId: string | null;
  /** Visual length (m). */
  length: number;
}

export class ProjectilePool {
  readonly live: Projectile[] = [];
  private readonly free: Projectile[] = [];
  private nextId = 1;

  constructor(public capacity = 600) {}

  get count(): number {
    return this.live.length;
  }

  /** Returns a fresh projectile or null when the pool is at capacity. */
  spawn(owner: ProjectileOwner, sourceId: string, weapon: WeaponId, kind: BoltKind, pos: Vec3, vel: Vec3, damage: number, radius: number, life: number, homing = 0, targetId: string | null = null, length = 4): Projectile | null {
    if (this.live.length >= this.capacity) return null;
    const p: Projectile = this.free.pop() ?? ({} as Projectile);
    p.id = this.nextId++;
    p.owner = owner;
    p.sourceId = sourceId;
    p.weapon = weapon;
    p.kind = kind;
    p.x = p.px = pos.x;
    p.y = p.py = pos.y;
    p.z = p.pz = pos.z;
    p.vx = vel.x;
    p.vy = vel.y;
    p.vz = vel.z;
    p.speed = Math.hypot(vel.x, vel.y, vel.z);
    p.damage = damage;
    p.radius = radius;
    p.life = p.maxLife = life;
    p.homing = homing;
    p.targetId = targetId;
    p.length = length;
    this.live.push(p);
    return p;
  }

  /** Removes the projectile at index i (swap-remove). */
  removeAt(i: number): void {
    const arr = this.live;
    const p = arr[i];
    const last = arr.pop()!;
    if (i < arr.length) arr[i] = last;
    this.free.push(p);
  }

  clear(): void {
    while (this.live.length) this.free.push(this.live.pop()!);
  }
}
