/**
 * CombatSystem — the single facade game.ts talks to. Pure simulation: no
 * Babylon, no DOM, deterministic for a given rng and input sequence.
 *
 * Per frame (after ShipPhysics.update):
 *   const events = combat.update(dt, playerFrame, combatInput, env);
 *   for (const e of events) if (e.type === "playerHullDamage") ship.hull -= e.amount; …
 */
import type { AiState, EnemyTypeId } from "./ids";
import { Ally, type AllySpec } from "./allies";
import { Enemy, onEnemyDamaged, updateEnemy, setState, type AiContext, type AiTarget, type CombatEnv, leadPoint } from "./ai";
import { BossState, placeHardpoints, updateBoss, type Hardpoint } from "./boss";
import { Durability } from "./damage";
import { ENEMY_TYPES, FACTIONS, difficultyScale, effectiveDifficulty, type DifficultyScale } from "./enemyTypes";
import { ENCOUNTERS, PatrolSpawner, clampSpawn, layoutEncounter, type EncounterDef } from "./encounters";
import type { CombatEvent, Loot } from "./events";
import type { CombatHudView, HudThreat } from "./hudView";
import { ProjectilePool, type Projectile } from "./projectiles";
import { Squadron } from "./squadron";
import { Targeting, targetPos, targetRadius, type TargetRef } from "./targeting";
import { PlayerGun, WEAPONS, type BurstWeapon } from "./weapons";
import { applySpread, interceptTime, normalize, seededRng, segmentSphere, v3, type Rng, type Vec3 } from "./vec";
import type { EncounterTable } from "../universe/types";
import type { ResourceId } from "../gameplay/resources";

export type { CombatEnv } from "./ai";

export interface PlayerCombatStats {
  maxShield: number;
  shieldRegen: number;
  shieldDelay: number;
  /** Damage per pulse bolt. */
  weaponDamage: number;
  /** Seconds between shots (guns alternate). */
  fireInterval: number;
  heatPerShot: number;
  coolRate: number;
  lockRange: number;
  boltSpeed: number;
}

/** Stock Wayfarer (no upgrades). */
export const DEFAULT_PLAYER_STATS: PlayerCombatStats = {
  maxShield: 60,
  shieldRegen: 8,
  shieldDelay: 3.5,
  weaponDamage: 7,
  fireInterval: 0.14,
  heatPerShot: 0.07,
  coolRate: 0.35,
  lockRange: 620,
  boltSpeed: 420,
};

/**
 * Convenience mapping from generic upgrade levels (0..3 each) to stats, for the
 * coordinator to wire to whichever upgrades it exposes.
 */
export function playerCombatStats(levels: { weapons?: number; shields?: number; cooling?: number } = {}): PlayerCombatStats {
  const w = Math.max(0, levels.weapons ?? 0), s = Math.max(0, levels.shields ?? 0), c = Math.max(0, levels.cooling ?? 0);
  const b = DEFAULT_PLAYER_STATS;
  return {
    ...b,
    maxShield: b.maxShield * (1 + 0.35 * s),
    shieldRegen: b.shieldRegen * (1 + 0.25 * s),
    shieldDelay: Math.max(1.6, b.shieldDelay - 0.4 * s),
    weaponDamage: b.weaponDamage * (1 + 0.25 * w),
    fireInterval: b.fireInterval * Math.max(0.7, 1 - 0.07 * w),
    heatPerShot: b.heatPerShot * Math.max(0.5, 1 - 0.15 * c),
    coolRate: b.coolRate * (1 + 0.2 * c),
    lockRange: b.lockRange + 40 * w,
  };
}

export interface PlayerFrame {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  forward: Vec3;
  alive: boolean;
  /** Docked / landed / transitioning: enemies disengage and the player can't fire. */
  protected: boolean;
}

export interface CombatInput {
  fire: boolean;
  /** Edge-triggered: true for one frame to cycle targets. */
  cycleTarget: boolean;
  /** Reticle direction (defaults to the ship's forward). */
  aimDir?: Vec3;
}

export interface SpawnOptions {
  /** Planet danger 0–5 (or any effective difficulty). */
  difficulty?: number;
  /** Total player upgrade levels (slightly raises difficulty, capped). */
  upgradeLevels?: number;
  /** Spawn bearing from `around` (rad); random when omitted. */
  bearing?: number;
  distance?: number;
  /** Override the encounter's engaged flag. */
  engaged?: boolean;
  /** Override every group's allyFocus. */
  allyFocus?: number;
}

export interface EncounterInstance {
  id: string;
  def: EncounterDef;
  enemies: Set<Enemy>;
  cleared: boolean;
  difficulty: number;
}

export interface CombatSystemOptions {
  rng?: Rng;
  seed?: number;
  maxProjectiles?: number;
}

/** Player hit sphere (Wayfarer is ~10 m long). */
export const PLAYER_RADIUS = 4.5;

