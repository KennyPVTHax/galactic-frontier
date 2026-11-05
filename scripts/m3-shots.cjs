/**
 * M3 graphics screenshots (ship docked, hero close-up, flight, station approach, and — on a harness build —
 * the asteroid field / high-altitude starfield and the warp phases).
 *
 *   node scripts/m3-shots.cjs harness [outHtml]           build a preview that also exposes window.__GF_M3
 *   node scripts/m3-shots.cjs <index.html> <outDir> <label> [tiers=basic,enhanced,ultra] [views=...]
 *
 * Uses SwiftShader (software WebGL) in CI-like sandboxes: frame rates are NOT device numbers. The simulation
 * is frozen (timeScale≈0) and the camera is placed explicitly so every build renders the same frame.
 */
const path = require("path");
const fs = require("fs");

const root = path.resolve(__dirname, "..");

async function buildHarness(out) {
  let esbuild;
  for (const c of ["esbuild", "/opt/npm-tools/node_modules/esbuild"]) {
    try {
      esbuild = require(c);
      break;
    } catch {
      /* next */
    }
  }
  const entry = `
import "./src/main";
import { SpaceEnvironment } from "./src/world/space";
import { WarpFx } from "./src/graphics/warpFx";
import { PAINT_SCHEMES } from "./src/vehicles/shipModel";
import { Vector3 } from "./src/engine/babylon";
window.__GF_M3 = { SpaceEnvironment, WarpFx, PAINT_SCHEMES, Vector3 };
`;
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const r = await esbuild.build({
    stdin: { contents: entry, resolveDir: root, loader: "ts", sourcefile: "m3-harness.ts" },
    bundle: true,
    format: "iife",
    target: ["es2020"],
    write: false,
    minify: true,
    define: { __GF_VERSION__: JSON.stringify(pkg.version) },
    logLevel: "warning",
  });
  const js = r.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
  const tpl = fs.readFileSync(path.join(root, "index.html"), "utf8");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, tpl.replace('<script type="module" src="/src/main.ts"></script>', () => `<script>${js}</script>`));
  console.log("harness ->", out);
}

// Each view runs in the page with the game instance. It may return a camera override {pos:[x,y,z], target:[x,y,z]}.
const VIEWS = {
  docked: (g) => {
    g.rig.yaw = Math.PI;
    g.rig.pitch = 0.12;
    return null;
  },
  hero: (g) => {
    const s = g.ship;
    return { pos: [s.x - 8.5, s.y + 3.2, s.z - 11], target: [s.x, s.y + 0.3, s.z - 0.5] };
  },
  engines: (g) => {
    const s = g.ship;
    g.ship.state = "flying";
    Object.assign(g.ship, { x: -60, y: 260, z: 40, yaw: 0, pitch: 0, roll: 0, speed: 40, throttle: 0.9 });
    g.gear = 0;
    g.hud.setMode("flight");
    return { pos: [s.x + 6.5, s.y + 2.6, s.z - 12], target: [s.x, s.y, s.z + 1] };
  },
  flight: (g) => {
    const h = g.planet.groundAt(-150, 40);
    g.ship.state = "flying";
    Object.assign(g.ship, { x: -150, y: h + 55, z: 40, yaw: Math.PI, pitch: -0.32, roll: 0, speed: 0, throttle: 0.4 });
    g.hud.setMode("flight");
    g.gear = 0;
    const V = g.rig.camera.position.constructor;
    g.rig.updateChase(0.05, new V(g.ship.x, g.ship.y, g.ship.z), g.ship.yaw, g.ship.pitch, g.planet, true);
    return null;
  },
  station: (g) => {
    const c = g.station.center;
    g.ship.state = "flying";
    Object.assign(g.ship, { x: c.x + 40, y: c.y - 25, z: c.z - 190, yaw: -0.12, pitch: 0.05, roll: 0.1, speed: 20, throttle: 0.5 });
    g.gear = 0;
    g.hud.setMode("flight");
    const s = g.ship;
    return { pos: [s.x + 6, s.y + 6, s.z - 24], target: [c.x, c.y - 10, c.z] };
  },
  space: (g) => {
    // High orbit with the asteroid field and starfield layer (harness build only).
    const M = window.__GF_M3;
    if (!M) return null;
    const c = g.station.center;
    if (!window.__m3space) {
      window.__m3space = new M.SpaceEnvironment(g.scene, { seed: 7177, center: new M.Vector3(c.x, 0, c.z), radius: 520, altitude: c.y + 40, count: 0 });
      window.__m3space.setDetail(g.renderer.profile.tier);
      g.scene.onBeforeRenderObservable.add(() => window.__m3space.update(1 / 60, g.rig.camera.position));
    }
    g.ship.state = "flying";
    Object.assign(g.ship, { x: c.x - 160, y: c.y + 120, z: c.z - 260, yaw: 0.5, pitch: 0, roll: -0.2, speed: 30, throttle: 0.7 });
    g.gear = 0;
    g.hud.setMode("flight");
    const s = g.ship;
    return { pos: [s.x - 10, s.y + 5, s.z - 20], target: [s.x + 30, s.y + 4, s.z + 60] };
  },
  "warp-spool": (g) => warpView(g, "spool", 0.8),
  "warp-tunnel": (g) => warpView(g, "tunnel", 0.5),
  "warp-exit": (g) => warpView(g, "exit", 0.12),
};

