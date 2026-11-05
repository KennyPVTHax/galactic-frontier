/**
 * Real-device performance recorder (M7).
 *
 * Pure statistics: feed it one frame time per rendered frame, plus an optional sample of
 * memory / render scale / thermal state once a second. It produces a self-describing JSON report.
 *
 * This module never *claims* a performance level. The report carries the measured numbers, the
 * graphics preset, the device and renderer strings, and a `trustworthy` flag that is false when the
 * GPU renderer is a software rasteriser (SwiftShader / llvmpipe), because those numbers say nothing
 * about real hardware.
 */

export interface PerfSample {
  /** JS heap in MB (Chromium-based WebViews expose performance.memory), null if unavailable. */
  heapMB: number | null;
  /** Adaptive resolution scale 0..1 currently applied by the governor. */
  renderScale: number;
  /** Android thermal status 0 (none) … 6 (shutdown), if the host reports it. */
  thermal?: number | null;
}

export interface PerfWindow {
  /** Seconds since recording started at the window end. */
  t: number;
  frames: number;
  avgFps: number;
  low1PctFps: number;
  p95Ms: number;
  heapMB: number | null;
  renderScale: number;
  thermal: number | null;
}

export interface PerfContext {
  appVersion: string;
  platform: string;
  tier: string;
  tierReason: string;
  adaptiveResolution: boolean;
  resolutionPreference: number;
  devicePixelRatio: number;
  canvas: { width: number; height: number };
  gl: { renderer?: string; webgl2: boolean; maxTextureSize: number };
  userAgent: string;
  deviceMemoryGb?: number;
  cores?: number;
  screen: { width: number; height: number };
  /** JSON from the Android host bridge (OrbitBtcGame.deviceInfo()), if present. */
  nativeDevice?: unknown;
  planet: string;
  scene: { meshes: number; activeMeshes: number; drawCalls: number | null; trianglesK: number | null };
  /** What the player was doing, so reports can be compared like with like. */
  activity: string;
  /** Cinematic deep-space controller state (Full package): current level, level-0 baseline, recent promotions/rollbacks. */
  cinematic?: unknown;
}

export interface PerfReport {
  schema: "gf-perf-1";
  generatedAt: string;
  durationSec: number;
  frames: number;
  avgFps: number;
  /** Average FPS of the slowest 1 % of frames ("1 % low"). */
  low1PctFps: number;
  frameMs: { avg: number; p50: number; p95: number; p99: number; max: number };
  /** Share of frames slower than 33.3 ms (below 30 fps) and 16.7 ms (below 60 fps). */
  slowFramesPct: { over16_7ms: number; over33_3ms: number };
  heapMB: { start: number | null; peak: number | null; end: number | null };
  renderScale: { min: number; avg: number; end: number };
  thermal: { start: number | null; max: number | null };
  windows: PerfWindow[];
  context: PerfContext;
  /** False when the renderer is software rasterised: the numbers are not representative of real GPUs. */
  trustworthy: boolean;
  caveats: string[];
}

const SOFTWARE = /(swiftshader|llvmpipe|software|softpipe|basic render driver)/i;

export function isSoftwareRenderer(renderer: string | undefined): boolean {
  return !!renderer && SOFTWARE.test(renderer);
}

export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

