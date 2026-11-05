/**
 * The six charted worlds of Galactic Frontier (M4).
 *
 * Pure data: no Babylon imports, so gameplay, the star map and tests can read
 * it in Node. `Planet` (src/world/planet.ts) turns a def into a scene.
 *
 * Veyra-7 reproduces the M1/M2 world exactly: its numbers come from WORLD and
 * from the constants that used to be hard-coded in planet.ts / heightfield.ts.
 * Everything else (names, lore, places) is original to Galactic Frontier.
 */
import { WORLD } from "../core/worldConfig";
import type { ResourceId } from "../gameplay/resources";
import type { PlanetDef, PlanetId, Rgb } from "./types";

/**
 * Optional render-side look of a planet. Lives here (not in types.ts) because
 * only the universe workstream reads it; every field is optional and derived
 * from `def.sky` / `def.palette` when absent.
 */
export interface PlanetLook {
  /** Directional sun light colour. */
  sunDiffuse: Rgb;
  sunSpecular: Rgb;
  /** Hemispheric ambient sky / ground colours and scene.ambientColor. */
  ambientSky: Rgb;
  ambientGround: Rgb;
  sceneAmbient: Rgb;
  /** Atmosphere-shader in-scatter colour and its sun tint (WorldUniforms.haze / sunColor). */
  haze: Rgb;
  hazeSun: Rgb;
  /** Height falloff of the atmosphere haze (WorldUniforms.atmos.y). */
  hazeFalloff: number;
  /** Basic-tier scene fog colour (defaults to sky horizon × 0.82). */
  fog: Rgb;
  /** Far mountain ring: diffuse colour, emissive (× sky horizon) and height multiplier. */
  backdrop: Rgb;
  backdropGlow: number;
  backdropHeight: number;
  /** Cloud layer: amount shown even on Basic (0 = only Enhanced/Ultra), coverage 0..1. */
  clouds: number;
  cloudCover: number;
  cloudTint: Rgb;
  /** Ringed gas giant colours and placement, black hole placement. */
  giantA: Rgb;
  giantB: Rgb;
  ring: Rgb;
  giantDir: [number, number, number];
  holeDir: [number, number, number];
  /** Liquid surface. */
  liquidAlbedo: Rgb;
  liquidEmissive: Rgb;
  liquidAlpha: number;
  liquidRoughness: number;
  /** Terrain extras. */
  shore: Rgb;
  shoreWidth: number;
  terrainRoughness: number;
  /** Snow glints on the terrain (0 = off). */
  sparkle: number;
  /** Landing-zone beacon colour. */
  beacon: Rgb;
  /** Emissive accent used by alien / industrial structures. */
  accent: Rgb;
}

export interface PlanetDefX extends PlanetDef {
  look?: Partial<PlanetLook>;
}

const yawTo = (fx: number, fz: number, tx: number, tz: number) => Math.atan2(tx - fx, tz - fz);

const S = WORLD.surveySite;

// ------------------------------------------------------------------ Veyra-7 (M1/M2 world, unchanged)

