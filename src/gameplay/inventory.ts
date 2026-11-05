import { RESOURCE_IDS, type ResourceCost, type ResourceId, isResourceId } from "./resources";

export type InventoryCounts = Record<ResourceId, number>;

export function emptyCounts(): InventoryCounts {
  return { ferrite: 0, carbon: 0, lumenite: 0, voidQuartz: 0 };
}

/** Per-resource stack inventory with a shared capacity limit per resource. */
export class Inventory {
  private counts: InventoryCounts = emptyCounts();
  private listeners = new Set<() => void>();
  capacity: number;

  constructor(capacity = 250, initial?: Partial<InventoryCounts>) {
    this.capacity = capacity;
    if (initial) {
      for (const id of RESOURCE_IDS) {
        const v = initial[id];
        if (typeof v === "number" && Number.isFinite(v)) this.counts[id] = Math.max(0, Math.min(capacity, Math.floor(v)));
      }
    }
  }

  get(id: ResourceId): number {
    return this.counts[id];
  }

  snapshot(): InventoryCounts {
    return { ...this.counts };
  }

  spaceFor(id: ResourceId): number {
    return Math.max(0, this.capacity - this.counts[id]);
  }

  /** Adds up to `amount` whole units; returns how many were stored. */
  add(id: ResourceId, amount: number): number {
    const whole = Math.floor(amount);
    if (whole <= 0) return 0;
    const stored = Math.min(whole, this.spaceFor(id));
    if (stored > 0) {
      this.counts[id] += stored;
      this.emit();
    }
    return stored;
  }

  has(cost: ResourceCost): boolean {
    return RESOURCE_IDS.every((id) => this.counts[id] >= (cost[id] ?? 0));
  }

  /** Atomically removes the full cost, or nothing. */
  spend(cost: ResourceCost): boolean {
    if (!this.has(cost)) return false;
    for (const id of RESOURCE_IDS) this.counts[id] -= cost[id] ?? 0;
    this.emit();
    return true;
  }

  setCapacity(capacity: number): void {
    this.capacity = capacity;
    this.emit();
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  toJSON(): InventoryCounts {
    return this.snapshot();
  }

  static sanitize(raw: unknown): InventoryCounts {
    const out = emptyCounts();
    if (raw && typeof raw === "object") {
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (isResourceId(k) && typeof v === "number" && Number.isFinite(v)) out[k] = Math.max(0, Math.floor(v));
      }
    }
    return out;
  }
}
