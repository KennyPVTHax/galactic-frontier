/**
 * Cross-platform progression protocol (M8): the authoritative reducer.
 *
 * A player may use Galactic Frontier Lite (Telegram) and the full Android game with one account. When sync is
 * enabled a trusted backend holds the authoritative progression; clients send EVENTS ("I completed contract X",
 * "I claimed my harvesters", "I bought upgrade Y") and the server answers with a verdict and a snapshot.
 *
 * This file is the single, pure implementation of what an event MEANS. It is shared code:
 *   - the server (any language port must pass tests/sync.test.ts) applies events with it,
 *   - clients apply the same reducer optimistically while offline, then rebase on the server snapshot.
 * Because rewards, costs and prerequisites come from the shared rules, a client can never choose its own reward.
 *
 * Design rules:
 *  1. Clients report ACTIONS, never outcomes. A reward amount in an event is ignored — it does not exist in the schema.
 *  2. Idempotency: every event has a unique id; applying it twice is a no-op that returns the original verdict.
 *  3. Order: events carry a per-device sequence number and a hash chain; gaps, reorders and tampering are rejected.
 *  4. Rules version: events carry the client's rules fingerprint; a mismatch is rejected (never silently re-priced).
 *  5. Time: farming uses the SERVER clock (`ctx.now`); the client's clock is only a hint and is ignored.
 *  6. Scope: virtual gameplay resources and XP only. Nothing here touches Orbit Coins, balances, wallets or payments.
 *     (A separately approved backend integration would be required for any such link; see docs.)
 */
import { Inventory, type InventoryCounts } from "../gameplay/inventory";
import { purchaseUpgrade, deriveStats, type UpgradeId, type UpgradeLevels, UPGRADES } from "../gameplay/upgrades";
import { ContractBoard, getContract, type ContractState } from "../gameplay/contracts";
import { Progression, type ProgressionState } from "../gameplay/progression";
import { buildOrUpgrade, claim, RIG_IDS, settle, type FarmState, type RigId } from "../gameplay/farming";
import { RESOURCE_IDS, type ResourceId } from "../gameplay/resources";
import { rulesFingerprint, canonicalJson, hash53 } from "../shared/rules";

export const SYNC_PROTOCOL_VERSION = 1;

/** The slice of a save that is authoritative once sync is on. */
export interface AuthoritativeState {
  /** Increments with every accepted event; clients use it to detect that they are behind. */
  revision: number;
  inventory: InventoryCounts;
  upgrades: UpgradeLevels;
  progression: ProgressionState;
  contracts: ContractState;
  farm: FarmState;
  /** Ids of applied events (bounded). The idempotency table. */
  applied: string[];
  /** Per-device last accepted sequence number and chain hash. */
  devices: Record<string, { seq: number; hash: string }>;
}

export type SyncPayload =
  | { type: "contractAccept"; contractId: string }
  | { type: "contractComplete"; contractId: string; startedAt: number; completedAt: number }
  | { type: "upgradePurchase"; upgrade: UpgradeId }
  | { type: "farmBuild"; rig: RigId }
  | { type: "farmClaim" }
  /** Mining is physical play the server cannot observe; it is capped by plausibility (see MINING_LIMITS). */
  | { type: "minedReport"; resource: ResourceId; amount: number; seconds: number };

export interface SyncEvent {
  /** Globally unique idempotency key, e.g. `${deviceId}:${seq}`. */
  id: string;
  deviceId: string;
  /** 1, 2, 3 … per device with no gaps. */
  seq: number;
  /** Client clock (ms) — informational only. */
  at: number;
  rules: string;
  /** Hash of the previous event from this device ("" for the first). */
  prev: string;
  /** hash(prev + canonical(payload) + id + rules). Detects corruption/reordering; authenticity comes from the authenticated channel. */
  hash: string;
  payload: SyncPayload;
}

export type RejectReason =
  | "rules-mismatch"
  | "bad-sequence"
  | "bad-chain"
  | "bad-hash"
  | "unknown-contract"
  | "not-available"
  | "not-active"
  | "too-fast"
  | "cannot-afford"
  | "at-maximum"
  | "implausible"
  | "bad-payload";

export type Verdict =
  | { id: string; status: "accepted"; revision: number; granted?: Partial<Record<ResourceId, number>>; xp?: number }
  | { id: string; status: "duplicate"; revision: number }
  | { id: string; status: "rejected"; reason: RejectReason };

export interface ReduceContext {
  /** Authoritative time (server clock). */
  now: number;
}

/** Mining plausibility: units per second the best-upgraded laser could possibly extract, with slack, and an hourly ceiling. */
export const MINING_LIMITS = { maxPerSecond: 14, slack: 1.25, maxPerHour: 6000 };
/** A contract needs at least this long per objective before it can complete (anti instant-completion). */
export const MIN_SECONDS_PER_OBJECTIVE = 8;
const APPLIED_CAP = 5000;

export function freshAuthoritative(): AuthoritativeState {
  return {
    revision: 0,
    inventory: { ferrite: 0, carbon: 0, lumenite: 0, voidQuartz: 0 },
    upgrades: Object.fromEntries(UPGRADES.map((u) => [u.id, 0])) as unknown as UpgradeLevels,
    progression: new Progression().state,
    contracts: ContractBoard.fresh(0),
    farm: Object.fromEntries(RIG_IDS.map((id) => [id, { level: 0, stock: 0, updatedAt: 0 }])) as unknown as FarmState,
    applied: [],
    devices: {},
  };
}

