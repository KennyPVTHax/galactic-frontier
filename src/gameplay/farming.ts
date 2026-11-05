/**
 * Orbital Harvesters — the shared farming rules (M8).
 *
 * Harvesters are automated rigs that accrue virtual gameplay resources over time. The rules live HERE, once, and
 * are used unchanged by the Telegram and Android presentations, the save schema and the (future) sync server.
 *
 * Scope and safety:
 *  - Output is the same four in-game resources as mining (ferrite, carbon, lumenite, void quartz). It is NOT linked to
 *    Orbit Coins, any token, wallet or financial transaction; nothing here can be exchanged for them.
 *  - Pure and deterministic: every function takes `now` (epoch ms) explicitly. No clocks, no randomness, no DOM.
 *  - Time handling resists cheap exploits: backward clock moves never re-earn the same period, a single settlement
 *    can credit at most MAX_CATCHUP_HOURS, and stock is capped by storage. Locally the clock is untrusted; when sync
 *    is enabled the server settles with ITS clock (see docs/CROSS-PLATFORM-PROGRESSION.md).
 */
import { RESOURCE_IDS, type ResourceCost, type ResourceId } from "./resources";
import type { Inventory } from "./inventory";

export type RigId = "ferriteRig" | "carbonRig" | "lumenRig" | "quartzRig";
export const RIG_IDS: RigId[] = ["ferriteRig", "carbonRig", "lumenRig", "quartzRig"];

export interface RigDef {
  id: RigId;
  name: string;
  resource: ResourceId;
  /** Output per hour at level 1. */
  perHour: number;
  /** Stock the rig can hold, expressed in hours of level-1 output (scaled by level). */
  storageHours: number;
  /** Cost to build (level 1); upgrades cost `upgradeCostFactor[level]` × this. */
  buildCost: ResourceCost;
}

export const FARMING_RULES = {
  version: 1,
  /** Output multiplier by level (index = level; level 0 = not built). */
  levelMultiplier: [0, 1, 1.5, 2.2, 3.2],
  maxLevel: 4,
  /** Upgrade to level N costs buildCost × upgradeCostFactor[N]. */
  upgradeCostFactor: [0, 0, 1.6, 2.6, 4],
  /** A settlement never credits more than this many hours of production, whatever the clock says. */
  maxCatchupHours: 24,
  rigs: [
    { id: "ferriteRig", name: "Ferrite Dredger", resource: "ferrite", perHour: 30, storageHours: 6, buildCost: { ferrite: 60 } },
    { id: "carbonRig", name: "Carbon Skimmer", resource: "carbon", perHour: 24, storageHours: 6, buildCost: { ferrite: 40, carbon: 30 } },
    { id: "lumenRig", name: "Lumen Condenser", resource: "lumenite", perHour: 18, storageHours: 6, buildCost: { ferrite: 50, lumenite: 40 } },
    { id: "quartzRig", name: "Void Lattice", resource: "voidQuartz", perHour: 2, storageHours: 6, buildCost: { lumenite: 60, voidQuartz: 3 } },
  ] as RigDef[],
} as const;

export interface RigState {
  /** 0 = not built. */
  level: number;
  /** Accrued, unclaimed output (fractional). */
  stock: number;
  /** Epoch ms of the last settlement. */
  updatedAt: number;
}

export type FarmState = Record<RigId, RigState>;

export function getRig(id: RigId): RigDef {
  const r = FARMING_RULES.rigs.find((x) => x.id === id);
  if (!r) throw new Error(`Unknown rig ${id}`);
  return r;
}

export function freshFarm(now = 0): FarmState {
  const out = {} as FarmState;
  for (const id of RIG_IDS) out[id] = { level: 0, stock: 0, updatedAt: now };
  return out;
}

export const rigRatePerHour = (id: RigId, level: number): number => getRig(id).perHour * (FARMING_RULES.levelMultiplier[Math.max(0, Math.min(FARMING_RULES.maxLevel, level))] ?? 0);
export const rigCapacity = (id: RigId, level: number): number => rigRatePerHour(id, level) * getRig(id).storageHours;

const HOUR = 3_600_000;

