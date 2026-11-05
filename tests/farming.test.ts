import { test } from "node:test";
import assert from "node:assert/strict";
import { FARMING_RULES, RIG_IDS, buildOrUpgrade, claim, freshFarm, nextLevelCost, pending, rigCapacity, rigRatePerHour, sanitizeFarm, settle, type FarmState } from "../src/gameplay/farming";
import { Inventory } from "../src/gameplay/inventory";
import { migrateSave, newGameSave, SAVE_VERSION } from "../src/persistence/saveSystem";

const H = 3_600_000;
const T0 = 1_700_000_000_000;
const rich = () => new Inventory(1000, { ferrite: 1000, carbon: 1000, lumenite: 1000, voidQuartz: 100 });

function built(id: (typeof RIG_IDS)[number], level = 1, inv = rich()): FarmState {
  let f = freshFarm(T0);
  for (let l = 0; l < level; l++) {
    const r = buildOrUpgrade(f, id, inv, T0);
    assert.ok(r.ok, `build/upgrade ${id} to ${l + 1}`);
    if (r.ok) f = r.farm;
  }
  return f;
}

test("rules are plain data: four resource rigs, levels 1-4, no currency fields", () => {
  assert.equal(RIG_IDS.length, 4);
  assert.equal(FARMING_RULES.maxLevel, 4);
  assert.deepEqual(FARMING_RULES.levelMultiplier.length, 5);
  assert.ok(!JSON.stringify(FARMING_RULES).toLowerCase().match(/coin|token|wallet|usd|btc|payment/), "farming has no financial fields");
  assert.deepEqual(new Set(FARMING_RULES.rigs.map((r) => r.resource)), new Set(["ferrite", "carbon", "lumenite", "voidQuartz"]));
});

test("a built rig accrues linearly, caps at storage, and a rig that is not built produces nothing", () => {
  const f = built("ferriteRig");
  assert.equal(pending(f, T0 + 1 * H).ferriteRig, 30);
  assert.equal(pending(f, T0 + 2.5 * H).ferriteRig, 75);
  assert.equal(pending(f, T0 + 100 * H).ferriteRig, 30 * 6, "capped at six hours of output");
  assert.equal(pending(f, T0 + 10 * H).carbonRig, 0, "unbuilt rig yields nothing");
  assert.equal(rigCapacity("ferriteRig", 1), 180);
});

test("upgrades raise rate and capacity, cost more, keep accrued output, and stop at the maximum", () => {
  const inv = rich();
  let f = built("lumenRig", 1, inv);
  const c2 = nextLevelCost(f, "lumenRig")!;
  assert.ok((c2.ferrite ?? 0) > 50 && (c2.lumenite ?? 0) > 40, "upgrade costs more than the build");
  // accrue 2 h, then upgrade: the earned output must survive
  const up = buildOrUpgrade(f, "lumenRig", inv, T0 + 2 * H);
  assert.ok(up.ok);
  f = up.ok ? up.farm : f;
  assert.equal(f.lumenRig.level, 2);
  assert.ok(Math.abs(f.lumenRig.stock - 36) < 1e-9, `2 h × 18/h kept (${f.lumenRig.stock})`);
  assert.equal(rigRatePerHour("lumenRig", 2), 18 * 1.5);
  for (let i = 0; i < 2; i++) {
    const r = buildOrUpgrade(f, "lumenRig", inv, T0 + 2 * H);
    if (r.ok) f = r.farm;
  }
  assert.equal(f.lumenRig.level, 4);
  assert.equal(nextLevelCost(f, "lumenRig"), null);
  const r = buildOrUpgrade(f, "lumenRig", inv, T0 + 2 * H);
  assert.deepEqual(r, { ok: false, reason: "max" });
});

test("building is refused without the resources and spends nothing", () => {
  const poor = new Inventory(250, { ferrite: 10 });
  const r = buildOrUpgrade(freshFarm(T0), "ferriteRig", poor, T0);
  assert.deepEqual(r, { ok: false, reason: "funds" });
  assert.equal(poor.get("ferrite"), 10);
});

test("claim delivers whole units, respects cargo capacity, and leaves the rest stored", () => {
  const f = built("ferriteRig");
  const inv = new Inventory(40, { ferrite: 30 }); // 10 free slots
  const r = claim(f, inv, T0 + 4 * H); // 120 accrued
  assert.equal(r.gained.ferrite, 10);
  assert.equal(r.blocked, 110);
  assert.equal(inv.get("ferrite"), 40);
  assert.ok(Math.abs(r.farm.ferriteRig.stock - 110) < 1e-9, "the undelivered output stays in storage");
  // after making room, the rest can be claimed
  inv.setCapacity(1000);
  const r2 = claim(r.farm, inv, T0 + 4 * H);
  assert.equal(r2.gained.ferrite, 110);
});

test("clock exploits: moving the clock backwards never re-earns a period", () => {
  let f = built("carbonRig");
  const r = claim(f, new Inventory(1000, {}), T0 + 3 * H);
  assert.equal(r.gained.carbon, 72);
  f = r.farm; // claimed 72, stock ~0, updatedAt = T0 + 3h
  const back = settle(f, T0 + 1 * H); // clock goes back 2 h
  assert.equal(back.carbonRig.updatedAt, T0 + 3 * H, "time never moves backwards");
  assert.equal(pending(back, T0 + 1 * H).carbonRig, 0);
  // returning to the real time yields only the genuinely elapsed hour
  assert.equal(pending(back, T0 + 4 * H).carbonRig, 24);
});

test("settling is pure: inputs are never mutated and results are deterministic", () => {
  const f = built("quartzRig");
  const snap = JSON.stringify(f);
  const a = settle(f, T0 + 5 * H), b = settle(f, T0 + 5 * H);
  assert.equal(JSON.stringify(f), snap);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test("sanitize drops junk, clamps level and stock, and keeps a valid state", () => {
  const s = sanitizeFarm({ ferriteRig: { level: 99, stock: 1e9, updatedAt: -5 }, bogus: { level: 3 }, carbonRig: "x", lumenRig: { level: 2, stock: -3, updatedAt: 7 } }, T0);
  assert.equal(s.ferriteRig.level, 4);
  assert.equal(s.ferriteRig.stock, rigCapacity("ferriteRig", 4));
  assert.equal(s.ferriteRig.updatedAt, 0);
  assert.equal(s.carbonRig.level, 0);
  assert.equal(s.lumenRig.stock, 0);
  assert.ok(!("bogus" in s));
  assert.deepEqual(sanitizeFarm(null, T0), freshFarm(T0));
});

test("save v4: a v3 save migrates with all progress intact and an empty farm; a v4 farm round-trips", () => {
  assert.equal(SAVE_VERSION, 4);
  const v3 = { ...newGameSave(T0), version: 3 } as Record<string, unknown>;
  delete v3.farm;
  (v3.inventory as Record<string, number>).voidQuartz = 9;
  (v3.progression as { xp: number }).xp = 321;
  const m = migrateSave(v3)!;
  assert.equal(m.version, 4);
  assert.equal(m.inventory.voidQuartz, 9);
  assert.equal(m.progression.xp, 321);
  for (const id of RIG_IDS) assert.equal(m.farm[id].level, 0);
  const s = newGameSave(T0);
  const f = built("ferriteRig");
  s.farm = settle(f, T0 + 2 * H);
  const back = migrateSave(JSON.parse(JSON.stringify(s)))!;
  assert.equal(back.farm.ferriteRig.level, 1);
  assert.ok(Math.abs(back.farm.ferriteRig.stock - 60) < 1e-9);
});
