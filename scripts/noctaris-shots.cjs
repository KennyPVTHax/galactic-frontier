// Captures Noctaris flight / acid-marsh / combat views for a visibility check (run scripts/lumstats.py on the output).
//   node scripts/noctaris-shots.cjs <outDir> <label> [tier]    (needs `npm run build:preview` first)
const { chromium } = require("playwright");
const path = require("path");
const OUT = process.argv[2], LABEL = process.argv[3], TIER = process.argv[4] || "enhanced";
(async () => {
  const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto("file://" + path.resolve("dist/preview/index.html") + `?debug=1&quality=${TIER}&start=new&slot=nc${Date.now()}`);
  await p.waitForFunction(() => window.__GF && window.__GF.state().mode === "ship", null, { timeout: 240000 });
  await p.evaluate(() => { window.__GF.setAdaptive(false); window.__GF.setTimeScale(2); });
  await p.evaluate(() => window.__GF.warpNow("noctaris"));
  // 1: flight near the landing site (same framing as the earlier planet probes)
  await p.evaluate(() => { const g = window.__GF.game; const ls = g.planetDef.landingSite; window.__GF.teleportShip(ls.x - 60, g.planet.groundAt(ls.x, ls.z) + 45, ls.z - 90, 0.3); g.combat.clear(); });
  await p.waitForTimeout(2500);
  await p.screenshot({ path: path.join(OUT, `${LABEL}-flight.jpg`), type: "jpeg", quality: 85 });
  // 2: over the acid marsh (find the lowest point of terrain near the site)
  const lake = await p.evaluate(() => { const g = window.__GF.game; let best = null; for (let x = -400; x <= 400; x += 25) for (let z = -400; z <= 400; z += 25) { const h = g.planet.groundAt(x, z); if (!best || h < best.h) best = { x, z, h }; } return best; });
  await p.evaluate((l) => window.__GF.teleportShip(l.x + 40, l.h + 40, l.z - 70, 0.5), lake);
  await p.waitForTimeout(2500);
  await p.screenshot({ path: path.join(OUT, `${LABEL}-acid.jpg`), type: "jpeg", quality: 85 });
  // 3: combat: spawn the first-contact fighter and lock on
  await p.evaluate(() => { const g = window.__GF.game; const s = g.ship; g.combat.clear(); window.__GF.teleportShip(s.x, Math.max(s.y, 120), s.z, 0.5); window.__GF.spawnEncounter("first_contact"); });
  await p.keyboard.press("KeyT");
  for (let i = 0; i < 14; i++) { await p.evaluate(() => window.__GF.aimAtTarget()); await p.waitForTimeout(450); }
  await p.screenshot({ path: path.join(OUT, `${LABEL}-combat.jpg`), type: "jpeg", quality: 85 });
  console.log(LABEL, "errors", JSON.stringify(errs.slice(0, 2)));
  await b.close();
})();
