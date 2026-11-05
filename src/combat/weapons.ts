/**
 * Original weapon definitions and firing state machines.
 *
 * Enemy weapons fire in telegraphed bursts: a visible WINDUP (the HUD shows an
 * incoming-fire warning and the renderer charges the muzzle), then `burst`
 * shots `shotInterval` apart, then `cooldown`. The player's twin pulse cannons
 * alternate guns and build heat; reaching 100 % heat locks the guns out until
 * they cool below `OVERHEAT_RECOVER`.
 */
export type WeaponId = "pulseCannon" | "skiffBlaster" | "lancetLaser" | "bulwarkCannon" | "bulwarkLaser" | "cantorLaser" | "threnodyTurret" | "threnodySeeker";

/** Visual family of the projectile (renderer picks colour / shape). */
export type BoltKind = "pulse" | "laser" | "choir" | "heavy" | "seeker";

export interface WeaponDef {
  id: WeaponId;
  name: string;
  kind: BoltKind;
  /** Damage per projectile at difficulty 0. */
  damage: number;
  /** Projectile speed (m/s). */
  speed: number;
  /** Max travel distance (m). */
  range: number;
  /** Random cone half-angle (rad) at difficulty 0. */
  spread: number;
  /** Collision radius of the projectile (m). */
  radius: number;
  /** Shots per burst. */
  burst: number;
  /** Seconds between shots inside a burst (player: between shots). */
  shotInterval: number;
  /** Seconds between bursts. */
  cooldown: number;
  /** Telegraph before each burst (s). */
  windup: number;
  /** Homing turn rate (rad/s), 0 = ballistic. */
  homing: number;
  /** Visual length of the bolt (m). */
  length: number;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  pulseCannon: { id: "pulseCannon", name: "Twin Pulse Cannons", kind: "pulse", damage: 9, speed: 420, range: 650, spread: 0.004, radius: 0.6, burst: 1, shotInterval: 0.14, cooldown: 0, windup: 0, homing: 0, length: 6 },
  skiffBlaster: { id: "skiffBlaster", name: "Skiff Scatter-blaster", kind: "laser", damage: 3.5, speed: 300, range: 430, spread: 0.035, radius: 0.5, burst: 3, shotInterval: 0.18, cooldown: 1.5, windup: 0.4, homing: 0, length: 4 },
  lancetLaser: { id: "lancetLaser", name: "Lancet Needle Laser", kind: "laser", damage: 5, speed: 340, range: 520, spread: 0.028, radius: 0.5, burst: 3, shotInterval: 0.16, cooldown: 1.4, windup: 0.45, homing: 0, length: 5 },
  bulwarkCannon: { id: "bulwarkCannon", name: "Bulwark Slug Cannon", kind: "heavy", damage: 14, speed: 230, range: 620, spread: 0.02, radius: 1.3, burst: 1, shotInterval: 0.3, cooldown: 2.8, windup: 0.8, homing: 0, length: 3 },
  bulwarkLaser: { id: "bulwarkLaser", name: "Bulwark Point Laser", kind: "laser", damage: 3, speed: 320, range: 420, spread: 0.04, radius: 0.5, burst: 2, shotInterval: 0.18, cooldown: 2.2, windup: 0.4, homing: 0, length: 4 },
  cantorLaser: { id: "cantorLaser", name: "Cantor Hymn Laser", kind: "choir", damage: 4, speed: 360, range: 500, spread: 0.03, radius: 0.5, burst: 3, shotInterval: 0.15, cooldown: 1.5, windup: 0.4, homing: 0, length: 5 },
  threnodyTurret: { id: "threnodyTurret", name: "Threnody Dirge Turret", kind: "choir", damage: 4.5, speed: 300, range: 720, spread: 0.035, radius: 0.8, burst: 3, shotInterval: 0.22, cooldown: 3.0, windup: 0.6, homing: 0, length: 6 },
  threnodySeeker: { id: "threnodySeeker", name: "Threnody Lament Seeker", kind: "seeker", damage: 14, speed: 95, range: 760, spread: 0.05, radius: 2.2, burst: 1, shotInterval: 0.5, cooldown: 6.5, windup: 1.0, homing: 0.9, length: 2.5 },
};