export const VEYRA7: PlanetDefX = {
  id: "veyra7",
  name: WORLD.planetName,
  biome: "lumen",
  tagline: "Luminous lakes under a violet dusk",
  description:
    "The frontier's first charted world. Cyan lumen-lakes glow in the basins, rust-veined boulders litter the moss, and Halcyon Dock keeps watch from orbit. Quiet skies — for now.",
  seed: WORLD.seed,
  danger: 1,
  map: { x: 0, y: 0, color: "#6fd8e6", size: 1 },
  terrainSize: WORLD.terrainSize,
  walkRadius: WORLD.walkRadius,
  flightRadius: WORLD.flightRadius,
  maxAltitude: WORLD.maxAltitude,
  gravity: WORLD.gravity,
  liquid: { kind: "lumen", level: WORLD.liquidLevel, color: [0.05, 0.2, 0.26], emissive: 1 },
  landingSite: { name: S.name, x: S.x, z: S.z, radius: S.radius },
  arrival: { x: -40, y: 300, z: 140, yaw: yawTo(-40, 140, S.x, S.z) },
  hasStation: true,
  hazard: { kind: "none", label: "None", intensity: 0 },
  weather: { kind: "none", intensity: 0 },
  sky: {
    zenith: [0.07, 0.05, 0.2],
    horizon: [0.78, 0.46, 0.55],
    ground: [0.14, 0.09, 0.15],
    sun: [1.0, 0.86, 0.68],
    sunDir: [-0.62, 0.4, -0.67],
    stars: 0.75,
    fogScale: 1,
    sunScale: 1,
    ambientScale: 1,
  },
  terrain: { baseAmp: 14, detailAmp: 3.2, ridgeAmp: 30, mountainAmp: 200, craters: 9, siteCrater: true },
  palette: {
    low: [0.15, 0.36, 0.36],
    mid: [0.46, 0.3, 0.37],
    rock: [0.3, 0.27, 0.37],
    peak: [0.82, 0.78, 0.9],
    basin: [0.13, 0.12, 0.18],
  },
  // Weights mirror the M1 deposit table (22+60 lumenite, 14+80 ferrite, 20+130 carbon, 5+18 void quartz).
  resources: { weights: { lumenite: 82, ferrite: 94, carbon: 150, voidQuartz: 23 }, count: 334, richness: 1 },
  pois: [
    {
      id: "probe",
      name: "Derelict Survey Probe",
      kind: "wreck",
      x: S.x + 55,
      z: S.z + 70,
      lore: "A pre-colony survey probe, power cell still faintly warm. Its log mentions 'violet crystals in the eastern crater'.",
      loot: { ferrite: 20, lumenite: 10 },
    },
    {
      id: "monolith",
      name: "Silent Monolith",
      kind: "monolith",
      x: 190,
      z: -300,
      lore: "Seamless obsidian. Faint glyphs trace an orbit around a dark centre — someone here once watched a black hole.",
      loot: { voidQuartz: 3 },
    },
    {
      id: "spires",
      name: "Glass Spire Garden",
      kind: "landmark",
      x: -380,
      z: 150,
      lore: "Hollow glass spires hum when wind passes through. Carbon-rich spores drift between them.",
      loot: { carbon: 30, lumenite: 6 },
    },
  ],
  encounters: { arrival: null, patrols: [], patrolInterval: 0, maxActive: 0 },
  look: {
    sunDiffuse: [1.0, 0.86, 0.72],
    sunSpecular: [0.6, 0.5, 0.45],
    ambientSky: [0.55, 0.5, 0.86],
    ambientGround: [0.26, 0.16, 0.22],
    sceneAmbient: [0.25, 0.2, 0.32],
    haze: [0.64, 0.38, 0.45],
    hazeSun: [1.0, 0.82, 0.62],
    hazeFalloff: 0.012,
    backdrop: [0.22, 0.14, 0.3],
    backdropGlow: 0.38,
    backdropHeight: 1,
    clouds: 0,
    liquidAlbedo: [0.05, 0.2, 0.26],
    liquidEmissive: [0.03, 0.28, 0.32],
    liquidAlpha: 0.88,
    liquidRoughness: 0.07,
    terrainRoughness: 0.94,
    beacon: [0.2, 0.9, 1],
    accent: [1, 0.55, 0.25],
  },
};

// ------------------------------------------------------------------ Aetherion (lush)

