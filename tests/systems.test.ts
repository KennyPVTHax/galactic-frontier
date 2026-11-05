import { test } from "node:test";
import assert from "node:assert/strict";
import { Heightfield, createTerrainFunction } from "../src/world/heightfield";
import { SimplexNoise, createRng } from "../src/core/random";
import { WORLD } from "../src/core/worldConfig";
import { ShipPhysics, NO_CONTROLS, GEAR_HEIGHT, type ShipEnvironment } from "../src/vehicles/shipPhysics";
import { AdaptiveResolution, chooseQuality } from "../src/core/quality";
import { MemorySaveAdapter, migrateSave, newGameSave, SAVE_VERSION } from "../src/persistence/saveSystem";
import { IntroMission } from "../src/gameplay/mission";
import { OfflineBackend, HttpBackendClient, buildCompletionReport } from "../src/integration/backend";

test("noise and terrain are deterministic for a seed", () => {
  const a = new SimplexNoise(42), b = new SimplexNoise(42);
  for (let i = 0; i < 50; i++) assert.equal(a.noise2(i * 0.37, i * -0.11), b.noise2(i * 0.37, i * -0.11));
  const r1 = createRng(9), r2 = createRng(9);
  assert.equal(r1(), r2());
  const f1 = createTerrainFunction(1), f2 = createTerrainFunction(1);
  assert.equal(f1(123.4, -55.1), f2(123.4, -55.1));
});

test("heightfield interpolation matches grid vertices and stays between corners", () => {
  const fn = createTerrainFunction(WORLD.seed);
  const hf = new Heightfield(fn, 1600, 128);
  // Exactly at a vertex, the sampled value is returned.
  const x = -800 + 10 * hf.cell, z = -800 + 20 * hf.cell;
  assert.ok(Math.abs(hf.heightAt(x, z) - fn(x, z)) < 1e-3);
  // Inside a cell the value lies within the 4 corner extremes.
  const cx = x + hf.cell * 0.3, cz = z + hf.cell * 0.6;
  const corners = [fn(x, z), fn(x + hf.cell, z), fn(x, z + hf.cell), fn(x + hf.cell, z + hf.cell)];
  const h = hf.heightAt(cx, cz);
  assert.ok(h >= Math.min(...corners) - 1e-4 && h <= Math.max(...corners) + 1e-4);
});

test("survey site is flat enough to land", () => {
  const hf = new Heightfield(createTerrainFunction(WORLD.seed), 1600, 224);
  const s = WORLD.surveySite;
  assert.ok(hf.normalAt(s.x, s.z).y > 0.9, "site normal mostly up");
  assert.ok(hf.heightAt(s.x, s.z) > WORLD.liquidLevel + 1, "site above liquid");
});

function env(): ShipEnvironment {
  return {
    groundAt: () => 0,
    normalYAt: () => 1,
    liquidLevel: -5,
    padPosition: { x: 0, y: 300, z: 0 },
    padYaw: Math.PI,
    stationCenter: { x: 0, y: 300, z: 80 },
    stationRadius: 50,
    flightRadius: 760,
    maxAltitude: 700,
  };
}

function run(ship: ShipPhysics, e: ShipEnvironment, seconds: number, c = NO_CONTROLS) {
  const events: string[] = [];
  for (let t = 0; t < seconds; t += 1 / 60) for (const ev of ship.update(1 / 60, c, e)) events.push(ev.type);
  return events;
}

test("ship undocks, flies, lands, takes off and docks", () => {
  const e = env();
  const s = new ShipPhysics();
  s.placeDocked(e);
  assert.equal(s.state, "docked");
  assert.ok(s.requestUndock(e).ok);
  assert.deepEqual(run(s, e, 3), ["undocked"]);
  assert.equal(s.state, "flying");

  // Too fast/high to land.
  s.throttle = 1;
  run(s, e, 2, { ...NO_CONTROLS, throttle: 1 });
  assert.equal(s.canLand(e).ok, false);

  // Descend slowly near the ground.
  Object.assign(s, { y: GEAR_HEIGHT + 8, speed: 5, throttle: 0.05, pitch: 0 });
  assert.ok(s.requestLand(e).ok);
  assert.deepEqual(run(s, e, 3), ["landed"]);
  assert.ok(Math.abs(s.y - GEAR_HEIGHT) < 1e-6);

  assert.ok(s.requestTakeoff().ok);
  assert.deepEqual(run(s, e, 2), ["tookOff"]);

  // Teleport near the pad and dock.
  Object.assign(s, { x: 0, y: 320, z: -20, speed: 10 });
  assert.ok(s.requestDock(e).ok);
  assert.deepEqual(run(s, e, 3.5), ["docked"]);
  assert.equal(s.state, "docked");
});

