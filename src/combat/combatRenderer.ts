/**
 * CombatRenderer: mirrors CombatSystem state into Babylon each frame and turns
 * combat events into effects. Owns every mesh/material/particle system it makes
 * and frees them in dispose().
 *
 *   const renderer = new CombatRenderer(scene, { pbr: profile.pbr, detail });
 *   // per frame, after combat.update():
 *   renderer.onEvents(events);
 *   renderer.sync(combat, dt, camera.position);
 */
import type { Scene } from "../engine/babylon";
import type { Enemy } from "./ai";
import type { CombatSystem } from "./combatSystem";
import { CombatFx, type CombatFxBudget, type Rgb } from "./combatFx";
import { EnemyModelLibrary, type EnemyVisualNode } from "./enemyModels";
import { ENEMY_TYPES, FACTIONS } from "./enemyTypes";
import type { CombatEvent } from "./events";
import type { BoltKind } from "./weapons";
import { WEAPONS } from "./weapons";
import type { Vec3 } from "./vec";

export interface CombatRendererOptions {
  /** profile.pbr: PBR enemy materials (Enhanced / Ultra) or Standard (Basic). */
  pbr?: boolean;
  /** 0 basic … 2 ultra (tessellation, particles, debris). */
  detail?: number;
  /** Explosion flash point lights (0 on Basic; fixed at construction to avoid shader recompiles). */
  lights?: number;
  budget?: Partial<CombatFxBudget>;
  /** Enemies farther than this from the camera are hidden (m). */
  cullDistance?: number;
}

interface EnemyRecord {
  enemy: Enemy;
  node: EnemyVisualNode;
  phase: number;
}

const SHIELD_TINT: Record<string, Rgb> = { ashveil: [1.0, 0.62, 0.25], hollowChoir: [0.7, 0.45, 1.2] };
const KIND_TINT: Record<BoltKind, Rgb> = { pulse: [0.45, 1.1, 1.35], laser: [1.4, 0.45, 0.15], choir: [0.95, 0.5, 1.5], heavy: [1.5, 0.85, 0.3], seeker: [1.5, 0.45, 1.0] };
const TELEGRAPH_SIZE: Record<BoltKind, number> = { pulse: 1.5, laser: 2.2, choir: 2.6, heavy: 4.2, seeker: 6 };

export class CombatRenderer {
  readonly models: EnemyModelLibrary;
  readonly fx: CombatFx;
  private readonly enemyVis = new Map<string, EnemyRecord>();
  private readonly allyVis = new Map<string, { node: EnemyVisualNode; pos: Vec3 }>();
  private readonly enemyRefs = new Map<string, Enemy>();
  private t = 0;
  private cull: number;
  private playerPos: Vec3 | null = null;
  private disposed = false;

  constructor(
    private readonly scene: Scene,
    opts: CombatRendererOptions = {},
  ) {
    const detail = opts.detail ?? 1;
    this.models = new EnemyModelLibrary(scene, { pbr: !!opts.pbr, detail });
    this.fx = new CombatFx(scene, { lights: opts.lights ?? (detail >= 1 ? 1 : 0), budget: { detail, ...(opts.budget ?? {}) } });
    this.cull = opts.cullDistance ?? 2400;
  }

  setBudget(b: Partial<CombatFxBudget>): void {
    this.fx.setBudget(b);
  }

  setPbr(pbr: boolean): void {
    this.models.setPbr(pbr);
  }

  /** Optional warm-up: builds source meshes so the first spawn doesn't hitch. */
  prepare(types: (keyof typeof ENEMY_TYPES)[]): void {
    for (const t of types) this.models.prepare(t);
  }

