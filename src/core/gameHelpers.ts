import type { UpgradeLevels } from "../gameplay/upgrades";

/** Total installed upgrade levels (used to scale encounter difficulty slightly). */
export function upgradeSum(levels: UpgradeLevels): number {
  return Object.values(levels).reduce((a, b) => a + b, 0);
}
