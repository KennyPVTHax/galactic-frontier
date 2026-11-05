/**
 * Original procedural enemy ship models.
 *
 * Each type's source geometry is built once from primitives and merged per
 * material slot (hull / accent / glass / glow) into hidden source meshes; every
 * live enemy is a TransformNode with one InstancedMesh per slot (one draw call
 * per slot per type regardless of ship count). Dreadnought hardpoints are
 * separate instanced parts on their own nodes so they can vanish when destroyed.
 *
 * Silhouettes (nose along +Z):
 *  - Skiff (scout): needle fuselage, drooping stub wings, single drive.
 *  - Lancet (interceptor): forward-swept wings, twin drives, ember canopy.
 *  - Bulwark (raider): wide armoured slab, side plates, spinal slug cannon, quad drives.
 *  - Cantor (hunter): bone orb inside a vertical halo with three blades and a violet eye.
 *  - Threnody (dreadnought): long cathedral hull with flying-buttress ribs, a central
 *    spire (shield generator), turret domes, seeker racks and a rear drone nave.
 */
import { Color3, InstancedMesh, Mesh, MeshBuilder, PBRMaterial, Scene, StandardMaterial, TransformNode, type Material } from "../engine/babylon";
import type { EnemyTypeId, FactionId } from "./ids";
import { ENEMY_TYPES, FACTIONS } from "./enemyTypes";

export type SlotKind = "hull" | "accent" | "glass" | "glow";
const SLOTS: SlotKind[] = ["hull", "accent", "glass", "glow"];

type HardpointKind = "turret" | "seeker" | "generator" | "hangar";

interface SourceSet {
  /** Hidden merged source meshes, one per used slot. */
  meshes: Mesh[];
}

export interface EnemyVisualNode {
  root: TransformNode;
  instances: InstancedMesh[];
  /** Glow (engine / eye) instances, flickered by the renderer. */
  glow: InstancedMesh[];
  hardpoints: Map<string, TransformNode>;
  dispose(): void;
}

export interface ModelOptions {
  /** PBR materials (profile.pbr) or Standard (Telegram Basic). Switch live with setPbr(). */
  pbr: boolean;
  /** 0 = low tessellation … 2 = high. */
  detail?: number;
}

const rgb = (c: [number, number, number], k = 1) => new Color3(c[0] * k, c[1] * k, c[2] * k);

class Builder {
  readonly parts: Record<SlotKind, Mesh[]> = { hull: [], accent: [], glass: [], glow: [] };
  constructor(
    readonly scene: Scene,
    readonly seg: number,
  ) {}
  add(kind: SlotKind, m: Mesh, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): Mesh {
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.scaling.set(sx, sy, sz);
    this.parts[kind].push(m);
    return m;
  }
  box(kind: SlotKind, w: number, h: number, d: number, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): Mesh {
    return this.add(kind, MeshBuilder.CreateBox("p", { width: w, height: h, depth: d }, this.scene), x, y, z, rx, ry, rz);
  }
  /** Cylinder lying along Z (top towards +Z). */
  tube(kind: SlotKind, len: number, dTop: number, dBot: number, x = 0, y = 0, z = 0, tess = this.seg, sx = 1, sy = 1): Mesh {
    const m = MeshBuilder.CreateCylinder("p", { height: len, diameterTop: dTop, diameterBottom: dBot, tessellation: tess }, this.scene);
    return this.add(kind, m, x, y, z, Math.PI / 2, 0, 0, sx, 1, sy);
  }
  sphere(kind: SlotKind, d: number, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1): Mesh {
    return this.add(kind, MeshBuilder.CreateSphere("p", { diameter: d, segments: Math.max(4, this.seg - 2) }, this.scene), x, y, z, 0, 0, 0, sx, sy, sz);
  }
  torus(kind: SlotKind, d: number, t: number, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): Mesh {
    return this.add(kind, MeshBuilder.CreateTorus("p", { diameter: d, thickness: t, tessellation: this.seg * 2 }, this.scene), x, y, z, rx, ry, rz);
  }
  disc(kind: SlotKind, r: number, x = 0, y = 0, z = 0, facingBack = true): Mesh {
    const m = MeshBuilder.CreateDisc("p", { radius: r, tessellation: this.seg + 4 }, this.scene);
    // Discs face -Z by default; engine nozzles look backwards.
    return this.add(kind, m, x, y, z, 0, facingBack ? 0 : Math.PI, 0);
  }
  cone(kind: SlotKind, h: number, d: number, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, tess = this.seg): Mesh {
    return this.add(kind, MeshBuilder.CreateCylinder("p", { height: h, diameterTop: 0, diameterBottom: d, tessellation: tess }, this.scene), x, y, z, rx, ry, rz);
  }
  oct(kind: SlotKind, size: number, x = 0, y = 0, z = 0, sy = 1): Mesh {
    return this.add(kind, MeshBuilder.CreatePolyhedron("p", { type: 1, size }, this.scene), x, y, z, 0, 0, 0, 1, sy, 1);
  }
}