  sync(combat: CombatSystem, dt: number, cameraPos: Vec3): void {
    if (this.disposed) return;
    this.t += dt;
    this.playerPos = combat.playerPosition;
    const seen = new Set<string>();
    for (const e of combat.enemies()) {
      if (!e.alive) continue;
      seen.add(e.id);
      let rec = this.enemyVis.get(e.id);
      if (!rec) {
        rec = { enemy: e, node: this.models.instantiate(e.type), phase: 0 };
        this.enemyVis.set(e.id, rec);
      }
      this.enemyRefs.set(e.id, e);
      const root = rec.node.root;
      const dx = e.pos.x - cameraPos.x, dy = e.pos.y - cameraPos.y, dz = e.pos.z - cameraPos.z;
      const visible = dx * dx + dy * dy + dz * dz < this.cull * this.cull;
      root.setEnabled(visible);
      if (!visible) continue;
      root.position.set(e.pos.x, e.pos.y, e.pos.z);
      root.rotation.set(-e.pitch, e.yaw, e.roll);
      if (e.boss) for (const h of e.boss.hardpoints) rec.node.hardpoints.get(h.id)?.setEnabled(h.alive);
      // Engine / eye flicker; charging weapons swell the glow as a telegraph.
      const charge = e.charging ? 0.35 : 0;
      const hash = e.id.length * 1.7 + e.id.charCodeAt(e.id.length - 1);
      const k = 1 + Math.sin(this.t * 31 + hash) * 0.05 + Math.sin(this.t * 13 + hash * 2) * 0.04 + charge;
      for (const g of rec.node.glow) g.scaling.set(k, k, k);
    }
    for (const [id, rec] of this.enemyVis) {
      if (!seen.has(id)) {
        rec.node.dispose();
        this.enemyVis.delete(id);
      }
    }
    for (const id of [...this.enemyRefs.keys()]) if (!seen.has(id)) this.enemyRefs.delete(id);

    const aseen = new Set<string>();
    for (const a of combat.allies()) {
      if (!a.alive) continue;
      aseen.add(a.id);
      let rec = this.allyVis.get(a.id);
      if (!rec) {
        rec = { node: this.models.instantiateAlly(a.kind), pos: a.pos };
        this.allyVis.set(a.id, rec);
      }
      rec.node.root.position.set(a.pos.x, a.pos.y, a.pos.z);
      rec.node.root.rotation.y = a.yaw;
    }
    for (const [id, rec] of this.allyVis) {
      if (!aseen.has(id)) {
        rec.node.dispose();
        this.allyVis.delete(id);
      }
    }

    this.fx.drawBolts(combat.projectiles(), cameraPos);
    this.fx.update(dt);
  }

  onEvents(events: readonly CombatEvent[]): void {
    if (this.disposed) return;
    const fx = this.fx;
    for (const ev of events) {
      switch (ev.type) {
        case "playerFired":
          fx.flash(ev.position, 1.7, KIND_TINT.pulse, 0.06);
          break;
        case "enemyTelegraph": {
          const kind = WEAPONS[ev.weapon].kind;
          const e = this.enemyRefs.get(ev.id);
          const follow = e ? (ev.hardpoint && e.boss ? (e.boss.hardpoint(ev.hardpoint)?.world ?? null) : e.pos) : null;
          fx.flash(ev.position, TELEGRAPH_SIZE[kind], KIND_TINT[kind], Math.max(0.15, ev.duration), true, follow);
          break;
        }
        case "enemyFired":
          fx.flash(ev.position, ev.kind === "heavy" || ev.kind === "seeker" ? 3 : 1.4, KIND_TINT[ev.kind], 0.07);
          break;
        case "enemyShieldHit": {
          const e = this.enemyRefs.get(ev.id);
          if (e) fx.ripple(e.pos, e.def.radius * 1.3, SHIELD_TINT[e.faction] ?? [0.6, 0.8, 1], e.pos);
          fx.flash(ev.point, 1.2, [1, 0.9, 0.7], 0.08);
          break;
        }
        case "enemyHit":
          fx.sparks(ev.point, ev.hardpoint ? 18 : 12);
          fx.flash(ev.point, 1.4, [1.3, 0.8, 0.4], 0.08);
          break;
        case "enemyDestroyed": {
          const def = ENEMY_TYPES[ev.enemyType];
          const glow = FACTIONS[def.faction].glow;
          fx.explode(ev.position, ev.radius, [Math.min(1, 0.6 + glow[0] * 0.4), Math.min(1, 0.4 + glow[1] * 0.3), Math.min(1, 0.15 + glow[2] * 0.25)], ev.enemyType === "dreadnought" ? 7 : ev.enemyType === "raider" ? 2 : 0);
          break;
        }
        case "hardpointDestroyed":
          fx.explode(ev.position, 6, [1, 0.6, 0.3], 1);
          break;
        case "playerShieldHit":
          fx.ripple(this.playerPos ?? ev.point, 6.5, [0.35, 0.85, 1.2], this.playerPos);
          break;
        case "playerHullDamage":
          fx.sparks(ev.point, 16, [1, 0.6, 0.25]);
          break;
        case "groundImpact":
          fx.sparks(ev.point, 8, KIND_TINT[ev.kind]);
          fx.flash(ev.point, 1.4, KIND_TINT[ev.kind], 0.1);
          break;
        case "allyHit":
          fx.sparks(ev.point, 10);
          break;
        case "allyDestroyed":
          fx.explode(ev.position, 14, [1, 0.6, 0.3], 3);
          break;
      }
    }
  }

  /** Number of live enemy visuals (tests). */
  get visualCount(): number {
    return this.enemyVis.size + this.allyVis.size;
  }

  clear(): void {
    for (const r of this.enemyVis.values()) r.node.dispose();
    for (const r of this.allyVis.values()) r.node.dispose();
    this.enemyVis.clear();
    this.allyVis.clear();
    this.enemyRefs.clear();
    this.fx.clear();
  }

  dispose(): void {
    if (this.disposed) return;
    this.clear();
    this.models.dispose();
    this.fx.dispose();
    this.disposed = true;
    void this.scene;
  }
}
