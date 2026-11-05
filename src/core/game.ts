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
import { RESOURCES, type ResourceId } from "../gameplay/resources";
import { deriveStats, emptyLevels, purchaseUpgrade, getUpgrade, type DerivedStats, type UpgradeId, type UpgradeLevels } from "../gameplay/upgrades";
import { IntroMission, MISSION_REQUIREMENTS, MISSION_STEPS, INTRO_MISSION_ID, type GameplayEvent } from "../gameplay/mission";
import { LaserBeam, ScanPulse, EnvironmentFx, ShipFx, makeParticleTexture } from "../gameplay/effects";
import {
  DEFAULT_SETTINGS,
  LocalStorageSaveAdapter,
  newGameSave,
  type GameSettings,
  type SaveAdapter,
  type SaveData,
} from "../persistence/saveSystem";
import { OfflineBackend, buildCompletionReport, type BackendClient, type MissionSubmissionResult } from "../integration/backend";

export type GameOutEvent =
  | { type: "ready"; quality: QualityLevel; tier: GraphicsTier }
  | { type: "missionStep"; step: string }
  | { type: "missionComplete"; result: MissionSubmissionResult }
  | { type: "saved"; at: number }
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
  /** Skip the title screen. */
  autoStart?: "new" | "continue";
  /** Called when a settings change needs a full restart (quality). */
  requestRestart?: () => void;
}

type Mode = "title" | "onFoot" | "ship";

