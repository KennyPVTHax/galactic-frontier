/**
 * Browser test of the hero-asset pipeline in the REAL game (Full bundle, Extreme HD, Aetherion, on foot):
 *   1. no assets shipped            -> procedural fallback, status says so
 *   2. valid skinned GLB            -> authored model adopted, animated through the retargeting rig, muzzle follows the hand
 *   3. manifest ok, GLB 404         -> procedural fallback, status "failed"
 *   4. corrupt GLB                  -> procedural fallback, status "failed"
 *   5. Basic tier with valid assets -> stays procedural (no download)
 * The GLB used is the generated TEST FIXTURE (tests/fixtures/humanoid-test.glb): it proves the pipeline, it is NOT the visual standard.
 *   node scripts/build.mjs preview && node scripts/hero-asset-test.cjs [outDir]
 */
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const OUT = path.resolve(process.argv[2] || "test-results/hero-assets");
fs.mkdirSync(OUT, { recursive: true });
const FIXTURE = fs.readFileSync(path.resolve(__dirname, "../tests/fixtures/humanoid-test.glb"));
const BASE = "https://gf-models.test/models/";
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const CORS = { "access-control-allow-origin": "*" };

async function open(browser, tier, routes) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.route(BASE + "**", (r) => routes(r, r.request().url().slice(BASE.length)));
  const q = `?debug=1&quality=${tier}&start=new&slot=hero${Date.now()}` + (routes ? `&models=${encodeURIComponent(BASE)}` : "");
  await page.goto("file://" + path.resolve(__dirname, "../dist/preview/index.html") + q);
  await page.waitForFunction(() => window.__GF && window.__GF.state().mode === "ship", null, { timeout: 240000 });
  await page.evaluate(() => { window.__GF.setAdaptive(false); window.__GF.warpNow("aetherion"); window.__GF.game.combat.clear(); });
  const site = await page.evaluate(() => { const g = window.__GF.game; const ls = g.planetDef.landingSite; return { x: ls.x, z: ls.z, h: g.planet.groundAt(ls.x, ls.z) }; });
  await page.evaluate((s) => window.__GF.teleportShip(s.x, s.h + 12, s.z), site);
  await page.waitForTimeout(500);
  await page.keyboard.press("KeyE");
  await page.waitForFunction(() => window.__GF.state().ship.state === "landed", null, { timeout: 240000 });
  await page.keyboard.press("KeyE");
  await page.waitForFunction(() => window.__GF.state().mode === "onFoot", null, { timeout: 120000 });
  await page.evaluate(() => { const g = window.__GF.game; const p = g.player.position; window.__GF.teleportPlayer(p.x + 14, p.z + 6); g.rig.desiredDistance = 3.1; g.rig.distance = 3.1; g.rig.smoothDist = 3.1; g.rig.pitch = 0.12; });
  return { page, errs };
}
const astro = (p) => p.evaluate(() => window.__GF.state().astronaut);
const settle = async (p, mode) => { try { await p.waitForFunction((m) => { const a = window.__GF.state().astronaut; return a && a.mode === m; }, mode, { timeout: 60000 }); } catch {} };

