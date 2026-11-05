/**
 * Rendering profiles for the single shared scene.
 *
 * A platform picks a DEFAULT tier; hardware capability and the player's own
 * setting decide the EFFECTIVE tier. Profiles only change how the scene is
 * drawn: gameplay, collision, resources and rewards are identical in every tier.
 *
 * Tier ids are stable (`basic` / `enhanced` / `ultra`; saved device prefs and
 * `?quality=` use them). Only the display label of `ultra` changed in M3
 * ("Android Extreme HD"); the M2 label is kept in `legacyLabel`.
 */
import { IS_LITE } from "../core/package";
export type GraphicsTier = "basic" | "enhanced" | "ultra";
export type GraphicsSetting = GraphicsTier | "auto";
export type PlatformKind = "telegram" | "android-app" | "android-browser" | "ios-browser" | "desktop";

/** Per-tier caps for combat visuals (Agent C reads these; gameplay never depends on them). */
export interface CombatFxBudget {
  /** Weapon bolts drawn at once (extra bolts still simulate, they are just not drawn). */
  bolts: number;
  /** Simultaneous explosion effects. */
  explosions: number;
  /** Debris chunks per explosion. */
  debrisPerExplosion: number;
}

export interface RenderProfile {
  tier: GraphicsTier;
  label: string;
  /** Label used by M2 (kept so older docs, logs and hosts can still match it). */
  legacyLabel: string;
  maxDevicePixelRatio: number;
  /** Starting render scale (1 = native at capped DPR). */
  renderScale: number;
  /** Lowest render scale the governor may use. */
  minRenderScale: number;
  /** Frame-rate floor the governor defends. */
  targetFps: number;
  /** Physically based materials + image-based ambient. */
  pbr: boolean;
  /** Procedural texture resolution. */
  textureSize: 256 | 512 | 1024;
  /** 0: vertex colour + detail grain, 1: splat + normal detail, 2: + triplanar rock. */
  terrainDetail: 0 | 1 | 2;
  /** Height/distance aerial perspective in world materials. */
  atmosphere: boolean;
  shadows: "none" | "single" | "cascaded";
  /** Base shadow map size (per cascade when cascaded). */
  shadowMapSize: number;
  /**
   * M3: shadow map size used instead of `shadowMapSize` when the hardware probe
   * shows a flagship-class GPU (see `isFlagship`). Equal to `shadowMapSize` = never upgrade.
   */
  shadowMapSizeMax: number;
  /** M3: shadow PCF filter quality. */
  shadowFilter: "low" | "medium" | "high";
  /** Rocks within this distance cast shadows (0 = only player/ship). */
  propShadowDistance: number;
  post: {
    enabled: boolean;
    /** MSAA samples on the post pipeline (WebGL2 only; 1 = off). */
    msaa: number;
    fxaa: boolean;
    bloom: boolean;
    bloomScale: number;
    /** M3: bloom blur kernel and weight. */
    bloomKernel: number;
    bloomWeight: number;
    sharpen: boolean;
    vignette: boolean;
  };
  /** Sky reflection probe size for PBR reflections (0 = none). */
  envProbeSize: 0 | 64 | 128;
  /** Fraction of decor (pebbles, spikes, fronds) drawn. */
  decorDensity: number;
  /** Fraction of grass tufts drawn (0 = none). */
  grassDensity: number;
  /** Decor chunks beyond this distance are culled. */
  decorDistance: number;
  /** Rock/deposit high-detail LOD distance and cull distance. */
  propLod: { high: number; cull: number };
  /** Terrain chunks switch to half resolution beyond this distance. */
  terrainLodDistance: number;
  particles: { dust: number; gusts: number; sparks: number; debris: number; exhaust: number };
  sky: { clouds: boolean };
  water: { reflections: boolean; waves: boolean };
  fogDensity: number;

  // ---------------------------------------------------------------- M3 fields (present on every tier)

  /** Wayfarer mesh detail (greebles, hardpoints, panel inserts, nav strobes). `ShipModel.setDetail`. */
  shipDetail: GraphicsTier;
  /** Halcyon Dock mesh detail (window bands, guide lights, ring modules). `Station.setDetail`. */
  stationDetail: GraphicsTier;
  /** Asteroid / orbital debris budget for `SpaceEnvironment`. */
  asteroids: {
    /** Asteroids drawn in the orbital belt (instanced). */
    count: number;
    /** Small orbital debris pieces (thin-instanced). */
    debris: number;
    /** Distance at which asteroids switch to the low-poly LOD mesh. */
    lodDistance: number;
    /** Asteroids beyond this distance from the camera are not drawn. */
    cullDistance: number;
  };
  /** High-altitude starfield / nebula layer: star count (0 = off) and nebula sheets. */
  space: { stars: number; nebula: boolean };
  /** Particle budget for weather systems (rain, ash, snow — Agent A's `weather.ts`). */
  weatherParticles: number;
  combatFx: CombatFxBudget;
  /** Engine VFX: layered plume mesh, heat-shimmer core, afterburner, RCS puff capacity, engine light. */
  engineFx: { plume: boolean; shimmer: boolean; rcs: number; light: boolean };
  /** Warp travel effect: star-streak count, tunnel mesh, screen-space warp post. */
  warpFx: { streaks: number; tunnel: boolean; post: boolean };
  /** Optional screen effects: heat haze (volcanic worlds), damage flash, shield ripple on the ship. */
  screenFx: { heatHaze: boolean; damageFlash: boolean; shieldRipple: boolean };
}