const MISSION_WAYPOINT_COLOR = "#ffd37a";

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
    this.beam = new LaserBeam(this.scene, ptex, 220);
    this.pulse = new ScanPulse(this.scene);
    const wind = { get x() { return WorldUniforms.wind.x; }, get z() { return WorldUniforms.wind.y; } };
    this.envFx = new EnvironmentFx(this.scene, ptex, this.rig.camera, wind);
    this.shipFx = new ShipFx(this.scene, ptex, this.shipModel.nozzles);
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
    this.emit({ type: "ready", quality: this.qualityLevel, tier: this.tierDecision.tier });
    this.orientation.refresh();
    if (this.opts.debug) this.exposeDebug();

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
    const now = Date.now();
    for (const d of this.planet.deposits) {
      const dep = s.depleted[d.id];
      if (dep !== undefined && now - dep < WORLD.depositRegrowMs) {
        d.amount = 0;
        d.depletedAt = dep;
      } else if (s.partial[d.id] !== undefined) {
        d.amount = Math.max(1, Math.round(d.max * clamp(s.partial[d.id], 0, 1)));
        d.depletedAt = null;
      } else {
        d.amount = d.max;
        d.depletedAt = null;
      }
      this.planet.refreshDeposit(d);
    }

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
    const depleted: Record<string, number> = {};
    const partial: Record<string, number> = {};
    for (const d of this.planet.deposits) {
      if (d.depletedAt !== null) depleted[d.id] = d.depletedAt;
      else if (d.amount < d.max) partial[d.id] = d.amount / d.max;
    }
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
    const input = this.input.consume(dt);
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

    // Panels / menus
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

    this.keepCameraOutsideStation();
    this.updateShadowFocus();
    this.updateWorldTimers(dt);
    this.updateHud(dt);

    this.updateEffects(input);
    for (const note of this.renderer.tick(dt)) this.toastOnce(`gov-${note}`, note, "info", 30);
  }

  // ------------------------------------------------------------------ on foot

  private updateFoot(dt: number, input: InputFrame): void {
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
    if (this.ship.state === "landed" && Math.hypot(p.x - this.ship.x, p.z - this.ship.z) < 7.5) {
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
      }
    }
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
    if (d.amount <= 0) {
      d.depletedAt = Date.now();
      this.tagged.delete(d.id);
      this.hud.toast(`${RESOURCES[d.type].name} deposit depleted`, "info");
    }
    this.planet.refreshDeposit(d);
  }

  // ------------------------------------------------------------------ ship

  private updateShip(dt: number, input: InputFrame): void {
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
        this.hud.toast(`Touchdown on ${WORLD.planetName}`, "good");
        this.missionEvent({ type: "landed" });
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
        this.hud.toast("Hull critical — emergency recall to Halcyon Dock", "bad");
        this.ship.placeDocked(this.shipEnv);
        this.ship.hull = this.ship.maxHull;
        this.hud.setMode("parked");
        void this.save();
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
        s.state === "docked" ? `Docked · ${WORLD.station.name}` : s.state === "landed" ? `Landed · ${WORLD.planetName}` : s.state === "flying" ? (s.agl(this.shipEnv) < 18 && s.speed < 18 ? "Landing possible" : "In flight") : "Autopilot";
      this.hud.setShip(s.speed, alt, s.throttle, s.hull / s.maxHull, status);
    }
    this.hud.setResources(this.inventory.snapshot(), this.inventory.capacity);
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
    if (foot && this.ship.state === "landed" && (!wp || wp.label !== WORLD.shipName)) {
      const sp = new Vector3(this.ship.x, this.ship.y + 3, this.ship.z);
      if (Vector3.Distance(sp, this.player.position) > 20) add("ship", sp, WORLD.shipName, "#7fe3ff");
    }
    this.hud.setMarkers(markers);

    // Compass
    const yaw = this.mode === "ship" && this.ship.state === "flying" ? this.ship.yaw : this.rig.yaw;
    const cm: CompassMarker[] = [];
    const bearingTo = (p: Vector3) => Math.atan2(p.x - camPos.x, p.z - camPos.z);
    if (wp) cm.push({ bearing: bearingTo(wp.pos), color: MISSION_WAYPOINT_COLOR });
    if (foot && this.ship.state === "landed") cm.push({ bearing: bearingTo(new Vector3(this.ship.x, 0, this.ship.z)), color: "#7fe3ff" });
    this.hud.setCompass(yaw, cm);
  }

  private waypoint(): { pos: Vector3; label: string } | null {
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

  // ------------------------------------------------------------------ debug & dispose

  private exposeDebug(): void {
    const g = this;
    (window as any).__GF = {
      game: g,
      state: () => ({
        mode: g.mode,
        ship: { state: g.ship.state, x: g.ship.x, y: g.ship.y, z: g.ship.z, speed: g.ship.speed, hull: g.ship.hull, agl: g.ship.agl(g.shipEnv) },
        player: { x: g.player.position.x, y: g.player.position.y, z: g.player.position.z, grounded: g.player.grounded, jetFuel: g.player.jetFuel },
        inventory: g.inventory.snapshot(),
        laser: { energy: g.laser.energy, heat: g.laser.heat, overheated: g.laser.overheated },
        mission: g.mission.state,
        quality: g.qualityLevel,
        tier: g.tierDecision.tier,
        tierReason: g.tierDecision.reason,
        platform: g.platform.kind,
        orientation: g.orientationState,
        perf: g.renderer.stats(),
        world: g.planet.stats(),
        panel: g.hud.panel,
        tagged: g.tagged.size,
        target: g.currentTarget?.id ?? null,
        fps: g.engine.getFps(),
        drawCalls: (g.engine as any)._drawCalls?.current ?? null,
        activeMeshes: g.scene.getActiveMeshes().length,
      }),
      teleportShip: (x: number, y: number, z: number, yaw = g.ship.yaw) => Object.assign(g.ship, { x, y, z, yaw, speed: 0, throttle: 0, pitch: 0 }),
      teleportPlayer: (x: number, z: number) => g.player.place(x, z, g.planet, g.player.facing),
      give: (id: ResourceId, n: number) => {
        const got = g.inventory.add(id, n);
        g.missionEvent({ type: "collected", resource: id, amount: got });
        return got;
      },
      /** Stand next to the nearest deposit of a type and aim the camera at it. */
      approach: (type: ResourceId) => {
        const p = g.player.position;
        const list = g.planet.deposits.filter((d) => d.type === type && d.amount > 0).sort((a, b) => Vector3.Distance(a.position, p) - Vector3.Distance(b.position, p));
        const d = list[0];
        if (!d) return null;
        const away = p.subtract(d.position);
        away.y = 0;
        away.normalize().scaleInPlace(d.radius + 3.5);
        g.player.place(d.position.x + away.x, d.position.z + away.z, g.planet, 0);
        const to = d.position.subtract(g.player.position.add(new Vector3(0, 1.65, 0)));
        g.rig.yaw = Math.atan2(to.x, to.z);
        g.rig.pitch = clamp(-Math.atan2(to.y, Math.hypot(to.x, to.z)) + 0.12, -0.5, 1.1);
        return d.id;
      },
      setTimeScale: (s: number) => (g.timeScale = s),
      setTier: (t: GraphicsTier | "auto") => {
        g.prefs.graphics = t;
        g.applyGraphics();
        return g.tierDecision.tier;
      },
      setAdaptive: (on: boolean) => {
        g.prefs.adaptive = on;
        g.renderer.governor.enabled = on;
      },
      save: () => g.save(),
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const c of this.cleanup) c();
    this.input.dispose();
    this.orientation.dispose();
    this.renderer?.dispose();
    this.engine.stopRenderLoop();
    this.planet?.dispose();
    this.scene.dispose();
    this.engine.dispose();
    this.hud.dispose();
    this.canvas.remove();
    this.opts.container.classList.remove("gf-root");
    if (this.opts.debug) delete (window as any).__GF;
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
