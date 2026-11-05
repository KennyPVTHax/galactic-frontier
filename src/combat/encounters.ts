/**
 * Encounter registry and patrol spawning.
 *
 * An encounter is a set of groups; each group spawns `count` ships of one type,
 * either loosely spread or as a squadron (hunters). Spawn positions are laid
 * out around an origin at `distance`, clamped into the flight volume and lifted
 * above terrain.
 */
import type { EnemyTypeId } from "./ids";
import type { EncounterTable } from "../universe/types";
import type { CombatEnv } from "./ai";
import { clamp, type Rng, type Vec3 } from "./vec";

export interface EncounterGroup {
  type: EnemyTypeId;
  count: number;
  /** Fly as a coordinated squadron (formation + flanking + regroup). */
  squad?: boolean;
  /** Bearing offset (rad) of this group relative to the encounter bearing. */
  bearing?: number;
  /** Fraction of this group that prefers attacking allies (0..1). */
  allyFocus?: number;
}

export interface EncounterDef {
  id: string;
  name: string;
  description: string;
  groups: EncounterGroup[];
  /** Spawn distance from the origin (m). */
  distance: number;
  /** Altitude above the origin (m). */
  altitude: number;
  /** Spawn already hunting the player (wave / ambush) instead of patrolling. */
  engaged: boolean;
  boss?: boolean;
}

const E = (d: EncounterDef) => d;

export const ENCOUNTERS: Record<string, EncounterDef> = {
  first_contact: E({
    id: "first_contact",
    name: "First Contact",
    description: "A lone Ashveil Lancet shadows the Wayfarer. Learn to lock and lead.",
    groups: [{ type: "interceptor", count: 1 }],
    distance: 420,
    altitude: 40,
    engaged: false,
  }),
  scout_pair: E({ id: "scout_pair", name: "Corsair Pickets", description: "Two Skiffs probing the survey zone.", groups: [{ type: "scout", count: 2 }], distance: 450, altitude: 50, engaged: false }),
  interceptor_pair: E({ id: "interceptor_pair", name: "Lancet Pair", description: "Two shielded interceptors on a hunting sweep.", groups: [{ type: "interceptor", count: 2 }], distance: 460, altitude: 50, engaged: false }),
  raider_escort: E({
    id: "raider_escort",
    name: "Bulwark Convoy",
    description: "An armoured Bulwark gunship screened by two Skiffs.",
    groups: [
      { type: "raider", count: 1 },
      { type: "scout", count: 2, bearing: 0.25 },
    ],
    distance: 500,
    altitude: 60,
    engaged: false,
  }),
  hunter_squadron: E({ id: "hunter_squadron", name: "Cantor Wing", description: "Four Hollow Choir hunters flying as one.", groups: [{ type: "hunter", count: 4, squad: true }], distance: 520, altitude: 70, engaged: false }),
  station_defense_wave_1: E({ id: "station_defense_wave_1", name: "Defence · Wave 1", description: "Skiffs test the platform's guns.", groups: [{ type: "scout", count: 3, allyFocus: 0.67 }], distance: 480, altitude: 40, engaged: true }),
  station_defense_wave_2: E({
    id: "station_defense_wave_2",
    name: "Defence · Wave 2",
    description: "Lancets cover a Skiff strike on the platform.",
    groups: [
      { type: "interceptor", count: 2 },
      { type: "scout", count: 2, bearing: 0.6, allyFocus: 1 },
    ],
    distance: 500,
    altitude: 50,
    engaged: true,
  }),
  station_defense_wave_3: E({
    id: "station_defense_wave_3",
    name: "Defence · Wave 3",
    description: "A Bulwark bombards the platform while a Cantor wing hunts you.",
    groups: [
      { type: "raider", count: 1, allyFocus: 1 },
      { type: "hunter", count: 3, squad: true, bearing: -0.7 },
    ],
    distance: 540,
    altitude: 60,
    engaged: true,
  }),
  escort_ambush: E({
    id: "escort_ambush",
    name: "Freighter Ambush",
    description: "Corsairs jump the survey freighter you are escorting.",
    groups: [
      { type: "interceptor", count: 2 },
      { type: "scout", count: 2, bearing: 0.5, allyFocus: 1 },
    ],
    distance: 380,
    altitude: 40,
    engaged: true,
  }),
  dreadnought_boss: E({
    id: "dreadnought_boss",
    name: "The Threnody",
    description: "A Hollow Choir dreadnought descends. Break its spire, silence its turrets, gut the core.",
    groups: [{ type: "dreadnought", count: 1 }],
    distance: 560,
    altitude: 160,
    engaged: true,
    boss: true,
  }),
};