const AE_SITE = { x: 150, z: 110 };
export const AETHERION: PlanetDefX = {
  id: "aetherion",
  name: "Aetherion",
  biome: "lush",
  tagline: "Canopy world of singing lakes",
  description:
    "A warm, breathing world of lantern-willows and parasol pines. Clear lakes mirror a turquoise sky, and the broken aqueducts of a vanished people still channel its rain. Ashveil privateers have started to sniff around the lake country.",
  seed: 52841,
  danger: 2,
  map: { x: -0.56, y: 0.34, color: "#5fdc8c", size: 1.15 },
  terrainSize: 1600,
  walkRadius: 640,
  flightRadius: 760,
  maxAltitude: 720,
  gravity: 13.5,
  liquid: { kind: "water", level: -4, color: [0.04, 0.2, 0.26], emissive: 0.1 },
  landingSite: { name: "Verdant Shelf", x: AE_SITE.x, z: AE_SITE.z, radius: 120 },
  arrival: { x: -260, y: 300, z: -230, yaw: yawTo(-260, -230, AE_SITE.x, AE_SITE.z) },
  hasStation: false,
  hazard: { kind: "none", label: "Breathable atmosphere", intensity: 0 },
  weather: { kind: "pollen", intensity: 0.6 },
  sky: {
    zenith: [0.1, 0.3, 0.62],
    horizon: [0.66, 0.84, 0.9],
    ground: [0.14, 0.2, 0.15],
    sun: [1.0, 0.95, 0.82],
    sunDir: [0.55, 0.6, -0.5],
    stars: 0.06,
    fogScale: 1.1,
    sunScale: 1.05,
    ambientScale: 1.05,
  },
  terrain: {
    baseAmp: 17,
    detailAmp: 3.4,
    ridgeAmp: 44,
    mountainAmp: 230,
    craters: 2,
    basins: 7,
    basinMin: 42,
    basinRange: 58,
    basinDepth: 5,
    rivers: 1,
    riverWidth: 0.022,
    riverDepth: 3,
    peakStart: 95,
    peakEnd: 150,
    poiPads: true,
    flatInner: 34,
    flatOuter: 85,
  },
  palette: {
    low: [0.16, 0.44, 0.3],
    mid: [0.36, 0.38, 0.2],
    rock: [0.4, 0.38, 0.36],
    peak: [0.9, 0.93, 0.96],
    basin: [0.14, 0.2, 0.16],
  },
  resources: { weights: { lumenite: 30, ferrite: 25, carbon: 40, voidQuartz: 5 }, count: 300, richness: 1.1 },
  pois: [
    {
      id: "thornspire",
      name: "Thornspire Ruins",
      kind: "ruin",
      x: -230,
      z: 250,
      lore: "Fluted columns of green-veined stone, cracked open by roots older than any colony. The carvings show tall figures pouring water from one cupped hand to another.",
      loot: { lumenite: 18, carbon: 12 },
    },
    {
      id: "canopy",
      name: "The Elder Canopy",
      kind: "landmark",
      x: 300,
      z: -170,
      lore: "A single lantern-willow so old its crown shades a whole valley. Its pods pulse in a slow rhythm, as if the tree were keeping time for the forest.",
      loot: { carbon: 40 },
    },
    {
      id: "aqueduct",
      name: "Aqueduct of the Choir",
      kind: "ruin",
      x: -330,
      z: -110,
      lore: "Arches marching toward a lake that has long since moved. When wind threads the channels, the stone sings a chord in three notes.",
      loot: { ferrite: 22, voidQuartz: 2 },
    },
    {
      id: "lark",
      name: "Wreck of the Patient Lark",
      kind: "wreck",
      x: 60,
      z: -390,
      lore: "A courier that came down in a storm, its captain's last entry calm and precise: 'Engines gone. Lakes are beautiful from here. Deliver the seeds.'",
      loot: { ferrite: 26, lumenite: 10 },
    },
    {
      id: "seedvault",
      name: "Seedkeeper Cache",
      kind: "cache",
      x: 410,
      z: 230,
      lore: "A sealed planter-crate stencilled with a frontier co-op mark. Inside, seed cylinders still cold in their cradles — and a spare power cell.",
      loot: { carbon: 30, lumenite: 8 },
    },
    {
      id: "surveyhut",
      name: "Lakeside Survey Hut",
      kind: "facility",
      x: -40,
      z: 170,
      lore: "A prefab hut, door open, kettle on the stove gone to rust. The survey map on the wall marks a red circle around the lake country: 'pirate sign — do not linger'.",
      loot: { ferrite: 12, carbon: 10 },
    },
  ],
  encounters: { arrival: ["interceptor"], patrols: ["scout", "scout", "interceptor"], patrolInterval: 150, maxActive: 2 },
  look: {
    sunDiffuse: [1.0, 0.96, 0.88],
    sunSpecular: [0.7, 0.68, 0.6],
    ambientSky: [0.55, 0.72, 0.92],
    ambientGround: [0.2, 0.28, 0.18],
    sceneAmbient: [0.22, 0.27, 0.25],
    haze: [0.58, 0.74, 0.84],
    hazeSun: [1.0, 0.94, 0.8],
    hazeFalloff: 0.011,
    backdrop: [0.26, 0.4, 0.46],
    backdropGlow: 0.42,
    backdropHeight: 1.05,
    clouds: 0.75,
    cloudCover: 0.62,
    cloudTint: [1, 1, 1],
    giantA: [0.82, 0.74, 0.56],
    giantB: [0.94, 0.86, 0.7],
    ring: [0.95, 0.92, 0.85],
    giantDir: [-0.7, 0.28, 0.62],
    holeDir: [0.62, 0.36, 0.7],
    liquidAlbedo: [0.03, 0.16, 0.22],
    liquidEmissive: [0.01, 0.05, 0.07],
    liquidAlpha: 0.84,
    liquidRoughness: 0.03,
    shore: [0.62, 0.58, 0.42],
    shoreWidth: 2.4,
    terrainRoughness: 0.9,
    beacon: [0.55, 1, 0.65],
    accent: [0.5, 1, 0.75],
  },
};

// ------------------------------------------------------------------ Kryos (frozen)

