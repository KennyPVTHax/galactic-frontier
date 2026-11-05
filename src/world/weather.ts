import { Color4, DynamicTexture, ParticleSystem, Scene, Vector3, type Texture } from "../engine/babylon";
import type { WeatherKind } from "../universe/types";

/**
 * Camera-following weather particles (snow, blizzard, ash & embers, spores,
 * pollen, storm rain, dust). Cheap by design: a handful of CPU particle
 * systems whose total live-particle count is capped by `setBudget`.
 *
 * Usage (game.ts):
 *   const fx = planet.createWeather(camera, particleTexture);   // or new WeatherFx(...)
 *   hooks.setParticleBudget: fx?.setBudget(weatherBudget(b))
 *   per frame: planet.update(dt, cam) drives it with WorldUniforms.wind (or call fx.update yourself)
 *   on planet swap: planet.dispose() disposes the weather it created.
 */
export interface WeatherWind {
  x: number;
  z: number;
  strength: number;
}

interface Layer {
  ps: ParticleSystem;
  /** Share of the budget. */
  share: number;
  /** Mean lifetime (s) for emit-rate maths. */
  life: number;
  /** Horizontal wind speed (m/s at strength 1) and fall speed (+ = down). */
  windSpeed: number;
  fall: number;
  /** Spread of the per-particle velocity. */
  jitter: number;
  emitter: Vector3;
  /** Emit-box height above the camera. */
  above: number;
}

/** Hard ceiling on live weather particles (all tiers). */
export const WEATHER_MAX_PARTICLES = 360;

/**
 * Maps a render profile's particle budget to a weather budget. Basic (Telegram)
 * has no dust budget but still gets a light, readable weather layer.
 */
export function weatherBudget(p: { dust: number }): number {
  return Math.round(Math.min(WEATHER_MAX_PARTICLES, 70 + p.dust * 0.95));
}

const c4 = (r: number, g: number, b: number, a: number) => new Color4(r, g, b, a);

export class WeatherFx {
  readonly layers: Layer[] = [];
  /** Lightning flash 0..1 (storm only); feed it to Sky.setFlash. */
  flash = 0;
  private budget = 120;
  private enabled = true;
  private ownTexture: DynamicTexture | null = null;
  private flashTimer = 6;
  private seed = 1;
  private disposed = false;

