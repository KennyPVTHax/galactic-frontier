import { test } from "node:test";
import assert from "node:assert/strict";
import { PerfRecorder, isSoftwareRenderer, lowFps, percentile, summarize, type PerfContext } from "../src/core/perfRecorder";

const ctx = (over: Partial<PerfContext> = {}, renderer = "Adreno (TM) 740"): PerfContext => ({
  appVersion: "0.7.0",
  platform: "android-app",
  tier: "ultra",
  tierReason: "setting",
  adaptiveResolution: true,
  resolutionPreference: 1,
  devicePixelRatio: 3,
  canvas: { width: 2400, height: 1080 },
  gl: { renderer, webgl2: true, maxTextureSize: 8192 },
  userAgent: "test",
  screen: { width: 2400, height: 1080 },
  planet: "aetherion",
  scene: { meshes: 1000, activeMeshes: 300, drawCalls: 160, trianglesK: 390 },
  activity: "combat",
  ...over,
});

test("constant 60 fps: average, 1% low and percentiles are exact", () => {
  const r = new PerfRecorder(10);
  r.start();
  for (let i = 0; i < 3000; i++) r.frame(1000 / 60);
  const rep = r.report(ctx());
  assert.equal(rep.frames, 3000);
  assert.ok(Math.abs(rep.avgFps - 60) < 0.2, `avg ${rep.avgFps}`);
  assert.ok(Math.abs(rep.low1PctFps - 60) < 0.2);
  assert.equal(rep.frameMs.p50, 16.67);
  assert.equal(rep.slowFramesPct.over33_3ms, 0);
  assert.equal(rep.schema, "gf-perf-1");
  assert.equal(rep.trustworthy, true);
});

test("1% low reflects rare long frames that the average hides", () => {
  const ms: number[] = [];
  for (let i = 0; i < 1000; i++) ms.push(i % 100 === 0 ? 100 : 16.67); // 10 frames of 100 ms (1%)
  const low = lowFps(ms);
  assert.ok(Math.abs(low - 10) < 0.01, `1% low ${low}`);
  const r = new PerfRecorder();
  r.start();
  ms.forEach((m) => r.frame(m));
  const rep = r.report(ctx());
  assert.ok(rep.avgFps > 50, "average still looks healthy");
  assert.ok(rep.low1PctFps < 11, "1% low exposes the stutter");
  assert.equal(rep.frameMs.max, 100);
  assert.ok(rep.slowFramesPct.over33_3ms >= 0.9 && rep.slowFramesPct.over33_3ms <= 1.1);
});

test("percentile helper and degenerate inputs", () => {
  assert.equal(percentile([], 50), 0);
  assert.equal(percentile([5], 99), 5);
  assert.equal(percentile([1, 2, 3, 4], 50), 2);
  assert.equal(lowFps([]), 0);
  const r = new PerfRecorder();
  const rep = r.report(ctx());
  assert.equal(rep.frames, 0);
  assert.equal(rep.avgFps, 0);
  assert.equal(rep.trustworthy, false);
});

test("hidden-tab / bogus frames are ignored; nothing records until started and after stop", () => {
  const r = new PerfRecorder();
  assert.equal(r.frame(16), false, "not recording yet");
  r.start();
  r.frame(0);
  r.frame(-5);
  r.frame(5000); // tab was hidden
  r.frame(16.7);
  assert.equal(r.frameCount, 1);
  r.stop();
  assert.equal(r.frame(16.7), false);
  assert.equal(r.frameCount, 1);
});

test("10 s windows expose throttling over time (fps, heap, resolution scale, thermal)", () => {
  const r = new PerfRecorder(10);
  r.start();
  // 30 s: first 10 s at 60 fps, then thermal throttling to 30 fps with the governor lowering the scale.
  for (let sec = 0; sec < 30; sec++) {
    const ms = sec < 10 ? 1000 / 60 : 1000 / 30;
    const frames = Math.round(1000 / ms);
    for (let i = 0; i < frames; i++) r.frame(ms);
    r.sample({ heapMB: 80 + sec, renderScale: sec < 10 ? 1 : 0.7, thermal: sec < 10 ? 0 : 2 });
  }
  const rep = r.report(ctx());
  assert.equal(rep.windows.length, 3);
  assert.ok(rep.windows[0].avgFps > 55 && rep.windows[2].avgFps < 35, `${rep.windows.map((w) => w.avgFps)}`);
  assert.equal(rep.windows[0].renderScale, 1);
  assert.equal(rep.windows[2].renderScale, 0.7);
  assert.equal(rep.windows[2].thermal, 2);
  assert.equal(rep.thermal.max, 2);
  assert.equal(rep.heapMB.start, 80);
  assert.equal(rep.heapMB.peak, 109);
  assert.equal(rep.renderScale.min, 0.7);
});

test("software renderers are flagged untrustworthy and never presented as device performance", () => {
  assert.equal(isSoftwareRenderer("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)"), true);
  assert.equal(isSoftwareRenderer("llvmpipe (LLVM 15.0.7, 256 bits)"), true);
  assert.equal(isSoftwareRenderer("Adreno (TM) 740"), false);
  assert.equal(isSoftwareRenderer(undefined), false);
  const r = new PerfRecorder();
  r.start();
  for (let i = 0; i < 1200; i++) r.frame(16.7);
  const rep = r.report(ctx({ platform: "desktop" }, "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device), SwiftShader driver)"));
  assert.equal(rep.trustworthy, false);
  assert.ok(rep.caveats.some((c) => /Software-rendered/.test(c)));
  assert.ok(rep.caveats.some((c) => /not an Android device/.test(c)));
  assert.ok(summarize(rep).some((l) => l.startsWith("⚠")));
});

test("short recordings are flagged as statistically weak; a real-device-style report has no caveats", () => {
  const r = new PerfRecorder();
  r.start();
  for (let i = 0; i < 100; i++) r.frame(16.7);
  assert.ok(r.report(ctx()).caveats.some((c) => /Fewer than 600 frames/.test(c)));
  const good = new PerfRecorder();
  good.start();
  for (let i = 0; i < 1800; i++) good.frame(16.7);
  good.sample({ heapMB: 90, renderScale: 1 });
  const rep = good.report(ctx());
  assert.deepEqual(rep.caveats, []);
  assert.equal(rep.trustworthy, true);
});

test("report is plain JSON, carries the preset and device context, and respects the frame cap", () => {
  const r = new PerfRecorder(10, { maxFrames: 50 });
  r.start();
  for (let i = 0; i < 80; i++) r.frame(16.7);
  assert.equal(r.frameCount, 50);
  assert.equal(r.isRecording, false, "stops itself at the cap");
  const rep = r.report(ctx({ nativeDevice: { model: "Test Phone", soc: "X" } }));
  const back = JSON.parse(JSON.stringify(rep));
  assert.equal(back.context.tier, "ultra");
  assert.equal(back.context.nativeDevice.model, "Test Phone");
  assert.equal(back.context.gl.renderer, "Adreno (TM) 740");
  for (const k of ["avgFps", "low1PctFps", "frameMs", "heapMB", "renderScale", "windows", "trustworthy", "caveats"]) assert.ok(k in back, k);
});
