/**
 * Debug + test helpers: fixed-step sim stepping, a simple scripted "stock
 * player" pilot, and a window hook for browser checks.
 */
import type { AiState } from "./ids";
import type { CombatEvent } from "./events";
import type { CombatEnv, CombatInput, CombatSystem, PlayerFrame, SpawnOptions } from "./combatSystem";
import { forwardOf, normalize, seededRng, turnTowards, v3, type Rng, type Vec3 } from "./vec";

/** Flat ground at y = 0 inside the Veyra-7 flight volume. */
export const FLAT_ENV: CombatEnv = { groundAt: () => 0, flightRadius: 760, maxAltitude: 720 };

/** A static / scripted player for tests. */
export function playerAt(x: number, y: number, z: number, over: Partial<PlayerFrame> = {}): PlayerFrame {
  return { x, y, z, vx: 0, vy: 0, vz: 0, forward: { x: 0, y: 0, z: 1 }, alive: true, protected: false, ...over };
}

export const NO_FIRE: CombatInput = { fire: false, cycleTarget: false };

/**
 * Steps the sim `seconds` at a fixed `dt`, collecting events. `player` and
 * `input` may be functions of the elapsed time for scripted scenarios.
 */
export function stepCombat(
  combat: CombatSystem,
  seconds: number,
  player: PlayerFrame | ((t: number, dt: number) => PlayerFrame),
  input: CombatInput | ((t: number) => CombatInput) = NO_FIRE,
  env: CombatEnv = FLAT_ENV,
  dt = 1 / 30,
  until?: (events: CombatEvent[], t: number) => boolean,
): CombatEvent[] {
  const all: CombatEvent[] = [];
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    const t = i * dt;
    const p = typeof player === "function" ? player(t, dt) : player;
    const inp = typeof input === "function" ? input(t) : input;
    const ev = combat.update(dt, p, inp, env);
    for (const e of ev) all.push(e);
    if (until && until(ev, t)) break;
  }
  return all;
}

/**
 * Minimal arcade pilot approximating a NEW player with mouse aim: turns toward
 * the lead indicator at a capped rate, flies at a fixed throttle, fires only when
 * the reticle is within `fireCone` of the lead point, eases off to dodge heat.
 */
export class SimPilot {
  readonly pos: Vec3;
  readonly fwd = v3(0, 0, 1);
  speed: number;
  hull: number;
  maxHull: number;
  turnRate: number;
  fireCone: number;
  readonly aim = v3(0, 0, 1);
  private readonly tmp = v3();
  /** Smoothed (laggy) aim point: a human reacts ~0.3 s late. */
  private readonly tracked = v3();
  private hasTracked = false;
  private readonly wobble = v3();
  private readonly rng: Rng;
  /** Aim wobble amplitude (m at the target) and reaction time constant (s). */
  aimNoise: number;
  reaction: number;
  shotsFired = 0;

  constructor(opts: { pos: Vec3; yaw?: number; speed?: number; hull?: number; turnRate?: number; fireCone?: number; aimNoise?: number; reaction?: number; seed?: number }) {
    this.pos = { ...opts.pos };
    forwardOf(this.fwd, opts.yaw ?? 0, 0);
    this.speed = opts.speed ?? 45;
    this.hull = this.maxHull = opts.hull ?? 100;
    this.turnRate = opts.turnRate ?? 1.2;
    this.fireCone = opts.fireCone ?? 0.035;
    this.aimNoise = opts.aimNoise ?? 10;
    this.reaction = opts.reaction ?? 0.4;
    this.rng = seededRng(opts.seed ?? 99);
  }

  get alive(): boolean {
    return this.hull > 0;
  }

  frame(): PlayerFrame {
    return {
      x: this.pos.x,
      y: this.pos.y,
      z: this.pos.z,
      vx: this.fwd.x * this.speed,
      vy: this.fwd.y * this.speed,
      vz: this.fwd.z * this.speed,
      forward: this.fwd,
      alive: this.alive,
      protected: false,
    };
  }

