/**
 * Platform layer: environment detection, GPU capability probe, landscape /
 * fullscreen control, safe-area insets and haptics.
 *
 * Everything takes its globals as parameters so it can be unit-tested with
 * fakes; nothing here touches gameplay state.
 */
import type { GpuCapabilities, PlatformKind } from "../graphics/profiles";

/** Subset of Telegram.WebApp used here (Bot API 7.7 / 8.0 features are feature-checked). */
export interface TelegramWebApp {
  platform?: string;
  initData?: string;
  version?: string;
  isVersionAtLeast?(v: string): boolean;
  ready?(): void;
  expand?(): void;
  requestFullscreen?(): void;
  exitFullscreen?(): void;
  isFullscreen?: boolean;
  lockOrientation?(): void;
  unlockOrientation?(): void;
  isOrientationLocked?: boolean;
  disableVerticalSwipes?(): void;
  enableVerticalSwipes?(): void;
  safeAreaInset?: Insets;
  contentSafeAreaInset?: Insets;
  onEvent?(name: string, cb: (...a: unknown[]) => void): void;
  offEvent?(name: string, cb: (...a: unknown[]) => void): void;
  HapticFeedback?: { impactOccurred?(style: string): void; selectionChanged?(): void; notificationOccurred?(t: string): void };
}

/**
 * JavaScript interface injected by the Android game Activity
 * (see integration-examples/android). All methods optional.
 */
export interface AndroidGameBridge {
  setLandscape?(on: boolean): void;
  haptic?(ms: number): void;
  exitGame?(): void;
  /** Device facts as JSON (model, SoC, WebView version, RAM, refresh rate) for performance reports. */
  deviceInfo?(): string;
  /** Android thermal status 0 (none) … 6 (shutdown). */
  thermalStatus?(): number;
  shareReport?(text: string): void;
  saveReport?(text: string): string;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface PlatformInfo {
  kind: PlatformKind;
  isTouch: boolean;
  telegram: TelegramWebApp | null;
  android: AndroidGameBridge | null;
}

type Win = Window & typeof globalThis & { Telegram?: { WebApp?: TelegramWebApp }; OrbitBtcGame?: AndroidGameBridge };

export function detectPlatform(win: Win = window as Win): PlatformInfo {
  const nav = win.navigator;
  const ua = nav?.userAgent ?? "";
  const tg = win.Telegram?.WebApp;
  const telegram = tg && tg.platform && tg.platform !== "unknown" ? tg : null;
  const android = win.OrbitBtcGame ?? null;
  const isTouch = (nav?.maxTouchPoints ?? 0) > 0 || (typeof win.matchMedia === "function" && win.matchMedia("(pointer: coarse)").matches);
  let kind: PlatformKind;
  if (telegram) kind = "telegram";
  else if (android) kind = "android-app";
  else if (/Android/i.test(ua)) kind = "android-browser";
  else if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && (nav?.maxTouchPoints ?? 0) > 1)) kind = "ios-browser";
  else kind = "desktop";
  return { kind, isTouch, telegram, android };
}

/** Reads GPU limits from a WebGL context (created on a throwaway canvas if none given). */
export function probeGpu(gl?: WebGLRenderingContext | WebGL2RenderingContext | null, nav: Navigator = navigator): GpuCapabilities {
  let ctx = gl ?? null;
  if (!ctx && typeof document !== "undefined") {
    const c = document.createElement("canvas");
    ctx = (c.getContext("webgl2") as WebGL2RenderingContext | null) ?? (c.getContext("webgl") as WebGLRenderingContext | null);
  }
  const webgl2 = typeof WebGL2RenderingContext !== "undefined" && ctx instanceof WebGL2RenderingContext;
  let renderer: string | undefined;
  let maxTextureSize = 2048;
  if (ctx) {
    maxTextureSize = ctx.getParameter(ctx.MAX_TEXTURE_SIZE) as number;
    const dbg = ctx.getExtension("WEBGL_debug_renderer_info");
    if (dbg) renderer = String(ctx.getParameter(dbg.UNMASKED_RENDERER_WEBGL));
  }
  const ua = nav.userAgent ?? "";
  return {
    webgl2,
    maxTextureSize,
    renderer,
    deviceMemoryGb: (nav as Navigator & { deviceMemory?: number }).deviceMemory,
    cores: nav.hardwareConcurrency,
    isMobile: /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || nav.maxTouchPoints > 1,
  };
}

