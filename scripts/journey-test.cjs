/**
 * Required gameplay journey (M3–M6), played in headless Chromium:
 *
 *  1 start with the Wayfarer   2 leave Halcyon Dock   3 open the star map   4 select a new planet
 *  5 warp there                6 a pirate appears     7 it detects + attacks 8 the player fires back
 *  9 shields/hull update      10 the pirate dies     11 a mission reward    12 land + scan the planet
 * 13 return to the station    14 progress is saved and restored after a reload
 *
 *   npm run build:preview && node scripts/journey-test.cjs [outDir] [quality]
 *
 * Real keyboard / mouse / UI clicks drive every step. Debug helpers are used only to
 * (a) skip long flights (teleports) and (b) keep the nose on the target during the dogfight,
 * because SwiftShader renders 1–5 fps and a human-like mouse loop is not feasible. They are
 * listed in the output next to each step that uses them. Combat damage, AI, shields, rewards,
 * contracts and saving all run through the normal game code.
 */
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const OUT = path.resolve(process.argv[2] || "test-results/journey");
const QUALITY = process.argv[3] || "basic";
// GF_BUILD selects the bundle under test: preview (Full + hooks, default) or telegram-test (Lite + hooks).
const URL = "file://" + path.resolve(__dirname, `../dist/${process.env.GF_BUILD || "preview"}/index.html`);
fs.mkdirSync(OUT, { recursive: true });

