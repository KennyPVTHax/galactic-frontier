/**
 * In-game gameplay resources. These are NOT Orbit Coins and have no exchange
 * rate to any token. They exist only inside Galactic Frontier.
 */
export type ResourceId = "ferrite" | "carbon" | "lumenite" | "voidQuartz";

export interface ResourceDef {
  id: ResourceId;
  name: string;
  short: string;
  description: string;
  /** CSS colour for UI. */
  color: string;
  /** Linear RGB for 3D effects. */
  rgb: [number, number, number];
  source: string;
}

export const RESOURCES: Record<ResourceId, ResourceDef> = {
  ferrite: {
    id: "ferrite",
    name: "Ferrite Ore",
    short: "Fe",
    description: "Rust-veined ore cut from boulders. Base metal for hull and tool upgrades.",
    color: "#e0895a",
    rgb: [0.95, 0.5, 0.28],
    source: "Rust-veined boulders",
  },
  carbon: {
    id: "carbon",
    name: "Carbon Fibre",
    short: "C",
    description: "Harvested from bulb-flora. Organic binder used in suit systems.",
    color: "#7ee08a",
    rgb: [0.45, 0.95, 0.5],
    source: "Bulb-flora",
  },
  lumenite: {
    id: "lumenite",
    name: "Lumenite",
    short: "Lu",
    description: "Cyan photonic crystal. Stores energy; core input for lasers and scanners.",
    color: "#38e1ff",
    rgb: [0.2, 0.9, 1.0],
    source: "Glowing crystal clusters",
  },
  voidQuartz: {
    id: "voidQuartz",
    name: "Void Quartz",
    short: "Vq",
    description: "Rare violet lattice found in impact craters. Bends light around it.",
    color: "#b07cff",
    rgb: [0.7, 0.4, 1.0],
    source: "Crater crystals (rare)",
  },
};

export const RESOURCE_IDS: ResourceId[] = ["ferrite", "carbon", "lumenite", "voidQuartz"];

export type ResourceCost = Partial<Record<ResourceId, number>>;

export function isResourceId(v: unknown): v is ResourceId {
  return typeof v === "string" && (RESOURCE_IDS as string[]).includes(v);
}

export function formatCost(cost: ResourceCost): string {
  return RESOURCE_IDS.filter((id) => (cost[id] ?? 0) > 0)
    .map((id) => `${cost[id]} ${RESOURCES[id].name}`)
    .join(", ");
}
