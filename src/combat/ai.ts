/**
 * Enemy entity + explicit AI state machine:
 *
 *   PATROL ──detect (range+cone / proximity / provoked)──▶ DETECT ──reaction delay──▶ PURSUE
 *   PURSUE ──in attack range──▶ ATTACK ──hit / shield down──▶ EVADE ──▶ PURSUE/ATTACK
 *   PURSUE/ATTACK ──low hull──▶ RETREAT ──recovered──▶ PURSUE
 *   any engaged state ──target lost / player docked or landed──▶ RETURN ──at anchor──▶ PATROL
 *
 * Steering is arcade 3D flight (forward vector turned at a capped rate, speed
 * along the nose plus an evasive strafe) with terrain clearance and flight-volume
 * bounds. Hunters defer high-level decisions to their Squadron; dreadnoughts add
 * hardpoint/phase logic in boss.ts.
 */
import type { AiState, EnemyTypeId, FactionId } from "./ids";
import type { Ally } from "./allies";
import { Durability } from "./damage";
import type { DifficultyScale, EnemyTypeDef } from "./enemyTypes";
import type { CombatEvent } from "./events";
import { BurstWeapon, WEAPONS } from "./weapons";
import type { Squadron } from "./squadron";
import type { BossState } from "./boss";
import { clamp, copy, dist, dot, normalize, turnTowards, v3, type Rng, type Vec3 } from "./vec";

export interface CombatEnv {
  groundAt(x: number, z: number): number;
  flightRadius: number;
  maxAltitude: number;
}

export interface AiTarget {
  id: string;
  pos: Vec3;
  vel: Vec3;
  radius: number;
  isPlayer: boolean;
}

export interface AiContext {
  dt: number;
  time: number;
  rng: Rng;
  env: CombatEnv;
  events: CombatEvent[];
  /** Null when the player is dead or protected (docked / landed). */
  player: AiTarget | null;
  allies: readonly Ally[];
  /** Attack-token check: caps how many enemies may fire on the player at once. */
  canAttack(e: Enemy): boolean;
  fireWeapon(e: Enemy, w: BurstWeapon, origin: Vec3, target: AiTarget, hardpoint?: string): void;
  spawnEscorts(e: Enemy, count: number): void;
}

export interface EnemyOptions {
  id: string;
  scale: DifficultyScale;
  encounter?: string | null;
  anchor?: Vec3;
  yaw?: number;
  /** Prefer attacking allies (escort/defence missions). */
  prefersAlly?: boolean;
  /** Start already hunting the player (skips PATROL). */
  engaged?: boolean;
}

export class Enemy {
  readonly id: string;
  readonly type: EnemyTypeId;
  readonly def: EnemyTypeDef;
  readonly faction: FactionId;
  readonly scale: DifficultyScale;
  readonly encounter: string | null;
  readonly pos: Vec3;
  readonly prev: Vec3;
  readonly vel = v3();
  readonly fwd = v3(0, 0, 1);
  readonly anchor: Vec3;
  speed: number;
  yaw = 0;
  pitch = 0;
  roll = 0;
  readonly dur: Durability;
  readonly weapons: BurstWeapon[];
  readonly maxSpeed: number;
  state: AiState = "patrol";
  stateTime = 0;
  /** Debug: when set, the state machine will not leave this state. */
  pinnedState: AiState | null = null;
  prefersAlly: boolean;
  /** Seconds since the player last damaged this ship. */
  sincePlayerHit = 1e9;
  /** Seconds since any damage (visual hit flash). */
  sinceHit = 1e9;
  patrolAngle: number;
  patrolDir: 1 | -1;
  lostTimer = 0;
  evadeCooldown = 0;
  readonly jink = v3();
  jinkTimer = 0;
  breakTimer = 0;
  readonly breakDir = v3();
  retreats = 0;
  /** Squadron membership (hunters). */
  squad: Squadron | null = null;
  slot = 0;
  flankTimer = 0;
  flankAngle = 0;
  /** Dreadnought hardpoints / phases. */
  boss: BossState | null = null;
  /** Current AI target (resolved every update). */
  target: AiTarget | null = null;
  readonly allyTarget: AiTarget = { id: "", pos: v3(), vel: v3(), radius: 0, isPlayer: false };
  /** Rolled once at spawn so tests can inspect it. */
  readonly speedMul: number;

