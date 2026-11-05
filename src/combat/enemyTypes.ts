/**
 * Original hostile ship classes and factions for Galactic Frontier.
 *
 *  - Ashveil Corsairs (`ashveil`): ash-grey pirate hulls with ember-orange drives.
 *  - Hollow Choir (`hollowChoir`): bone-white autonomous drones with violet "eyes"
 *    that sing to each other on a shared carrier wave.
 */
import type { EnemyTypeId, FactionId } from "./ids";
import type { ResourceId } from "../gameplay/resources";
import type { WeaponId } from "./weapons";

export interface FactionDef {
  id: FactionId;
  name: string;
  description: string;
  /** CSS colour for the HUD. */
  color: string;
  /** Linear RGB hull / accent / engine glow for the renderer. */
  hull: [number, number, number];
  accent: [number, number, number];
  glow: [number, number, number];
}

export const FACTIONS: Record<FactionId, FactionDef> = {
  ashveil: {
    id: "ashveil",
    name: "Ashveil Corsairs",
    description: "Scavenger crews who strip survey wrecks and ambush anything slower than them.",
    color: "#ff8a4c",
    hull: [0.34, 0.33, 0.36],
    accent: [0.75, 0.22, 0.1],
    glow: [1.0, 0.45, 0.12],
  },
  hollowChoir: {
    id: "hollowChoir",
    name: "Hollow Choir",
    description: "An ancient drone swarm. Its ships coordinate on a shared song and never retreat alone.",
    color: "#c29bff",
    hull: [0.82, 0.8, 0.74],
    accent: [0.32, 0.18, 0.55],
    glow: [0.72, 0.42, 1.0],
  },
};

/** Loot rolls: integer uniform in [min, max] of an in-game resource. */
export type LootTable = Partial<Record<ResourceId, [number, number]>>;

export interface HardpointDef {
  id: string;
  kind: "turret" | "seeker" | "generator" | "hangar";
  name: string;
  /** Local offset from the hull origin (nose along +Z). */
  offset: [number, number, number];
  radius: number;
  hull: number;
  armor: number;
  resistance: number;
  weapon?: WeaponId;
  xp: number;
}

export interface EnemyTypeDef {
  id: EnemyTypeId;
  name: string;
  /** Short class label for the HUD ("Interceptor"). */
  role: string;
  faction: FactionId;
  description: string;
  /** Hit sphere radius (m); also scales explosions. */
  radius: number;
  maxSpeed: number;
  cruiseSpeed: number;
  accel: number;
  /** rad/s */
  turnRate: number;
  hull: number;
  shield: number;
  shieldRegen: number;
  shieldDelay: number;
  armor: number;
  resistance: number;
  weapons: WeaponId[];
  /** Detection sphere range (m) and cone half-angle (rad) ahead of the nose. */
  detectRange: number;
  detectCone: number;
  /** Always-on proximity sense regardless of facing (m). */
  senseRange: number;
  /** Starts attack runs inside this range. */
  attackRange: number;
  /** Preferred engagement distance. */
  preferredRange: number;
  /** Breaks off an attack run closer than this. */
  breakRange: number;
  /** Fire only when the target is inside this cone (rad). */
  fireCone: number;
  /** Chance to start an evasive jink when hit (0..1). */
  evadeChance: number;
  /** Evade unconditionally when the shield collapses. */
  evadeOnShieldDown: boolean;
  /** Retreat when hull fraction drops below this (0 = never). */
  retreatHull: number;
  /** Seconds of DETECT reaction before pursuing. */
  reaction: number;
  /** Minimum clearance above terrain (m). */
  terrainMargin: number;
  patrolRadius: number;
  loot: LootTable;
  xp: number;
  hardpoints?: HardpointDef[];
}

