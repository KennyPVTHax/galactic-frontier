import { test } from "node:test";
import assert from "node:assert/strict";
import { PLANETS, NEW_PLANET_IDS, VEYRA7, getPlanet } from "../src/universe/planets";
import { PLANET_IDS, runtimeId, planetOfRuntimeId } from "../src/universe/types";
import { Heightfield, createPlanetTerrain, createTerrainFunction } from "../src/world/heightfield";
import { WORLD } from "../src/core/worldConfig";
import { ENEMY_TYPE_IDS } from "../src/combat/ids";
import { RESOURCE_IDS } from "../src/gameplay/resources";

/** Heightfield at the render resolution used by Planet. */
const field = (id: (typeof PLANET_IDS)[number]) => {
  const d = PLANETS[id];
  return new Heightfield(createPlanetTerrain(d), d.terrainSize, 224);
};

test("six charted worlds, five of them new, each with its own seed, palette and sky", () => {
  assert.deepEqual([...PLANET_IDS].sort(), Object.keys(PLANETS).sort());
  assert.equal(NEW_PLANET_IDS.length, 5);
  assert.equal(new Set(PLANET_IDS.map((p) => PLANETS[p].seed)).size, 6, "unique seeds");
  assert.equal(new Set(PLANET_IDS.map((p) => PLANETS[p].name)).size, 6);
  const biomes = new Set(PLANET_IDS.map((p) => PLANETS[p].biome));
  assert.equal(biomes.size, 6, "six distinct biomes");
  for (const [a, b] of [["aetherion", "kryos"], ["pyron", "noctaris"], ["zephyria", "aetherion"]] as const) assert.notDeepEqual(PLANETS[a].sky.horizon, PLANETS[b].sky.horizon);
  assert.equal(getPlanet("kryos"), PLANETS.kryos);
  assert.equal(PLANETS.veyra7.hasStation, true);
  for (const id of NEW_PLANET_IDS) assert.equal(PLANETS[id].hasStation, false);
});

test("Veyra-7 is unchanged: terrain and layout reproduce the M2 world exactly", () => {
  const legacy = createTerrainFunction(WORLD.seed);
  const now = createPlanetTerrain(VEYRA7);
  let worst = 0;
  for (let x = -800; x <= 800; x += 37.7) for (let z = -800; z <= 800; z += 41.3) worst = Math.max(worst, Math.abs(legacy(x, z) - now(x, z)));
  assert.equal(worst, 0, "identical heights");
  assert.equal(VEYRA7.terrainSize, WORLD.terrainSize);
  assert.equal(VEYRA7.gravity, WORLD.gravity);
  assert.equal(VEYRA7.liquid.level, WORLD.liquidLevel);
  assert.deepEqual(VEYRA7.pois.map((p) => p.id), ["probe", "monolith", "spires"], "M2 POI ids (saves depend on them)");
  assert.equal(runtimeId("veyra7", "probe"), "probe", "Veyra-7 keeps its legacy runtime ids");
  assert.equal(runtimeId("kryos", "x"), "kryos:x");
  assert.equal(planetOfRuntimeId("kryos:x"), "kryos");
  assert.equal(planetOfRuntimeId("lumenite-19"), "veyra7");
});

test("terrain is deterministic per planet and differs between planets", () => {
  for (const id of PLANET_IDS) {
    const a = createPlanetTerrain(PLANETS[id]), b = createPlanetTerrain(PLANETS[id]);
    assert.equal(a(123.4, -88.8), b(123.4, -88.8), id);
  }
  const k = createPlanetTerrain(PLANETS.kryos), p = createPlanetTerrain(PLANETS.pyron);
  assert.notEqual(k(100, 100), p(100, 100));
});