  constructor(def: EnemyTypeDef, pos: Vec3, rng: Rng, opts: EnemyOptions) {
    this.id = opts.id;
    this.type = def.id;
    this.def = def;
    this.faction = def.faction;
    this.scale = opts.scale;
    this.encounter = opts.encounter ?? null;
    this.pos = { ...pos };
    this.prev = { ...pos };
    this.anchor = { ...(opts.anchor ?? pos) };
    this.yaw = opts.yaw ?? rng() * Math.PI * 2;
    this.fwd.x = Math.sin(this.yaw);
    this.fwd.z = Math.cos(this.yaw);
    this.speedMul = opts.scale.speedMul;
    this.maxSpeed = def.maxSpeed * this.speedMul;
    this.speed = def.cruiseSpeed;
    const s = opts.scale;
    this.dur = new Durability({ maxShield: def.shield * s.shieldMul, shieldRegen: def.shieldRegen * s.shieldMul, shieldDelay: def.shieldDelay, maxHull: def.hull * s.hullMul, armor: def.armor, resistance: def.resistance });
    // Stagger first bursts so a group never opens fire on the same frame.
    this.weapons = def.weapons.map((w) => new BurstWeapon(WEAPONS[w], s.fireRateMul, 0.6 + rng() * 1.2));
    this.patrolAngle = rng() * Math.PI * 2;
    this.patrolDir = rng() < 0.5 ? 1 : -1;
    this.prefersAlly = !!opts.prefersAlly;
    if (opts.engaged) this.state = "pursue";
  }

  get alive(): boolean {
    return this.dur.alive;
  }
  get engaged(): boolean {
    return this.state === "detect" || this.state === "pursue" || this.state === "attack" || this.state === "evade";
  }
  /** True while any weapon is charging its telegraph. */
  get charging(): boolean {
    if (this.weapons.some((w) => w.charging)) return true;
    return !!this.boss && this.boss.hardpoints.some((h) => h.alive && !!h.weapon?.charging);
  }
}

// ------------------------------------------------------------------ state helpers

export function setState(e: Enemy, to: AiState, ctx: { events: CombatEvent[] }): void {
  if (e.state === to) return;
  if (e.pinnedState && e.pinnedState !== to) return;
  const from = e.state;
  e.state = to;
  e.stateTime = 0;
  if (to === "return" || to === "patrol") {
    for (const w of e.weapons) w.cancel();
    e.lostTimer = 0;
  }
  if (to === "attack") e.breakTimer = 0;
  ctx.events.push({ type: "aiStateChanged", id: e.id, from, to });
}

/** Can `e` currently see `t`? Detection sphere ∩ nose cone, or close proximity. */
export function canDetect(e: Enemy, t: AiTarget): boolean {
  const dx = t.pos.x - e.pos.x, dy = t.pos.y - e.pos.y, dz = t.pos.z - e.pos.z;
  const d = Math.hypot(dx, dy, dz);
  if (d <= e.def.senseRange) return true;
  if (d > e.def.detectRange) return false;
  const c = (dx * e.fwd.x + dy * e.fwd.y + dz * e.fwd.z) / Math.max(d, 1e-6);
  return c >= Math.cos(e.def.detectCone);
}

/** Resolves who this enemy is after: provoked → player; ally-focused → nearest ally; else player. */
export function chooseTarget(e: Enemy, ctx: AiContext): AiTarget | null {
  const p = ctx.player;
  if (!p) return null;
  if (e.prefersAlly && e.sincePlayerHit > 6) {
    let best: Ally | null = null;
    let bd = Infinity;
    for (const a of ctx.allies) {
      if (!a.alive) continue;
      const d = dist(a.pos, e.pos);
      if (d < bd) {
        bd = d;
        best = a;
      }
    }
    if (best) {
      const t = e.allyTarget;
      t.id = best.id;
      copy(t.pos, best.pos);
      copy(t.vel, best.vel);
      t.radius = best.radius;
      return t;
    }
  }
  return p;
}

/** Lead point for a projectile of `speed` from `from` at target t (relative to shooter velocity 0). */
export function leadPoint(out: Vec3, from: Vec3, t: AiTarget, speed: number): Vec3 {
  const rx = t.pos.x - from.x, ry = t.pos.y - from.y, rz = t.pos.z - from.z;
  const d = Math.hypot(rx, ry, rz);
  const time = Math.min(3, d / Math.max(1, speed));
  // One refinement step is plenty for steering/aim.
  const lx = rx + t.vel.x * time, ly = ry + t.vel.y * time, lz = rz + t.vel.z * time;
  const t2 = Math.min(3, Math.hypot(lx, ly, lz) / Math.max(1, speed));
  out.x = t.pos.x + t.vel.x * t2;
  out.y = t.pos.y + t.vel.y * t2;
  out.z = t.pos.z + t.vel.z * t2;
  return out;
}

