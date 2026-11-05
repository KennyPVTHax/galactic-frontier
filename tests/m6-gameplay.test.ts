import { test } from "node:test";
import assert from "node:assert/strict";
import { ContractBoard, CONTRACTS, getContract, objectiveText } from "../src/gameplay/contracts";
import { ACHIEVEMENTS, Progression, RANKS, rankOf, unlockedPaints } from "../src/gameplay/progression";
import { SuitIntegrity } from "../src/gameplay/hazards";
import { UPGRADES, deriveStats, emptyLevels, sanitizeLevels } from "../src/gameplay/upgrades";
import { migrateSave, newGameSave, SAVE_VERSION, MemorySaveAdapter } from "../src/persistence/saveSystem";
import { PLANET_IDS } from "../src/universe/types";
import { RESOURCE_IDS } from "../src/gameplay/resources";

test("new ship-system upgrades derive shield, weapon and engine stats; old saves get level 0", () => {
  const base = deriveStats(emptyLevels());
  assert.equal(base.shield.max, 60);
  assert.equal(base.weapon.damageScale, 1);
  assert.equal(base.speedScale, 1);
  const lv = emptyLevels();
  lv.shield = 3;
  lv.weapons = 3;
  lv.engine = 3;
  const top = deriveStats(lv);
  assert.ok(top.shield.max > base.shield.max && top.shield.regenDelay < base.shield.regenDelay);
  assert.ok(top.weapon.damageScale > 1 && top.weapon.intervalScale < 1);
  assert.ok(top.speedScale > 1.3);
  // An M2 upgrade blob (7 lines) sanitizes with the new lines at 0.
  const m2 = sanitizeLevels({ laserCooling: 2, hull: 1 });
  assert.equal(m2.laserCooling, 2);
  assert.equal(m2.shield, 0);
  assert.equal(UPGRADES.length, 10);
});

test("starter contract drives the required gameplay journey to a reward", () => {
  const b = new ContractBoard();
  assert.equal(b.state.active?.id, "aetherion_signal");
  assert.equal(b.targetPlanet(), "aetherion");
  assert.equal(b.pendingSpawn("aetherion", true), null, "no spawn before arriving");
  assert.ok(b.handle({ type: "arrived", planet: "aetherion" }).advanced);
  assert.equal(b.pendingSpawn("veyra7", true), null);
  assert.equal(b.pendingSpawn("aetherion", false), null, "spawns only while flying");
  assert.equal(b.pendingSpawn("aetherion", true), "first_contact");
  b.markSpawned();
  assert.equal(b.pendingSpawn("aetherion", true), null);
  // Losing the ship resets the fight.
  assert.ok(b.handle({ type: "shipLost" }).failed);
  assert.equal(b.pendingSpawn("aetherion", true), "first_contact");
  b.markSpawned();
  assert.equal(b.handle({ type: "destroyed", planet: "kryos", enemy: "interceptor" }).advanced, false, "wrong planet");
  assert.ok(b.handle({ type: "destroyed", planet: "aetherion", enemy: "interceptor" }).advanced);
  assert.ok(b.handle({ type: "landed", planet: "aetherion" }).advanced);
  assert.equal(b.handle({ type: "scanned", planet: "aetherion", found: 0 }).advanced, false, "empty scan does not count");
  assert.ok(b.handle({ type: "scanned", planet: "aetherion", found: 4 }).advanced);
  assert.equal(b.summary()?.title, "Return to Halcyon Dock");
  const r = b.handle({ type: "docked" });
  assert.equal(r.completed?.id, "aetherion_signal");
  assert.ok(r.completed!.reward.xp > 0);
  assert.equal(b.state.active, null);
  assert.ok(b.available().some((c) => c.id === "kryos_survey"), "follow-up contracts unlock");
  assert.ok(!b.available().some((c) => c.id === "aetherion_signal"), "non-repeatable not offered again");
});

