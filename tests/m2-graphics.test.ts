import { test } from "node:test";
import assert from "node:assert/strict";
import { PROFILES, TIER_ORDER, capabilityCeiling, effectiveProfile, resolveTier, tierFromLegacy, legacyFromTier, type GpuCapabilities } from "../src/graphics/profiles";
import { QualityGovernor } from "../src/graphics/governor";
import { deriveStats, emptyLevels } from "../src/gameplay/upgrades";
import { MISSION_REQUIREMENTS } from "../src/gameplay/mission";

const strongPhone: GpuCapabilities = { webgl2: true, maxTextureSize: 8192, renderer: "Adreno (TM) 740", deviceMemoryGb: 8, cores: 8, isMobile: true };
const weakPhone: GpuCapabilities = { webgl2: true, maxTextureSize: 4096, renderer: "Mali-G52", deviceMemoryGb: 3, cores: 8, isMobile: true };
const desktop: GpuCapabilities = { webgl2: true, maxTextureSize: 16384, renderer: "NVIDIA GeForce RTX 3060", deviceMemoryGb: 8, cores: 12, isMobile: false };

test("platform defaults: Telegram basic, PC enhanced, Android ultra", () => {
  assert.equal(resolveTier("auto", "telegram", strongPhone).tier, "basic");
  assert.equal(resolveTier("auto", "desktop", desktop).tier, "enhanced");
  assert.equal(resolveTier("auto", "android-app", strongPhone).tier, "ultra");
  assert.equal(resolveTier("auto", "android-browser", strongPhone).tier, "ultra");
});

test("auto respects hardware ceiling; explicit choice is honoured", () => {
  assert.equal(resolveTier("auto", "android-app", weakPhone).tier, "basic");
  assert.equal(capabilityCeiling({ ...strongPhone, webgl2: false }), "enhanced");
  // Capable desktops are not restricted from Ultra.
  assert.equal(resolveTier("ultra", "desktop", desktop).tier, "ultra");
  assert.equal(capabilityCeiling(desktop), "ultra");
  assert.equal(resolveTier("ultra", "telegram", weakPhone).tier, "ultra");
});

test("per-feature fallbacks without WebGL2 and resolution scaling", () => {
  const p = effectiveProfile("ultra", { ...desktop, webgl2: false }, 0.7);
  assert.equal(p.shadows, "single");
  assert.equal(p.post.msaa, 1);
  // Memory budget: cascaded shadows stay at 1024² per cascade on Ultra.
  assert.ok(PROFILES.ultra.shadowMapSize <= 1024);
  assert.equal(p.renderScale, 0.7);
  assert.ok(p.minRenderScale <= p.renderScale);
  // Base table is not mutated.
  assert.equal(PROFILES.ultra.shadows, "cascaded");
});

test("tiers are ordered by cost", () => {
  const [b, e, u] = TIER_ORDER.map((t) => PROFILES[t]);
  assert.ok(b.textureSize < e.textureSize && e.textureSize < u.textureSize);
  assert.ok(b.decorDensity < e.decorDensity && e.decorDensity <= u.decorDensity);
  assert.ok(b.particles.dust <= e.particles.dust && e.particles.dust <= u.particles.dust);
  for (const p of [b, e, u]) {
    for (const v of Object.values(p.particles)) assert.ok(v <= 300, "particle systems are bounded");
  }
});

test("legacy M1 quality names map to tiers and back", () => {
  assert.equal(tierFromLegacy("low"), "basic");
  assert.equal(tierFromLegacy("medium"), "enhanced");
  assert.equal(tierFromLegacy("high"), "ultra");
  assert.equal(tierFromLegacy("auto"), null);
  assert.equal(legacyFromTier("ultra"), "high");
});

test("graphics never change gameplay numbers", () => {
  // Gameplay stats are derived only from upgrades; profiles carry no gameplay fields.
  const s = JSON.stringify(deriveStats(emptyLevels()));
  for (const t of TIER_ORDER) {
    const keys = Object.keys(PROFILES[t]);
    for (const k of ["yield", "reward", "laser", "cargo", "mission", "coin", "resource"]) assert.ok(!keys.some((x) => x.toLowerCase().includes(k)), `${t} has no ${k} field`);
  }
  assert.equal(JSON.stringify(deriveStats(emptyLevels())), s);
  assert.deepEqual(MISSION_REQUIREMENTS, { lumenite: 40, ferrite: 30 });
});

test("governor lowers resolution first, then effects, never below floor", () => {
  const g = new QualityGovernor({ maxScale: 1, minScale: 0.6, targetFps: 30 });
  const actions: string[] = [];
  for (let i = 0; i < 60 * 40; i++) for (const a of g.update(1 / 60, 18)) actions.push(a.type === "scale" ? `scale:${a.scale}` : `reduce:${a.step}`);
  assert.deepEqual(actions.slice(0, 4), ["scale:0.9", "scale:0.8", "scale:0.7", "scale:0.6"]);
  assert.ok(actions.includes("reduce:bloom"));
  assert.ok(actions.indexOf("reduce:bloom") > actions.indexOf("scale:0.6"));
  assert.ok(g.scale >= 0.6);
});

test("governor recovers resolution slowly with headroom and respects disable", () => {
  const g = new QualityGovernor({ maxScale: 1, minScale: 0.6, targetFps: 30 });
  for (let i = 0; i < 60 * 10; i++) g.update(1 / 60, 15);
  const low = g.scale;
  for (let i = 0; i < 60 * 60; i++) g.update(1 / 60, 60);
  assert.ok(g.scale > low);
  const off = new QualityGovernor({ maxScale: 1, minScale: 0.6, targetFps: 30, enabled: false });
  for (let i = 0; i < 600; i++) assert.equal(off.update(1 / 60, 5).length, 0);
});

test("governor reacts to memory pressure once", () => {
  const g = new QualityGovernor({ maxScale: 1, minScale: 0.6, targetFps: 30 });
  for (let i = 0; i < 300; i++) g.update(1 / 60, 60, 0.5);
  const a = [];
  for (let i = 0; i < 300; i++) a.push(...g.update(1 / 60, 60, 0.9));
  assert.equal(a.filter((x) => x.type === "reduce" && x.step === "textures").length, 1);
});