export interface CombatSnapshot {
  time: number;
  playerShield: number;
  playerHeat: number;
  overheated: boolean;
  target: { id: string; hardpoint: string | null; lock: number; locked: boolean } | null;
  enemies: { id: string; type: EnemyTypeId; state: AiState; pos: [number, number, number]; hull: number; shield: number; squad: string | null; encounter: string | null; phase?: number; hardpoints?: { id: string; alive: boolean; hull: number }[] }[];
  projectiles: number;
  allies: { id: string; kind: string; hull: number; shield: number; alive: boolean }[];
  encounters: { id: string; encounter: string; alive: number; cleared: boolean }[];
  attackers: string[];
}

const round = (v: number, k = 10) => Math.round(v * k) / k;

export class CombatSystem {
  readonly rng: Rng;
  time = 0;
  stats: PlayerCombatStats = { ...DEFAULT_PLAYER_STATS };
  private readonly pool: ProjectilePool;
  private list: Enemy[] = [];
  private allyList: Ally[] = [];
  private squads: Squadron[] = [];
  private encs = new Map<string, EncounterInstance>();
  private readonly shield: Durability;
  private readonly gun: PlayerGun;
  readonly targeting = new Targeting();
  private readonly ppos = v3();
  private readonly pprev = v3();
  private readonly pvel = v3();
  private readonly pfwd = v3(0, 0, 1);
  private readonly aim = v3(0, 0, 1);
  private havePrev = false;
  private playerActive = false;
  private readonly playerTarget: AiTarget = { id: "player", pos: this.ppos, vel: this.pvel, radius: PLAYER_RADIUS, isPlayer: true };
  private readonly attackers = new Set<Enemy>();
  private patrol: PatrolSpawner | null = null;
  private patrolUpgrade = 0;
  private pending: CombatEvent[] = [];
  private seq = 0;
  private hits = 0;
  private kills = 0;
  private lastEnv: CombatEnv | null = null;
  private readonly lead = v3();
  private hasLead = false;
  private readonly view: CombatHudView;
  private readonly ctx: AiContext;
  private events: CombatEvent[] = [];
  /** Highest difficulty seen in live encounters → attacker cap. */
  maxAttackers = 2;

  constructor(opts: CombatSystemOptions = {}) {
    this.rng = opts.rng ?? seededRng(opts.seed ?? 0x5eed);
    this.pool = new ProjectilePool(opts.maxProjectiles ?? 600);
    this.shield = new Durability({ maxShield: this.stats.maxShield, shieldRegen: this.stats.shieldRegen, shieldDelay: this.stats.shieldDelay, maxHull: 1e12, armor: 0, resistance: 0 });
    this.gun = new PlayerGun({ fireInterval: this.stats.fireInterval, heatPerShot: this.stats.heatPerShot, coolRate: this.stats.coolRate });
    this.view = { active: false, shield: 0, maxShield: 0, hull: 0, maxHull: 0, heat: 0, overheated: false, hostiles: 0, target: null, lead: null, threats: [], incoming: false, boss: null, allies: [], hits: 0, kills: 0 };
    const self = this;
    this.ctx = {
      dt: 0,
      time: 0,
      rng: this.rng,
      env: { groundAt: () => 0, flightRadius: 760, maxAltitude: 720 },
      get events() {
        return self.events;
      },
      player: null,
      allies: this.allyList,
      canAttack: (e) => e.type === "dreadnought" || this.attackers.has(e),
      fireWeapon: (e, w, origin, t, hp) => this.fireEnemyWeapon(e, w, origin, t, hp),
      spawnEscorts: (e, n) => this.spawnEscorts(e, n),
    };
  }

  // ------------------------------------------------------------------ configuration

  setPlayerStats(p: Partial<PlayerCombatStats>): void {
    this.stats = { ...this.stats, ...p };
    const s = this.stats;
    this.shield.reprofile({ maxShield: s.maxShield, shieldRegen: s.shieldRegen, shieldDelay: s.shieldDelay, maxHull: 1e12, armor: 0, resistance: 0 });
    this.shield.hull = 1e12;
    this.gun.stats = { fireInterval: s.fireInterval, heatPerShot: s.heatPerShot, coolRate: s.coolRate };
  }

  /** Random patrols from a planet's encounter table (null disables). */
  setPatrols(table: EncounterTable | null, difficulty = 0, upgradeLevels = 0): void {
    this.patrol = table ? new PatrolSpawner(table, difficulty, this.rng) : null;
    this.patrolUpgrade = upgradeLevels;
  }

  /** Spawns the table's arrival group (if any) around `around`. Returns the instance id or null. */
  spawnArrival(table: EncounterTable, around: Vec3, difficulty = 0, upgradeLevels = 0): string | null {
    if (!table.arrival || table.arrival.length === 0) return null;
    return this.spawnEncounter(adhocDef("arrival", table.arrival, false), around, { difficulty, upgradeLevels });
  }

  // ------------------------------------------------------------------ accessors

