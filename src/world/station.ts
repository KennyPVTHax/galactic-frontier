import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode, Vector3 } from "../engine/babylon";
import { WORLD, stationPadPosition } from "../core/worldConfig";
import { GfMaterial, type MaterialLibrary } from "../graphics/materials";

/** Halcyon Dock: orbital station with a rotating habitat ring and a docking pad. */
export class Station {
  readonly root: TransformNode;
  readonly ring: TransformNode;
  readonly padPosition: Vector3;
  readonly center: Vector3;
  readonly meshes: Mesh[] = [];
  private readonly beacons: Mesh[] = [];
  private t = 0;

  constructor(scene: Scene, lib: MaterialLibrary) {
    const p = WORLD.station.position;
    this.center = new Vector3(p.x, p.y, p.z);
    const pad = stationPadPosition();
    this.padPosition = new Vector3(pad.x, pad.y, pad.z);

    const mat = (name: string, d: Color3, e = Color3.Black(), spec = 0.4) => {
      const m = new StandardMaterial(name, scene);
      m.diffuseColor = d;
      m.emissiveColor = e;
      m.specularColor = new Color3(spec, spec, spec);
      return m;
    };
    const metal = lib.make("st-metal", { albedo: new Color3(0.66, 0.66, 0.74), roughness: 0.4, metallic: 0.7, maps: "hull", mapScale: 5 });
    const dark = lib.make("st-dark", { albedo: new Color3(0.14, 0.13, 0.2), roughness: 0.5, metallic: 0.6, emissive: new Color3(0.02, 0.01, 0.04), maps: "hull", mapScale: 4 });
    const accent = lib.make("st-accent", { albedo: new Color3(0.45, 0.25, 0.9), roughness: 0.35, metallic: 0.3, emissive: new Color3(0.18, 0.08, 0.4) });
    const window = mat("st-window", Color3.Black(), new Color3(1, 0.78, 0.45));
    window.disableLighting = true;
    const solar = lib.make("st-solar", { albedo: new Color3(0.06, 0.08, 0.26), roughness: 0.15, metallic: 0.9, emissive: new Color3(0.03, 0.05, 0.18) });
    const cyan = mat("st-cyan", Color3.Black(), new Color3(0.2, 0.9, 1));
    cyan.disableLighting = true;
    const beacon = mat("st-beacon", Color3.Black(), new Color3(1, 0.35, 0.5));
    beacon.disableLighting = true;

    this.root = new TransformNode("halcyon", scene);
    this.root.position.copyFrom(this.center);
    const add = (m: Mesh, material: StandardMaterial | GfMaterial, parent: TransformNode = this.root) => {
      if (material instanceof StandardMaterial) m.material = material;
      else lib.bind(m, material);
      m.parent = parent;
      m.isPickable = false;
      this.meshes.push(m);
      return m;
    };

    // Core spine
    const core = add(MeshBuilder.CreateCylinder("st-core", { height: 34, diameter: 16, tessellation: 16 }, scene), metal);
    const capT = add(MeshBuilder.CreateSphere("st-capT", { diameter: 16, segments: 12, slice: 0.5 }, scene), dark);
    capT.position.y = 17;
    const capB = add(MeshBuilder.CreateCylinder("st-capB", { height: 10, diameterTop: 16, diameterBottom: 4, tessellation: 16 }, scene), dark);
    capB.position.y = -22;
    for (let i = 0; i < 4; i++) {
      const band = add(MeshBuilder.CreateTorus("st-band", { diameter: 16.4, thickness: 0.8, tessellation: 32 }, scene), i % 2 ? accent : dark);
      band.position.y = -12 + i * 8;
    }
    for (let i = 0; i < 12; i++) {
      const w = add(MeshBuilder.CreateBox("st-win", { width: 1.6, height: 0.6, depth: 0.3 }, scene), window);
      const a = (i / 12) * Math.PI * 2;
      w.position.set(Math.cos(a) * 8.05, -4 + (i % 3) * 6, Math.sin(a) * 8.05);
      w.rotation.y = -a + Math.PI / 2;
    }
    core.position.y = 0;

    // Rotating habitat ring
    this.ring = new TransformNode("st-ring", scene);
    this.ring.parent = this.root;
    add(MeshBuilder.CreateTorus("st-torus", { diameter: 82, thickness: 6.5, tessellation: 64 }, scene), metal, this.ring);
    for (const oy of [-1.6, 1.6]) {
      const glowRing = add(MeshBuilder.CreateTorus("st-torus-glow", { diameter: 82, thickness: 0.5, tessellation: 64 }, scene), cyan, this.ring);
      glowRing.position.y = oy;
      glowRing.scaling.set(1.07, 1, 1.07);
    }
    for (let i = 0; i < 6; i++) {
      const spoke = add(MeshBuilder.CreateBox("st-spoke", { width: 1.6, height: 1.6, depth: 33 }, scene), dark, this.ring);
      const a = (i / 6) * Math.PI * 2;
      spoke.position.set(Math.sin(a) * 24.5, 0, Math.cos(a) * 24.5);
      spoke.rotation.y = a;
    }

    // Solar arrays
    for (const s of [-1, 1]) {
      const mast = add(MeshBuilder.CreateBox("st-mast", { width: 38, height: 1, depth: 1 }, scene), dark);
      mast.position.set(s * 27, 26, 0);
      for (let k = 0; k < 3; k++) {
        const panel = add(MeshBuilder.CreateBox("st-panel", { width: 9, height: 0.25, depth: 22 }, scene), solar);
        panel.position.set(s * (14 + k * 10.5), 26, 0);
        panel.rotation.x = 0.35;
      }
    }
    const dish = add(MeshBuilder.CreateCylinder("st-dish", { height: 1.2, diameterTop: 9, diameterBottom: 2, tessellation: 24 }, scene), metal);
    dish.position.set(0, 31, -3);
    dish.rotation.x = -0.6;
    const ant = add(MeshBuilder.CreateCylinder("st-ant", { height: 14, diameter: 0.4 }, scene), dark);
    ant.position.y = 32;

    // Docking arm and pad (world-space offsets converted to local).
    const local = this.padPosition.subtract(this.center);
    const arm = add(MeshBuilder.CreateBox("st-arm", { width: 3.5, height: 2.5, depth: Math.abs(local.z) - 8 }, scene), dark);
    arm.position.set(local.x, local.y - 1.4, local.z / 2 - 2);
    const padM = add(MeshBuilder.CreateCylinder("st-pad", { height: 1.4, diameter: 22, tessellation: 32 }, scene), metal);
    padM.position.set(local.x, local.y - 0.7, local.z);
    const padTop = add(MeshBuilder.CreateCylinder("st-padtop", { height: 0.1, diameter: 20, tessellation: 32 }, scene), dark);
    padTop.position.set(local.x, local.y + 0.02, local.z);
    const padRing = add(MeshBuilder.CreateTorus("st-padring", { diameter: 16, thickness: 0.35, tessellation: 40 }, scene), cyan);
    padRing.position.set(local.x, local.y + 0.12, local.z);
    const padRing2 = add(MeshBuilder.CreateTorus("st-padring2", { diameter: 6, thickness: 0.25, tessellation: 24 }, scene), accent);
    padRing2.position.set(local.x, local.y + 0.12, local.z);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const b = add(MeshBuilder.CreateSphere("st-beacon", { diameter: 0.7 }, scene), beacon);
      b.position.set(local.x + Math.cos(a) * 10.4, local.y + 0.6, local.z + Math.sin(a) * 10.4);
      this.beacons.push(b);
    }
    const under = add(MeshBuilder.CreateCylinder("st-padunder", { height: 4, diameterTop: 14, diameterBottom: 3, tessellation: 24 }, scene), dark);
    under.position.set(local.x, local.y - 3.4, local.z);

    for (const m of this.meshes) if (m.parent === this.root) m.freezeWorldMatrix();
  }

  update(dt: number): void {
    this.t += dt;
    this.ring.rotation.y += dt * 0.05;
    this.beacons.forEach((b, i) => (b.isVisible = Math.sin(this.t * 3 - i * 0.9) > 0));
  }
}