const tmpD = v3();
const tmpA = v3();
const tmpB = v3();

/** Begins an evasive jink: lateral + vertical swerve for ~1.4 s. */
export function startEvade(e: Enemy, ctx: AiContext): void {
  if (e.evadeCooldown > 0 || e.type === "dreadnought" || e.type === "raider") return;
  pickJink(e, ctx.rng);
  e.evadeCooldown = 4.5;
  setState(e, "evade", ctx);
}

function pickJink(e: Enemy, rng: Rng): void {
  // Perpendicular to the nose: right = (fz, 0, -fx), plus a vertical component.
  const side = rng() < 0.5 ? -1 : 1;
  const rl = Math.hypot(e.fwd.x, e.fwd.z) || 1;
  e.jink.x = (e.fwd.z / rl) * side;
  e.jink.z = (-e.fwd.x / rl) * side;
  e.jink.y = (rng() - 0.4) * 1.2;
  normalize(e.jink);
  e.jinkTimer = 0.45 + rng() * 0.25;
}

/** Called by the combat system when this enemy is damaged. */
export function onEnemyDamaged(e: Enemy, byPlayer: boolean, shieldDown: boolean, ctx: AiContext): void {
  e.sinceHit = 0;
  if (byPlayer) e.sincePlayerHit = 0;
  if (!e.alive) return;
  if (e.state === "patrol" || e.state === "return") {
    // Provoked: skip straight to a short DETECT.
    if (ctx.player) {
      setState(e, "detect", ctx);
      e.stateTime = Math.max(0, e.def.reaction * e.scale.reactionMul - 0.25);
      e.squad?.alert(ctx);
    }
    return;
  }
  if (e.squad && e.squad.mode === "regroup") return;
  if (e.state === "attack" || e.state === "pursue") {
    if ((shieldDown && e.def.evadeOnShieldDown) || ctx.rng() < e.def.evadeChance) startEvade(e, ctx);
  }
}

// ------------------------------------------------------------------ main update