  enemies(): readonly Enemy[] {
    return this.list;
  }
  enemy(id: string): Enemy | undefined {
    return this.list.find((e) => e.id === id);
  }
  projectiles(): readonly Projectile[] {
    return this.pool.live;
  }
  allies(): readonly Ally[] {
    return this.allyList;
  }
  encounters(): readonly EncounterInstance[] {
    return [...this.encs.values()];
  }
  squadrons(): readonly Squadron[] {
    return this.squads;
  }
  target(): TargetRef | null {
    return this.targeting.current;
  }
  /** Lead indicator: world point to aim at so bolts meet the current target. */
  leadPoint(): Vec3 | null {
    return this.hasLead ? this.lead : null;
  }
  /** Last player position fed to update() (read-only view for the renderer). */
  get playerPosition(): Vec3 {
    return this.ppos;
  }
  get playerShield(): number {
    return this.shield.shield;
  }
  set playerShield(v: number) {
    this.shield.shield = Math.max(0, Math.min(this.stats.maxShield, v));
  }
  get playerMaxShield(): number {
    return this.stats.maxShield;
  }
  get playerHeat(): number {
    return this.gun.heat;
  }
  get overheated(): boolean {
    return this.gun.overheated;
  }
  get hostileCount(): number {
    return this.list.length;
  }
  /** The live dreadnought, if any. */
  boss(): Enemy | null {
    return this.list.find((e) => e.boss && e.alive) ?? null;
  }
  get attackerIds(): string[] {
    return [...this.attackers].map((e) => e.id);
  }

  // ------------------------------------------------------------------ spawning

  private nextId(prefix: string): string {
    return `${prefix}-${++this.seq}`;
  }

  spawnEnemy(type: EnemyTypeId, pos: Vec3, opts: { difficulty?: number; upgradeLevels?: number; scale?: DifficultyScale; encounter?: string | null; engaged?: boolean; prefersAlly?: boolean; yaw?: number; anchor?: Vec3; id?: string } = {}): Enemy {
    const def = ENEMY_TYPES[type];
    const scale = opts.scale ?? difficultyScale(effectiveDifficulty(opts.difficulty ?? 0, opts.upgradeLevels ?? 0));
    const e = new Enemy(def, pos, this.rng, { id: opts.id ?? this.nextId(type), scale, encounter: opts.encounter ?? null, engaged: opts.engaged, prefersAlly: opts.prefersAlly, yaw: opts.yaw, anchor: opts.anchor });
    if (def.hardpoints) {
      e.boss = new BossState(def, scale, this.rng);
      placeHardpoints(e, true);
    }
    this.list.push(e);
    this.maxAttackers = Math.max(this.maxAttackers, scale.maxAttackers);
    this.pending.push({ type: "enemySpawned", id: e.id, enemyType: type });
    if (opts.encounter) this.encs.get(opts.encounter)?.enemies.add(e);
    return e;
  }

  /**
   * Spawns a registered encounter (or an ad-hoc def) around a point.
   * Returns the encounter instance id (used by encounterCleared).
   */
  spawnEncounter(idOrDef: string | EncounterDef, around: Vec3, opts: SpawnOptions = {}): string {
    const def = typeof idOrDef === "string" ? ENCOUNTERS[idOrDef] : idOrDef;
    if (!def) throw new Error(`Unknown encounter ${String(idOrDef)}`);
    const level = effectiveDifficulty(opts.difficulty ?? 0, opts.upgradeLevels ?? 0);
    const scale = difficultyScale(level);
    const inst: EncounterInstance = { id: this.nextId(def.id), def, enemies: new Set(), cleared: false, difficulty: level };
    this.encs.set(inst.id, inst);
    const env = this.lastEnv ?? { groundAt: () => 0, flightRadius: 760, maxAltitude: 720 };
    const layout = layoutEncounter(def, around, env, this.rng, opts.bearing, opts.distance);
    const squads = new Map<number, Squadron>();
    const groupIndex = new Map<number, number>();
    for (const s of layout) {
      const g = def.groups[s.group];
      const i = groupIndex.get(s.group) ?? 0;
      groupIndex.set(s.group, i + 1);
      const focus = opts.allyFocus ?? g.allyFocus ?? 0;
      const e = this.spawnEnemy(s.type, s.pos, {
        scale,
        encounter: inst.id,
        engaged: opts.engaged ?? def.engaged,
        prefersAlly: i < Math.round(g.count * focus),
        yaw: Math.atan2(around.x - s.pos.x, around.z - s.pos.z),
      });
      if (g.squad) {
        let sq = squads.get(s.group);
        if (!sq) {
          sq = new Squadron(this.nextId("squad"));
          squads.set(s.group, sq);
          this.squads.push(sq);
        }
        sq.add(e);
      }
    }
    // Squad members share the leader's heading so the formation starts tidy.
    for (const sq of squads.values()) for (const m of sq.members) {
      m.yaw = sq.leader.yaw;
      m.fwd.x = Math.sin(m.yaw);
      m.fwd.y = 0;
      m.fwd.z = Math.cos(m.yaw);
    }
    this.pending.push({ type: "encounterStarted", id: inst.id, encounter: def.id });
    return inst.id;
  }

  /** Removes an encounter's ships without loot (mission abort / planet change). */
  despawnEncounter(instanceId: string): void {
    const inst = this.encs.get(instanceId);
    if (!inst) return;
    for (const e of inst.enemies) this.removeEnemy(e);
    this.encs.delete(instanceId);
  }

