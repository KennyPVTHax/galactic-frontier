import { test } from "node:test";
import assert from "node:assert/strict";
import { CombatSystem, type CombatInput, type PlayerFrame } from "../src/combat/combatSystem";
import type { CombatEvent } from "../src/combat/events";
import { ENEMY_TYPES, difficultyScale, effectiveDifficulty } from "../src/combat/enemyTypes";
import { ENCOUNTERS } from "../src/combat/encounters";
import { ENEMY_TYPE_IDS, AI_STATES, type AiState } from "../src/combat/ids";
import { seededRng } from "../src/combat/vec";

const ENV = { groundAt: () => 0, flightRadius: 760, maxAltitude: 720 };
const DT = 1 / 30;

function player(x = 0, y = 300, z = 0, fwd = { x: 0, y: 0, z: 1 }, prot = false): PlayerFrame {
  return { x, y, z, vx: 0, vy: 0, vz: 0, forward: fwd, alive: true, protected: prot };
}
const idle: CombatInput = { fire: false, cycleTarget: false };
const norm = (v: { x: number; y: number; z: number }) => {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
};

/** A stock pilot: keeps the nose on the target, selects it, fires when the lock is good. Takes real hull damage. */
function duel(encounter: string, seconds: number, seed = 7, difficulty = 1) {
  const c = new CombatSystem({ seed });
  c.update(DT, player(), idle, ENV);
  c.spawnEncounter(encounter, { x: 0, y: 300, z: 0 }, { difficulty });
  let hull = 100;
  const seen = new Set<AiState>();
  const all: CombatEvent[] = [];
  let cycle = true;
  let t = 0;
  let fwd = { x: 0, y: 0, z: 1 };
  for (; t < seconds && hull > 0; t += DT) {
    const tgt = c.enemies().filter((e) => e.alive).sort((a, b) => Math.hypot(a.pos.x, a.pos.y - 300, a.pos.z) - Math.hypot(b.pos.x, b.pos.y - 300, b.pos.z))[0];
    if (tgt) fwd = norm({ x: tgt.pos.x, y: tgt.pos.y - 300, z: tgt.pos.z });
    const ev = c.update(DT, player(0, 300, 0, fwd), { fire: !!tgt, cycleTarget: cycle, aimDir: fwd }, ENV);
    cycle = false;
    for (const e of ev) {
      all.push(e);
      if (e.type === "playerHullDamage") hull -= e.amount;
      if (e.type === "aiStateChanged") seen.add(e.to);
    }
    if (c.hostileCount === 0 && all.some((e) => e.type === "encounterCleared")) break;
  }
  return { c, hull, seen, all, t };
}

test("enemy catalogue: five original types with distinct roles", () => {
  assert.deepEqual(Object.keys(ENEMY_TYPES).sort(), [...ENEMY_TYPE_IDS].sort());
  const hp = (t: keyof typeof ENEMY_TYPES) => ENEMY_TYPES[t].hull;
  assert.ok(hp("scout") < hp("interceptor") && hp("interceptor") < hp("raider") && hp("raider") < hp("dreadnought"));
  for (const id of ENEMY_TYPE_IDS) assert.ok(ENEMY_TYPES[id].name.length > 0);
  for (const id of ["first_contact", "scout_pair", "interceptor_pair", "raider_escort", "hunter_squadron", "station_defense_wave_1", "station_defense_wave_2", "station_defense_wave_3", "escort_ambush", "dreadnought_boss"]) {
    assert.ok(ENCOUNTERS[id], `encounter ${id}`);
  }
  assert.equal(AI_STATES.length, 7);
});

test("first contact: one pirate interceptor, beaten by a stock pilot without upgrades", () => {
  const { c, hull, seen, all, t } = duel("first_contact", 120);
  assert.ok(all.some((e) => e.type === "enemySpawned" && e.enemyType === "interceptor"));
  assert.equal(all.filter((e) => e.type === "enemySpawned").length, 1, "exactly one pirate fighter");
  assert.ok(all.some((e) => e.type === "enemyDestroyed"), `destroyed within ${t.toFixed(0)} s`);
  assert.ok(all.some((e) => e.type === "encounterCleared"));
  assert.ok(hull > 0, `player survives (hull ${hull.toFixed(0)})`);
  assert.equal(c.hostileCount, 0);
  // Explicit AI states were walked through on the way in.
  assert.ok(seen.has("pursue") && seen.has("attack"), [...seen].join(","));
});

test("shields absorb enemy fire before the hull, and the damage is reported", () => {
  const { all } = duel("first_contact", 60, 11);
  const shieldHits = all.filter((e) => e.type === "playerShieldHit").length;
  const hullHits = all.filter((e) => e.type === "playerHullDamage");
  assert.ok(shieldHits > 0, "shield took hits");
  const firstHull = all.findIndex((e) => e.type === "playerHullDamage");
  const firstShieldDown = all.findIndex((e) => e.type === "playerShieldDown");
  if (firstHull >= 0) assert.ok(firstShieldDown >= 0 && firstShieldDown < firstHull, "hull only after the shield is down");
  void hullHits;
});

