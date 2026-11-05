/**
 * Device-local preferences. Graphics belong to the device, not the account:
 * a Telegram phone on Basic must not push Basic onto the player's PC through a
 * shared cloud save. Stored separately from SaveData (whose schema is unchanged).
 */
import type { GraphicsSetting } from "../graphics/profiles";

export interface DevicePrefs {
  graphics: GraphicsSetting;
  /** Render resolution multiplier (0.5..1). */
  resolution: number;
  /** Let the governor lower resolution/effects to protect frame rate. */
  adaptive: boolean;
  /** Show the performance overlay. */
  perfStats: boolean;
}

export const DEFAULT_DEVICE_PREFS: DevicePrefs = { graphics: "auto", resolution: 1, adaptive: true, perfStats: false };
const KEY = "orbitbtc.galacticFrontier.device";

export function sanitizePrefs(raw: unknown): DevicePrefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    graphics: ["auto", "basic", "enhanced", "ultra"].includes(r.graphics as string) ? (r.graphics as GraphicsSetting) : "auto",
    resolution: typeof r.resolution === "number" && Number.isFinite(r.resolution) ? Math.min(1, Math.max(0.5, r.resolution)) : 1,
    adaptive: r.adaptive !== false,
    perfStats: r.perfStats === true,
  };
}

export function loadDevicePrefs(storage: Pick<Storage, "getItem"> | null = safeStorage()): DevicePrefs {
  try {
    const s = storage?.getItem(KEY);
    return s ? sanitizePrefs(JSON.parse(s)) : { ...DEFAULT_DEVICE_PREFS };
  } catch {
    return { ...DEFAULT_DEVICE_PREFS };
  }
}

export function saveDevicePrefs(p: DevicePrefs, storage: Pick<Storage, "setItem"> | null = safeStorage()): void {
  try {
    storage?.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage blocked */
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}
