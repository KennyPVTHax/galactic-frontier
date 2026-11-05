/**
 * Hunter squadron coordination (Hollow Choir Cantors).
 *
 * Modes:
 *  - form: wingmen hold V-formation slots on the leader (patrol / pursue / return).
 *  - engage: the squad breaks and FLANKS — each member swings to a different
 *    bearing around the target before starting attack runs, then re-flanks after
 *    every overshoot.
 *  - regroup: after heavy losses (≥ half the squad) or collapsed shields the
 *    survivors RETREAT to a rally point away from the target, reform on a
 *    (possibly promoted) leader, wait for shields, then re-engage.
 */
import { baseTransitions, canDetect, setState, type AiContext, type AiTarget, type Enemy } from "./ai";
import { clamp, dist, localToWorld, normalize, v3, type Vec3 } from "./vec";

export type SquadMode = "form" | "engage" | "regroup";

/** Leader-local slot offsets (x right, y up, z forward). Slot 0 = leader. */
export const FORMATION_SLOTS: [number, number, number][] = [
  [0, 0, 0],
  [-26, 3, -22],
  [26, 3, -22],
  [0, 9, -44],
  [-52, 6, -44],
  [52, 6, -44],
];

/** Flank bearings (rad) around the target relative to the squad's approach. */
const FLANKS = [0, 2.0, -2.0, Math.PI, 1.0, -1.0];

const tmp = v3();
const tmp2 = v3();

export class Squadron {
  readonly members: Enemy[] = [];
  leader!: Enemy;
  mode: SquadMode = "form";
  modeTime = 0;
  regroups = 0;
  readonly rally = v3();
  rallyYaw = 0;
  /** Horizontal direction from the target towards the squad when the engagement began. */
  readonly engageDir = v3(0, 0, 1);
  private lostAtRegroup = 0;
  initial = 0;

  constructor(readonly id: string) {}

  add(e: Enemy): void {
    e.squad = this;
    e.slot = this.members.length;
    this.members.push(e);
    if (this.members.length === 1) this.leader = e;
    this.initial = this.members.length;
  }

  get alive(): Enemy[] {
    return this.members.filter((m) => m.alive);
  }

  /** Squad-wide alert: every idle member starts DETECT together. */
  alert(ctx: AiContext): void {
    for (const m of this.members) if (m.alive && (m.state === "patrol" || m.state === "return")) setState(m, "detect", ctx);
  }

  /** World position of a member's formation slot on the leader. */
  slotPosition(e: Enemy, out: Vec3): Vec3 {
    const L = this.leader;
    const s = FORMATION_SLOTS[Math.min(e.slot, FORMATION_SLOTS.length - 1)];
    localToWorld(out, L.yaw, 0, 0, s[0], s[1], s[2]);
    out.x += L.pos.x;
    out.y += L.pos.y;
    out.z += L.pos.z;
    return out;
  }

  /** Once per frame before members update. */
  update(ctx: AiContext): void {
    const alive = this.alive;
    if (alive.length === 0) return;
    this.modeTime += ctx.dt;
    if (!this.leader.alive) {
      // Promote the next survivor and close up the slots.
      this.leader = alive[0];
      alive.forEach((m, i) => (m.slot = i));
    }
    const t = this.leader.target ?? alive.find((m) => m.target)?.target ?? ctx.player;
    const lost = this.initial - alive.length;
    let shield = 0, hull = 0;
    for (const m of alive) {
      shield += m.dur.shieldFrac;
      hull += m.dur.hullFrac;
    }
    shield /= alive.length;
    hull /= alive.length;

    switch (this.mode) {
      case "form":
        if (t && alive.some((m) => m.state === "attack")) this.engage(t, alive, ctx);
        break;
      case "engage": {
        const heavyLosses = lost - this.lostAtRegroup >= Math.max(1, Math.floor(this.initial / 2));
        const battered = shield < 0.15 && hull < 0.65;
        if (t && this.regroups < 2 && (heavyLosses || battered)) this.startRegroup(t, alive, ctx);
        else if (!t || alive.every((m) => m.state === "return" || m.state === "patrol")) {
          this.setMode("form");
          for (const m of alive) if (m.state !== "patrol") setState(m, "return", ctx);
        }
        break;
      }
      case "regroup": {
        if (!ctx.player) {
          this.setMode("form");
          for (const m of alive) setState(m, "return", ctx);
          break;
        }
        const gathered = alive.every((m) => dist(m.pos, this.rallySlot(m, tmp)) < 120);
        if ((this.modeTime > 5 && gathered && (shield >= 0.7 || this.modeTime > 12)) || this.modeTime > 16) {
          this.regroups++;
          this.setMode("form");
          for (const m of alive) setState(m, "pursue", ctx);
        }
        break;
      }
    }
  }