function buildType(b: Builder, type: EnemyTypeId): void {
  switch (type) {
    case "scout": {
      b.tube("hull", 5.6, 0.25, 1.3, 0, 0, 0.6);
      b.tube("accent", 1.4, 1.3, 1.5, 0, 0, -2.6);
      for (const s of [-1, 1]) {
        b.box("hull", 2.8, 0.12, 1.4, s * 1.6, -0.35, -1.0, 0, s * -0.25, s * -0.4);
        b.box("accent", 0.14, 0.7, 1.0, s * 2.9, -0.95, -1.4);
      }
      b.box("accent", 0.12, 1.0, 1.4, 0, 0.7, -2.2, -0.3);
      b.disc("glow", 0.55, 0, 0, -3.32);
      b.sphere("glow", 0.32, 0, 0.18, 3.2);
      b.sphere("glass", 0.6, 0, 0.45, 0.8, 1, 0.7, 2.2);
      break;
    }
    case "interceptor": {
      b.tube("hull", 7.5, 0.4, 1.6, 0, 0, 0.8, b.seg, 1.15, 0.8);
      b.tube("hull", 2.2, 1.6, 1.9, 0, 0, -3.8, b.seg, 1.15, 0.8);
      for (const s of [-1, 1]) {
        // Forward-swept wing: root aft, tip forward.
        b.box("hull", 4.6, 0.16, 1.7, s * 2.6, -0.1, 0.4, 0, s * 0.55, s * 0.06);
        b.box("accent", 4.4, 0.18, 0.3, s * 2.4, -0.08, 1.3, 0, s * 0.55, s * 0.06);
        b.box("accent", 0.18, 1.1, 1.2, s * 4.5, 0.25, 1.9);
        b.tube("hull", 2.8, 0.7, 0.9, s * 1.15, -0.2, -3.6, b.seg);
        b.disc("glow", 0.38, s * 1.15, -0.2, -5.02);
      }
      b.sphere("glow", 0.7, 0, 0.55, 1.7, 1, 0.6, 2.4);
      b.box("accent", 0.12, 1.3, 1.6, 0, 0.9, -3.4, -0.4);
      break;
    }
    case "raider": {
      b.box("hull", 9, 3.8, 16, 0, 0, 0);
      b.box("hull", 6, 2.4, 5, 0, 0.6, 9.2, 0.2);
      b.box("accent", 9.4, 0.5, 15, 0, 2.0, -0.5);
      for (const s of [-1, 1]) {
        b.box("accent", 1.0, 4.4, 12, s * 5.1, -0.2, 0.2);
        b.box("hull", 2.8, 2.2, 8, s * 6.4, -1.4, -3, 0, 0, s * 0.25);
        for (const y of [-0.9, 0.9]) {
          b.tube("hull", 2.4, 1.3, 1.6, s * 2.6, y, -9, b.seg);
          b.disc("glow", 0.62, s * 2.6, y, -10.22);
        }
      }
      b.tube("accent", 9, 0.8, 1.1, 0, 2.9, 5.5, b.seg);
      b.box("hull", 2.4, 1.6, 3.2, 0, 2.8, 0.8);
      b.box("glass", 3.2, 0.7, 1.2, 0, 1.6, 11.4, 0.25);
      b.sphere("glow", 0.5, 0, 2.9, 10.1);
      break;
    }
    case "hunter": {
      b.sphere("hull", 3.0, 0, 0, 0, 1, 1, 1.25);
      b.torus("accent", 5.6, 0.35, 0, 0, -0.3, 0, 0, Math.PI / 2);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
        b.box("hull", 0.18, 2.4, 3.2, Math.cos(a) * 2.6, Math.sin(a) * 2.6, -0.8, 0, 0, a + Math.PI / 2);
      }
      b.sphere("glow", 1.0, 0, 0, 1.7, 1, 1, 0.5);
      b.disc("glow", 0.6, 0, 0, -1.9);
      b.tube("hull", 1.4, 0.8, 1.4, 0, 0, -1.6, b.seg);
      break;
    }
    case "dreadnought": {
      // Nave: long tapered hull.
      b.tube("hull", 60, 14, 22, 0, 0, 0, b.seg, 1.25, 0.6);
      b.cone("hull", 14, 14, 0, 0, 37, Math.PI / 2, 0, 0, b.seg);
      b.box("accent", 4, 3, 56, 0, 6.8, 0);
      // Flying-buttress ribs.
      for (let i = 0; i < 5; i++) {
        const z = -22 + i * 11;
        b.torus("accent", 26 - i * 1.2, 1.1, 0, 1, z, Math.PI / 2, 0, 0);
      }
      for (const s of [-1, 1]) {
        b.box("hull", 6, 3, 34, s * 15, -2, -4, 0, 0, s * 0.35);
        b.box("accent", 1.2, 8, 30, s * 18.5, -1, -4);
        for (const y of [-3, 3]) {
          b.tube("hull", 7, 5, 6, s * 8, y, -31, b.seg);
          b.disc("glow", 2.4, s * 8, y, -34.6);
        }
        // Rows of violet "windows".
        for (let k = 0; k < 6; k++) b.box("glow", 0.3, 1.2, 2.2, s * 13.6, 2.5, -18 + k * 7);
      }
      // Spire base (the generator crystal sits on top as a hardpoint).
      b.cone("hull", 16, 7, 0, 10, -6, 0, 0, 0, b.seg);
      b.sphere("glow", 2.2, 0, 2, 33);
      break;
    }
  }
}

