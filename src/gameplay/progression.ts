/**
 * Pilot progression (M6): experience, ranks, achievements and cosmetic unlocks.
 *
 * Experience ("XP") and ranks are virtual in-game progress only. They are not
 * Orbit Coins, have no exchange rate and are never sent as a reward claim.
 */
import type { EnemyTypeId } from "../combat/ids";
import { ENEMY_TYPE_IDS } from "../combat/ids";
import { PLANET_IDS, type PlanetId } from "../universe/types";

export interface RankDef {
  title: string;
  xp: number;
}

/** Original rank ladder. */
export const RANKS: RankDef[] = [
  { title: "Cadet Surveyor", xp: 0 },
  { title: "Wayfinder", xp: 150 },
  { title: "Frontier Scout", xp: 400 },
  { title: "Void Ranger", xp: 850 },
  { title: "Starwarden", xp: 1600 },
  { title: "Frontier Legend", xp: 3000 },
];

export interface ProgressionState {
  xp: number;
  kills: Record<EnemyTypeId, number>;
  visited: PlanetId[];
  scannedPlanets: PlanetId[];
  inspected: number;
  warps: number;
  contractsCompleted: number;
  achievements: string[];
  /** Selected Wayfarer paint scheme id. */
  paint: string;
}

export interface ProgressStats {
  totalKills: number;
}

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  xp: number;
  /** Paint scheme unlocked by this achievement (cosmetic only). */
  unlocksPaint?: string;
  test(s: ProgressionState): boolean;
}

const totalKills = (s: ProgressionState) => ENEMY_TYPE_IDS.reduce((n, t) => n + (s.kills[t] ?? 0), 0);
const NEW_WORLDS = PLANET_IDS.filter((p) => p !== "veyra7");

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: "first_warp", name: "Beyond the Dock", description: "Complete your first warp jump.", xp: 25, test: (s) => s.warps >= 1 },
  { id: "first_blood", name: "First Contact", description: "Destroy a hostile spacecraft.", xp: 40, unlocksPaint: "ember", test: (s) => totalKills(s) >= 1 },
  { id: "ace", name: "Ace of the Frontier", description: "Destroy 10 hostile spacecraft.", xp: 120, unlocksPaint: "nightjar", test: (s) => totalKills(s) >= 10 },
  { id: "raider_breaker", name: "Raider Breaker", description: "Destroy a Heavy Raider.", xp: 80, test: (s) => (s.kills.raider ?? 0) >= 1 },
  { id: "squadron_down", name: "Wingclipper", description: "Destroy 4 Hunter fighters.", xp: 80, test: (s) => (s.kills.hunter ?? 0) >= 4 },
  { id: "titan_fall", name: "Titanfall", description: "Bring down a Dreadnought.", xp: 300, unlocksPaint: "solstice", test: (s) => (s.kills.dreadnought ?? 0) >= 1 },
  { id: "explorer", name: "Star Charter", description: "Visit all five new worlds.", xp: 150, unlocksPaint: "tidepool", test: (s) => NEW_WORLDS.every((p) => s.visited.includes(p)) },
  { id: "deep_survey", name: "Deep Survey", description: "Run a successful scan on every world.", xp: 120, test: (s) => PLANET_IDS.every((p) => s.scannedPlanets.includes(p)) },
  { id: "relic_hunter", name: "Relic Hunter", description: "Inspect 12 points of interest.", xp: 100, test: (s) => s.inspected >= 12 },
  { id: "contractor", name: "Trusted Contractor", description: "Complete 5 frontier contracts.", xp: 100, test: (s) => s.contractsCompleted >= 5 },
];

export interface PaintDef {
  id: string;
  name: string;
}

/** Cosmetic schemes; ids match PAINT_SCHEMES in src/vehicles/shipModel.ts. */
export const PAINTS: PaintDef[] = [
  { id: "wayfarer", name: "Wayfarer Standard" },
  { id: "ember", name: "Ember Run" },
  { id: "nightjar", name: "Nightjar" },
  { id: "tidepool", name: "Tidepool" },
  { id: "solstice", name: "Solstice" },
];

export function emptyKills(): Record<EnemyTypeId, number> {
  return { scout: 0, interceptor: 0, raider: 0, hunter: 0, dreadnought: 0 };
}