test("a protected (docked/landed) player is never hit and enemies disengage", () => {
  const c = new CombatSystem({ seed: 3 });
  c.update(DT, player(), idle, ENV);
  c.spawnEncounter("first_contact", { x: 0, y: 300, z: 0 }, { difficulty: 1, engaged: true });
  let dmg = 0;
  for (let i = 0; i < 30 * 40; i++) for (const e of c.update(DT, player(0, 300, 0, { x: 0, y: 0, z: 1 }, true), idle, ENV)) if (e.type === "playerHullDamage" || e.type === "playerShieldHit") dmg++;
  assert.equal(dmg, 0);
});

test("loot and rewards are virtual resources + xp only (no currency fields)", () => {
  const { all } = duel("first_contact", 120);
  const kill = all.find((e) => e.type === "enemyDestroyed") as Extract<CombatEvent, { type: "enemyDestroyed" }>;
  assert.ok(kill, "kill event");
  assert.ok(kill.xp > 0);
  for (const k of Object.keys(kill.loot)) assert.ok(["ferrite", "carbon", "lumenite", "voidQuartz"].includes(k));
  assert.ok(!JSON.stringify(ENEMY_TYPES).toLowerCase().includes("coin"));
  assert.ok(!JSON.stringify(ENCOUNTERS).toLowerCase().includes("coin"));
});

test("interceptor pair and raider escort can be fought; higher difficulty is harder", () => {
  for (const id of ["interceptor_pair", "raider_escort"]) {
    const c = new CombatSystem({ seed: 5 });
    c.update(DT, player(), idle, ENV);
    c.spawnEncounter(id, { x: 0, y: 300, z: 0 }, { difficulty: 2 });
    assert.ok(c.hostileCount >= 2, `${id} spawns ${c.hostileCount}`);
  }
  const lo = difficultyScale(effectiveDifficulty(0)), hi = difficultyScale(effectiveDifficulty(5));
  assert.ok(hi.hullMul > lo.hullMul && hi.damageMul > lo.damageMul && hi.spreadMul < lo.spreadMul && hi.reactionMul < lo.reactionMul, "difficulty scales hull, damage, accuracy and reaction");
  // The very first fight (danger 1) stays gentle: a pair of attackers at most.
  assert.ok(difficultyScale(1).maxAttackers <= 2);
  // Upgrades raise difficulty a little, with a cap.
  assert.ok(effectiveDifficulty(1, 100) - 1 <= 1.5 + 1e-9);
});

test("hunter squadron flies as a unit of four", () => {
  const c = new CombatSystem({ seed: 9 });
  c.update(DT, player(), idle, ENV);
  c.spawnEncounter("hunter_squadron", { x: 0, y: 300, z: 0 }, { difficulty: 3 });
  assert.equal(c.hostileCount, 4);
  assert.equal(c.squadrons().length, 1);
  assert.equal(c.squadrons()[0].members.length, 4);
});

test("dreadnought boss: hardpoints are separate targets and the fight has multiple phases", () => {
  const c = new CombatSystem({ seed: 2 });
  c.update(DT, player(), idle, ENV);
  c.spawnEncounter("dreadnought_boss", { x: 0, y: 300, z: 0 }, { difficulty: 5 });
  const boss = c.boss();
  assert.ok(boss, "boss exists");
  assert.ok((boss!.boss?.hardpoints.length ?? 0) >= 3, "multiple weapon hardpoints");
  const phases = new Set<number>();
  const ev: CombatEvent[] = [];
  for (let i = 0; i < 600 && boss!.alive; i++) {
    c.damageEnemy(boss!, 200, boss!.pos, true, ev);
    for (const e of c.update(DT, player(), idle, ENV)) ev.push(e);
  }
  for (const e of ev) if (e.type === "bossPhase") phases.add(e.phase);
  assert.ok(phases.size >= 2, `phase changes: ${[...phases].join(",")}`);
  assert.ok(ev.some((e) => e.type === "bossLaunch"), "phase 2 launches fighters");
  assert.ok(!boss!.alive, "dreadnought can be destroyed");
});

test("performance: 30 enemies with live projectiles stay well inside a frame budget", () => {
  const c = new CombatSystem({ seed: 4, rng: seededRng(4) });
  c.update(DT, player(), idle, ENV);
  for (let i = 0; i < 30; i++) c.spawnEnemy(i % 3 === 0 ? "interceptor" : "scout", { x: Math.cos(i) * 300, y: 300 + (i % 5) * 10, z: Math.sin(i) * 300 }, { difficulty: 2, engaged: true });
  for (let i = 0; i < 60; i++) c.update(DT, player(), { fire: true, cycleTarget: i % 20 === 0 }, ENV);
  const t0 = performance.now();
  const N = 300;
  for (let i = 0; i < N; i++) c.update(DT, player(), { fire: true, cycleTarget: false }, ENV);
  const per = (performance.now() - t0) / N;
  assert.ok(per < 2, `${per.toFixed(3)} ms per update`);
});
