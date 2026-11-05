import { test } from "node:test";
import assert from "node:assert/strict";
import { CinematicController, CINEMATIC_TUNING, cinematicCeiling, frameStats, type CinematicContext, type CinematicLevel } from "../src/presentation/full/cinematicController";

const ctx = (o: Partial<CinematicContext> = {}): CinematicContext => ({ targetFps: 60, ceiling: 3, trusted: true, reductions: 0, renderScale: 1, maxRenderScale: 1, thermal: null, ...o });
const P = 1000 / 60;

/** Runs `seconds` of frames of `ms` each; returns every level change. */
function run(c: CinematicController, seconds: number, ms: number | ((i: number) => number), x: CinematicContext = ctx()) {
  const out = [];
  const n = Math.round((seconds * 1000) / (typeof ms === "number" ? ms : P));
  for (let i = 0; i < n; i++) {
    const r = c.frame(typeof ms === "number" ? ms : ms(i), x);
    if (r) out.push(r);
  }
  return out;
}

test("frame statistics", () => {
  const s = frameStats([10, 10, 10, 10, 40], 60);
  assert.equal(s.frames, 5);
  assert.equal(s.avgMs, 16);
  assert.equal(s.p99Ms, 40);
  assert.equal(s.missFraction, 0.2);
  assert.equal(frameStats([], 60).frames, 0);
});

test("starts at level 0 and measures a baseline before the first promotion", () => {
  const c = new CinematicController();
  assert.equal(c.level, 0);
  assert.equal(run(c, 2, P).length, 0, "nothing during settling");
  assert.equal(run(c, 8, P).length, 0, "settle (3 s) + a full clean window (8 s) are required");
  const ch = run(c, 6, P);
  assert.equal(ch[0]?.to, 1);
  assert.ok(c.baseline && c.baseline.missFraction === 0, "baseline recorded from the level-0 window");
});

test("a device that never has a clean window never leaves level 0", () => {
  const c = new CinematicController();
  // 5 % of frames miss badly: never clean.
  const ch = run(c, 120, (i) => (i % 20 === 0 ? 45 : P));
  assert.equal(ch.length, 0);
  assert.equal(c.level, 0);
});

test("never promotes when untrusted (software renderer), under governor pressure, when hot or above the ceiling", () => {
  for (const x of [ctx({ trusted: false }), ctx({ reductions: 1 }), ctx({ ceiling: 0 })]) {
    const c = new CinematicController();
    assert.equal(run(c, 60, P, x).length, 0);
    assert.equal(c.level, 0);
  }
  const hot = new CinematicController();
  hot.force(2);
  assert.equal(hot.level, 2, "forced levels are pinned");
  assert.equal(run(hot, 60, 100).length, 0, "a forced level is never auto-changed");
});

test("climbs one level at a time on a clean device up to the ceiling, then stops", () => {
  const c = new CinematicController();
  const ch = run(c, 150, P, ctx({ ceiling: 2 }));
  assert.deepEqual(ch.map((x) => x.to), [1, 2]);
  assert.equal(c.level, 2);
  assert.equal(run(c, 60, P, ctx({ ceiling: 2 })).length, 0);
});

test("rolls back when the new level costs frames, and blocks the level after repeated failures", () => {
  const c = new CinematicController();
  let level: CinematicLevel = 0;
  // Frames are clean at level 0, 12 % missed frames at level >= 1.
  const feed = (sec: number) => run(c, sec, (i) => (level >= 1 && i % 8 === 0 ? 40 : P));
  const events: [number, number][] = [];
  for (let t = 0; t < 900 && events.length < 6; t += 5) {
    const before = c.level;
    for (const ch of feed(5)) events.push([ch.from, ch.to]);
    level = c.level;
    assert.ok(Math.abs(c.level - before) <= 2);
  }
  const promotions = events.filter(([f, t]) => t > f).length;
  const rollbacks = events.filter(([f, t]) => t < f).length;
  assert.ok(rollbacks >= 1, "rolled back");
  assert.ok(promotions <= CINEMATIC_TUNING.maxRollbacksPerLevel + 1, `bounded retries (promotions=${promotions})`);
  assert.ok(c.blocked.includes(1), "level 1 is blocked after repeated rollbacks");
  assert.equal(c.level, 0);
});

test("thermal throttling and governor pressure demote immediately", () => {
  const c = new CinematicController();
  run(c, 40, P, ctx({ ceiling: 3 }));
  assert.ok(c.level >= 1);
  const ch = c.frame(P, ctx({ thermal: 3 }));
  assert.equal(ch?.to, 0);
  const d = new CinematicController();
  run(d, 40, P);
  const lv = d.level;
  const r = d.frame(P, ctx({ reductions: 1 }));
  assert.equal(r?.to, lv - 1);
});

test("ceiling by tier: basic never, enhanced 1, ultra 2 or 3 on identified flagships", () => {
  assert.equal(cinematicCeiling("basic", true), 0);
  assert.equal(cinematicCeiling("enhanced", true), 1);
  assert.equal(cinematicCeiling("ultra", false), 2);
  assert.equal(cinematicCeiling("ultra", true), 3);
});