  addAlly(spec: AllySpec): Ally {
    const a = new Ally(spec);
    this.allyList.push(a);
    return a;
  }
  removeAlly(id: string): void {
    const i = this.allyList.findIndex((a) => a.id === id);
    if (i >= 0) this.allyList.splice(i, 1);
  }
  ally(id: string): Ally | undefined {
    return this.allyList.find((a) => a.id === id);
  }

  private spawnEscorts(boss: Enemy, count: number): void {
    const hangar = boss.boss?.hardpoint("hangar");
    const origin = hangar ? hangar.world : boss.pos;
    const env = this.lastEnv ?? this.ctx.env;
    const sq = new Squadron(this.nextId("squad"));
    this.squads.push(sq);
    for (let i = 0; i < count; i++) {
      const p = clampSpawn(origin.x + (i - (count - 1) / 2) * 14, origin.y - 6, origin.z - 10, env, 30);
      const e = this.spawnEnemy("hunter", p, { scale: boss.scale, encounter: boss.encounter, engaged: true, yaw: boss.yaw + Math.PI });
      sq.add(e);
    }
  }

  /** Removes every enemy, projectile, ally and encounter; restores the player's shield. */
  clear(): void {
    this.list = [];
    this.allyList.length = 0;
    this.squads = [];
    this.encs.clear();
    this.pool.clear();
    this.attackers.clear();
    this.targeting.clear();
    this.pending = [];
    this.shield.shield = this.stats.maxShield;
    this.shield.sinceHit = 1e9;
    this.gun.heat = 0;
    this.gun.overheated = false;
    this.hasLead = false;
    this.havePrev = false;
    this.patrol = null;
  }

  /** Debug / tests: force an enemy into a state (pin = hold it there). */
  forceState(id: string, state: AiState, pin = false): void {
    const e = this.enemy(id);
    if (!e) return;
    e.pinnedState = null;
    setState(e, state, { events: this.pending });
    if (pin) e.pinnedState = state;
  }

  // ------------------------------------------------------------------ update

  update(dt: number, player: PlayerFrame, input: CombatInput, env: CombatEnv): CombatEvent[] {
    dt = Math.max(0, Math.min(0.1, dt));
    const events: CombatEvent[] = this.pending;
    this.pending = [];
    this.events = events;
    this.time += dt;
    this.lastEnv = env;
    const ctx = this.ctx;
    ctx.dt = dt;
    ctx.time = this.time;
    ctx.env = env;

    // ---- player
    if (this.havePrev) {
      this.pprev.x = this.ppos.x;
      this.pprev.y = this.ppos.y;
      this.pprev.z = this.ppos.z;
    } else {
      this.pprev.x = player.x;
      this.pprev.y = player.y;
      this.pprev.z = player.z;
      this.havePrev = true;
    }
    this.ppos.x = player.x;
    this.ppos.y = player.y;
    this.ppos.z = player.z;
    this.pvel.x = player.vx;
    this.pvel.y = player.vy;
    this.pvel.z = player.vz;
    this.pfwd.x = player.forward.x;
    this.pfwd.y = player.forward.y;
    this.pfwd.z = player.forward.z;
    normalize(this.pfwd);
    const a = input.aimDir ?? player.forward;
    this.aim.x = a.x;
    this.aim.y = a.y;
    this.aim.z = a.z;
    normalize(this.aim);
    this.playerActive = player.alive && !player.protected;
    ctx.player = this.playerActive ? this.playerTarget : null;
    this.shield.update(dt);

    if (this.playerActive) this.targeting.update(dt, this.ppos, this.aim, this.list, input.cycleTarget, this.stats.lockRange, events);
    else if (this.targeting.current) this.targeting.clear(events);
    this.updateLead();

    const g = this.gun.update(dt, input.fire && this.playerActive);
    if (g.justOverheated) events.push({ type: "playerOverheated" });
    if (g.justRecovered) events.push({ type: "playerCooled" });
    for (const gun of g.shots) this.firePlayer(gun, events);

    // ---- enemies
    for (const sq of this.squads) sq.update(ctx);
    this.assignAttackers();
    for (const e of this.list) {
      if (!e.alive) continue;
      updateEnemy(e, ctx);
      if (e.boss) updateBoss(e, ctx);
    }
    for (const al of this.allyList) al.update(dt);

    // ---- projectiles
    this.stepProjectiles(dt, env, events);

    // ---- cleanup
    this.reap(events);
    this.updatePatrols(dt, player);
    return events;
  }

  private updateLead(): void {
    const t = this.targeting.current;
    this.hasLead = false;
    if (!t) return;
    const p = targetPos(t);
    const ev = t.enemy.vel;
    const rx = p.x - this.ppos.x, ry = p.y - this.ppos.y, rz = p.z - this.ppos.z;
    // Bolts inherit the ship's velocity, so solve in the player's frame.
    const vx = ev.x - this.pvel.x, vy = ev.y - this.pvel.y, vz = ev.z - this.pvel.z;
    const tt = interceptTime(rx, ry, rz, vx, vy, vz, this.stats.boltSpeed);
    if (tt < 0) return;
    this.lead.x = p.x + vx * tt;
    this.lead.y = p.y + vy * tt;
    this.lead.z = p.z + vz * tt;
    this.hasLead = true;
  }