export const ENEMY_TYPES: Record<EnemyTypeId, EnemyTypeDef> = {
  scout: {
    id: "scout",
    name: "Ashveil Skiff",
    role: "Scout",
    faction: "ashveil",
    description: "A stripped-down corsair picket: quick, fragile and lightly armed.",
    radius: 3.6,
    maxSpeed: 84,
    cruiseSpeed: 40,
    accel: 40,
    turnRate: 1.9,
    hull: 40,
    shield: 0,
    shieldRegen: 0,
    shieldDelay: 0,
    armor: 0,
    resistance: 0,
    weapons: ["skiffBlaster"],
    detectRange: 380,
    detectCone: 1.05,
    senseRange: 140,
    attackRange: 380,
    preferredRange: 150,
    breakRange: 55,
    fireCone: 0.22,
    evadeChance: 0.2,
    evadeOnShieldDown: false,
    retreatHull: 0,
    reaction: 0.7,
    terrainMargin: 22,
    patrolRadius: 140,
    loot: { ferrite: [4, 8], carbon: [2, 5] },
    xp: 15,
  },
  interceptor: {
    id: "interceptor",
    name: "Ashveil Lancet",
    role: "Interceptor",
    faction: "ashveil",
    description: "Forward-swept corsair fighter with an energy shield and needle lasers. Jinks hard when hit.",
    radius: 4.6,
    maxSpeed: 76,
    cruiseSpeed: 42,
    accel: 38,
    turnRate: 1.6,
    hull: 85,
    shield: 45,
    shieldRegen: 10,
    shieldDelay: 2.6,
    armor: 0,
    resistance: 0.05,
    weapons: ["lancetLaser"],
    detectRange: 450,
    detectCone: 1.2,
    senseRange: 160,
    attackRange: 430,
    preferredRange: 190,
    breakRange: 65,
    fireCone: 0.2,
    evadeChance: 0.45,
    evadeOnShieldDown: true,
    retreatHull: 0.25,
    reaction: 0.75,
    terrainMargin: 24,
    patrolRadius: 150,
    loot: { ferrite: [6, 12], lumenite: [3, 6] },
    xp: 30,
  },
  raider: {
    id: "raider",
    name: "Ashveil Bulwark",
    role: "Raider",
    faction: "ashveil",
    description: "A slab-armoured corsair gunship. Slow, heavily shielded, shrugs off light fire.",
    radius: 9.5,
    maxSpeed: 44,
    cruiseSpeed: 26,
    accel: 18,
    turnRate: 0.75,
    hull: 260,
    shield: 120,
    shieldRegen: 14,
    shieldDelay: 4,
    armor: 1,
    resistance: 0.35,
    weapons: ["bulwarkCannon", "bulwarkLaser"],
    detectRange: 460,
    detectCone: 1.0,
    senseRange: 200,
    attackRange: 520,
    preferredRange: 290,
    breakRange: 110,
    fireCone: 0.26,
    evadeChance: 0,
    evadeOnShieldDown: false,
    retreatHull: 0,
    reaction: 1.0,
    terrainMargin: 34,
    patrolRadius: 110,
    loot: { ferrite: [15, 25], carbon: [8, 14], lumenite: [6, 10], voidQuartz: [0, 1] },
    xp: 80,
  },
  hunter: {
    id: "hunter",
    name: "Choir Cantor",
    role: "Hunter",
    faction: "hollowChoir",
    description: "Hollow Choir hunting drones. They fly in squadrons, flank in concert and regroup to heal.",
    radius: 4.2,
    maxSpeed: 80,
    cruiseSpeed: 44,
    accel: 40,
    turnRate: 1.8,
    hull: 55,
    shield: 30,
    shieldRegen: 9,
    shieldDelay: 3,
    armor: 0,
    resistance: 0.1,
    weapons: ["cantorLaser"],
    detectRange: 500,
    detectCone: 1.3,
    senseRange: 180,
    attackRange: 460,
    preferredRange: 200,
    breakRange: 60,
    fireCone: 0.2,
    evadeChance: 0.35,
    evadeOnShieldDown: false,
    retreatHull: 0,
    reaction: 0.6,
    terrainMargin: 24,
    patrolRadius: 160,
    loot: { lumenite: [3, 6], carbon: [2, 4], voidQuartz: [0, 1] },
    xp: 35,
  },
  dreadnought: {
    id: "dreadnought",
    name: "Threnody",
    role: "Dreadnought",
    faction: "hollowChoir",
    description: "A Hollow Choir cathedral-ship. Its shield generator, turrets, seeker racks and drone hangar can each be destroyed.",
    radius: 30,
    maxSpeed: 16,
    cruiseSpeed: 10,
    accel: 5,
    turnRate: 0.2,
    hull: 2200,
    shield: 500,
    shieldRegen: 25,
    shieldDelay: 5,
    // M7: armor 4 / resistance 0.3 left pulse cannons (7-13 dmg) doing ~1-5 damage per hit, so the hull could not
    // realistically be depleted. With the hardpoint-reach fix, 2 / 0.2 lets a fully upgraded pilot who breaks the
    // shield spire win (median ~6 game-minutes) while body-only strafing still loses. See tests/combat.test.ts.
    armor: 2,
    resistance: 0.2,
    weapons: [],
    detectRange: 700,
    detectCone: Math.PI,
    senseRange: 700,
    attackRange: 700,
    preferredRange: 360,
    breakRange: 140,
    fireCone: Math.PI,
    evadeChance: 0,
    evadeOnShieldDown: false,
    retreatHull: 0,
    reaction: 1.5,
    terrainMargin: 70,
    patrolRadius: 120,
    loot: { ferrite: [40, 60], lumenite: [25, 40], carbon: [15, 25], voidQuartz: [4, 7] },
    xp: 600,
    hardpoints: [
      { id: "turretFL", kind: "turret", name: "Dirge Turret", offset: [-16, 7, 26], radius: 5, hull: 140, armor: 1, resistance: 0.1, weapon: "threnodyTurret", xp: 40 },
      { id: "turretFR", kind: "turret", name: "Dirge Turret", offset: [16, 7, 26], radius: 5, hull: 140, armor: 1, resistance: 0.1, weapon: "threnodyTurret", xp: 40 },
      { id: "turretAL", kind: "turret", name: "Dirge Turret", offset: [-20, 9, -14], radius: 5, hull: 140, armor: 1, resistance: 0.1, weapon: "threnodyTurret", xp: 40 },
      { id: "turretAR", kind: "turret", name: "Dirge Turret", offset: [20, 9, -14], radius: 5, hull: 140, armor: 1, resistance: 0.1, weapon: "threnodyTurret", xp: 40 },
      { id: "seekerL", kind: "seeker", name: "Lament Seeker Rack", offset: [-12, -6, 6], radius: 5.5, hull: 180, armor: 1.5, resistance: 0.15, weapon: "threnodySeeker", xp: 50 },
      { id: "seekerR", kind: "seeker", name: "Lament Seeker Rack", offset: [12, -6, 6], radius: 5.5, hull: 180, armor: 1.5, resistance: 0.15, weapon: "threnodySeeker", xp: 50 },
      { id: "generator", kind: "generator", name: "Shield Choir-Spire", offset: [0, 18, -6], radius: 7, hull: 260, armor: 2, resistance: 0.2, xp: 80 },
      { id: "hangar", kind: "hangar", name: "Drone Nave", offset: [0, -9, -30], radius: 8, hull: 220, armor: 2, resistance: 0.2, xp: 60 },
    ],
  },
};

