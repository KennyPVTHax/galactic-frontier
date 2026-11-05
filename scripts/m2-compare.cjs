/**
 * Before/after visual comparison: identical camera setups rendered by the M1
 * build and by each M2 tier. Writes individual PNGs plus a composite grid.
 *
 *   node scripts/m2-compare.cjs <m1-preview.html> [outDir]
 */
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const M1 = path.resolve(process.argv[2] || path.join(__dirname, "../../m1-baseline/dist/m1-preview.html"));
const OUT = path.resolve(process.argv[3] || "m2-compare");
const M2 = path.resolve(__dirname, "../dist/preview/index.html");
fs.mkdirSync(OUT, { recursive: true });

const builds = [
  ["m1", `file://${M1}?debug=1&start=new&slot=cmp-m1&quality=medium`],
  ["m2-basic", `file://${M2}?debug=1&start=new&slot=cmp-b&quality=basic`],
  ["m2-enhanced", `file://${M2}?debug=1&start=new&slot=cmp-e&quality=enhanced`],
  ["m2-ultra", `file://${M2}?debug=1&start=new&slot=cmp-u&quality=ultra`],
];

const views = {
  docked: (g) => {
    g.rig.yaw = Math.PI;
    g.rig.pitch = 0.12;
  },
  surface: (g) => {
    g.ship.placeLanded(g.shipEnv, -150, -95, 2.2);
    g.disembark();
    g.rig.yaw = 0.6;
    g.rig.pitch = 0.14;
  },
  mining: (g) => {
    window.__GF.approach("lumenite");
  },
  aerial: (g) => {
    if (g.mode === "onFoot") g.enterShip(false);
    const h = g.planet.groundAt(-150, 40);
    g.ship.state = "flying";
    Object.assign(g.ship, { x: -150, y: h + 55, z: 40, yaw: Math.PI, pitch: -0.32, roll: 0, speed: 0, throttle: 0.4 });
    g.hud.setMode("flight");
    // Freeze the simulation and snap the chase camera so every build shows the same frame,
    // whatever its (software-rendered) frame rate.
    g.timeScale = 1e-6;
    g.gear = 0;
    const V = g.rig.camera.position.constructor;
    g.rig.updateChase(0.05, new V(g.ship.x, g.ship.y, g.ship.z), g.ship.yaw, g.ship.pitch, g.planet, true);
  },
};

(async () => {
  const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  // VIEWS=aerial,mining re-renders only those views (others are kept from a previous run).
  const only = process.env.VIEWS ? process.env.VIEWS.split(",") : null;
  // BUILDS=m2-basic re-renders only those builds.
  const onlyBuilds = process.env.BUILDS ? process.env.BUILDS.split(",") : null;
  for (const [label, url] of builds) {
    if (onlyBuilds && !onlyBuilds.includes(label)) continue;
    if (process.env.RESUME && Object.keys(views).every((v) => fs.existsSync(path.join(OUT, `${v}-${label}.png`)))) continue;
    if (only && Object.keys(views).every((v) => !only.includes(v) && fs.existsSync(path.join(OUT, `${v}-${label}.png`)))) continue;
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(url, { timeout: 240000 });
    await page.waitForFunction(() => window.__GF && window.__GF.state().mode === "ship", null, { timeout: 300000 });
    await page.evaluate(() => window.__GF.setAdaptive && window.__GF.setAdaptive(false));
    for (const [name, fn] of Object.entries(views)) {
      await page.evaluate(`(${fn.toString()})(window.__GF.game)`);
      if (fs.existsSync(path.join(OUT, `${name}-${label}.png`)) && (process.env.RESUME || (only && !only.includes(name)))) continue;
      // Hold the trigger without pointer lock (headless pointer lock stalls rendering).
      if (name === "mining") await page.evaluate(() => (window.__GF.game.input.lmb = true));
      await page.waitForTimeout(label === "m2-ultra" ? 9000 : 5000);
      await page.screenshot({ path: path.join(OUT, `${name}-${label}.png`), timeout: 240000 });
      if (name === "mining") await page.evaluate(() => (window.__GF.game.input.lmb = false));
      console.log(`${label} ${name}`);
    }
    await page.close();
  }
  await browser.close();

  // Composite grid: rows = views, columns = builds.
  let sharp;
  try {
    sharp = require("sharp");
  } catch {
    sharp = require(path.join(process.env.HOME || "/root", ".npm-global/lib/node_modules/sharp"));
  }
  const W = 640, H = 360, LBL = 34;
  const cols = builds.map((b) => b[0]);
  const rows = Object.keys(views);
  const tiles = [];
  for (let r = 0; r < rows.length; r++)
    for (let c = 0; c < cols.length; c++) tiles.push({ input: await sharp(path.join(OUT, `${rows[r]}-${cols[c]}.png`)).resize(W, H).toBuffer(), left: c * W, top: LBL + r * H });
  const labels = ["M1 (before, Medium)", "M2 Telegram Basic", "M2 PC Enhanced", "M2 Android Ultra"];
  const svg = `<svg width="${W * cols.length}" height="${LBL}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#0b0918"/>${labels.map((l, i) => `<text x="${i * W + 14}" y="23" font-family="Arial" font-size="18" fill="#ece9ff">${l}</text>`).join("")}</svg>`;
  tiles.push({ input: Buffer.from(svg), left: 0, top: 0 });
  await sharp({ create: { width: W * cols.length, height: LBL + H * rows.length, channels: 3, background: "#000" } }).composite(tiles).jpeg({ quality: 82 }).toFile(path.join(OUT, "before-after-grid.jpg"));
  console.log("grid written");
})();
