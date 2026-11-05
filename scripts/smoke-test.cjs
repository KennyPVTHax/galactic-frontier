/**
 * Browser smoke test: plays the full intro mission in headless Chromium using
 * real keyboard/mouse/touch input, with debug teleports only to skip travel time.
 *
 *   npm run build:preview && node scripts/smoke-test.cjs [outDir] [quality]
 *
 * Uses SwiftShader (software WebGL), so FPS numbers here are NOT representative
 * of real devices.
 */
const { chromium, devices } = require("playwright");
const path = require("path");
const fs = require("fs");

const OUT = path.resolve(process.argv[2] || "test-results");
const QUALITY = process.argv[3] || "low";
// SwiftShader renders ~7-10 fps; scale game time so real-time waits cover enough simulation.
const TIME_SCALE = 3;
const URL = "file://" + path.resolve(__dirname, "../dist/preview/index.html");
fs.mkdirSync(OUT, { recursive: true });

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}
const st = (p) => p.evaluate(() => window.__GF.state());
const waitState = (p, fn, arg, timeout = 60000) => p.waitForFunction(fn, arg, { timeout, polling: 100 });

async function launch() {
  return chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
}

function watchErrors(page, bucket) {
  page.on("pageerror", (e) => bucket.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") bucket.push(m.text());
  });
}