/** Scaling applied to enemies at spawn. */
export interface DifficultyScale {
  /** Effective difficulty used (0..6). */
  level: number;
  hullMul: number;
  shieldMul: number;
  damageMul: number;
  /** Multiplier on weapon spread (lower = more accurate). */
  spreadMul: number;
  /** Multiplier on enemy fire rate. */
  fireRateMul: number;
  /** Multiplier on DETECT reaction time. */
  reactionMul: number;
  speedMul: number;
  /** Maximum enemies allowed to fire on the player at once. */
  maxAttackers: number;
  lootMul: number;
  xpMul: number;
}

/**
 * Effective difficulty from planet danger (0–5) and total player upgrade levels:
 * upgraded players face slightly tougher foes (capped at +1.5).
 */
export function effectiveDifficulty(danger: number, upgradeLevels = 0): number {
  return Math.max(0, Math.min(6, danger + Math.min(1.5, Math.max(0, upgradeLevels) * 0.1)));
}

export function difficultyScale(level: number): DifficultyScale {
  const d = Math.max(0, Math.min(6, level));
  return {
    level: d,
    hullMul: 1 + 0.18 * d,
    shieldMul: 1 + 0.2 * d,
    damageMul: 1 + 0.14 * d,
    spreadMul: Math.max(0.45, 1.25 - 0.13 * d),
    fireRateMul: 1 + 0.07 * d,
    reactionMul: Math.max(0.55, 1 - 0.08 * d),
    speedMul: 1 + 0.025 * d,
    maxAttackers: 2 + Math.floor(d / 2),
    lootMul: 1 + 0.15 * d,
    xpMul: 1 + 0.2 * d,
  };
}