  private assignAttackers(): void {
    for (const e of this.attackers) {
      if (!e.alive || !e.target?.isPlayer || !(e.state === "attack" || e.state === "evade")) this.attackers.delete(e);
    }
    if (this.attackers.size >= this.maxAttackers) return;
    const waiting: { e: Enemy; d: number }[] = [];
    for (const e of this.list) {
      if (!e.alive || e.type === "dreadnought" || this.attackers.has(e) || e.state !== "attack" || !e.target?.isPlayer) continue;
      waiting.push({ e, d: Math.hypot(e.pos.x - this.ppos.x, e.pos.y - this.ppos.y, e.pos.z - this.ppos.z) });
    }
    waiting.sort((a, b) => a.d - b.d);
    for (const w of waiting) {
      if (this.attackers.size >= this.maxAttackers) break;
      this.attackers.add(w.e);
    }
  }

  private readonly tmpDir = v3();
  private readonly tmpPos = v3();
  private readonly tmpVel = v3();

  private firePlayer(gun: number, events: CombatEvent[]): void {
    const f = this.pfwd;
    // Right vector in the horizontal plane (x right of +z nose).
    const hl = Math.hypot(f.x, f.z) || 1;
    const rx = f.z / hl, rz = -f.x / hl;
    const side = gun === 0 ? -1 : 1;
    const o = this.tmpPos;
    o.x = this.ppos.x + rx * side * 1.9 + f.x * 4.5;
    o.y = this.ppos.y - 0.15 + f.y * 4.5;
    o.z = this.ppos.z + rz * side * 1.9 + f.z * 4.5;
    const d = this.tmpDir;
    d.x = this.aim.x;
    d.y = this.aim.y;
    d.z = this.aim.z;
    // Mild aim assist: a locked target pulls shots onto the lead point within ~5°.
    if (this.targeting.locked && this.hasLead) {
      const lx = this.lead.x - o.x, ly = this.lead.y - o.y, lz = this.lead.z - o.z;
      const ll = Math.hypot(lx, ly, lz) || 1;
      const c = (lx * d.x + ly * d.y + lz * d.z) / ll;
      if (c > Math.cos((5 * Math.PI) / 180)) {
        d.x = lx / ll;
        d.y = ly / ll;
        d.z = lz / ll;
      }
    }
    const W = WEAPONS.pulseCannon;
    applySpread(d, W.spread, this.rng);
    const s = this.stats.boltSpeed;
    const v = this.tmpVel;
    v.x = d.x * s + this.pvel.x;
    v.y = d.y * s + this.pvel.y;
    v.z = d.z * s + this.pvel.z;
    const range = Math.max(W.range, this.stats.lockRange + 40);
    if (this.pool.spawn("player", "player", W.id, W.kind, o, v, this.stats.weaponDamage, W.radius, range / s, 0, null, W.length)) {
      events.push({ type: "playerFired", gun, position: { ...o }, dir: { ...d } });
    }
  }

  private fireEnemyWeapon(e: Enemy, w: BurstWeapon, origin: Vec3, t: AiTarget, hardpoint?: string): void {
    const W = w.def;
    leadPoint(this.tmpPos, origin, t, W.speed);
    const d = this.tmpDir;
    d.x = this.tmpPos.x - origin.x;
    d.y = this.tmpPos.y - origin.y;
    d.z = this.tmpPos.z - origin.z;
    normalize(d);
    // Fixed guns can only fire near the nose; outside that the shot goes wide.
    if (!hardpoint) {
      const c = d.x * e.fwd.x + d.y * e.fwd.y + d.z * e.fwd.z;
      if (c < Math.cos(e.def.fireCone * 2.5)) {
        d.x = e.fwd.x;
        d.y = e.fwd.y;
        d.z = e.fwd.z;
      }
    }
    applySpread(d, W.spread * e.scale.spreadMul, this.rng);
    const v = this.tmpVel;
    v.x = d.x * W.speed;
    v.y = d.y * W.speed;
    v.z = d.z * W.speed;
    const p = this.pool.spawn("enemy", e.id, W.id, W.kind, origin, v, W.damage * e.scale.damageMul, W.radius, W.range / W.speed, W.homing, W.homing > 0 ? t.id : null, W.length);
    if (p) this.events.push({ type: "enemyFired", id: e.id, position: { ...origin }, dir: { ...d }, weapon: W.id, kind: W.kind, hardpoint });
  }

  // ------------------------------------------------------------------ projectiles & damage

