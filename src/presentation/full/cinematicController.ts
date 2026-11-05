/**
 * Performance-governed promotion of the Android "cinematic space" effect level (M8, Full package only).
 *
 * Principle: GPU load is only RAISED after the device has demonstrated, with measurements taken in this very session, that it
 * is holding its frame-rate target cleanly; every raise is then verified and rolled back if it costs frames. Nothing here
 * assumes a device can reach any frame rate: a device that never produces a clean window never leaves level 0.
 *
 * Pure and deterministic (no Babylon, no clocks, no DOM): it is fed frame durations and returns decisions, so the policy is
 * unit-tested (tests/cinematic-controller.test.ts) and the visual layer cannot weaken it.
 *
 * Why "miss rate" and not "headroom": with vsync a GPU that is 40 % idle and one that is 1 % idle both show ~16.7 ms frames at
 * 60 Hz, so frame time alone cannot reveal headroom. We therefore promote on a clean window (almost no missed frames), then
 * VERIFY the new level and roll back on misses. Level 0 is also the measurement baseline, recorded before the first promotion.
 */
export type CinematicLevel = 0 | 1 | 2 | 3;
export const CINEMATIC_MAX: CinematicLevel = 3;

export interface FrameStats {
  frames: number;
  avgMs: number;
  p95Ms: number;
  p99Ms: number;
  /** Fraction of frames slower than 1.5× the target period (a visibly missed frame). */
  missFraction: number;
}

export interface CinematicContext {
  /** Frame-rate target the device is held to (the render profile's targetFps). */
  targetFps: number;
  /** Highest level this tier/device may ever use. */
  ceiling: CinematicLevel;
  /** False for software renderers / unmeasurable environments: no promotion, ever. */
  trusted: boolean;
  /** Number of effect reductions the adaptive quality governor has applied (any > 0 blocks promotion). */
  reductions: number;
  /** Current dynamic resolution scale and its maximum (below max means the governor is already struggling). */
  renderScale: number;
  maxRenderScale: number;
  /** Android PowerManager thermal status 0 (none) … 6 (shutdown) when the host reports one. */
  thermal?: number | null;
}

export interface CinematicChange {
  from: CinematicLevel;
  to: CinematicLevel;
  reason: string;
  /** Stats of the window that triggered the change. */
  stats: FrameStats;
}

export const CINEMATIC_TUNING = {
  /** Ignore this long after any change: shader warm-up and texture upload hitches. */
  settleMs: 3000,
  /** A clean window this long is required before raising the level. */
  promoteWindowMs: 8000,
  /** After a raise, the new level must hold for this long (after settling) or it is rolled back. */
  verifyWindowMs: 6000,
  /** Window for protective demotion once running. */
  guardWindowMs: 2500,
  /** Clean window: miss fraction at most this and p99 within 1.25× the period. */
  cleanMissFraction: 0.01,
  cleanP99Periods: 1.25,
  /** Demote when this fraction of frames miss the period by 50 % (or p95 is 1.5× over). */
  demoteMissFraction: 0.05,
  /** Verification is a little more tolerant than steady state: transient scene changes happen. */
  verifyMissFraction: 0.03,
  /** After a rollback the level is not retried for this long; after two rollbacks of the same level, not again this session. */
  retryLockMs: 90_000,
  maxRollbacksPerLevel: 2,
  maxFramesKept: 6000,
} as const;

export function frameStats(framesMs: readonly number[], targetFps: number): FrameStats {
  const n = framesMs.length;
  if (n === 0) return { frames: 0, avgMs: 0, p95Ms: 0, p99Ms: 0, missFraction: 0 };
  const sorted = [...framesMs].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(n - 1, Math.floor(p * n))];
  const period = 1000 / targetFps;
  let sum = 0, miss = 0;
  for (const f of framesMs) {
    sum += f;
    if (f > period * 1.5) miss++;
  }
  return { frames: n, avgMs: sum / n, p95Ms: q(0.95), p99Ms: q(0.99), missFraction: miss / n };
}

export class CinematicController {
  level: CinematicLevel = 0;
  /** Stats of the level-0 window recorded just before the first promotion (the "before" half of every before/after). */
  baseline: FrameStats | null = null;
  readonly changes: (CinematicChange & { atMs: number })[] = [];

  private frames: number[] = [];
  private windowMs = 0;
  private settleLeft: number = CINEMATIC_TUNING.settleMs;
  private verifying = false;
  private clockMs = 0;
  private lockUntil = 0;
  private readonly rollbacks: Record<number, number> = {};
  private forced: CinematicLevel | null = null;

  /** Test/diagnostic override (e.g. `?cinematic=3`): the level is pinned and never moves. */
  force(level: CinematicLevel | null): void {
    this.forced = level;
    if (level !== null) this.setLevel(level);
  }

  get blocked(): number[] {
    return Object.entries(this.rollbacks).filter(([, n]) => n >= CINEMATIC_TUNING.maxRollbacksPerLevel).map(([l]) => Number(l));
  }

