// Astronaut close-ups from the actual game (idle front/side/back, run, jetpack). Software-rendered; for visual comparison only.
//   node scripts/build.mjs preview && node scripts/astronaut-shots.cjs <outDir> <label> [tier]
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const OUT = path.resolve(process.argv[2] || "test-results/astronaut");
const LABEL = process.argv[3] || "shot";
const TIER = process.argv[4] || "ultra";
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.goto("file://" + path.resolve(`dist/${process.env.GF_BUILD || "preview"}/index.html`) + `?debug=1&quality=${TIER}&start=new&slot=as${Date.now()}`);
  await p.waitForFunction(() => window.__GF && window.__GF.state().mode === "ship", null, { timeout: 240000 });
  await p.evaluate(() => { window.__GF.setAdaptive(false); window.__GF.warpNow("aetherion"); window.__GF.game.combat.clear(); });
  const site = await p.evaluate(() => { const g = window.__GF.game; const ls = g.planetDef.landingSite; return { x: ls.x, z: ls.z, h: g.planet.groundAt(ls.x, ls.z) }; });
  await p.evaluate((s) => window.__GF.teleportShip(s.x, s.h + 12, s.z), site);
  await p.waitForTimeout(600);
  await p.keyboard.press("KeyE");
  await p.waitForFunction(() => window.__GF.state().ship.state === "landed", null, { timeout: 240000 });
  await p.keyboard.press("KeyE");
  await p.waitForFunction(() => window.__GF.state().mode === "onFoot", null, { timeout: 120000 });
  // Move away from the ship, set a close camera.
  await p.evaluate(() => {
    const g = window.__GF.game;
    const pos = g.player.position;
    window.__GF.teleportPlayer(pos.x + 14, pos.z + 6);
    g.rig.desiredDistance = 3.1; g.rig.distance = 3.1; g.rig.smoothDist = 3.1; g.rig.pitch = 0.12;
  });
  const shot = async (name, yawOffset) => {
    await p.evaluate((o) => { const g = window.__GF.game; g.rig.yaw = g.player.facing + o; g.rig.desiredDistance = 3.1; g.rig.smoothDist = 3.1; }, yawOffset);
    await p.waitForTimeout(2500);
    await p.screenshot({ path: path.join(OUT, `${LABEL}-${name}.jpg`), type: "jpeg", quality: 90 });
  };
  await shot("idle-back", 0);
  await shot("idle-front", Math.PI);
  await shot("idle-side", Math.PI / 2);
  await p.keyboard.down("KeyW"); await p.keyboard.down("ShiftLeft");
  await shot("run", Math.PI / 2 + 0.35);
  await p.keyboard.up("ShiftLeft"); await p.keyboard.up("KeyW");
  await p.keyboard.down("Space");
  await shot("jet", Math.PI / 2 + 0.5);
  await p.keyboard.up("Space");
  const meshes = await p.evaluate(() => { const g = window.__GF.game; return { astroMeshes: g.player.model.meshes ? g.player.model.meshes.length : -1, tris: Math.round(g.player.model.meshes.filter((m) => !/flame/.test(m.name)).reduce((a, m) => a + m.getTotalIndices() / 3, 0)), draw: window.__GF.state().perf }; });
  console.log(LABEL, "astronaut meshes", meshes.astroMeshes, "triangles", meshes.tris, "errors", JSON.stringify(errs.slice(0, 2)));
  await b.close();
})();
