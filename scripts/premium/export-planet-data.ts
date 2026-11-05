// Exports Aetherion's canonical gameplay/terrain data and golden samples for the Unity port.
// The TypeScript game remains the source of truth; the Unity port must reproduce these numbers.
// Usage: npx tsx scripts/premium/export-planet-data.ts
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PLANETS } from "../../src/universe/planets";
import { buildTerrainModel, Heightfield } from "../../src/world/heightfield";
import { SimplexNoise, createRng } from "../../src/core/random";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "unity", "Assets", "GameData");
mkdirSync(out, { recursive: true });

const def = PLANETS.aetherion;
const model = buildTerrainModel(def);

// 1) Canonical data (no presentation-only fields beyond sky/palette which seed the look)
const data = {
  id: def.id, name: def.name, seed: def.seed, terrainSize: def.terrainSize, walkRadius: def.walkRadius,
  flightRadius: def.flightRadius, maxAltitude: def.maxAltitude, gravity: def.gravity,
  liquid: def.liquid, landingSite: def.landingSite, arrival: def.arrival, weather: def.weather, sky: def.sky,
  terrain: def.terrain, palette: def.palette, resources: def.resources,
  pois: def.pois.map((p) => ({ id: p.id, name: p.name, kind: p.kind, x: p.x, z: p.z })),
  derived: {
    siteBase: model.siteBase,
    craters: model.craters, basins: model.basins, calderas: model.calderas, pads: model.pads,
  },
};
writeFileSync(join(out, "aetherion.json"), JSON.stringify(data, null, 2));

// 2) Golden samples
const rng = createRng(12345);
const rngSeq = Array.from({ length: 8 }, () => rng());
const noise = new SimplexNoise(def.seed);
const noiseSamples = Array.from({ length: 24 }, (_, i) => {
  const x = Math.sin(i * 12.9898) * 400, y = Math.cos(i * 78.233) * 400;
  return { x, y, n: noise.noise2(x / 50, y / 50), f: noise.fbm(x / 80, y / 80, 5), r: noise.ridged(x / 90, y / 90, 4) };
});
const r2 = createRng(777);
const heights = Array.from({ length: 600 }, () => {
  const x = (r2() * 2 - 1) * 760, z = (r2() * 2 - 1) * 760;
  return { x, z, h: model.fn(x, z) };
});
for (const p of def.pois) heights.push({ x: p.x, z: p.z, h: model.fn(p.x, p.z) });
heights.push({ x: def.landingSite.x, z: def.landingSite.z, h: model.fn(def.landingSite.x, def.landingSite.z) });

// Gameplay-facing heightfield (what the TS player collides with): 256 cells over terrainSize
const hf = new Heightfield(model.fn, def.terrainSize, 256);
const hfSamples = Array.from({ length: 200 }, () => {
  const x = (r2() * 2 - 1) * 700, z = (r2() * 2 - 1) * 700;
  return { x, z, h: hf.heightAt(x, z) };
});

writeFileSync(join(out, "aetherion.golden.json"), JSON.stringify({ seed: def.seed, rngSeq, noiseSamples, heights, heightfield: { res: 256, size: def.terrainSize, min: hf.minHeight, max: hf.maxHeight, samples: hfSamples } }, null, 2));
console.log(`aetherion: seed ${def.seed}, ${heights.length} height goldens, hf range ${hf.minHeight.toFixed(2)}..${hf.maxHeight.toFixed(2)}, basins ${model.basins.length}, pads ${model.pads.length}`);