  /** Feed one frame (milliseconds). Returns a change when the level moved. */
  frame(dtMs: number, ctx: CinematicContext): CinematicChange | null {
    if (!(dtMs > 0) || !Number.isFinite(dtMs)) return null;
    this.clockMs += dtMs;
    if (this.forced !== null) return null;
    const T = CINEMATIC_TUNING;

    // Hard guards that act at any time, before the settle period.
    // 3 = SEVERE: back off completely. 2 = MODERATE blocks any further raise (checked at promotion).
    const hot = typeof ctx.thermal === "number" && ctx.thermal >= 3;
    if (this.level > 0 && (hot || !ctx.trusted)) return this.move(0, hot ? `thermal status ${ctx.thermal}` : "measurements not trustworthy", ctx, false);
    if (this.level > ctx.ceiling) return this.move(ctx.ceiling, "above the tier/device ceiling", ctx, false);
    if (this.level > 0 && (ctx.reductions > 0 || ctx.renderScale < ctx.maxRenderScale - 0.1)) return this.move((this.level - 1) as CinematicLevel, "adaptive quality governor is already reducing effects", ctx, true);

    if (this.settleLeft > 0) {
      this.settleLeft -= dtMs;
      return null;
    }
    this.frames.push(dtMs);
    if (this.frames.length > T.maxFramesKept) this.frames.shift();
    this.windowMs += dtMs;

    // Protective demotion while running (short window).
    if (this.level > 0 && this.windowMs >= T.guardWindowMs) {
      const st = frameStats(this.frames, ctx.targetFps);
      const limit = this.verifying ? T.verifyMissFraction : T.demoteMissFraction;
      if (st.missFraction > limit || st.p95Ms > (1000 / ctx.targetFps) * 1.5) {
        return this.move((this.level - 1) as CinematicLevel, `missed frames ${(st.missFraction * 100).toFixed(1)} % (p95 ${st.p95Ms.toFixed(1)} ms) at level ${this.level}`, ctx, true, st);
      }
    }

    if (this.verifying) {
      if (this.windowMs >= T.verifyWindowMs) {
        this.verifying = false;
        this.resetWindow();
      }
      return null;
    }

    // Promotion needs a long clean window, headroom evidence, no governor pressure, and an allowed level.
    const next = (this.level + 1) as CinematicLevel;
    if (next > ctx.ceiling || !ctx.trusted || ctx.reductions > 0 || (typeof ctx.thermal === "number" && ctx.thermal >= 2) || ctx.renderScale < ctx.maxRenderScale - 0.1 || this.clockMs < this.lockUntil || this.rollbacks[next] >= T.maxRollbacksPerLevel) return null;
    if (this.windowMs < T.promoteWindowMs) return null;
    const st = frameStats(this.frames, ctx.targetFps);
    const period = 1000 / ctx.targetFps;
    const clean = st.missFraction <= T.cleanMissFraction && st.p99Ms <= period * T.cleanP99Periods;
    if (!clean) {
      // Keep measuring over a sliding window rather than waiting for a perfect fixed window.
      this.frames = this.frames.slice(-Math.ceil((T.promoteWindowMs / period) * 0.5));
      this.windowMs = this.frames.reduce((a, b) => a + b, 0);
      return null;
    }
    if (this.level === 0) this.baseline = st;
    return this.move(next, `clean ${(this.windowMs / 1000).toFixed(0)} s window (miss ${(st.missFraction * 100).toFixed(1)} %, p99 ${st.p99Ms.toFixed(1)} ms)`, ctx, false, st);
  }

  private setLevel(l: CinematicLevel): void {
    this.level = l;
    this.verifying = false;
    this.settleLeft = CINEMATIC_TUNING.settleMs;
    this.resetWindow();
  }

  private resetWindow(): void {
    this.frames = [];
    this.windowMs = 0;
  }

  private move(to: CinematicLevel, reason: string, ctx: CinematicContext, rollback: boolean, st?: FrameStats): CinematicChange {
    const from = this.level;
    const stats = st ?? frameStats(this.frames, ctx.targetFps);
    this.setLevel(to);
    if (rollback) {
      this.rollbacks[from] = (this.rollbacks[from] ?? 0) + 1;
      this.lockUntil = this.clockMs + CINEMATIC_TUNING.retryLockMs;
    } else if (to > from) {
      this.verifying = true;
    }
    const ch = { from, to, reason, stats };
    this.changes.push({ ...ch, atMs: this.clockMs });
    if (this.changes.length > 50) this.changes.shift();
    return ch;
  }
}

/** Highest cinematic level a tier/device may ever reach. Software renderers and weak hardware never exceed 0. */
export function cinematicCeiling(tier: "basic" | "enhanced" | "ultra", flagship: boolean): CinematicLevel {
  if (tier === "basic") return 0;
  if (tier === "enhanced") return 1;
  return flagship ? 3 : 2;
}
