/**
 * Universe data contract (M4).
 *
 * A planet is pure data: seed, terrain parameters, palette, sky, liquid,
 * resources, points of interest, hazards and encounters. `Planet` (src/world)
 * turns a PlanetDef into a scene; gameplay (missions, travel, combat) reads the
 * same def. Everything is deterministic for a given def so every device and
 * test sees the same world.
 *
 * Integration contract shared by the universe, graphics, combat and gameplay
 * workstreams. Extend by ADDING optional fields; do not rename existing ones.
 */
import type { ResourceId } from "../gameplay/resources";
import type { EnemyTypeId } from "../combat/ids";

export type PlanetId = "veyra7" | "aetherion" | "kryos" | "pyron" | "zephyria" | "noctaris";
export const PLANET_IDS: PlanetId[] = ["veyra7", "aetherion", "kryos", "pyron", "zephyria", "noctaris"];

export type BiomeKind = "lumen" | "lush" | "frozen" | "volcanic" | "exotic" | "hostile";
export type LiquidKind = "lumen" | "water" | "ice" | "lava" | "acid" | "none";
export type HazardKind = "none" | "cold" | "heat" | "storm" | "toxic";
export type WeatherKind = "none" | "dust" | "pollen" | "snow" | "blizzard" | "ash" | "storm" | "spores";
export type Rgb = [number, number, number];

export type PoiKind =
  | "monolith"
  | "wreck"
  | "ruin"
  | "facility"
  | "miningStation"
  | "cache"
  | "orbital"
  | "anomaly"
  | "outpost"
  | "stronghold"
  | "landmark";

export interface PoiDef {
  /** Unique within the planet. Planet ids are prefixed at runtime (see poiRuntimeId). */
  id: string;
  name: string;
  kind: PoiKind;
  x: number;
  z: number;
  lore: string;
  loot: Partial<Record<ResourceId, number>>;
}

export interface TerrainParams {
  /** Broad rolling height amplitude (m). Veyra-7: 14. */
  baseAmp: number;
  /** Small-scale detail amplitude (m). Veyra-7: 3.2. */
  detailAmp: number;
  /** Ridged hill amplitude (m). Veyra-7: 30. */
  ridgeAmp: number;
  /** Ridged edge-mountain amplitude (m). Veyra-7: 200. */
  mountainAmp: number;
  /** Number of random craters. Veyra-7: 9. */
  craters: number;
  /** Free-form extra shaping keys owned by the universe workstream. */
  [extra: string]: number | boolean | string;
}

export interface TerrainPalette {
  /** Lowland ground cover (Veyra-7 moss). */
  low: Rgb;
  /** Soil / mid ground. */
  mid: Rgb;
  /** Steep slopes. */
  rock: Rgb;
  /** High peaks (frost on Veyra-7, snow on Kryos, ash on Pyron …). */
  peak: Rgb;
  /** Basins below the liquid level. */
  basin: Rgb;
}

export interface SkyDef {
  zenith: Rgb;
  horizon: Rgb;
  ground: Rgb;
  sun: Rgb;
  /** Direction TOWARDS the sun (normalised at runtime). */
  sunDir: [number, number, number];
  /** Stars visible in the day sky, 0..1. */
  stars: number;
  /** Multipliers on the active render profile (1 = Veyra-7 look). */
  fogScale: number;
  sunScale: number;
  ambientScale: number;
}

export interface EncounterTable {
  /** Encounter spawned on first arrival (in flight). null = none. */
  arrival: EnemyTypeId[] | null;
  /** Random patrol pool while flying on this planet. */
  patrols: EnemyTypeId[];
  /** Mean seconds between patrol spawns (0 = no patrols). */
  patrolInterval: number;
  /** Max simultaneous hostile ships from patrols. */
  maxActive: number;
}

export interface PlanetDef {
  id: PlanetId;
  name: string;
  biome: BiomeKind;
  tagline: string;
  description: string;
  seed: number;
  /** 0 safe … 5 deadly; drives encounter scaling and the star-map warning. */
  danger: 0 | 1 | 2 | 3 | 4 | 5;
  /** Star-map placement in a -1..1 square, CSS colour, relative size. */
  map: { x: number; y: number; color: string; size: number; ring?: boolean };
  terrainSize: number;
  walkRadius: number;
  flightRadius: number;
  maxAltitude: number;
  gravity: number;
  liquid: { kind: LiquidKind; level: number; color: Rgb; emissive: number };
  /** Flat landing basin guaranteed by the terrain function. */
  landingSite: { name: string; x: number; z: number; radius: number };
  /** Where the ship drops out of warp (flying). */
  arrival: { x: number; y: number; z: number; yaw: number };
  /** Halcyon Dock orbits only planets with a station. */
  hasStation: boolean;
  hazard: { kind: HazardKind; label: string; intensity: number };
  weather: { kind: WeatherKind; intensity: number };
  sky: SkyDef;
  terrain: TerrainParams;
  palette: TerrainPalette;
  resources: { weights: Record<ResourceId, number>; count: number; richness: number };
  pois: PoiDef[];
  encounters: EncounterTable;
}

/** Runtime ids: Veyra-7 keeps its M1/M2 ids (save compatibility); others are prefixed. */
export function runtimeId(planet: PlanetId, localId: string): string {
  return planet === "veyra7" ? localId : `${planet}:${localId}`;
}

export function planetOfRuntimeId(id: string): PlanetId {
  const i = id.indexOf(":");
  return i < 0 ? "veyra7" : (id.slice(0, i) as PlanetId);
}
