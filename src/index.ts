/**
 * Public API of the Galactic Frontier game module.
 *
 * The OrbitBtc React app mounts the game into any element:
 *
 *   const handle = await mountGalacticFrontier(el, { backend, saveAdapter, onEvent });
 *   ...
 *   handle.dispose();
 */
import { Game, type GameOptions, type GameOutEvent } from "./core/game";

export type MountOptions = Omit<GameOptions, "container" | "requestRestart">;

export interface GalacticFrontierHandle {
  /** The live game (recreated when graphics quality changes). */
  readonly game: Game;
  /** Persist progress now. */
  save(): Promise<void>;
  /** Tear down WebGL, DOM and listeners. Call on React unmount. */
  dispose(): void;
}

export async function mountGalacticFrontier(container: HTMLElement, options: MountOptions = {}): Promise<GalacticFrontierHandle> {
  let game: Game;
  let disposed = false;
  const create = async (autoStart?: "continue") => {
    game = new Game({
      ...options,
      container,
      autoStart: autoStart ?? options.autoStart,
      // Quality changes rebuild the world; resume straight into the save.
      requestRestart: () => {
        void game.save().then(async () => {
          if (disposed) return;
          game.dispose();
          await create("continue");
        });
      },
    });
    await game.init();
  };
  await create();
  // Android game Activity calls this before closing the screen.
  if (typeof window !== "undefined" && (window as unknown as { OrbitBtcGame?: unknown }).OrbitBtcGame) {
    (window as unknown as { __gfSave?: () => Promise<void> }).__gfSave = () => game.save();
  }
  return {
    get game() {
      return game;
    },
    save: () => game.save(),
    dispose: () => {
      disposed = true;
      game.dispose();
    },
  };
}

export { Game };
export type { GameOptions, GameOutEvent };
export { QUALITY_PRESETS, DEFAULT_THEME, chooseQuality, type QualityLevel, type QualitySetting, type Theme } from "./core/quality";
export { PROFILES, resolveTier, effectiveProfile, platformDefaultTier, capabilityCeiling, type GraphicsTier, type GraphicsSetting, type PlatformKind, type RenderProfile } from "./graphics/profiles";
export { loadDevicePrefs, saveDevicePrefs, type DevicePrefs } from "./persistence/devicePrefs";
export {
  OfflineBackend,
  HttpBackendClient,
  buildCompletionReport,
  CLIENT_VERSION,
  type BackendClient,
  type HttpBackendOptions,
  type MissionCompletionReport,
  type MissionSubmissionResult,
  type MissionStartResponse,
} from "./integration/backend";
export {
  LocalStorageSaveAdapter,
  MemorySaveAdapter,
  RemoteSaveAdapter,
  migrateSave,
  newGameSave,
  SAVE_VERSION,
  type SaveAdapter,
  type SaveData,
  type GameSettings,
} from "./persistence/saveSystem";
export { RESOURCES, type ResourceId } from "./gameplay/resources";
export { INTRO_MISSION_ID, MISSION_REQUIREMENTS, type MissionSnapshot } from "./gameplay/mission";