const KR_SITE = { x: -190, z: 160 };
export const KRYOS: PlanetDefX = {
  id: "kryos",
  name: "Kryos",
  biome: "frozen",
  tagline: "Glacier moon of whispering spires",
  description:
    "A white world under a pale, low sun. Frozen lakes are thick enough to land a ship on, ice spires ring like bells in the wind, and blizzards roll down from the glaciers without warning. The richest Void Quartz seams on the frontier lie under the snow.",
  seed: 90417,
  danger: 3,
  map: { x: 0.62, y: 0.56, color: "#bfe6ff", size: 0.9 },
  terrainSize: 1600,
  walkRadius: 640,
  flightRadius: 760,
  maxAltitude: 720,
  gravity: 12.5,
  liquid: { kind: "ice", level: -3, color: [0.64, 0.82, 0.94], emissive: 0.08 },
  landingSite: { name: "Rime Hollow", x: KR_SITE.x, z: KR_SITE.z, radius: 120 },
  arrival: { x: 250, y: 310, z: -200, yaw: yawTo(250, -200, KR_SITE.x, KR_SITE.z) },
  hasStation: false,
  hazard: { kind: "cold", label: "Extreme cold", intensity: 0.6 },
  weather: { kind: "blizzard", intensity: 0.7 },
  sky: {
    zenith: [0.1, 0.17, 0.34],
    horizon: [0.74, 0.82, 0.92],
    ground: [0.46, 0.5, 0.58],
    sun: [0.92, 0.96, 1.0],
    sunDir: [0.28, 0.24, 0.93],
    stars: 0.28,
    fogScale: 1.6,
    sunScale: 0.95,
    ambientScale: 1.15,
  },
  terrain: {
    baseAmp: 16,
    detailAmp: 2.6,
    ridgeAmp: 42,
    mountainAmp: 240,
    craters: 4,
    basins: 6,
    basinMin: 40,
    basinRange: 55,
    basinDepth: 3,
    dunes: 1.6,
    peakStart: 30,
    peakEnd: 100,
    poiPads: true,
  },
  palette: {
    low: [0.86, 0.9, 0.96],
    mid: [0.7, 0.77, 0.88],
    rock: [0.34, 0.38, 0.47],
    peak: [0.74, 0.88, 1.0],
    basin: [0.55, 0.66, 0.76],
  },
  resources: { weights: { lumenite: 22, ferrite: 28, carbon: 10, voidQuartz: 40 }, count: 260, richness: 1.2 },
  pois: [
    {
      id: "hoarfrost",
      name: "Station Hoarfrost",
      kind: "facility",
      x: 250,
      z: 210,
      lore: "A survey station abandoned mid-shift: mugs on the mess table, a heater still trying to start. The last log reads 'Spires singing louder tonight. Pulling the crew in.'",
      loot: { ferrite: 24, lumenite: 12 },
    },
    {
      id: "cryolab",
      name: "Cryo-Lab Annex",
      kind: "facility",
      x: -340,
      z: -230,
      lore: "Sample freezers line the walls, each one holding a sliver of violet crystal grown in perfect hexagons. Someone was farming Void Quartz here — and left in a hurry.",
      loot: { voidQuartz: 6, lumenite: 10 },
    },
    {
      id: "frozenchoir",
      name: "The Frozen Choir",
      kind: "landmark",
      x: 120,
      z: -330,
      lore: "A ring of wind-carved ice arches. Stand at the centre and the blizzard falls silent, replaced by a low, layered hum that no instrument has matched.",
      loot: { voidQuartz: 4 },
    },
    {
      id: "drillrig",
      name: "Buried Drill Rig",
      kind: "miningStation",
      x: -420,
      z: 150,
      lore: "A deep-core drill half swallowed by a snow drift. The bit is still lodged in a seam of quartz, glowing faintly through the ice.",
      loot: { ferrite: 30, voidQuartz: 3 },
    },
    {
      id: "courier",
      name: "Icebound Courier",
      kind: "wreck",
      x: 40,
      z: 380,
      lore: "A light courier that skidded across a frozen lake and buried its nose in the far bank. The cargo manifest lists 'medical supplies'; the hold says otherwise.",
      loot: { lumenite: 16, ferrite: 14 },
    },
    {
      id: "glaciervault",
      name: "Glacier Vault",
      kind: "cache",
      x: 390,
      z: -60,
      lore: "A survival locker bolted to the rock, its beacon long dead. Thermal blankets, flare tubes, and a sealed tin of Void Quartz chips.",
      loot: { voidQuartz: 5, carbon: 12 },
    },
  ],
  encounters: { arrival: ["scout", "scout"], patrols: ["scout", "interceptor"], patrolInterval: 130, maxActive: 2 },
  look: {
    sunDiffuse: [0.95, 0.97, 1.0],
    sunSpecular: [0.9, 0.92, 1.0],
    ambientSky: [0.62, 0.72, 0.9],
    ambientGround: [0.42, 0.46, 0.55],
    sceneAmbient: [0.3, 0.33, 0.4],
    haze: [0.72, 0.8, 0.9],
    hazeSun: [0.95, 0.97, 1.0],
    hazeFalloff: 0.008,
    backdrop: [0.5, 0.58, 0.7],
    backdropGlow: 0.5,
    backdropHeight: 1.15,
    clouds: 0.45,
    cloudCover: 0.5,
    cloudTint: [0.95, 0.97, 1],
    giantA: [0.5, 0.62, 0.78],
    giantB: [0.74, 0.82, 0.92],
    ring: [0.86, 0.9, 1.0],
    giantDir: [-0.5, 0.42, -0.75],
    holeDir: [0.78, 0.3, -0.55],
    liquidAlbedo: [0.62, 0.8, 0.92],
    liquidEmissive: [0.04, 0.08, 0.12],
    liquidAlpha: 0.94,
    liquidRoughness: 0.1,
    shore: [0.92, 0.95, 1.0],
    shoreWidth: 1.5,
    terrainRoughness: 0.55,
    sparkle: 1,
    beacon: [0.45, 0.85, 1],
    accent: [0.6, 0.9, 1],
  },
};

// ------------------------------------------------------------------ Pyron (volcanic)