test("every landing site is flat and dry; every arrival point is inside the flight volume", () => {
  for (const id of PLANET_IDS) {
    const d = PLANETS[id];
    const hf = field(id);
    const s = d.landingSite;
    assert.ok(hf.normalAt(s.x, s.z).y > 0.88, `${id}: landing site flat (ny ${hf.normalAt(s.x, s.z).y.toFixed(3)})`);
    // Frozen lakes are solid ice and landable; every other liquid forbids landing below its level.
    if (d.liquid.kind !== "none" && d.liquid.kind !== "ice") assert.ok(hf.heightAt(s.x, s.z) > d.liquid.level + 1, `${id}: landing site above ${d.liquid.kind}`);
    assert.ok(Math.hypot(s.x, s.z) < d.walkRadius, `${id}: site reachable on foot`);
    const a = d.arrival;
    assert.ok(Math.hypot(a.x, a.z) < d.flightRadius * 0.7, `${id}: arrival inside flight radius`);
    assert.ok(a.y > hf.heightAt(a.x, a.z) + 120 && a.y < d.maxAltitude, `${id}: arrival well above terrain (y=${a.y})`);
    assert.ok(d.flightRadius > d.walkRadius && d.maxAltitude > 200, id);
  }
});

test("points of interest are reachable, unique and carry original lore and virtual loot", () => {
  for (const id of PLANET_IDS) {
    const d = PLANETS[id];
    const hf = field(id);
    assert.equal(new Set(d.pois.map((p) => p.id)).size, d.pois.length, `${id}: unique poi ids`);
    assert.ok(d.pois.length >= 3, `${id}: ${d.pois.length} pois`);
    for (const poi of d.pois) {
      assert.ok(Math.hypot(poi.x, poi.z) < d.walkRadius, `${id}/${poi.id}: inside walk radius`);
      if (d.liquid.kind !== "none" && d.liquid.kind !== "ice") assert.ok(hf.heightAt(poi.x, poi.z) > d.liquid.level, `${id}/${poi.id}: not underwater`);
      assert.ok(poi.lore.length > 20 && poi.name.length > 2);
      for (const k of Object.keys(poi.loot)) assert.ok(RESOURCE_IDS.includes(k as never), `${id}/${poi.id}: loot ${k}`);
    }
  }
  const kinds = new Set(PLANET_IDS.flatMap((p) => PLANETS[p].pois.map((x) => x.kind)));
  for (const k of ["wreck", "ruin", "facility", "outpost", "stronghold"]) assert.ok(kinds.has(k as never), `a ${k} exists somewhere`);
});

test("hazards, resources and encounters give each world its own gameplay", () => {
  assert.equal(PLANETS.kryos.hazard.kind, "cold");
  assert.equal(PLANETS.pyron.hazard.kind, "heat");
  assert.equal(PLANETS.zephyria.hazard.kind, "storm");
  assert.equal(PLANETS.noctaris.hazard.kind, "toxic");
  assert.equal(PLANETS.aetherion.hazard.kind, "none");
  assert.equal(PLANETS.noctaris.danger, 5);
  assert.ok(PLANETS.kryos.resources.weights.voidQuartz > PLANETS.veyra7.resources.weights.voidQuartz / 20, "kryos is a Void Quartz world");
  assert.deepEqual(PLANETS.aetherion.encounters.arrival, ["interceptor"], "first combat: a single pirate fighter");
  for (const id of PLANET_IDS) {
    const e = PLANETS[id].encounters;
    for (const t of [...(e.arrival ?? []), ...e.patrols]) assert.ok(ENEMY_TYPE_IDS.includes(t), `${id}: ${t}`);
    assert.ok(e.maxActive >= 0 && e.patrolInterval >= 0);
  }
  // Danger rises through the campaign order.
  assert.ok(PLANETS.aetherion.danger < PLANETS.pyron.danger && PLANETS.pyron.danger < PLANETS.noctaris.danger);
  for (const id of PLANET_IDS) assert.ok(!JSON.stringify(PLANETS[id]).toLowerCase().includes("coin"), `${id}: no currency fields`);
});

test("star-map positions are distinct and inside the map", () => {
  const seen = new Set<string>();
  for (const id of PLANET_IDS) {
    const m = PLANETS[id].map;
    assert.ok(Math.abs(m.x) <= 1 && Math.abs(m.y) <= 1, id);
    const key = `${Math.round(m.x * 10)},${Math.round(m.y * 10)}`;
    assert.ok(!seen.has(key), `${id} overlaps another planet on the map`);
    seen.add(key);
  }
});
