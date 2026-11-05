/**
 * Diagnostic for the M1 smoke test's wall-clock walking check. Repeats its exact input
 * (hold W + Shift for 1500 ms of wall-clock time, same viewport, quality and time scale)
 * in the M1 build and the M2 build, and records how many frames ran, how much game time
 * was simulated and how far the astronaut moved. It does not change or replace the smoke test.
 *
 *   node scripts/m2-smoke-timing.cjs <m1-preview.html> [outFile] [trials]
 */
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const M1 = path.resolve(process.argv[2] || path.join(__dirname, "../../m1-baseline/dist/m1-preview.html"));
const OUT = path.resolve(process.argv[3] || "smoke-timing.json");
const TRIALS = +(process.argv[4] || 3);
const M2 = path.resolve(__dirname, "../dist/preview/index.html");
const TIME_SCALE = 3; // same as scripts/smoke-test.cjs

(async () => {
  const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const rows = [];
  for (const [label, file] of [["M1 (low)", M1], ["M2 (low → Basic)", M2]]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    await page.goto(`file://${file}?debug=1&quality=low&slot=timing&start=new`, { timeout: 240000 });
    await page.waitForFunction(() => window.__GF && window.__GF.state().mode === "ship", null, { timeout: 300000 });
    await page.evaluate((ts) => window.__GF.setTimeScale(ts), TIME_SCALE);
    for (let t = 0; t < TRIALS; t++) {
      await page.evaluate(() => {
        const g = window.__GF.game;
        g.ship.placeLanded(g.shipEnv, -150, -60, Math.PI);
        g.disembark();
        g.rig.yaw = Math.PI;
      });
      await page.waitForTimeout(1500);
      await page.evaluate((ts) => {
        const g = window.__GF.game;
        const w = (window.__timing = { frames: 0, sim: 0, p0: { x: g.player.position.x, z: g.player.position.z }, maxSpeed: 0 });
        w.obs = g.scene.onBeforeRenderObservable.add(() => {
          const raw = g.engine.getDeltaTime() / 1000;
          w.frames++;
          w.sim += Math.min(0.05 * ts, Math.max(0, raw) * ts) || 0.016;
          w.maxSpeed = Math.max(w.maxSpeed, Math.hypot(g.player.velocity.x, g.player.velocity.z));
        });
      }, TIME_SCALE);
      await page.keyboard.down("KeyW");
      await page.keyboard.down("ShiftLeft");
      await page.waitForTimeout(1500);
      await page.keyboard.up("ShiftLeft");
      await page.keyboard.up("KeyW");
      const r = await page.evaluate(() => {
        const g = window.__GF.game, w = window.__timing;
        g.scene.onBeforeRenderObservable.remove(w.obs);
        return { frames: w.frames, simSeconds: +w.sim.toFixed(3), moved: +Math.hypot(g.player.position.x - w.p0.x, g.player.position.z - w.p0.z).toFixed(2), maxSpeed: +w.maxSpeed.toFixed(2) };
      });
      rows.push({ build: label, trial: t + 1, ...r });
      console.log(`${label} trial ${t + 1}: ${r.frames} frames, ${r.simSeconds} s simulated, moved ${r.moved} m, peak ${r.maxSpeed} m/s`);
    }
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(OUT, JSON.stringify(rows, null, 1));
})();