/** Accrues output up to `now`. Returns a NEW state; never mutates. */
export function settle(farm: FarmState, now: number): FarmState {
  const out = {} as FarmState;
  for (const id of RIG_IDS) {
    const r = farm[id];
    if (r.level <= 0) {
      out[id] = { level: 0, stock: 0, updatedAt: Math.max(r.updatedAt, now) };
      continue;
    }
    // Backward clock moves never re-earn a period: time only advances `updatedAt` forwards.
    const dtMs = Math.max(0, now - r.updatedAt);
    const hours = Math.min(FARMING_RULES.maxCatchupHours, dtMs / HOUR);
    const cap = rigCapacity(id, r.level);
    out[id] = { level: r.level, stock: Math.min(cap, r.stock + rigRatePerHour(id, r.level) * hours), updatedAt: Math.max(r.updatedAt, now) };
  }
  return out;
}

/** Whole units currently claimable per rig (after settling to `now`). */
export function pending(farm: FarmState, now: number): Record<RigId, number> {
  const s = settle(farm, now);
  const out = {} as Record<RigId, number>;
  for (const id of RIG_IDS) out[id] = Math.floor(s[id].stock + 1e-9);
  return out;
}

export function nextLevelCost(farm: FarmState, id: RigId): ResourceCost | null {
  const lvl = farm[id].level;
  if (lvl >= FARMING_RULES.maxLevel) return null;
  const f = FARMING_RULES.upgradeCostFactor[lvl + 1] || 1;
  const base = getRig(id).buildCost;
  const out: ResourceCost = {};
  for (const r of RESOURCE_IDS) if (base[r]) out[r] = Math.ceil((base[r] ?? 0) * (lvl === 0 ? 1 : f));
  return out;
}

export type FarmResult = { ok: true; farm: FarmState } | { ok: false; reason: "max" | "funds" | "unbuilt" };

/** Builds (level 0→1) or upgrades a rig, spending from the inventory. Settles first so output earned so far is kept. */
export function buildOrUpgrade(farm: FarmState, id: RigId, inv: Inventory, now: number): FarmResult {
  const cost = nextLevelCost(farm, id);
  if (!cost) return { ok: false, reason: "max" };
  if (!inv.spend(cost)) return { ok: false, reason: "funds" };
  const s = settle(farm, now);
  return { ok: true, farm: { ...s, [id]: { ...s[id], level: s[id].level + 1 } } };
}

export interface ClaimResult {
  farm: FarmState;
  /** What was actually delivered to the inventory. */
  gained: Partial<Record<ResourceId, number>>;
  /** Units left in storage because the cargo hold was full. */
  blocked: number;
}

/** Moves claimable stock into the inventory (limited by free capacity). The remainder stays stored. */
export function claim(farm: FarmState, inv: Inventory, now: number, only?: RigId[]): ClaimResult {
  const s = settle(farm, now);
  const out: FarmState = { ...s };
  const gained: Partial<Record<ResourceId, number>> = {};
  let blocked = 0;
  for (const id of only ?? RIG_IDS) {
    const r = s[id];
    if (r.level <= 0) continue;
    const want = Math.floor(r.stock + 1e-9);
    if (want <= 0) continue;
    const res = getRig(id).resource;
    const stored = inv.add(res, want);
    blocked += want - stored;
    gained[res] = (gained[res] ?? 0) + stored;
    out[id] = { ...r, stock: Math.max(0, r.stock - stored) };
  }
  return { farm: out, gained, blocked };
}

const finite = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** Validates stored farm data: unknown rigs dropped, levels clamped, stock bounded by capacity. */
export function sanitizeFarm(raw: unknown, now = 0): FarmState {
  const out = freshFarm(now);
  if (!raw || typeof raw !== "object") return out;
  for (const id of RIG_IDS) {
    const r = (raw as Record<string, unknown>)[id] as Record<string, unknown> | undefined;
    if (!r || typeof r !== "object") continue;
    const level = Math.max(0, Math.min(FARMING_RULES.maxLevel, Math.floor(finite(r.level))));
    out[id] = { level, stock: level > 0 ? Math.max(0, Math.min(rigCapacity(id, level), finite(r.stock))) : 0, updatedAt: Math.max(0, finite(r.updatedAt, now)) };
  }
  return out;
}