  constructor(
    scene: Scene,
    texture: Texture | null,
    private readonly follow: { position: Vector3 },
    readonly kind: WeatherKind,
    readonly intensity = 0.6,
  ) {
    let tex = texture;
    if (!tex && kind !== "none") {
      const t = new DynamicTexture("gf-weather-tex", { width: 32, height: 32 }, scene, false);
      const ctx = t.getContext() as CanvasRenderingContext2D;
      const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.4, "rgba(255,255,255,0.55)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 32, 32);
      t.hasAlpha = true;
      t.update();
      this.ownTexture = t;
      tex = t;
    }
    const add = (name: string, o: Omit<Layer, "ps" | "emitter"> & { size: [number, number]; stretch?: number; colors: [Color4, Color4]; additive?: boolean; box: number; depth: number; spin?: boolean }) => {
      const cap = Math.max(8, Math.ceil(WEATHER_MAX_PARTICLES * o.share));
      const ps = new ParticleSystem(`gf-weather-${name}`, cap, scene);
      const emitter = new Vector3();
      ps.particleTexture = tex;
      ps.emitter = emitter;
      ps.minEmitBox = new Vector3(-o.box, -o.depth, -o.box);
      ps.maxEmitBox = new Vector3(o.box, o.depth, o.box);
      ps.minSize = o.size[0];
      ps.maxSize = o.size[1];
      if (o.stretch) {
        ps.minScaleY = o.stretch * 0.7;
        ps.maxScaleY = o.stretch * 1.3;
        ps.billboardMode = ParticleSystem.BILLBOARDMODE_STRETCHED;
      }
      ps.minLifeTime = o.life * 0.7;
      ps.maxLifeTime = o.life * 1.3;
      ps.minEmitPower = 1;
      ps.maxEmitPower = 1;
      ps.emitRate = 0;
      ps.color1 = o.colors[0];
      ps.color2 = o.colors[1];
      ps.colorDead = c4(o.colors[1].r, o.colors[1].g, o.colors[1].b, 0);
      if (o.spin) {
        ps.minAngularSpeed = -2;
        ps.maxAngularSpeed = 2;
      }
      ps.blendMode = o.additive ? ParticleSystem.BLENDMODE_ADD : ParticleSystem.BLENDMODE_STANDARD;
      ps.gravity = new Vector3(0, 0, 0);
      ps.start();
      this.layers.push({ ps, emitter, share: o.share, life: o.life, windSpeed: o.windSpeed, fall: o.fall, jitter: o.jitter, above: o.above });
    };

    switch (kind) {
      case "snow":
        add("snow", { share: 1, life: 7, windSpeed: 2.5, fall: 1.8, jitter: 0.6, above: 10, size: [0.06, 0.15], colors: [c4(1, 1, 1, 0.85), c4(0.85, 0.92, 1, 0.7)], box: 28, depth: 9, spin: true });
        break;
      case "blizzard":
        add("snow", { share: 0.62, life: 4, windSpeed: 9, fall: 2.6, jitter: 1.6, above: 7, size: [0.05, 0.13], colors: [c4(1, 1, 1, 0.9), c4(0.85, 0.92, 1, 0.75)], box: 26, depth: 8, spin: true });
        add("drift", { share: 0.38, life: 1.6, windSpeed: 16, fall: 0.3, jitter: 2, above: 1.5, size: [0.25, 0.6], stretch: 5, colors: [c4(0.92, 0.96, 1, 0.22), c4(0.8, 0.88, 1, 0.14)], box: 24, depth: 2.5 });
        break;
      case "ash":
        add("ash", { share: 0.68, life: 8, windSpeed: 2, fall: 0.9, jitter: 0.5, above: 9, size: [0.05, 0.14], colors: [c4(0.38, 0.35, 0.34, 0.8), c4(0.22, 0.2, 0.2, 0.7)], box: 28, depth: 9, spin: true });
        add("embers", { share: 0.32, life: 3, windSpeed: 3, fall: -1.6, jitter: 1.2, above: -2, size: [0.04, 0.1], colors: [c4(1, 0.55, 0.15, 1), c4(1, 0.82, 0.35, 0.9)], additive: true, box: 22, depth: 3 });
        break;
      case "spores":
        add("spores", { share: 1, life: 7, windSpeed: 1.2, fall: -0.25, jitter: 0.5, above: 2, size: [0.05, 0.16], colors: [c4(0.45, 1, 0.3, 0.75), c4(0.8, 0.35, 1, 0.55)], additive: true, box: 24, depth: 6 });
        break;
      case "pollen":
        add("pollen", { share: 0.8, life: 8, windSpeed: 1.4, fall: 0.12, jitter: 0.4, above: 3, size: [0.04, 0.1], colors: [c4(1, 0.92, 0.5, 0.8), c4(0.7, 1, 0.75, 0.6)], additive: true, box: 24, depth: 6 });
        add("fluff", { share: 0.2, life: 10, windSpeed: 1.8, fall: 0.2, jitter: 0.5, above: 4, size: [0.14, 0.26], colors: [c4(1, 1, 0.95, 0.55), c4(0.95, 1, 0.92, 0.45)], box: 22, depth: 6, spin: true });
        break;
      case "storm":
        add("rain", { share: 0.74, life: 0.9, windSpeed: 7, fall: 22, jitter: 1.5, above: 14, size: [0.05, 0.08], stretch: 9, colors: [c4(0.8, 0.85, 1, 0.38), c4(0.7, 0.75, 0.95, 0.28)], box: 22, depth: 5 });
        add("spray", { share: 0.26, life: 2, windSpeed: 12, fall: 0.2, jitter: 1.5, above: 1, size: [0.3, 0.7], stretch: 4, colors: [c4(0.85, 0.8, 0.9, 0.14), c4(0.7, 0.66, 0.8, 0.1)], box: 24, depth: 2 });
        break;
      case "dust":
        add("dust", { share: 1, life: 6, windSpeed: 2.5, fall: 0, jitter: 0.4, above: 2, size: [0.04, 0.12], colors: [c4(1, 0.85, 0.75, 0.4), c4(0.8, 0.7, 0.65, 0.3)], additive: true, box: 25, depth: 7 });
        break;
      case "none":
        break;
    }
  }

  /** Total live-particle cap across layers (see weatherBudget). */
  setBudget(n: number): void {
    this.budget = Math.max(0, Math.min(WEATHER_MAX_PARTICLES, n));
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) for (const l of this.layers) l.ps.emitRate = 0;
  }

  get liveParticles(): number {
    return this.layers.reduce((n, l) => n + l.ps.getActiveCount(), 0);
  }

  private rand(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  update(dt: number, wind: WeatherWind): void {
    if (this.disposed) return;
    const p = this.follow.position;
    const len = Math.hypot(wind.x, wind.z) || 1;
    const wx = wind.x / len, wz = wind.z / len;
    const gust = Math.max(0.2, wind.strength);
    for (const l of this.layers) {
      const ws = l.windSpeed * gust * (0.6 + this.intensity * 0.6);
      const vx = wx * ws, vz = wz * ws, vy = -l.fall;
      // Spawn upwind so particles drift through the camera's neighbourhood.
      const lead = Math.min(l.life * 0.45, 4);
      l.emitter.set(p.x - vx * lead, p.y + l.above - vy * lead * 0.3, p.z - vz * lead);
      const j = l.jitter;
      l.ps.direction1.set(vx - j, vy - j * 0.3, vz - j);
      l.ps.direction2.set(vx + j, vy + j * 0.3, vz + j);
      const rate = this.enabled ? (this.budget * l.share * Math.min(1, 0.35 + this.intensity)) / l.life : 0;
      l.ps.emitRate = rate;
    }
    // Storm lightning: rare flashes with a fast decay.
    if (this.kind === "storm" && this.enabled) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) {
        this.flash = 1;
        this.flashTimer = 5 + this.rand() * 14 * (1.2 - this.intensity);
      }
    }
    this.flash = Math.max(0, this.flash - dt * 3.2);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const l of this.layers) l.ps.dispose(false);
    this.layers.length = 0;
    this.ownTexture?.dispose();
    this.ownTexture = null;
  }
}
