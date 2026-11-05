/**
 * Frontier contracts (M6): data-driven multi-step missions that run alongside
 * the M1 intro expedition ("First Light", src/gameplay/mission.ts, unchanged).
 *
 * Pure state machine. The game feeds ContractEvents; the board advances the
 * active contract's objectives and returns rewards to apply. Rewards are
 * virtual gameplay resources and XP only — never Orbit Coins or any currency.
 */
import type { EnemyTypeId } from "../combat/ids";
import type { PlanetId, PoiKind } from "../universe/types";
import { RESOURCES, type ResourceCost, type ResourceId } from "./resources";

export type ObjectiveDef =
  | { kind: "travel"; planet: PlanetId }
  | { kind: "land"; planet: PlanetId }
  | { kind: "scan"; planet: PlanetId }
  | { kind: "collect"; resource: ResourceId; amount: number; planet?: PlanetId }
  | { kind: "inspect"; planet: PlanetId; poiKind?: PoiKind; count?: number }
  /** Destroy `count` hostiles (optionally of one type / on one planet). With `encounter`, the game spawns it. */
  | { kind: "defeat"; count: number; enemy?: EnemyTypeId; planet?: PlanetId; encounter?: string }
  /** Spawn and fully clear a combat encounter (waves, bosses). */
  | { kind: "clear"; encounter: string; planet: PlanetId }
  /** Protect an allied ship through an encounter; losing it restarts the objective. */
  | { kind: "escort"; encounter: string; planet: PlanetId }
  | { kind: "dock" };

export type ContractCategory =
  | "discovery"
  | "scanning"
  | "extraction"
  | "elimination"
  | "defense"
  | "escort"
  | "distress"
  | "recovery"
  | "investigation"
  | "boss";

export interface ContractDef {
  id: string;
  title: string;
  category: ContractCategory;
  giver: string;
  brief: string;
  objectives: ObjectiveDef[];
  reward: { resources: ResourceCost; xp: number };
  /** Contracts that must be completed first. */
  requires?: string[];
  repeatable?: boolean;
  /** Offered/started automatically on a new game. */
  starter?: boolean;
}

const PN: Record<PlanetId, string> = { veyra7: "Veyra-7", aetherion: "Aetherion", kryos: "Kryos", pyron: "Pyron", zephyria: "Zephyria", noctaris: "Noctaris" };
const ENEMY_NAMES: Record<EnemyTypeId, string> = { scout: "scout drone", interceptor: "pirate interceptor", raider: "heavy raider", hunter: "hunter fighter", dreadnought: "dreadnought" };
const POI_NAMES: Partial<Record<PoiKind, string>> = {
  ruin: "ancient ruin",
  facility: "abandoned facility",
  outpost: "alien outpost",
  stronghold: "enemy stronghold",
  wreck: "derelict wreck",
  anomaly: "anomaly",
  cache: "supply cache",
  miningStation: "mining station",
  orbital: "orbital facility",
  landmark: "landmark",
  monolith: "monolith",
};