export const PROFILES: Record<GraphicsTier, RenderProfile> = {
  basic: {
    tier: "basic",
    label: "Telegram Basic",
    legacyLabel: "Telegram Basic",
    maxDevicePixelRatio: 1.25,
    renderScale: 0.85,
    minRenderScale: 0.55,
    targetFps: 30,
    pbr: false,
    textureSize: 256,
    terrainDetail: 0,
    atmosphere: false,
    shadows: "none",
    shadowMapSize: 0,
    shadowMapSizeMax: 0,
    shadowFilter: "low",
    propShadowDistance: 0,
    post: { enabled: false, msaa: 1, fxaa: false, bloom: false, bloomScale: 0.5, bloomKernel: 32, bloomWeight: 0.25, sharpen: false, vignette: false },
    envProbeSize: 0,
    decorDensity: 0.35,
    grassDensity: 0,
    decorDistance: 170,
    propLod: { high: 0, cull: 320 },
    terrainLodDistance: 260,
    particles: { dust: 0, gusts: 0, sparks: 60, debris: 12, exhaust: 40 },
    sky: { clouds: false },
    water: { reflections: false, waves: false },
    fogDensity: 0.0019,
    shipDetail: "basic",
    stationDetail: "basic",
    asteroids: { count: 48, debris: 0, lodDistance: 0, cullDistance: 700 },
    space: { stars: 0, nebula: false },
    weatherParticles: 120,
    combatFx: { bolts: 24, explosions: 3, debrisPerExplosion: 6 },
    engineFx: { plume: false, shimmer: false, rcs: 0, light: false },
    warpFx: { streaks: 120, tunnel: false, post: false },
    screenFx: { heatHaze: false, damageFlash: true, shieldRipple: true },
  },
  enhanced: {
    tier: "enhanced",
    label: "PC Enhanced",
    legacyLabel: "PC Enhanced",
    maxDevicePixelRatio: 1.75,
    renderScale: 1,
    minRenderScale: 0.6,
    targetFps: 50,
    pbr: true,
    textureSize: 512,
    terrainDetail: 1,
    atmosphere: true,
    shadows: "single",
    shadowMapSize: 2048,
    shadowMapSizeMax: 4096,
    shadowFilter: "medium",
    propShadowDistance: 60,
    post: { enabled: true, msaa: 4, fxaa: false, bloom: true, bloomScale: 0.5, bloomKernel: 56, bloomWeight: 0.34, sharpen: false, vignette: true },
    envProbeSize: 64,
    decorDensity: 0.7,
    grassDensity: 0.45,
    decorDistance: 260,
    propLod: { high: 70, cull: 480 },
    terrainLodDistance: 380,
    particles: { dust: 180, gusts: 30, sparks: 180, debris: 50, exhaust: 200 },
    sky: { clouds: true },
    water: { reflections: true, waves: true },
    fogDensity: 0.0015,
    shipDetail: "enhanced",
    stationDetail: "enhanced",
    asteroids: { count: 220, debris: 160, lodDistance: 260, cullDistance: 1400 },
    space: { stars: 2200, nebula: true },
    weatherParticles: 600,
    combatFx: { bolts: 96, explosions: 8, debrisPerExplosion: 18 },
    engineFx: { plume: true, shimmer: true, rcs: 60, light: true },
    warpFx: { streaks: 600, tunnel: true, post: true },
    screenFx: { heatHaze: true, damageFlash: true, shieldRipple: true },
  },
  ultra: {
    tier: "ultra",
    label: "Android Extreme HD",
    legacyLabel: "Android Ultra",
    maxDevicePixelRatio: 2,
    renderScale: 1,
    minRenderScale: 0.65,
    targetFps: 60,
    pbr: true,
    textureSize: 1024,
    terrainDetail: 2,
    atmosphere: true,
    shadows: "cascaded",
    shadowMapSize: 1024,
    shadowMapSizeMax: 2048,
    shadowFilter: "high",
    propShadowDistance: 110,
    post: { enabled: true, msaa: 4, fxaa: false, bloom: true, bloomScale: 0.6, bloomKernel: 64, bloomWeight: 0.38, sharpen: true, vignette: true },
    envProbeSize: 128,
    decorDensity: 1,
    grassDensity: 1,
    decorDistance: 360,
    propLod: { high: 120, cull: 650 },
    terrainLodDistance: 520,
    particles: { dust: 300, gusts: 60, sparks: 260, debris: 100, exhaust: 300 },
    sky: { clouds: true },
    water: { reflections: true, waves: true },
    fogDensity: 0.0013,
    shipDetail: "ultra",
    stationDetail: "ultra",
    asteroids: { count: 480, debris: 420, lodDistance: 380, cullDistance: 2000 },
    space: { stars: 4000, nebula: true },
    weatherParticles: 1200,
    combatFx: { bolts: 160, explosions: 14, debrisPerExplosion: 28 },
    engineFx: { plume: true, shimmer: true, rcs: 120, light: true },
    warpFx: { streaks: 1200, tunnel: true, post: true },
    screenFx: { heatHaze: true, damageFlash: true, shieldRipple: true },
  },
};

