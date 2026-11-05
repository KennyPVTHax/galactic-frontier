/**
 * Cross-package parity (M8): runs the SAME scripted gameplay in the real Full bundle and the real Lite (Telegram) bundle and
 * requires identical outcomes. Graphics differ; rules, rewards, costs, farming, upgrades and saves must not.
 *
 *   node scripts/build.mjs preview && node scripts/build.mjs telegram-test && node scripts/parity-test.cjs
 *
 * Checks: rules manifest + fingerprint (equal across packages and equal to tests/golden/rules-fingerprint.json), derived ship
 * stats for fixed upgrades, Orbital Harvester build/claim/upgrade with an explicit clock, inventory/XP/save contents, starter
 * contract state. Software-rendered; nothing here measures performance.
 */
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const golden = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../tests/golden/rules-fingerprint.json"), "utf8"));
const results = [];
function check(name, ok, detail = "") {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

async function scenario(browser, build, tier) {
  const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto("file://" + path.resolve(__dirname, `../dist/${build}/index.html`) + `?debug=1&quality=${tier}&start=new&slot=parity${Date.now()}`);
  await page.waitForFunction(() => window.__GF && window.__GF.state().mode === "ship", null, { timeout: 240000 });
  const out = await page.evaluate(() => {
    const GF = window.__GF;
    // The game's farm starts at the real clock; use an explicit clock RELATIVE to it so both packages see identical elapsed time.
    const T0 = Math.max(...Object.values(GF.game.farm).map((x) => x.updatedAt)) + 1000;
    const r = {};
    r.rules = GF.state().rules;
    r.manifest = JSON.stringify(GF.rulesManifest());
    r.package = GF.game.constructor.name;
    r.contract0 = GF.game.contracts.state.active ? GF.game.contracts.state.active.id : null;
    GF.setUpgrades({ laserCooling: 2, hull: 1, shield: 2, weapons: 1, engine: 1 });
    r.stats = JSON.stringify(GF.derivedStats());
    for (const k of ["ferrite", "carbon", "lumenite", "voidQuartz"]) GF.give(k, 400);
    r.inv0 = JSON.stringify(GF.state().inventory);
    r.build1 = GF.farmBuild("ferriteRig", T0);
    r.build2 = GF.farmBuild("carbonRig", T0);
    r.claimEarly = JSON.stringify(GF.farmClaim(T0 + 10 * 60_000));
    r.claim3h = JSON.stringify(GF.farmClaim(T0 + 3 * 3_600_000));
    r.upgrade = GF.farmBuild("ferriteRig", T0 + 3 * 3_600_000);
    r.claimCapped = JSON.stringify(GF.farmClaim(T0 + 100 * 3_600_000));
    r.farm = JSON.stringify(Object.fromEntries(Object.entries(GF.state().farm).map(([k, v]) => [k, { ...v, updatedAt: v.updatedAt - T0 }])));
    r.inv1 = JSON.stringify(GF.state().inventory);
    r.xp = GF.state().xp;
    return r;
  });
  check(`${build}: no page errors`, errs.length === 0, errs.slice(0, 2).join(" | "));
  await page.close();
  return out;
}

(async () => {
  const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const full = await scenario(b, "preview", "ultra");
  const lite = await scenario(b, "telegram-test", "basic");
  await b.close();

  check("rules fingerprint equals the golden value in both packages", full.rules === golden.fingerprint && lite.rules === golden.fingerprint, `${full.rules} / ${lite.rules}`);
  check("full rules manifest is byte-identical across packages", full.manifest === lite.manifest, `${full.manifest.length} bytes`);
  check("starter contract identical", full.contract0 === lite.contract0 && full.contract0 === "aetherion_signal", String(full.contract0));
  for (const k of ["stats", "inv0", "build1", "build2", "claimEarly", "claim3h", "upgrade", "claimCapped", "farm", "inv1", "xp"]) {
    check(`scenario step "${k}" identical`, JSON.stringify(full[k]) === JSON.stringify(lite[k]), String(full[k]).slice(0, 80));
  }
  check("harvesters actually produced rewards (the scenario is not vacuous)", JSON.parse(full.claim3h).ferrite > 0 && JSON.parse(full.claimCapped).ferrite > 0, full.claim3h);
  const failed = results.filter((x) => !x).length;
  console.log(`\n${results.length - failed}/${results.length} parity checks passed`);
  process.exit(failed ? 1 : 0);
})();