export const CONTRACTS: ContractDef[] = [
  {
    id: "aetherion_signal",
    title: "Pirate Signal over Aetherion",
    category: "elimination",
    giver: "Halcyon Dock Traffic Control",
    brief: "A corsair fighter is harassing survey drones above Aetherion. Warp out, drive it off, scan the landing basin and report back.",
    objectives: [
      { kind: "travel", planet: "aetherion" },
      { kind: "defeat", count: 1, planet: "aetherion", encounter: "first_contact" },
      { kind: "land", planet: "aetherion" },
      { kind: "scan", planet: "aetherion" },
      { kind: "dock" },
    ],
    reward: { resources: { lumenite: 40, ferrite: 40, carbon: 20 }, xp: 120 },
    starter: true,
  },
  {
    id: "kryos_survey",
    title: "Cold Signatures",
    category: "scanning",
    giver: "Survey Office",
    brief: "Deep scans hint at Void Quartz under Kryos's ice. Map the field and bring back samples.",
    objectives: [
      { kind: "travel", planet: "kryos" },
      { kind: "scan", planet: "kryos" },
      { kind: "collect", resource: "voidQuartz", amount: 10, planet: "kryos" },
      { kind: "dock" },
    ],
    reward: { resources: { lumenite: 30, carbon: 40 }, xp: 140 },
    requires: ["aetherion_signal"],
  },
  {
    id: "kryos_recovery",
    title: "Frozen Logbooks",
    category: "recovery",
    giver: "Frontier Archive",
    brief: "An exploration crew abandoned their facility on Kryos. Recover whatever their logs left behind.",
    objectives: [
      { kind: "travel", planet: "kryos" },
      { kind: "inspect", planet: "kryos", poiKind: "facility" },
      { kind: "dock" },
    ],
    reward: { resources: { ferrite: 40, voidQuartz: 3 }, xp: 110 },
    requires: ["aetherion_signal"],
  },
  {
    id: "pyron_extraction",
    title: "Hot Ore",
    category: "extraction",
    giver: "Halcyon Fabrication",
    brief: "Pyron's lava fields are rich in Ferrite — and corsair raiders know it. Break their escort and extract a load.",
    objectives: [
      { kind: "travel", planet: "pyron" },
      { kind: "clear", encounter: "raider_escort", planet: "pyron" },
      { kind: "collect", resource: "ferrite", amount: 50, planet: "pyron" },
      { kind: "dock" },
    ],
    reward: { resources: { lumenite: 50, voidQuartz: 4 }, xp: 200 },
    requires: ["aetherion_signal"],
  },
  {
    id: "zephyria_distress",
    title: "Static on the Wind",
    category: "distress",
    giver: "Unknown beacon",
    brief: "A looping distress call rides the storms of Zephyria. Find its source — and whatever silenced the crew.",
    objectives: [
      { kind: "travel", planet: "zephyria" },
      { kind: "inspect", planet: "zephyria", poiKind: "outpost" },
      { kind: "clear", encounter: "hunter_squadron", planet: "zephyria" },
      { kind: "dock" },
    ],
    reward: { resources: { carbon: 60, voidQuartz: 4 }, xp: 240 },
    requires: ["aetherion_signal"],
  },
  {
    id: "station_defense",
    title: "Hold the Dock",
    category: "defense",
    giver: "Halcyon Dock Command",
    brief: "Corsair waves are converging on Halcyon Dock. Hold them off until the station's guns come online.",
    objectives: [
      { kind: "clear", encounter: "station_defense_wave_1", planet: "veyra7" },
      { kind: "clear", encounter: "station_defense_wave_2", planet: "veyra7" },
      { kind: "clear", encounter: "station_defense_wave_3", planet: "veyra7" },
      { kind: "dock" },
    ],
    reward: { resources: { ferrite: 80, lumenite: 60, voidQuartz: 5 }, xp: 300 },
    requires: ["pyron_extraction"],
  },
  {
    id: "cargo_escort",
    title: "Lantern Run",
    category: "escort",
    giver: "Aetherion Growers' Guild",
    brief: "A seed freighter must cross Aetherion's skies. Corsairs will try to take it. Keep it flying.",
    objectives: [
      { kind: "travel", planet: "aetherion" },
      { kind: "escort", encounter: "escort_ambush", planet: "aetherion" },
      { kind: "dock" },
    ],
    reward: { resources: { carbon: 60, lumenite: 50 }, xp: 220 },
    requires: ["aetherion_signal"],
  },
  {
    id: "noctaris_recon",
    title: "Into the Dark",
    category: "investigation",
    giver: "Halcyon Dock Command",
    brief: "Every corsair trail leads to Noctaris. Land near their stronghold and find out what they are building.",
    objectives: [
      { kind: "travel", planet: "noctaris" },
      { kind: "land", planet: "noctaris" },
      { kind: "inspect", planet: "noctaris", poiKind: "stronghold" },
      { kind: "dock" },
    ],
    reward: { resources: { voidQuartz: 6, ferrite: 60 }, xp: 260 },
    requires: ["zephyria_distress", "pyron_extraction"],
  },
  {
    id: "noctaris_dreadnought",
    title: "The Iron Choir",
    category: "boss",
    giver: "Halcyon Dock Command",
    brief: "The corsair dreadnought is awake above Noctaris. Strip its hardpoints, break its shield and bring it down.",
    objectives: [
      { kind: "travel", planet: "noctaris" },
      { kind: "clear", encounter: "dreadnought_boss", planet: "noctaris" },
      { kind: "dock" },
    ],
    reward: { resources: { voidQuartz: 12, lumenite: 120, ferrite: 120 }, xp: 600 },
    requires: ["noctaris_recon"],
  },
  {
    id: "grand_survey",
    title: "Grand Survey",
    category: "discovery",
    giver: "Frontier Archive",
    brief: "Chart every world in the system: set foot in the sky of each one and come home.",
    objectives: [
      { kind: "travel", planet: "aetherion" },
      { kind: "travel", planet: "kryos" },
      { kind: "travel", planet: "pyron" },
      { kind: "travel", planet: "zephyria" },
      { kind: "travel", planet: "noctaris" },
      { kind: "dock" },
    ],
    reward: { resources: { lumenite: 80, carbon: 80, voidQuartz: 6 }, xp: 300 },
    requires: ["aetherion_signal"],
  },
  {
    id: "bounty",
    title: "Standing Bounty",
    category: "elimination",
    giver: "Halcyon Dock Security",
    brief: "Destroy five hostile spacecraft anywhere in the system. Repeatable.",
    objectives: [{ kind: "defeat", count: 5 }, { kind: "dock" }],
    reward: { resources: { ferrite: 50, lumenite: 30 }, xp: 150 },
    requires: ["aetherion_signal"],
    repeatable: true,
  },
];

