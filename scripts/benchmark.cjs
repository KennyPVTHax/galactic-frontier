/**
 * Galactic Frontier benchmark (M3–M6).
 *
 *   npm run build:preview && node scripts/benchmark.cjs [outFile] [seconds]
 *
 * For each profile (Telegram Basic / Desktop Enhanced / Android Extreme HD) it measures
 * load time, frame times while flying (avg FPS, 1% low, p50/p95/p99 frame ms), peak JS heap,
 * draw calls, triangles and texture memory, then warps through every planet twice and records
 * scene resource counts after each transition (leak check).
 *
 * IMPORTANT: this runs in headless Chromium with SwiftShader (CPU software WebGL). Absolute
 * numbers say nothing about real phones or GPUs; use them only to compare builds and tiers
 * on the same machine. Real-device validation is listed in docs/REAL-DEVICE-TESTS.md.
 */
const { chromium, devices } = require("playwright");
const path = require("path");
const fs = require("fs");

const OUT = path.resolve(process.argv[2] || "test-results/benchmark.json");
const SECONDS = Number(process.argv[3] || 12);
const URL = "file://" + path.resolve(__dirname, "../dist/preview/index.html");
const ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-precise-memory-info"];

const RUNS = [
  { name: "telegram-basic", tier: "basic", ctx: { ...devices["Pixel 7"], isMobile: true, hasTouch: true }, viewport: { width: 915, height: 412 } },
  { name: "desktop-enhanced", tier: "enhanced", ctx: {}, viewport: { width: 1280, height: 720 } },
  { name: "android-extreme-hd", tier: "ultra", ctx: { ...devices["Pixel 7"], isMobile: true, hasTouch: true }, viewport: { width: 915, height: 412 } },
];

function pct(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function measureFrames(page, seconds) {
  return page.evaluate(async (sec) => {
    const times = [];
    let peak = 0;
    let last = performance.now();
    const end = last + sec * 1000;
    await new Promise((res) => {
      const tick = (t) => {
        times.push(t - last);
        last = t;
        const m = performance.memory;
        if (m && m.usedJSHeapSize > peak) peak = m.usedJSHeapSize;
        if (t < end) requestAnimationFrame(tick);
        else res();
      };
      requestAnimationFrame(tick);
    });
    return { times: times.slice(1), peakHeapMB: peak ? +(peak / 1048576).toFixed(1) : null };
  }, seconds);
}

function summarize(times) {
  const sorted = [...times].sort((a, b) => a - b);
  const total = times.reduce((a, b) => a + b, 0);
  const worst = sorted.slice(Math.floor(sorted.length * 0.99));
  const low1 = worst.length ? 1000 / (worst.reduce((a, b) => a + b, 0) / worst.length) : null;
  return {
    frames: times.length,
    avgFps: +(1000 / (total / Math.max(1, times.length))).toFixed(2),
    low1PctFps: low1 !== null ? +low1.toFixed(2) : null,
    p50Ms: +pct(sorted, 50).toFixed(1),
    p95Ms: +pct(sorted, 95).toFixed(1),
    p99Ms: +pct(sorted, 99).toFixed(1),
    maxMs: +sorted[sorted.length - 1].toFixed(1),
  };
}

async function sceneCounts(page) {
  return page.evaluate(() => {
    const s = window.__GF.game.scene;
    let unready = 0;
    for (const m of s.meshes) if (m.material && m.isEnabled() && m.isVisible && m.getTotalVertices() > 0) { try { if (!m.material.isReady(m)) unready++; } catch (e) { unready++; } }
    return { meshes: s.meshes.length, materials: s.materials.length, textures: s.textures.length, lights: s.lights.length, particleSystems: s.particleSystems.length, transformNodes: s.transformNodes.length, unreadyMaterials: unready };
  });
}

async function run(browser, r) {
  const ctx = await browser.newContext({ ...r.ctx, viewport: r.viewport });
  ctx.setDefaultTimeout(240000);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const t0 = Date.now();
  await page.goto(`${URL}?debug=1&quality=${r.tier}&start=new&slot=bench-${r.name}`);
  await page.waitForFunction(() => window.__GF && window.__GF.state().mode === "ship", null, { timeout: 240000, polling: 200 });
  const loadMs = Date.now() - t0;
  await page.evaluate(() => {
    window.__GF.setAdaptive(false);
    const g = window.__GF.game;
    g.ship.requestUndock(g.shipEnv);
  });
  await page.waitForFunction(() => window.__GF.state().ship.state === "flying", null, { timeout: 120000 });
  // Cruise over the terrain toward the survey site (camera sees terrain, decor, sky).
  await page.evaluate(() => window.__GF.teleportShip(0, 120, 200, Math.PI));
  await page.evaluate(() => (window.__GF.game.ship.throttle = 0.6));
  const frames = await measureFrames(page, SECONDS);
  const stats = await page.evaluate(() => window.__GF.state().perf);
  const flight = { ...summarize(frames.times), peakHeapMB: frames.peakHeapMB, drawCalls: stats.drawCalls, trianglesK: Math.round(stats.triangles / 1000), textureMB: stats.textureMB, renderScale: stats.renderScale, shadows: stats.shadows };

  // Repeated planet transitions: resources must return to a steady level.
  const transitions = [];
  const order = ["aetherion", "kryos", "pyron", "zephyria", "noctaris", "veyra7"];
  transitions.push({ planet: "veyra7", ...(await sceneCounts(page)) });
  for (let lap = 0; lap < 2; lap++) {
    for (const id of order) {
      const tw = Date.now();
      await page.evaluate((p) => window.__GF.warpNow(p), id);
      await page.waitForTimeout(300);
      const counts = await sceneCounts(page);
      transitions.push({ lap, planet: id, swapMs: Date.now() - tw, ...counts, heapMB: await page.evaluate(() => (performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null)) });
    }
  }
  await ctx.close();
  const lap0 = transitions.filter((t) => t.lap === 0);
  const lap1 = transitions.filter((t) => t.lap === 1);
  const leak = lap1.map((t, i) => ({ planet: t.planet, dMeshes: t.meshes - lap0[i].meshes, dMaterials: t.materials - lap0[i].materials, dTextures: t.textures - lap0[i].textures, dLights: t.lights - lap0[i].lights }));
  return { name: r.name, tier: r.tier, loadMs, flight, transitions, leakLap2VsLap1: leak, errors };
}

(async () => {
  const browser = await chromium.launch({ args: ARGS });
  const results = { note: "Headless Chromium + SwiftShader (CPU). Not representative of real devices.", date: new Date().toISOString(), seconds: SECONDS, runs: [] };
  for (const r of RUNS) {
    const res = await run(browser, r);
    results.runs.push(res);
    const f = res.flight;
    console.log(`${r.name}: load ${res.loadMs} ms · ${f.avgFps} fps avg · 1% low ${f.low1PctFps} · p95 ${f.p95Ms} ms · heap peak ${f.peakHeapMB} MB · ${f.drawCalls} draws · ${f.trianglesK}k tris · tex ${f.textureMB} MB`);
    const worst = res.leakLap2VsLap1.reduce((m, x) => Math.max(m, Math.abs(x.dMeshes), Math.abs(x.dMaterials), Math.abs(x.dTextures), Math.abs(x.dLights)), 0);
    console.log(`  transitions: ${res.transitions.length - 1}, max lap-2 vs lap-1 resource delta ${worst}, max unready materials after a swap ${Math.max(...res.transitions.map((t) => t.unreadyMaterials ?? 0))}, errors ${res.errors.length}`);
  }
  await browser.close();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
  console.log(`Wrote ${OUT}`);
})();