const PY_SITE = { x: 80, z: -210 };
export const PYRON: PlanetDefX = {
  id: "pyron",
  name: "Pyron",
  biome: "volcanic",
  tagline: "Forge world of rivers of fire",
  description:
    "Basalt plains split by rivers of lava, calderas breathing ash into a copper sky. The ferrite here is the richest on the frontier, and the extraction crews who chase it rarely retire. Don't land in anything that glows.",
  seed: 66013,
  danger: 4,
  map: { x: 0.5, y: -0.52, color: "#ff7a3a", size: 1.05 },
  terrainSize: 1600,
  walkRadius: 640,
  flightRadius: 760,
  maxAltitude: 720,
  gravity: 15.5,
  liquid: { kind: "lava", level: -6, color: [1.0, 0.42, 0.08], emissive: 1.6 },
  landingSite: { name: "Cinder Terrace", x: PY_SITE.x, z: PY_SITE.z, radius: 115 },
  arrival: { x: -150, y: 320, z: 280, yaw: yawTo(-150, 280, PY_SITE.x, PY_SITE.z) },
  hasStation: false,
  hazard: { kind: "heat", label: "Lava heat", intensity: 0.85 },
  weather: { kind: "ash", intensity: 0.7 },
  sky: {
    zenith: [0.12, 0.035, 0.03],
    horizon: [0.8, 0.36, 0.17],
    ground: [0.18, 0.07, 0.04],
    sun: [1.0, 0.62, 0.34],
    sunDir: [-0.35, 0.3, 0.88],
    stars: 0.22,
    fogScale: 1.35,
    sunScale: 0.92,
    ambientScale: 0.95,
  },
  terrain: {
    baseAmp: 12,
    detailAmp: 3.8,
    ridgeAmp: 34,
    mountainAmp: 260,
    craters: 3,
    calderas: 4,
    basins: 5,
    basinMin: 55,
    basinRange: 60,
    basinDepth: 3,
    rivers: 1,
    riverWidth: 0.03,
    riverDepth: 4,
    peakStart: 80,
    peakEnd: 160,
    poiPads: true,
  },
  palette: {
    low: [0.17, 0.14, 0.13],
    mid: [0.32, 0.23, 0.18],
    rock: [0.23, 0.19, 0.18],
    peak: [0.5, 0.46, 0.44],
    basin: [0.1, 0.07, 0.06],
  },
  resources: { weights: { lumenite: 18, ferrite: 52, carbon: 8, voidQuartz: 22 }, count: 280, richness: 1.35 },
  pois: [
    {
      id: "magmatap",
      name: "Magma Tap Seven",
      kind: "miningStation",
      x: -270,
      z: -120,
      lore: "A derrick sunk straight into a lava vein, pumping molten ferrite into cooling tanks. Six other taps are marked on the crew board. All six are crossed out.",
      loot: { ferrite: 40, lumenite: 6 },
    },
    {
      id: "refinery",
      name: "Slag Refinery Ophir",
      kind: "miningStation",
      x: 300,
      z: 150,
      lore: "Smokestacks still warm, conveyor frozen mid-load. The shift roster on the door is signed in Ashveil red — this crew paid protection, and it wasn't enough.",
      loot: { ferrite: 34, voidQuartz: 3 },
    },
    {
      id: "watchpost",
      name: "Caldera Watchpost",
      kind: "facility",
      x: -120,
      z: 330,
      lore: "A seismic station on stilts, its instruments scribbling a rising tremor line across a roll of paper that ran out weeks ago.",
      loot: { lumenite: 14, ferrite: 12 },
    },
    {
      id: "throne",
      name: "The Obsidian Throne",
      kind: "landmark",
      x: 370,
      z: -290,
      lore: "A volcanic plug split into a shape like a great seat. Prospectors leave a ferrite nugget on the armrest for luck; the pile is taller than a person.",
      loot: { ferrite: 25 },
    },
    {
      id: "smelter",
      name: "Collapsed Smelter",
      kind: "ruin",
      x: -380,
      z: 230,
      lore: "A first-wave smelter buried by a lava surge. Its crucible still holds a solid ingot the size of a shuttle, cooled into glittering black glass.",
      loot: { ferrite: 28, voidQuartz: 2 },
    },
    {
      id: "lockbox",
      name: "Furnace Lockbox",
      kind: "cache",
      x: 190,
      z: 40,
      lore: "A heat-proof strongbox chained to a pylon. The chain has been cut — but whoever cut it never came back for the box.",
      loot: { lumenite: 10, ferrite: 18 },
    },
  ],
  encounters: { arrival: ["raider"], patrols: ["raider", "interceptor", "raider"], patrolInterval: 110, maxActive: 2 },
  look: {
    sunDiffuse: [1.0, 0.7, 0.48],
    sunSpecular: [0.7, 0.5, 0.4],
    ambientSky: [0.72, 0.42, 0.34],
    ambientGround: [0.4, 0.16, 0.08],
    sceneAmbient: [0.3, 0.16, 0.12],
    haze: [0.66, 0.32, 0.18],
    hazeSun: [1.0, 0.62, 0.36],
    hazeFalloff: 0.01,
    backdrop: [0.18, 0.08, 0.06],
    backdropGlow: 0.32,
    backdropHeight: 1.2,
    clouds: 0.5,
    cloudCover: 0.55,
    cloudTint: [0.45, 0.34, 0.3],
    giantA: [0.6, 0.34, 0.22],
    giantB: [0.82, 0.56, 0.36],
    ring: [0.9, 0.7, 0.5],
    giantDir: [0.72, 0.32, -0.6],
    holeDir: [-0.6, 0.45, -0.66],
    liquidAlbedo: [0.5, 0.12, 0.02],
    liquidEmissive: [1.0, 0.36, 0.06],
    liquidAlpha: 1,
    liquidRoughness: 0.6,
    shore: [0.62, 0.2, 0.06],
    shoreWidth: 2.5,
    terrainRoughness: 0.9,
    beacon: [1, 0.78, 0.3],
    accent: [1, 0.5, 0.15],
  },
};