// ------------------------------------------------------------------ haptics

export type HapticKind = "tick" | "light" | "medium" | "heavy";

export function createHaptics(p: PlatformInfo, nav: Navigator = navigator): (k: HapticKind) => void {
  let last = 0;
  return (k) => {
    const now = Date.now();
    if (k === "tick" && now - last < 40) return;
    last = now;
    try {
      if (p.telegram?.HapticFeedback) {
        if (k === "tick") p.telegram.HapticFeedback.selectionChanged?.();
        else p.telegram.HapticFeedback.impactOccurred?.(k);
      } else if (p.android?.haptic) p.android.haptic(k === "tick" ? 8 : k === "light" ? 12 : k === "medium" ? 20 : 35);
      else if (p.isTouch && typeof nav.vibrate === "function") nav.vibrate(k === "tick" ? 6 : k === "light" ? 10 : k === "medium" ? 18 : 30);
    } catch {
      /* haptics are best-effort */
    }
  };
}

// ------------------------------------------------------------------ orientation / fullscreen

export interface OrientationState {
  landscape: boolean;
  /** Show the "rotate your device" prompt. */
  rotateHint: boolean;
  fullscreen: boolean;
  orientationLocked: boolean;
  insets: Insets;
}

const ZERO: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * Puts the game into immersive landscape on each platform:
 *  - Telegram (Bot API 8.0+): requestFullscreen, disableVerticalSwipes, and
 *    lockOrientation once the device is in landscape (Telegram locks the
 *    CURRENT orientation; it cannot force a rotation).
 *  - Android app: asks the host Activity via the JS bridge.
 *  - Mobile browsers: Fullscreen API + screen.orientation.lock("landscape").
 *  - Anywhere landscape cannot be forced: a rotate-device prompt.
 * Call enter() from a user gesture (tap/click). exit() restores everything.
 */
export class OrientationController {
  state: OrientationState;
  private inGame = false;
  private hintDismissed = false;
  private weRequestedFullscreen = false;
  private weLockedTelegram = false;
  private disposers: (() => void)[] = [];

  constructor(
    private readonly p: PlatformInfo,
    private readonly win: Win,
    private readonly onChange: (s: OrientationState) => void,
  ) {
    this.state = { landscape: this.isLandscape(), rotateHint: false, fullscreen: false, orientationLocked: false, insets: { ...ZERO } };
    const onResize = () => this.refresh();
    win.addEventListener("resize", onResize);
    win.addEventListener("orientationchange", onResize);
    this.disposers.push(() => {
      win.removeEventListener("resize", onResize);
      win.removeEventListener("orientationchange", onResize);
    });
    const tg = p.telegram;
    if (tg?.onEvent) {
      const onTg = () => this.refresh();
      for (const ev of ["fullscreenChanged", "safeAreaChanged", "contentSafeAreaChanged", "viewportChanged"]) tg.onEvent(ev, onTg);
      const onFail = () => this.refresh();
      tg.onEvent("fullscreenFailed", onFail);
      this.disposers.push(() => {
        for (const ev of ["fullscreenChanged", "safeAreaChanged", "contentSafeAreaChanged", "viewportChanged"]) tg.offEvent?.(ev, onTg);
        tg.offEvent?.("fullscreenFailed", onFail);
      });
    }
    // Android host pushes system bar / cutout insets here.
    (win as unknown as { __gfSetInsets?: (t: number, r: number, b: number, l: number) => void }).__gfSetInsets = (t, r, b, l) => {
      this.bridgeInsets = { top: t, right: r, bottom: b, left: l };
      this.refresh();
    };
    this.refresh();
  }

  private bridgeInsets: Insets | null = null;

  isLandscape(): boolean {
    return this.win.innerWidth >= this.win.innerHeight;
  }