test("contract objectives cover collect progress, escort failure and repeatable bounty", () => {
  const b = new ContractBoard({ active: null, completed: ["aetherion_signal"], repeats: {} });
  assert.ok(b.accept("kryos_survey"));
  b.settle({ planet: "kryos" });
  assert.equal(b.state.active?.step, 1, "travel auto-completes when already there");
  b.handle({ type: "scanned", planet: "kryos", found: 2 });
  b.handle({ type: "collected", planet: "kryos", resource: "voidQuartz", amount: 6 });
  assert.equal(b.summary()?.current, 6);
  b.handle({ type: "collected", planet: "pyron", resource: "voidQuartz", amount: 50 });
  assert.equal(b.summary()?.current, 6, "wrong planet does not count");
  b.handle({ type: "collected", planet: "kryos", resource: "voidQuartz", amount: 4 });
  assert.equal(b.summary()?.title, "Return to Halcyon Dock");

  const e = new ContractBoard({ active: null, completed: ["aetherion_signal"], repeats: {} });
  e.accept("cargo_escort");
  e.handle({ type: "arrived", planet: "aetherion" });
  assert.equal(e.pendingSpawn("aetherion", true), "escort_ambush");
  e.markSpawned();
  assert.match(e.handle({ type: "allyLost", encounter: "escort_ambush" }).failed ?? "", /Freighter/);
  assert.equal(e.pendingSpawn("aetherion", true), "escort_ambush", "escort restarts");

  const bounty = new ContractBoard({ active: null, completed: ["aetherion_signal"], repeats: {} });
  bounty.accept("bounty");
  for (let i = 0; i < 5; i++) bounty.handle({ type: "destroyed", planet: PLANET_IDS[i % 6], enemy: "scout" });
  assert.equal(bounty.handle({ type: "docked" }).completed?.id, "bounty");
  assert.ok(bounty.available().some((c) => c.id === "bounty"), "repeatable");
  assert.equal(bounty.state.repeats.bounty, 1);
});

test("contract data is well formed and covers every M6 mission category", () => {
  const ids = new Set<string>();
  for (const c of CONTRACTS) {
    assert.ok(!ids.has(c.id), `unique ${c.id}`);
    ids.add(c.id);
    for (const r of c.requires ?? []) assert.ok(getContract(r), `${c.id} requires known ${r}`);
    assert.ok(c.objectives.length > 0 && c.objectives[c.objectives.length - 1].kind === "dock", `${c.id} ends at the dock`);
    for (const o of c.objectives) assert.ok(objectiveText(o).title.length > 0);
    for (const k of Object.keys(c.reward.resources)) assert.ok(RESOURCE_IDS.includes(k as never));
    assert.ok(!JSON.stringify(c).toLowerCase().includes("coin"), "no coin fields");
  }
  const cats = new Set(CONTRACTS.map((c) => c.category));
  for (const k of ["discovery", "scanning", "extraction", "elimination", "defense", "escort", "distress", "recovery", "investigation", "boss"]) assert.ok(cats.has(k as never), `category ${k}`);
  assert.equal(CONTRACTS.filter((c) => c.starter).length, 1);
});

