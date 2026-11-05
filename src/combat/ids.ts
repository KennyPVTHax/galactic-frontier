/**
 * Shared combat identifiers (M5 integration contract).
 * Factions and ships are original to Galactic Frontier.
 */
export type EnemyTypeId = "scout" | "interceptor" | "raider" | "hunter" | "dreadnought";
export const ENEMY_TYPE_IDS: EnemyTypeId[] = ["scout", "interceptor", "raider", "hunter", "dreadnought"];

/** Explicit, testable AI states (PATROL → DETECT → PURSUE → ATTACK → EVADE / RETREAT → RETURN). */
export type AiState = "patrol" | "detect" | "pursue" | "attack" | "evade" | "retreat" | "return";
export const AI_STATES: AiState[] = ["patrol", "detect", "pursue", "attack", "evade", "retreat", "return"];

export type FactionId = "ashveil" | "hollowChoir";