function buildHardpoint(b: Builder, kind: HardpointKind): void {
  switch (kind) {
    case "turret":
      b.sphere("hull", 6, 0, 0, 0, 1, 0.65, 1);
      b.tube("accent", 6, 0.8, 1.1, -0.9, 0.8, 3);
      b.tube("accent", 6, 0.8, 1.1, 0.9, 0.8, 3);
      b.sphere("glow", 1.2, 0, 1.2, 2.2);
      break;
    case "seeker":
      b.box("hull", 7, 4, 8);
      for (let i = 0; i < 3; i++) b.box("glow", 1.4, 1.0, 0.3, -2.2 + i * 2.2, 0.6, 4.05);
      b.box("accent", 7.4, 0.6, 8.4, 0, 2.1, 0);
      break;
    case "generator":
      b.oct("glow", 4.2, 0, 2, 0, 1.6);
      b.torus("accent", 9, 0.6, 0, 0, 0);
      b.torus("accent", 7, 0.4, 0, 3.5, 0, 0.4, 0, 0);
      break;
    case "hangar":
      b.box("hull", 12, 7, 10);
      b.box("glow", 8, 4.2, 0.3, 0, -0.5, -5.1);
      b.box("accent", 12.6, 1, 10.6, 0, 3.6, 0);
      break;
  }
}

/** Shared source meshes + materials for every enemy type; build lazily, dispose once. */
export class EnemyModelLibrary {
  private readonly sources = new Map<string, SourceSet>();
  private readonly mats = new Map<string, Material>();
  private readonly owned: Mesh[] = [];
  private pbr: boolean;
  private readonly live = new Set<EnemyVisualNode>();
  private seq = 0;