test("hard terrain impact damages the hull; gentle contact does not", () => {
  const e = env();
  const s = new ShipPhysics();
  s.placeLanded(e, 0, 0, 0);
  s.state = "flying";
  Object.assign(s, { y: 40, pitch: -1.0, speed: 70, throttle: 1 });
  const ev = run(s, e, 2, { ...NO_CONTROLS, throttle: 1 });
  assert.ok(ev.includes("impact"));
  assert.ok(s.hull < 100);
  const s2 = new ShipPhysics();
  s2.placeLanded(e, 0, 0, 0);
  s2.state = "flying";
  Object.assign(s2, { y: 3, speed: 5 });
  assert.ok(!run(s2, e, 2).includes("impact"));
});

test("cannot land on steep ground or liquid", () => {
  const e = { ...env(), normalYAt: () => 0.5 };
  const s = new ShipPhysics();
  s.state = "flying";
  Object.assign(s, { y: 5, speed: 2 });
  assert.equal(s.canLand(e).ok, false);
  const e2 = { ...env(), groundAt: () => -6 };
  Object.assign(s, { y: -2 });
  assert.equal(s.canLand(e2).ok, false);
});

test("adaptive resolution lowers scale under load and restores it", () => {
  const a = new AdaptiveResolution(1, 0.6, 50);
  for (let i = 0; i < 300; i++) a.update(1 / 30, 25);
  assert.equal(a.scale, 0.6);
  for (let i = 0; i < 3000; i++) a.update(1 / 60, 60);
  assert.equal(a.scale, 1);
});

test("quality auto-detection is conservative on mobile and embedded", () => {
  assert.equal(chooseQuality("auto", { isMobile: true, deviceMemoryGb: 4, hardwareConcurrency: 8 }), "low");
  assert.equal(chooseQuality("auto", { isMobile: true, deviceMemoryGb: 8, hardwareConcurrency: 8 }), "medium");
  assert.equal(chooseQuality("auto", { isMobile: true, deviceMemoryGb: 8, hardwareConcurrency: 8, embedded: true }), "low");
  assert.equal(chooseQuality("auto", { isMobile: false, deviceMemoryGb: 16, hardwareConcurrency: 12 }), "high");
  assert.equal(chooseQuality("low", { isMobile: false }), "low");
});

test("save round-trips and migrates v1 data", async () => {
  const a = new MemorySaveAdapter();
  const s = newGameSave(5);
  s.inventory.lumenite = 33;
  s.upgrades.scanner = 2;
  await a.save("slot", s);
  const back = await a.load("slot");
  assert.equal(back?.inventory.lumenite, 33);
  assert.equal(back?.upgrades.scanner, 2);

  const v1 = { version: 1, savedAt: 1, mode: "onFoot", player: { x: 1, y: 2, z: 3, yaw: 0 }, ship: { state: "flying", hull: 0 }, inventory: { ferrite: 5 }, settings: { quality: "ultra" } };
  const m = migrateSave(v1)!;
  assert.equal(m.version, SAVE_VERSION);
  assert.equal(m.ship.state, "docked", "flying saves resume docked");
  assert.equal(m.ship.hull, 1);
  assert.equal(m.settings.quality, "auto");
  assert.deepEqual(m.partial, {});
  assert.equal(migrateSave({ version: 99 }), null);
  assert.equal(migrateSave("nope"), null);
});

test("completion report is built from mission state; offline backend issues no rewards", async () => {
  const b = new OfflineBackend();
  const { runId } = await b.startMission("x");
  assert.match(runId, /^local-/);
  const m = new IntroMission();
  m.start(runId);
  assert.throws(() => buildCompletionReport(m.state));
  for (const e of [{ type: "undocked" }, { type: "landed" }, { type: "disembarked" }, { type: "scanned", found: 2 }] as const) m.handle(e);
  m.handle({ type: "collected", resource: "lumenite", amount: 40 });
  m.handle({ type: "collected", resource: "ferrite", amount: 30 });
  for (const e of [{ type: "tookOff" }, { type: "docked" }, { type: "delivered" }] as const) m.handle(e);
  const report = buildCompletionReport(m.state);
  assert.equal(report.idempotencyKey, runId);
  assert.equal(report.telemetry.collected.lumenite, 40);
  const res = await b.submitMissionCompletion(report);
  assert.equal(res.status, "offline");
  assert.ok(!("coins" in (res as object)));
  assert.equal(JSON.stringify(report).toLowerCase().includes("coin"), false, "report carries no coin fields");
});

test("http backend sends auth headers and maps 4xx to rejected", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith("/start")) return new Response(JSON.stringify({ runId: "srv-1" }), { status: 200 });
    return new Response("bad", { status: 409 });
  }) as unknown as typeof fetch;
  const c = new HttpBackendClient({ baseUrl: "https://api.example/api/", getAuthHeaders: () => ({ "X-Telegram-Init-Data": "abc" }), fetchImpl: fakeFetch });
  assert.equal((await c.startMission("m")).runId, "srv-1");
  assert.equal(calls[0].url, "https://api.example/api/galactic-frontier/missions/start");
  assert.equal((calls[0].init.headers as Record<string, string>)["X-Telegram-Init-Data"], "abc");
  const res = await c.submitMissionCompletion({} as any);
  assert.equal(res.status, "rejected");
});
