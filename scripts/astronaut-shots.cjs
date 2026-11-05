// Astronaut views from the actual game (front / side / rear / helmet close-up / walk / run / jetpack / mining pose / gameplay frame).
//   node scripts/build.mjs preview && node scripts/astronaut-shots.cjs <outDir> <label> [tier]
// With GF_MODELS_DIR=<dir containing manifest.json> the authored hero model is served to the game over a mocked https origin and the script
// waits until it is actually adopted (status.mode === "glb"). Software-rendered: for visual review only, NOT performance.
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const OUT = path.resolve(process.argv[2] || "test-results/astronaut");
const LABEL = process.argv[3] || "shot";
const TIER = process.argv[4] || "ultra";
const MODELS = process.env.GF_MODELS_DIR ? path.resolve(process.env.GF_MODELS_DIR) : null;
const BASE = "https://gf-models.test/models/";
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: Number(process.env.GF_DSF || 1) });
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  if (MODELS) {
    await p.route(BASE + "**", (r) => {
      const f = path.join(MODELS, decodeURIComponent(r.request().url().slice(BASE.length)));
      if (!f.startsWith(MODELS) || !fs.existsSync(f)) return r.fulfill({ status: 404, headers: { "access-control-allow-origin": "*" }, body: "" });
      r.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-type": f.endsWith(".glb") ? "model/gltf-binary" : "application/json" }, body: fs.readFileSync(f) });
    });
  }
  await p.goto("file://" + path.resolve(`dist/${process.env.GF_BUILD || "preview"}/index.html`) + `?debug=1&quality=${TIER}&start=new&slot=as${Date.now()}` + (MODELS ? `&models=${encodeURIComponent(BASE)}` : ""));
  await p.waitForFunction(() => window.__GF && window.__GF.state().mode === "ship", null, { timeout: 240000 });
  await p.evaluate(() => { window.__GF.setAdaptive(false); window.__GF.warpNow("aetherion"); window.__GF.game.combat.clear(); });
  const site = await p.evaluate(() => { const g = window.__GF.game; const ls = g.planetDef.landingSite; return { x: ls.x, z: ls.z, h: g.planet.groundAt(ls.x, ls.z) }; });
  await p.evaluate((s) => window.__GF.teleportShip(s.x, s.h + 12, s.z), site);
  await p.waitForTimeout(600);
  await p.keyboard.press("KeyE");
  await p.waitForFunction(() => window.__GF.state().ship.state === "landed", null, { timeout: 240000 });
  await p.keyboard.press("KeyE");
  await p.waitForFunction(() => window.__GF.state().mode === "onFoot", null, { timeout: 120000 });
  if (MODELS) {
    await p.waitForFunction(() => { const a = window.__GF.state().astronaut; return a && (a.mode === "glb" || a.mode === "failed"); }, null, { timeout: 300000 });
    const a = await p.evaluate(() => window.__GF.state().astronaut);
    console.log("hero status:", JSON.stringify({ mode: a.mode, detail: a.detail, meshes: a.meshes, triangles: a.triangles, loadMs: a.loadMs }));
    if (a.mode !== "glb") { console.log("HERO NOT ADOPTED"); await b.close(); process.exit(2); }
  }
  await p.evaluate(() => {
    const g = window.__GF.game;
    const pos = g.player.position;
    window.__GF.teleportPlayer(pos.x + 14, pos.z + 6);
    g.rig.desiredDistance = 3.1; g.rig.distance = 3.1; g.rig.smoothDist = 3.1; g.rig.pitch = 0.12;
  });
  const shot = async (name, yawOffset, dist = 3.1, pitch = 0.12, wait = 2500) => {
    await p.evaluate(([o, d, pt]) => { const g = window.__GF.game; g.rig.yaw = g.player.facing + o; g.rig.desiredDistance = d; g.rig.distance = d; g.rig.smoothDist = d; g.rig.pitch = pt; }, [yawOffset, dist, pitch]);
    await p.waitForTimeout(wait);
    await p.screenshot({ path: path.join(OUT, `${LABEL}-${name}.jpg`), type: "jpeg", quality: 92 });
  };
  await shot("front", Math.PI, 4.4, 0.18);
  await shot("side", Math.PI / 2, 4.4, 0.18);
  await shot("rear", 0, 4.4, 0.18);
  await shot("helmet-closeup", Math.PI, 1.15, -0.02);
  await shot("helmet-closeup-3q", Math.PI * 0.8, 1.3, 0.0);
  await p.keyboard.down("KeyW");
  await shot("walk", Math.PI / 2 + 0.35, 4.4, 0.18, 3000);
  await p.keyboard.down("ShiftLeft");
  await shot("run", Math.PI / 2 + 0.35, 4.4, 0.18, 3500);
  await p.keyboard.up("ShiftLeft"); await p.keyboard.up("KeyW");
  await p.evaluate(() => window.__GF.setTimeScale(2.5));
  await p.keyboard.down("Space");
  await shot("jet", 0.45, 4.4, 0.1, 9000);
  await p.evaluate(() => window.__GF.setTimeScale(1));
  await p.keyboard.up("Space");
  await p.waitForTimeout(1500);
  await p.mouse.move(640, 360);
  await p.mouse.down();
  await shot("mining", Math.PI / 2 - 0.5, 4.4, 0.18, 2500);
  await p.mouse.up();
  await shot("gameplay", 0, 5.5, 0.28, 2500);
  const st = await p.evaluate(() => { const m = window.__GF.game.player.model; return { stats: m.stats ? m.stats() : null, a: window.__GF.state().astronaut }; });
  console.log(LABEL, "stats", JSON.stringify(st.stats), "errors", JSON.stringify(errs.slice(0, 3)));
  await b.close();
})();