export const ENCOUNTER_IDS = Object.keys(ENCOUNTERS);

/** Spawn layout: one position per ship, in group order. */
export function layoutEncounter(def: EncounterDef, around: Vec3, env: CombatEnv, rng: Rng, bearing = rng() * Math.PI * 2, distance = def.distance): { group: number; type: EnemyTypeId; pos: Vec3 }[] {
  const out: { group: number; type: EnemyTypeId; pos: Vec3 }[] = [];
  def.groups.forEach((g, gi) => {
    const b = bearing + (g.bearing ?? 0);
    const cx = around.x + Math.sin(b) * distance;
    const cz = around.z + Math.cos(b) * distance;
    for (let i = 0; i < g.count; i++) {
      let x: number, z: number, yOff = 0;
      if (g.squad) {
        // Line abreast-ish so the formation solver settles quickly.
        const side = i === 0 ? 0 : i % 2 === 1 ? -1 : 1;
        const rank = Math.ceil(i / 2);
        x = cx + Math.cos(b) * side * 26 * rank;
        z = cz - Math.sin(b) * side * 26 * rank;
        yOff = rank * 4;
      } else {
        const a = rng() * Math.PI * 2;
        const r = g.count > 1 ? 30 + rng() * 40 : 0;
        x = cx + Math.cos(a) * r;
        z = cz + Math.sin(a) * r;
      }
      const p = clampSpawn(x, around.y + def.altitude + yOff, z, env, g.type === "dreadnought" ? 90 : 40);
      out.push({ group: gi, type: g.type, pos: p });
    }
  });
  return out;
}

export function clampSpawn(x: number, y: number, z: number, env: CombatEnv, clearance: number): Vec3 {
  const R = env.flightRadius - 120;
  const r = Math.hypot(x, z);
  if (r > R) {
    x *= R / r;
    z *= R / r;
  }
  const g = env.groundAt(x, z);
  return { x, y: clamp(Math.max(y, g + clearance), g + clearance, env.maxAltitude - 60), z };
}

/**
 * Random patrols from a planet's EncounterTable. Mean spawn interval is
 * `table.patrolInterval` (exponential), capped at `table.maxActive` live
 * patrol ships; hunters spawn as a squadron of three.
 */
export class PatrolSpawner {
  timer: number;
  arrivalDone = false;

  constructor(
    public table: EncounterTable,
    public difficulty: number,
    private readonly rng: Rng,
  ) {
    this.timer = this.nextInterval() * 0.6;
  }

  nextInterval(): number {
    const m = this.table.patrolInterval;
    if (m <= 0) return Infinity;
    return m * (0.5 + -Math.log(1 - this.rng() * 0.95) * 0.5);
  }

  /** Returns the patrol type to spawn now (or null). `active` = live patrol ships. */
  update(dt: number, active: number, playerProtected: boolean): { type: EnemyTypeId; count: number } | null {
    const t = this.table;
    if (t.patrolInterval <= 0 || t.patrols.length === 0) return null;
    this.timer -= dt;
    if (this.timer > 0 || playerProtected) return null;
    this.timer = this.nextInterval();
    if (active >= t.maxActive) return null;
    const type = t.patrols[Math.floor(this.rng() * t.patrols.length)];
    const count = type === "hunter" ? Math.min(3, Math.max(1, t.maxActive - active)) : 1;
    if (type === "dreadnought") return null; // capital ships are mission-only
    return { type, count };
  }
}