// ------------------------------------------------------------------ Zephyria (exotic)

const ZE_SITE = { x: -80, z: 230 };
export const ZEPHYRIA: PlanetDefX = {
  id: "zephyria",
  name: "Zephyria",
  biome: "exotic",
  tagline: "Sky-reef of floating stone",
  description:
    "Islands of rock hang in a rose-coloured sky, held aloft by veins of lumenite no one has explained. Storm fronts sweep the terraced plains, and silent alien outposts watch from the ridges. Hunter packs use the islands as cover.",
  seed: 40961,
  danger: 3,
  map: { x: -0.62, y: -0.46, color: "#d68cff", size: 1.1, ring: true },
  terrainSize: 1600,
  walkRadius: 640,
  flightRadius: 760,
  maxAltitude: 720,
  gravity: 10.5,
  liquid: { kind: "water", level: -8, color: [0.12, 0.26, 0.36], emissive: 0.2 },
  landingSite: { name: "Windward Steppe", x: ZE_SITE.x, z: ZE_SITE.z, radius: 120 },
  arrival: { x: 300, y: 320, z: -150, yaw: yawTo(300, -150, ZE_SITE.x, ZE_SITE.z) },
  hasStation: false,
  hazard: { kind: "storm", label: "Storm fronts", intensity: 0.55 },
  weather: { kind: "storm", intensity: 0.6 },
  sky: {
    zenith: [0.2, 0.08, 0.4],
    horizon: [0.92, 0.64, 0.74],
    ground: [0.26, 0.16, 0.3],
    sun: [1.0, 0.9, 0.96],
    sunDir: [0.62, 0.46, 0.38],
    stars: 0.45,
    fogScale: 1.1,
    sunScale: 1.0,
    ambientScale: 1.0,
  },
  terrain: {
    baseAmp: 20,
    detailAmp: 3,
    ridgeAmp: 38,
    mountainAmp: 210,
    craters: 2,
    warp: 55,
    terraces: 0.65,
    terraceStep: 13,
    basins: 4,
    basinMin: 45,
    basinRange: 50,
    basinDepth: 6,
    floating: 22,
    arches: 7,
    peakStart: 110,
    peakEnd: 170,
    poiPads: true,
  },
  palette: {
    low: [0.42, 0.3, 0.52],
    mid: [0.66, 0.5, 0.42],
    rock: [0.58, 0.4, 0.38],
    peak: [0.88, 0.82, 0.92],
    basin: [0.2, 0.18, 0.28],
  },
  resources: { weights: { lumenite: 36, ferrite: 22, carbon: 24, voidQuartz: 18 }, count: 270, richness: 1.2 },
  pois: [
    {
      id: "spindle",
      name: "Spindle Outpost",
      kind: "outpost",
      x: 240,
      z: 260,
      lore: "A needle tower of seamless alien alloy, its tip turning slowly to face each incoming storm. Its doors open for no one — but they hum when lumenite is near.",
      loot: { lumenite: 24, voidQuartz: 3 },
    },
    {
      id: "gate",
      name: "The Hanging Gate",
      kind: "landmark",
      x: 330,
      z: -80,
      lore: "A stone arch suspended above the plain with nothing beneath it. Lightning strikes it every storm and leaves no mark.",
      loot: { voidQuartz: 5 },
    },
    {
      id: "obelisks",
      name: "Resonance Obelisks",
      kind: "ruin",
      x: -300,
      z: -140,
      lore: "Seven leaning obelisks arranged by height. Strike the smallest and the tallest answers a heartbeat later, three hundred metres away.",
      loot: { lumenite: 16, ferrite: 12 },
    },
    {
      id: "observatory",
      name: "Tethered Observatory",
      kind: "outpost",
      x: 0,
      z: -360,
      lore: "An alien dome anchored by cables to a floating island overhead. The star chart on its ceiling shows this system — with one world that is not there any more.",
      loot: { lumenite: 18, carbon: 14 },
    },
    {
      id: "stormglass",
      name: "Stormglass Cache",
      kind: "cache",
      x: -390,
      z: 190,
      lore: "A prospector's cache wedged under a fallen slab. Bottled lightning-fused sand, notes on island drift, and a heavy bag of ore.",
      loot: { ferrite: 20, lumenite: 10 },
    },
    {
      id: "galerunner",
      name: "Wreck of the Gale Runner",
      kind: "wreck",
      x: 150,
      z: -170,
      lore: "A racing skiff that tried to thread the islands in a storm. Its flight recorder is intact, and so are the hunter-craft contacts on its last radar sweep.",
      loot: { ferrite: 22, carbon: 12 },
    },
  ],
  encounters: { arrival: ["hunter"], patrols: ["hunter", "scout"], patrolInterval: 125, maxActive: 2 },
  look: {
    sunDiffuse: [1.0, 0.9, 0.95],
    sunSpecular: [0.7, 0.62, 0.7],
    ambientSky: [0.66, 0.52, 0.86],
    ambientGround: [0.32, 0.2, 0.3],
    sceneAmbient: [0.28, 0.2, 0.32],
    haze: [0.82, 0.56, 0.7],
    hazeSun: [1.0, 0.88, 0.9],
    hazeFalloff: 0.009,
    backdrop: [0.34, 0.2, 0.42],
    backdropGlow: 0.45,
    backdropHeight: 1.3,
    clouds: 0.6,
    cloudCover: 0.58,
    cloudTint: [1, 0.9, 0.96],
    giantA: [0.42, 0.62, 0.8],
    giantB: [0.7, 0.5, 0.86],
    ring: [0.92, 0.78, 1.0],
    giantDir: [-0.4, 0.42, -0.8],
    holeDir: [0.4, 0.5, 0.76],
    liquidAlbedo: [0.1, 0.22, 0.34],
    liquidEmissive: [0.04, 0.12, 0.18],
    liquidAlpha: 0.86,
    liquidRoughness: 0.05,
    shore: [0.78, 0.66, 0.6],
    shoreWidth: 2,
    terrainRoughness: 0.88,
    beacon: [0.95, 0.65, 1],
    accent: [0.55, 0.95, 1],
  },
};

