/**
 * Static world layout for the first playable planet.
 * Everything here is gameplay data, not economy data.
 */
export const WORLD = {
  seed: 7177,
  planetName: "Veyra-7",
  /** Square terrain patch edge length in metres. */
  terrainSize: 1600,
  /** On-foot soft boundary radius. */
  walkRadius: 640,
  /** Flight soft boundary radius. */
  flightRadius: 760,
  maxAltitude: 720,
  gravity: 14,
  /** Height of the luminous lakes that fill low basins. */
  liquidLevel: -5,
  station: {
    name: "Halcyon Dock",
    position: { x: 0, y: 330, z: 260 },
    /** Docking pad centre relative to station hub. */
    padOffset: { x: 0, y: -3, z: -66 },
    /** Ship heading when parked on the pad (faces away from the hub). */
    padYaw: Math.PI,
    collisionRadius: 50,
  },
  surveySite: { name: "Survey Site Alpha", x: -150, z: -120, radius: 130 },
  shipName: "Wayfarer",
  /** Deposits regrow after this many milliseconds. */
  depositRegrowMs: 15 * 60 * 1000,
} as const;

export type Vec3Like = { x: number; y: number; z: number };

export function stationPadPosition(): Vec3Like {
  const s = WORLD.station;
  return { x: s.position.x + s.padOffset.x, y: s.position.y + s.padOffset.y, z: s.position.z + s.padOffset.z };
}