/** Average FPS of the slowest `share` fraction of frames (default 1 %). */
export function lowFps(frameMs: number[], share = 0.01): number {
  if (!frameMs.length) return 0;
  const sorted = [...frameMs].sort((a, b) => b - a);
  const n = Math.max(1, Math.ceil(sorted.length * share));
  let sum = 0;
  for (let i = 0; i < n; i++) sum += sorted[i];
  return 1000 / (sum / n);
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

export class PerfRecorder {
  private frameMs: number[] = [];
  private winMs: number[] = [];
  private windows: PerfWindow[] = [];
  private samples: PerfSample[] = [];
  private winStartSample = 0;
  private elapsedMs = 0;
  private winElapsedMs = 0;
  private running = false;
  /** Frames longer than this (tab hidden, debugger) are not counted as gameplay frames. */
  readonly maxFrameMs: number;
  /** Safety cap: ~20 minutes at 60 fps. */
  readonly maxFrames: number;

  constructor(
    private readonly windowSeconds = 10,
    opts: { maxFrameMs?: number; maxFrames?: number } = {},
  ) {
    this.maxFrameMs = opts.maxFrameMs ?? 1000;
    this.maxFrames = opts.maxFrames ?? 72_000;
  }

  get isRecording(): boolean {
    return this.running;
  }
  get frameCount(): number {
    return this.frameMs.length;
  }
  get seconds(): number {
    return this.elapsedMs / 1000;
  }

  start(): void {
    this.frameMs = [];
    this.winMs = [];
    this.windows = [];
    this.samples = [];
    this.winStartSample = 0;
    this.elapsedMs = 0;
    this.winElapsedMs = 0;
    this.running = true;
  }

  /** Stops recording; the data stays available to report(). */
  stop(): void {
    this.running = false;
  }

  /** Call once per rendered frame with the real frame-to-frame time in ms. Returns true while recording. */
  frame(ms: number): boolean {
    if (!this.running) return false;
    if (!(ms > 0) || ms > this.maxFrameMs) return true; // hidden tab / first frame / debugger pause
    if (this.frameMs.length >= this.maxFrames) {
      this.running = false;
      return false;
    }
    this.frameMs.push(ms);
    this.winMs.push(ms);
    this.elapsedMs += ms;
    this.winElapsedMs += ms;
    if (this.winElapsedMs >= this.windowSeconds * 1000) this.closeWindow();
    return true;
  }

  /** Call about once per second while recording. */
  sample(s: PerfSample): void {
    if (this.running) this.samples.push(s);
  }

  private makeWindow(ms: number[], ws: PerfSample[], tEnd: number): PerfWindow {
    const total = ms.reduce((a, b) => a + b, 0);
    const sorted = [...ms].sort((a, b) => a - b);
    const last = ws[ws.length - 1];
    const heaps = ws.map((x) => x.heapMB).filter((x): x is number => x !== null);
    return {
      t: r1(tEnd / 1000),
      frames: ms.length,
      avgFps: r1(1000 / (total / ms.length)),
      low1PctFps: r1(lowFps(ms)),
      p95Ms: r1(percentile(sorted, 95)),
      heapMB: heaps.length ? r1(Math.max(...heaps)) : null,
      renderScale: last ? r2(last.renderScale) : 1,
      thermal: last?.thermal ?? null,
    };
  }

  private closeWindow(): void {
    this.windows.push(this.makeWindow(this.winMs, this.samples.slice(this.winStartSample), this.elapsedMs));
    this.winStartSample = this.samples.length;
    this.winMs = [];
    this.winElapsedMs = 0;
  }

  report(ctx: PerfContext, now: Date = new Date()): PerfReport {
    const ms = this.frameMs;
    const n = ms.length;
    const sorted = [...ms].sort((a, b) => a - b);
    const total = ms.reduce((a, b) => a + b, 0);
    const heaps = this.samples.map((s) => s.heapMB).filter((x): x is number => x !== null);
    const scales = this.samples.map((s) => s.renderScale);
    const thermals = this.samples.map((s) => s.thermal).filter((x): x is number => typeof x === "number");
    const software = isSoftwareRenderer(ctx.gl.renderer);
    const caveats: string[] = [];
    if (software) caveats.push("Software-rendered (SwiftShader/llvmpipe): these FPS numbers are not representative of real GPUs.");
    if (n < 600) caveats.push("Fewer than 600 frames recorded: percentile and 1 % low values are statistically weak. Record at least 60 s.");
    if (heaps.length === 0) caveats.push("JS heap size is not exposed by this browser/WebView.");
    if (ctx.platform !== "android-app" && ctx.platform !== "android-browser") caveats.push(`Recorded on platform "${ctx.platform}", not an Android device.`);
    return {
      schema: "gf-perf-1",
      generatedAt: now.toISOString(),
      durationSec: r1(total / 1000),
      frames: n,
      avgFps: n ? r1(1000 / (total / n)) : 0,
      low1PctFps: r1(lowFps(ms)),
      frameMs: { avg: n ? r2(total / n) : 0, p50: r2(percentile(sorted, 50)), p95: r2(percentile(sorted, 95)), p99: r2(percentile(sorted, 99)), max: n ? r2(sorted[n - 1]) : 0 },
      slowFramesPct: {
        over16_7ms: n ? r1((100 * ms.filter((x) => x > 1000 / 60 + 1).length) / n) : 0,
        over33_3ms: n ? r1((100 * ms.filter((x) => x > 1000 / 30 + 1).length) / n) : 0,
      },
      heapMB: { start: heaps.length ? r1(heaps[0]) : null, peak: heaps.length ? r1(Math.max(...heaps)) : null, end: heaps.length ? r1(heaps[heaps.length - 1]) : null },
      renderScale: { min: scales.length ? r2(Math.min(...scales)) : 1, avg: scales.length ? r2(scales.reduce((a, b) => a + b, 0) / scales.length) : 1, end: scales.length ? r2(scales[scales.length - 1]) : 1 },
      thermal: { start: thermals.length ? thermals[0] : null, max: thermals.length ? Math.max(...thermals) : null },
      // A trailing partial window (>= 3 s) is included so recordings that are not a multiple of the window length keep their tail.
      windows: this.winMs.length > 0 && this.winElapsedMs >= 3000 ? [...this.windows, this.makeWindow(this.winMs, this.samples.slice(this.winStartSample), this.elapsedMs)] : this.windows,
      context: ctx,
      trustworthy: !software && n >= 600,
      caveats,
    };
  }
}

/** One-paragraph human summary for the on-screen result card. */
export function summarize(r: PerfReport): string[] {
  const lines = [
    `${r.context.tier} · ${r.frames} frames · ${r.durationSec}s`,
    `avg ${r.avgFps} fps · 1% low ${r.low1PctFps} fps`,
    `frame ms p50 ${r.frameMs.p50} · p95 ${r.frameMs.p95} · p99 ${r.frameMs.p99} · max ${r.frameMs.max}`,
    `slow frames: >16.7ms ${r.slowFramesPct.over16_7ms}% · >33.3ms ${r.slowFramesPct.over33_3ms}%`,
    `heap ${r.heapMB.start ?? "n/a"} → ${r.heapMB.peak ?? "n/a"} MB peak · res scale min ${r.renderScale.min}`,
  ];
  if (r.thermal.max !== null) lines.push(`thermal status max ${r.thermal.max} (0 = none)`);
  for (const c of r.caveats) lines.push(`⚠ ${c}`);
  return lines;
}
