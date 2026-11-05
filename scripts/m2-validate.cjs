/**
 * M2 validation: landscape layouts per platform (emulated), orientation changes,
 * touch joystick / camera / throttle, live graphics preset switching, context-loss
 * recovery, save/reload, and per-tier FPS / memory profiling.
 *
 *   npm run build:preview && node scripts/m2-validate.cjs [outDir]
 *
 * Runs in headless Chromium with SwiftShader (software WebGL). Device emulation is
 * NOT a real Android phone or Telegram client; frame rates are CPU rasterisation.
 */
const { chromium, devices } = require("playwright");
const path = require("path");
const fs = require("fs");

const OUT = path.resolve(process.argv[2] || "m2-results");
const URL = "file://" + path.resolve(__dirname, "../dist/preview/index.html");
fs.mkdirSync(OUT, { recursive: true });
const ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
const TIME_SCALE = 3;

const results = [];
const profile = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}
const st = (p) => p.evaluate(() => window.__GF.state());
const wait = (p, fn, arg, timeout = 120000) => p.waitForFunction(fn, arg, { timeout, polling: 150 });
const shot = (p, name) => p.screenshot({ path: path.join(OUT, name), timeout: 180000 });

function watch(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  return errors;
}

async function boot(page, query) {
  await page.goto(`${URL}?debug=1&${query}`, { timeout: 240000 });
  await wait(page, () => !!window.__GF, null, 240000);
  await page.evaluate((ts) => window.__GF.setTimeScale(ts), TIME_SCALE);
}

async function toSurface(page, yaw = 0.6) {
  await page.evaluate((y) => {
    const g = window.__GF.game;
    g.ship.placeLanded(g.shipEnv, -150, -95, 2.2);
    g.disembark();
    g.rig.yaw = y;
    g.rig.pitch = 0.14;
  }, yaw);
  await page.waitForTimeout(2500);
}

async function toFlight(page) {
  await page.evaluate(() => {
    const g = window.__GF.game;
    if (g.mode === "onFoot") g.enterShip(false);
    const h = g.planet.groundAt(-120, -40);
    g.ship.state = "flying";
    Object.assign(g.ship, { x: -120, y: h + 45, z: -40, yaw: Math.PI * 1.1, pitch: -0.1, speed: 30, throttle: 0.5 });
    g.hud.setMode("flight");
    // Snap the chase camera: at software-rendering frame rates it would still be catching up at screenshot time.
    const V = g.rig.camera.position.constructor;
    g.rig.updateChase(0.05, new V(g.ship.x, g.ship.y, g.ship.z), g.ship.yaw, g.ship.pitch, g.planet, true);
  });
  await page.waitForTimeout(2500);
}

// ------------------------------------------------------------------ Telegram mock
const TELEGRAM_MOCK = `
  window.__tgCalls = [];
  const c = (n) => window.__tgCalls.push(n);
  window.Telegram = { WebApp: {
    platform: "android", version: "8.0", initData: "query_id=TEST&user=%7B%22id%22%3A1%7D&hash=mock",
    isVersionAtLeast(v) { return parseFloat(this.version) >= parseFloat(v); },
    ready() { c("ready"); }, expand() { c("expand"); },
    isFullscreen: false, isOrientationLocked: false,
    requestFullscreen() { c("requestFullscreen"); this.isFullscreen = true; },
    exitFullscreen() { c("exitFullscreen"); this.isFullscreen = false; },
    lockOrientation() { c("lockOrientation"); this.isOrientationLocked = true; },
    unlockOrientation() { c("unlockOrientation"); this.isOrientationLocked = false; },
    disableVerticalSwipes() { c("disableVerticalSwipes"); }, enableVerticalSwipes() { c("enableVerticalSwipes"); },
    safeAreaInset: { top: 0, bottom: 0, left: 32, right: 32 },
    contentSafeAreaInset: { top: 46, bottom: 0, left: 0, right: 0 },
    onEvent() {}, offEvent() {},
    HapticFeedback: { impactOccurred(s) { c("haptic:" + s); }, selectionChanged() { c("haptic:tick"); } },
  } };`;