/** Heat below which an overheated player gun unlocks again. */
export const OVERHEAT_RECOVER = 0.3;

/** Telegraphed burst weapon used by every enemy weapon mount. */
export class BurstWeapon {
  /** Seconds until the next burst may begin. */
  cooldown: number;
  /** > 0 while charging the telegraph. */
  windup = 0;
  /** Shots remaining in the current burst. */
  shotsLeft = 0;
  private shotTimer = 0;

  constructor(
    public readonly def: WeaponDef,
    /** Multiplier on fire rate (difficulty / enrage). */
    public rate = 1,
    initialDelay = 0,
  ) {
    this.cooldown = initialDelay;
  }

  get busy(): boolean {
    return this.windup > 0 || this.shotsLeft > 0;
  }
  get charging(): boolean {
    return this.windup > 0;
  }

  /** Begin a telegraphed burst if ready. Returns true when the windup started. */
  trigger(): boolean {
    if (this.cooldown > 0 || this.busy) return false;
    this.windup = Math.max(1e-3, this.def.windup);
    return true;
  }

  /** Cancel a burst in progress (e.g. target lost) without firing. */
  cancel(): void {
    if (this.windup > 0 || this.shotsLeft > 0) this.cooldown = Math.max(this.cooldown, (this.def.cooldown / this.rate) * 0.5);
    this.windup = 0;
    this.shotsLeft = 0;
  }

  /** Advances timers; returns the number of shots to fire this step. */
  update(dt: number): number {
    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);
    let shots = 0;
    if (this.windup > 0) {
      this.windup -= dt;
      if (this.windup <= 0) {
        this.windup = 0;
        this.shotsLeft = this.def.burst;
        this.shotTimer = 0;
      }
    }
    if (this.shotsLeft > 0) {
      this.shotTimer -= dt;
      while (this.shotsLeft > 0 && this.shotTimer <= 0) {
        shots++;
        this.shotsLeft--;
        this.shotTimer += this.def.shotInterval / this.rate;
      }
      if (this.shotsLeft === 0) this.cooldown = this.def.cooldown / this.rate;
    }
    return shots;
  }
}

export interface PlayerGunStats {
  fireInterval: number;
  /** Heat (0..1 scale) added per shot. */
  heatPerShot: number;
  /** Heat removed per second. */
  coolRate: number;
}

/** Player twin pulse cannons: alternating guns, heat and overheat lockout. */
export class PlayerGun {
  heat = 0;
  overheated = false;
  cooldown = 0;
  /** Gun that fires next (0 = left, 1 = right). */
  gun = 0;

  constructor(public stats: PlayerGunStats) {}

  /**
   * Advances cooling and, if `fire`, returns the guns that fired this step
   * (usually 0 or 1 shot). Sets `justOverheated` when the lockout engages.
   */
  update(dt: number, fire: boolean): { shots: number[]; justOverheated: boolean; justRecovered: boolean } {
    const out = { shots: [] as number[], justOverheated: false, justRecovered: false };
    this.cooldown -= dt;
    const cool = this.stats.coolRate * (this.overheated ? 1.4 : 1) * dt;
    this.heat = Math.max(0, this.heat - cool);
    if (this.overheated && this.heat <= OVERHEAT_RECOVER) {
      this.overheated = false;
      out.justRecovered = true;
    }
    if (!fire || this.overheated) {
      if (this.cooldown < 0) this.cooldown = 0;
      return out;
    }
    while (this.cooldown <= 0 && !this.overheated) {
      out.shots.push(this.gun);
      this.gun ^= 1;
      this.cooldown += this.stats.fireInterval;
      this.heat += this.stats.heatPerShot;
      if (this.heat >= 1) {
        this.heat = 1;
        this.overheated = true;
        out.justOverheated = true;
      }
    }
    return out;
  }
}