export function updateEnemy(e: Enemy, ctx: AiContext): void {
  const dt = ctx.dt;
  copy(e.prev, e.pos);
  e.dur.update(dt);
  e.stateTime += dt;
  e.sincePlayerHit += dt;
  e.sinceHit += dt;
  e.evadeCooldown = Math.max(0, e.evadeCooldown - dt);

  const t = chooseTarget(e, ctx);
  e.target = t;
  const d = t ? dist(t.pos, e.pos) : Infinity;
  const def = e.def;

  // ---- transitions (squad members delegate to the squadron)
  if (!e.squad) baseTransitions(e, t, d, ctx);
  else e.squad.memberTransitions(e, t, d, ctx);

  // ---- steering
  const desired = tmpD;
  let speed = def.cruiseSpeed * e.speedMul;
  let strafe = 0;
  const turnMul = e.boss?.enraged ? 1.6 : 1;
  switch (e.state) {
    case "patrol": {
      if (e.squad && e.squad.leader !== e) {
        speed = e.squad.formationSteer(e, desired);
        break;
      }
      const R = def.patrolRadius;
      e.patrolAngle += ((def.cruiseSpeed * e.speedMul) / R) * dt * e.patrolDir;
      const a = e.patrolAngle + 0.45 * e.patrolDir;
      tmpA.x = e.anchor.x + Math.cos(a) * R;
      tmpA.z = e.anchor.z + Math.sin(a) * R;
      tmpA.y = e.anchor.y + Math.sin(a * 2) * 8;
      desired.x = tmpA.x - e.pos.x;
      desired.y = tmpA.y - e.pos.y;
      desired.z = tmpA.z - e.pos.z;
      normalize(desired);
      break;
    }
    case "detect": {
      if (t) {
        desired.x = t.pos.x - e.pos.x;
        desired.y = t.pos.y - e.pos.y;
        desired.z = t.pos.z - e.pos.z;
        normalize(desired);
      } else copy(desired, e.fwd);
      speed = def.cruiseSpeed * 0.8 * e.speedMul;
      break;
    }
    case "pursue": {
      if (e.squad && e.squad.leader !== e && e.squad.mode === "form") {
        speed = e.squad.formationSteer(e, desired, true);
        break;
      }
      if (t) {
        leadPoint(tmpA, e.pos, t, e.maxSpeed);
        desired.x = tmpA.x - e.pos.x;
        desired.y = tmpA.y - e.pos.y;
        desired.z = tmpA.z - e.pos.z;
        normalize(desired);
      } else copy(desired, e.fwd);
      speed = e.maxSpeed;
      if (e.type === "dreadnought" && d < def.preferredRange) speed = e.maxSpeed * 0.4;
      break;
    }
    case "attack": {
      speed = attackSteer(e, t, d, desired, ctx);
      break;
    }
    case "evade": {
      e.jinkTimer -= dt;
      if (e.jinkTimer <= 0) pickJink(e, ctx.rng);
      desired.x = e.fwd.x * 0.6 + e.jink.x;
      desired.y = e.fwd.y * 0.6 + e.jink.y;
      desired.z = e.fwd.z * 0.6 + e.jink.z;
      normalize(desired);
      speed = e.maxSpeed * 1.15;
      strafe = 18;
      break;
    }
    case "retreat": {
      if (e.squad) {
        speed = e.squad.rallySteer(e, desired);
        break;
      }
      if (t) {
        desired.x = e.pos.x - t.pos.x;
        desired.y = 0;
        desired.z = e.pos.z - t.pos.z;
        normalize(desired);
        desired.y = 0.3;
        normalize(desired);
      } else copy(desired, e.fwd);
      speed = e.maxSpeed;
      break;
    }
    case "return": {
      if (e.squad && e.squad.leader !== e) {
        speed = e.squad.formationSteer(e, desired);
        break;
      }
      desired.x = e.anchor.x - e.pos.x;
      desired.y = e.anchor.y - e.pos.y;
      desired.z = e.anchor.z - e.pos.z;
      normalize(desired);
      speed = def.cruiseSpeed * 1.2 * e.speedMul;
      break;
    }
  }
  if (e.boss?.enraged) speed *= 1.5;

  avoidTerrainAndBounds(e, desired, ctx.env);

  // ---- integrate
  const prevYaw = e.yaw;
  turnTowards(e.fwd, desired, def.turnRate * turnMul * (e.state === "evade" ? 1.35 : 1) * dt);
  const maxPitch = e.type === "dreadnought" ? 0.12 : 0.85;
  if (Math.abs(e.fwd.y) > maxPitch) {
    const h = Math.hypot(e.fwd.x, e.fwd.z) || 1e-6;
    const ny = Math.sign(e.fwd.y) * maxPitch;
    const k = Math.sqrt(1 - ny * ny) / h;
    e.fwd.x *= k;
    e.fwd.z *= k;
    e.fwd.y = ny;
  }
  const accel = def.accel * (e.state === "evade" ? 1.6 : 1);
  if (e.speed < speed) e.speed = Math.min(speed, e.speed + accel * dt);
  else e.speed = Math.max(speed, e.speed - accel * 1.2 * dt);
  e.vel.x = e.fwd.x * e.speed + e.jink.x * strafe;
  e.vel.y = e.fwd.y * e.speed + e.jink.y * strafe;
  e.vel.z = e.fwd.z * e.speed + e.jink.z * strafe;
  if (strafe === 0) e.jink.x = e.jink.y = e.jink.z = 0;
  e.pos.x += e.vel.x * dt;
  e.pos.y += e.vel.y * dt;
  e.pos.z += e.vel.z * dt;
  clampToVolume(e, ctx.env);

  e.yaw = Math.atan2(e.fwd.x, e.fwd.z);
  e.pitch = Math.asin(clamp(e.fwd.y, -1, 1));
  if (e.type === "dreadnought") e.roll = 0;
  else {
    let dy = e.yaw - prevYaw;
    if (dy > Math.PI) dy -= Math.PI * 2;
    if (dy < -Math.PI) dy += Math.PI * 2;
    const rollTarget = clamp((-dy / Math.max(dt, 1e-3)) * 0.55, -1.1, 1.1) + (e.state === "evade" ? Math.sin(e.stateTime * 9) * 0.5 : 0);
    e.roll += (rollTarget - e.roll) * Math.min(1, dt * 5);
  }

  // ---- weapons (dreadnought hardpoints fire from boss.ts)
  fireControl(e, t, d, ctx);
}