  private setMode(m: SquadMode): void {
    this.mode = m;
    this.modeTime = 0;
  }

  private engage(t: AiTarget, alive: Enemy[], ctx: AiContext): void {
    this.setMode("engage");
    const L = this.leader;
    this.engageDir.x = L.pos.x - t.pos.x;
    this.engageDir.y = 0;
    this.engageDir.z = L.pos.z - t.pos.z;
    normalize(this.engageDir);
    alive.forEach((m, i) => {
      m.flankAngle = FLANKS[i % FLANKS.length];
      // The leader presses straight in; wingmen swing wide first.
      m.flankTimer = i === 0 ? 0 : 4.5;
      if (m.state !== "attack" && m.state !== "evade") setState(m, "attack", ctx);
    });
  }

  private startRegroup(t: AiTarget, alive: Enemy[], ctx: AiContext): void {
    this.setMode("regroup");
    this.lostAtRegroup = this.initial - alive.length;
    const L = this.leader;
    tmp.x = L.pos.x - t.pos.x;
    tmp.y = 0;
    tmp.z = L.pos.z - t.pos.z;
    normalize(tmp);
    const env = ctx.env;
    let rx = L.pos.x + tmp.x * 380, rz = L.pos.z + tmp.z * 380;
    const r = Math.hypot(rx, rz), R = env.flightRadius - 160;
    if (r > R) {
      // Slide along the boundary instead of hugging it.
      rx *= R / r;
      rz *= R / r;
    }
    this.rally.x = rx;
    this.rally.z = rz;
    this.rally.y = clamp(Math.max(L.pos.y, env.groundAt(rx, rz) + 130), 0, env.maxAltitude - 90);
    this.rallyYaw = Math.atan2(t.pos.x - rx, t.pos.z - rz);
    for (const m of alive) {
      m.flankTimer = 0;
      m.breakTimer = 0;
      for (const w of m.weapons) w.cancel();
      setState(m, "retreat", ctx);
    }
  }

  rallySlot(e: Enemy, out: Vec3): Vec3 {
    const s = FORMATION_SLOTS[Math.min(e.slot, FORMATION_SLOTS.length - 1)];
    localToWorld(out, this.rallyYaw, 0, 0, s[0], s[1], s[2]);
    out.x += this.rally.x;
    out.y += this.rally.y;
    out.z += this.rally.z;
    return out;
  }

  /** Per-member state transitions (replaces baseTransitions for squad members). */
  memberTransitions(e: Enemy, t: AiTarget | null, d: number, ctx: AiContext): void {
    if (this.mode === "regroup") {
      if (e.state !== "retreat") setState(e, "retreat", ctx);
      return;
    }
    const isLeader = this.leader === e;
    if (e.state === "patrol" || e.state === "return") {
      if (t && canDetect(e, t)) {
        this.alert(ctx);
        return;
      }
      if (!isLeader) {
        if (this.leader.state === "patrol" && e.state === "return" && dist(e.pos, this.slotPosition(e, tmp)) < 80) setState(e, "patrol", ctx);
        return;
      }
      baseTransitions(e, t, d, ctx);
      return;
    }
    if (this.mode === "form" && !isLeader && e.state === "pursue") {
      if (!t) setState(e, "return", ctx);
      // Wingmen hold formation until the leader commits (squad engage).
      return;
    }
    if (this.mode === "form" && !isLeader && e.state === "attack" && this.leader.state !== "attack") {
      setState(e, "pursue", ctx);
      return;
    }
    if (this.mode === "engage" && e.state === "pursue" && t && d < e.def.attackRange) {
      setState(e, "attack", ctx);
      return;
    }
    baseTransitions(e, t, d, ctx);
  }