export function getContract(id: string): ContractDef | undefined {
  return CONTRACTS.find((c) => c.id === id);
}

export interface ActiveContract {
  id: string;
  step: number;
  progress: number;
  /** The current objective's encounter was spawned (reset when it fails). */
  spawned: boolean;
  startedAt: number;
}

export interface ContractState {
  active: ActiveContract | null;
  completed: string[];
  /** Completion counts for repeatable contracts. */
  repeats: Record<string, number>;
}

export type ContractEvent =
  | { type: "arrived"; planet: PlanetId }
  | { type: "landed"; planet: PlanetId }
  | { type: "scanned"; planet: PlanetId; found: number }
  | { type: "collected"; planet: PlanetId; resource: ResourceId; amount: number }
  | { type: "inspected"; planet: PlanetId; poiKind: PoiKind }
  | { type: "destroyed"; planet: PlanetId; enemy: EnemyTypeId }
  | { type: "cleared"; planet: PlanetId; encounter: string }
  | { type: "allyLost"; encounter: string }
  | { type: "shipLost" }
  | { type: "docked" };

export interface ContractResult {
  advanced: boolean;
  completed: ContractDef | null;
  failed: string | null;
}

const NONE: ContractResult = { advanced: false, completed: null, failed: null };

export function objectiveText(o: ObjectiveDef): { title: string; detail: string; target: number } {
  switch (o.kind) {
    case "travel":
      return { title: `Warp to ${PN[o.planet]}`, detail: `Open the star map and jump to ${PN[o.planet]}.`, target: 1 };
    case "land":
      return { title: `Land on ${PN[o.planet]}`, detail: `Find flat, dry ground on ${PN[o.planet]} and set down.`, target: 1 };
    case "scan":
      return { title: `Scan ${PN[o.planet]}`, detail: `Step outside on ${PN[o.planet]} and run a scanner pulse that finds signatures.`, target: 1 };
    case "collect":
      return { title: `Collect ${o.amount} ${RESOURCES[o.resource].name}`, detail: o.planet ? `Mine it on ${PN[o.planet]}.` : "Mine it on any world.", target: o.amount };
    case "inspect": {
      const what = o.poiKind ? POI_NAMES[o.poiKind] ?? o.poiKind : "point of interest";
      return { title: `Investigate the ${what}`, detail: `Locate and inspect the ${what} on ${PN[o.planet]}.`, target: o.count ?? 1 };
    }
    case "defeat": {
      const what = o.enemy ? ENEMY_NAMES[o.enemy] : "hostile";
      return { title: `Destroy ${o.count} ${what}${o.count > 1 ? "s" : ""}`, detail: o.planet ? `Engage them in the skies of ${PN[o.planet]}.` : "Anywhere in the system.", target: o.count };
    }
    case "clear":
      return { title: "Clear the hostile wave", detail: `Destroy every attacker over ${PN[o.planet]}.`, target: 1 };
    case "escort":
      return { title: "Protect the freighter", detail: `Keep the allied freighter alive over ${PN[o.planet]} until the ambush is beaten.`, target: 1 };
    case "dock":
      return { title: "Return to Halcyon Dock", detail: "Warp back to Veyra-7 and dock to claim the reward.", target: 1 };
  }
}