  private stepProjectiles(dt: number, env: CombatEnv, events: CombatEvent[]): void {
    const live = this.pool.live;
    const list = this.list;
    const P = this.ppos, PP = this.pprev;
    for (let i = live.length - 1; i >= 0; i--) {
      const p = live[i];
      p.px = p.x;
      p.py = p.y;
      p.pz = p.z;
      if (p.homing > 0 && p.targetId) this.steerHoming(p, dt);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.life -= dt;
      let hit = false;
      const segLen = p.speed * dt;
      if (p.owner === "player") {
        for (let k = 0; k < list.length && !hit; k++) {
          const e = list[k];
          if (!e.alive) continue;
          const reach = e.def.radius + p.radius + segLen + e.speed * dt + (e.boss ? 45 : 0);
          const dx = e.pos.x - p.x, dy = e.pos.y - p.y, dz = e.pos.z - p.z;
          if (dx * dx + dy * dy + dz * dz > reach * reach) continue;
          if (e.boss) {
            for (const h of e.boss.hardpoints) {
              if (!h.alive) continue;
              const t = segmentSphere(p.px - h.prev.x, p.py - h.prev.y, p.pz - h.prev.z, p.x - h.world.x, p.y - h.world.y, p.z - h.world.z, h.def.radius + p.radius);
              if (t >= 0) {
                this.damageHardpoint(e, h, p.damage, lerpPoint(p, t), events);
                hit = true;
                break;
              }
            }
            if (hit) break;
          }
          const t = segmentSphere(p.px - e.prev.x, p.py - e.prev.y, p.pz - e.prev.z, p.x - e.pos.x, p.y - e.pos.y, p.z - e.pos.z, e.def.radius + p.radius);
          if (t >= 0) {
            this.damageEnemy(e, p.damage, lerpPoint(p, t), true, events);
            hit = true;
          }
        }
      } else {
        if (this.playerActive) {
          const t = segmentSphere(p.px - PP.x, p.py - PP.y, p.pz - PP.z, p.x - P.x, p.y - P.y, p.z - P.z, PLAYER_RADIUS + p.radius);
          if (t >= 0) {
            this.damagePlayer(p.damage, lerpPoint(p, t), p.sourceId, events);
            hit = true;
          }
        }
        if (!hit) {
          for (const al of this.allyList) {
            if (!al.alive) continue;
            const t = segmentSphere(p.px - al.prev.x, p.py - al.prev.y, p.pz - al.prev.z, p.x - al.pos.x, p.y - al.pos.y, p.z - al.pos.z, al.radius + p.radius);
            if (t >= 0) {
              this.damageAlly(al, p.damage, lerpPoint(p, t), events);
              hit = true;
              break;
            }
          }
        }
      }
      if (!hit && p.y < env.groundAt(p.x, p.z)) {
        events.push({ type: "groundImpact", point: { x: p.x, y: env.groundAt(p.x, p.z), z: p.z }, owner: p.owner, kind: p.kind });
        hit = true;
      }
      if (hit || p.life <= 0) this.pool.removeAt(i);
    }
  }

  private steerHoming(p: Projectile, dt: number): void {
    let tx: number, ty: number, tz: number;
    if (p.targetId === "player") {
      if (!this.playerActive) return;
      tx = this.ppos.x;
      ty = this.ppos.y;
      tz = this.ppos.z;
    } else {
      const al = this.allyList.find((a) => a.id === p.targetId);
      if (!al || !al.alive) return;
      tx = al.pos.x;
      ty = al.pos.y;
      tz = al.pos.z;
    }
    const d = this.tmpDir;
    d.x = tx - p.x;
    d.y = ty - p.y;
    d.z = tz - p.z;
    normalize(d);
    const f = this.tmpVel;
    f.x = p.vx / p.speed;
    f.y = p.vy / p.speed;
    f.z = p.vz / p.speed;
    // Seekers only correct inside a forward cone; dodge hard and they overshoot.
    if (d.x * f.x + d.y * f.y + d.z * f.z < 0.2) return;
    const maxA = p.homing * dt;
    const c = Math.max(-1, Math.min(1, d.x * f.x + d.y * f.y + d.z * f.z));
    const ang = Math.acos(c);
    const k = ang <= maxA ? 1 : maxA / ang;
    f.x += (d.x - f.x) * k;
    f.y += (d.y - f.y) * k;
    f.z += (d.z - f.z) * k;
    normalize(f);
    p.vx = f.x * p.speed;
    p.vy = f.y * p.speed;
    p.vz = f.z * p.speed;
  }

  /** Applies damage to the player's shield; overflow becomes a playerHullDamage event. */
  damagePlayer(amount: number, point: Vec3, sourceId: string, events: CombatEvent[] = this.events): void {
    const had = this.shield.shield;
    const r = this.shield.applyDamage(amount);
    if (r.absorbed > 0) events.push({ type: "playerShieldHit", point: { ...point }, absorbed: r.absorbed });
    if (r.shieldDown && had > 0) events.push({ type: "playerShieldDown" });
    if (r.hullDamage > 0) events.push({ type: "playerHullDamage", amount: r.hullDamage, point: { ...point }, sourceId });
    this.shield.hull = 1e12;
  }

  /** Applies damage to an enemy hull/shield (exposed for tests and scripted events). */
  damageEnemy(e: Enemy, amount: number, point: Vec3, byPlayer: boolean, events: CombatEvent[] = this.events): void {
    if (!e.alive) return;
    const r = e.dur.applyDamage(amount);
    if (byPlayer) this.hits++;
    if (r.absorbed > 0) events.push({ type: "enemyShieldHit", id: e.id, point: { ...point }, absorbed: r.absorbed });
    if (r.shieldDown) events.push({ type: "enemyShieldDown", id: e.id });
    if (r.hullDamage > 0) events.push({ type: "enemyHit", id: e.id, point: { ...point }, damage: r.hullDamage });
    onEnemyDamaged(e, byPlayer, r.shieldDown, this.ctx);
    if (r.destroyed) this.destroyEnemy(e, events);
  }

