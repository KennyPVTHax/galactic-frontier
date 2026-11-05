/**
 * Runtime quality governor. Protects a frame-rate floor (and memory) by first
 * lowering render resolution, then switching off the most expensive effects one
 * by one. It never raises effects back on its own (no oscillation); resolution
 * recovers slowly when there is sustained headroom.
 *
 * Sustained frame-rate loss after the first minutes is also how thermal
 * throttling shows up in a browser, so the same path covers overheating.
 */
export type ReductionStep = "bloom" | "particles" | "shadows" | "decor" | "textures";

export const REDUCTION_ORDER: ReductionStep[] = ["bloom", "particles", "shadows", "decor"];

export type GovernorAction = { type: "scale"; scale: number } | { type: "reduce"; step: ReductionStep; reason: string };

export interface GovernorOptions {
  maxScale: number;
  minScale: number;
  targetFps: number;
  enabled?: boolean;
}

export class QualityGovernor {
  scale: number;
  enabled: boolean;
  readonly reductions: ReductionStep[] = [];
  avgFps: number;
  private low = 0;
  private high = 0;
  private atFloor = 0;
  private warmup = 3;
  private memoryWarned = false;

  constructor(private opts: GovernorOptions) {
    this.scale = opts.maxScale;
    this.enabled = opts.enabled ?? true;
    this.avgFps = opts.targetFps + 10;
  }

  reset(opts: GovernorOptions): void {
    this.opts = opts;
    this.scale = opts.maxScale;
    this.reductions.length = 0;
    this.low = this.high = this.atFloor = 0;
    this.warmup = 3;
    this.avgFps = opts.targetFps + 10;
  }

  /**
   * @param fps instantaneous frames per second
   * @param heapRatio used JS heap / heap limit when the browser exposes it (0..1)
   */
  update(dt: number, fps: number, heapRatio?: number): GovernorAction[] {
    const out: GovernorAction[] = [];
    if (!this.enabled || !Number.isFinite(fps) || fps <= 0 || dt <= 0) return out;
    // Ignore shader-compile hitches right after a profile change.
    if (this.warmup > 0) {
      this.warmup -= dt;
      return out;
    }
    this.avgFps += (fps - this.avgFps) * Math.min(1, dt * 1.5);
    const t = this.opts.targetFps;

    if (heapRatio !== undefined && heapRatio > 0.85 && !this.memoryWarned && !this.reductions.includes("textures")) {
      this.memoryWarned = true;
      this.reductions.push("textures");
      out.push({ type: "reduce", step: "textures", reason: "memory pressure" });
    }

    if (this.avgFps < t - 3) {
      this.low += dt;
      this.high = 0;
    } else if (this.avgFps > t + 12) {
      this.high += dt;
      this.low = 0;
    } else {
      this.low = 0;
      this.high = 0;
    }

    if (this.low > 2 && this.scale > this.opts.minScale + 1e-6) {
      this.scale = Math.max(this.opts.minScale, +(this.scale - 0.1).toFixed(2));
      this.low = 0;
      out.push({ type: "scale", scale: this.scale });
    } else if (this.scale <= this.opts.minScale + 1e-6 && this.avgFps < t - 3) {
      this.atFloor += dt;
      if (this.atFloor > 5) {
        this.atFloor = 0;
        this.low = 0;
        const next = REDUCTION_ORDER.find((s) => !this.reductions.includes(s));
        if (next) {
          this.reductions.push(next);
          out.push({ type: "reduce", step: next, reason: `sustained ${Math.round(this.avgFps)} fps` });
          this.warmup = 2;
        }
      }
    } else {
      this.atFloor = 0;
    }

    if (this.high > 8 && this.scale < this.opts.maxScale - 1e-6) {
      this.scale = Math.min(this.opts.maxScale, +(this.scale + 0.05).toFixed(2));
      this.high = 0;
      out.push({ type: "scale", scale: this.scale });
    }
    return out;
  }
}