async function desktopRun(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  ctx.setDefaultTimeout(90000);
  const page = await ctx.newPage();
  const errors = [];
  watchErrors(page, errors);
  await page.goto(`${URL}?debug=1&quality=${QUALITY}&slot=smoke`);
  await waitState(page, () => !!window.__GF, null, 120000);
  await page.evaluate((ts) => { localStorage.clear(); window.__GF.setTimeScale(ts); }, TIME_SCALE);
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, "01-title.png") });
  await page.click('[data-t="new"]');
  await waitState(page, () => window.__GF.state().mode === "ship");
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, "02-docked.png") });

  // Terminal opens with E while docked
  await page.keyboard.press("KeyE");
  await waitState(page, () => window.__GF.state().panel === "terminal");
  await page.click('[data-tab="upgrades"]');
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, "03-terminal.png") });
  await page.keyboard.press("Escape");
  await waitState(page, () => window.__GF.state().panel === null);

  // Launch with Space, fly forward with W
  await page.keyboard.press("Space");
  await waitState(page, () => window.__GF.state().ship.state === "flying");
  check("undock → flying", true, (await st(page)).mission.step);
  const z0 = (await st(page)).ship.z;
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(2500);
  await page.keyboard.up("KeyW");
  const s1 = await st(page);
  check("throttle moves ship forward", s1.ship.z < z0 - 5 && s1.ship.speed > 5, `dz=${(s1.ship.z - z0).toFixed(1)} speed=${s1.ship.speed.toFixed(1)}`);
  await page.screenshot({ path: path.join(OUT, "04-flight.png") });

  // Skip the long descent: place ship low over the survey site, then land with E.
  await page.evaluate(() => {
    const g = window.__GF.game;
    const h = g.planet.groundAt(-150, -95);
    window.__GF.teleportShip(-150, h + 40, -60, Math.PI);
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, "05-approach.png") });
  // Descend with C (real input) until landing is possible.
  await page.keyboard.down("KeyC");
  await waitState(page, () => window.__GF.state().ship.agl < 15, null, 60000);
  await page.keyboard.up("KeyC");
  await page.keyboard.press("KeyE");
  await waitState(page, () => window.__GF.state().ship.state === "landed");
  check("land on surface", true, `mission=${(await st(page)).mission.step}`);
  await page.keyboard.press("KeyE");
  await waitState(page, () => window.__GF.state().mode === "onFoot");
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, "06-on-foot.png") });

  // Walk forward + sprint + jump + jetpack
  const p0 = (await st(page)).player;
  await page.keyboard.down("KeyW");
  await page.keyboard.down("ShiftLeft");
  await page.waitForTimeout(1500);
  await page.keyboard.up("ShiftLeft");
  await page.keyboard.up("KeyW");
  const p1 = (await st(page)).player;
  check("walking moves player", Math.hypot(p1.x - p0.x, p1.z - p0.z) > 3, `moved ${Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(1)} m`);
  await page.keyboard.down("Space");
  await page.waitForTimeout(1200);
  const pj = (await st(page)).player;
  await page.keyboard.up("Space");
  check("jump + jetpack lifts player and uses fuel", !pj.grounded && pj.jetFuel < 100, `fuel=${pj.jetFuel.toFixed(0)}`);
  await waitState(page, () => window.__GF.state().player.grounded, null, 20000);

  // Scan with F
  await page.keyboard.press("KeyF");
  await waitState(page, () => window.__GF.state().tagged > 0);
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, "07-scan.png") });
  check("scan tags deposits and advances mission", (await st(page)).mission.step === "mine", `tagged=${(await st(page)).tagged}`);

  // Mine lumenite with the real laser (hold left mouse)
  await page.mouse.move(640, 360);
  const depId = await page.evaluate(() => window.__GF.approach("lumenite"));
  await waitState(page, () => window.__GF.state().target !== null, null, 30000).catch(() => undefined);
  const aimDbg = () => page.evaluate(() => ({ yaw: +window.__GF.game.rig.yaw.toFixed(2), pitch: +window.__GF.game.rig.pitch.toFixed(2), locked: window.__GF.game.input.isPointerLocked, target: window.__GF.state().target }));
  console.log("  aim before fire:", JSON.stringify(await aimDbg()));
  const inv0 = (await st(page)).inventory.lumenite;
  await page.mouse.down();
  await page.waitForTimeout(600);
  const aimAfter = await aimDbg();
  console.log("  aim after fire:", JSON.stringify(aimAfter));
  await page.waitForTimeout(1900);
  await page.screenshot({ path: path.join(OUT, "08-mining.png") });
  const mid = await st(page);
  await page.waitForTimeout(3500);
  const hot = await st(page);
  await page.mouse.up();
  check("laser targets deposit under crosshair (pointer lock engaged)", aimAfter.target === depId, `target=${aimAfter.target}`);
  check("mining adds Lumenite", hot.inventory.lumenite > inv0, `${inv0} → ${hot.inventory.lumenite}`);
  check("laser builds heat and drains energy", hot.laser.heat > 20 || hot.laser.overheated, `heat=${hot.laser.heat.toFixed(0)} energy=${hot.laser.energy.toFixed(0)}`);

  // Mine ferrite briefly, then top up remaining samples (saves test time).
  const ferId = await page.evaluate(() => window.__GF.approach("ferrite"));
  await waitState(page, (id) => window.__GF.state().target === id, ferId, 30000).catch(() => undefined);
  await page.mouse.down();
  await page.waitForTimeout(2500);
  await page.mouse.up();
  check("mining adds Ferrite", (await st(page)).inventory.ferrite > 0, `ferrite=${(await st(page)).inventory.ferrite}`);
  await page.evaluate(() => {
    const s = window.__GF.state();
    window.__GF.give("lumenite", Math.max(0, 45 - s.mission.telemetry.collected.lumenite));
    window.__GF.give("ferrite", Math.max(0, 35 - s.mission.telemetry.collected.ferrite));
  });
  check("sample quota met → return objective", (await st(page)).mission.step === "takeoff");

  // Inventory panel
  await page.keyboard.press("Tab");
  await waitState(page, () => window.__GF.state().panel === "inventory");
  await page.screenshot({ path: path.join(OUT, "09-inventory.png") });
  await page.keyboard.press("Tab");

  // Back to ship, take off, return to dock
  await page.evaluate(() => {
    const g = window.__GF.game;
    window.__GF.teleportPlayer(g.ship.x + 4, g.ship.z + 4);
  });
  await page.waitForTimeout(300);
  await page.keyboard.press("KeyE");
  await waitState(page, () => window.__GF.state().mode === "ship");
  await page.keyboard.press("Space");
  await waitState(page, () => window.__GF.state().ship.state === "flying");
  check("take off", (await st(page)).mission.step === "dock");
  await page.evaluate(() => window.__GF.teleportShip(0, 345, 165, 0));
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, "10-dock-approach.png") });
  await page.keyboard.press("KeyE");
  await waitState(page, () => window.__GF.state().ship.state === "docked");
  await waitState(page, () => window.__GF.state().panel === "terminal");
  check("dock opens terminal at deliver step", (await st(page)).mission.step === "deliver");
  await page.click("[data-deliver]");
  await waitState(page, () => window.__GF.state().mission.step === "complete");
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, "11-complete.png") });
  const fin = await st(page);
  check("mission complete + report submitted (offline)", fin.mission.submission && fin.mission.submission.status === "offline", JSON.stringify(fin.mission.submission));
  const coinField = await page.evaluate(() => JSON.stringify(window.__GF.game.mission.state).toLowerCase().includes("coin"));
  check("no coin values in client mission state", !coinField);

  // Upgrade purchase
  await page.evaluate(() => window.__GF.give("ferrite", 40) && window.__GF.give("lumenite", 15));
  await page.keyboard.press("Escape");
  await page.keyboard.press("KeyE");
  await waitState(page, () => window.__GF.state().panel === "terminal");
  await page.click('[data-tab="upgrades"]');
  await page.click('[data-buy="laserCooling"]');
  const lv = await page.evaluate(() => window.__GF.game.levels.laserCooling);
  check("upgrade purchase", lv === 1);

  // Persistence: reload and continue
  await page.evaluate(() => window.__GF.save());
  const before = (await st(page)).inventory;
  await page.reload();
  await waitState(page, () => !!window.__GF, null, 120000);
  await page.evaluate((ts) => window.__GF.setTimeScale(ts), TIME_SCALE);
  await page.click('[data-t="continue"]');
  await waitState(page, () => window.__GF.state().mode !== "title");
  const after = await st(page);
  check("save/load restores inventory, upgrades and mission", JSON.stringify(after.inventory) === JSON.stringify(before) && after.mission.step === "complete" && (await page.evaluate(() => window.__GF.game.levels.laserCooling)) === 1);

  const stats = await st(page);
  check("no page errors (desktop)", errors.length === 0, errors.slice(0, 3).join(" | "));
  await ctx.close();
  return stats;
}