  damageHardpoint(e: Enemy, h: Hardpoint, amount: number, point: Vec3, events: CombatEvent[] = this.events): void {
    if (!h.alive || !e.alive) return;
    const r = h.dur.applyDamage(amount, true);
    this.hits++;
    events.push({ type: "enemyHit", id: e.id, point: { ...point }, damage: r.hullDamage, hardpoint: h.id });
    onEnemyDamaged(e, true, false, this.ctx);
    if (r.destroyed) {
      h.weapon?.cancel();
      events.push({ type: "hardpointDestroyed", id: e.id, hardpoint: h.id, kind: h.def.kind, position: { ...h.world }, xp: Math.round(h.def.xp * e.scale.xpMul) });
      // Structural damage to the core.
      const core = e.dur.applyDamage(h.dur.profile.maxHull * 0.35, true);
      if (h.def.kind === "generator" && e.boss) {
        e.boss.generatorDown = true;
        e.dur.regenEnabled = false;
        if (e.dur.shield > 0) events.push({ type: "enemyShieldDown", id: e.id });
        e.dur.shield = 0;
      }
      if (core.destroyed) this.destroyEnemy(e, events);
    }
  }

  private damageAlly(a: Ally, amount: number, point: Vec3, events: CombatEvent[]): void {
    const r = a.dur.applyDamage(amount);
    events.push({ type: "allyHit", id: a.id, point: { ...point }, damage: amount });
    if (r.destroyed) events.push({ type: "allyDestroyed", id: a.id, position: { ...a.pos } });
  }

  private destroyEnemy(e: Enemy, events: CombatEvent[]): void {
    e.dur.hull = 0;
    this.kills++;
    for (const w of e.weapons) w.cancel();
    const loot = this.rollLoot(e);
    events.push({ type: "enemyDestroyed", id: e.id, enemyType: e.type, position: { ...e.pos }, radius: e.def.radius, loot, xp: Math.round(e.def.xp * e.scale.xpMul), encounter: e.encounter });
    this.attackers.delete(e);
  }

  private rollLoot(e: Enemy): Loot {
    const out: Loot = {};
    for (const [id, range] of Object.entries(e.def.loot) as [ResourceId, [number, number]][]) {
      const n = Math.round((range[0] + Math.floor(this.rng() * (range[1] - range[0] + 1))) * e.scale.lootMul);
      if (n > 0) out[id] = n;
    }
    return out;
  }

  private removeEnemy(e: Enemy): void {
    e.dur.hull = 0;
    const i = this.list.indexOf(e);
    if (i >= 0) this.list.splice(i, 1);
    this.attackers.delete(e);
    if (this.targeting.current?.enemy === e) this.targeting.clear();
  }

  private reap(events: CombatEvent[]): void {
    if (this.list.some((e) => !e.alive)) this.list = this.list.filter((e) => e.alive);
    if (this.squads.length) this.squads = this.squads.filter((s) => s.members.some((m) => m.alive));
    for (const inst of this.encs.values()) {
      if (inst.cleared) continue;
      let alive = false;
      for (const e of inst.enemies) if (e.alive) alive = true;
      if (!alive && inst.enemies.size > 0) {
        inst.cleared = true;
        events.push({ type: "encounterCleared", id: inst.id, encounter: inst.def.id });
      }
    }
    for (const [id, inst] of this.encs) if (inst.cleared) this.encs.delete(id);
  }

  private updatePatrols(dt: number, player: PlayerFrame): void {
    if (!this.patrol) return;
    let active = 0;
    for (const e of this.list) if (e.encounter?.startsWith("patrol")) active++;
    const r = this.patrol.update(dt, active, player.protected || !player.alive);
    if (!r) return;
    const def = adhocDef("patrol", Array(r.count).fill(r.type), false);
    if (r.type === "hunter" && r.count > 1) def.groups = [{ type: "hunter", count: r.count, squad: true }];
    this.spawnEncounter(def, { x: player.x, y: player.y, z: player.z }, { difficulty: this.patrol.difficulty, upgradeLevels: this.patrolUpgrade });
  }

  // ------------------------------------------------------------------ views