export const eventHash = (prev: string, payload: SyncPayload, id: string, rules: string): string => hash53(`${prev}|${canonicalJson(payload)}|${id}|${rules}`).toString(16).padStart(14, "0");

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const reject = (id: string, reason: RejectReason): { state: null; verdict: Verdict } => ({ state: null, verdict: { id, status: "rejected", reason } });

/**
 * Applies one event. Returns the NEW state (never mutates) and the verdict; on rejection `state` is null and the input
 * state is unchanged. This function is deterministic given (state, event, ctx).
 */
export function applyEvent(state: AuthoritativeState, ev: SyncEvent, ctx: ReduceContext): { state: AuthoritativeState | null; verdict: Verdict } {
  if (state.applied.includes(ev.id)) return { state: null, verdict: { id: ev.id, status: "duplicate", revision: state.revision } };
  if (ev.rules !== rulesFingerprint()) return reject(ev.id, "rules-mismatch");
  if (!ev.payload || typeof ev.payload !== "object") return reject(ev.id, "bad-payload");
  const dev = state.devices[ev.deviceId] ?? { seq: 0, hash: "" };
  if (ev.seq !== dev.seq + 1) return reject(ev.id, "bad-sequence");
  if (ev.prev !== dev.hash) return reject(ev.id, "bad-chain");
  if (ev.hash !== eventHash(ev.prev, ev.payload, ev.id, ev.rules)) return reject(ev.id, "bad-hash");

  const s = clone(state);
  const stats = deriveStats(s.upgrades);
  const inv = new Inventory(stats.cargoCapacity, s.inventory);
  const board = new ContractBoard(s.contracts, () => ctx.now);
  const prog = new Progression(s.progression);
  let granted: Partial<Record<ResourceId, number>> | undefined;
  let xp: number | undefined;
  const p = ev.payload;

  switch (p.type) {
    case "contractAccept": {
      if (!getContract(p.contractId)) return reject(ev.id, "unknown-contract");
      if (!board.accept(p.contractId)) return reject(ev.id, "not-available");
      break;
    }
    case "contractComplete": {
      const def = getContract(p.contractId);
      if (!def) return reject(ev.id, "unknown-contract");
      if (board.state.active?.id !== p.contractId) return reject(ev.id, "not-active");
      const startedAt = board.state.active.startedAt;
      // The server's own record of when the contract was accepted decides the minimum duration.
      if (ctx.now - startedAt < def.objectives.length * MIN_SECONDS_PER_OBJECTIVE * 1000) return reject(ev.id, "too-fast");
      // Rewards come from the shared rule definition only.
      granted = {};
      for (const r of RESOURCE_IDS) {
        const n = def.reward.resources[r] ?? 0;
        if (n > 0) granted[r] = inv.add(r, n);
      }
      xp = def.reward.xp;
      s.contracts = { ...board.state, active: null, completed: board.state.completed.includes(def.id) ? board.state.completed : [...board.state.completed, def.id], repeats: def.repeatable ? { ...board.state.repeats, [def.id]: (board.state.repeats[def.id] ?? 0) + 1 } : board.state.repeats };
      prog.handle({ type: "xp", amount: def.reward.xp });
      prog.handle({ type: "contract" });
      break;
    }
    case "upgradePurchase": {
      if (!UPGRADES.some((u) => u.id === p.upgrade)) return reject(ev.id, "bad-payload");
      const r = purchaseUpgrade(s.upgrades, p.upgrade, inv);
      if (!r.ok) return reject(ev.id, r.reason === "max" ? "at-maximum" : "cannot-afford");
      break;
    }
    case "farmBuild": {
      if (!RIG_IDS.includes(p.rig)) return reject(ev.id, "bad-payload");
      const r = buildOrUpgrade(s.farm, p.rig, inv, ctx.now);
      if (!r.ok) return reject(ev.id, r.reason === "max" ? "at-maximum" : "cannot-afford");
      s.farm = r.farm;
      break;
    }
    case "farmClaim": {
      // Amount is computed here from SERVER time; a client-supplied amount does not exist in the schema.
      const r = claim(s.farm, inv, ctx.now);
      s.farm = r.farm;
      granted = r.gained;
      break;
    }
    case "minedReport": {
      if (!RESOURCE_IDS.includes(p.resource) || !(p.amount > 0) || !(p.seconds > 0) || !Number.isFinite(p.amount) || !Number.isFinite(p.seconds)) return reject(ev.id, "bad-payload");
      const cap = Math.min(p.seconds * MINING_LIMITS.maxPerSecond * MINING_LIMITS.slack, (p.seconds / 3600) * MINING_LIMITS.maxPerHour + 50);
      if (p.amount > cap) return reject(ev.id, "implausible");
      granted = { [p.resource]: inv.add(p.resource, Math.floor(p.amount)) };
      break;
    }
    default:
      return reject(ev.id, "bad-payload");
  }

  s.inventory = inv.snapshot();
  s.contracts = p.type === "contractComplete" ? s.contracts : board.state;
  s.progression = prog.state;
  s.farm = p.type === "farmBuild" || p.type === "farmClaim" ? s.farm : settle(s.farm, ctx.now);
  s.revision += 1;
  s.applied = [...s.applied, ev.id].slice(-APPLIED_CAP);
  s.devices = { ...s.devices, [ev.deviceId]: { seq: ev.seq, hash: ev.hash } };
  return { state: s, verdict: { id: ev.id, status: "accepted", revision: s.revision, ...(granted ? { granted } : {}), ...(xp !== undefined ? { xp } : {}) } };
}
