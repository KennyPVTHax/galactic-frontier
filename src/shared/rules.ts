/**
 * THE SHARED GAMEPLAY CORE — one set of rules for every platform.
 *
 * Telegram (Galactic Frontier Lite) and Android (Galactic Frontier) are two *presentations* of the same universe.
 * Everything that decides what is true in the game lives in rule modules that import no rendering, DOM or platform
 * code: resources, inventory, upgrades, missions, contracts, progression, farming, combat statistics and AI,
 * universe definitions, hazards, terrain height, ship physics and the save schema.
 *
 * `rulesManifest()` flattens those rules into plain data and `rulesFingerprint()` hashes it. Both builds report the
 * same fingerprint (tests compare the two real bundles), and a golden value in tests/golden/rules-fingerprint.json
 * makes any rules change a deliberate, reviewed act instead of an accident on one platform.
 *
 * Presentation-only data (sky colours, palettes, star-map placement, flavour text, weather particles) is excluded on
 * purpose: it may legitimately differ between Lite and Full.
 */
import { RESOURCES } from "../gameplay/resources";
import { UPGRADES, deriveStats, emptyLevels, type UpgradeLevels } from "../gameplay/upgrades";
import { MISSION_REQUIREMENTS, MISSION_STEPS, INTRO_MISSION_ID } from "../gameplay/mission";
import { CONTRACTS } from "../gameplay/contracts";
import { ACHIEVEMENTS, RANKS } from "../gameplay/progression";
import { SUIT_DRAIN_PER_SEC, SUIT_RECOVER_PER_SEC } from "../gameplay/hazards";
import { BASE_LASER } from "../gameplay/miningLaser";
import { ENEMY_TYPES, FACTIONS, difficultyScale } from "../combat/enemyTypes";
import { ENCOUNTERS } from "../combat/encounters";
import { WEAPONS } from "../combat/weapons";
import { DEFAULT_PLAYER_STATS, BOSS_CORE_FRACTION } from "../combat/combatSystem";
import { PLANETS } from "../universe/planets";
import { PLANET_IDS } from "../universe/types";
import { SAVE_VERSION } from "../persistence/saveSystem";
import { WORLD } from "../core/worldConfig";
import { FARMING_RULES } from "../gameplay/farming";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** Deep-copies to plain JSON data, dropping functions and `undefined` (achievement predicates etc.). */
export function toPlain(v: unknown): Json {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" || typeof v === "boolean") return v;
  if (Array.isArray(v)) return v.map(toPlain);
  if (typeof v === "object") {
    const out: { [k: string]: Json } = {};
    for (const k of Object.keys(v as object).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (typeof x === "function" || x === undefined) continue;
      out[k] = toPlain(x);
    }
    return out;
  }
  return null;
}

/** The parts of a PlanetDef that decide gameplay. Sky, palette, look, star-map placement and prose are presentation. */
export function planetRules(id: (typeof PLANET_IDS)[number]): Json {
  const d = PLANETS[id];
  return toPlain({
    id: d.id,
    biome: d.biome,
    seed: d.seed,
    danger: d.danger,
    terrainSize: d.terrainSize,
    walkRadius: d.walkRadius,
    flightRadius: d.flightRadius,
    maxAltitude: d.maxAltitude,
    gravity: d.gravity,
    liquid: { kind: d.liquid.kind, level: d.liquid.level },
    landingSite: d.landingSite,
    arrival: d.arrival,
    hasStation: d.hasStation,
    hazard: { kind: d.hazard.kind, intensity: d.hazard.intensity },
    terrain: d.terrain,
    resources: d.resources,
    pois: d.pois.map((p) => ({ id: p.id, kind: p.kind, x: p.x, z: p.z, loot: p.loot })),
    encounters: d.encounters,
  });
}

/** Upgrade effects at every level of every line, so a tweak to any curve changes the fingerprint. */
function upgradeTable(): Json {
  const out: { [k: string]: Json } = {};
  for (const u of UPGRADES) {
    const rows: Json[] = [];
    for (let lvl = 0; lvl <= u.costs.length; lvl++) {
      const levels: UpgradeLevels = { ...emptyLevels(), [u.id]: lvl };
      rows.push(toPlain(deriveStats(levels)));
    }
    out[u.id] = rows;
  }
  return out;
}

export interface RulesManifest {
  manifestVersion: 1;
  saveVersion: number;
  data: { [k: string]: Json };
}

export function rulesManifest(): RulesManifest {
  return {
    manifestVersion: 1,
    saveVersion: SAVE_VERSION,
    data: {
      world: toPlain({ seed: WORLD.seed, gravity: WORLD.gravity, depositRegrowMs: WORLD.depositRegrowMs, station: WORLD.station, surveySite: WORLD.surveySite }),
      resources: toPlain(Object.fromEntries(Object.entries(RESOURCES).map(([k, r]) => [k, { id: r.id, name: r.name }]))),
      upgrades: toPlain(UPGRADES.map((u) => ({ id: u.id, name: u.name, costs: u.costs }))),
      upgradeEffects: upgradeTable(),
      miningLaser: toPlain(BASE_LASER),
      introMission: toPlain({ id: INTRO_MISSION_ID, steps: MISSION_STEPS, requirements: MISSION_REQUIREMENTS }),
      contracts: toPlain(CONTRACTS),
      ranks: toPlain(RANKS),
      achievements: toPlain(ACHIEVEMENTS.map((a) => ({ id: a.id, xp: a.xp, unlocksPaint: a.unlocksPaint ?? null }))),
      hazards: toPlain({ drain: SUIT_DRAIN_PER_SEC, recover: SUIT_RECOVER_PER_SEC }),
      enemies: toPlain(ENEMY_TYPES),
      factions: toPlain(Object.fromEntries(Object.entries(FACTIONS).map(([k, f]) => [k, { id: k, name: f.name }]))),
      encounters: toPlain(ENCOUNTERS),
      weapons: toPlain(WEAPONS),
      difficulty: toPlain([0, 1, 2, 3, 4, 5, 6].map(difficultyScale)),
      playerCombat: toPlain({ ...DEFAULT_PLAYER_STATS, bossCoreFraction: BOSS_CORE_FRACTION }),
      farming: toPlain(FARMING_RULES),
      planets: PLANET_IDS.map(planetRules),
    },
  };
}

/**
 * Canonical JSON: sorted keys, no whitespace, non-integers rounded to 9 decimals.
 * The rounding is load-bearing: rule data includes values derived with Math.sin/cos/atan2 (e.g. planet arrival yaw), and
 * different JS engines (V8 in Android WebView / Node, JavaScriptCore in iOS Telegram) may differ in the last bit of those.
 * Found by tests/parity: Node and Chromium disagreed by 1 ulp, which would have made every client report "rules-mismatch".
 */
export function canonicalJson(v: unknown): string {
  return JSON.stringify(toPlain(v), (_k, x) => (typeof x === "number" && Number.isFinite(x) && !Number.isInteger(x) ? Math.round(x * 1e9) / 1e9 : x));
}

/** cyrb53 — a fast, well-distributed 53-bit hash. A *fingerprint* for drift detection, not a security primitive. */
export function hash53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed,
    h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export function rulesFingerprint(): string {
  return hash53(canonicalJson(rulesManifest())).toString(16).padStart(14, "0");
}

/** Per-section fingerprints, so a drift report can say *which* rules changed. */
export function rulesSectionFingerprints(): Record<string, string> {
  const m = rulesManifest();
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(m.data)) out[k] = hash53(canonicalJson(v)).toString(16).padStart(14, "0");
  return out;
}