  /** Builds the combat HUD view (object reused between calls). */
  hudView(hull: number, maxHull: number): CombatHudView {
    const v = this.view;
    v.shield = this.shield.shield;
    v.maxShield = this.stats.maxShield;
    v.hull = hull;
    v.maxHull = maxHull;
    v.heat = this.gun.heat;
    v.overheated = this.gun.overheated;
    v.hostiles = this.list.length;
    v.active = this.list.length > 0;
    v.hits = this.hits;
    v.kills = this.kills;
    this.hits = 0;
    this.kills = 0;
    const t = this.targeting.current;
    if (t && t.enemy.alive) {
      const e = t.enemy;
      const p = targetPos(t);
      const hp = t.hardpoint;
      v.target = {
        id: e.id,
        name: hp ? hp.def.name : e.def.name,
        role: hp ? `${e.def.name} · subsystem` : `${FACTIONS[e.faction].name} · ${e.def.role}`,
        color: FACTIONS[e.faction].color,
        position: p,
        radius: targetRadius(t),
        hull: hp ? hp.dur.hullFrac : e.dur.hullFrac,
        shield: hp ? 0 : e.dur.shieldFrac,
        hasShield: !hp && e.dur.profile.maxShield > 0,
        lock: this.targeting.lockProgress,
        locked: this.targeting.locked,
        distance: Math.hypot(p.x - this.ppos.x, p.y - this.ppos.y, p.z - this.ppos.z),
        hardpoint: hp ? hp.id : null,
      };
    } else v.target = null;
    v.lead = this.hasLead ? this.lead : null;

    const threats: HudThreat[] = v.threats;
    threats.length = 0;
    let incoming = false;
    for (const e of this.list) {
      if (!e.target?.isPlayer || !(e.state === "detect" || e.state === "pursue" || e.state === "attack" || e.state === "evade")) continue;
      const charging = e.charging;
      if (charging) incoming = true;
      threats.push({ id: e.id, position: e.pos, attacking: e.state === "attack" || charging, color: FACTIONS[e.faction].color });
    }
    if (!incoming && this.playerActive) {
      // In-flight bolts whose closest approach in the next 1.2 s passes within 25 m.
      for (const p of this.pool.live) {
        if (p.owner !== "enemy") continue;
        const rx = p.x - this.ppos.x, ry = p.y - this.ppos.y, rz = p.z - this.ppos.z;
        const vx = p.vx - this.pvel.x, vy = p.vy - this.pvel.y, vz = p.vz - this.pvel.z;
        const vv = vx * vx + vy * vy + vz * vz;
        if (vv < 1e-6) continue;
        const tc = Math.max(0, Math.min(1.2, -(rx * vx + ry * vy + rz * vz) / vv));
        const cx = rx + vx * tc, cy = ry + vy * tc, cz = rz + vz * tc;
        if (cx * cx + cy * cy + cz * cz < 625) {
          incoming = true;
          break;
        }
      }
    }
    v.incoming = incoming;
    const b = this.boss();
    if (b && b.boss) {
      v.boss = {
        name: b.def.name,
        hull: b.dur.hullFrac,
        shield: b.dur.shieldFrac,
        phase: b.boss.phase,
        phases: 3,
        enraged: b.boss.enraged,
        hardpointsAlive: b.boss.hardpoints.filter((h) => h.alive).length,
        hardpointsTotal: b.boss.hardpoints.length,
      };
    } else v.boss = null;
    v.allies.length = 0;
    for (const a of this.allyList) v.allies.push({ id: a.id, name: a.name, hull: a.dur.hullFrac, shield: a.dur.shieldFrac, alive: a.alive });
    return v;
  }

  snapshot(): CombatSnapshot {
    const t = this.targeting.current;
    return {
      time: round(this.time, 100),
      playerShield: round(this.shield.shield),
      playerHeat: round(this.gun.heat, 100),
      overheated: this.gun.overheated,
      target: t ? { id: t.enemy.id, hardpoint: t.hardpoint?.id ?? null, lock: round(this.targeting.lockProgress, 100), locked: this.targeting.locked } : null,
      enemies: this.list.map((e) => ({
        id: e.id,
        type: e.type,
        state: e.state,
        pos: [round(e.pos.x), round(e.pos.y), round(e.pos.z)] as [number, number, number],
        hull: round(e.dur.hull),
        shield: round(e.dur.shield),
        squad: e.squad?.id ?? null,
        encounter: e.encounter,
        ...(e.boss ? { phase: e.boss.phase, hardpoints: e.boss.hardpoints.map((h) => ({ id: h.id, alive: h.alive, hull: round(h.dur.hull) })) } : {}),
      })),
      projectiles: this.pool.count,
      allies: this.allyList.map((a) => ({ id: a.id, kind: a.kind, hull: round(a.dur.hull), shield: round(a.dur.shield), alive: a.alive })),
      encounters: [...this.encs.values()].map((i) => ({ id: i.id, encounter: i.def.id, alive: [...i.enemies].filter((e) => e.alive).length, cleared: i.cleared })),
      attackers: this.attackerIds,
    };
  }
}

function lerpPoint(p: Projectile, t: number): Vec3 {
  return { x: p.px + (p.x - p.px) * t, y: p.py + (p.y - p.py) * t, z: p.pz + (p.z - p.pz) * t };
}

function adhocDef(id: string, types: EnemyTypeId[], engaged: boolean): EncounterDef {
  const counts = new Map<EnemyTypeId, number>();
  for (const t of types) counts.set(t, (counts.get(t) ?? 0) + 1);
  return {
    id,
    name: id,
    description: "",
    groups: [...counts].map(([type, count]) => ({ type, count, squad: type === "hunter" && count > 1 })),
    distance: 480,
    altitude: 60,
    engaged,
  };
}