function warpView(g, phase, t) {
  const M = window.__GF_M3;
  if (!M) return null;
  if (window.__m3space) window.__m3space.setEnabled(false);
  if (!window.__m3warp) {
    window.__m3warp = new M.WarpFx(g.scene, g.rig.camera);
    window.__m3warp.setDetail(g.renderer.profile.tier);
    g.scene.onBeforeRenderObservable.add(() => window.__m3warp.update(1 / 30));
  }
  window.__m3warp.setPhase(phase, t);
  g.renderer.setWarpAmount && g.renderer.setWarpAmount(phase === "tunnel" ? 1 : phase === "spool" ? t : 1 - t);
  g.ship.state = "flying";
  Object.assign(g.ship, { x: 0, y: 600, z: 0, yaw: 0, pitch: 0.05, roll: 0, speed: 80, throttle: 1 });
  g.gear = 0;
  const s = g.ship;
  return { pos: [s.x, s.y + 3.5, s.z - 21], target: [s.x, s.y + 2, s.z + 14] };
}

async function shoot(html, outDir, label, tiers, views) {
  const { chromium } = require("playwright");
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const errors = [];
  for (const tier of tiers) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on("pageerror", (e) => errors.push(`${tier}: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && errors.push(`${tier}: ${m.text()}`));
    await page.goto(`file://${html}?debug=1&start=new&slot=m3shots-${tier}&quality=${tier}`, { timeout: 240000 });
    await page.waitForFunction(() => window.__GF && window.__GF.state().mode === "ship", null, { timeout: 300000 });
    await page.evaluate(() => {
      window.__GF.setAdaptive(false);
      const g = window.__GF.game;
      g.timeScale = 1e-6;
      g.hud.root.style.visibility = "hidden";
      window.__camOverride = null;
      g.scene.onBeforeRenderObservable.add(() => {
        const o = window.__camOverride;
        if (!o) return;
        const cam = g.rig.camera;
        cam.position.set(o.pos[0], o.pos[1], o.pos[2]);
        cam.setTarget(new cam.position.constructor(o.target[0], o.target[1], o.target[2]));
      });
    });
    for (const name of views) {
      if (!VIEWS[name]) continue;
      const ok = await page.evaluate(`(() => { const o = (${VIEWS[name].toString()})(window.__GF.game); window.__camOverride = o; return o !== null || ${JSON.stringify(name)} === "docked" || ${JSON.stringify(name)} === "flight"; })()`);
      if (!ok) continue;
      // Let a few (slow, software) frames render so the pose, shadows and particles settle.
      await page.evaluate(() => (window.__GF.game.timeScale = 0.02));
      await page.waitForTimeout(2500);
      await page.evaluate(() => (window.__GF.game.timeScale = 1e-6));
      await page.waitForTimeout(1200);
      const file = path.join(outDir, `${name}-${label}-${tier}.png`);
      await page.screenshot({ path: file });
      const st = await page.evaluate(() => {
        const s = window.__GF.state();
        return { fps: s.fps, draws: s.perf.drawCalls, tris: s.perf.triangles, meshes: s.activeMeshes };
      });
      console.log(file, JSON.stringify(st));
    }
    await page.close();
  }
  await browser.close();
  if (errors.length) console.log("PAGE ERRORS:\n" + errors.join("\n"));
}

(async () => {
  const a = process.argv.slice(2);
  if (a[0] === "harness") return buildHarness(path.resolve(a[1] || path.join(root, "dist/preview/m3-harness.html")));
  const html = path.resolve(a[0]);
  const outDir = path.resolve(a[1] || "m3-shots");
  const label = a[2] || "build";
  const tiers = (a[3] || "basic,enhanced,ultra").split(",");
  const views = (a[4] || Object.keys(VIEWS).join(",")).split(",");
  await shoot(html, outDir, label, tiers, views);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