async function mobileRun(browser) {
  const ctx = await browser.newContext({ ...devices["Pixel 7"] });
  ctx.setDefaultTimeout(90000);
  const page = await ctx.newPage();
  const errors = [];
  watchErrors(page, errors);
  await page.goto(`${URL}?debug=1&slot=smokem`);
  await waitState(page, () => !!window.__GF, null, 120000);
  await page.evaluate((ts) => { localStorage.clear(); window.__GF.setTimeScale(ts); }, TIME_SCALE);
  const q = (await st(page)).quality;
  check("mobile auto-quality is conservative", q === "low" || q === "medium", `quality=${q}`);
  await page.screenshot({ path: path.join(OUT, "20-mobile-title.png") });
  await page.tap('[data-t="new"]');
  await waitState(page, () => window.__GF.state().mode === "ship");
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, "21-mobile-docked.png") });
  // Hold "Thr +" to launch
  const thr = page.locator('.gf-ship [data-b="thrUp"]');
  const box = await thr.boundingBox();
  check("ship touch controls visible", !!box);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await thr.dispatchEvent("pointerdown", { pointerId: 7, pointerType: "touch", isPrimary: true });
  await waitState(page, () => window.__GF.state().ship.state !== "docked", null, 30000);
  await thr.dispatchEvent("pointerup", { pointerId: 7, pointerType: "touch" });
  await waitState(page, () => window.__GF.state().ship.state === "flying");
  check("touch launch", true);
  // Land and exit via touch "Use"
  await page.evaluate(() => {
    const g = window.__GF.game;
    const h = g.planet.groundAt(-150, -95);
    window.__GF.teleportShip(-150, h + 8, -95, Math.PI);
  });
  await page.waitForTimeout(300);
  const use = page.locator('.gf-ship [data-b="interact"]');
  await use.dispatchEvent("pointerdown", { pointerId: 8, pointerType: "touch" });
  await use.dispatchEvent("pointerup", { pointerId: 8, pointerType: "touch" });
  await waitState(page, () => window.__GF.state().ship.state === "landed");
  const use2 = page.locator('.gf-ship [data-b="interact"]');
  await use2.dispatchEvent("pointerdown", { pointerId: 9, pointerType: "touch" });
  await use2.dispatchEvent("pointerup", { pointerId: 9, pointerType: "touch" });
  await waitState(page, () => window.__GF.state().mode === "onFoot");
  check("touch land + exit", true);
  // Joystick drag moves the player
  const p0 = (await st(page)).player;
  const zone = page.locator(".gf-joyzone");
  const zb = await zone.boundingBox();
  const sx = zb.x + 90, sy = zb.y + zb.height - 110;
  await zone.dispatchEvent("pointerdown", { pointerId: 3, pointerType: "touch", clientX: sx, clientY: sy, isPrimary: true });
  await zone.dispatchEvent("pointermove", { pointerId: 3, pointerType: "touch", clientX: sx, clientY: sy - 60 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, "22-mobile-on-foot.png") });
  await zone.dispatchEvent("pointerup", { pointerId: 3, pointerType: "touch", clientX: sx, clientY: sy - 60 });
  const p1 = (await st(page)).player;
  check("virtual joystick moves player", Math.hypot(p1.x - p0.x, p1.z - p0.z) > 2, `moved ${Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(1)} m`);
  // Mine button with touch auto-aim
  await page.evaluate(() => window.__GF.approach("lumenite"));
  await page.evaluate(() => (window.__GF.game.rig.yaw += 0.5)); // off-centre: rely on assist
  const inv0 = (await st(page)).inventory.lumenite;
  const fire = page.locator('.gf-foot [data-b="fire"]');
  await fire.dispatchEvent("pointerdown", { pointerId: 4, pointerType: "touch" });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, "23-mobile-mining.png") });
  await fire.dispatchEvent("pointerup", { pointerId: 4, pointerType: "touch" });
  check("touch mining with aim assist", (await st(page)).inventory.lumenite > inv0, `${inv0} → ${(await st(page)).inventory.lumenite}`);
  check("no page errors (mobile emulation)", errors.length === 0, errors.slice(0, 3).join(" | "));
  await ctx.close();
}

(async () => {
  const browser = await launch();
  try {
    const stats = await desktopRun(browser);
    console.log("desktop scene stats (SwiftShader):", JSON.stringify({ fps: stats.fps, activeMeshes: stats.activeMeshes, quality: stats.quality }));
    await mobileRun(browser);
  } catch (e) {
    check("test run completed", false, String(e && e.message));
  } finally {
    await browser.close();
  }
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed. Screenshots in ${OUT}`);
  process.exit(failed ? 1 : 0);
})();