const VIBRATE_SPY = `window.__vibrations = 0; try { navigator.vibrate = () => { window.__vibrations++; return true; }; } catch (e) {}`;

// ------------------------------------------------------------------ scenarios

async function pcScreens(browser) {
  for (const [label, vp] of [
    ["pc-16x9", { width: 1600, height: 900 }],
    ["pc-ultrawide-21x9", { width: 2100, height: 900 }],
  ]) {
    const ctx = await browser.newContext({ viewport: vp });
    const page = await ctx.newPage();
    const errors = watch(page);
    await boot(page, `start=new&slot=${label}`);
    const s0 = await st(page);
    // Auto = platform default (Enhanced on desktop) unless the GPU is weak. SwiftShader counts as weak.
    check(`${label}: auto tier follows desktop default + hardware limit`, s0.tierReason.startsWith("desktop default"), `${s0.tier} (${s0.tierReason})`);
    await page.evaluate(() => window.__GF.setTier("enhanced"));
    await page.waitForTimeout(1500);
    await toSurface(page);
    await shot(page, `${label}-surface.png`);
    await toFlight(page);
    await shot(page, `${label}-flight.png`);
    const frame = await page.evaluate(() => getComputedStyle(document.querySelector(".gf-hud")).getPropertyValue("--frame-x"));
    if (label.includes("ultrawide")) check("ultrawide: HUD kept inside a central frame", parseInt(frame) > 0, `frame inset ${frame}`);
    else check("16:9: HUD uses full width", parseInt(frame) === 0, `frame inset ${frame}`);
    check(`${label}: no page errors`, errors.length === 0, errors.slice(0, 2).join(" | "));
    await ctx.close();
  }
}

