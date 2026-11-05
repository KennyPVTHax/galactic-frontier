import { Camera, Engine, Matrix, Scene, Vector3, Color4 } from "../engine/babylon";
import { DEFAULT_THEME, type QualityLevel, type QualitySetting, type Theme } from "./quality";
import { MaterialLibrary, SurfaceTextures, WorldUniforms, sunVector } from "../graphics/materials";
import { Renderer } from "../graphics/renderer";
import { effectiveProfile, legacyFromTier, resolveTier, tierFromLegacy, PROFILES, type GpuCapabilities, type GraphicsTier, type RenderProfile, type TierDecision } from "../graphics/profiles";
import { OrientationController, createHaptics, detectPlatform, probeGpu, type OrientationState, type PlatformInfo } from "../platform/platform";
import { loadDevicePrefs, saveDevicePrefs, type DevicePrefs } from "../persistence/devicePrefs";
import { WORLD, stationPadPosition } from "./worldConfig";
import { clamp, damp } from "./random";
import { Planet, SKY_COLORS as SKY, type Deposit, type PointOfInterest, type Collider } from "../world/planet";
import { Station } from "../world/station";
import { Player } from "../player/player";
import { CameraRig } from "../player/cameraRig";
import { ShipModel } from "../vehicles/shipModel";
import { ShipPhysics, GEAR_HEIGHT, type ShipControls, type ShipEnvironment, type ShipEvent } from "../vehicles/shipPhysics";
import { InputManager, type InputFrame } from "../input/input";
import { Hud, type PanelId, type ScreenMarker, type CompassMarker } from "../ui/hud";
import { Inventory } from "../gameplay/inventory";
import { MiningLaserState } from "../gameplay/miningLaser";
import { RESOURCES, formatCost, type ResourceId } from "../gameplay/resources";
import { deriveStats, emptyLevels, purchaseUpgrade, getUpgrade, type DerivedStats, type UpgradeId, type UpgradeLevels } from "../gameplay/upgrades";
import { IntroMission, MISSION_REQUIREMENTS, MISSION_STEPS, INTRO_MISSION_ID, type GameplayEvent } from "../gameplay/mission";
import { LaserBeam, ScanPulse, EnvironmentFx, ShipFx, makeParticleTexture } from "../graphics/gameplayFx";
import {
  DEFAULT_SETTINGS,
  LocalStorageSaveAdapter,
  newGameSave,
  type GameSettings,
  type SaveAdapter,
  type SaveData,
} from "../persistence/saveSystem";
import { OfflineBackend, buildCompletionReport, type BackendClient, type MissionSubmissionResult } from "../integration/backend";
import { PLANETS, getPlanet } from "../universe/planets";
import { PLANET_IDS, type PlanetDef, type PlanetId, type PoiKind } from "../universe/types";
import { Progression, type ProgressEvent } from "../gameplay/progression";
import { ContractBoard, type ContractEvent } from "../gameplay/contracts";
import { SuitIntegrity, hazardLabel } from "../gameplay/hazards";
import { starMapHtml, bindStarMap, frontierHtml, bindFrontier } from "../ui/frontierUi";
import { RESOURCE_IDS as ALL_RESOURCES } from "../gameplay/resources";
import type { SkyColors } from "../world/sky";
import type { WorldLighting } from "../graphics/renderer";
import { CombatSystem, DEFAULT_PLAYER_STATS } from "../combat/combatSystem";
import { CombatRenderer } from "../combat/combatRenderer";
import { CombatHud } from "../combat/combatHud";
import type { CombatEvent } from "../combat/events";
import { ENEMY_TYPES } from "../combat/enemyTypes";
import { WarpFx } from "../graphics/warpFx";
import { SpaceEnvironment } from "../world/space";
import { PAINT_SCHEMES } from "../vehicles/shipModel";
import { upgradeSum } from "./gameHelpers";
import { rulesFingerprint } from "../shared/rules";
import { PerfRecorder, type PerfContext, type PerfReport } from "./perfRecorder";
import { FARMING_RULES, RIG_IDS, buildOrUpgrade as farmBuildOrUpgrade, claim as farmClaimAll, freshFarm, getRig, nextLevelCost as farmNextCost, pending as farmPending, rigCapacity, rigRatePerHour, type FarmState, type RigId } from "../gameplay/farming";
import { PerfOverlay } from "../ui/perfOverlay";
import { CLIENT_VERSION } from "../integration/backend";
import { installDebugHooks } from "./debugHooks";

/** Set by the build: release bundles define __GF_DEBUG__ = false so the test hooks are dropped entirely. */
declare const __GF_DEBUG__: boolean | undefined;

export type GameOutEvent =
  | { type: "ready"; quality: QualityLevel; tier: GraphicsTier; /** Fingerprint of the shared gameplay rules this build runs (identical on every platform). */ rules: string }
  | { type: "missionStep"; step: string }
  | { type: "missionComplete"; result: MissionSubmissionResult }
  | { type: "saved"; at: number }
  | { type: "warp"; from: PlanetId; to: PlanetId }
  | { type: "contractComplete"; id: string }
  | { type: "contextLost" }
  | { type: "error"; message: string };

export interface GameOptions {
  container: HTMLElement;
  /** Forces a graphics tier for this session ("basic" | "enhanced" | "ultra"; legacy "low" | "medium" | "high"). */
  quality?: QualitySetting | GraphicsTier;
  saveAdapter?: SaveAdapter;
  saveSlot?: string;
  backend?: BackendClient;
  theme?: Partial<Theme>;
  onEvent?: (e: GameOutEvent) => void;
  /** Show touch controls even without a coarse pointer (testing). */
  forceTouch?: boolean;
  /** Exposes window.__GF debug helpers (never enable in production). */
  debug?: boolean;
  /** Show the performance recorder (the same overlay is toggled by Settings → Performance stats). */
  perfOverlay?: boolean;
  /** Skip the title screen. */
  autoStart?: "new" | "continue";
  /** Called when a settings change needs a full restart (quality). */
  requestRestart?: () => void;
}

type Mode = "title" | "onFoot" | "ship";

const MISSION_WAYPOINT_COLOR = "#ffd37a";
const CONTRACT_WAYPOINT_COLOR = "#7affc4";
/** Warp timing (seconds of game time). */
const WARP_SPOOL = 1.6;
const WARP_TUNNEL = 1.5;
const WARP_EXIT = 0.45;

export class Game {
  readonly theme: Theme;
  readonly engine: Engine;
  readonly scene: Scene;
  readonly canvas: HTMLCanvasElement;
  readonly hud: Hud;
  readonly input: InputManager;
  readonly rig: CameraRig;
  readonly backend: BackendClient;
  readonly saveAdapter: SaveAdapter;
  readonly slot: string;
  readonly platform: PlatformInfo;
  readonly caps: GpuCapabilities;
  readonly orientation: OrientationController;
  prefs: DevicePrefs;
  tierDecision: TierDecision;
  materials!: MaterialLibrary;
  renderer!: Renderer;

  /** Legacy M1 name of the active tier (low/medium/high). */
  get qualityLevel(): QualityLevel {
    return legacyFromTier(this.tierDecision.tier);
  }

  planet!: Planet;
  station!: Station;
  player!: Player;
  shipModel!: ShipModel;
  ship = new ShipPhysics();
  shipEnv!: ShipEnvironment;
  inventory = new Inventory();
  laser = new MiningLaserState();
  levels: UpgradeLevels = emptyLevels();
  stats: DerivedStats = deriveStats(emptyLevels());
  mission = new IntroMission();
  settings: GameSettings = { ...DEFAULT_SETTINGS };

  private mode: Mode = "title";
  private beam!: LaserBeam;
  private pulse!: ScanPulse;
  private envFx!: EnvironmentFx;
  private shipFx!: ShipFx;
  private windT = 0;
  private gustiness = 0;
  private orientationState: OrientationState | null = null;
  private tagged = new Map<string, number>();
  private discovered = new Set<string>();
  private looted = new Set<string>();
  private shipCollider: Collider = { x: 0, z: 0, r: 3.3, top: 0 };
  private scanCooldown = 0;
  private autosaveTimer = 0;
  private regrowTimer = 0;
  private lastToast: Record<string, number> = {};
  private gear = 1;
  private titleT = 0;
  private timeScale = 1;
  private disposed = false;
  private currentTarget: Deposit | null = null;
  private resizeObs: ResizeObserver | null = null;
  private cleanup: (() => void)[] = [];
  private lastStep = "";
  private submitting = false;

  // ---- M4–M6 state
  planetDef: PlanetDef = getPlanet("veyra7");
  progression = new Progression();
  contracts = new ContractBoard();
  suit = new SuitIntegrity();
  private arrivals = new Set<PlanetId>();
  /** Deposit state for every planet (runtime ids are unique across planets). */
  private depletedAll: Record<string, number> = {};
  private partialAll: Record<string, number> = {};
  private warp: { from: PlanetId; target: PlanetId; t: number; phase: "spool" | "tunnel" | "exit"; swapped: boolean; fromDock: boolean } | null = null;
  private starMapSel: PlanetId | null = null;
  // ---- combat / effects
  combat!: CombatSystem;
  private combatRenderer!: CombatRenderer;
  private combatHud!: CombatHud;
  private warpFx!: WarpFx;
  private space: SpaceEnvironment | null = null;
  private combatStats = { shots: 0, hits: 0, kills: 0 };
  /** Recent enemy AI state transitions (bounded), so tests and diagnostics can see the PATROL→…→ATTACK path. */
  private aiLog: { id: string; from: string; to: string }[] = [];
  private lastHullRatio = 1;
  // ---- real-device performance recorder (M7)
  private readonly perfRec = new PerfRecorder();
  private perfUi!: PerfOverlay;
  private perfReport: PerfReport | null = null;
  private perfSampleMs = 0;
  private perfLiveMs = 0;
  private particleTex: ReturnType<typeof makeParticleTexture> | null = null;
  private frontierTab: "contracts" | "pilot" | "farm" = "contracts";
  /** Orbital Harvesters (shared farming rules, gameplay/farming.ts). */
  farm: FarmState = freshFarm(Date.now());

  get planetId(): PlanetId {
    return this.planetDef.id;
  }

