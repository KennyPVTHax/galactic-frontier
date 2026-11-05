// Captures the Full package's cinematic deep space at each forced level (and the Lite package for contrast).
//   node scripts/cinematic-shots.cjs <outDir>      (needs `npm run build:preview` and `node scripts/build.mjs telegram-test`)
// Software-rendered (SwiftShader): the per-level frame times printed here are NOT device performance, only a relative cost hint.
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const OUT = path.resolve(process.argv[2] || "test-results/cinematic");
fs.mkdirSync(OUT, { recursive: true });
async function shot(b, build, tier, level, label) {
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  const q = `?debug=1&quality=${tier}&start=new&slot=cs${Date.now()}` + (level !== null ? `&cinematic=${level}` : "");
  await p.goto("file://" + path.resolve(`dist/${build}/index.html`) + q);
  await p.waitForFunction(() => window.__GF && window.__GF.state().mode === "ship", null, { timeout: 240000 });
  await p.evaluate(() => window.__GF.setAdaptive(false));
  await p.evaluate(() => { const g = window.__GF.game; window.__GF.teleportShip(0, 1100, 0, 0.4); g.combat.clear(); g.rig.pitch = -0.95; });
  await p.waitForTimeout(6000);
  const st = await p.evaluate(() => { const s = window.__GF.state(); return { fps: s.fps, fade: s.spaceFade, cin: s.cinematic }; });
  await p.screenshot({ path: path.join(OUT, `${label}.jpg`), type: "jpeg", quality: 88 });
  console.log(label.padEnd(14), "fade", st.fade.toFixed(2), "cinematic level", st.cin ? st.cin.level : "n/a", "fps(sw)", Math.round(st.fps), errs.length ? "ERRORS " + JSON.stringify(errs.slice(0, 2)) : "no errors");
  await p.close();
}
(async () => {
  const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  for (const l of [0, 1, 2, 3]) await shot(b, "preview", "ultra", l, `full-level${l}`);
  await shot(b, "telegram-test", "basic", 3, "lite-forced3");
  await b.close();
})();
