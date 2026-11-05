import { test } from "node:test";
import assert from "node:assert/strict";
import { detectPlatform, OrientationController, createHaptics, type TelegramWebApp } from "../src/platform/platform";

function fakeWin(opts: { w: number; h: number; ua?: string; touch?: boolean; tg?: TelegramWebApp; android?: object }) {
  const listeners: Record<string, (() => void)[]> = {};
  const calls: string[] = [];
  const win: any = {
    innerWidth: opts.w,
    innerHeight: opts.h,
    navigator: { userAgent: opts.ua ?? "Mozilla/5.0 (X11; Linux x86_64)", maxTouchPoints: opts.touch ? 5 : 0, vibrate: (ms: number) => (calls.push(`vibrate:${ms}`), true) },
    matchMedia: () => ({ matches: !!opts.touch }),
    addEventListener: (e: string, f: () => void) => ((listeners[e] ??= []).push(f)),
    removeEventListener: (e: string, f: () => void) => (listeners[e] = (listeners[e] ?? []).filter((x) => x !== f)),
    document: {
      fullscreenElement: null as unknown,
      documentElement: { requestFullscreen: async () => { calls.push("fullscreen"); win.document.fullscreenElement = {}; } },
      exitFullscreen: async () => { calls.push("exitFullscreen"); win.document.fullscreenElement = null; },
    },
    screen: { orientation: { lock: async (o: string) => calls.push(`lock:${o}`), unlock: () => calls.push("unlock") } },
    Telegram: opts.tg ? { WebApp: opts.tg } : undefined,
    OrbitBtcGame: opts.android,
  };
  const rotate = (w: number, h: number) => {
    win.innerWidth = w;
    win.innerHeight = h;
    for (const f of listeners.resize ?? []) f();
  };
  return { win, calls, rotate };
}

function fakeTelegram(version: string, calls: string[]): TelegramWebApp {
  const tg: TelegramWebApp = {
    platform: "android",
    initData: "query_id=1&hash=x",
    version,
    isVersionAtLeast: (v) => parseFloat(version) >= parseFloat(v),
    ready: () => calls.push("tg.ready"),
    expand: () => calls.push("tg.expand"),
    requestFullscreen: () => { calls.push("tg.requestFullscreen"); tg.isFullscreen = true; },
    exitFullscreen: () => { calls.push("tg.exitFullscreen"); tg.isFullscreen = false; },
    lockOrientation: () => { calls.push("tg.lockOrientation"); tg.isOrientationLocked = true; },
    unlockOrientation: () => { calls.push("tg.unlockOrientation"); tg.isOrientationLocked = false; },
    disableVerticalSwipes: () => calls.push("tg.disableVerticalSwipes"),
    enableVerticalSwipes: () => calls.push("tg.enableVerticalSwipes"),
    safeAreaInset: { top: 24, right: 0, bottom: 16, left: 0 },
    contentSafeAreaInset: { top: 46, right: 0, bottom: 0, left: 0 },
    onEvent: () => undefined,
    offEvent: () => undefined,
    HapticFeedback: { impactOccurred: (s) => calls.push(`tg.haptic:${s}`), selectionChanged: () => calls.push("tg.tick") },
  };
  return tg;
}

