/**
 * Rendering profiles for the single shared scene.
 *
 * A platform picks a DEFAULT tier; hardware capability and the player's own
 * setting decide the EFFECTIVE tier. Profiles only change how the scene is
 * drawn: gameplay, collision, resources and rewards are identical in every tier.
 */
export type GraphicsTier = "basic" | "enhanced" | "ultra";
export type GraphicsSetting = GraphicsTier | "auto";
export type PlatformKind = "telegram" | "android-app" | "android-browser" | "ios-browser" | "desktop";

export interface RenderProfile {
  tier: GraphicsTier;
  label: string;
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
  shadowMapSize: number;
  /** Rocks within this distance cast shadows (0 = only player/ship). */
  propShadowDistance: number;
  post: { enabled: boolean; msaa: number; fxaa: boolean; bloom: boolean; bloomScale: number; sharpen: boolean; vignette: boolean };
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
}

export const PROFILES: Record<GraphicsTier, RenderProfile> = {
  basic: {
    tier: "basic",
    label: "Telegram Basic",
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
    propShadowDistance: 0,
    post: { enabled: false, msaa: 1, fxaa: false, bloom: false, bloomScale: 0.5, sharpen: false, vignette: false },
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
  },
  enhanced: {
    tier: "enhanced",
    label: "PC Enhanced",
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
    propShadowDistance: 45,
    post: { enabled: true, msaa: 1, fxaa: true, bloom: true, bloomScale: 0.5, sharpen: false, vignette: true },
    envProbeSize: 64,
    decorDensity: 0.7,
    grassDensity: 0.45,
    decorDistance: 260,
    propLod: { high: 70, cull: 480 },
    terrainLodDistance: 380,
    particles: { dust: 140, gusts: 24, sparks: 140, debris: 40, exhaust: 160 },
    sky: { clouds: true },
    water: { reflections: true, waves: true },
    fogDensity: 0.0015,
  },
  ultra: {
    tier: "ultra",
    label: "Android Ultra",
    maxDevicePixelRatio: 2,
    renderScale: 1,
    minRenderScale: 0.65,
    targetFps: 30,
    pbr: true,
    textureSize: 1024,
    terrainDetail: 2,
    atmosphere: true,
    shadows: "cascaded",
    shadowMapSize: 1024,
    propShadowDistance: 90,
    post: { enabled: true, msaa: 2, fxaa: false, bloom: true, bloomScale: 0.5, sharpen: true, vignette: true },
    envProbeSize: 128,
    decorDensity: 1,
    grassDensity: 1,
    decorDistance: 360,
    propLod: { high: 120, cull: 650 },
    terrainLodDistance: 520,
    particles: { dust: 280, gusts: 48, sparks: 220, debris: 80, exhaust: 280 },
    sky: { clouds: true },
    water: { reflections: true, waves: true },
    fogDensity: 0.0013,
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
  if (!caps.webgl2) {
    if (p.shadows === "cascaded") p.shadows = "single";
    p.post.msaa = 1;
    if (p.post.enabled) p.post.fxaa = true;
  }
  if (caps.maxTextureSize < 2048 && p.textureSize > 512) p.textureSize = 512;
  p.shadowMapSize = Math.min(p.shadowMapSize, caps.maxTextureSize);
  const s = Math.min(1, Math.max(0.5, resolutionScale));
  p.renderScale = +(p.renderScale * s).toFixed(2);
  p.minRenderScale = Math.min(p.minRenderScale, p.renderScale);
  return p;
}
