/** Events returned by CombatSystem.update(). Plain data: safe to log / serialise. */
import type { AiState, EnemyTypeId } from "./ids";
import type { ResourceId } from "../gameplay/resources";
import type { BoltKind, WeaponId } from "./weapons";
import type { Vec3 } from "./vec";

export type Loot = Partial<Record<ResourceId, number>>;

export type CombatEvent =
  | { type: "playerFired"; gun: number; position: Vec3; dir: Vec3 }
  | { type: "playerOverheated" }
  | { type: "playerCooled" }
  | { type: "enemyTelegraph"; id: string; position: Vec3; weapon: WeaponId; duration: number; hardpoint?: string }
  | { type: "enemyFired"; id: string; position: Vec3; dir: Vec3; weapon: WeaponId; kind: BoltKind; hardpoint?: string }
  | { type: "playerShieldHit"; point: Vec3; absorbed: number }
  | { type: "playerShieldDown" }
  | { type: "playerHullDamage"; amount: number; point: Vec3; sourceId: string }
  | { type: "enemyShieldHit"; id: string; point: Vec3; absorbed: number }
  | { type: "enemyShieldDown"; id: string }
  | { type: "enemyHit"; id: string; point: Vec3; damage: number; hardpoint?: string }
  | { type: "enemyDestroyed"; id: string; enemyType: EnemyTypeId; position: Vec3; radius: number; loot: Loot; xp: number; encounter: string | null }
  | { type: "hardpointDestroyed"; id: string; hardpoint: string; kind: string; position: Vec3; xp: number }
  | { type: "bossPhase"; id: string; phase: number }
  | { type: "bossLaunch"; id: string; count: number }
  | { type: "groundImpact"; point: Vec3; owner: "player" | "enemy"; kind: BoltKind }
  | { type: "targetChanged"; id: string | null; hardpoint: string | null }
  | { type: "targetLocked"; id: string; hardpoint: string | null }
  | { type: "encounterStarted"; id: string; encounter: string }
  | { type: "encounterCleared"; id: string; encounter: string }
  | { type: "enemySpawned"; id: string; enemyType: EnemyTypeId }
  | { type: "allyHit"; id: string; point: Vec3; damage: number }
  | { type: "allyDestroyed"; id: string; position: Vec3 }
  | { type: "aiStateChanged"; id: string; from: AiState; to: AiState };

export type CombatEventType = CombatEvent["type"];
