export type QualityLevel = "low" | "medium" | "high";
export type QualitySetting = QualityLevel | "auto";

export interface QualityPreset {
  level: QualityLevel;
  /** Terrain grid cells per edge. */
  terrainResolution: number;
  /** Device pixel ratio cap. */
  maxDevicePixelRatio: number;
  /** Render scale (1 = native at capped DPR, 0.75 = 75% resolution). */
  renderScale: number;
  /** Lowest render scale the adaptive controller may drop to. */
  minRenderScale: number;
  antialias: boolean;
  shadows: boolean;
  shadowMapSize: number;
  glow: boolean;
  /** Number of decorative pebbles/tufts (thin instances). */
  decorCount: number;
  /** Ambient dust particle count. */
  dustParticles: number;
  /** Max laser spark particles. */
  sparkParticles: number;
  fogDensity: number;
}

export const QUALITY_PRESETS: Record<QualityLevel, QualityPreset> = {
  low: {
    level: "low",
    terrainResolution: 160,
    maxDevicePixelRatio: 1.25,
    renderScale: 0.8,
    minRenderScale: 0.55,
    antialias: false,
    shadows: false,
    shadowMapSize: 0,
    glow: false,
    decorCount: 500,
    dustParticles: 0,
    sparkParticles: 60,
    fogDensity: 0.0019,
  },
  medium: {
    level: "medium",
    terrainResolution: 224,
    maxDevicePixelRatio: 1.75,
    renderScale: 1,
    minRenderScale: 0.6,
    antialias: true,
    shadows: true,
    shadowMapSize: 1024,
    glow: false,
    decorCount: 1400,
    dustParticles: 120,
    sparkParticles: 120,
    fogDensity: 0.0016,
  },
  high: {
    level: "high",
    terrainResolution: 288,
    maxDevicePixelRatio: 2,
    renderScale: 1,
    minRenderScale: 0.7,
    antialias: true,
    shadows: true,
    shadowMapSize: 2048,
    glow: true,
    decorCount: 2800,
    dustParticles: 260,
    sparkParticles: 220,
    fogDensity: 0.0014,
  },
};

export interface DeviceProfile {
  isMobile: boolean;
  deviceMemoryGb?: number;
  hardwareConcurrency?: number;
  maxTextureSize?: number;
  /** "Telegram" / "WebView" hints lower the default one notch. */
  embedded?: boolean;
}

export function detectDeviceProfile(): DeviceProfile {
  if (typeof navigator === "undefined") return { isMobile: false };
  const ua = navigator.userAgent || "";
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
  const embedded = /; wv\)|Telegram/i.test(ua) || typeof (globalThis as any).Telegram?.WebApp !== "undefined";
  return {
    isMobile,
    embedded,
    deviceMemoryGb: (navigator as any).deviceMemory,
    hardwareConcurrency: navigator.hardwareConcurrency,
  };
}

/** Conservative default: mobile starts low/medium; desktops start medium/high. */
export function chooseQuality(setting: QualitySetting, p: DeviceProfile): QualityLevel {
  if (setting !== "auto") return setting;
  const mem = p.deviceMemoryGb ?? 4;
  const cores = p.hardwareConcurrency ?? 4;
  if (p.isMobile) {
    if (mem >= 8 && cores >= 8 && !p.embedded) return "medium";
    return "low";
  }
  if (mem >= 8 && cores >= 8) return "high";
  return "medium";
}

/**
 * Dynamic resolution: lowers render scale when the frame rate sags and slowly
 * restores it when there is headroom. Pure and testable.
 */
export class AdaptiveResolution {
  scale: number;
  private avgFps = 60;
  private lowTimer = 0;
  private highTimer = 0;

  constructor(
    private readonly maxScale: number,
    private readonly minScale: number,
    private readonly targetFps = 50,
  ) {
    this.scale = maxScale;
  }

  /** Returns true when the scale changed. */
  update(dt: number, fps: number): boolean {
    if (!Number.isFinite(fps) || fps <= 0) return false;
    this.avgFps += (fps - this.avgFps) * Math.min(1, dt * 2);
    if (this.avgFps < this.targetFps - 8) {
      this.lowTimer += dt;
      this.highTimer = 0;
    } else if (this.avgFps > this.targetFps + 8) {
      this.highTimer += dt;
      this.lowTimer = 0;
    } else {
      this.lowTimer = 0;
      this.highTimer = 0;
    }
    if (this.lowTimer > 2 && this.scale > this.minScale) {
      this.scale = Math.max(this.minScale, +(this.scale - 0.1).toFixed(2));
      this.lowTimer = 0;
      return true;
    }
    if (this.highTimer > 6 && this.scale < this.maxScale) {
      this.scale = Math.min(this.maxScale, +(this.scale + 0.05).toFixed(2));
      this.highTimer = 0;
      return true;
    }
    return false;
  }
}

export interface Theme {
  brandName: string;
  gameTitle: string;
  /** UI colours (CSS). Swap with OrbitBtc's approved tokens. */
  bg: string;
  panel: string;
  border: string;
  accent: string;
  accent2: string;
  text: string;
  muted: string;
  warn: string;
  danger: string;
  fontFamily: string;
}

/**
 * Placeholder "Galaxy / black-hole" tokens. Replace with OrbitBtc's approved
 * brand values via the `theme` option — the game reads only from here.
 */
export const DEFAULT_THEME: Theme = {
  brandName: "OrbitBtc",
  gameTitle: "Galactic Frontier",
  bg: "#05040b",
  panel: "rgba(12, 9, 28, 0.86)",
  border: "rgba(155, 120, 255, 0.35)",
  accent: "#8b5cf6",
  accent2: "#2ee6ff",
  text: "#ece9ff",
  muted: "#a39cc8",
  warn: "#ffb547",
  danger: "#ff5470",
  fontFamily: "'Segoe UI', system-ui, -apple-system, Roboto, 'Helvetica Neue', Arial, sans-serif",
};