test("detects Telegram, Android app bridge, Android browser, iOS and desktop", () => {
  const calls: string[] = [];
  assert.equal(detectPlatform(fakeWin({ w: 900, h: 400, touch: true, tg: fakeTelegram("8.0", calls) }).win).kind, "telegram");
  // telegram-web-app.js outside Telegram reports platform "unknown"
  assert.equal(detectPlatform(fakeWin({ w: 900, h: 400, tg: { platform: "unknown" } }).win).kind, "desktop");
  assert.equal(detectPlatform(fakeWin({ w: 900, h: 400, touch: true, ua: "Linux; Android 14; wv", android: {} }).win).kind, "android-app");
  assert.equal(detectPlatform(fakeWin({ w: 900, h: 400, touch: true, ua: "Mozilla/5.0 (Linux; Android 14; Pixel 7)" }).win).kind, "android-browser");
  assert.equal(detectPlatform(fakeWin({ w: 900, h: 400, touch: true, ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)" }).win).kind, "ios-browser");
  assert.equal(detectPlatform(fakeWin({ w: 1920, h: 1080 }).win).kind, "desktop");
});

test("Telegram 8.0: fullscreen on enter, lock only once landscape, restore on exit", async () => {
  const calls: string[] = [];
  const { win, rotate } = fakeWin({ w: 400, h: 860, touch: true, tg: fakeTelegram("8.0", calls) });
  const states: boolean[] = [];
  const oc = new OrientationController(detectPlatform(win), win, (s) => states.push(s.rotateHint));
  await oc.enter();
  assert.ok(calls.includes("tg.requestFullscreen"));
  assert.ok(calls.includes("tg.disableVerticalSwipes"));
  assert.ok(!calls.includes("tg.lockOrientation"), "portrait: must not lock portrait");
  assert.equal(oc.state.rotateHint, true);
  rotate(860, 400);
  assert.ok(calls.includes("tg.lockOrientation"));
  assert.equal(oc.state.rotateHint, false);
  assert.deepEqual(oc.state.insets, { top: 70, right: 0, bottom: 16, left: 0 });
  oc.exit();
  assert.ok(calls.includes("tg.unlockOrientation"));
  assert.ok(calls.includes("tg.exitFullscreen"));
  assert.ok(calls.includes("tg.enableVerticalSwipes"));
});

test("older Telegram (6.x) degrades to expand + rotate prompt", async () => {
  const calls: string[] = [];
  const { win } = fakeWin({ w: 400, h: 860, touch: true, tg: fakeTelegram("6.9", calls) });
  const oc = new OrientationController(detectPlatform(win), win, () => undefined);
  await oc.enter();
  assert.ok(calls.includes("tg.expand"));
  assert.ok(!calls.includes("tg.requestFullscreen"));
  assert.equal(oc.state.rotateHint, true);
});

test("mobile browser requests fullscreen + landscape lock; hint can be dismissed", async () => {
  const { win, calls } = fakeWin({ w: 412, h: 915, touch: true, ua: "Android" });
  const oc = new OrientationController(detectPlatform(win), win, () => undefined);
  await oc.enter();
  assert.deepEqual(calls.slice(0, 2), ["fullscreen", "lock:landscape"]);
  assert.equal(oc.state.rotateHint, true, "fake device did not actually rotate");
  oc.dismissHint();
  assert.equal(oc.state.rotateHint, false);
  oc.exit();
  assert.ok(calls.includes("unlock") && calls.includes("exitFullscreen"));
});

test("Android app bridge controls orientation and receives insets", async () => {
  const bridgeCalls: string[] = [];
  const { win } = fakeWin({ w: 915, h: 412, touch: true, android: { setLandscape: (on: boolean) => bridgeCalls.push(`land:${on}`) } });
  const oc = new OrientationController(detectPlatform(win), win, () => undefined);
  await oc.enter();
  win.__gfSetInsets(0, 32, 18, 32);
  assert.deepEqual(oc.state.insets, { top: 0, right: 32, bottom: 18, left: 32 });
  oc.exit();
  assert.deepEqual(bridgeCalls, ["land:true", "land:false"]);
});

test("desktop never shows the rotate prompt", async () => {
  const { win } = fakeWin({ w: 800, h: 1200 });
  const oc = new OrientationController(detectPlatform(win), win, () => undefined);
  await oc.enter();
  assert.equal(oc.state.rotateHint, false);
});

test("haptics route to Telegram, then vibrate", () => {
  const calls: string[] = [];
  const tg = createHaptics(detectPlatform(fakeWin({ w: 900, h: 400, touch: true, tg: fakeTelegram("8.0", calls) }).win));
  tg("medium");
  assert.ok(calls.includes("tg.haptic:medium"));
  const { win, calls: c2 } = fakeWin({ w: 900, h: 400, touch: true, ua: "Android" });
  createHaptics(detectPlatform(win), win.navigator)("light");
  assert.ok(c2.some((x) => x.startsWith("vibrate")));
});
