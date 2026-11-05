/** Plain-data view the combat HUD renders (built by CombatSystem.hudView()). */
import type { Vec3 } from "./vec";

export interface HudTargetView {
  id: string;
  name: string;
  role: string;
  color: string;
  position: Vec3;
  /** Visual size (m) used to scale the bracket. */
  radius: number;
  hull: number;
  shield: number;
  hasShield: boolean;
  /** 0..1 lock progress. */
  lock: number;
  locked: boolean;
  distance: number;
  hardpoint: string | null;
}

export interface HudThreat {
  id: string;
  position: Vec3;
  /** Currently on an attack run / charging weapons at the player. */
  attacking: boolean;
  color: string;
}

export interface HudBossView {
  name: string;
  hull: number;
  shield: number;
  phase: number;
  phases: number;
  enraged: boolean;
  hardpointsAlive: number;
  hardpointsTotal: number;
}

export interface HudAllyView {
  id: string;
  name: string;
  hull: number;
  shield: number;
  alive: boolean;
}

export interface CombatHudView {
  /** Any live hostiles (HUD shows combat widgets). */
  active: boolean;
  shield: number;
  maxShield: number;
  hull: number;
  maxHull: number;
  /** Weapon heat 0..1. */
  heat: number;
  overheated: boolean;
  hostiles: number;
  target: HudTargetView | null;
  /** World point to aim at so bolts meet the target (null without a target). */
  lead: Vec3 | null;
  threats: HudThreat[];
  /** Telegraphed or in-flight fire aimed at the player. */
  incoming: boolean;
  boss: HudBossView | null;
  allies: HudAllyView[];
  /** Player hits / kills since the previous hudView() call (hit markers). */
  hits: number;
  kills: number;
}