const results = [];
function check(step, name, ok, detail = "") {
  results.push({ step, name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  [${step}] ${name}${detail ? "  — " + detail : ""}`);
}
const st = (p) => p.evaluate(() => window.__GF.state());
// Software rendering is far slower on the heavier tiers (<1 fps on Extreme HD), so every wait scales with the tier.
const SLOW = { basic: 1, enhanced: 2.5, ultra: 5 }[QUALITY] || 1;
const until = (p, fn, arg, timeout = 90000) => p.waitForFunction(fn, arg, { timeout: timeout * SLOW, polling: 100 });

(async () => {
  const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  ctx.setDefaultTimeout(120000 * SLOW);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  const shot = (n) => page.screenshot({ path: path.join(OUT, n) }).catch(() => undefined);

  await page.goto(`${URL}?debug=1&quality=${QUALITY}&slot=journey`);
  await until(page, () => !!window.__GF, null, 180000);
  await page.evaluate(() => {
    localStorage.clear();
    window.__GF.setTimeScale(3);
  });
  await page.click('[data-t="new"]');
  await until(page, () => window.__GF.state().mode === "ship");
  let s = await st(page);
  check(1, "starts docked in the original Wayfarer at Veyra-7", s.ship.state === "docked" && s.planet === "veyra7", `contract: ${s.contract?.contract}`);
  await shot("01-docked.png");

  // 2 Leave the dock (Space).
  await page.keyboard.press("Space");
  await until(page, () => window.__GF.state().ship.state === "flying");
  check(2, "leaves Halcyon Dock (Space)", true);

  // 3 Star map (M).
  await page.keyboard.press("KeyM");
  await until(page, () => window.__GF.state().panel === "starmap");
  check(3, "opens the star map (M)", true);
  await shot("03-starmap.png");

  // 4 Select Aetherion, 5 warp.
  await page.click('[data-sel="aetherion"]');
  await page.waitForTimeout(150);
  const warpEnabled = await page.locator('[data-warp="aetherion"]').isEnabled();
  check(4, "selects Aetherion on the map", warpEnabled);
  await page.click('[data-warp="aetherion"]');
  await until(page, () => window.__GF.state().warping !== null, null, 10000);
  await page.waitForTimeout(600);
  await shot("05-warp.png");
  await until(page, () => window.__GF.state().planet === "aetherion" && window.__GF.state().warping === null, null, 180000);
  s = await st(page);
  check(5, "warps to Aetherion and arrives in flight", s.ship.state === "flying" && s.planet === "aetherion", `y=${Math.round(s.ship.y)} contract step: ${s.contract?.title}`);
  await shot("05-arrived.png");

  // 6 A pirate interceptor appears.
  await until(page, () => (window.__GF.state().combat?.enemies ?? []).length > 0, null, 30000);
  s = await st(page);
  const enemy = s.combat.enemies[0];
  check(6, "a hostile pirate spacecraft is encountered", s.combat.enemies.length === 1 && enemy.type === "interceptor", `${enemy.name ?? enemy.type} at ${Math.round(Math.hypot(enemy.x - s.ship.x, enemy.y - s.ship.y, enemy.z - s.ship.z))} m`);

  // 7 It detects and attacks (AI state machine, no help from the test). Transitions are read from the game's own
  // bounded AI log, so the check does not depend on polling a transient state at the right moment.
  await until(page, () => window.__GF.state().combat.aiLog.some((t) => t.to === "attack"), null, 120000).catch(() => undefined);
  const log = (await st(page)).combat.aiLog;
  const aiPath = log.map((t) => t.to);
  check(7, "enemy AI goes PATROL/DETECT → PURSUE → ATTACK", aiPath.indexOf("attack") > 0 && aiPath.slice(0, aiPath.indexOf("attack")).some((x) => x === "detect" || x === "pursue"), aiPath.join(" → "));

  // 9a Shields take hits before the hull.
  const before = await st(page);
  await until(page, (b0) => { const g = window.__GF.state(); return g.combat.shield < b0.shield - 0.5 || g.ship.hull < b0.hull - 0.5; }, { shield: before.combat.shield, hull: before.ship.hull }, 90000).catch(() => undefined);
  const hit = await st(page);
  check(9, "enemy fire drains the player's shield (then hull)", hit.combat.shield < before.combat.shield || hit.ship.hull < before.ship.hull, `shield ${before.combat.shield.toFixed(0)} → ${hit.combat.shield.toFixed(0)}, hull ${before.ship.hull.toFixed(0)} → ${hit.ship.hull.toFixed(0)}`);
  await shot("09-under-fire.png");

  // 8 + 10 Fight back with the real fire input (hold LMB with pointer lock / T to target).
  await page.keyboard.press("KeyT");
  await page.mouse.move(640, 360);
  await page.mouse.down();
  let shots = 0;
  const t8 = Date.now();
  let killed = false;
  while (Date.now() - t8 < 150000 * SLOW) {
    // Debug assist: keep the nose on the target (mouse aiming at 2 fps is not practical).
    await page.evaluate(() => window.__GF.aimAtTarget());
    await page.waitForTimeout(200);
    const c = (await st(page)).combat;
    shots = c.shotsFired;
    if (c.kills > 0) {
      killed = true;
      break;
    }
  }
  await page.mouse.up();
  s = await st(page);
  check(8, "player fires functional weapons (LMB) and lands hits", shots > 0 && s.combat.hitsLanded > 0, `shots ${shots}, hits ${s.combat.hitsLanded}  [debug: aimAtTarget]`);
  check(10, "the hostile spacecraft is destroyed", killed, `kills ${s.combat.kills}`);
  await shot("10-destroyed.png");

  // 11 Reward: loot + XP immediately, contract reward on docking (checked at 13).
  check(11, "virtual reward received for the kill (XP + loot)", s.xp > 0, `xp ${s.xp} · contract now: ${s.contract?.title}`);

  // 12 Land at the landing site and scan.
  const site = await page.evaluate(() => {
    const g = window.__GF.game;
    const ls = g.planetDef.landingSite;
    return { x: ls.x, z: ls.z, h: g.planet.groundAt(ls.x, ls.z) };
  });
  await page.evaluate((p) => window.__GF.teleportShip(p.x, p.h + 12, p.z), site); // debug: skip the descent
  await page.waitForTimeout(400);
  await page.keyboard.press("KeyE");
  await until(page, () => window.__GF.state().ship.state === "landed", null, 60000);
  await page.keyboard.press("KeyE");
  await until(page, () => window.__GF.state().mode === "onFoot", null, 30000);
  await page.keyboard.press("KeyF");
  await page.waitForTimeout(500);
  s = await st(page);
  check(12, "lands on Aetherion, steps out and scans (F)", s.tagged > 0 && s.contract?.title === "Return to Halcyon Dock", `tagged ${s.tagged}, contract: ${s.contract?.title}  [debug: teleport to landing site]`);
  await shot("12-surface-scan.png");

  // 13 Board, take off, warp home, dock.
  await page.keyboard.press("KeyE");
  await until(page, () => window.__GF.state().mode === "ship");
  await page.keyboard.press("Space");
  await until(page, () => window.__GF.state().ship.state === "flying", null, 60000);
  await page.evaluate(() => window.__GF.teleportShip(window.__GF.game.ship.x, 260, window.__GF.game.ship.z)); // debug: skip the climb
  await page.keyboard.press("KeyM");
  await until(page, () => window.__GF.state().panel === "starmap");
  await page.click('[data-sel="veyra7"]');
  await page.click('[data-warp="veyra7"]');
  await until(page, () => window.__GF.state().planet === "veyra7" && window.__GF.state().warping === null, null, 180000);
  const xpBefore = (await st(page)).xp;
  await page.evaluate(() => {
    const g = window.__GF.game;
    const pad = g.shipEnv.padPosition;
    window.__GF.teleportShip(pad.x, pad.y + 12, pad.z + 25, Math.PI); // debug: skip the approach
  });
  await page.waitForTimeout(400);
  await page.keyboard.press("KeyE");
  await until(page, () => window.__GF.state().ship.state === "docked", null, 90000);
  await page.waitForTimeout(300);
  s = await st(page);
  check(13, "returns to Halcyon Dock; contract completes with its reward", s.contractsCompleted.includes("aetherion_signal") && s.xp > xpBefore, `xp ${xpBefore} → ${s.xp}, lumenite ${s.inventory.lumenite}`);
  await shot("13-docked.png");

  // 14 Save, reload, continue.
  await page.evaluate(() => window.__GF.save());
  const saved = { xp: s.xp, inv: s.inventory, done: s.contractsCompleted };
  await page.goto(`${URL}?debug=1&quality=${QUALITY}&slot=journey`);
  await until(page, () => !!window.__GF, null, 180000);
  await page.click('[data-t="continue"]');
  await until(page, () => window.__GF.state().mode !== "title");
  s = await st(page);
  check(14, "progress is saved and restored after reload", s.xp === saved.xp && s.contractsCompleted.includes("aetherion_signal") && JSON.stringify(s.inventory) === JSON.stringify(saved.inv) && s.planet === "veyra7", `xp ${s.xp}, completed ${s.contractsCompleted.join(",")}`);

  check("-", "no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
  const passed = results.filter((r) => r.ok).length;
  fs.writeFileSync(path.join(OUT, "journey-results.json"), JSON.stringify({ quality: QUALITY, passed, total: results.length, results }, null, 2));
  console.log(`\n${passed}/${results.length} journey checks passed. Output in ${OUT}`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
