/**
 * Planet-swap resource-leak regression test (headless Chromium, real game, real WebGL/SwiftShader).
 *
 *   npm run build:preview && node scripts/leak-test.cjs [tier] [laps]
 *
 * Warps through all six planets (spawning hostiles on each so combat visuals are exercised) for several
 * laps, forcing garbage collection at every Veyra-7 checkpoint, and fails if:
 *   1. any scene object count (meshes, materials, textures, lights, particle systems, transform nodes,
 *      geometries, GPU textures, render observers) differs between lap 2 and the last lap;
 *   2. the post-GC JS heap grows more than HEAP_BUDGET_MB between lap 3 and the last lap;
 *   3. an old planet, heightfield, sun/ambient light, sky mesh, orbital environment, weather system or
 *      enemy is still reachable after it has been swapped out (WeakRef check).
 *
 * Bugs this catches (all found and fixed in M7): disposed meshes kept alive by Babylon's shader cache that
 * still listed the old sun; Babylon's shared environment-BRDF texture disposed with the planet.
 */
const { chromium } = require("playwright");
const path = require("path");

const TIER = process.argv[2] || "basic";
const LAPS = Math.max(4, Number(process.argv[3] || 5));
const HEAP_BUDGET_MB = Number(process.env.HEAP_BUDGET_MB || 3);
const URL = "file://" + path.resolve(__dirname, "../dist/preview/index.html");
const ORDER = ["aetherion", "kryos", "pyron", "zephyria", "noctaris", "veyra7"];
const COUNT_KEYS = ["meshes", "materials", "textures", "lights", "particles", "nodes", "geometries", "gpuTextures", "observers"];

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

(async () => {
  const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--js-flags=--expose-gc", "--enable-precise-memory-info"] });
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${URL}?debug=1&quality=${TIER}&start=new&slot=leak${Date.now()}`);
  await page.waitForFunction(() => window.__GF && window.__GF.state().mode === "ship", null, { timeout: 240000 });
  await page.evaluate(() => {
    window.__GF.setAdaptive(false);
    window.__refs = [];
  });

  const snap = () =>
    page.evaluate(async () => {
      window.gc();
      await new Promise((r) => setTimeout(r, 150));
      window.gc();
      const g = window.__GF.game, sc = g.scene, e = g.engine;
      return {
        heapMB: performance.memory.usedJSHeapSize / 1048576,
        meshes: sc.meshes.length, materials: sc.materials.length, textures: sc.textures.length, lights: sc.lights.length,
        particles: sc.particleSystems.length, nodes: sc.transformNodes.length, geometries: sc.geometries.length,
        gpuTextures: e._internalTexturesCache ? e._internalTexturesCache.length : 0,
        observers: sc.onBeforeRenderObservable.observers.length + sc.onAfterRenderObservable.observers.length,
      };
    });

  const laps = [];
  for (let lap = 1; lap <= LAPS; lap++) {
    for (const id of ORDER) {
      // Remember what the current world owns so we can prove it is freed once swapped out.
      await page.evaluate(() => {
        const g = window.__GF.game;
        const r = (name, o) => o && window.__refs.push({ name, ref: new WeakRef(o) });
        r("planet", g.planet); r("heightfield", g.planet.heightfield); r("sun", g.planet.sun); r("ambient", g.planet.ambient);
        r("sky mesh", g.planet.sky && g.planet.sky.mesh); r("orbital environment", g.space); r("weather", g.planet.weather);
        try { window.__GF.spawnEncounter("scout_pair"); } catch (e) { /* no contract context: fine */ }
        r("enemy", g.combat.enemies()[0]);
      });
      await page.waitForTimeout(300);
      await page.evaluate((i) => window.__GF.warpNow(i), id);
      await page.waitForTimeout(250);
    }
    laps.push(await snap());
  }

  // 1. object counts are steady once warm (lap 2 == last lap)
  const a = laps[1], z = laps[laps.length - 1];
  const drift = COUNT_KEYS.filter((k) => a[k] !== z[k]).map((k) => `${k}: ${a[k]}→${z[k]}`);
  check("scene object counts are identical between lap 2 and the last lap", drift.length === 0, drift.join(", ") || COUNT_KEYS.map((k) => `${k}=${z[k]}`).join(" "));

  // 2. heap plateau
  const growth = z.heapMB - laps[2].heapMB;
  check(`JS heap (post-GC) grows < ${HEAP_BUDGET_MB} MB from lap 3 to lap ${LAPS}`, growth < HEAP_BUDGET_MB, `${laps.map((l) => l.heapMB.toFixed(1)).join(" → ")} MB (Δ ${growth.toFixed(2)})`);

  // 3. everything that was swapped out is collectable
  const retained = await page.evaluate(async () => {
    for (let i = 0; i < 4; i++) { window.gc(); await new Promise((r) => setTimeout(r, 200)); }
    const g = window.__GF.game;
    const current = new Set([g.planet, g.space, g.planet.sun, g.planet.ambient, g.planet.sky && g.planet.sky.mesh, g.planet.weather, g.planet.heightfield]);
    const tally = {};
    for (const { name, ref } of window.__refs) {
      const o = ref.deref();
      const t = (tally[name] ||= { created: 0, alive: 0 });
      t.created++;
      if (o && !current.has(o)) t.alive++;
    }
    return tally;
  });
  // The most recent swap's objects may legitimately still be referenced until the next frame; allow none for older ones.
  for (const [name, t] of Object.entries(retained)) check(`old ${name} objects are garbage-collected after a swap`, t.alive === 0, `${t.alive} of ${t.created} still reachable`);

  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await browser.close();
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} leak checks passed (${TIER}, ${LAPS} laps × ${ORDER.length} planets).`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
