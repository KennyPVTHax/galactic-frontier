export interface LaserStats {
  maxEnergy: number;
  /** Energy per second while firing. */
  drainPerSec: number;
  /** Energy per second recovered while idle (after `regenDelay`). */
  regenPerSec: number;
  regenDelay: number;
  /** Heat per second while firing (heat scale 0..100). */
  heatPerSec: number;
  coolPerSec: number;
  /** After an overheat the laser stays locked until heat falls to this value. */
  overheatRecoverAt: number;
  /** Resource units extracted per second on target. */
  yieldPerSec: number;
  range: number;
}

export const BASE_LASER: LaserStats = {
  maxEnergy: 100,
  drainPerSec: 9,
  regenPerSec: 7,
  regenDelay: 0.8,
  heatPerSec: 24,
  coolPerSec: 30,
  overheatRecoverAt: 35,
  yieldPerSec: 6,
  range: 20,
};

export interface LaserTick {
  firing: boolean;
  /** Fractional units extracted this tick (0 when not on target). */
  extracted: number;
  /** True only on the frame the laser overheats. */
  justOverheated: boolean;
  /** True only on the frame firing was refused for lack of energy. */
  outOfEnergy: boolean;
}

/** Pure energy/heat simulation for the mining laser (no rendering). */
export class MiningLaserState {
  stats: LaserStats;
  energy: number;
  heat = 0;
  overheated = false;
  private idleTime = 0;
  private wasEmpty = false;

  constructor(stats: LaserStats = BASE_LASER, energy?: number) {
    this.stats = { ...stats };
    this.energy = energy ?? stats.maxEnergy;
  }

  setStats(stats: LaserStats): void {
    this.stats = { ...stats };
    this.energy = Math.min(this.energy, stats.maxEnergy);
  }

  get heatRatio(): number {
    return this.heat / 100;
  }
  get energyRatio(): number {
    return this.energy / this.stats.maxEnergy;
  }

  update(dt: number, wantsFire: boolean, onTarget: boolean): LaserTick {
    const s = this.stats;
    const tick: LaserTick = { firing: false, extracted: 0, justOverheated: false, outOfEnergy: false };
    const canFire = wantsFire && !this.overheated && this.energy > 0;

    if (wantsFire && this.energy <= 0 && !this.wasEmpty) {
      tick.outOfEnergy = true;
      this.wasEmpty = true;
    }
    if (!wantsFire) this.wasEmpty = false;

    if (canFire) {
      tick.firing = true;
      this.idleTime = 0;
      this.energy = Math.max(0, this.energy - s.drainPerSec * dt);
      this.heat = Math.min(100, this.heat + s.heatPerSec * dt);
      if (onTarget) tick.extracted = s.yieldPerSec * dt;
      if (this.heat >= 100) {
        this.overheated = true;
        tick.justOverheated = true;
      }
    } else {
      this.idleTime += dt;
      // Venting after an overheat is faster than passive cooling.
      const cool = this.overheated ? s.coolPerSec * 1.25 : s.coolPerSec;
      this.heat = Math.max(0, this.heat - cool * dt);
      if (this.overheated && this.heat <= s.overheatRecoverAt) this.overheated = false;
      if (this.idleTime >= s.regenDelay) this.energy = Math.min(s.maxEnergy, this.energy + s.regenPerSec * dt);
    }
    return tick;
  }
}
