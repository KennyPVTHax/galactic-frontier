/**
 * Environmental hazards (M4): the surveyor's suit protects against cold, heat,
 * storms and toxic air, but only for so long. Pure and deterministic.
 *
 * - Exposure drains suit integrity at `intensity × rate` per second.
 * - Out of hazard (or inside the ship) integrity recovers.
 * - At zero integrity the suit triggers an emergency recall to the ship.
 */
import type { HazardKind } from "../universe/types";

export interface SuitTick {
  /** Integrity 0..1 after this tick. */
  integrity: number;
  /** Crossed below 35% this tick. */
  warning: boolean;
  /** Reached zero this tick: game recalls the player to the ship. */
  failed: boolean;
}

export const SUIT_DRAIN_PER_SEC: Record<HazardKind, number> = { none: 0, cold: 0.018, heat: 0.03, storm: 0.014, toxic: 0.026 };
export const SUIT_RECOVER_PER_SEC = 0.12;

export class SuitIntegrity {
  integrity = 1;
  private warned = false;

  update(dt: number, kind: HazardKind, intensity: number, sheltered: boolean): SuitTick {
    const before = this.integrity;
    const exposure = sheltered ? 0 : Math.max(0, Math.min(1, intensity)) * SUIT_DRAIN_PER_SEC[kind];
    if (exposure > 0) this.integrity = Math.max(0, this.integrity - exposure * dt);
    else this.integrity = Math.min(1, this.integrity + SUIT_RECOVER_PER_SEC * dt);
    if (this.integrity > 0.5) this.warned = false;
    const warning = !this.warned && before >= 0.35 && this.integrity < 0.35;
    if (warning) this.warned = true;
    const failed = before > 0 && this.integrity <= 0;
    return { integrity: this.integrity, warning, failed };
  }

  reset(): void {
    this.integrity = 1;
    this.warned = false;
  }
}

export function hazardLabel(kind: HazardKind): string {
  return { none: "Clear", cold: "Extreme cold", heat: "Extreme heat", storm: "Ion storm", toxic: "Toxic atmosphere" }[kind];
}
