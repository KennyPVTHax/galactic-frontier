import { Inventory, type InventoryCounts } from "../gameplay/inventory";
import { IntroMission, type MissionSnapshot } from "../gameplay/mission";
import { sanitizeLevels, type UpgradeLevels } from "../gameplay/upgrades";
import type { QualitySetting } from "../core/quality";
import type { BackendClient } from "../integration/backend";

export const SAVE_VERSION = 2;

export type ShipSaveState = "docked" | "landed" | "flying";

export interface GameSettings {
  quality: QualitySetting;
  lookSensitivity: number;
  invertY: boolean;
  showFps: boolean;
}

export interface SaveData {
  version: number;
  savedAt: number;
  mode: "onFoot" | "inShip";
  player: { x: number; y: number; z: number; yaw: number };
  ship: { x: number; y: number; z: number; yaw: number; hull: number; state: ShipSaveState };
  inventory: InventoryCounts;
  upgrades: UpgradeLevels;
  mission: MissionSnapshot;
  /** depositId -> epoch ms when depleted (regrows later). */
  depleted: Record<string, number>;
  /** depositId -> remaining fraction for partially mined deposits. */
  partial: Record<string, number>;
  discoveredPois: string[];
  lootedPois: string[];
  settings: GameSettings;
}

export const DEFAULT_SETTINGS: GameSettings = { quality: "auto", lookSensitivity: 1, invertY: false, showFps: false };

export function newGameSave(now = Date.now()): SaveData {
  return {
    version: SAVE_VERSION,
    savedAt: now,
    mode: "inShip",
    player: { x: 0, y: 0, z: 0, yaw: 0 },
    ship: { x: 0, y: 0, z: 0, yaw: 0, hull: 100, state: "docked" },
    inventory: { ferrite: 0, carbon: 0, lumenite: 0, voidQuartz: 0 },
    upgrades: sanitizeLevels(null),
    mission: IntroMission.fresh(),
    depleted: {},
    partial: {},
    discoveredPois: [],
    lootedPois: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

const finite = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);

/**
 * Validates and upgrades any stored blob to the current schema.
 * Returns null for unusable data (the game then starts fresh).
 */
export function migrateSave(raw: unknown): SaveData | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, any>;
  let version = finite(r.version, 0);
  if (version < 1 || version > SAVE_VERSION) return null;

  // v1 -> v2: `partial` deposits map added; `settings.showFps` added.
  if (version === 1) {
    r.partial = {};
    r.settings = { ...DEFAULT_SETTINGS, ...(r.settings ?? {}) };
    version = 2;
  }

  const base = newGameSave(finite(r.savedAt, Date.now()));
  const ship = r.ship ?? {};
  const player = r.player ?? {};
  const shipState: ShipSaveState = ["docked", "landed", "flying"].includes(ship.state) ? ship.state : "docked";
  const settings = r.settings ?? {};
  const strMap = (m: unknown) => {
    const out: Record<string, number> = {};
    if (m && typeof m === "object") for (const [k, v] of Object.entries(m)) if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    return out;
  };
  const strList = (l: unknown) => (Array.isArray(l) ? l.filter((x): x is string => typeof x === "string") : []);

  return {
    ...base,
    version: SAVE_VERSION,
    mode: r.mode === "onFoot" ? "onFoot" : "inShip",
    player: { x: finite(player.x), y: finite(player.y), z: finite(player.z), yaw: finite(player.yaw) },
    ship: {
      x: finite(ship.x),
      y: finite(ship.y),
      z: finite(ship.z),
      yaw: finite(ship.yaw),
      hull: Math.max(1, finite(ship.hull, 100)),
      // Never resume mid-air: a flying save resumes docked for safety.
      state: shipState === "flying" ? "docked" : shipState,
    },
    inventory: Inventory.sanitize(r.inventory),
    upgrades: sanitizeLevels(r.upgrades),
    mission: IntroMission.sanitize(r.mission),
    depleted: strMap(r.depleted),
    partial: strMap(r.partial),
    discoveredPois: strList(r.discoveredPois),
    lootedPois: strList(r.lootedPois),
    settings: {
      quality: ["auto", "low", "medium", "high"].includes(settings.quality) ? settings.quality : "auto",
      lookSensitivity: Math.min(3, Math.max(0.2, finite(settings.lookSensitivity, 1))),
      invertY: settings.invertY === true,
      showFps: settings.showFps === true,
    },
  };
}

export interface SaveAdapter {
  load(slot: string): Promise<SaveData | null>;
  save(slot: string, data: SaveData): Promise<void>;
  clear(slot: string): Promise<void>;
}

/** Browser storage. Works in Android WebView only when DOM storage is enabled. */
export class LocalStorageSaveAdapter implements SaveAdapter {
  constructor(private readonly prefix = "orbitbtc.galacticFrontier") {}
  private key(slot: string) {
    return `${this.prefix}.${slot}`;
  }
  async load(slot: string): Promise<SaveData | null> {
    try {
      const s = localStorage.getItem(this.key(slot));
      return s ? migrateSave(JSON.parse(s)) : null;
    } catch {
      return null;
    }
  }
  async save(slot: string, data: SaveData): Promise<void> {
    try {
      localStorage.setItem(this.key(slot), JSON.stringify(data));
    } catch {
      /* storage blocked or full: game keeps running */
    }
  }
  async clear(slot: string): Promise<void> {
    try {
      localStorage.removeItem(this.key(slot));
    } catch {
      /* ignore */
    }
  }
}

export class MemorySaveAdapter implements SaveAdapter {
  readonly store = new Map<string, string>();
  async load(slot: string) {
    const s = this.store.get(slot);
    return s ? migrateSave(JSON.parse(s)) : null;
  }
  async save(slot: string, data: SaveData) {
    this.store.set(slot, JSON.stringify(data));
  }
  async clear(slot: string) {
    this.store.delete(slot);
  }
}

/**
 * Cloud saves through the OrbitBtc backend, with a local cache as fallback.
 * The server should treat save data as untrusted player state (never as a
 * source of coin balances).
 */
export class RemoteSaveAdapter implements SaveAdapter {
  constructor(
    private readonly backend: BackendClient,
    private readonly cache: SaveAdapter = new LocalStorageSaveAdapter(),
  ) {}
  async load(slot: string) {
    try {
      const remote = this.backend.loadSave ? migrateSave(await this.backend.loadSave(slot)) : null;
      const local = await this.cache.load(slot);
      if (remote && local) return remote.savedAt >= local.savedAt ? remote : local;
      return remote ?? local;
    } catch {
      return this.cache.load(slot);
    }
  }
  async save(slot: string, data: SaveData) {
    await this.cache.save(slot, data);
    try {
      await this.backend.storeSave?.(slot, data);
    } catch {
      /* offline: local cache keeps progress */
    }
  }
  async clear(slot: string) {
    await this.cache.clear(slot);
  }
}
