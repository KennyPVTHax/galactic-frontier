import { BASE_LASER, type LaserStats } from "./miningLaser";
import type { Inventory } from "./inventory";
import type { ResourceCost } from "./resources";

export type UpgradeId = "laserCooling" | "laserYield" | "battery" | "jetpack" | "cargo" | "scanner" | "hull" | "shield" | "weapons" | "engine";

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  description: string;
  /** costs[level] is the price to go from `level` to `level + 1`. */
  costs: ResourceCost[];
  /** Human-readable effect per level, index 0 = base. */
  effects: string[];
}

export const UPGRADES: UpgradeDef[] = [
  {
    id: "laserCooling",
    name: "Cryo Coil",
    description: "Mining laser builds heat more slowly.",
    costs: [{ ferrite: 30, lumenite: 10 }, { ferrite: 60, lumenite: 30 }, { ferrite: 90, voidQuartz: 4 }],
    effects: ["Heat ×1.00", "Heat ×0.80", "Heat ×0.65", "Heat ×0.50"],
  },
  {
    id: "laserYield",
    name: "Focus Lens",
    description: "Extract more material per second.",
    costs: [{ lumenite: 30, carbon: 15 }, { lumenite: 60, ferrite: 40 }, { lumenite: 80, voidQuartz: 5 }],
    effects: ["Yield ×1.00", "Yield ×1.30", "Yield ×1.60", "Yield ×2.00"],
  },
  {
    id: "battery",
    name: "Cell Bank",
    description: "Larger laser energy reserve and faster recharge.",
    costs: [{ lumenite: 25, ferrite: 20 }, { lumenite: 50, ferrite: 45 }, { lumenite: 90, voidQuartz: 3 }],
    effects: ["100 energy", "140 energy", "185 energy", "240 energy"],
  },
  {
    id: "jetpack",
    name: "Thruster Pack",
    description: "More jetpack fuel and stronger lift.",
    costs: [{ carbon: 25, ferrite: 20 }, { carbon: 50, lumenite: 25 }, { carbon: 80, voidQuartz: 3 }],
    effects: ["100 fuel", "140 fuel", "190 fuel", "250 fuel"],
  },
  {
    id: "cargo",
    name: "Cargo Lattice",
    description: "Hold more of each resource.",
    costs: [{ ferrite: 50, carbon: 30 }, { ferrite: 120, carbon: 60 }, { ferrite: 200, voidQuartz: 6 }],
    effects: ["250 per resource", "400 per resource", "600 per resource", "1000 per resource"],
  },
  {
    id: "scanner",
    name: "Deep Scanner",
    description: "Wider scan pulse radius.",
    costs: [{ lumenite: 20, carbon: 10 }, { lumenite: 45, carbon: 25 }, { lumenite: 70, voidQuartz: 2 }],
    effects: ["120 m", "165 m", "215 m", "270 m"],
  },
  {
    id: "hull",
    name: "Hull Plating",
    description: "Wayfarer survives harder impacts.",
    costs: [{ ferrite: 60 }, { ferrite: 120, carbon: 40 }],
    effects: ["100 hull", "150 hull", "200 hull"],
  },
  // M5/M6 ship systems.
  {
    id: "shield",
    name: "Aegis Emitter",
    description: "Stronger deflector shield that recovers sooner after a hit.",
    costs: [{ ferrite: 40, lumenite: 20 }, { lumenite: 50, carbon: 30 }, { lumenite: 80, voidQuartz: 4 }],
    effects: ["60 shield", "90 shield", "125 shield", "170 shield"],
  },
  {
    id: "weapons",
    name: "Pulse Capacitors",
    description: "Harder-hitting, faster-cycling pulse cannons.",
    costs: [{ ferrite: 40, carbon: 20 }, { ferrite: 70, lumenite: 30 }, { ferrite: 100, voidQuartz: 5 }],
    effects: ["Damage ×1.00", "Damage ×1.25", "Damage ×1.55", "Damage ×1.90"],
  },
  {
    id: "engine",
    name: "Drive Tuning",
    description: "Higher cruise and boost speed for the Wayfarer.",
    costs: [{ carbon: 30, ferrite: 20 }, { carbon: 60, lumenite: 30 }, { carbon: 90, voidQuartz: 4 }],
    effects: ["Speed ×1.00", "Speed ×1.10", "Speed ×1.20", "Speed ×1.32"],
  },
];

