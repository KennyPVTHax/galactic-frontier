/**
 * Damage model: energy shields absorb first and regenerate after a delay; the
 * hull behind them is protected by flat armour and a percentage resistance.
 */
export interface DamageProfile {
  maxShield: number;
  /** Shield points regenerated per second once the delay has elapsed. */
  shieldRegen: number;
  /** Seconds without taking damage before the shield starts regenerating. */
  shieldDelay: number;
  maxHull: number;
  /** Flat reduction per hit applied to hull damage (after resistance). */
  armor: number;
  /** 0..0.9: fraction of hull damage ignored. */
  resistance: number;
}

export interface DamageResult {
  /** Damage soaked by the shield. */
  absorbed: number;
  /** Damage dealt to the hull after resistance/armour. */
  hullDamage: number;
  /** The shield went from >0 to 0 on this hit. */
  shieldDown: boolean;
  /** The hull reached 0 on this hit. */
  destroyed: boolean;
}

/** Armour can never reduce a hit below this fraction of its post-resistance value. */
export const MIN_HULL_FRACTION = 0.15;

export class Durability {
  shield: number;
  hull: number;
  /** Seconds since the last damage. */
  sinceHit = 1e9;
  /** When false the shield never regenerates (e.g. dreadnought generator destroyed). */
  regenEnabled = true;

  constructor(public profile: DamageProfile) {
    this.shield = profile.maxShield;
    this.hull = profile.maxHull;
  }

  get alive(): boolean {
    return this.hull > 0;
  }
  get shieldFrac(): number {
    return this.profile.maxShield > 0 ? this.shield / this.profile.maxShield : 0;
  }
  get hullFrac(): number {
    return this.profile.maxHull > 0 ? this.hull / this.profile.maxHull : 0;
  }

  /** Pure hull mitigation for a raw amount that already got past the shield. */
  static mitigate(raw: number, p: Pick<DamageProfile, "armor" | "resistance">): number {
    if (raw <= 0) return 0;
    const afterRes = raw * (1 - Math.min(0.9, Math.max(0, p.resistance)));
    return Math.max(afterRes * MIN_HULL_FRACTION, afterRes - Math.max(0, p.armor));
  }

  applyDamage(amount: number, bypassShield = false): DamageResult {
    const res: DamageResult = { absorbed: 0, hullDamage: 0, shieldDown: false, destroyed: false };
    if (amount <= 0 || this.hull <= 0) return res;
    this.sinceHit = 0;
    let rest = amount;
    if (!bypassShield && this.shield > 0) {
      const a = Math.min(this.shield, rest);
      this.shield -= a;
      rest -= a;
      res.absorbed = a;
      if (this.shield <= 1e-6) {
        this.shield = 0;
        res.shieldDown = true;
      }
    }
    if (rest > 0) {
      const h = Math.min(this.hull, Durability.mitigate(rest, this.profile));
      this.hull -= h;
      res.hullDamage = h;
      if (this.hull <= 1e-6) {
        this.hull = 0;
        res.destroyed = true;
      }
    }
    return res;
  }

  update(dt: number): void {
    this.sinceHit += dt;
    if (this.regenEnabled && this.hull > 0 && this.sinceHit >= this.profile.shieldDelay && this.shield < this.profile.maxShield) {
      this.shield = Math.min(this.profile.maxShield, this.shield + this.profile.shieldRegen * dt);
    }
  }

  /** Change max values keeping current fractions (used by setPlayerStats). */
  reprofile(p: DamageProfile): void {
    const sf = this.shieldFrac, hf = this.hullFrac;
    this.profile = p;
    this.shield = p.maxShield * (Number.isFinite(sf) ? sf : 1);
    this.hull = p.maxHull * (Number.isFinite(hf) ? hf : 1);
  }
}