(async () => {
  const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const manifest = JSON.stringify({ version: 1, assets: { astronaut: { variants: { enhanced: "hero.glb", ultra: "hero.glb" }, height: 1.8, license: { name: "Test fixture (generated)", url: "-", author: "galactic-frontier", source: "scripts/make-test-glb.cjs", title: "humanoid-test" } } } });

  // 1. nothing shipped (every request 404s)
  {
    const { page, errs } = await open(browser, "ultra", (r) => r.fulfill({ status: 404, headers: CORS, body: "" }));
    await settle(page, "procedural"); await page.waitForTimeout(1500);
    const a = await astro(page);
    check("1. no assets shipped: procedural fallback, status explains why", a.mode === "procedural" && /no hero asset|procedural fallback/.test(a.detail), JSON.stringify(a).slice(0, 140));
    check("1. no page errors", errs.length === 0, errs.join("|"));
    await page.close();
  }
  // 2. valid GLB
  {
    const { page, errs } = await open(browser, "ultra", (r, f) => (f === "manifest.json" ? r.fulfill({ status: 200, headers: { ...CORS, "content-type": "application/json" }, body: manifest }) : f === "hero.glb" ? r.fulfill({ status: 200, headers: { ...CORS, "content-type": "model/gltf-binary" }, body: FIXTURE }) : r.fulfill({ status: 404, headers: CORS, body: "" })));
    await settle(page, "glb");
    const a = await astro(page);
    check("2. valid skinned GLB adopted", a.mode === "glb" && a.triangles > 100, JSON.stringify({ mode: a.mode, tris: a.triangles, loadMs: a.loadMs }));
    const geo = await page.evaluate(() => {
      const g = window.__GF.game, m = g.player.model, b = m.meshes[0];
      b.refreshBoundingInfo({ applySkeleton: true });
      const bb = b.getBoundingInfo().boundingBox;
      return { height: bb.maximumWorld.y - bb.minimumWorld.y, feetY: bb.minimumWorld.y - g.player.position.y, authored: m.usingAuthoredModel };
    });
    check("2. normalised to 1.8 m with feet on the ground", Math.abs(geo.height - 1.8) < 0.15 && Math.abs(geo.feetY) < 0.1, JSON.stringify(geo));
    await page.screenshot({ path: path.join(OUT, "pipeline-fixture-idle.jpg"), type: "jpeg", quality: 88 });
    const m0 = await page.evaluate(() => { const p = window.__GF.game.player.model.muzzle.getAbsolutePosition(); return [p.x, p.y, p.z]; });
    await page.keyboard.down("KeyW"); await page.keyboard.down("ShiftLeft");
    await page.waitForTimeout(3500);
    await page.screenshot({ path: path.join(OUT, "pipeline-fixture-run.jpg"), type: "jpeg", quality: 88 });
    const m1 = await page.evaluate(() => { const p = window.__GF.game.player.model.muzzle.getAbsolutePosition(); return [p.x, p.y, p.z]; });
    await page.keyboard.up("ShiftLeft"); await page.keyboard.up("KeyW");
    const near = await page.evaluate(() => { const g = window.__GF.game; const m = g.player.model.muzzle.getAbsolutePosition(); const p = g.player.position; return Math.hypot(m.x - p.x, m.y - p.y, m.z - p.z); });
    check("2. mining muzzle exists near the character and follows the hand", near > 0.1 && near < 2.2 && m0.some((v, i) => Math.abs(v - m1[i]) > 0.01), `dist ${near.toFixed(2)} m`);
    const fwd = await page.evaluate(() => { const g = window.__GF.game; const m = g.player.model; const c = g.rig.camera.position; return { camToHeadDist: Math.hypot(c.x - g.player.position.x, c.z - g.player.position.z) }; });
    check("2. no page errors", errs.length === 0, errs.slice(0, 2).join("|") + JSON.stringify(fwd));
    await page.close();
  }
  // 3. GLB missing
  {
    const { page, errs } = await open(browser, "ultra", (r, f) => (f === "manifest.json" ? r.fulfill({ status: 200, headers: { ...CORS, "content-type": "application/json" }, body: manifest }) : r.fulfill({ status: 404, headers: CORS, body: "" })));
    await settle(page, "failed");
    const a = await astro(page);
    check("3. missing GLB: procedural fallback, status failed", a.mode === "failed" && /fallback/.test(a.detail), a.detail.slice(0, 110));
    check("3. no page errors", errs.length === 0, errs.join("|"));
    await page.close();
  }
  // 4. corrupt GLB
  {
    const { page, errs } = await open(browser, "ultra", (r, f) => (f === "manifest.json" ? r.fulfill({ status: 200, headers: { ...CORS, "content-type": "application/json" }, body: manifest }) : f === "hero.glb" ? r.fulfill({ status: 200, headers: CORS, body: Buffer.from("glTF this is not a model") }) : r.fulfill({ status: 404, headers: CORS, body: "" })));
    await settle(page, "failed");
    const a = await astro(page);
    check("4. corrupt GLB: procedural fallback, status failed", a.mode === "failed", a.detail.slice(0, 110));
    check("4. no page errors", errs.length === 0, errs.join("|"));
    await page.close();
  }
  // 5. Basic tier never downloads
  {
    let asked = 0;
    const { page } = await open(browser, "basic", (r) => { asked++; r.fulfill({ status: 404, headers: CORS, body: "" }); });
    await page.waitForTimeout(2500);
    const a = await astro(page);
    check("5. Basic tier: procedural, no model request made", a.mode === "procedural" && asked === 0, `requests ${asked}, ${a.detail}`);
    await page.close();
  }
  await browser.close();
  const failed = results.filter((x) => !x).length;
  console.log(`\n${results.length - failed}/${results.length} hero-asset pipeline checks passed. Screenshots in ${OUT}`);
  process.exit(failed ? 1 : 0);
})();