export type UpgradeLevels = Record<UpgradeId, number>;

export function emptyLevels(): UpgradeLevels {
  return { laserCooling: 0, laserYield: 0, battery: 0, jetpack: 0, cargo: 0, scanner: 0, hull: 0, shield: 0, weapons: 0, engine: 0 };
}

export function getUpgrade(id: UpgradeId): UpgradeDef {
  const u = UPGRADES.find((d) => d.id === id);
  if (!u) throw new Error(`Unknown upgrade ${id}`);
  return u;
}

export function maxLevel(id: UpgradeId): number {
  return getUpgrade(id).costs.length;
}

export function nextCost(levels: UpgradeLevels, id: UpgradeId): ResourceCost | null {
  return getUpgrade(id).costs[levels[id]] ?? null;
}

export type PurchaseResult = { ok: true; level: number } | { ok: false; reason: "max" | "funds" };

export function purchaseUpgrade(levels: UpgradeLevels, id: UpgradeId, inventory: Inventory): PurchaseResult {
  const cost = nextCost(levels, id);
  if (!cost) return { ok: false, reason: "max" };
  if (!inventory.spend(cost)) return { ok: false, reason: "funds" };
  levels[id] += 1;
  return { ok: true, level: levels[id] };
}

export interface DerivedStats {
  laser: LaserStats;
  maxJetFuel: number;
  jetThrust: number;
  cargoCapacity: number;
  scanRadius: number;
  maxHull: number;
  /** Deflector shield (M5). */
  shield: { max: number; regenPerSec: number; regenDelay: number };
  /** Pulse cannon multipliers (M5). */
  weapon: { damageScale: number; intervalScale: number };
  /** Flight speed multiplier (M6). */
  speedScale: number;
}

const pick = (arr: number[], lvl: number) => arr[Math.max(0, Math.min(arr.length - 1, lvl))];

export function deriveStats(levels: UpgradeLevels): DerivedStats {
  const energy = pick([100, 140, 185, 240], levels.battery);
  return {
    laser: {
      ...BASE_LASER,
      maxEnergy: energy,
      regenPerSec: BASE_LASER.regenPerSec * (energy / 100),
      heatPerSec: BASE_LASER.heatPerSec * pick([1, 0.8, 0.65, 0.5], levels.laserCooling),
      yieldPerSec: BASE_LASER.yieldPerSec * pick([1, 1.3, 1.6, 2], levels.laserYield),
    },
    maxJetFuel: pick([100, 140, 190, 250], levels.jetpack),
    jetThrust: pick([25, 27, 29, 32], levels.jetpack),
    cargoCapacity: pick([250, 400, 600, 1000], levels.cargo),
    scanRadius: pick([120, 165, 215, 270], levels.scanner),
    maxHull: pick([100, 150, 200], levels.hull),
    shield: {
      max: pick([60, 90, 125, 170], levels.shield),
      regenPerSec: pick([8, 11, 14, 18], levels.shield),
      regenDelay: pick([3.5, 3, 2.6, 2.2], levels.shield),
    },
    weapon: { damageScale: pick([1, 1.25, 1.55, 1.9], levels.weapons), intervalScale: pick([1, 0.9, 0.8, 0.7], levels.weapons) },
    speedScale: pick([1, 1.1, 1.2, 1.32], levels.engine),
  };
}

export function sanitizeLevels(raw: unknown): UpgradeLevels {
  const out = emptyLevels();
  if (raw && typeof raw === "object") {
    for (const def of UPGRADES) {
      const v = (raw as Record<string, unknown>)[def.id];
      if (typeof v === "number" && Number.isFinite(v)) out[def.id] = Math.max(0, Math.min(def.costs.length, Math.floor(v)));
    }
  }
  return out;
}
