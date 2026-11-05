import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

/** Hooks that exist only for browser tests and must never be present in a release bundle. */
const FORBIDDEN = ["window.__GF", "__GF_EVENTS", "aimAtTarget", "teleportShip", "teleportPlayer", "setTimeScale", "warpNow", "installDebugHooks"];

test("release bundle contains no test/cheat hooks, has a strict CSP, and works offline", () => {
  {
    execFileSync(process.execPath, ["scripts/build.mjs", "release"], { stdio: "pipe" });
    const file = "dist/web/index.html";
    assert.ok(existsSync(file), "dist/web/index.html built");
    const html = readFileSync(file, "utf8");
    for (const w of FORBIDDEN) assert.ok(!html.includes(w), `release bundle must not contain "${w}"`);
    assert.match(html, /Content-Security-Policy/);
    assert.match(html, /default-src 'none'/);
    assert.ok(!/connect-src[^;]*https?:/.test(html), "CSP allows no network connections");
    assert.ok(!/<script[^>]+src=/.test(html), "no external scripts");
    assert.ok(!/https?:\/\/(?!www\.w3\.org)[a-z0-9.-]+\.[a-z]{2,}\/[^\s"'<>]*\.(js|css|png|jpg|glb|ktx2)/i.test(html.replace(/<script>[\s\S]*<\/script>/, "")), "no remote assets referenced from the page shell");
  }
});

test("test-build bundle (used by browser tests) does keep the hooks", () => {
  execFileSync(process.execPath, ["scripts/build.mjs", "preview"], { stdio: "pipe" });
  const html = readFileSync("dist/preview/index.html", "utf8");
  assert.ok(html.includes("aimAtTarget") && html.includes("window.__GF"), "preview build exposes test hooks");
});
