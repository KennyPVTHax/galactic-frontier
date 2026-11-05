/**
 * Player target selection & locking.
 *
 *  - Auto-select: the hostile (or dreadnought hardpoint) nearest the reticle
 *    inside AUTO_CONE and lock range; small hysteresis avoids flicker.
 *  - Cycle: steps through every hostile in range ordered by angle from the
 *    reticle; a cycled target is "manual" and sticks until it dies or leaves range.
 *  - Lock: holding the reticle within LOCK_CONE for LOCK_TIME seconds locks;
 *    locked shots get mild lead aim assist (see CombatSystem).
 */
import type { Enemy } from "./ai";
import type { Hardpoint } from "./boss";
import type { CombatEvent } from "./events";
import { v3, type Vec3 } from "./vec";

export const AUTO_CONE = (22 * Math.PI) / 180;
export const LOCK_CONE = (10 * Math.PI) / 180;
export const LOCK_TIME = 0.6;

export interface TargetRef {
  enemy: Enemy;
  hardpoint: Hardpoint | null;
}

export function targetPos(r: TargetRef): Vec3 {
  return r.hardpoint ? r.hardpoint.world : r.enemy.pos;
}
export function targetRadius(r: TargetRef): number {
  return r.hardpoint ? r.hardpoint.def.radius : r.enemy.def.radius;
}
export function targetAlive(r: TargetRef): boolean {
  return r.enemy.alive && (!r.hardpoint || r.hardpoint.alive);
}
export function sameTarget(a: TargetRef | null, b: TargetRef | null): boolean {
  return a === b || (!!a && !!b && a.enemy === b.enemy && a.hardpoint === b.hardpoint);
}

interface Candidate {
  ref: TargetRef;
  cos: number;
  dist: number;
}

const dirTmp = v3();

export class Targeting {
  current: TargetRef | null = null;
  manual = false;
  lockTime = 0;
  locked = false;
  private readonly cand: Candidate[] = [];

  get lockProgress(): number {
    return Math.min(1, this.lockTime / LOCK_TIME);
  }

  clear(events?: CombatEvent[]): void {
    if (this.current && events) events.push({ type: "targetChanged", id: null, hardpoint: null });
    this.current = null;
    this.manual = false;
    this.lockTime = 0;
    this.locked = false;
  }

  private collect(from: Vec3, aim: Vec3, enemies: readonly Enemy[], range: number): void {
    this.cand.length = 0;
    const push = (ref: TargetRef, p: Vec3) => {
      dirTmp.x = p.x - from.x;
      dirTmp.y = p.y - from.y;
      dirTmp.z = p.z - from.z;
      const d = Math.hypot(dirTmp.x, dirTmp.y, dirTmp.z);
      if (d > range || d < 1e-3) return;
      this.cand.push({ ref, cos: (dirTmp.x * aim.x + dirTmp.y * aim.y + dirTmp.z * aim.z) / d, dist: d });
    };
    for (const e of enemies) {
      if (!e.alive) continue;
      push({ enemy: e, hardpoint: null }, e.pos);
      if (e.boss) for (const h of e.boss.hardpoints) if (h.alive) push({ enemy: e, hardpoint: h }, h.world);
    }
  }

  private setTarget(ref: TargetRef | null, manual: boolean, events: CombatEvent[]): void {
    if (sameTarget(ref, this.current)) {
      this.manual = manual || this.manual;
      return;
    }
    this.current = ref;
    this.manual = manual && !!ref;
    this.lockTime = 0;
    this.locked = false;
    events.push({ type: "targetChanged", id: ref ? ref.enemy.id : null, hardpoint: ref?.hardpoint ? ref.hardpoint.id : null });
  }

  update(dt: number, from: Vec3, aim: Vec3, enemies: readonly Enemy[], cycle: boolean, range: number, events: CombatEvent[]): void {
    // Drop dead / out-of-range targets.
    if (this.current) {
      const p = targetPos(this.current);
      const d = Math.hypot(p.x - from.x, p.y - from.y, p.z - from.z);
      if (!targetAlive(this.current) || d > range * 1.15) this.setTarget(null, false, events);
    }
    this.collect(from, aim, enemies, range);
    const cands = this.cand;
    if (cycle && cands.length) {
      cands.sort((a, b) => b.cos - a.cos);
      const idx = this.current ? cands.findIndex((c) => sameTarget(c.ref, this.current)) : -1;
      const next = cands[(idx + 1) % cands.length];
      this.setTarget(next.ref, true, events);
    } else if (!this.manual) {
      const cosAuto = Math.cos(AUTO_CONE);
      let best: Candidate | null = null;
      for (const c of cands) if (c.cos >= cosAuto && (!best || c.cos > best.cos)) best = c;
      if (best) {
        const cur = this.current ? cands.find((c) => sameTarget(c.ref, this.current)) : undefined;
        if (!cur || best.cos > cur.cos + 0.004) this.setTarget(best.ref, false, events);
      }
    }

    // Lock progress.
    if (this.current) {
      const p = targetPos(this.current);
      dirTmp.x = p.x - from.x;
      dirTmp.y = p.y - from.y;
      dirTmp.z = p.z - from.z;
      const d = Math.hypot(dirTmp.x, dirTmp.y, dirTmp.z) || 1;
      const c = (dirTmp.x * aim.x + dirTmp.y * aim.y + dirTmp.z * aim.z) / d;
      // Lock cone widens slightly for big / close targets.
      const cone = Math.max(LOCK_CONE, Math.atan2(targetRadius(this.current), d));
      if (c >= Math.cos(cone)) this.lockTime = Math.min(LOCK_TIME, this.lockTime + dt);
      else this.lockTime = Math.max(0, this.lockTime - dt * 1.5);
      const was = this.locked;
      if (this.lockTime >= LOCK_TIME) this.locked = true;
      else if (this.lockTime <= 0) this.locked = false;
      if (this.locked && !was) events.push({ type: "targetLocked", id: this.current.enemy.id, hardpoint: this.current.hardpoint?.id ?? null });
    }
  }
}