/** Pure contract board. */
export class ContractBoard {
  state: ContractState;
  constructor(
    state?: ContractState | null,
    private readonly now: () => number = Date.now,
  ) {
    this.state = state ? ContractBoard.sanitize(state) : ContractBoard.fresh(now());
  }

  static fresh(now = Date.now()): ContractState {
    const starter = CONTRACTS.find((c) => c.starter);
    return { active: starter ? { id: starter.id, step: 0, progress: 0, spawned: false, startedAt: now } : null, completed: [], repeats: {} };
  }

  get activeDef(): ContractDef | null {
    return this.state.active ? getContract(this.state.active.id) ?? null : null;
  }

  get objective(): ObjectiveDef | null {
    const d = this.activeDef;
    return d && this.state.active ? d.objectives[this.state.active.step] ?? null : null;
  }

  isAvailable(def: ContractDef): boolean {
    if (this.state.active?.id === def.id) return false;
    if (!def.repeatable && this.state.completed.includes(def.id)) return false;
    return (def.requires ?? []).every((r) => this.state.completed.includes(r));
  }

  available(): ContractDef[] {
    return CONTRACTS.filter((c) => this.isAvailable(c));
  }

  accept(id: string): boolean {
    const def = getContract(id);
    if (!def || !this.isAvailable(def)) return false;
    this.state.active = { id, step: 0, progress: 0, spawned: false, startedAt: this.now() };
    return true;
  }

  abandon(): void {
    this.state.active = null;
  }

  /** Objective summary for the HUD. */
  summary(): { contract: string; title: string; detail: string; current: number; target: number; step: number; steps: number } | null {
    const d = this.activeDef;
    const o = this.objective;
    if (!d || !o || !this.state.active) return null;
    const t = objectiveText(o);
    return { contract: d.title, title: t.title, detail: t.detail, current: Math.min(t.target, this.state.active.progress), target: t.target, step: this.state.active.step, steps: d.objectives.length };
  }

  /** An encounter the game should spawn now, if the current objective needs one here. */
  pendingSpawn(planet: PlanetId, flying: boolean): string | null {
    const o = this.objective;
    const a = this.state.active;
    if (!o || !a || a.spawned || !flying) return null;
    if ((o.kind === "clear" || o.kind === "escort") && o.planet === planet) return o.encounter;
    if (o.kind === "defeat" && o.encounter && o.planet === planet) return o.encounter;
    return null;
  }

  /** Planet the current objective points at (star-map highlight). */
  targetPlanet(): PlanetId | null {
    const o = this.objective;
    if (!o) return null;
    if (o.kind === "dock") return "veyra7";
    return "planet" in o && o.planet ? o.planet : null;
  }

  markSpawned(): void {
    if (this.state.active) this.state.active.spawned = true;
  }