  private tgAtLeast(v: string): boolean {
    const tg = this.p.telegram;
    if (!tg) return false;
    try {
      return tg.isVersionAtLeast ? tg.isVersionAtLeast(v) : false;
    } catch {
      return false;
    }
  }

  /** Must run inside a user gesture. */
  async enter(): Promise<void> {
    this.inGame = true;
    const tg = this.p.telegram;
    try {
      if (tg) {
        tg.ready?.();
        tg.expand?.();
        if (this.tgAtLeast("7.7")) tg.disableVerticalSwipes?.();
        if (this.tgAtLeast("8.0") && !tg.isFullscreen) {
          tg.requestFullscreen?.();
          this.weRequestedFullscreen = true;
        }
      } else if (this.p.android?.setLandscape) {
        this.p.android.setLandscape(true);
      } else if (this.p.isTouch) {
        const doc = this.win.document;
        const el = doc.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
        if (!doc.fullscreenElement) {
          if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: "hide" } as FullscreenOptions);
          else await el.webkitRequestFullscreen?.();
          this.weRequestedFullscreen = true;
        }
        const so = this.win.screen?.orientation as (ScreenOrientation & { lock?: (o: string) => Promise<void> }) | undefined;
        if (so?.lock) await so.lock("landscape");
      }
    } catch {
      /* not permitted here (iOS, sandboxed iframe, desktop): rotate prompt covers it */
    }
    this.refresh();
  }

  exit(): void {
    this.inGame = false;
    const tg = this.p.telegram;
    try {
      if (tg) {
        if (this.weLockedTelegram) tg.unlockOrientation?.();
        if (this.weRequestedFullscreen && tg.isFullscreen) tg.exitFullscreen?.();
        if (this.tgAtLeast("7.7")) tg.enableVerticalSwipes?.();
      } else if (this.p.android?.setLandscape) {
        this.p.android.setLandscape(false);
      } else {
        const so = this.win.screen?.orientation as (ScreenOrientation & { unlock?: () => void }) | undefined;
        so?.unlock?.();
        if (this.weRequestedFullscreen && this.win.document.fullscreenElement) void this.win.document.exitFullscreen?.();
      }
    } catch {
      /* ignore */
    }
    this.weLockedTelegram = false;
    this.weRequestedFullscreen = false;
    this.refresh();
  }

  /** "Play in portrait anyway". */
  dismissHint(): void {
    this.hintDismissed = true;
    this.refresh();
  }

  refresh(): void {
    const landscape = this.isLandscape();
    const tg = this.p.telegram;
    // Telegram can only lock the orientation the device is already in.
    if (tg && this.inGame && landscape && this.tgAtLeast("8.0") && !tg.isOrientationLocked) {
      try {
        tg.lockOrientation?.();
        this.weLockedTelegram = true;
      } catch {
        /* ignore */
      }
    }
    const fullscreen = tg ? !!tg.isFullscreen : !!this.win.document?.fullscreenElement || !!this.p.android;
    this.state = {
      landscape,
      rotateHint: this.inGame && this.p.isTouch && !landscape && !this.hintDismissed,
      fullscreen,
      orientationLocked: tg ? !!tg.isOrientationLocked : false,
      insets: this.computeInsets(),
    };
    this.onChange(this.state);
  }

  private computeInsets(): Insets {
    const tg = this.p.telegram;
    if (tg) {
      const a = tg.safeAreaInset ?? ZERO;
      const b = tg.contentSafeAreaInset ?? ZERO;
      return { top: (a.top ?? 0) + (b.top ?? 0), right: (a.right ?? 0) + (b.right ?? 0), bottom: (a.bottom ?? 0) + (b.bottom ?? 0), left: (a.left ?? 0) + (b.left ?? 0) };
    }
    return this.bridgeInsets ? { ...this.bridgeInsets } : { ...ZERO };
  }

  dispose(): void {
    if (this.inGame) this.exit();
    for (const d of this.disposers) d();
    delete (this.win as unknown as { __gfSetInsets?: unknown }).__gfSetInsets;
  }
}