  /** Formation keeping. Writes a desired direction, returns a desired speed. */
  formationSteer(e: Enemy, desired: Vec3, pursuing = false): number {
    const L = this.leader;
    const slot = this.slotPosition(e, tmp);
    // Aim slightly ahead of the slot so wingmen don't trail.
    slot.x += L.vel.x * 0.6;
    slot.y += L.vel.y * 0.6;
    slot.z += L.vel.z * 0.6;
    tmp2.x = slot.x - e.pos.x;
    tmp2.y = slot.y - e.pos.y;
    tmp2.z = slot.z - e.pos.z;
    const gap = normalize(tmp2);
    const w = clamp(gap / 45, 0, 1);
    desired.x = L.fwd.x * (1 - w) + tmp2.x * (w + 0.35);
    desired.y = L.fwd.y * (1 - w) + tmp2.y * (w + 0.35);
    desired.z = L.fwd.z * (1 - w) + tmp2.z * (w + 0.35);
    normalize(desired);
    const along = tmp2.x * L.fwd.x + tmp2.y * L.fwd.y + tmp2.z * L.fwd.z;
    const base = Math.max(L.speed, pursuing ? L.def.cruiseSpeed : 0);
    return clamp(base + along * gap * 0.8, e.def.cruiseSpeed * 0.4, e.maxSpeed * 1.12);
  }

  rallySteer(e: Enemy, desired: Vec3): number {
    const p = this.rallySlot(e, tmp);
    desired.x = p.x - e.pos.x;
    desired.y = p.y - e.pos.y;
    desired.z = p.z - e.pos.z;
    const d = normalize(desired);
    if (d < 40) {
      // Hold station facing the target while shields recharge.
      desired.x = Math.sin(this.rallyYaw) + desired.x * 0.3;
      desired.y = desired.y * 0.3;
      desired.z = Math.cos(this.rallyYaw) + desired.z * 0.3;
      normalize(desired);
      return e.def.cruiseSpeed * 0.5;
    }
    return d > 150 ? e.maxSpeed : e.def.cruiseSpeed;
  }

  /** Flanking leg of an attack: returns false once the flank point is reached. */
  flankSteer(e: Enemy, t: AiTarget, desired: Vec3, ctx: AiContext): boolean {
    e.flankTimer -= ctx.dt;
    const c = Math.cos(e.flankAngle), s = Math.sin(e.flankAngle);
    const bx = this.engageDir.x * c + this.engageDir.z * s;
    const bz = -this.engageDir.x * s + this.engageDir.z * c;
    const R = e.def.preferredRange * 1.15;
    tmp.x = t.pos.x + bx * R;
    tmp.z = t.pos.z + bz * R;
    tmp.y = t.pos.y + (e.slot % 2 === 1 ? 45 : 15);
    desired.x = tmp.x - e.pos.x;
    desired.y = tmp.y - e.pos.y;
    desired.z = tmp.z - e.pos.z;
    const d = normalize(desired);
    if (d < 70 || e.flankTimer <= 0) {
      e.flankTimer = 0;
      return false;
    }
    return true;
  }

  /** After an overshoot, swing to a new bearing before the next run. */
  reflank(e: Enemy, ctx: AiContext): void {
    if (this.mode !== "engage") return;
    e.flankAngle += (ctx.rng() < 0.5 ? -1 : 1) * (1.2 + ctx.rng() * 0.9);
    e.flankTimer = 3.5;
  }
}