  /** One fixed step: steer, move, apply last frame's hull damage, decide to fire. */
  step(combat: CombatSystem, dt: number, env: CombatEnv = FLAT_ENV): CombatEvent[] {
    const lead = combat.leadPoint();
    let aimPoint: Vec3 | null = lead;
    if (!aimPoint) {
      let best = Infinity;
      for (const e of combat.enemies()) {
        const d = Math.hypot(e.pos.x - this.pos.x, e.pos.y - this.pos.y, e.pos.z - this.pos.z);
        if (d < best) {
          best = d;
          aimPoint = e.pos;
        }
      }
    }
    if (aimPoint) {
      // Human-ish tracking: lagged aim point plus a slow random wobble.
      if (!this.hasTracked) {
        this.tracked.x = aimPoint.x;
        this.tracked.y = aimPoint.y;
        this.tracked.z = aimPoint.z;
        this.hasTracked = true;
      }
      const k = Math.min(1, dt / Math.max(1e-3, this.reaction));
      this.tracked.x += (aimPoint.x - this.tracked.x) * k;
      this.tracked.y += (aimPoint.y - this.tracked.y) * k;
      this.tracked.z += (aimPoint.z - this.tracked.z) * k;
      const w = this.wobble;
      w.x += ((this.rng() - 0.5) * 2 * this.aimNoise - w.x) * Math.min(1, dt * 2);
      w.y += ((this.rng() - 0.5) * 2 * this.aimNoise - w.y) * Math.min(1, dt * 2);
      w.z += ((this.rng() - 0.5) * 2 * this.aimNoise - w.z) * Math.min(1, dt * 2);
      aimPoint = { x: this.tracked.x + w.x, y: this.tracked.y + w.y, z: this.tracked.z + w.z };
      const d = this.tmp;
      d.x = aimPoint.x - this.pos.x;
      d.y = aimPoint.y - this.pos.y;
      d.z = aimPoint.z - this.pos.z;
      normalize(d);
      turnTowards(this.fwd, d, this.turnRate * dt);
    } else this.hasTracked = false;
    // Stay off the ground like a careful pilot.
    const g = env.groundAt(this.pos.x, this.pos.z);
    if (this.pos.y < g + 40 && this.fwd.y < 0.2) {
      this.fwd.y += 0.05;
      normalize(this.fwd);
    }
    this.pos.x += this.fwd.x * this.speed * dt;
    this.pos.y += this.fwd.y * this.speed * dt;
    this.pos.z += this.fwd.z * this.speed * dt;
    const r = Math.hypot(this.pos.x, this.pos.z);
    if (r > env.flightRadius) {
      this.pos.x *= env.flightRadius / r;
      this.pos.z *= env.flightRadius / r;
    }
    this.pos.y = Math.max(g + 3, Math.min(env.maxAltitude, this.pos.y));

    let fire = false;
    if (aimPoint) {
      const d = this.tmp;
      d.x = aimPoint.x - this.pos.x;
      d.y = aimPoint.y - this.pos.y;
      d.z = aimPoint.z - this.pos.z;
      const l = normalize(d);
      const c = d.x * this.fwd.x + d.y * this.fwd.y + d.z * this.fwd.z;
      fire = l < 600 && c > Math.cos(this.fireCone) && !combat.overheated && combat.playerHeat < 0.92;
    }
    this.aim.x = this.fwd.x;
    this.aim.y = this.fwd.y;
    this.aim.z = this.fwd.z;
    const events = combat.update(dt, this.frame(), { fire, cycleTarget: false, aimDir: this.aim }, env);
    for (const e of events) {
      if (e.type === "playerHullDamage") this.hull = Math.max(0, this.hull - e.amount);
      if (e.type === "playerFired") this.shotsFired++;
    }
    return events;
  }
}

export interface CombatDebugHandle {
  combat: CombatSystem;
  snapshot(): ReturnType<CombatSystem["snapshot"]>;
  spawn(encounter: string, opts?: SpawnOptions): string;
  force(id: string, state: AiState, pin?: boolean): void;
  killAll(): void;
  states(): Record<string, AiState>;
}

/**
 * Exposes the combat system on `host.__GF_COMBAT` (e.g. `window`) for browser
 * checks. `getPlayer` supplies the spawn origin.
 */
export function attachCombatDebug(host: Record<string, unknown>, combat: CombatSystem, getPlayer: () => Vec3): CombatDebugHandle {
  const h: CombatDebugHandle = {
    combat,
    snapshot: () => combat.snapshot(),
    spawn: (encounter, opts) => combat.spawnEncounter(encounter, getPlayer(), opts),
    force: (id, state, pin) => combat.forceState(id, state, pin),
    killAll: () => {
      for (const e of [...combat.enemies()]) combat.damageEnemy(e, 1e9, e.pos, true);
    },
    states: () => Object.fromEntries(combat.enemies().map((e) => [e.id, e.state])),
  };
  host.__GF_COMBAT = h;
  return h;
}
