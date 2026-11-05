import { test } from "node:test";
import assert from "node:assert/strict";
import { Inventory } from "../src/gameplay/inventory";
import { MiningLaserState, BASE_LASER } from "../src/gameplay/miningLaser";
import { UPGRADES, deriveStats, emptyLevels, purchaseUpgrade, sanitizeLevels } from "../src/gameplay/upgrades";
import { IntroMission, MISSION_REQUIREMENTS } from "../src/gameplay/mission";

test("inventory respects capacity and spends atomically", () => {
  const inv = new Inventory(50);
  assert.equal(inv.add("lumenite", 30.9), 30);
  assert.equal(inv.add("lumenite", 40), 20, "only 20 fit under the cap");
  assert.equal(inv.get("lumenite"), 50);
  assert.equal(inv.spend({ lumenite: 10, ferrite: 1 }), false, "missing ferrite → nothing spent");
  assert.equal(inv.get("lumenite"), 50);
  assert.equal(inv.spend({ lumenite: 10 }), true);
  assert.equal(inv.get("lumenite"), 40);
});

test("inventory sanitize drops junk and negatives", () => {
  const c = Inventory.sanitize({ ferrite: 12.7, carbon: -5, bogus: 3, lumenite: "9", voidQuartz: Infinity });
  assert.deepEqual(c, { ferrite: 12, carbon: 0, lumenite: 0, voidQuartz: 0 });
});

test("laser drains energy, overheats, locks out and recovers", () => {
  const l = new MiningLaserState(BASE_LASER);
  let overheatedAt = -1;
  let extracted = 0;
  for (let i = 0; i < 600; i++) {
    const t = l.update(0.01, true, true);
    extracted += t.extracted;
    if (t.justOverheated) {
      overheatedAt = i;
      break;
    }
  }
  assert.ok(overheatedAt > 0, "laser overheats under continuous fire");
  const expectedSeconds = 100 / BASE_LASER.heatPerSec;
  assert.ok(Math.abs(overheatedAt * 0.01 - expectedSeconds) < 0.05);
  assert.ok(Math.abs(extracted - BASE_LASER.yieldPerSec * expectedSeconds) < 0.5);
  assert.ok(l.energy < BASE_LASER.maxEnergy);

  // Locked while overheated even if trigger held.
  assert.equal(l.update(0.1, true, true).firing, false);
  // Cools down and unlocks.
  for (let i = 0; i < 300 && l.overheated; i++) l.update(0.01, false, false);
  assert.equal(l.overheated, false);
  assert.ok(l.heat <= BASE_LASER.overheatRecoverAt);
});

test("laser regenerates energy only after the delay", () => {
  const l = new MiningLaserState(BASE_LASER, 50);
  l.update(BASE_LASER.regenDelay / 2, false, false);
  assert.equal(l.energy, 50);
  l.update(BASE_LASER.regenDelay, false, false);
  assert.ok(l.energy > 50);
});

test("laser reports out-of-energy once per trigger pull", () => {
  const l = new MiningLaserState(BASE_LASER, 0);
  assert.equal(l.update(0.1, true, true).outOfEnergy, true);
  assert.equal(l.update(0.1, true, true).outOfEnergy, false);
  l.update(0.1, false, false);
  // Still empty (regen delay), new pull warns again.
  assert.equal(l.update(0.1, true, true).outOfEnergy, true);
});

test("upgrades cost resources and change derived stats", () => {
  const levels = emptyLevels();
  const inv = new Inventory(1000, { ferrite: 100, lumenite: 100 });
  const base = deriveStats(levels);
  const r = purchaseUpgrade(levels, "laserCooling", inv);
  assert.deepEqual(r, { ok: true, level: 1 });
  assert.equal(inv.get("ferrite"), 70);
  assert.ok(deriveStats(levels).laser.heatPerSec < base.laser.heatPerSec);
  const poor = new Inventory(1000);
  assert.deepEqual(purchaseUpgrade(levels, "laserCooling", poor), { ok: false, reason: "funds" });
  for (const def of UPGRADES) assert.ok(def.effects.length === def.costs.length + 1, `${def.id} effects per level`);
});

test("upgrade levels are clamped on load", () => {
  const l = sanitizeLevels({ laserCooling: 99, hull: -3, cargo: 1.9, junk: 4 });
  assert.equal(l.laserCooling, 3);
  assert.equal(l.hull, 0);
  assert.equal(l.cargo, 1);
});

test("intro mission runs end to end in order", () => {
  let now = 1_000;
  const m = new IntroMission(null, () => now);
  m.start("run-1");
  assert.equal(m.step, "launch");
  assert.equal(m.handle({ type: "landed" }), false, "cannot skip ahead");
  const seq = [{ type: "undocked" }, { type: "landed" }, { type: "disembarked" }] as const;
  for (const e of seq) {
    now += 1000;
    assert.equal(m.handle(e), true);
  }
  assert.equal(m.handle({ type: "scanned", found: 0 }), false, "empty scan does not count");
  assert.equal(m.handle({ type: "scanned", found: 3 }), true);
  assert.equal(m.step, "mine");
  m.handle({ type: "collected", resource: "lumenite", amount: MISSION_REQUIREMENTS.lumenite! });
  assert.equal(m.step, "mine");
  m.handle({ type: "collected", resource: "ferrite", amount: MISSION_REQUIREMENTS.ferrite! });
  assert.equal(m.step, "takeoff");
  m.handle({ type: "tookOff" });
  m.handle({ type: "docked" });
  assert.equal(m.step, "deliver");
  now += 5000;
  m.handle({ type: "delivered" });
  assert.equal(m.isComplete, true);
  assert.equal(m.state.completedAt, now);
  assert.equal(m.state.telemetry.scans, 2);
});

test("samples collected before scanning still complete the mine step", () => {
  const m = new IntroMission();
  m.start("r");
  m.handle({ type: "undocked" });
  m.handle({ type: "landed" });
  m.handle({ type: "disembarked" });
  m.handle({ type: "collected", resource: "lumenite", amount: 50 });
  m.handle({ type: "collected", resource: "ferrite", amount: 50 });
  m.handle({ type: "scanned", found: 1 });
  assert.equal(m.step, "takeoff");
});

test("telemetry ignores events before the run starts", () => {
  const m = new IntroMission();
  m.handle({ type: "collected", resource: "lumenite", amount: 50 });
  assert.equal(m.state.telemetry.collected.lumenite, 0);
});