  constructor(
    private readonly scene: Scene,
    private readonly opts: ModelOptions,
  ) {
    this.pbr = opts.pbr;
  }

  /** Material for a faction slot in the current mode (Standard for Basic, PBR otherwise). */
  private material(faction: FactionId | "ally", slot: SlotKind, pbr = this.pbr): Material {
    const key = `${faction}:${slot}:${slot === "glow" ? "std" : pbr ? "pbr" : "std"}`;
    const cached = this.mats.get(key);
    if (cached) return cached;
    const f =
      faction === "ally"
        ? { hull: [0.72, 0.74, 0.8] as [number, number, number], accent: [0.2, 0.55, 0.75] as [number, number, number], glow: [0.3, 0.9, 1] as [number, number, number] }
        : FACTIONS[faction];
    let m: Material;
    if (slot === "glow") {
      const s = new StandardMaterial(`gf-enemy-${key}`, this.scene);
      s.emissiveColor = rgb(f.glow, 1.15);
      s.diffuseColor = new Color3(0, 0, 0);
      s.specularColor = new Color3(0, 0, 0);
      s.disableLighting = true;
      m = s;
    } else {
      const albedo = slot === "hull" ? rgb(f.hull) : slot === "accent" ? rgb(f.accent) : new Color3(0.03, 0.03, 0.05);
      const rough = slot === "glass" ? 0.08 : slot === "hull" ? 0.45 : 0.35;
      const metal = slot === "glass" ? 0.9 : slot === "hull" ? 0.55 : 0.4;
      const emissive = slot === "glass" ? rgb(f.glow, 0.25) : slot === "accent" ? rgb(f.accent, 0.12) : new Color3(0.02, 0.02, 0.025);
      if (pbr) {
        const p = new PBRMaterial(`gf-enemy-${key}`, this.scene);
        p.albedoColor = albedo.toLinearSpace();
        p.roughness = rough;
        p.metallic = metal;
        p.emissiveColor = emissive.toLinearSpace().scale(1.6);
        p.environmentIntensity = 1.2;
        m = p;
      } else {
        const s = new StandardMaterial(`gf-enemy-${key}`, this.scene);
        s.diffuseColor = albedo;
        s.specularColor = Color3.Lerp(new Color3(1, 1, 1), albedo, metal).scale((1 - rough) * 0.6);
        s.specularPower = 48;
        s.emissiveColor = emissive;
        m = s;
      }
    }
    this.mats.set(key, m);
    return m;
  }

  /** Switch lit materials between PBR (Enhanced / Ultra) and Standard (Basic) live. */
  setPbr(pbr: boolean): void {
    if (pbr === this.pbr) return;
    this.pbr = pbr;
    for (const set of this.sources.values()) for (const m of set.meshes) {
      const md = m.metadata as { slot: SlotKind; faction: FactionId | "ally" };
      m.material = this.material(md.faction, md.slot);
    }
  }

  private build(key: string, faction: FactionId | "ally", fill: (b: Builder) => void): SourceSet {
    const cached = this.sources.get(key);
    if (cached) return cached;
    const detail = this.opts.detail ?? 1;
    const b = new Builder(this.scene, detail >= 2 ? 16 : detail >= 1 ? 12 : 8);
    fill(b);
    const set: SourceSet = { meshes: [] };
    for (const slot of SLOTS) {
      const parts = b.parts[slot];
      if (!parts.length) continue;
      const merged = parts.length === 1 ? parts[0] : Mesh.MergeMeshes(parts, true, true);
      if (!merged) continue;
      if (parts.length === 1) merged.bakeCurrentTransformIntoVertices();
      merged.name = `gf-enemy-src-${key}-${slot}`;
      merged.isPickable = false;
      merged.isVisible = false; // source hidden; instances render
      merged.metadata = { slot, faction };
      merged.material = this.material(faction, slot);
      set.meshes.push(merged);
      this.owned.push(merged);
    }
    this.sources.set(key, set);
    return set;
  }

