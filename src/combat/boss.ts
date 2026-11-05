/**
 * Dreadnought ("Threnody") boss logic: separately destroyable hardpoints, a
 * shield generator that powers the core shield, and three combat phases.
 *
 *   Phase 1 (hull > 66 %): dirge turrets only, at most 2 charging at once.
 *   Phase 2 (≤ 66 %): seeker racks come online and the drone nave launches a
 *                     Cantor wing (if the hangar still stands).
 *   Phase 3 (≤ 33 %): ENRAGED — fire rate ×1.6, faster turning and movement,
 *                     every turret may fire together, a second launch.
 */
import { Durability } from "./damage";
import type { DifficultyScale, EnemyTypeDef, HardpointDef } from "./enemyTypes";
import { BurstWeapon, WEAPONS } from "./weapons";
import type { AiContext, Enemy } from "./ai";
import { copy, dist, localToWorld, v3, type Rng, type Vec3 } from "./vec";

export class Hardpoint {
  readonly dur: Durability;
  readonly weapon: BurstWeapon | null;
  readonly world = v3();
  readonly prev = v3();

  constructor(
    readonly def: HardpointDef,
    scale: DifficultyScale,
    rng: Rng,
  ) {
    this.dur = new Durability({ maxShield: 0, shieldRegen: 0, shieldDelay: 0, maxHull: def.hull * scale.hullMul, armor: def.armor, resistance: def.resistance });
    this.weapon = def.weapon ? new BurstWeapon(WEAPONS[def.weapon], scale.fireRateMul, 1 + rng() * 2.5) : null;
  }

  get id(): string {
    return this.def.id;
  }
  get alive(): boolean {
    return this.dur.alive;
  }
}

export const PHASE_THRESHOLDS = [0.66, 0.33];

export class BossState {
  phase = 1;
  enraged = false;
  launches = 0;
  readonly hardpoints: Hardpoint[];
  generatorDown = false;

  constructor(def: EnemyTypeDef, scale: DifficultyScale, rng: Rng) {
    this.hardpoints = (def.hardpoints ?? []).map((h) => new Hardpoint(h, scale, rng));
  }

  hardpoint(id: string): Hardpoint | undefined {
    return this.hardpoints.find((h) => h.id === id);
  }

  /** Phase implied by a hull fraction. */
  static phaseFor(hullFrac: number): number {
    return hullFrac <= PHASE_THRESHOLDS[1] ? 3 : hullFrac <= PHASE_THRESHOLDS[0] ? 2 : 1;
  }
}

/** Places hardpoints in world space (call after the hull moved). */
export function placeHardpoints(e: Enemy, initial = false): void {
  const b = e.boss;
  if (!b) return;
  for (const h of b.hardpoints) {
    if (!initial) copy(h.prev, h.world);
    const o = h.def.offset;
    localToWorld(h.world, e.yaw, e.pitch, 0, o[0], o[1], o[2]);
    h.world.x += e.pos.x;
    h.world.y += e.pos.y;
    h.world.z += e.pos.z;
    if (initial) copy(h.prev, h.world);
  }
}

const tmp = v3();

export function updateBoss(e: Enemy, ctx: AiContext): void {
  const b = e.boss;
  if (!b || !e.alive) return;
  placeHardpoints(e);

  // Shield generator powers the core shield.
  const gen = b.hardpoint("generator");
  if (gen && !gen.alive && !b.generatorDown) {
    b.generatorDown = true;
    e.dur.regenEnabled = false;
    if (e.dur.shield > 0) ctx.events.push({ type: "enemyShieldDown", id: e.id });
    e.dur.shield = 0;
  }

  // Phases.
  const phase = BossState.phaseFor(e.dur.hullFrac);
  while (b.phase < phase) {
    b.phase++;
    ctx.events.push({ type: "bossPhase", id: e.id, phase: b.phase });
    const hangar = b.hardpoint("hangar");
    if (hangar?.alive) {
      const count = b.phase === 2 ? 3 : 2;
      b.launches++;
      ctx.spawnEscorts(e, count);
      ctx.events.push({ type: "bossLaunch", id: e.id, count });
    }
    if (b.phase === 3 && !b.enraged) {
      b.enraged = true;
      for (const h of b.hardpoints) if (h.weapon) h.weapon.rate *= 1.6;
    }
  }

  // Hardpoint weapons fire independently.
  const t = e.target;
  const engaged = !!t && (e.state === "pursue" || e.state === "attack");
  const maxCharging = b.phase === 1 ? 2 : b.phase === 2 ? 3 : 8;
  let charging = 0;
  for (const h of b.hardpoints) if (h.alive && h.weapon?.charging) charging++;
  for (const h of b.hardpoints) {
    const w = h.weapon;
    if (!w || !h.alive) continue;
    const shots = w.update(ctx.dt);
    if (!engaged || !t) {
      if (w.busy) w.cancel();
      continue;
    }
    if (shots > 0) for (let i = 0; i < shots; i++) ctx.fireWeapon(e, w, h.world, t, h.id);
    if (w.busy || w.cooldown > 0 || charging >= maxCharging) continue;
    if (h.def.kind === "seeker" && b.phase < 2) continue;
    if (dist(h.world, t.pos) > w.def.range * 0.92) continue;
    // Turrets cover the hemisphere on their side of the hull.
    tmp.x = t.pos.x - e.pos.x;
    tmp.y = t.pos.y - e.pos.y;
    tmp.z = t.pos.z - e.pos.z;
    const ox = h.world.x - e.pos.x, oy = h.world.y - e.pos.y, oz = h.world.z - e.pos.z;
    if (tmp.x * ox + tmp.y * oy + tmp.z * oz < -0.35 * Math.hypot(tmp.x, tmp.y, tmp.z) * Math.hypot(ox, oy, oz)) continue;
    if (w.trigger()) {
      charging++;
      ctx.events.push({ type: "enemyTelegraph", id: e.id, position: { ...h.world }, weapon: w.def.id, duration: w.def.windup, hardpoint: h.id });
    }
  }
}
