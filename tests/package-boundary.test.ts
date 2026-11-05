/**
 * Presentation-package boundary (M8): Galactic Frontier Lite (Telegram) vs Full (Android / desktop).
 *
 * Builds both real bundles with scripts/build.mjs and inspects the esbuild metafile (inputs → bytes in the output). Asserts that
 *  - Lite does not contain the heavyweight rendering features or any Full-only presentation module,
 *  - Lite is materially smaller than Full,
 *  - both embed the SAME shared gameplay core files (so rules cannot diverge),
 *  - neither ships WGSL shader sources (WebGL only), and neither contains test hooks.
 * Byte counts here are measurements of the bundles, not of runtime performance on any device.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
interface Meta { outputs: Record<string, { bytes: number; inputs: Record<string, { bytesInOutput: number }> }> }

function build(mode: string, dir: string): { meta: Meta; html: string } {
  execFileSync("node", ["scripts/build.mjs", mode], { cwd: ROOT, stdio: "pipe" });
  const meta = JSON.parse(readFileSync(join(ROOT, `dist/${dir}/meta.json`), "utf8")) as Meta;
  return { meta, html: readFileSync(join(ROOT, `dist/${dir}/index.html`), "utf8") };
}
/** Input files that actually contribute bytes to the output. */
const included = (m: Meta): Map<string, number> => {
  const out = new Map<string, number>();
  for (const o of Object.values(m.outputs)) for (const [k, v] of Object.entries(o.inputs)) if (v.bytesInOutput > 0) out.set(k, (out.get(k) ?? 0) + v.bytesInOutput);
  return out;
};
const total = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

const lite = build("telegram", "telegram");
const full = build("release", "web");
const L = included(lite.meta);
const F = included(full.meta);

test("Lite excludes the heavyweight Babylon features that Full uses", () => {
  const forbidden = [/Materials\/PBR\//, /defaultRenderingPipeline/, /cascadedShadowGenerator/, /Lights\/Shadows\/shadowGenerator\./, /Probes\/reflectionProbe/, /Shaders\/pbr\./, /Layers\/glowLayer/, /Shaders\/shadowMap\./, /Shaders\/glow/];
  for (const re of forbidden) {
    assert.ok(![...L.keys()].some((k) => re.test(k)), `Lite must not include ${re}`);
  }
  // …and the Full bundle really does (otherwise this test proves nothing).
  for (const re of [/Materials\/PBR\//, /defaultRenderingPipeline/, /cascadedShadowGenerator/, /Probes\/reflectionProbe/, /Shaders\/pbr\./]) {
    assert.ok([...F.keys()].some((k) => re.test(k)), `Full must include ${re}`);
  }
});

test("Lite excludes Full-only presentation modules", () => {
  assert.ok(![...L.keys()].some((k) => k.includes("src/presentation/full/")), "no Full-only presentation code in Lite");
  assert.ok(![...L.keys()].some((k) => k.endsWith("src/engine/babylon.ts")), "Lite uses the Lite engine facade");
  assert.ok([...L.keys()].some((k) => k.endsWith("src/engine/babylon.lite.ts")));
  assert.ok(![...F.keys()].some((k) => k.endsWith("src/engine/babylon.lite.ts")), "Full never uses the Lite facade");
});

test("Lite is materially smaller than Full", () => {
  const l = total(L), f = total(F);
  console.log(`[bundle] lite ${(l / 1024).toFixed(0)} KB vs full ${(f / 1024).toFixed(0)} KB of input bytes in output (${((1 - l / f) * 100).toFixed(1)}% smaller)`);
  assert.ok(l < f * 0.85, `Lite (${l}) should be < 85% of Full (${f})`);
  assert.ok(lite.html.length < full.html.length * 0.85);
});

test("both packages embed the same shared gameplay core", () => {
  const core = (m: Map<string, number>) => [...m.keys()].filter((k) => /^src\/(gameplay|universe|sync|shared|persistence)\//.test(k) || /^src\/combat\/(combatSystem|enemyTypes|encounters|weapons)\.ts$/.test(k)).sort();
  const a = core(L), b = core(F);
  assert.ok(a.length > 15, "core files present");
  assert.deepEqual(a, b, "Lite and Full bundle exactly the same shared-core modules");
});

test("no WGSL sources and no test hooks in either shipped bundle", () => {
  for (const [name, m, html] of [["lite", L, lite.html], ["full", F, full.html]] as const) {
    // The stripped modules remain as ~28-byte empty wrappers; real WGSL sources are tens of KB each.
    const wgsl = [...m.entries()].filter(([k]) => /ShadersWGSL/.test(k)).reduce((a, [, v]) => a + v, 0);
    assert.ok(wgsl < 1024, `${name}: WGSL shader sources are stripped (${wgsl} bytes remain)`);
    assert.ok(!html.includes("__GF_EVENTS") && !html.includes("completeContracts") && !html.includes("warpNow"), `${name}: no test hooks`);
    assert.ok(html.includes("default-src 'none'"), `${name}: strict CSP`);
  }
});