  constructor(private readonly opts: GameOptions) {
    this.theme = { ...DEFAULT_THEME, ...(opts.theme ?? {}) };
    this.backend = opts.backend ?? new OfflineBackend();
    this.saveAdapter = opts.saveAdapter ?? new LocalStorageSaveAdapter();
    this.slot = opts.saveSlot ?? "main";

    const root = opts.container;
    root.classList.add("gf-root");
    if (getComputedStyle(root).position === "static") root.style.position = "relative";
    this.canvas = document.createElement("canvas");
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute("aria-label", `${this.theme.gameTitle} game view`);
    root.appendChild(this.canvas);
    this.hud = new Hud(root, this.theme);

    this.platform = detectPlatform();
    this.prefs = loadDevicePrefs();
    if (opts.perfOverlay) this.prefs.perfStats = true;
    this.engine = new Engine(
      this.canvas,
      true,
      { stencil: true, preserveDrawingBuffer: false, powerPreference: "high-performance", failIfMajorPerformanceCaveat: false, doNotHandleContextLost: false },
      false,
    );
    this.caps = probeGpu((this.engine as unknown as { _gl: WebGLRenderingContext })._gl);
    this.tierDecision = this.decideTier();
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.02, 0.015, 0.05, 1);
    this.scene.skipPointerMovePicking = true;
    this.scene.constantlyUpdateMeshUnderPointer = false;
    this.rig = new CameraRig(this.scene);
    this.input = new InputManager(this.canvas, this.hud.root, { forceTouch: opts.forceTouch, haptic: createHaptics(this.platform) });
    this.orientation = new OrientationController(this.platform, window as Window & typeof globalThis, (st) => this.onOrientation(st));
  }

  /** Host override → player's device setting → platform default limited by hardware. */
  private decideTier(): TierDecision {
    const forced = tierFromLegacy(this.opts.quality ?? null);
    if (forced) return { tier: forced, reason: "host override" };
    return resolveTier(this.prefs.graphics, this.platform.kind, this.caps);
  }

  currentProfile(): RenderProfile {
    return effectiveProfile(this.tierDecision.tier, this.caps, this.prefs.resolution);
  }

  /** Live graphics change: no reload, game state untouched. */
  applyGraphics(): void {
    this.tierDecision = this.decideTier();
    if (!this.renderer) return;
    this.renderer.governor.enabled = this.prefs.adaptive;
    this.renderer.apply(this.currentProfile());
    this.applyShipLook();
  }

  /** Ship model detail/paint, combat FX budgets and the orbital environment follow the active profile. */
  private applyShipLook(): void {
    const prof = this.currentProfile();
    this.shipModel.setDetail(prof.shipDetail, prof.pbr);
    const paint = this.progression.state.paint;
    if (PAINT_SCHEMES[paint]) this.shipModel.setPaint(paint);
    this.combatRenderer.setBudget(prof.combatFx);
    this.combatRenderer.setPbr(prof.pbr);
    this.space?.setDetail(prof.tier, prof);
    this.planet.weather?.setBudget(prof.weatherParticles);
    this.combatHud.setTouch(this.input.touchActive);
  }

  private onOrientation(st: OrientationState): void {
    this.orientationState = st;
    this.hud.layout(window.innerWidth, window.innerHeight, st.insets, st.landscape);
    const inGame = this.mode !== "title";
    this.hud.showRotate(st.rotateHint && inGame);
    this.hud.showFullscreenButton(inGame && this.platform.kind === "android-browser" && !st.fullscreen);
    const cam = this.rig.camera;
    if (st.landscape) {
      cam.fovMode = Camera.FOVMODE_VERTICAL_FIXED;
      cam.fov = 1.0;
    } else {
      cam.fovMode = Camera.FOVMODE_HORIZONTAL_FIXED;
      cam.fov = 1.2;
    }
    this.engine.resize();
  }

  private emit(e: GameOutEvent): void {
    try {
      this.opts.onEvent?.(e);
    } catch {
      /* host errors must not crash the game */
    }
  }

  private nextFrame(): Promise<void> {
    return new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  }

  /** Builds the world (with a progress bar), then shows the title screen. */
  async init(): Promise<void> {
    const save = await this.saveAdapter.load(this.slot).catch(() => null);
    if (save) this.settings = { ...save.settings };
    this.input.sensitivity = this.settings.lookSensitivity;
    this.input.invertY = this.settings.invertY;

    this.hud.setLoading("Generating terrain…", 0.15);
    await this.nextFrame();
    const profile = this.currentProfile();
    this.materials = new MaterialLibrary(this.scene, new SurfaceTextures(this.scene));
    this.materials.textures.build(profile.textureSize);
    this.materials.setMode(profile.pbr, profile.terrainDetail >= 2, profile.atmosphere);
    this.planet = new Planet(this.scene, this.materials);
    sunVector(this.planet.sunDirection);
    this.hud.setLoading("Assembling Halcyon Dock…", 0.6);
    await this.nextFrame();
    this.station = new Station(this.scene, this.materials);
    this.shipModel = new ShipModel(this.scene, this.materials);
    this.player = new Player(this.scene, this.materials);
    const ptex = makeParticleTexture(this.scene);
    this.particleTex = ptex;
    this.beam = new LaserBeam(this.scene, ptex, 220);
    this.pulse = new ScanPulse(this.scene);
    const wind = { get x() { return WorldUniforms.wind.x; }, get z() { return WorldUniforms.wind.y; } };
    this.envFx = new EnvironmentFx(this.scene, ptex, this.rig.camera, wind);
    this.shipFx = new ShipFx(this.scene, ptex, this.shipModel.nozzles);
    this.combat = new CombatSystem({ seed: (Date.now() ^ 0x5bd1e995) & 0x7fffffff });
    this.combatRenderer = new CombatRenderer(this.scene, { pbr: profile.pbr, detail: profile.tier === "basic" ? 0 : profile.tier === "enhanced" ? 1 : 2, lights: profile.tier === "basic" ? 0 : 1, budget: profile.combatFx });
    this.perfUi = new PerfOverlay(this.hud.root, {
      onStart: () => {
        this.perfRec.start();
        this.perfReport = null;
        this.perfSampleMs = 0;
        this.perfUi.setRecording(true);
        this.hud.toast("Recording performance — play normally for at least 60 s, then tap Stop", "info");
      },
      onStop: () => this.finishPerfRecording(),
      getReportJson: () => (this.perfReport ? JSON.stringify(this.perfReport, null, 1) : null),
    });
    this.combatHud = new CombatHud(this.hud.root);
    this.combatHud.setTouch(this.input.touchActive);
    this.warpFx = new WarpFx(this.scene, this.rig.camera, profile.warpFx.streaks);
    this.renderer = new Renderer(
      {
        engine: this.engine,
        scene: this.scene,
        camera: this.rig.camera,
        sun: this.planet.sun,
        ambient: this.planet.ambient,
        skyMesh: this.planet.sky.mesh,
        sky: { zenith: SKY.zenith, horizon: SKY.horizon, ground: SKY.ground, sun: SKY.sun, sunDir: this.planet.sunDirection },
        materials: this.materials,
        caps: this.caps,
      },
      {
        setDecorDensity: (d, g, dist) => this.planet.setDecorDensity(d, g, dist),
        setPropLod: (h, c, t) => this.planet.setPropLod(h, c, t),
        setParticleBudget: (b) => {
          this.beam.setBudget(b.sparks, b.debris);
          this.envFx.setBudget(b.dust, b.gusts);
          this.shipFx.setBudget(b.exhaust);
        },
        setSky: (c) => this.planet.sky.setClouds(c),
        setWater: (r, w) => this.planet.setWater(r, w),
        shadowCasters: () => ({ dynamic: [...this.player.model.meshes, ...this.shipModel.meshes], props: [...this.planet.propSources] }),
        shadowReceivers: () => this.planet.shadowReceivers(),
      },
    );
    this.renderer.governor.enabled = this.prefs.adaptive;
    this.renderer.apply(profile);
    this.hud.setLoading("Calibrating instruments…", 0.85);
    await this.nextFrame();

    const pad = stationPadPosition();
    this.shipEnv = {
      groundAt: (x, z) => this.planet.groundAt(x, z),
      normalYAt: (x, z) => this.planet.normalYAt(x, z),
      liquidLevel: WORLD.liquidLevel,
      padPosition: pad,
      padYaw: WORLD.station.padYaw,
      stationCenter: WORLD.station.position,
      stationRadius: WORLD.station.collisionRadius,
      flightRadius: WORLD.flightRadius,
      maxAltitude: WORLD.maxAltitude,
    };
    this.bindPlanetGameplay();
    this.applyShipLook();
    this.onEnterPlanet();
    this.ship.placeDocked(this.shipEnv);
    this.syncShipModel(0);
    this.player.model.setVisible(false);

    this.bindHandlers();
    this.bindLifecycle();
    await this.scene.whenReadyAsync().catch(() => undefined);
    this.engine.runRenderLoop(() => this.frame());
    this.hud.setLoading("Ready", 1);
    this.hud.hideLoading();
    this.hud.root.classList.add("title");
    this.emit({ type: "ready", quality: this.qualityLevel, tier: this.tierDecision.tier, rules: rulesFingerprint() });
    this.orientation.refresh();
    // The define is used inline (not via a const) so the bundler folds the branch away in release builds.
    if ((typeof __GF_DEBUG__ === "undefined" || __GF_DEBUG__) && this.opts.debug) installDebugHooks(this);

    if (this.opts.autoStart) {
      await this.start(this.opts.autoStart === "continue" && save ? save : null);
    } else {
      this.hud.showTitle({
        hasSave: !!save,
        touch: this.input.touchActive,
        onNew: () => void this.start(null),
        onContinue: () => void this.start(save),
      });
    }
  }

  private bindLifecycle(): void {
    const onVis = () => {
      if (document.hidden) {
        this.engine.stopRenderLoop();
        void this.save();
      } else if (!this.disposed) {
        this.engine.runRenderLoop(() => this.frame());
      }
    };
    document.addEventListener("visibilitychange", onVis);
    const onUnload = () => void this.save();
    window.addEventListener("pagehide", onUnload);
    const onResize = () => {
      this.engine.resize();
      this.orientation.refresh();
    };
    window.addEventListener("resize", onResize);
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObs = new ResizeObserver(onResize);
      this.resizeObs.observe(this.opts.container);
    }
    const lost = this.engine.onContextLostObservable.add(() => {
      this.hud.toast("Graphics context lost — recovering…", "warn");
      this.emit({ type: "contextLost" });
    });
    const restored = this.engine.onContextRestoredObservable.add(() => this.hud.toast("Graphics restored", "good"));
    this.cleanup.push(() => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", onUnload);
      window.removeEventListener("resize", onResize);
      this.resizeObs?.disconnect();
      this.engine.onContextLostObservable.remove(lost);
      this.engine.onContextRestoredObservable.remove(restored);
    });
  }

  // ------------------------------------------------------------------ start / save

  async start(save: SaveData | null): Promise<void> {
    // Fullscreen / orientation requests must run inside the tap that started the game.
    void this.orientation.enter();
    const data = save ?? newGameSave();
    if (!save) data.settings = { ...this.settings };
    if (data.universe.planet !== this.planetId) this.swapPlanet(data.universe.planet, data.depleted, data.partial);
    this.applySave(data);
    this.hud.hideTitle();
    this.hud.root.classList.remove("title");
    this.orientation.refresh();
    if (!this.mission.state.runId) {
      try {
        const r = await this.backend.startMission(INTRO_MISSION_ID);
        this.mission.start(r.runId);
      } catch {
        this.mission.start(`local-${Date.now().toString(36)}`);
        this.hud.toast("Could not reach OrbitBtc servers — playing offline.", "warn");
      }
    }
    this.hud.toast(save ? "Welcome back, surveyor." : `Docked at ${WORLD.station.name}. ${this.input.touchActive ? "Tap Thr+ or Up" : "Press Space"} to launch.`, "good");
    void this.save();
    void this.retryPendingSubmission();
  }

  private applySave(s: SaveData): void {
    this.settings = { ...s.settings };
    this.levels = { ...s.upgrades };
    this.stats = deriveStats(this.levels);
    this.inventory = new Inventory(this.stats.cargoCapacity, s.inventory);
    this.laser = new MiningLaserState(this.stats.laser);
    this.player.maxJetFuel = this.stats.maxJetFuel;
    this.player.jetFuel = this.stats.maxJetFuel;
    this.player.jetThrust = this.stats.jetThrust;
    this.ship.maxHull = this.stats.maxHull;
    this.ship.hull = Math.min(this.stats.maxHull, s.ship.hull);
    this.mission = new IntroMission(s.mission);
    this.discovered = new Set(s.discoveredPois);
    this.looted = new Set(s.lootedPois);
    this.depletedAll = { ...s.depleted };
    this.partialAll = { ...s.partial };
    this.applyDepositState();
    this.progression = new Progression(s.progression);
    this.contracts = new ContractBoard(s.contracts);
    this.farm = JSON.parse(JSON.stringify(s.farm));
    this.arrivals = new Set(s.universe.arrivals);
    this.ship.speedScale = this.stats.speedScale;
    this.suit.reset();
    this.onStatsChanged();
    this.applyShipLook();

    if (s.ship.state === "landed") this.ship.placeLanded(this.shipEnv, s.ship.x, s.ship.z, s.ship.yaw);
    else this.ship.placeDocked(this.shipEnv);
    this.syncShipModel(0);

    if (s.mode === "onFoot" && this.ship.state === "landed") {
      this.player.place(s.player.x, s.player.z, this.planet, s.player.yaw);
      this.enterFoot(false);
    } else {
      this.enterShip(false);
    }
    this.rig.yaw = this.ship.yaw;
    this.lastStep = this.mission.step;
    this.refreshMissionHud();
  }

  snapshot(): SaveData {
    this.captureDeposits();
    const depleted: Record<string, number> = { ...this.depletedAll };
    const partial: Record<string, number> = { ...this.partialAll };
    const shipState = this.ship.state === "landed" ? "landed" : this.ship.state === "docked" ? "docked" : "flying";
    return {
      version: newGameSave().version,
      savedAt: Date.now(),
      mode: this.mode === "onFoot" ? "onFoot" : "inShip",
      player: { x: this.player.position.x, y: this.player.position.y, z: this.player.position.z, yaw: this.player.facing },
      ship: { x: this.ship.x, y: this.ship.y, z: this.ship.z, yaw: this.ship.yaw, hull: this.ship.hull, state: shipState },
      inventory: this.inventory.snapshot(),
      upgrades: { ...this.levels },
      mission: JSON.parse(JSON.stringify(this.mission.state)),
      depleted,
      partial,
      discoveredPois: [...this.discovered],
      lootedPois: [...this.looted],
      settings: { ...this.settings },
      universe: { planet: this.planetId, arrivals: [...this.arrivals] },
      progression: JSON.parse(JSON.stringify(this.progression.state)),
      contracts: JSON.parse(JSON.stringify(this.contracts.state)),
      farm: JSON.parse(JSON.stringify(this.farm)),
    };
  }

  async save(): Promise<void> {
    if (this.mode === "title" || !this.planet) return;
    try {
      const s = this.snapshot();
      await this.saveAdapter.save(this.slot, s);
      this.emit({ type: "saved", at: s.savedAt });
    } catch (e) {
      this.emit({ type: "error", message: `save failed: ${String(e)}` });
    }
  }

  // ------------------------------------------------------------------ modes

  private enterFoot(announce = true): void {
    this.mode = "onFoot";
    this.player.model.setVisible(true);
    this.input.setMode("foot");
    this.hud.setMode("foot");
    this.shipCollider.x = this.ship.x;
    this.shipCollider.z = this.ship.z;
    this.shipCollider.top = this.ship.y + 0.4;
    this.player.extraColliders = [this.shipCollider];
    this.rig.pitch = 0.2;
    this.rig.updateFoot(0, this.player.position, this.planet, true);
    if (announce) this.missionEvent({ type: "disembarked" });
  }

  private enterShip(announce = true): void {
    this.mode = "ship";
    this.player.model.setVisible(false);
    this.player.extraColliders = [];
    this.input.setMode("ship");
    this.hud.setMode(this.ship.state === "flying" ? "flight" : "parked");
    this.beam.hide();
    if (announce) this.missionEvent({ type: "boarded" });
  }

  private disembark(): void {
    const yaw = this.ship.yaw;
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    // Try left side, then right, then behind.
    const spots = [
      [-rx * 7.5, -rz * 7.5],
      [rx * 7.5, rz * 7.5],
      [-Math.sin(yaw) * 9, -Math.cos(yaw) * 9],
    ];
    let px = this.ship.x + spots[0][0], pz = this.ship.z + spots[0][1];
    for (const [ox, oz] of spots) {
      const x = this.ship.x + ox, z = this.ship.z + oz;
      if (this.planet.normalYAt(x, z) > 0.7 && this.planet.groundAt(x, z) > WORLD.liquidLevel) {
        px = x;
        pz = z;
        break;
      }
    }
    this.player.place(px, pz, this.planet, yaw);
    this.rig.yaw = yaw;
    this.enterFoot(true);
    void this.save();
  }

  // ------------------------------------------------------------------ frame

  private frame(): void {
    if (this.disposed) return;
    if (this.perfRec.isRecording) this.perfFrame(this.engine.getDeltaTime());
    const raw = this.engine.getDeltaTime() / 1000;
    const dt = Math.min(0.05 * this.timeScale, Math.max(0, raw) * this.timeScale) || 0.016;
    try {
      this.update(dt);
    } catch (e) {
      this.emit({ type: "error", message: String((e as Error)?.stack ?? e) });
      console.error(e);
    }
    this.scene.render();
  }

  private update(dt: number): void {
    let input = this.input.consume(dt);
    this.planet.update(dt, this.rig.camera.position);
    this.materials.update(dt);
    this.updateWind(dt);
    this.station.update(dt);
    this.pulse.update(dt);

    if (this.mode === "title") {
      this.titleT += dt;
      this.rig.yaw = 2.6 + this.titleT * 0.05;
      this.rig.pitch = -0.05;
      this.rig.updateOrbit(dt, new Vector3(this.ship.x, this.ship.y + 2, this.ship.z), 34, this.planet, true);
      this.syncShipModel(dt);
      return;
    }

    if (this.warp) {
      this.updateWarp(dt);
      input = blankInput(input);
    }

    // Panels / menus
    if (input.mapPressed && !this.warp) {
      if (this.hud.panel === "starmap") this.closePanel();
      else this.openPanel("starmap");
    }
    if (input.contractsPressed) {
      if (this.hud.panel === "frontier") this.closePanel();
      else this.openPanel("frontier");
    }
    if (input.menuPressed) {
      if (this.hud.panel) this.closePanel();
      else this.openPanel("settings");
    }
    if (input.inventoryPressed) {
      if (this.hud.panel === "inventory") this.closePanel();
      else this.openPanel("inventory");
    }
    const uiOpen = this.hud.panel !== null;
    if (uiOpen && input.interactPressed) {
      this.closePanel();
      input.interactPressed = false;
    }

    if (this.mode === "onFoot") this.updateFoot(dt, uiOpen ? blankInput(input) : input);
    else this.updateShip(dt, uiOpen ? blankInput(input) : input);

    this.updateCombat(dt, uiOpen ? blankInput(input) : input);
    this.space?.update(dt, this.rig.camera.position);
    this.warpFx.update(dt);
    this.keepCameraOutsideStation();
    this.updateShadowFocus();
    this.updateWorldTimers(dt);
    this.updateHud(dt);

    this.updateEffects(input);
    for (const note of this.renderer.tick(dt)) this.toastOnce(`gov-${note}`, note, "info", 30);
  }

  // ------------------------------------------------------------------ on foot

  private updateFoot(dt: number, input: InputFrame): void {
    this.updateSuit(dt, false);
    if (this.mode !== "onFoot") return;
    this.rig.look(input.lookX, input.lookY);
    if (input.zoom) this.rig.zoom(input.zoom, 3, 12);
    const aiming = input.fire && !this.laser.overheated;
    const moved = this.player.update(dt, input, this.rig.yaw, this.planet, aiming, this.rig.pitch);
    if (moved > 0) this.missionEvent({ type: "distance", mode: "foot", metres: moved });
    this.rig.updateFoot(dt, this.player.position, this.planet);

    // Scanner
    this.scanCooldown = Math.max(0, this.scanCooldown - dt);
    if (input.scanPressed) this.scan();

    // Mining
    const target = this.findMiningTarget(input.touch);
    this.currentTarget = target;
    const tick = this.laser.update(dt, input.fire, !!target);
    if (tick.justOverheated) this.toastOnce("overheat", "Laser overheated — venting", "warn");
    if (tick.outOfEnergy) this.toastOnce("energy", "Laser energy depleted — recharging", "warn");
    if (tick.firing) {
      const muzzle = this.player.model.muzzle.getAbsolutePosition();
      const end = target ? this.targetPoint(target, muzzle) : this.freeAimPoint(muzzle);
      this.beam.show(muzzle, end, !!target, this.laser.heatRatio, target ? RESOURCES[target.type].rgb : [1, 0.8, 0.6]);
      if (target && tick.extracted > 0) this.mine(target, tick.extracted);
    } else this.beam.hide();

    // Target readout
    if (target) {
      this.hud.setTarget(`${RESOURCES[target.type].name} · ${Math.ceil(target.amount)} left`, target.amount / target.max, true);
    } else this.hud.setTarget(null);

    // Interactions
    const prompt = this.footInteraction();
    if (prompt) {
      this.hud.setPrompt(input.touch ? null : "E", prompt.text);
      this.input.setInteractLabel(prompt.short);
      if (input.interactPressed) prompt.run();
    } else {
      this.hud.setPrompt(null, null);
      this.input.setInteractLabel(null);
    }
  }

  private footInteraction(): { text: string; short: string; run: () => void } | null {
    const p = this.player.position;
    // Boarding range must exceed the exit distance (7.5-9 m, see disembark): with a strict "< 7.5" the player stepped out
    // exactly on the boundary and the Board prompt only appeared if physics happened to nudge them closer.
    if (this.ship.state === "landed" && Math.hypot(p.x - this.ship.x, p.z - this.ship.z) < 10) {
      return { text: `Board the ${WORLD.shipName}`, short: "Board", run: () => this.enterShip(true) };
    }
    for (const poi of this.planet.pois) {
      if (Vector3.Distance(p, poi.position) < 7) {
        if (!this.discovered.has(poi.id)) this.discover(poi);
        if (!this.looted.has(poi.id)) return { text: `Inspect ${poi.name}`, short: "Inspect", run: () => this.inspect(poi) };
      }
    }
    return null;
  }

  private discover(poi: PointOfInterest): void {
    if (this.discovered.has(poi.id)) return;
    this.discovered.add(poi.id);
    this.hud.toast(`Discovered: ${poi.name}`, "good");
  }

  private inspect(poi: PointOfInterest): void {
    if (this.looted.has(poi.id)) return;
    this.looted.add(poi.id);
    this.hud.toast(poi.lore, "info");
    const parts: string[] = [];
    for (const [id, n] of Object.entries(poi.loot) as [ResourceId, number][]) {
      const got = this.inventory.add(id, n);
      if (got > 0) {
        parts.push(`+${got} ${RESOURCES[id].name}`);
        this.missionEvent({ type: "collected", resource: id, amount: got });
        this.contractEvent({ type: "collected", planet: this.planetId, resource: id, amount: got });
      }
    }
    this.progress({ type: "inspect" });
    this.contractEvent({ type: "inspected", planet: this.planetId, poiKind: ((poi as unknown as { kind?: PoiKind }).kind ?? "monolith") as PoiKind });
    if (parts.length) setTimeout(() => this.hud.toast(parts.join(" · "), "good"), 600);
    void this.save();
  }

  private scan(): void {
    if (this.scanCooldown > 0) {
      this.toastOnce("scancd", "Scanner recharging", "info", 1);
      return;
    }
    this.scanCooldown = 3;
    const origin = this.player.position;
    const r = this.stats.scanRadius;
    this.pulse.start(origin, r);
    const until = performance.now() + 35000;
    let found = 0;
    for (const d of this.planet.deposits) {
      if (d.amount <= 0 || d.depletedAt !== null) continue;
      if (Vector3.DistanceSquared(origin, d.position) <= r * r) {
        this.tagged.set(d.id, until);
        found++;
      }
    }
    for (const poi of this.planet.pois) if (Vector3.Distance(origin, poi.position) <= r) this.discover(poi);
    this.hud.toast(found ? `Scan complete: ${found} mineral signatures within ${r} m` : "Scan complete: no signatures nearby", found ? "good" : "info");
    this.missionEvent({ type: "scanned", found });
    this.progress({ type: "scan", planet: this.planetId, found });
    this.contractEvent({ type: "scanned", planet: this.planetId, found });
  }

  private findMiningTarget(touch: boolean): Deposit | null {
    const range = this.laser.stats.range;
    const chest = this.player.position.add(new Vector3(0, 1.3, 0));
    const cam = this.rig.camera.position;
    const dir = this.rig.forward;
    let best: Deposit | null = null;
    let bestT = Infinity;
    for (const d of this.planet.deposits) {
      if (d.amount <= 0 || d.depletedAt !== null) continue;
      if (Vector3.DistanceSquared(chest, d.position) > (range + d.radius) ** 2) continue;
      // Ray-sphere (slightly inflated for comfort).
      const r = d.radius * 1.25;
      const oc = cam.subtract(d.position);
      const b = Vector3.Dot(oc, dir);
      const c = Vector3.Dot(oc, oc) - r * r;
      const disc = b * b - c;
      if (disc < 0) continue;
      const t = -b - Math.sqrt(disc);
      if (t > 0 && t < bestT) {
        bestT = t;
        best = d;
      }
    }
    if (best || !touch) return best;
    // Touch assist: nearest deposit in front of the player within 10 m.
    let bestD = 10;
    const fx = Math.sin(this.rig.yaw), fz = Math.cos(this.rig.yaw);
    for (const d of this.planet.deposits) {
      if (d.amount <= 0 || d.depletedAt !== null) continue;
      const dx = d.position.x - chest.x, dz = d.position.z - chest.z;
      const dist = Math.hypot(dx, dz) - d.radius;
      if (dist > bestD) continue;
      if ((dx * fx + dz * fz) / Math.max(0.01, Math.hypot(dx, dz)) < 0.35) continue;
      bestD = dist;
      best = d;
    }
    return best;
  }

  private targetPoint(d: Deposit, from: Vector3): Vector3 {
    const dir = d.position.subtract(from);
    const len = dir.length();
    return from.add(dir.scale(Math.max(0, len - d.radius * 0.6) / Math.max(len, 1e-3)));
  }

  private freeAimPoint(from: Vector3): Vector3 {
    const dir = this.rig.forward;
    const range = this.laser.stats.range;
    for (let t = 1; t <= range; t += 0.5) {
      const x = from.x + dir.x * t, y = from.y + dir.y * t, z = from.z + dir.z * t;
      if (y <= this.planet.groundAt(x, z)) return new Vector3(x, y, z);
    }
    return from.add(dir.scale(range));
  }

  private mine(d: Deposit, extracted: number): void {
    d.carry += extracted;
    const whole = Math.floor(d.carry);
    if (whole <= 0) return;
    const want = Math.min(whole, Math.ceil(d.amount));
    const stored = this.inventory.add(d.type, want);
    d.carry -= whole;
    if (stored < want) this.toastOnce("cargo", `Cargo full for ${RESOURCES[d.type].name} — install Cargo Lattice at the dock`, "warn", 5);
    if (stored <= 0) return;
    d.amount = Math.max(0, d.amount - stored);
    this.missionEvent({ type: "collected", resource: d.type, amount: stored });
    this.contractEvent({ type: "collected", planet: this.planetId, resource: d.type, amount: stored });
    if (d.amount <= 0) {
      d.depletedAt = Date.now();
      this.tagged.delete(d.id);
      this.hud.toast(`${RESOURCES[d.type].name} deposit depleted`, "info");
    }
    this.planet.refreshDeposit(d);
  }

  // ------------------------------------------------------------------ ship

  private updateShip(dt: number, input: InputFrame): void {
    this.updateSuit(dt, true);
    const s = this.ship;
    const env = this.shipEnv;
    let controls: ShipControls = { throttle: 0, yaw: 0, pitch: 0, lift: 0, boost: false, aimYaw: 0, aimPitch: 0 };

    if (s.state === "docked") {
      this.rig.look(input.lookX, input.lookY, -0.6, 1.0);
      this.rig.updateOrbit(dt, new Vector3(s.x, s.y + 1.5, s.z), 24, this.planet);
      const launch = input.jumpPressed || input.shipThrottle > 0.5 || input.lift > 0.5 || (input.shipThrottleTarget ?? 0) > 0.15;
      this.hud.setPrompt(input.touch ? null : "E", input.touch ? "Use: terminal · Thr+ to launch" : "Station terminal  ·  Space to launch");
      this.input.setInteractLabel("Terminal");
      if (input.interactPressed) this.openPanel("terminal");
      else if (launch) this.launch();
    } else if (s.state === "landed") {
      this.rig.look(input.lookX, input.lookY, -0.6, 1.0);
      this.rig.updateOrbit(dt, new Vector3(s.x, s.y + 1.5, s.z), 20, this.planet);
      this.hud.setPrompt(input.touch ? null : "E", input.touch ? "Use: exit ship · Up to take off" : "Exit ship  ·  Space to take off");
      this.input.setInteractLabel("Exit");
      if (input.interactPressed) {
        this.disembark();
        return;
      }
      if (input.jumpPressed || input.lift > 0.5) {
        s.requestTakeoff();
        this.hud.setMode("flight");
      }
    } else if (s.state === "flying") {
      controls = {
        throttle: input.shipThrottleTarget !== null ? clamp((input.shipThrottleTarget - s.throttle) * 6, -1, 1) : input.shipThrottle,
        yaw: input.shipYaw,
        pitch: input.shipPitch,
        lift: input.lift,
        boost: input.boost,
        aimYaw: input.lookX * 0.55,
        aimPitch: -input.lookY * 0.55,
      };
      const dock = s.canDock(env);
      const land = s.canLand(env);
      let text: string | null = null;
      let short: string | null = null;
      if (dock.ok) {
        text = "Dock at Halcyon";
        short = "Dock";
        if (input.interactPressed) s.requestDock(env);
      } else if (land.ok) {
        text = "Land here";
        short = "Land";
        if (input.interactPressed) s.requestLand(env);
      } else {
        const agl = s.agl(env);
        if (s.distanceToDock(env) < 140) text = dock.reason;
        else if (agl < 60) text = land.reason;
        if (input.interactPressed && text) this.hud.toast(text, "info");
        text = text ? `${text}` : null;
      }
      this.hud.setPrompt(short && !input.touch ? "E" : null, text);
      this.input.setInteractLabel(short);
    } else {
      this.hud.setPrompt(null, s.state === "docking" ? "Docking…" : s.state === "landing" ? "Landing…" : s.state === "undocking" ? "Undocking…" : "Lifting off…");
      this.input.setInteractLabel(null);
    }

    const ox = s.x, oy = s.y, oz = s.z;
    const events = s.update(dt, controls, env);
    const moved = Math.hypot(s.x - ox, s.y - oy, s.z - oz);
    if (moved > 0 && s.state === "flying") this.missionEvent({ type: "distance", mode: "flight", metres: moved });
    for (const e of events) this.onShipEvent(e);

    if (s.state !== "docked" && s.state !== "landed") {
      this.rig.updateChase(dt, new Vector3(s.x, s.y, s.z), s.yaw, s.pitch, this.planet);
    }
    this.syncShipModel(dt, input.boost);
    if (input.shipThrottleTarget === null) this.input.setThrottleDisplay(s.throttle);
  }

  private launch(): void {
    if (this.ship.requestUndock(this.shipEnv).ok) {
      this.closePanel();
      this.hud.setMode("flight");
      this.hud.toast(this.input.touchActive ? "Left stick steers · Thr± for speed · Up/Down for altitude" : "W/S throttle · mouse or A/D to steer · Space/C altitude · Shift boost", "info");
    }
  }

  private onShipEvent(e: ShipEvent): void {
    switch (e.type) {
      case "undocked":
        this.missionEvent({ type: "undocked" });
        break;
      case "landed":
        this.hud.setMode("parked");
        this.hud.toast(`Touchdown on ${this.planetDef.name}`, "good");
        this.missionEvent({ type: "landed" });
        this.contractEvent({ type: "landed", planet: this.planetId });
        void this.save();
        break;
      case "tookOff":
        this.missionEvent({ type: "tookOff" });
        break;
      case "docked":
        this.hud.setMode("parked");
        this.ship.hull = this.ship.maxHull;
        this.hud.toast(`Docked at ${WORLD.station.name}. Hull repaired.`, "good");
        this.missionEvent({ type: "docked" });
        this.contractEvent({ type: "docked" });
        void this.save();
        if (this.mission.step === "deliver") this.openPanel("terminal");
        break;
      case "impact":
        this.hud.toast(`Hull impact −${e.damage}`, "bad");
        break;
      case "boundary":
        this.hud.toast("Edge of the survey zone", "warn");
        break;
      case "destroyed":
        this.shipLost();
        break;
    }
  }

  private syncShipModel(dt: number, boosting = false): void {
    const s = this.ship;
    const gearTarget = s.state === "flying" ? 0 : 1;
    this.gear += (gearTarget - this.gear) * damp(3, dt || 1);
    const active = s.state !== "docked" && s.state !== "landed";
    const thr = s.state === "flying" ? Math.max(s.throttle, 0.15) : active ? 0.35 : 0;
    this.shipModel.setPose(s.x, s.y, s.z, s.yaw, s.pitch, s.roll);
    this.shipModel.animate(dt, thr, boosting, this.gear, active);
  }

  // ------------------------------------------------------------------ mission

  private missionEvent(e: GameplayEvent): void {
    // "First Light" is a Veyra-7 expedition: events on other worlds do not advance it.
    if (this.planetId !== "veyra7") return;
    const advanced = this.mission.handle(e);
    if (advanced || e.type === "collected") this.refreshMissionHud();
    if (advanced && this.mission.step !== this.lastStep) {
      this.lastStep = this.mission.step;
      this.emit({ type: "missionStep", step: this.mission.step });
      if (this.mission.step !== "complete") this.hud.toast(`Objective: ${this.mission.objective().title}`, "good");
      void this.save();
    }
  }

  private refreshMissionHud(): void {
    const i = MISSION_STEPS.indexOf(this.mission.step);
    this.hud.setMission(this.mission.objective(), i, MISSION_STEPS.length);
    this.hud.setContract(this.contracts.summary());
    this.hud.setMissionCollapsed(this.mission.isComplete);
  }

  private deliver(): void {
    if (this.mission.step !== "deliver") return;
    if (!this.inventory.spend(MISSION_REQUIREMENTS)) {
      this.hud.toast("Not enough samples to deliver", "warn");
      return;
    }
    this.missionEvent({ type: "delivered" });
    this.hud.showComplete(this.mission.state);
    void this.submitCompletion();
  }

  private async submitCompletion(): Promise<void> {
    if (this.submitting || !this.mission.isComplete) return;
    this.submitting = true;
    try {
      const report = buildCompletionReport(this.mission.state);
      const result = await this.backend.submitMissionCompletion(report);
      this.mission.state.submission = { status: result.status, message: result.message };
      this.hud.updateServerStatus(result.message ?? result.status);
      this.emit({ type: "missionComplete", result });
      await this.save();
    } catch (e) {
      this.mission.state.submission = { status: "error", message: "Report could not be sent; it will retry next session." };
      this.hud.updateServerStatus(this.mission.state.submission.message!);
    } finally {
      this.submitting = false;
    }
  }

  private async retryPendingSubmission(): Promise<void> {
    const sub = this.mission.state.submission;
    if (this.mission.isComplete && (!sub || sub.status === "error")) await this.submitCompletion();
  }

  // ------------------------------------------------------------------ panels & settings

  private openPanel(p: PanelId): void {
    this.input.setMode("ui");
    if (p === "inventory") this.hud.showInventory(this.inventory.snapshot(), this.inventory.capacity, this.levels);
    else if (p === "settings") this.hud.showSettings(this.settings, this.prefs, { ...this.tierDecision, platform: this.platform.kind }, this.backend.mode === "online" ? "OrbitBtc servers (online)" : "offline prototype");
    else if (p === "terminal") {
      if (this.ship.state !== "docked") return this.closePanel();
      this.hud.showTerminal(this.inventory.snapshot(), this.levels, this.mission.state, this.mission.step === "deliver" ? "expedition" : undefined);
    } else if (p === "complete") this.hud.showComplete(this.mission.state);
    else if (p === "starmap") this.openStarMap();
    else if (p === "frontier") this.openFrontier();
  }

  private closePanel(): void {
    this.hud.closePanel();
    this.input.setMode(this.mode === "onFoot" ? "foot" : this.mode === "ship" ? "ship" : "ui");
  }

  private bindHandlers(): void {
    this.hud.handlers = {
      onBuy: (id: UpgradeId) => this.buy(id),
      onDeliver: () => this.deliver(),
      onLaunch: () => this.launch(),
      onClosePanel: () => this.closePanel(),
      onOpenPanel: (p) => {
        if (this.mode !== "title") this.openPanel(p);
      },
      onSetting: (key, value) => {
        (this.settings as unknown as Record<string, unknown>)[key] = value;
        this.input.sensitivity = this.settings.lookSensitivity;
        this.input.invertY = this.settings.invertY;
        void this.save();
      },
      onDevicePref: (key, value) => {
        (this.prefs as unknown as Record<string, unknown>)[key] = value;
        saveDevicePrefs(this.prefs);
        if (key === "graphics" || key === "resolution" || key === "adaptive") {
          const before = this.tierDecision.tier;
          this.applyGraphics();
          if (key === "graphics" || before !== this.tierDecision.tier) this.hud.toast(`Graphics: ${PROFILES[this.tierDecision.tier].label}`, "good");
          if (this.hud.panel === "settings") this.openPanel("settings");
        }
      },
      onFullscreen: () => void this.orientation.enter(),
      onDismissRotate: () => this.orientation.dismissHint(),
      onResetSave: () => {
        void this.saveAdapter.clear(this.slot).then(() => {
          if (this.opts.requestRestart) this.opts.requestRestart();
          else location.reload();
        });
      },
    };
  }

  private buy(id: UpgradeId): void {
    const r = purchaseUpgrade(this.levels, id, this.inventory);
    if (!r.ok) {
      this.hud.toast(r.reason === "max" ? "Already at maximum" : "Not enough resources", "warn");
      return;
    }
    this.stats = deriveStats(this.levels);
    this.laser.setStats(this.stats.laser);
    this.inventory.setCapacity(this.stats.cargoCapacity);
    this.player.maxJetFuel = this.stats.maxJetFuel;
    this.player.jetThrust = this.stats.jetThrust;
    this.ship.maxHull = this.stats.maxHull;
    this.ship.hull = this.stats.maxHull;
    this.ship.speedScale = this.stats.speedScale;
    this.onStatsChanged();
    this.hud.toast(`${getUpgrade(id).name} installed (level ${r.level})`, "good");
    this.hud.showTerminal(this.inventory.snapshot(), this.levels, this.mission.state, "upgrades");
    void this.save();
  }

  private toastOnce(key: string, text: string, kind: "info" | "good" | "warn" | "bad", cooldownSec = 3): void {
    const now = performance.now();
    if ((this.lastToast[key] ?? 0) + cooldownSec * 1000 > now) return;
    this.lastToast[key] = now;
    this.hud.toast(text, kind);
  }

  // ------------------------------------------------------------------ world timers, shadows, hud

  private updateWorldTimers(dt: number): void {
    this.autosaveTimer += dt;
    if (this.autosaveTimer > 20) {
      this.autosaveTimer = 0;
      void this.save();
    }
    this.regrowTimer += dt;
    if (this.regrowTimer > 5) {
      this.regrowTimer = 0;
      const now = Date.now();
      for (const d of this.planet.deposits) if (d.depletedAt !== null && now - d.depletedAt > WORLD.depositRegrowMs) this.planet.regrow(d);
      const pn = performance.now();
      for (const [id, until] of this.tagged) if (until < pn) this.tagged.delete(id);
    }
  }

  /** Stop orbit/chase cameras from clipping into the station hull and ring. */
  private keepCameraOutsideStation(): void {
    if (!this.planetDef.hasStation) return;
    const c = this.rig.camera.position;
    const sc = WORLD.station.position;
    const min = WORLD.station.collisionRadius + 2;
    const dx = c.x - sc.x, dy = c.y - sc.y, dz = c.z - sc.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < min && d > 1e-3) {
      const k = min / d;
      c.set(sc.x + dx * k, sc.y + dy * k, sc.z + dz * k);
    }
  }

  private updateShadowFocus(): void {
    const focus = this.mode === "onFoot" ? this.player.position : new Vector3(this.ship.x, this.ship.y, this.ship.z);
    this.renderer.updateShadowFocus(focus);
  }

  /** Slowly veering wind with gusts: drives grass sway, dust and gust streaks. */
  private updateWind(dt: number): void {
    this.windT += dt;
    const t = this.windT;
    const a = 0.6 + Math.sin(t * 0.05) * 0.5;
    const strength = 0.75 + 0.45 * Math.sin(t * 0.37) * Math.sin(t * 0.13 + 1.1);
    WorldUniforms.wind.x = Math.cos(a);
    WorldUniforms.wind.y = Math.sin(a);
    WorldUniforms.wind.z = strength;
    this.gustiness = clamp((strength - 0.7) * 2.5, 0, 1);
  }

  private updateEffects(input: InputFrame): void {
    const cam = this.rig.camera.position;
    this.envFx.update(this.planet.groundAt(cam.x, cam.z), this.gustiness, this.mode === "onFoot");
    const s = this.ship;
    const f = s.forward();
    const active = s.state !== "docked" && s.state !== "landed";
    const thr = s.state === "flying" ? Math.max(s.throttle, 0.12) : active ? 0.35 : 0;
    this.shipFx.update(active, thr, input.boost && s.state === "flying", new Vector3(-f.x, -f.y, -f.z), this.planet.groundAt(s.x, s.z), s.y, s.x, s.z);
  }

  private project(p: Vector3): { x: number; y: number; behind: boolean } {
    const cam = this.rig.camera;
    const w = this.engine.getRenderWidth();
    const h = this.engine.getRenderHeight();
    const v = Vector3.Project(p, Matrix.IdentityReadOnly, this.scene.getTransformMatrix(), cam.viewport.toGlobal(w, h));
    const cw = this.canvas.clientWidth / w;
    const ch = this.canvas.clientHeight / h;
    const toP = p.subtract(cam.position);
    const behind = Vector3.Dot(toP, cam.getForwardRay(1).direction) <= 0;
    return { x: v.x * cw, y: v.y * ch, behind };
  }

  private updateHud(dt: number): void {
    void dt;
    const foot = this.mode === "onFoot";
    if (foot) this.hud.setBars(this.laser.energyRatio, this.laser.heatRatio, this.laser.overheated, this.player.jetFuel / this.player.maxJetFuel);
    else {
      const s = this.ship;
      const alt = s.state === "docked" ? s.y - this.planet.groundAt(s.x, s.z) : Math.max(0, s.agl(this.shipEnv));
      const status =
        s.state === "docked" ? `Docked · ${WORLD.station.name}` : s.state === "landed" ? `Landed · ${this.planetDef.name}` : s.state === "flying" ? (s.agl(this.shipEnv) < 18 && s.speed < 18 ? "Landing possible" : "In flight") : "Autopilot";
      this.hud.setShip(s.speed, alt, s.throttle, s.hull / s.maxHull, status);
    }
    this.hud.setResources(this.inventory.snapshot(), this.inventory.capacity);
    this.perfUi.setVisible(this.prefs.perfStats && this.mode !== "title");
    if (this.perfRec.isRecording) this.perfUi.setLive(`${Math.round(this.engine.getFps())} fps · ${Math.round(this.perfRec.seconds)}s`);
    else if (this.prefs.perfStats) this.perfUi.setLive(`${Math.round(this.engine.getFps())} fps`);
    if (this.prefs.perfStats) {
      const st = this.renderer.stats();
      this.hud.setPerf([
        `${PROFILES[st.tier].label}`,
        `${st.fps} fps · ${st.cpuFrameMs} ms cpu${st.gpuFrameMs !== null ? ` · ${st.gpuFrameMs} ms gpu` : ""}`,
        `${st.drawCalls} draws · ${Math.round(st.triangles / 1000)}k tris`,
        `scale ${Math.round(st.renderScale * 100)}% · tex ${st.textureMB} MB${st.jsHeapMB !== null ? ` · heap ${st.jsHeapMB} MB` : ""}`,
        ...(st.reductions.length ? [`reduced: ${st.reductions.join(", ")}`] : []),
      ]);
    } else this.hud.setFps(this.settings.showFps ? this.engine.getFps() : null);

    // Markers
    const markers: ScreenMarker[] = [];
    const camPos = this.rig.camera.position;
    const add = (id: string, pos: Vector3, label: string, color: string, waypoint = false, maxDist = Infinity) => {
      const dist = Vector3.Distance(camPos, pos);
      if (dist > maxDist) return;
      const s = this.project(pos);
      if (s.behind) return;
      if (s.x < -50 || s.y < -50 || s.x > this.canvas.clientWidth + 50 || s.y > this.canvas.clientHeight + 50) return;
      markers.push({ id, x: s.x, y: s.y, label, sub: dist < 1000 ? `${Math.round(dist)} m` : `${(dist / 1000).toFixed(1)} km`, color, waypoint });
    };
    if (foot) {
      const list: { d: Deposit; dist: number }[] = [];
      for (const id of this.tagged.keys()) {
        const d = this.planet.deposits.find((x) => x.id === id);
        if (d && d.amount > 0) list.push({ d, dist: Vector3.Distance(this.player.position, d.position) });
      }
      list.sort((a, b) => a.dist - b.dist);
      for (const { d } of list.slice(0, 14)) add(`dep-${d.id}`, d.position.add(new Vector3(0, d.radius + 0.6, 0)), RESOURCES[d.type].name, RESOURCES[d.type].color);
    }
    for (const poi of this.planet.pois) if (this.discovered.has(poi.id)) add(`poi-${poi.id}`, poi.position.add(new Vector3(0, 3.5, 0)), poi.name, this.looted.has(poi.id) ? "#a39cc8" : "#c9a6ff", false, 900);

    const wp = this.waypoint();
    if (wp) add("wp", wp.pos, wp.label, MISSION_WAYPOINT_COLOR, true);
    const cwp = this.contractWaypoint();
    if (cwp && (!wp || Vector3.Distance(wp.pos, cwp.pos) > 30)) add("cwp", cwp.pos, cwp.label, CONTRACT_WAYPOINT_COLOR, true);
    if (foot && this.ship.state === "landed" && (!wp || wp.label !== WORLD.shipName)) {
      const sp = new Vector3(this.ship.x, this.ship.y + 3, this.ship.z);
      if (Vector3.Distance(sp, this.player.position) > 20) add("ship", sp, WORLD.shipName, "#7fe3ff");
    }
    this.hud.setMarkers(markers);
    const cv = this.combat.hudView(this.ship.hull, this.ship.maxHull);
    this.combatHud.setVisible(this.mode === "ship" && this.ship.state === "flying" && !this.warp);
    this.combatHud.update(cv, (p) => this.project(new Vector3(p.x, p.y, p.z)), this.canvas.clientWidth, this.canvas.clientHeight);

    // Compass
    const yaw = this.mode === "ship" && this.ship.state === "flying" ? this.ship.yaw : this.rig.yaw;
    const cm: CompassMarker[] = [];
    const bearingTo = (p: Vector3) => Math.atan2(p.x - camPos.x, p.z - camPos.z);
    if (wp) cm.push({ bearing: bearingTo(wp.pos), color: MISSION_WAYPOINT_COLOR });
    if (cwp) cm.push({ bearing: bearingTo(cwp.pos), color: CONTRACT_WAYPOINT_COLOR });
    if (foot && this.ship.state === "landed") cm.push({ bearing: bearingTo(new Vector3(this.ship.x, 0, this.ship.z)), color: "#7fe3ff" });
    this.hud.setCompass(yaw, cm);
  }

  private waypoint(): { pos: Vector3; label: string } | null {
    if (this.planetId !== "veyra7") return null;
    const step = this.mission.step;
    const site = WORLD.surveySite;
    const pad = stationPadPosition();
    if (step === "land" && this.mode === "ship") return { pos: new Vector3(site.x, this.planet.groundAt(site.x, site.z) + 4, site.z), label: site.name };
    if (step === "takeoff" && this.mode === "onFoot") return { pos: new Vector3(this.ship.x, this.ship.y + 3, this.ship.z), label: WORLD.shipName };
    if (step === "dock" && this.mode === "ship" && this.ship.state !== "landed") return { pos: new Vector3(pad.x, pad.y + 4, pad.z), label: WORLD.station.name };
    if (step === "dock" && this.mode === "onFoot") return { pos: new Vector3(this.ship.x, this.ship.y + 3, this.ship.z), label: WORLD.shipName };
    if ((step === "scan" || step === "mine") && this.mode === "ship" && this.ship.state === "flying") return { pos: new Vector3(site.x, this.planet.groundAt(site.x, site.z) + 4, site.z), label: site.name };
    return null;
  }

  // ------------------------------------------------------------------ performance recorder (M7)

  private perfFrame(ms: number): void {
    if (!this.perfRec.frame(ms)) {
      this.finishPerfRecording();
      return;
    }
    this.perfSampleMs += ms;
    if (this.perfSampleMs >= 1000) {
      this.perfSampleMs = 0;
      const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      let thermal: number | null = null;
      try {
        const t = this.platform.android?.thermalStatus?.();
        if (typeof t === "number" && t >= 0) thermal = t;
      } catch {
        /* host without thermal API */
      }
      this.perfRec.sample({ heapMB: mem ? mem.usedJSHeapSize / 1048576 : null, renderScale: this.renderer.governor.scale, thermal });
    }
  }

  private finishPerfRecording(): void {
    if (!this.perfRec.isRecording && this.perfRec.frameCount === 0) return;
    this.perfRec.stop();
    this.perfUi.setRecording(false);
    this.perfReport = this.perfRec.report(this.perfContext());
    this.perfUi.showResult(this.perfReport);
  }

  private perfContext(): PerfContext {
    const st = this.renderer.stats();
    let nativeDevice: unknown;
    try {
      const raw = this.platform.android?.deviceInfo?.();
      if (raw) nativeDevice = JSON.parse(raw);
    } catch {
      nativeDevice = undefined;
    }
    const hostiles = this.combat.hostileCount;
    const activity = this.mode === "onFoot" ? "on foot" : this.ship.state === "flying" ? (hostiles > 0 ? `combat (${hostiles} hostile)` : "flight") : `ship ${this.ship.state}`;
    return {
      appVersion: CLIENT_VERSION,
      platform: this.platform.kind,
      tier: this.tierDecision.tier,
      tierReason: this.tierDecision.reason,
      adaptiveResolution: this.prefs.adaptive,
      resolutionPreference: this.prefs.resolution,
      devicePixelRatio: window.devicePixelRatio || 1,
      canvas: { width: this.engine.getRenderWidth(), height: this.engine.getRenderHeight() },
      gl: { renderer: this.caps.renderer, webgl2: this.caps.webgl2, maxTextureSize: this.caps.maxTextureSize },
      userAgent: navigator.userAgent,
      deviceMemoryGb: this.caps.deviceMemoryGb,
      cores: this.caps.cores,
      screen: { width: screen.width, height: screen.height },
      nativeDevice,
      planet: this.planetDef.name,
      scene: { meshes: this.scene.meshes.length, activeMeshes: st.activeMeshes, drawCalls: st.drawCalls, trianglesK: Math.round(st.triangles / 1000) },
      activity,
    };
  }

  // ------------------------------------------------------------------ universe (M4)

  /** Planet values the integration reads; tolerant of planets without the M4 extras. */
  private planetInfo(): { sky: SkyColors; lighting: WorldLighting; liquid: number; landingLiquid: number; hazardAt: (x: number, z: number) => number } {
    const p = this.planet as Planet & Partial<{ skyColors: SkyColors; lighting: WorldLighting; liquidLevel: number; landingLiquidLevel: number; hazardAt(x: number, z: number): number }>;
    const def = this.planetDef;
    return {
      sky: p.skyColors ?? SKY,
      lighting: p.lighting ?? { sun: def.sky.sunScale, ambient: def.sky.ambientScale, fog: def.sky.fogScale },
      liquid: p.liquidLevel ?? def.liquid.level,
      landingLiquid: p.landingLiquidLevel ?? def.liquid.level,
      hazardAt: (x, z) => (p.hazardAt ? p.hazardAt(x, z) : def.hazard.kind === "none" ? 0 : 0.5),
    };
  }

  private createPlanet(def: PlanetDef): Planet {
    return new (Planet as unknown as new (s: Scene, m: MaterialLibrary, d: PlanetDef) => Planet)(this.scene, this.materials, def);
  }

  /** Per-planet gameplay rules: landing liquid, bounds, gravity, station presence. */
  private bindPlanetGameplay(): void {
    const def = this.planetDef;
    const info = this.planetInfo();
    const env = this.shipEnv as { -readonly [K in keyof ShipEnvironment]: ShipEnvironment[K] };
    env.liquidLevel = info.landingLiquid;
    env.flightRadius = def.flightRadius;
    env.maxAltitude = def.maxAltitude;
    if (def.hasStation) {
      env.padPosition = stationPadPosition();
      env.stationCenter = WORLD.station.position;
      env.stationRadius = WORLD.station.collisionRadius;
    } else {
      // No dock on this world: park the docking target far outside the flight volume.
      env.padPosition = { x: 0, y: -1e5, z: 0 };
      env.stationCenter = { x: 0, y: -1e5, z: 0 };
      env.stationRadius = 0;
    }
    this.station.root.setEnabled(def.hasStation);
    this.player.liquidLevel = info.liquid;
    this.player.gravity = def.gravity;
    this.player.walkRadius = def.walkRadius;
  }

  /** Replaces the current planet in the live scene (no reload). */
  private swapPlanet(id: PlanetId, depleted?: Record<string, number>, partial?: Record<string, number>): void {
    if (this.planetId === id && this.planet) return;
    this.captureDeposits();
    if (depleted) this.depletedAll = { ...depleted };
    if (partial) this.partialAll = { ...partial };
    this.tagged.clear();
    this.currentTarget = null;
    this.beam.hide();
    // Lights first (see Planet.releaseLights): otherwise meshes disposed below keep the old sun alive.
    this.renderer.releaseWorld();
    this.planet.releaseLights();
    this.onLeavePlanet();
    this.planet.dispose();
    this.planetDef = getPlanet(id);
    this.planet = this.createPlanet(this.planetDef);
    sunVector(this.planet.sunDirection);
    const info = this.planetInfo();
    this.renderer.setWorld({
      sun: this.planet.sun,
      ambient: this.planet.ambient,
      skyMesh: this.planet.sky.mesh,
      sky: { zenith: info.sky.zenith, horizon: info.sky.horizon, ground: info.sky.ground, sun: info.sky.sun, sunDir: this.planet.sunDirection },
      lighting: info.lighting,
    });
    this.renderer.governor.enabled = this.prefs.adaptive;
    this.bindPlanetGameplay();
    this.applyDepositState();
    this.onEnterPlanet();
  }

  /** Hook for systems that live per planet (combat, weather, space). */
  private onLeavePlanet(): void {
    this.combat.clear();
    this.combat.setPatrols(null);
    this.space?.dispose();
    this.space = null;
  }

  private onEnterPlanet(): void {
    const def = this.planetDef;
    // Planet weather (snow, blizzard, ash, spores, storms) is owned by the planet and capped per graphics tier.
    this.planet.createWeather(this.rig.camera, this.particleTex);
    this.planet.weather?.setBudget(this.currentProfile().weatherParticles);
    this.combat.setPatrols(def.encounters.patrolInterval > 0 ? def.encounters : null, def.danger, upgradeSum(this.levels));
    // Orbital belt: dense around Halcyon Dock, a sparse high-altitude field elsewhere.
    const prof = this.currentProfile();
    const st = WORLD.station.position;
    const opts = def.hasStation
      ? { seed: def.seed ^ 0xa57, center: { x: st.x, y: st.y, z: st.z }, radius: 520, altitude: st.y, count: 0, keepOut: [{ x: st.x, y: st.y, z: st.z, r: 120 }], tier: prof.tier }
      : { seed: def.seed ^ 0xa57, center: { x: 0, y: def.maxAltitude * 0.85, z: 0 }, radius: def.flightRadius * 0.95, altitude: def.maxAltitude * 0.85, count: 16, innerRadius: def.flightRadius * 0.35, tier: prof.tier };
    try {
      this.space = new SpaceEnvironment(this.scene, opts);
      this.space.setDetail(prof.tier, prof);
    } catch (e) {
      this.space = null;
      console.warn("space environment unavailable", e);
    }
  }

  private onStatsChanged(): void {
    const st = this.stats;
    this.combat.setPlayerStats({
      maxShield: st.shield.max,
      shieldRegen: st.shield.regenPerSec,
      shieldDelay: st.shield.regenDelay,
      weaponDamage: DEFAULT_PLAYER_STATS.weaponDamage * st.weapon.damageScale,
      fireInterval: DEFAULT_PLAYER_STATS.fireInterval * st.weapon.intervalScale,
    });
    this.combat.playerShield = Math.min(this.combat.playerShield, st.shield.max);
  }

  /** The Wayfarer is "protected" (cannot be shot, cannot shoot) outside free flight. */
  private combatProtected(): boolean {
    return this.warp !== null || this.ship.state !== "flying" || this.mode !== "ship";
  }

  private updateCombat(dt: number, input: InputFrame): void {
    const s = this.ship;
    const prot = this.combatProtected();
    // Contracts decide which encounters appear (first contact, waves, ambush, boss).
    if (!prot) {
      const enc = this.contracts.pendingSpawn(this.planetId, true);
      if (enc) this.spawnContractEncounter(enc);
    }
    const f = s.forward();
    const events = this.combat.update(
      dt,
      { x: s.x, y: s.y, z: s.z, vx: f.x * s.speed, vy: f.y * s.speed, vz: f.z * s.speed, forward: f, alive: s.hull > 0, protected: prot },
      { fire: !prot && input.fire, cycleTarget: !prot && input.targetPressed, aimDir: f },
      { groundAt: (x, z) => this.planet.groundAt(x, z), flightRadius: this.planetDef.flightRadius, maxAltitude: this.planetDef.maxAltitude },
    );
    if (events.length) this.handleCombatEvents(events);
    this.combatRenderer.sync(this.combat, dt, this.rig.camera.position);
    if (events.length) this.combatRenderer.onEvents(events);
    this.shipModel.setShieldLevel(this.combat.playerMaxShield > 0 ? this.combat.playerShield / this.combat.playerMaxShield : 0);
    const hr = s.hull / Math.max(1, s.maxHull);
    if (Math.abs(hr - this.lastHullRatio) > 0.01) {
      this.lastHullRatio = hr;
      this.shipModel.setDamage(hr);
    }
  }

  private despawnEncounterById(defId: string): void {
    for (const inst of [...this.combat.encounters()]) if (inst.def.id === defId) this.combat.despawnEncounter(inst.id);
  }

  private spawnContractEncounter(id: string): void {
    const s = this.ship;
    const around = { x: s.x, y: s.y, z: s.z };
    const opts = { difficulty: this.planetDef.danger, upgradeLevels: upgradeSum(this.levels) };
    if (id === "escort_ambush") {
      const f = s.forward();
      const start = { x: s.x + f.x * 160, y: Math.max(s.y, this.planet.groundAt(s.x, s.z) + 120), z: s.z + f.z * 160 };
      const path = [1, 2, 3].map((k) => ({ x: start.x + f.x * 380 * k, y: start.y, z: start.z + f.z * 380 * k }));
      this.combat.removeAlly("freighter");
      this.combat.addAlly({ id: "freighter", kind: "freighter", position: start, path, hull: 320, shield: 140, name: "Lantern freighter" });
      this.combat.spawnEncounter(id, start, opts);
    } else if (id.startsWith("station_defense")) {
      const st = WORLD.station.position;
      if (!this.combat.ally("halcyon")) this.combat.addAlly({ id: "halcyon", kind: "station", position: { x: st.x, y: st.y, z: st.z }, hull: 1800, shield: 700, name: "Halcyon Dock" });
      this.combat.spawnEncounter(id, { x: st.x, y: st.y, z: st.z }, opts);
    } else this.combat.spawnEncounter(id, around, opts);
    this.contracts.markSpawned();
    this.hud.toast(id === "dreadnought_boss" ? "Warning: capital-class signature closing" : "Hostile contacts on scope", "warn");
  }

  private handleCombatEvents(events: CombatEvent[]): void {
    const pid = this.planetId;
    for (const e of events) {
      switch (e.type) {
        case "playerFired":
          this.combatStats.shots++;
          this.shipModel.muzzleFlash(e.gun);
          break;
        case "playerShieldHit":
          this.shipModel.shieldHit(new Vector3(e.point.x, e.point.y, e.point.z), Math.min(1, e.absorbed / 20));
          break;
        case "playerShieldDown":
          this.toastOnce("shielddown", "Shields down!", "bad", 4);
          break;
        case "playerHullDamage":
          this.ship.hull = Math.max(0, this.ship.hull - e.amount);
          this.hud.toast(`Hull −${Math.round(e.amount)}`, "bad");
          this.hud.flashDamage(Math.min(1, e.amount / 25));
          break;
        case "enemyHit":
        case "enemyShieldHit":
          this.combatStats.hits++;
          break;
        case "enemyDestroyed": {
          this.combatStats.kills++;
          const parts: string[] = [];
          for (const [id, n] of Object.entries(e.loot) as [ResourceId, number][]) {
            const got = this.inventory.add(id, n);
            if (got > 0) parts.push(`+${got} ${RESOURCES[id].name}`);
          }
          this.hud.toast(`${ENEMY_TYPES[e.enemyType].name} destroyed${parts.length ? ` · ${parts.join(" · ")}` : ""} · +${e.xp} XP`, "good");
          this.progress({ type: "xp", amount: e.xp });
          this.progress({ type: "kill", enemy: e.enemyType });
          this.contractEvent({ type: "destroyed", planet: pid, enemy: e.enemyType });
          break;
        }
        case "aiStateChanged":
          this.aiLog.push({ id: e.id, from: e.from, to: e.to });
          if (this.aiLog.length > 64) this.aiLog.shift();
          break;
        case "hardpointDestroyed":
          this.progress({ type: "xp", amount: e.xp });
          this.hud.toast(`Weapon hardpoint destroyed (+${e.xp} XP)`, "good");
          break;
        case "bossPhase":
          this.hud.toast(`Dreadnought phase ${e.phase}`, "warn");
          break;
        case "bossLaunch":
          this.hud.toast("The dreadnought launches fighters!", "bad");
          break;
        case "targetLocked":
          this.toastOnce("lock", "Target locked", "info", 2);
          break;
        case "allyDestroyed":
          this.hud.toast("Allied vessel destroyed", "bad");
          {
            const o = this.contracts.objective;
            const enc = o && (o.kind === "escort" || o.kind === "clear") ? o.encounter : "";
            this.contractEvent({ type: "allyLost", encounter: enc });
            // The objective restarts with a fresh ambush: remove what is left of the old one so waves do not stack.
            if (o && o.kind === "escort") this.despawnEncounterById(o.encounter);
          }
          break;
        case "encounterCleared": {
          // An escort is only won with the escortee alive, whatever happened to it (never reward a dead freighter).
          const o = this.contracts.objective;
          if (o && o.kind === "escort" && o.encounter === e.encounter && !this.combat.allies().some((a) => a.kind === "freighter" && a.alive)) {
            this.contractEvent({ type: "allyLost", encounter: o.encounter });
            this.despawnEncounterById(o.encounter);
            break;
          }
          this.hud.toast("Area clear", "good");
          this.contractEvent({ type: "cleared", planet: pid, encounter: e.encounter });
          break;
        }
      }
    }
    if (this.ship.hull <= 0 && this.ship.state === "flying") this.onShipEvent({ type: "destroyed" });
  }

  private applyDepositState(): void {
    const now = Date.now();
    for (const d of this.planet.deposits) {
      const dep = this.depletedAll[d.id];
      if (dep !== undefined && now - dep < WORLD.depositRegrowMs) {
        d.amount = 0;
        d.depletedAt = dep;
      } else if (this.partialAll[d.id] !== undefined) {
        d.amount = Math.max(1, Math.round(d.max * clamp(this.partialAll[d.id], 0, 1)));
        d.depletedAt = null;
      } else {
        d.amount = d.max;
        d.depletedAt = null;
      }
      this.planet.refreshDeposit(d);
    }
  }

  /** Writes the current planet's deposit state into the system-wide maps. */
  private captureDeposits(): void {
    if (!this.planet) return;
    for (const d of this.planet.deposits) {
      delete this.depletedAll[d.id];
      delete this.partialAll[d.id];
      if (d.depletedAt !== null) this.depletedAll[d.id] = d.depletedAt;
      else if (d.amount < d.max) this.partialAll[d.id] = d.amount / d.max;
    }
  }

  canWarp(): { ok: boolean; reason?: string } {
    if (this.warp) return { ok: false, reason: "Warp in progress" };
    if (this.mode !== "ship") return { ok: false, reason: "Board the Wayfarer to use the warp drive." };
    const st = this.ship.state;
    if (st === "landed") return { ok: false, reason: "Take off before warping." };
    if (st !== "flying" && st !== "docked") return { ok: false, reason: "Wait for the autopilot to finish." };
    const blocked = this.warpBlockedReason();
    if (blocked) return { ok: false, reason: blocked };
    return { ok: true };
  }

  /** Extra warp interlocks (combat). */
  private warpBlockedReason(): string | null {
    const s = this.ship;
    const near = this.combat.enemies().some((e) => e.alive && ["detect", "pursue", "attack"].includes(e.state) && Math.hypot(e.pos.x - s.x, e.pos.y - s.y, e.pos.z - s.z) < 700);
    return near ? "Warp drive offline: hostile ships are on your tail. Destroy or outrun them first." : null;
  }

  startWarp(target: PlanetId): boolean {
    if (target === this.planetId || !PLANET_IDS.includes(target)) return false;
    const ok = this.canWarp();
    if (!ok.ok) {
      this.hud.toast(ok.reason ?? "Cannot warp now", "warn");
      return false;
    }
    this.closePanel();
    this.warp = { from: this.planetId, target, t: 0, phase: "spool", swapped: false, fromDock: this.ship.state === "docked" };
    this.hud.setWarp("spool", `Warp · ${getPlanet(target).name}`, "Spooling drive");
    this.hud.setMode("flight");
    return true;
  }

  private updateWarp(dt: number): void {
    const w = this.warp!;
    w.t += dt;
    const s = this.ship;
    if (w.phase === "spool") {
      if (s.state === "flying") s.throttle = Math.min(1, s.throttle + dt);
      this.onWarpPhase("spool", Math.min(1, w.t / WARP_SPOOL));
      if (w.t >= WARP_SPOOL) {
        w.phase = "tunnel";
        w.t = 0;
        this.hud.setWarp("tunnel", `Warp · ${getPlanet(w.target).name}`, "In transit");
      }
      return;
    }
    if (w.phase === "tunnel") {
      this.onWarpPhase("tunnel", Math.min(1, w.t / WARP_TUNNEL));
      if (!w.swapped && w.t > 0.05) {
        w.swapped = true;
        this.arriveAt(w.target);
      }
      if (w.t >= WARP_TUNNEL) {
        w.phase = "exit";
        w.t = 0;
        this.hud.setWarp("flash", getPlanet(w.target).name, getPlanet(w.target).tagline);
      }
      return;
    }
    this.onWarpPhase("exit", Math.min(1, w.t / WARP_EXIT));
    if (w.t >= WARP_EXIT) {
      const from = w.from;
      this.warp = null;
      this.hud.setWarp(null);
      this.onWarpPhase("idle", 0);
      this.onArrived(from);
    }
  }

  /** Visual hook for the warp effect (graphics integration). */
  private onWarpPhase(phase: "idle" | "spool" | "tunnel" | "exit", t: number): void {
    this.warpFx.setPhase(phase, t);
  }

  /** Swaps the world and drops the ship out of warp at the planet's arrival point. */
  private arriveAt(id: PlanetId): void {
    this.swapPlanet(id);
    const a = this.planetDef.arrival;
    this.ship.placeFlying(a.x, a.y, a.z, a.yaw, 45);
    this.rig.yaw = a.yaw;
    this.hud.setMode("flight");
    this.syncShipModel(0);
  }

  private onArrived(from: PlanetId): void {
    const id = this.planetId;
    this.emit({ type: "warp", from, to: id });
    this.progress({ type: "warp" });
    this.progress({ type: "visit", planet: id });
    this.hud.toast(`Arrived at ${this.planetDef.name} — ${this.planetDef.tagline}`, "good");
    if (this.planetDef.hazard.kind !== "none") setTimeout(() => this.hud.toast(`Surface hazard: ${this.planetDef.hazard.label}. Watch your suit integrity.`, "warn"), 1800);
    this.contractEvent({ type: "arrived", planet: id });
    const first = !this.arrivals.has(id);
    this.arrivals.add(id);
    this.onFirstArrival(first);
    this.refreshMissionHud();
    void this.save();
  }

  /** Combat integration spawns arrival encounters here. */
  private onFirstArrival(first: boolean): void {
    const table = this.planetDef.encounters;
    if (!first || !table.arrival || this.contracts.pendingSpawn(this.planetId, true)) return;
    const s = this.ship;
    this.combat.spawnArrival(table, { x: s.x, y: s.y, z: s.z }, this.planetDef.danger, upgradeSum(this.levels));
  }

  private updateSuit(dt: number, sheltered: boolean): void {
    const def = this.planetDef;
    if (def.hazard.kind === "none") {
      this.suit.reset();
      this.hud.setSuit(null);
      return;
    }
    const p = this.player.position;
    const intensity = sheltered ? 0 : def.hazard.intensity * this.planetInfo().hazardAt(p.x, p.z);
    const t = this.suit.update(dt, def.hazard.kind, intensity, sheltered);
    this.hud.setSuit(t.integrity, intensity > 0.05 ? `Suit · ${hazardLabel(def.hazard.kind)}` : "Suit");
    if (t.warning) this.hud.toast(`Suit integrity low — ${hazardLabel(def.hazard.kind).toLowerCase()}. Return to the ${WORLD.shipName}.`, "warn");
    if (t.failed && this.mode === "onFoot") {
      this.hud.toast(`Suit failure — emergency recall to the ${WORLD.shipName}`, "bad");
      this.enterShip(true);
      this.suit.integrity = 0.25;
      void this.save();
    }
  }

  private progress(e: ProgressEvent): void {
    const r = this.progression.handle(e);
    for (const a of r.achievements) this.hud.toast(`Achievement: ${a.name} (+${a.xp} XP)${a.unlocksPaint ? " · new paint unlocked" : ""}`, "good");
    if (r.rankUp) this.hud.toast(`Promoted to ${r.rankUp}`, "good");
  }

  contractEvent(e: ContractEvent): void {
    const r = this.contracts.handle(e);
    if (r.failed) this.hud.toast(r.failed, "warn");
    if (r.completed) {
      const def = r.completed;
      const parts: string[] = [];
      for (const id of ALL_RESOURCES) {
        const n = def.reward.resources[id] ?? 0;
        if (n <= 0) continue;
        const got = this.inventory.add(id, n);
        if (got > 0) parts.push(`+${got} ${RESOURCES[id].name}`);
      }
      this.progress({ type: "xp", amount: def.reward.xp });
      this.progress({ type: "contract" });
      this.hud.toast(`Contract complete: ${def.title}. ${[...parts, `+${def.reward.xp} XP`].join(" · ")}`, "good");
      this.emit({ type: "contractComplete", id: def.id });
      void this.save();
    } else if (r.advanced) {
      const sm = this.contracts.summary();
      if (sm && sm.current === 0) this.hud.toast(`Contract objective: ${sm.title}`, "info");
    }
    if (r.advanced || r.failed) this.refreshMissionHud();
  }

  private shipLost(): void {
    this.hud.toast("Hull critical — emergency recall to Halcyon Dock", "bad");
    this.combat.clear();
    this.combat.playerShield = this.combat.playerMaxShield;
    this.contractEvent({ type: "shipLost" });
    if (this.planetId !== "veyra7") this.swapPlanet("veyra7");
    this.ship.placeDocked(this.shipEnv);
    this.ship.hull = this.ship.maxHull;
    this.hud.setMode("parked");
    void this.save();
  }

  private openStarMap(): void {
    const target = this.contracts.targetPlanet();
    const sel = this.starMapSel ?? (target && target !== this.planetId ? target : this.planetId);
    const view = {
      planets: PLANET_IDS.map((id) => {
        const d = PLANETS[id];
        const res = (Object.entries(d.resources.weights) as [ResourceId, number][]).filter(([, w]) => w >= 0.6).sort((a, b) => b[1] - a[1]).map(([r]) => r);
        return {
          id,
          name: d.name,
          tagline: d.tagline,
          description: d.description,
          danger: d.danger,
          hazard: d.hazard.kind === "none" ? "None" : d.hazard.label,
          x: d.map.x,
          y: d.map.y,
          color: d.map.color,
          size: d.map.size,
          ring: !!d.map.ring,
          visited: this.progression.state.visited.includes(id),
          current: id === this.planetId,
          contractTarget: id === target,
          hasStation: d.hasStation,
          resources: res,
        };
      }),
      selected: sel,
      warp: this.canWarp(),
      contract: this.contracts.summary() ? `${this.contracts.summary()!.contract} — ${this.contracts.summary()!.title}` : null,
    };
    this.input.setMode("ui");
    const el = this.hud.showCustom("starmap", starMapHtml(view), true);
    bindStarMap(
      el,
      (id) => {
        this.starMapSel = id;
        this.openStarMap();
      },
      (id) => {
        this.starMapSel = null;
        this.startWarp(id);
      },
    );
  }

  private openFrontier(): void {
    const a = this.contracts.state.active;
    const def = this.contracts.activeDef;
    this.input.setMode("ui");
    const el = this.hud.showCustom(
      "frontier",
      frontierHtml({
        tab: this.frontierTab,
        active: a && def ? { def, step: a.step, progress: a.progress } : null,
        available: this.contracts.available(),
        completed: this.contracts.state.completed.length,
        progression: this.progression.state,
        farm: this.farmView(),
      }),
      true,
    );
    bindFrontier(el, {
      tab: (t) => {
        this.frontierTab = t;
        this.openFrontier();
      },
      accept: (id) => {
        if (this.contracts.accept(id)) {
          this.contracts.settle({ planet: this.planetId });
          this.hud.toast(`Contract accepted: ${this.contracts.activeDef?.title}`, "good");
          this.refreshMissionHud();
          void this.save();
        }
        this.openFrontier();
      },
      abandon: () => {
        this.contracts.abandon();
        this.refreshMissionHud();
        void this.save();
        this.openFrontier();
      },
      farmBuild: (id) => {
        const r = farmBuildOrUpgrade(this.farm, id, this.inventory, Date.now());
        if (r.ok) {
          this.farm = r.farm;
          this.hud.toast(`${getRig(id).name} ${this.farm[id].level === 1 ? "built" : `upgraded to level ${this.farm[id].level}`}`, "good");
          void this.save();
        } else this.hud.toast(r.reason === "funds" ? "Not enough resources" : "Already at maximum", "warn");
        this.openFrontier();
      },
      farmClaim: () => {
        const r = farmClaimAll(this.farm, this.inventory, Date.now());
        this.farm = r.farm;
        const parts = (Object.entries(r.gained) as [ResourceId, number][]).filter(([, n]) => n > 0).map(([id, n]) => `+${n} ${RESOURCES[id].name}`);
        this.hud.toast(parts.length ? `Harvest delivered: ${parts.join(" · ")}${r.blocked ? ` (${r.blocked} left — cargo full)` : ""}` : r.blocked ? "Cargo hold full — upgrade Cargo Lattice" : "Nothing to claim yet", parts.length ? "good" : "info");
        void this.save();
        this.openFrontier();
      },
      paint: (id) => {
        if (this.progression.setPaint(id)) {
          this.onStatsChanged();
          void this.save();
        }
        this.openFrontier();
      },
    });
  }

  private farmView() {
    const now = Date.now();
    const pend = farmPending(this.farm, now);
    return RIG_IDS.map((id) => {
      const def = getRig(id);
      const lvl = this.farm[id].level;
      const cost = farmNextCost(this.farm, id);
      return {
        id,
        name: def.name,
        resource: def.resource,
        level: lvl,
        maxLevel: FARMING_RULES.maxLevel,
        pending: pend[id],
        capacity: rigCapacity(id, lvl),
        ratePerHour: rigRatePerHour(id, lvl),
        nextCost: cost ? formatCost(cost) : null,
        affordable: !!cost && this.inventory.has(cost),
      };
    });
  }

  private contractWaypoint(): { pos: Vector3; label: string } | null {
    const o = this.contracts.objective;
    if (!o) return null;
    const def = this.planetDef;
    const site = def.landingSite;
    const sitePos = () => new Vector3(site.x, this.planet.groundAt(site.x, site.z) + 4, site.z);
    switch (o.kind) {
      case "land":
      case "scan":
        if (o.planet !== this.planetId) return null;
        if (this.mode === "onFoot" && o.kind === "scan") return null;
        return { pos: sitePos(), label: site.name };
      case "inspect": {
        if (o.planet !== this.planetId) return null;
        const pois = this.planet.pois.filter((p) => !this.looted.has(p.id) && (!o.poiKind || (p as unknown as { kind?: string }).kind === o.poiKind));
        const from = this.mode === "onFoot" ? this.player.position : new Vector3(this.ship.x, this.ship.y, this.ship.z);
        pois.sort((a, b) => Vector3.Distance(a.position, from) - Vector3.Distance(b.position, from));
        return pois[0] ? { pos: pois[0].position.add(new Vector3(0, 4, 0)), label: pois[0].name } : null;
      }
      case "collect":
        return null;
      case "dock": {
        if (!def.hasStation || this.mode !== "ship" || this.ship.state === "docked") return null;
        const pad = stationPadPosition();
        return { pos: new Vector3(pad.x, pad.y + 4, pad.z), label: WORLD.station.name };
      }
      default:
        return null;
    }
  }

  // ------------------------------------------------------------------ debug & dispose

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const c of this.cleanup) c();
    this.input.dispose();
    this.orientation.dispose();
    this.perfUi?.dispose();
    this.combatHud?.dispose();
    this.combatRenderer?.dispose();
    this.warpFx?.dispose();
    this.space?.dispose();
    this.renderer?.dispose();
    this.engine.stopRenderLoop();
    this.planet?.dispose();
    this.scene.dispose();
    this.engine.dispose();
    this.hud.dispose();
    this.canvas.remove();
    this.opts.container.classList.remove("gf-root");
    if ((typeof __GF_DEBUG__ === "undefined" || __GF_DEBUG__) && this.opts.debug) delete (window as any).__GF;
  }
}

function blankInput(i: InputFrame): InputFrame {
  return {
    ...i,
    moveX: 0,
    moveY: 0,
    lookX: 0,
    lookY: 0,
    zoom: 0,
    jumpHeld: false,
    jumpPressed: false,
    fire: false,
    scanPressed: false,
    interactPressed: false,
    shipThrottle: 0,
    shipYaw: 0,
    shipPitch: 0,
    lift: 0,
    boost: false,
    shipThrottleTarget: null,
  };
}

export { GEAR_HEIGHT };