test("progression ranks, achievements and cosmetic unlocks", () => {
  const p = new Progression();
  assert.equal(p.rank.title, RANKS[0].title);
  const w = p.handle({ type: "warp" });
  assert.deepEqual(w.achievements.map((a) => a.id), ["first_warp"]);
  const k = p.handle({ type: "kill", enemy: "interceptor" });
  assert.ok(k.achievements.some((a) => a.id === "first_blood"));
  assert.ok(unlockedPaints(p.state).includes("ember"));
  assert.equal(p.setPaint("solstice"), false, "locked paint rejected");
  assert.equal(p.setPaint("ember"), true);
  const r = p.handle({ type: "xp", amount: 200 });
  assert.equal(r.rankUp, RANKS[1].title);
  for (const planet of PLANET_IDS) p.handle({ type: "visit", planet });
  assert.ok(p.state.achievements.includes("explorer"));
  // Achievements fire once.
  const again = p.handle({ type: "visit", planet: "kryos" });
  assert.equal(again.achievements.length, 0);
  assert.ok(rankOf(1e9).next === null);
  assert.equal(new Set(ACHIEVEMENTS.map((a) => a.id)).size, ACHIEVEMENTS.length);
  // Sanitize drops junk and locked paint.
  const s = Progression.sanitize({ xp: -5, kills: { scout: 3, bogus: 9 }, visited: ["kryos", "nowhere"], achievements: ["fake"], paint: "solstice" });
  assert.equal(s.xp, 0);
  assert.equal(s.kills.scout, 3);
  assert.deepEqual(s.visited, ["veyra7", "kryos"]);
  assert.deepEqual(s.achievements, []);
  assert.equal(s.paint, "wayfarer");
});

test("suit integrity drains in hazards, warns, fails once and recovers when sheltered", () => {
  const s = new SuitIntegrity();
  let warned = 0, failed = 0;
  for (let i = 0; i < 60 * 60; i++) {
    const t = s.update(1 / 60, "heat", 1, false);
    if (t.warning) warned++;
    if (t.failed) failed++;
  }
  assert.equal(warned, 1);
  assert.equal(failed, 1);
  assert.equal(s.integrity, 0);
  for (let i = 0; i < 60 * 10; i++) s.update(1 / 60, "heat", 1, true);
  assert.equal(s.integrity, 1);
  const calm = new SuitIntegrity();
  calm.update(10, "none", 1, false);
  assert.equal(calm.integrity, 1);
});

test("save v3: new game, round trip, and v1/v2 saves migrate without losing progress", async () => {
  assert.equal(SAVE_VERSION, 4);
  const fresh = newGameSave();
  assert.equal(fresh.universe.planet, "veyra7");
  assert.equal(fresh.contracts.active?.id, "aetherion_signal");

  const v2 = { ...newGameSave(), version: 2 } as Record<string, unknown>;
  delete v2.universe;
  delete v2.progression;
  delete v2.contracts;
  (v2.inventory as Record<string, number>).ferrite = 77;
  (v2.mission as { step: string }).step = "mine";
  const m = migrateSave(v2)!;
  assert.equal(m.version, 4);
  assert.equal(m.inventory.ferrite, 77);
  assert.equal(m.mission.step, "mine");
  assert.equal(m.universe.planet, "veyra7");
  assert.equal(m.progression.xp, 0);
  assert.equal(m.contracts.active?.id, "aetherion_signal");

  const s = newGameSave();
  s.universe = { planet: "kryos", arrivals: ["aetherion", "kryos"] };
  s.ship.state = "landed";
  s.progression.xp = 321;
  s.contracts = { active: { id: "kryos_survey", step: 2, progress: 4, spawned: true, startedAt: 5 }, completed: ["aetherion_signal"], repeats: {} };
  const ad = new MemorySaveAdapter();
  await ad.save("x", s);
  const back = (await ad.load("x"))!;
  assert.equal(back.universe.planet, "kryos");
  assert.deepEqual(back.universe.arrivals, ["aetherion", "kryos"]);
  assert.equal(back.progression.xp, 321);
  assert.equal(back.contracts.active?.progress, 4);
  assert.equal(back.contracts.active?.spawned, false, "encounters respawn on resume");

  // A docked (or mid-flight) save always resumes at Halcyon Dock over Veyra-7.
  const docked = { ...s, ship: { ...s.ship, state: "flying" } };
  assert.equal(migrateSave(docked)!.universe.planet, "veyra7");
  // Unknown planet ids fall back safely.
  assert.equal(migrateSave({ ...s, universe: { planet: "atlantis", arrivals: ["atlantis"] } })!.universe.planet, "veyra7");
  assert.ok(!JSON.stringify(newGameSave()).toLowerCase().includes("coin"));
});