export function baseTransitions(e: Enemy, t: AiTarget | null, d: number, ctx: AiContext): void {
  const def = e.def;
  switch (e.state) {
    case "patrol":
      if (t && canDetect(e, t)) setState(e, "detect", ctx);
      break;
    case "return":
      if (t && canDetect(e, t)) setState(e, "detect", ctx);
      else if (dist(e.pos, e.anchor) < Math.max(45, def.patrolRadius * 0.5)) setState(e, "patrol", ctx);
      break;
    case "detect":
      if (!t) setState(e, "return", ctx);
      else if (e.stateTime >= def.reaction * e.scale.reactionMul) setState(e, "pursue", ctx);
      break;
    case "pursue":
    case "attack":
      if (!t) {
        setState(e, "return", ctx);
        break;
      }
      if (def.retreatHull > 0 && e.retreats < 1 && e.dur.hullFrac < def.retreatHull) {
        e.retreats++;
        setState(e, "retreat", ctx);
        break;
      }
      if (d > def.detectRange * 1.8) {
        e.lostTimer += ctx.dt;
        if (e.lostTimer > 5) setState(e, "return", ctx);
      } else e.lostTimer = 0;
      if (e.state === "pursue" && d < def.attackRange) setState(e, "attack", ctx);
      else if (e.state === "attack" && d > def.attackRange * 1.35) setState(e, "pursue", ctx);
      break;
    case "evade":
      if (!t) setState(e, "return", ctx);
      else if (e.stateTime > 1.4) setState(e, d < def.attackRange ? "attack" : "pursue", ctx);
      break;
    case "retreat":
      if (!t) setState(e, "return", ctx);
      else if ((d > 480 && e.dur.shieldFrac > 0.6) || e.stateTime > 9) setState(e, "pursue", ctx);
      break;
  }
}

/** Attack-run steering; returns the desired speed. */
function attackSteer(e: Enemy, t: AiTarget | null, d: number, desired: Vec3, ctx: AiContext): number {
  const def = e.def;
  if (!t) {
    copy(desired, e.fwd);
    return def.cruiseSpeed;
  }
  if (e.type === "dreadnought") {
    // Broadside hold: approach to preferred range, then circle so turrets bear.
    tmpA.x = t.pos.x - e.pos.x;
    tmpA.y = 0;
    tmpA.z = t.pos.z - e.pos.z;
    normalize(tmpA);
    if (d > def.preferredRange * 1.15) copy(desired, tmpA);
    else {
      desired.x = tmpA.z;
      desired.y = 0;
      desired.z = -tmpA.x;
      if (d < def.preferredRange * 0.8) {
        desired.x -= tmpA.x * 0.6;
        desired.z -= tmpA.z * 0.6;
      }
      normalize(desired);
    }
    desired.y = clamp((t.pos.y + 40 - e.pos.y) / 200, -0.1, 0.1);
    normalize(desired);
    return e.maxSpeed * 0.6;
  }
  if (e.breakTimer > 0) {
    // Extend away after an overshoot until there is room for a new run.
    e.breakTimer -= ctx.dt;
    copy(desired, e.breakDir);
    if (d > def.preferredRange * 1.5 && e.breakTimer < 2.5) e.breakTimer = 0;
    if (e.breakTimer <= 0) {
      e.breakTimer = 0;
      if (e.squad) e.squad.reflank(e, ctx);
    }
    return e.maxSpeed;
  }
  if (e.squad && e.flankTimer > 0 && e.squad.flankSteer(e, t, desired, ctx)) return e.maxSpeed;
  const w = e.weapons[0];
  leadPoint(tmpA, e.pos, t, w ? w.def.speed : 300);
  desired.x = tmpA.x - e.pos.x;
  desired.y = tmpA.y - e.pos.y;
  desired.z = tmpA.z - e.pos.z;
  normalize(desired);
  const behind = d < def.preferredRange * 0.6 && dot(desired, e.fwd) < -0.1;
  if (d < def.breakRange + t.radius || behind) {
    // Overshoot / target on our tail: break off with a lateral + climbing swerve, then extend.
    const side = ctx.rng() < 0.5 ? -1 : 1;
    const rl = Math.hypot(e.fwd.x, e.fwd.z) || 1;
    e.breakDir.x = e.fwd.x + (e.fwd.z / rl) * side * 0.7;
    e.breakDir.y = 0.25 + e.fwd.y * 0.3;
    e.breakDir.z = e.fwd.z + (-e.fwd.x / rl) * side * 0.7;
    normalize(e.breakDir);
    e.breakTimer = 4;
    return e.maxSpeed;
  }
  if (d < def.preferredRange) return e.maxSpeed * 0.7;
  return e.maxSpeed;
}