export const TIER_ORDER: GraphicsTier[] = ["basic", "enhanced", "ultra"];

export function tierIndex(t: GraphicsTier): number {
  return TIER_ORDER.indexOf(t);
}

/** Legacy M1 quality names map onto tiers (low/medium/high). */
export function tierFromLegacy(q: string | null | undefined): GraphicsTier | null {
  if (q === "low" || q === "basic") return "basic";
  if (q === "medium" || q === "enhanced") return "enhanced";
  if (q === "high" || q === "ultra") return "ultra";
  return null;
}

export function legacyFromTier(t: GraphicsTier): "low" | "medium" | "high" {
  return t === "basic" ? "low" : t === "enhanced" ? "medium" : "high";
}

/** Default tier per platform, before capability limits. */
export function platformDefaultTier(p: PlatformKind): GraphicsTier {
  switch (p) {
    case "telegram":
      return "basic";
    case "android-app":
    case "android-browser":
      return "ultra";
    case "ios-browser":
    case "desktop":
      return "enhanced";
  }
}

export interface GpuCapabilities {
  webgl2: boolean;
  maxTextureSize: number;
  /** Unmasked renderer string when the browser exposes it. */
  renderer?: string;
  deviceMemoryGb?: number;
  cores?: number;
  isMobile: boolean;
}

/** Known weak mobile GPU families (conservative heuristics, extend from field data). */
const WEAK_GPU = /(Mali-4\d\d|Mali-T[67]\d\d|Mali-G(31|51|52|57)\b|Adreno \(TM\) [3-5]\d\d|Adreno [3-5]\d\d|PowerVR|SGX|Intel\(R\) HD Graphics [2-5]\d{2,3}\b|SwiftShader|llvmpipe)/i;
const STRONG_MOBILE_GPU = /(Adreno \(TM\) (7[3-9]\d|8\d\d)|Adreno (7[3-9]\d|8\d\d)|Mali-G(7[1-9]|7\d\d|9\d\d)|Immortalis|Xclipse|Apple GPU)/i;
/** Current-generation flagship mobile GPUs (sustain 60 fps at Extreme HD in our budget). */
const FLAGSHIP_MOBILE_GPU = /(Adreno \(TM\) (7[4-9]\d|8\d\d)|Adreno (7[4-9]\d|8\d\d)|Immortalis|Mali-G(7[2-9]\d|9\d\d)|Xclipse 9\d\d)/i;
/** Discrete / recent integrated desktop GPUs. */
const STRONG_DESKTOP_GPU = /(GeForce|Quadro|RTX|Radeon(?! \(TM\) R[2-5])|Arc|Apple M\d|Iris\(R\) Xe)/i;

/** Highest tier this hardware should run by default. */
export function capabilityCeiling(c: GpuCapabilities): GraphicsTier {
  const r = c.renderer ?? "";
  if (WEAK_GPU.test(r)) return "basic";
  const mem = c.deviceMemoryGb ?? 4;
  const cores = c.cores ?? 4;
  if (!c.webgl2 || c.maxTextureSize < 4096) return mem >= 4 ? "enhanced" : "basic";
  if (c.isMobile) {
    if (mem < 4 || cores < 4) return "basic";
    if (STRONG_MOBILE_GPU.test(r) && mem >= 6) return "ultra";
    if (mem >= 8 && cores >= 8) return "ultra";
    return "enhanced";
  }
  if (cores < 4 && mem < 8) return "enhanced";
  return "ultra";
}

