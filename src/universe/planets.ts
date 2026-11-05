/**
 * TEMPORARY INTEGRATION STUB — replaced wholesale by workstream A's planet catalogue at merge.
 * Only exists so the coordinator's game.ts integration compiles before the universe branch lands.
 */
import { WORLD } from "../core/worldConfig";
import type { PlanetDef, PlanetId } from "./types";

export const VEYRA7: PlanetDef = {
  id: "veyra7",
  name: WORLD.planetName,
  biome: "lumen",
  tagline: "Home world · Halcyon Dock",
  description: "Luminous lakes and crater fields under a ringed gas giant.",
  seed: WORLD.seed,
  danger: 0,
  map: { x: 0, y: 0.35, color: "#c070ff", size: 0.6 },
  terrainSize: WORLD.terrainSize,
  walkRadius: WORLD.walkRadius,
  flightRadius: WORLD.flightRadius,
  maxAltitude: WORLD.maxAltitude,
  gravity: WORLD.gravity,
  liquid: { kind: "lumen", level: WORLD.liquidLevel, color: [0.3, 0.9, 0.9], emissive: 0.6 },
  landingSite: { name: WORLD.surveySite.name, x: WORLD.surveySite.x, z: WORLD.surveySite.z, radius: WORLD.surveySite.radius },
  arrival: { x: 0, y: 300, z: 420, yaw: Math.PI },
  hasStation: true,
  hazard: { kind: "none", label: "Clear", intensity: 0 },
  weather: { kind: "dust", intensity: 0.3 },
  sky: { zenith: [0.07, 0.05, 0.2], horizon: [0.78, 0.46, 0.55], ground: [0.14, 0.09, 0.15], sun: [1, 0.86, 0.68], sunDir: [0.5, 0.5, 0.5], stars: 0.75, fogScale: 1, sunScale: 1, ambientScale: 1 },
  terrain: { baseAmp: 14, detailAmp: 3.2, ridgeAmp: 30, mountainAmp: 200, craters: 9 },
  palette: { low: [0.15, 0.36, 0.36], mid: [0.46, 0.3, 0.37], rock: [0.3, 0.27, 0.37], peak: [0.82, 0.78, 0.9], basin: [0.13, 0.12, 0.18] },
  resources: { weights: { ferrite: 1, carbon: 1, lumenite: 1, voidQuartz: 0.3 }, count: 0, richness: 1 },
  pois: [],
  encounters: { arrival: null, patrols: [], patrolInterval: 0, maxActive: 0 },
};

const stub = (id: PlanetId, name: string, x: number, y: number, color: string, danger: PlanetDef["danger"]): PlanetDef => ({
  ...VEYRA7,
  id,
  name,
  tagline: "Uncharted",
  description: "Survey data pending.",
  danger,
  map: { x, y, color, size: 0.5 },
  hasStation: false,
  encounters: { arrival: id === "aetherion" ? ["interceptor"] : null, patrols: [], patrolInterval: 0, maxActive: 0 },
});

export const PLANETS: Record<PlanetId, PlanetDef> = {
  veyra7: VEYRA7,
  aetherion: stub("aetherion", "Aetherion", -0.6, -0.1, "#5fd38a", 1),
  kryos: stub("kryos", "Kryos", 0.65, -0.45, "#bfe6ff", 2),
  pyron: stub("pyron", "Pyron", 0.7, 0.4, "#ff6a2a", 3),
  zephyria: stub("zephyria", "Zephyria", -0.45, -0.75, "#ffd27a", 3),
  noctaris: stub("noctaris", "Noctaris", -0.8, 0.65, "#d23a4a", 5),
};

export const NEW_PLANET_IDS: PlanetId[] = ["aetherion", "kryos", "pyron", "zephyria", "noctaris"];

export function getPlanet(id: PlanetId): PlanetDef {
  return PLANETS[id] ?? VEYRA7;
}