function fireControl(e: Enemy, t: AiTarget | null, d: number, ctx: AiContext): void {
  const firing = t && (e.state === "attack" || (e.state === "pursue" && d < e.def.attackRange));
  for (const w of e.weapons) {
    const shots = w.update(ctx.dt);
    if (!t) {
      if (w.busy) w.cancel();
      continue;
    }
    if (shots > 0) {
      muzzle(e, tmpB);
      for (let i = 0; i < shots; i++) ctx.fireWeapon(e, w, tmpB, t);
    }
    if (!firing || w.busy || w.cooldown > 0 || e.breakTimer > 0) continue;
    if (d > w.def.range * 0.92) continue;
    if (t.isPlayer && !ctx.canAttack(e)) continue;
    leadPoint(tmpA, e.pos, t, w.def.speed);
    const lx = tmpA.x - e.pos.x, ly = tmpA.y - e.pos.y, lz = tmpA.z - e.pos.z;
    const ll = Math.hypot(lx, ly, lz) || 1;
    const c = (lx * e.fwd.x + ly * e.fwd.y + lz * e.fwd.z) / ll;
    if (c < Math.cos(e.def.fireCone)) continue;
    if (w.trigger()) {
      muzzle(e, tmpB);
      ctx.events.push({ type: "enemyTelegraph", id: e.id, position: { ...tmpB }, weapon: w.def.id, duration: w.def.windup });
    }
  }
}

export function muzzle(e: Enemy, out: Vec3): Vec3 {
  out.x = e.pos.x + e.fwd.x * e.def.radius * 0.95;
  out.y = e.pos.y + e.fwd.y * e.def.radius * 0.95;
  out.z = e.pos.z + e.fwd.z * e.def.radius * 0.95;
  return out;
}

/** Biases `desired` to keep clearance above terrain and inside the flight volume. */
export function avoidTerrainAndBounds(e: { pos: Vec3; fwd: Vec3; speed: number; def: EnemyTypeDef }, desired: Vec3, env: CombatEnv): void {
  const p = e.pos;
  const look = Math.max(20, e.speed * 1.6);
  const ax = p.x + e.fwd.x * look, az = p.z + e.fwd.z * look;
  const g = Math.max(env.groundAt(p.x, p.z), env.groundAt(ax, az), env.groundAt((p.x + ax) / 2, (p.z + az) / 2));
  const minY = g + e.def.terrainMargin + e.def.radius;
  const aheadY = p.y + e.fwd.y * look;
  const low = Math.max(minY + 15 - p.y, minY - aheadY);
  if (low > 0) {
    desired.y += clamp(low / 25, 0, 2.5);
    normalize(desired);
  }
  const r = Math.hypot(p.x, p.z);
  const margin = 90;
  const edge = env.flightRadius - margin - e.def.radius;
  if (r > edge && r > 1e-3) {
    const k = clamp((r - edge) / margin, 0, 1) * 2.2;
    desired.x -= (p.x / r) * k;
    desired.z -= (p.z / r) * k;
    normalize(desired);
  }
  const top = env.maxAltitude - 40 - e.def.radius;
  if (p.y > top) {
    desired.y -= clamp((p.y - top) / 30, 0, 2);
    normalize(desired);
  }
}

export function clampToVolume(e: { pos: Vec3; fwd: Vec3; def: EnemyTypeDef }, env: CombatEnv): void {
  const p = e.pos;
  const floor = env.groundAt(p.x, p.z) + Math.max(3, e.def.radius * 0.7);
  if (p.y < floor) {
    p.y = floor;
    if (e.fwd.y < 0.05) {
      e.fwd.y = 0.05;
      normalize(e.fwd);
    }
  }
  const r = Math.hypot(p.x, p.z);
  const R = env.flightRadius - e.def.radius;
  if (r > R) {
    p.x *= R / r;
    p.z *= R / r;
  }
  if (p.y > env.maxAltitude - e.def.radius) p.y = env.maxAltitude - e.def.radius;
}

/** Angle (rad) between the enemy nose and direction to a point. */
export function noseAngleTo(e: Enemy, p: Vec3): number {
  tmpA.x = p.x - e.pos.x;
  tmpA.y = p.y - e.pos.y;
  tmpA.z = p.z - e.pos.z;
  normalize(tmpA);
  return Math.acos(clamp(dot(tmpA, e.fwd), -1, 1));
}
