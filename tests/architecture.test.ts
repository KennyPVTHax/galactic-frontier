/**
 * Architecture guard: "one universe, two visual experiences".
 *
 * The canonical gameplay rules (the SHARED CORE) must never depend on rendering, the DOM, a platform layer or a
 * graphics tier, so Telegram Lite and the Android build cannot drift into two different games. This test enforces
 * that mechanically, and pins the rules to a golden fingerprint so any rules change is deliberate and reviewed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { rulesFingerprint, rulesManifest, rulesSectionFingerprints } from "../src/shared/rules";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Every module that decides what is TRUE in the game. */
export const SHARED_CORE = [
  "src/gameplay/resources.ts", "src/gameplay/inventory.ts", "src/gameplay/upgrades.ts", "src/gameplay/mission.ts",
  "src/gameplay/contracts.ts", "src/gameplay/progression.ts", "src/gameplay/hazards.ts", "src/gameplay/miningLaser.ts", "src/gameplay/farming.ts",
  "src/combat/ids.ts", "src/combat/vec.ts", "src/combat/damage.ts", "src/combat/weapons.ts", "src/combat/projectiles.ts", "src/combat/enemyTypes.ts",
  "src/combat/ai.ts", "src/combat/allies.ts", "src/combat/boss.ts", "src/combat/squadron.ts", "src/combat/targeting.ts", "src/combat/encounters.ts",
  "src/combat/events.ts", "src/combat/hudView.ts", "src/combat/combatSystem.ts", "src/combat/debug.ts",
  "src/universe/types.ts", "src/universe/planets.ts", "src/world/heightfield.ts", "src/vehicles/shipPhysics.ts",
  "src/persistence/saveSystem.ts", "src/integration/backend.ts", "src/sync/ledger.ts", "src/sync/protocol.ts",
  "src/core/random.ts", "src/core/worldConfig.ts", "src/shared/rules.ts",
].filter((f) => existsSync(join(ROOT, f)));

/** Browser/platform globals the shared core may not touch (storage adapters are the one named exception). */
const FORBIDDEN_GLOBALS = [/\bdocument\./, /\bwindow\b/, /\bnavigator\b/, /\brequestAnimationFrame\b/, /\bHTMLElement\b/, /\bcanvas\b/i];
const STORAGE_ALLOWED = new Set(["src/persistence/saveSystem.ts"]);

const importsOf = (src: string): string[] => [...src.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/g)].map((m) => m[1]);

test("the shared core is a real, non-trivial set of modules", () => {
  assert.ok(SHARED_CORE.length >= 28, `shared core lists ${SHARED_CORE.length} modules`);
});

test("shared-core modules import only other shared-core modules (no Babylon, rendering, UI, input, platform or presentation code)", () => {
  const core = new Set(SHARED_CORE.map((f) => normalize(f)));
  const offenders: string[] = [];
  for (const f of SHARED_CORE) {
    const src = readFileSync(join(ROOT, f), "utf8");
    for (const spec of importsOf(src)) {
      if (!spec.startsWith(".")) {
        offenders.push(`${f}: package import "${spec}"`);
        continue;
      }
      const target = normalize(join(dirname(f), spec)).replace(/\.ts$/, "") + ".ts";
      if (!core.has(target)) offenders.push(`${f}: imports non-core module "${spec}"`);
    }
  }
  assert.deepEqual(offenders, [], "shared rules must not depend on presentation code");
});

test("shared-core modules touch no DOM / window / navigator / canvas", () => {
  const offenders: string[] = [];
  for (const f of SHARED_CORE) {
    const src = readFileSync(join(ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    for (const re of FORBIDDEN_GLOBALS) if (re.test(src)) offenders.push(`${f}: ${re}`);
    if (!STORAGE_ALLOWED.has(f) && /\blocalStorage\b/.test(src)) offenders.push(`${f}: localStorage`);
  }
  assert.deepEqual(offenders, []);
});

test("presentation code does not define its own rules tables (rewards, costs, stats live in the shared core)", () => {
  // Heuristic guard against a second, divergent implementation: reward/cost/xp literals in presentation folders.
  const files = ["src/ui/hud.ts", "src/ui/frontierUi.ts", "src/world/planet.ts", "src/world/station.ts", "src/graphics/renderer.ts", "src/graphics/profiles.ts"];
  const offenders: string[] = [];
  for (const f of files) {
    const src = readFileSync(join(ROOT, f), "utf8");
    if (/\bxp\s*:\s*\d+/.test(src)) offenders.push(`${f}: xp literal`);
    if (/\b(reward|buildCost|costs)\s*:\s*[\[{]/.test(src)) offenders.push(`${f}: reward/cost table`);
  }
  assert.deepEqual(offenders, []);
});

test("rules manifest is deterministic, free of presentation data and of any financial vocabulary", () => {
  const a = JSON.stringify(rulesManifest()), b = JSON.stringify(rulesManifest());
  assert.equal(a, b);
  assert.equal(rulesFingerprint(), rulesFingerprint());
  assert.match(rulesFingerprint(), /^[0-9a-f]{14}$/);
  const lower = a.toLowerCase();
  for (const w of ["zenith", "horizon", "palette", "tagline", "emissive", "bloom"]) assert.ok(!lower.includes(`"${w}"`), `presentation key "${w}" leaked into the rules`);
  assert.ok(!/\b(coin|wallet|usdt|bitcoin)\b/.test(lower), "no financial vocabulary in the rules");
});

test("golden fingerprint: any change to gameplay rules must be deliberate (UPDATE_GOLDEN=1 npm test to accept)", () => {
  const path = join(ROOT, "tests/golden/rules-fingerprint.json");
  const now = { fingerprint: rulesFingerprint(), saveVersion: rulesManifest().saveVersion, sections: rulesSectionFingerprints() };
  if (process.env.UPDATE_GOLDEN === "1" || !existsSync(path)) {
    writeFileSync(path, JSON.stringify(now, null, 2) + "\n");
    return;
  }
  const golden = JSON.parse(readFileSync(path, "utf8")) as typeof now;
  const changed = Object.keys({ ...golden.sections, ...now.sections }).filter((k) => golden.sections[k] !== now.sections[k]);
  assert.equal(now.fingerprint, golden.fingerprint, `Gameplay rules changed in: ${changed.join(", ") || "(manifest layout)"}. If intended, run UPDATE_GOLDEN=1 npm test and describe the balance/rules change in the PR — Telegram and Android both inherit it.`);
});