  /** Completes objectives already satisfied by where the player is (e.g. accepted while in orbit there). */
  settle(ctx: { planet: PlanetId }): ContractResult {
    const o = this.objective;
    if (o?.kind === "travel" && o.planet === ctx.planet) return this.handle({ type: "arrived", planet: ctx.planet });
    return NONE;
  }

  handle(e: ContractEvent): ContractResult {
    const def = this.activeDef;
    const a = this.state.active;
    const o = this.objective;
    if (!def || !a || !o) return NONE;

    // Failure paths reset the current combat objective so it can be retried.
    if (e.type === "shipLost" || (e.type === "allyLost" && o.kind === "escort" && e.encounter === o.encounter)) {
      if (o.kind === "clear" || o.kind === "escort" || (o.kind === "defeat" && o.encounter)) {
        a.progress = 0;
        a.spawned = false;
        return { advanced: false, completed: null, failed: e.type === "shipLost" ? "Ship lost — objective reset" : "Freighter lost — objective reset" };
      }
      return NONE;
    }

    const t = objectiveText(o).target;
    let inc = 0;
    switch (o.kind) {
      case "travel":
        inc = e.type === "arrived" && e.planet === o.planet ? 1 : 0;
        break;
      case "land":
        inc = e.type === "landed" && e.planet === o.planet ? 1 : 0;
        break;
      case "scan":
        inc = e.type === "scanned" && e.planet === o.planet && e.found > 0 ? 1 : 0;
        break;
      case "collect":
        inc = e.type === "collected" && e.resource === o.resource && (!o.planet || o.planet === e.planet) ? e.amount : 0;
        break;
      case "inspect":
        inc = e.type === "inspected" && e.planet === o.planet && (!o.poiKind || o.poiKind === e.poiKind) ? 1 : 0;
        break;
      case "defeat":
        inc = e.type === "destroyed" && (!o.enemy || o.enemy === e.enemy) && (!o.planet || o.planet === e.planet) ? 1 : 0;
        break;
      case "clear":
      case "escort":
        inc = e.type === "cleared" && e.encounter === o.encounter && e.planet === o.planet ? 1 : 0;
        break;
      case "dock":
        inc = e.type === "docked" ? 1 : 0;
        break;
    }
    if (inc <= 0) return NONE;
    a.progress += inc;
    if (a.progress < t) return { advanced: true, completed: null, failed: null };
    a.step += 1;
    a.progress = 0;
    a.spawned = false;
    if (a.step < def.objectives.length) return { advanced: true, completed: null, failed: null };
    // Contract complete.
    this.state.active = null;
    if (def.repeatable) this.state.repeats[def.id] = (this.state.repeats[def.id] ?? 0) + 1;
    if (!this.state.completed.includes(def.id)) this.state.completed.push(def.id);
    return { advanced: true, completed: def, failed: null };
  }

  static sanitize(raw: unknown): ContractState {
    const out: ContractState = { active: null, completed: [], repeats: {} };
    if (!raw || typeof raw !== "object") return ContractBoard.fresh();
    const r = raw as Record<string, any>;
    const known = new Set(CONTRACTS.map((c) => c.id));
    if (Array.isArray(r.completed)) out.completed = [...new Set(r.completed.filter((x: unknown): x is string => typeof x === "string" && known.has(x)))];
    if (r.repeats && typeof r.repeats === "object") for (const [k, v] of Object.entries(r.repeats)) if (known.has(k) && typeof v === "number" && v > 0) out.repeats[k] = Math.floor(v);
    const a = r.active;
    if (a && typeof a === "object" && known.has(a.id)) {
      const def = getContract(a.id)!;
      const step = typeof a.step === "number" ? Math.floor(a.step) : 0;
      if (step >= 0 && step < def.objectives.length) {
        out.active = {
          id: a.id,
          step,
          progress: typeof a.progress === "number" && a.progress > 0 ? Math.floor(a.progress) : 0,
          // Encounters never persist across sessions: respawn on resume.
          spawned: false,
          startedAt: typeof a.startedAt === "number" ? a.startedAt : Date.now(),
        };
      }
    }
    return out;
  }
}