  /** Builds (once) the source geometry for a type; useful for warm-up. */
  prepare(type: EnemyTypeId): void {
    const def = ENEMY_TYPES[type];
    this.build(type, def.faction, (b) => buildType(b, type));
    for (const h of def.hardpoints ?? []) this.build(`hp-${h.kind}`, def.faction, (b) => buildHardpoint(b, h.kind));
  }

  private instance(set: SourceSet, parent: TransformNode, name: string, out: EnemyVisualNode): void {
    for (const src of set.meshes) {
      const inst = src.createInstance(`${name}-${(src.metadata as { slot: string }).slot}`);
      inst.parent = parent;
      inst.isPickable = false;
      out.instances.push(inst);
      if ((src.metadata as { slot: string }).slot === "glow") out.glow.push(inst);
    }
  }

  instantiate(type: EnemyTypeId): EnemyVisualNode {
    this.prepare(type);
    const def = ENEMY_TYPES[type];
    const name = `gf-enemy-${type}-${++this.seq}`;
    const root = new TransformNode(name, this.scene);
    const node: EnemyVisualNode = {
      root,
      instances: [],
      glow: [],
      hardpoints: new Map(),
      dispose: () => {
        for (const i of node.instances) i.dispose();
        for (const h of node.hardpoints.values()) h.dispose();
        root.dispose();
        node.instances.length = 0;
        this.live.delete(node);
      },
    };
    this.instance(this.sources.get(type)!, root, name, node);
    for (const h of def.hardpoints ?? []) {
      const hp = new TransformNode(`${name}-${h.id}`, this.scene);
      hp.parent = root;
      hp.position.set(h.offset[0], h.offset[1], h.offset[2]);
      if (h.kind === "turret") hp.rotation.y = h.offset[2] < 0 ? Math.PI : 0;
      this.instance(this.sources.get(`hp-${h.kind}`)!, hp, `${name}-${h.id}`, node);
      node.hardpoints.set(h.id, hp);
    }
    this.live.add(node);
    return node;
  }

  /** Simple friendly freighter / platform for escort & defence missions. */
  instantiateAlly(kind: "freighter" | "station"): EnemyVisualNode {
    const key = `ally-${kind}`;
    this.build(key, "ally", (b) => {
      if (kind === "freighter") {
        b.box("hull", 7, 6, 22, 0, 0, 0);
        b.box("accent", 7.4, 1, 18, 0, 3.4, -1);
        for (const s of [-1, 1]) b.box("hull", 3, 4, 14, s * 5, -0.5, -2);
        b.box("glass", 4, 1.4, 2, 0, 2.2, 11);
        for (const s of [-1, 1]) {
          b.tube("hull", 3, 2, 2.4, s * 2.4, 0, -12);
          b.disc("glow", 1, s * 2.4, 0, -13.6);
        }
      } else {
        b.torus("hull", 60, 6, 0, 0, 0);
        b.sphere("hull", 22, 0, 0, 0, 1, 0.6, 1);
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2;
          b.box("accent", 4, 4, 28, Math.cos(a) * 15, 0, Math.sin(a) * 15, 0, -a + Math.PI / 2, 0);
          b.sphere("glow", 3, Math.cos(a) * 30, 2, Math.sin(a) * 30);
        }
      }
    });
    const name = `gf-ally-${kind}-${++this.seq}`;
    const root = new TransformNode(name, this.scene);
    const node: EnemyVisualNode = {
      root,
      instances: [],
      glow: [],
      hardpoints: new Map(),
      dispose: () => {
        for (const i of node.instances) i.dispose();
        root.dispose();
        node.instances.length = 0;
        this.live.delete(node);
      },
    };
    this.instance(this.sources.get(key)!, root, name, node);
    this.live.add(node);
    return node;
  }

  dispose(): void {
    for (const n of [...this.live]) n.dispose();
    for (const o of this.owned) o.dispose();
    for (const m of this.mats.values()) m.dispose();
    this.owned.length = 0;
    this.sources.clear();
    this.mats.clear();
  }
}
