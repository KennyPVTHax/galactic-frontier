/**
 * Test-only hooks (window.__GF). Imported by game.ts behind the build-time __GF_DEBUG__ flag:
 * release bundles (web preview, Android) are built with it false, so none of this ships there.
 */
import { Vector3 } from "../engine/babylon";
import { clamp } from "./random";
import { ENEMY_TYPES } from "../combat/enemyTypes";
import type { ResourceId } from "../gameplay/resources";
import type { GraphicsTier } from "../graphics/profiles";
import type { PlanetId } from "../universe/types";

export function installDebugHooks(g: any): void {
  (window as any).__GF = {
    game: g,
    state: () => ({
      mode: g.mode,
      ship: { state: g.ship.state, x: g.ship.x, y: g.ship.y, z: g.ship.z, speed: g.ship.speed, hull: g.ship.hull, agl: g.ship.agl(g.shipEnv) },
      player: { x: g.player.position.x, y: g.player.position.y, z: g.player.position.z, grounded: g.player.grounded, jetFuel: g.player.jetFuel },
      inventory: g.inventory.snapshot(),
      laser: { energy: g.laser.energy, heat: g.laser.heat, overheated: g.laser.overheated },
      mission: g.mission.state,
      quality: g.qualityLevel,
      tier: g.tierDecision.tier,
      tierReason: g.tierDecision.reason,
      platform: g.platform.kind,
      orientation: g.orientationState,
      perf: g.renderer.stats(),
      world: g.planet.stats(),
      panel: g.hud.panel,
      tagged: g.tagged.size,
      target: g.currentTarget?.id ?? null,
      planet: g.planetId,
      combat: {
        enemies: g.combat.enemies().filter((e: any) => e.alive).map((e: any) => ({ id: e.id, type: e.type, name: ENEMY_TYPES[e.type as keyof typeof ENEMY_TYPES].name, state: e.state, x: e.pos.x, y: e.pos.y, z: e.pos.z })),
        shield: g.combat.playerShield,
        maxShield: g.combat.playerMaxShield,
        heat: g.combat.playerHeat,
        shotsFired: g.combatStats.shots,
        hitsLanded: g.combatStats.hits,
        kills: g.combatStats.kills,
        projectiles: g.combat.projectiles().length,
      },
      warping: g.warp ? g.warp.phase : null,
      contract: g.contracts.summary(),
      contractsCompleted: [...g.contracts.state.completed],
      xp: g.progression.state.xp,
      achievements: [...g.progression.state.achievements],
      suit: g.suit.integrity,
      fps: g.engine.getFps(),
      drawCalls: (g.engine as any)._drawCalls?.current ?? null,
      activeMeshes: g.scene.getActiveMeshes().length,
    }),
    teleportShip: (x: number, y: number, z: number, yaw = g.ship.yaw) => Object.assign(g.ship, { x, y, z, yaw, speed: 0, throttle: 0, pitch: 0 }),
    teleportPlayer: (x: number, z: number) => g.player.place(x, z, g.planet, g.player.facing),
    give: (id: ResourceId, n: number) => {
      const got = g.inventory.add(id, n);
      g.missionEvent({ type: "collected", resource: id, amount: got });
      return got;
    },
    /** Stand next to the nearest deposit of a type and aim the camera at it. */
    approach: (type: ResourceId) => {
      const p = g.player.position;
      const list = g.planet.deposits.filter((d: any) => d.type === type && d.amount > 0).sort((a: any, b: any) => Vector3.Distance(a.position, p) - Vector3.Distance(b.position, p));
      const d = list[0];
      if (!d) return null;
      const away = p.subtract(d.position);
      away.y = 0;
      away.normalize().scaleInPlace(d.radius + 3.5);
      g.player.place(d.position.x + away.x, d.position.z + away.z, g.planet, 0);
      const to = d.position.subtract(g.player.position.add(new Vector3(0, 1.65, 0)));
      g.rig.yaw = Math.atan2(to.x, to.z);
      g.rig.pitch = clamp(-Math.atan2(to.y, Math.hypot(to.x, to.z)) + 0.12, -0.5, 1.1);
      return d.id;
    },
    setTimeScale: (s: number) => (g.timeScale = s),
    setTier: (t: GraphicsTier | "auto") => {
      g.prefs.graphics = t;
      g.applyGraphics();
      return g.tierDecision.tier;
    },
    setAdaptive: (on: boolean) => {
      g.prefs.adaptive = on;
      g.renderer.governor.enabled = on;
    },
    save: () => g.save(),
    warpNow: (id: PlanetId) => {
    const from = g.planetId;
    if (g.mode === "onFoot") g.enterShip(false);
    g.warp = null;
    g.hud.setWarp(null);
    g.arriveAt(id);
    g.onArrived(from);
  },
    /** Test helper: point the Wayfarer's nose at the locked/nearest hostile (mouse aiming is impractical at 2 fps). */
    aimAtTarget: () => {
      const tgt = g.combat.target();
      const e = tgt?.enemy ?? g.combat.enemies().find((x: any) => x.alive);
      if (!e) return false;
      const dx = e.pos.x - g.ship.x, dy = e.pos.y - g.ship.y, dz = e.pos.z - g.ship.z;
      g.ship.yaw = Math.atan2(dx, dz);
      g.ship.pitch = Math.atan2(dy, Math.hypot(dx, dz));
      return true;
    },
    spawnEncounter: (id: string) => g.spawnContractEncounter(id),
    startWarp: (id: PlanetId) => g.startWarp(id),
  };
}