/**
 * Flagship-class hardware: gets the larger shadow maps and the 60 fps target
 * on Extreme HD. Requires a positively identified GPU; an unknown or masked
 * renderer string never counts (we never assume every Android GPU can do it).
 */
export function isFlagship(c: GpuCapabilities): boolean {
  const r = c.renderer ?? "";
  if (!c.webgl2 || c.maxTextureSize < 8192 || WEAK_GPU.test(r) || !r) return false;
  const mem = c.deviceMemoryGb ?? 4;
  if (c.isMobile) return FLAGSHIP_MOBILE_GPU.test(r) && mem >= 8 && (c.cores ?? 4) >= 8;
  return STRONG_DESKTOP_GPU.test(r) && mem >= 8;
}

/** The Lite (Telegram) package never renders above this tier; its bundle does not even contain the heavier features. */
export const LITE_TIER_CEILING: GraphicsTier = "basic";

export interface TierDecision {
  tier: GraphicsTier;
  reason: string;
}

/**
 * Auto: platform default limited by capability.
 * Explicit choice: honoured (features the GPU lacks fall back individually,
 * and the runtime governor still protects frame rate).
 */
export function resolveTier(setting: GraphicsSetting, platform: PlatformKind, caps: GpuCapabilities): TierDecision {
  const d = resolveTierUnclamped(setting, platform, caps);
  if (IS_LITE && tierIndex(d.tier) > tierIndex(LITE_TIER_CEILING)) return { tier: LITE_TIER_CEILING, reason: "Lite package" };
  return d;
}

function resolveTierUnclamped(setting: GraphicsSetting, platform: PlatformKind, caps: GpuCapabilities): TierDecision {
  if (setting !== "auto") return { tier: setting, reason: "player setting" };
  const def = platformDefaultTier(platform);
  const ceil = capabilityCeiling(caps);
  if (tierIndex(ceil) < tierIndex(def)) return { tier: ceil, reason: `${platform} default ${def}, limited by hardware` };
  return { tier: def, reason: `${platform} default` };
}

/** Turns tier + hardware into the concrete profile (per-feature fallbacks). */
export function effectiveProfile(tier: GraphicsTier, caps: GpuCapabilities, resolutionScale = 1): RenderProfile {
  const base = PROFILES[tier];
  const p: RenderProfile = JSON.parse(JSON.stringify(base));
  const flagship = isFlagship(caps);
  if (!caps.webgl2) {
    if (p.shadows === "cascaded") p.shadows = "single";
    p.post.msaa = 1;
    if (p.post.enabled) p.post.fxaa = true;
  }
  if (caps.maxTextureSize < 2048 && p.textureSize > 512) p.textureSize = 512;
  if (flagship && p.shadowMapSizeMax > p.shadowMapSize) p.shadowMapSize = p.shadowMapSizeMax;
  p.shadowMapSize = Math.min(p.shadowMapSize, caps.maxTextureSize);
  if (!flagship) {
    // Fill-rate on phones: 4x MSAA only on flagships; mid-range keeps 2x.
    if (caps.isMobile && p.post.msaa > 2) p.post.msaa = 2;
    // 60 fps is the Extreme HD goal on flagships only; elsewhere defend 30 (the M2 floor).
    if (p.tier === "ultra") p.targetFps = 30;
    if (p.shadowFilter === "high" && caps.isMobile) p.shadowFilter = "medium";
  }
  const s = Math.min(1, Math.max(0.5, resolutionScale));
  p.renderScale = +(p.renderScale * s).toFixed(2);
  p.minRenderScale = Math.min(p.minRenderScale, p.renderScale);
  return p;
}

/** Scales every M3 budget field (asteroids, combat, engine, warp, weather) by k (governor "fx" step). */
export function scaleFxBudgets(p: RenderProfile, k: number): RenderProfile {
  const q: RenderProfile = JSON.parse(JSON.stringify(p));
  const r = (v: number) => Math.round(v * k);
  q.asteroids.count = r(p.asteroids.count);
  q.asteroids.debris = r(p.asteroids.debris);
  q.asteroids.cullDistance = Math.round(p.asteroids.cullDistance * Math.max(0.6, k));
  q.space.stars = r(p.space.stars);
  q.weatherParticles = r(p.weatherParticles);
  q.combatFx = { bolts: Math.max(8, r(p.combatFx.bolts)), explosions: Math.max(2, r(p.combatFx.explosions)), debrisPerExplosion: r(p.combatFx.debrisPerExplosion) };
  q.engineFx = { ...p.engineFx, rcs: r(p.engineFx.rcs), shimmer: k >= 1 && p.engineFx.shimmer };
  q.warpFx = { ...p.warpFx, streaks: r(p.warpFx.streaks) };
  q.screenFx = { ...p.screenFx, heatHaze: k >= 1 && p.screenFx.heatHaze };
  return q;
}