async function androidScreens(browser) {
  const pixel = devices["Pixel 7"];
  const ctx = await browser.newContext({ ...pixel, viewport: { width: pixel.viewport.height, height: pixel.viewport.width }, deviceScaleFactor: 2 });
  await ctx.addInitScript(VIBRATE_SPY);
  const page = await ctx.newPage();
  const errors = watch(page);
  await boot(page, `start=new&slot=android&quality=ultra`);
  const s0 = await st(page);
  check("Android: platform detected as android-browser", s0.platform === "android-browser", s0.platform);
  check("Android: landscape layout active", s0.orientation && s0.orientation.landscape, JSON.stringify(s0.orientation));
  await toSurface(page);
  await shot(page, "android-ultra-landscape-surface.png");
  await toFlight(page);
  await shot(page, "android-ultra-landscape-flight.png");
  check("Android: no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

async function telegramScreens(browser) {
  const pixel = devices["Pixel 7"];
  const ctx = await browser.newContext({ ...pixel, viewport: { width: pixel.viewport.height, height: pixel.viewport.width }, deviceScaleFactor: 2 });
  await ctx.addInitScript(TELEGRAM_MOCK);
  const page = await ctx.newPage();
  const errors = watch(page);
  await boot(page, `slot=telegram`);
  await page.tap('[data-t="new"]');
  await wait(page, () => window.__GF.state().mode === "ship");
  const s0 = await st(page);
  const calls = await page.evaluate(() => window.__tgCalls);
  check("Telegram: platform detected", s0.platform === "telegram", s0.platform);
  check("Telegram: auto tier is Telegram Basic", s0.tier === "basic", `${s0.tier} (${s0.tierReason})`);
  check("Telegram: fullscreen requested inside the start tap", calls.includes("requestFullscreen"), calls.join(","));
  check("Telegram: vertical swipes disabled", calls.includes("disableVerticalSwipes"));
  check("Telegram: orientation locked (device already landscape)", calls.includes("lockOrientation"));
  const top = await page.evaluate(() => getComputedStyle(document.querySelector(".gf-hud")).getPropertyValue("--gf-inset-top"));
  check("Telegram: HUD applies safe-area + content-safe-area insets", top.trim() === "46px", top);
  await toSurface(page);
  await shot(page, "telegram-basic-landscape-surface.png");
  await toFlight(page);
  await shot(page, "telegram-basic-landscape-flight.png");
  check("Telegram: no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

async function orientationAndTouch(browser) {
  const pixel = devices["Pixel 7"];
  const ctx = await browser.newContext({ ...pixel });
  await ctx.addInitScript(VIBRATE_SPY);
  const page = await ctx.newPage();
  const errors = watch(page);
  await boot(page, `slot=orient&quality=basic`);
  await page.tap('[data-t="new"]');
  await wait(page, () => window.__GF.state().mode === "ship");
  await toSurface(page);
  check("portrait phone: rotate prompt shown in game", await page.isVisible(".gf-rotate"));
  await page.evaluate(() => window.__GF.give("lumenite", 7));
  const before = await st(page);
  const w0 = await page.evaluate(() => window.__GF.game.engine.getRenderWidth());
  // The start tap put the page into real fullscreen; leave it so the emulated
  // window can be rotated (resized) like a device.
  await page.evaluate(() => document.fullscreenElement && document.exitFullscreen());
  await page.waitForTimeout(500);
  await page.setViewportSize({ width: pixel.viewport.height, height: pixel.viewport.width });
  await page.waitForTimeout(2000);
  const after = await st(page);
  const w1 = await page.evaluate(() => window.__GF.game.engine.getRenderWidth());
  check("rotate to landscape: prompt hidden, landscape HUD", !(await page.isVisible(".gf-rotate")) && (await page.evaluate(() => document.querySelector(".gf-hud").classList.contains("gf-landscape"))));
  check("rotate: canvas resized", w1 > w0, `${w0} → ${w1} px`);
  check(
    "rotate: game state preserved (mission, inventory, position)",
    after.mission.step === before.mission.step && after.inventory.lumenite === before.inventory.lumenite && Math.abs(after.player.x - before.player.x) < 0.5 && Math.abs(after.player.z - before.player.z) < 0.5,
    `${before.mission.step}/${after.mission.step} lum ${before.inventory.lumenite}/${after.inventory.lumenite}`,
  );
  await shot(page, "touch-landscape-onfoot.png");

  // Joystick (left) moves the player — on open ground, facing away from the ship.
  await page.evaluate(() => {
    const g = window.__GF.game;
    window.__GF.teleportPlayer(-150, -135);
    g.rig.yaw = Math.PI;
  });
  await page.waitForTimeout(500);
  const p0 = (await st(page)).player;
  const zone = page.locator(".gf-joyzone");
  const zb = await zone.boundingBox();
  const sx = zb.x + 110, sy = zb.y + zb.height - 90;
  await zone.dispatchEvent("pointerdown", { pointerId: 3, pointerType: "touch", clientX: sx, clientY: sy, isPrimary: true });
  await zone.dispatchEvent("pointermove", { pointerId: 3, pointerType: "touch", clientX: sx + 10, clientY: sy - 60 });
  // Hold until the player has walked a few metres (game time, not wall-clock: software rendering runs few frames/s).
  await wait(page, (a) => { const p = window.__GF.state().player; return Math.hypot(p.x - a.x, p.z - a.z) > 2.5; }, p0, 90000).catch(() => {});
  await zone.dispatchEvent("pointerup", { pointerId: 3, pointerType: "touch" });
  const p1 = (await st(page)).player;
  check("landscape joystick moves the player", Math.hypot(p1.x - p0.x, p1.z - p0.z) > 2, `${Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(1)} m`);

  // Right side drag turns the camera
  const yaw0 = await page.evaluate(() => window.__GF.game.rig.yaw);
  const look = page.locator(".gf-lookzone");
  const lb = await look.boundingBox();
  const lx = lb.x + lb.width / 2, ly = lb.y + lb.height / 2;
  await look.dispatchEvent("pointerdown", { pointerId: 5, pointerType: "touch", clientX: lx, clientY: ly });
  for (let i = 1; i <= 6; i++) {
    await look.dispatchEvent("pointermove", { pointerId: 5, pointerType: "touch", clientX: lx + i * 25, clientY: ly });
    await page.waitForTimeout(80);
  }
  await look.dispatchEvent("pointerup", { pointerId: 5, pointerType: "touch" });
  await page.waitForTimeout(300);
  const yaw1 = await page.evaluate(() => window.__GF.game.rig.yaw);
  check("right-side drag rotates the camera", Math.abs(yaw1 - yaw0) > 0.3, `Δyaw ${(yaw1 - yaw0).toFixed(2)} rad`);

  // Landscape buttons are within the viewport and do not overlap
  const rects = await page.evaluate(() => [...document.querySelectorAll(".gf-foot [data-pos]")].map((e) => ({ id: e.dataset.pos, ...e.getBoundingClientRect().toJSON() })));
  const vw = pixel.viewport.height, vh = pixel.viewport.width;
  const inside = rects.every((r) => r.left >= 0 && r.top >= 0 && r.right <= vw && r.bottom <= vh && r.width >= 44);
  let overlap = 0;
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i], b = rects[j];
    if (a.left < b.right - 2 && b.left < a.right - 2 && a.top < b.bottom - 2 && b.top < a.bottom - 2) overlap++;
  }
  check("on-foot buttons: ≥44 px, on screen, no overlaps", inside && overlap === 0, rects.map((r) => `${r.id}:${Math.round(r.width)}`).join(" "));

  // Mine button with aim assist, haptic feedback
  await page.evaluate(() => window.__GF.approach("lumenite"));
  await page.evaluate(() => (window.__GF.game.rig.yaw += 0.45));
  const inv0 = (await st(page)).inventory.lumenite;
  const fire = page.locator('.gf-foot [data-b="fire"]');
  await fire.dispatchEvent("pointerdown", { pointerId: 4, pointerType: "touch" });
  await page.waitForTimeout(2500);
  await shot(page, "touch-landscape-mining.png");
  await fire.dispatchEvent("pointerup", { pointerId: 4, pointerType: "touch" });
  check("Mine button mines with aim assist", (await st(page)).inventory.lumenite > inv0);
  check("touch buttons give haptic feedback", (await page.evaluate(() => window.__vibrations)) > 0, `${await page.evaluate(() => window.__vibrations)} vibrations`);

  // Flight: throttle slider
  await page.evaluate(() => {
    const g = window.__GF.game;
    window.__GF.teleportPlayer(g.ship.x + 4, g.ship.z + 4);
  });
  await page.waitForTimeout(400);
  const use = page.locator('.gf-foot [data-b="interact"]');
  await use.dispatchEvent("pointerdown", { pointerId: 8, pointerType: "touch" });
  await use.dispatchEvent("pointerup", { pointerId: 8, pointerType: "touch" });
  await wait(page, () => window.__GF.state().mode === "ship");
  const up = page.locator('.gf-ship [data-b="liftUp"]');
  await up.dispatchEvent("pointerdown", { pointerId: 9, pointerType: "touch" });
  await wait(page, () => window.__GF.state().ship.state === "flying", null, 60000);
  await up.dispatchEvent("pointerup", { pointerId: 9, pointerType: "touch" });
  const thr = page.locator(".gf-thr");
  check("flight: throttle slider visible in landscape", await thr.isVisible());
  const tb = await page.locator(".gf-thr-track").boundingBox();
  await thr.dispatchEvent("pointerdown", { pointerId: 11, pointerType: "touch", clientX: tb.x + tb.width / 2, clientY: tb.y + tb.height * 0.2 });
  await thr.dispatchEvent("pointermove", { pointerId: 11, pointerType: "touch", clientX: tb.x + tb.width / 2, clientY: tb.y + tb.height * 0.2 });
  // The ship's throttle ramps at the M1 rate (0.7/s of game time), so wait on the value rather than a fixed
  // wall-clock delay: software rendering simulates far fewer frames per second than a device.
  await wait(page, () => window.__GF.game.ship.throttle > 0.74, null, 120000).catch(() => {});
  await page.waitForTimeout(1500);
  const throttle = await page.evaluate(() => window.__GF.game.ship.throttle);
  await shot(page, "touch-landscape-flight.png");
  await thr.dispatchEvent("pointerup", { pointerId: 11, pointerType: "touch" });
  check("throttle slider sets ship throttle to the dragged value (80%) without overshoot", throttle > 0.74 && throttle < 0.86, `throttle ${(throttle * 100).toFixed(0)}%`);
  check("orientation/touch: no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

async function presetsContextSave(browser) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const page = await ctx.newPage();
  const errors = watch(page);
  await boot(page, `start=new&slot=presets`);
  await page.evaluate(() => localStorage.removeItem("orbitbtc.galacticFrontier.device"));
  await toSurface(page);
  await page.evaluate(() => window.__GF.give("ferrite", 9));
  const snapshotState = () => page.evaluate(() => {
    const g = window.__GF.game;
    return {
      inv: JSON.stringify(g.inventory.snapshot()),
      step: g.mission.step,
      px: g.player.position.x.toFixed(2),
      pz: g.player.position.z.toFixed(2),
      deposits: g.planet.deposits.map((d) => `${d.id}@${d.position.x.toFixed(2)},${d.position.z.toFixed(2)}:${d.max}`).join("|"),
      colliders: g.planet.colliders.length,
      ground: g.planet.groundAt(-150, -95).toFixed(4),
      laser: JSON.stringify(g.stats.laser),
    };
  });
  const base = await snapshotState();
  const seen = {};
  for (const t of ["basic", "enhanced", "ultra", "basic"]) {
    await page.evaluate((tier) => window.__GF.setTier(tier), t);
    await page.waitForTimeout(3000);
    const s = await st(page);
    const now = await snapshotState();
    seen[t] = s.perf;
    check(`live switch → ${t}: state, deposits, terrain and laser stats unchanged`, JSON.stringify(now) === JSON.stringify(base), `post=${s.perf.post} shadows=${s.perf.shadows}`);
  }
  check("switching changes rendering (Basic: no post/shadows, Ultra: cascaded + post)", seen.basic.post === false && seen.basic.shadows === "none" && seen.ultra.post === true && seen.ultra.shadows === "cascaded");
  check("live switch keeps a single canvas / no reload", (await page.evaluate(() => document.querySelectorAll("canvas").length)) === 1);

  // UI path: Settings → Graphics preset
  await page.keyboard.press("Escape");
  await page.selectOption("#gf-graphics", "enhanced");
  await page.waitForTimeout(2500);
  check("Settings select applies preset live", (await st(page)).tier === "enhanced");
  await page.keyboard.press("Escape");

  // Context loss recovery
  const before = await snapshotState();
  const lost = await page.evaluate(async () => {
    const g = window.__GF.game;
    const gl = g.engine._gl;
    const ext = gl.getExtension("WEBGL_lose_context");
    if (!ext) return "no-ext";
    let frames = 0;
    const obs = g.scene.onAfterRenderObservable.add(() => frames++);
    ext.loseContext();
    await new Promise((r) => setTimeout(r, 1500));
    const during = frames;
    ext.restoreContext();
    await new Promise((r) => setTimeout(r, 6000));
    g.scene.onAfterRenderObservable.remove(obs);
    return { during, after: frames - during, lostFlag: gl.isContextLost() };
  });
  await shot(page, "context-restored.png");
  check("WebGL context loss → restore: rendering resumes", typeof lost === "object" && lost.after > 0 && !lost.lostFlag, JSON.stringify(lost));
  check("context loss: game state preserved", JSON.stringify(await snapshotState()) === JSON.stringify(before));

  // Save → reload → continue; device prefs are separate from the shared save
  await page.evaluate(() => window.__GF.save());
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("orbitbtc.galacticFrontier.presets.main")));
  // M2 asserted schema v2 here. M4 intentionally moved the shared save to v3 (universe, progression, contracts);
  // v2 saves still load (see the "M1 save" check below and tests/m6-gameplay.test.ts). Device prefs must stay out of it.
  check("shared save is the current schema (v4) with no graphics tier inside", saved.version === 4 && !JSON.stringify(saved).includes("enhanced"), `keys: ${Object.keys(saved).join(",")}`);
  await page.goto(`${URL}?debug=1&slot=presets`, { timeout: 240000 });
  await wait(page, () => !!window.__GF, null, 240000);
  await page.click('[data-t="continue"]');
  await wait(page, () => window.__GF.state().mode !== "title");
  const reloaded = await st(page);
  check("reload: device graphics preference restored", reloaded.tier === "enhanced", reloaded.tier);
  check("reload: inventory and mission restored", reloaded.inventory.ferrite === 9 && reloaded.mission.step === before.step);
  check("presets/context/save: no page errors", errors.filter((e) => !/CONTEXT_LOST|context lost/i.test(e)).length === 0, errors.slice(0, 3).join(" | "));
  await ctx.close();
}

async function m1SaveCompat(browser) {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 450 } });
  const page = await ctx.newPage();
  const errors = watch(page);
  // A save exactly as M1 wrote it (v2, legacy quality "medium", partial deposit, landed ship, on foot).
  const m1Save = {
    version: 2, savedAt: Date.now(), mode: "onFoot",
    player: { x: -140, y: 3, z: -100, yaw: 0.5 },
    ship: { x: -150, y: 5, z: -95, yaw: 2.2, hull: 80, state: "landed" },
    inventory: { ferrite: 12, carbon: 3, lumenite: 22, voidQuartz: 1 },
    upgrades: { laserCooling: 1, laserYield: 0, battery: 0, jetpack: 0, cargo: 0, scanner: 1, hull: 0 },
    mission: { missionId: "intro_first_light_v1", step: "mine", runId: "local-m1", startedAt: Date.now() - 600000, completedAt: null, stepCompletedAt: {}, telemetry: { distanceOnFootM: 50, distanceFlownM: 900, scans: 1, collected: { ferrite: 12, carbon: 3, lumenite: 22, voidQuartz: 1 } }, submission: null },
    depleted: { "lumenite-0": Date.now() - 1000 }, partial: { "ferrite-1": 0.5 }, discoveredPois: ["probe"], lootedPois: [],
    settings: { quality: "medium", lookSensitivity: 1.2, invertY: false, showFps: false },
  };
  await page.goto(`${URL}?debug=1&slot=m1compat`, { timeout: 240000 });
  await wait(page, () => !!window.__GF, null, 240000);
  await page.evaluate((s) => localStorage.setItem("orbitbtc.galacticFrontier.m1compat.main", JSON.stringify(s)), m1Save);
  await page.reload({ timeout: 240000 });
  await wait(page, () => !!window.__GF, null, 240000);
  await page.click('[data-t="continue"]');
  await wait(page, () => window.__GF.state().mode === "onFoot");
  const s = await st(page);
  const dep = await page.evaluate(() => {
    const g = window.__GF.game;
    const a = g.planet.deposits.find((d) => d.id === "lumenite-0");
    const b = g.planet.deposits.find((d) => d.id === "ferrite-1");
    return { lum0: a.amount, fer1: b.amount, fer1max: b.max };
  });
  check("M1 save loads in M2: mode, inventory, upgrades, mission step", s.mode === "onFoot" && s.inventory.lumenite === 22 && s.mission.step === "mine" && (await page.evaluate(() => window.__GF.game.levels.scanner)) === 1);
  check("M1 save: deposit ids map to the same deposits (depleted / partial)", dep.lum0 === 0 && dep.fer1 === Math.max(1, Math.round(dep.fer1max * 0.5)), JSON.stringify(dep));
  check("M1 save compat: no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}


/**
 * Gameplay parity: identical scripted inputs at a fixed 60 Hz through the M1
 * build and every M2 tier. Jetpack, mining yield and flight must match exactly.
 */
async function gameplayParity(browser) {
  const m1 = process.env.M1_BUILD || path.resolve(__dirname, "../../m1-baseline/dist/m1-preview.html");
  const runs = [];
  const targets = [];
  if (fs.existsSync(m1)) targets.push(["M1 (medium)", `file://${m1}?debug=1&start=new&slot=par-m1&quality=medium`]);
  for (const t of ["basic", "enhanced", "ultra"]) targets.push([`M2 ${t}`, `${URL}?debug=1&start=new&slot=par-${t}&quality=${t}`]);
  for (const [label, url] of targets) {
    const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
    await page.goto(url, { timeout: 240000 });
    await wait(page, () => window.__GF && window.__GF.state().mode === "ship", null, 300000);
    const r = await page.evaluate(() => {
      const g = window.__GF.game;
      g.engine.stopRenderLoop();
      const base = { moveX: 0, moveY: 0, lookX: 0, lookY: 0, zoom: 0, jumpHeld: false, jumpPressed: false, sprint: false, fire: false, scanPressed: false, interactPressed: false, inventoryPressed: false, menuPressed: false, shipThrottle: 0, shipYaw: 0, shipPitch: 0, lift: 0, boost: false, shipThrottleTarget: null, touch: false };
      // Flight: 6 s full throttle with a turn, from the dock.
      g.ship.requestUndock(g.shipEnv);
      for (let i = 0; i < 360; i++) g.ship.update(1 / 60, { throttle: i < 200 ? 1 : 0, yaw: 0.4, pitch: 0, lift: 0, boost: false, aimYaw: 0, aimPitch: 0 }, g.shipEnv);
      const flight = [g.ship.x, g.ship.y, g.ship.z].map((v) => +v.toFixed(3)).join(",");
      // Jetpack
      g.ship.placeLanded(g.shipEnv, -150, -95, 2.2);
      g.disembark();
      const pl = g.player;
      // Walking: 1.5 s of sprint-forward, the same input the M1 smoke test holds for 1.5 s of wall-clock time.
      const w0 = { x: pl.position.x, z: pl.position.z };
      let simT = 0;
      for (let i = 0; i < 90; i++) { pl.update(1 / 60, { ...base, moveY: 1, sprint: true }, 0, g.planet, false, 0); simT += 1 / 60; }
      const sprintSpeed = +Math.hypot(pl.velocity.x, pl.velocity.z).toFixed(3);
      const walk = +Math.hypot(pl.position.x - w0.x, pl.position.z - w0.z).toFixed(3);
      // Normal walk (no sprint) for exactly 1.5 s of simulated time, from a standstill at the same spot.
      for (let i = 0; i < 60; i++) pl.update(1 / 60, base, 0, g.planet, false, 0);
      g.ship.placeLanded(g.shipEnv, -150, -95, 2.2);
      g.disembark();
      const n0 = { x: pl.position.x, z: pl.position.z };
      let walkT = 0;
      for (let i = 0; i < 90; i++) { pl.update(1 / 60, { ...base, moveY: 1 }, 0, g.planet, false, 0); walkT += 1 / 60; }
      const walkSpeed = +Math.hypot(pl.velocity.x, pl.velocity.z).toFixed(3);
      const walkDistance = +Math.hypot(pl.position.x - n0.x, pl.position.z - n0.z).toFixed(3);
      for (let i = 0; i < 60; i++) pl.update(1 / 60, base, 0, g.planet, false, 0);
      const move = { sprintSeconds: +simT.toFixed(3), sprintDistance: walk, sprintSpeed, walkSeconds: +walkT.toFixed(3), walkDistance, walkSpeed };
      g.ship.placeLanded(g.shipEnv, -150, -95, 2.2);
      g.disembark();
      const y0 = pl.position.y;
      let maxH = 0;
      for (let i = 0; i < 72; i++) {
        pl.update(1 / 60, { ...base, jumpHeld: true, jumpPressed: i === 0 }, 0, g.planet, false, 0);
        maxH = Math.max(maxH, pl.position.y - y0);
      }
      for (let i = 0; i < 300; i++) pl.update(1 / 60, base, 0, g.planet, false, 0);
      // Mining: the same deposit, 6 s of laser fire through the real game update.
      const id = window.__GF.approach("ferrite");
      for (let i = 0; i < 360; i++) g.updateFoot(1 / 60, { ...base, fire: true });
      return { flight, walk, move, jetHeight: +maxH.toFixed(3), fuel: +pl.jetFuel.toFixed(2), deposit: id, ferrite: g.inventory.get("ferrite"), heat: +g.laser.heat.toFixed(2), energy: +g.laser.energy.toFixed(2) };
    });
    runs.push({ label, ...r });
    console.log(`PARITY ${label}: ${JSON.stringify(r)}`);
    await page.close();
  }
  const ref = runs[0];
  for (const r of runs.slice(1)) {
    const same = r.flight === ref.flight && JSON.stringify(r.move) === JSON.stringify(ref.move) && r.jetHeight === ref.jetHeight && r.deposit === ref.deposit && r.ferrite === ref.ferrite && r.heat === ref.heat && r.energy === ref.energy;
    check(`gameplay parity ${r.label} vs ${ref.label}: flight, walking, jetpack, mining yield, heat, energy`, same, `sprint 1.5 s ${ref.walk}/${r.walk} m @ ${ref.move.sprintSpeed}/${r.move.sprintSpeed} m/s, walk 1.5 s ${ref.move.walkDistance}/${r.move.walkDistance} m @ ${ref.move.walkSpeed}/${r.move.walkSpeed} m/s, ferrite ${ref.ferrite}/${r.ferrite}, jet ${ref.jetHeight}/${r.jetHeight}`);
  }
  profile.push({ parity: runs });
}

async function profileTiers(browser) {
  for (const tier of ["basic", "enhanced", "ultra"]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    const t0 = Date.now();
    await page.goto(`${URL}?debug=1&start=new&slot=prof-${tier}&quality=${tier}`, { timeout: 240000 });
    await wait(page, () => window.__GF && window.__GF.state().mode === "ship", null, 300000);
    const loadMs = Date.now() - t0;
    await page.evaluate(() => window.__GF.setAdaptive(false));
    await toSurface(page);
    const r = await page.evaluate(async () => {
      const g = window.__GF.game;
      const e = g.engine;
      e.stopRenderLoop();
      const gl = e._gl;
      const px = new Uint8Array(4);
      const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      for (let i = 0; i < 3; i++) g.scene.render();
      sync();
      const n = 5;
      let cpu = 0;
      const t = performance.now();
      for (let i = 0; i < n; i++) {
        const c0 = performance.now();
        g.update(1 / 60);
        g.scene.render();
        cpu += performance.now() - c0;
        sync();
      }
      const frameMs = (performance.now() - t) / n;
      const s = g.renderer.stats();
      e.runRenderLoop(() => g.frame());
      return { frameMs, cpuSubmitMs: cpu / n, stats: s, world: g.planet.stats() };
    });
    profile.push({ tier, loadMs, ...r });
    console.log(`PROFILE ${tier}: ${r.frameMs.toFixed(0)} ms/frame (SwiftShader), ${r.stats.drawCalls} draws, ${Math.round(r.stats.triangles / 1000)}k tris, tex ${r.stats.textureMB} MB, heap ${r.stats.jsHeapMB} MB`);
    await shot(page, `profile-${tier}.png`);
    await ctx.close();
  }
}

(async () => {
  const browser = await chromium.launch({ args: ARGS });
  const steps = [gameplayParity, pcScreens, androidScreens, telegramScreens, orientationAndTouch, presetsContextSave, m1SaveCompat, profileTiers];
  const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
  for (const s of steps) {
    if (only && !only.includes(s.name)) continue;
    try {
      await s(browser);
    } catch (e) {
      check(`${s.name} completed`, false, String(e && e.message).split("\n")[0]);
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, "m2-results.json"), JSON.stringify({ results, profile }, null, 2));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} M2 checks passed. Output: ${OUT}`);
  process.exit(failed ? 1 : 0);
})();