// ------------------------------------------------------------------ Noctaris (hostile)

const NO_SITE = { x: -260, z: -190 };
export const NOCTARIS: PlanetDefX = {
  id: "noctaris",
  name: "Noctaris",
  biome: "hostile",
  tagline: "Ashveil fortress world",
  description:
    "A night-dark world of basalt spikes and acid marshes under a dim red sun. The Ashveil syndicate runs its operations from a walled stronghold here, ringed by outposts with red warning lamps. Landing anywhere but the Blackscar Flats is asking for trouble.",
  seed: 13013,
  danger: 5,
  map: { x: 0.86, y: -0.04, color: "#ff4d5e", size: 0.95 },
  terrainSize: 1600,
  walkRadius: 640,
  flightRadius: 760,
  maxAltitude: 720,
  gravity: 16,
  liquid: { kind: "acid", level: -6, color: [0.3, 0.85, 0.2], emissive: 0.7 },
  landingSite: { name: "Blackscar Flats", x: NO_SITE.x, z: NO_SITE.z, radius: 110 },
  arrival: { x: -420, y: 300, z: 180, yaw: yawTo(-420, 180, NO_SITE.x, NO_SITE.z) },
  hasStation: false,
  hazard: { kind: "toxic", label: "Toxic atmosphere", intensity: 0.7 },
  weather: { kind: "spores", intensity: 0.6 },
  sky: {
    zenith: [0.025, 0.015, 0.045],
    horizon: [0.36, 0.11, 0.13],
    ground: [0.05, 0.03, 0.04],
    sun: [0.95, 0.42, 0.36],
    sunDir: [-0.7, 0.3, 0.4],
    stars: 0.95,
    fogScale: 1.25,
    sunScale: 0.8,
    ambientScale: 0.8,
  },
  terrain: {
    baseAmp: 15,
    detailAmp: 4.2,
    ridgeAmp: 46,
    mountainAmp: 250,
    craters: 12,
    basins: 6,
    basinMin: 40,
    basinRange: 45,
    basinDepth: 4,
    terraces: 0.3,
    terraceStep: 9,
    peakStart: 120,
    peakEnd: 200,
    poiPads: true,
  },
  palette: {
    low: [0.11, 0.1, 0.11],
    mid: [0.19, 0.16, 0.17],
    rock: [0.14, 0.12, 0.14],
    peak: [0.34, 0.3, 0.34],
    basin: [0.07, 0.08, 0.05],
  },
  resources: { weights: { lumenite: 24, ferrite: 26, carbon: 6, voidQuartz: 44 }, count: 220, richness: 1.5 },
  pois: [
    {
      id: "kharon",
      name: "Ashveil Bastion Kharon",
      kind: "stronghold",
      x: 290,
      z: 250,
      lore: "The syndicate's fortress: black walls, red lamps, and a docking spire that never sleeps. Ashveil captains are said to keep their ledgers here, in a vault nobody has seen.",
      loot: { voidQuartz: 10, lumenite: 30, ferrite: 30 },
    },
    {
      id: "redlantern",
      name: "Red Lantern Outpost",
      kind: "outpost",
      x: -110,
      z: 310,
      lore: "A gun-post and fuel dump on the marsh road, lamps blinking a slow warning rhythm. The barracks bunks are warm. The crew is somewhere close.",
      loot: { ferrite: 24, lumenite: 12 },
    },
    {
      id: "gallows",
      name: "Gallows Ridge Outpost",
      kind: "outpost",
      x: 370,
      z: -170,
      lore: "A listening post on a spine of basalt, its antenna aimed at the jump lanes. Intercepted traffic logs list every freighter that crossed the frontier this year.",
      loot: { voidQuartz: 4, ferrite: 18 },
    },
    {
      id: "pumps",
      name: "Toxic Pump Array",
      kind: "miningStation",
      x: 40,
      z: -370,
      lore: "Pumps drawing acid from the marsh into pressurised tanks. The Ashveil sell it on as hull-etching compound — and dump the leftovers wherever they like.",
      loot: { ferrite: 30, carbon: 10 },
    },
    {
      id: "vigil",
      name: "Graveyard of the Vigil",
      kind: "wreck",
      x: -420,
      z: 60,
      lore: "The remains of a patrol flotilla that came to clear the syndicate out. Their hulls are scored with the same burn pattern, all from one direction.",
      loot: { ferrite: 34, lumenite: 14 },
    },
    {
      id: "shrine",
      name: "Hollow Choir Shrine",
      kind: "ruin",
      x: 110,
      z: 60,
      lore: "A ring of hollow stone pipes, older than the syndicate and older than the frontier. The Hollow Choir sect claims the pipes sing a warning before every storm. The Ashveil leave them alone.",
      loot: { voidQuartz: 6 },
    },
    {
      id: "quarantine",
      name: "Quarantine Cache",
      kind: "cache",
      x: -60,
      z: -40,
      lore: "A medical drop sealed with a biohazard stencil, never collected. The filters inside would buy an extra hour in the marsh air.",
      loot: { carbon: 14, lumenite: 10 },
    },
  ],
  encounters: { arrival: ["hunter", "raider"], patrols: ["hunter", "raider", "raider"], patrolInterval: 80, maxActive: 3 },
  look: {
    sunDiffuse: [0.95, 0.55, 0.5],
    sunSpecular: [0.6, 0.4, 0.4],
    ambientSky: [0.4, 0.26, 0.42],
    ambientGround: [0.16, 0.1, 0.1],
    sceneAmbient: [0.2, 0.12, 0.18],
    haze: [0.3, 0.1, 0.12],
    hazeSun: [0.9, 0.42, 0.34],
    hazeFalloff: 0.01,
    backdrop: [0.08, 0.04, 0.07],
    backdropGlow: 0.28,
    backdropHeight: 1.25,
    clouds: 0.3,
    cloudCover: 0.6,
    cloudTint: [0.5, 0.3, 0.32],
    giantA: [0.5, 0.2, 0.24],
    giantB: [0.7, 0.36, 0.3],
    ring: [0.8, 0.5, 0.5],
    giantDir: [0.5, 0.35, -0.8],
    holeDir: [-0.4, 0.5, 0.77],
    liquidAlbedo: [0.12, 0.34, 0.06],
    liquidEmissive: [0.2, 0.7, 0.1],
    liquidAlpha: 0.9,
    liquidRoughness: 0.12,
    shore: [0.3, 0.42, 0.1],
    shoreWidth: 2.2,
    terrainRoughness: 0.78,
    beacon: [1, 0.85, 0.4],
    accent: [1, 0.18, 0.12],
  },
};