export function freshProgression(): ProgressionState {
  return { xp: 0, kills: emptyKills(), visited: ["veyra7"], scannedPlanets: [], inspected: 0, warps: 0, contractsCompleted: 0, achievements: [], paint: "wayfarer" };
}

export function rankIndex(xp: number): number {
  let i = 0;
  for (let k = 0; k < RANKS.length; k++) if (xp >= RANKS[k].xp) i = k;
  return i;
}

export function rankOf(xp: number): { index: number; title: string; next: RankDef | null; progress: number } {
  const index = rankIndex(xp);
  const cur = RANKS[index];
  const next = RANKS[index + 1] ?? null;
  const progress = next ? (xp - cur.xp) / (next.xp - cur.xp) : 1;
  return { index, title: cur.title, next, progress: Math.max(0, Math.min(1, progress)) };
}

export function unlockedPaints(s: ProgressionState): string[] {
  const out = ["wayfarer"];
  for (const a of ACHIEVEMENTS) if (a.unlocksPaint && s.achievements.includes(a.id)) out.push(a.unlocksPaint);
  return out;
}

export type ProgressEvent =
  | { type: "xp"; amount: number }
  | { type: "kill"; enemy: EnemyTypeId }
  | { type: "visit"; planet: PlanetId }
  | { type: "warp" }
  | { type: "scan"; planet: PlanetId; found: number }
  | { type: "inspect" }
  | { type: "contract" };

export interface ProgressResult {
  xpGained: number;
  rankUp: string | null;
  achievements: AchievementDef[];
}

/** Pure progression tracker. */
export class Progression {
  state: ProgressionState;

  constructor(state?: ProgressionState | null) {
    this.state = state ? Progression.sanitize(state) : freshProgression();
  }

  get rank() {
    return rankOf(this.state.xp);
  }

  handle(e: ProgressEvent): ProgressResult {
    const s = this.state;
    const before = rankIndex(s.xp);
    let gained = 0;
    switch (e.type) {
      case "xp":
        gained += Math.max(0, Math.floor(e.amount));
        break;
      case "kill":
        s.kills[e.enemy] = (s.kills[e.enemy] ?? 0) + 1;
        break;
      case "visit":
        if (!s.visited.includes(e.planet)) s.visited.push(e.planet);
        break;
      case "warp":
        s.warps += 1;
        break;
      case "scan":
        if (e.found > 0 && !s.scannedPlanets.includes(e.planet)) s.scannedPlanets.push(e.planet);
        break;
      case "inspect":
        s.inspected += 1;
        break;
      case "contract":
        s.contractsCompleted += 1;
        break;
    }
    const unlocked: AchievementDef[] = [];
    for (const a of ACHIEVEMENTS) {
      if (s.achievements.includes(a.id) || !a.test(s)) continue;
      s.achievements.push(a.id);
      unlocked.push(a);
      gained += a.xp;
    }
    s.xp += gained;
    const after = rankIndex(s.xp);
    return { xpGained: gained, rankUp: after > before ? RANKS[after].title : null, achievements: unlocked };
  }

  setPaint(id: string): boolean {
    if (!unlockedPaints(this.state).includes(id)) return false;
    this.state.paint = id;
    return true;
  }

  static sanitize(raw: unknown): ProgressionState {
    const base = freshProgression();
    if (!raw || typeof raw !== "object") return base;
    const r = raw as Record<string, any>;
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);
    const planets = (l: unknown) => (Array.isArray(l) ? [...new Set(l.filter((p): p is PlanetId => PLANET_IDS.includes(p as PlanetId)))] : []);
    const kills = emptyKills();
    for (const t of ENEMY_TYPE_IDS) kills[t] = num(r.kills?.[t]);
    const visited = planets(r.visited);
    if (!visited.includes("veyra7")) visited.unshift("veyra7");
    const known = new Set(ACHIEVEMENTS.map((a) => a.id));
    const out: ProgressionState = {
      xp: num(r.xp),
      kills,
      visited,
      scannedPlanets: planets(r.scannedPlanets),
      inspected: num(r.inspected),
      warps: num(r.warps),
      contractsCompleted: num(r.contractsCompleted),
      achievements: Array.isArray(r.achievements) ? [...new Set(r.achievements.filter((a: unknown): a is string => typeof a === "string" && known.has(a)))] : [],
      paint: "wayfarer",
    };
    if (typeof r.paint === "string" && unlockedPaints(out).includes(r.paint)) out.paint = r.paint;
    return out;
  }
}