export const PLANETS: Record<PlanetId, PlanetDefX> = {
  veyra7: VEYRA7,
  aetherion: AETHERION,
  kryos: KRYOS,
  pyron: PYRON,
  zephyria: ZEPHYRIA,
  noctaris: NOCTARIS,
};

/** The five worlds added in M4 (everything except Veyra-7). */
export const NEW_PLANET_IDS: PlanetId[] = ["aetherion", "kryos", "pyron", "zephyria", "noctaris"];

export function getPlanet(id: PlanetId): PlanetDefX {
  const p = PLANETS[id];
  if (!p) throw new Error(`Unknown planet: ${id}`);
  return p;
}

/** Splits `total` across resource weights (largest remainder; deterministic). */
export function resourceCounts(def: PlanetDef): Record<ResourceId, number> {
  const ids = Object.keys(def.resources.weights) as ResourceId[];
  const sum = ids.reduce((s, k) => s + Math.max(0, def.resources.weights[k] ?? 0), 0) || 1;
  const raw = ids.map((k) => (Math.max(0, def.resources.weights[k] ?? 0) / sum) * def.resources.count);
  const out = Object.fromEntries(ids.map((k, i) => [k, Math.floor(raw[i])])) as Record<ResourceId, number>;
  let left = def.resources.count - ids.reduce((s, k) => s + out[k], 0);
  const order = ids.map((k, i) => [k, raw[i] - Math.floor(raw[i])] as const).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  for (let i = 0; left > 0 && order.length; i = (i + 1) % order.length, left--) out[order[i][0]]++;
  return out;
}
