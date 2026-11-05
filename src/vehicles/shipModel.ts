import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode } from "../engine/babylon";
import { GfMaterial, type MaterialLibrary } from "../graphics/materials";

/** Original starter ship "Wayfarer": built from primitives, ~10 m long, nose along +Z. */
export class ShipModel {
  readonly root: TransformNode;
  readonly meshes: Mesh[] = [];
  private readonly flames: Mesh[] = [];
  private readonly gear: TransformNode;
  private readonly lights: Mesh[] = [];
  private t = 0;

  readonly nozzles: TransformNode[] = [];

  constructor(scene: Scene, lib: MaterialLibrary) {
    // The chase camera sees the ship from behind, usually away from the sun, so the ship gets a stronger sky fill.
    const hull = lib.make("ship-hull", { albedo: new Color3(0.86, 0.87, 0.92), roughness: 0.35, metallic: 0.55, maps: "hull", mapScale: 1.5, envIntensity: 1.7 });
    // Gunmetal rather than near-black. Albedo is sRGB and converted to linear for PBR, so 0.12 (M1) meant ~1.3%
    // reflectance: the rear bulkhead and engine pods rendered flat black whenever they faced away from the sun.
    const dark = lib.make("ship-dark", { albedo: new Color3(0.5, 0.51, 0.58), roughness: 0.5, metallic: 0.35, maps: "hull", mapScale: 2, envIntensity: 1.7, emissive: new Color3(0.035, 0.035, 0.05) });
    const accent = lib.make("ship-accent", { albedo: new Color3(0.45, 0.25, 0.9), roughness: 0.3, metallic: 0.4, emissive: new Color3(0.08, 0.03, 0.2), envIntensity: 1.7 });
    const glass = lib.make("ship-glass", { albedo: new Color3(0.02, 0.05, 0.08), roughness: 0.03, metallic: 1, emissive: new Color3(0.04, 0.25, 0.36) });
    const glow = new StandardMaterial("ship-glow", scene);
    glow.emissiveColor = new Color3(0.3, 0.9, 1);
    glow.disableLighting = true;
    const flame = new StandardMaterial("ship-flame", scene);
    flame.emissiveColor = new Color3(0.5, 0.85, 1);
    flame.disableLighting = true;
    flame.alpha = 0.7;
    const nav = new StandardMaterial("ship-nav", scene);
    nav.emissiveColor = new Color3(0.85, 0.4, 1);
    nav.disableLighting = true;

    this.root = new TransformNode("wayfarer", scene);
    const add = (m: Mesh, mat: StandardMaterial | GfMaterial, parent: TransformNode = this.root) => {
      if (mat instanceof StandardMaterial) m.material = mat;
      else lib.bind(m, mat);
      m.parent = parent;
      m.isPickable = false;
      this.meshes.push(m);
      return m;
    };

    // Fuselage: tapered octagonal body lying along Z.
    const body = add(MeshBuilder.CreateCylinder("ship-body", { height: 7.2, diameterTop: 1.3, diameterBottom: 2.5, tessellation: 8, subdivisions: 4 }, scene), hull);
    body.rotation.x = Math.PI / 2;
    body.scaling.x = 1.25;
    const nose = add(MeshBuilder.CreateCylinder("ship-nose", { height: 2.4, diameterTop: 0.05, diameterBottom: 1.3, tessellation: 8 }, scene), hull);
    nose.rotation.x = Math.PI / 2;
    nose.position.z = 4.8;
    nose.scaling.x = 1.25;
    const tail = add(MeshBuilder.CreateCylinder("ship-tail", { height: 1.2, diameterTop: 2.5, diameterBottom: 2.0, tessellation: 8 }, scene), dark);
    tail.rotation.x = Math.PI / 2;
    tail.position.z = -4.2;
    tail.scaling.x = 1.25;

    const canopy = add(MeshBuilder.CreateSphere("ship-canopy", { diameter: 1, segments: 24 }, scene), glass);
    canopy.scaling.set(1.15, 0.7, 2.6);
    canopy.position.set(0, 0.75, 1.6);

    const stripe = add(MeshBuilder.CreateBox("ship-stripe", { width: 0.25, height: 0.08, depth: 6.5 }, scene), accent);
    stripe.position.set(0, 1.08, -0.6);

    // Swept wings with dihedral and tip lights.
    for (const s of [-1, 1]) {
      const wing = add(MeshBuilder.CreateBox("ship-wing", { width: 4.4, height: 0.16, depth: 2.4 }, scene), hull);
      wing.position.set(s * 2.9, -0.15, -1.2);
      wing.rotation.y = s * -0.42;
      wing.rotation.z = s * 0.1;
      const edge = add(MeshBuilder.CreateBox("ship-wing-edge", { width: 4.2, height: 0.18, depth: 0.3 }, scene), accent);
      edge.position.set(s * 2.75, -0.13, -0.1);
      edge.rotation.y = s * -0.42;
      edge.rotation.z = s * 0.1;
      const tip = add(MeshBuilder.CreateBox("ship-tip", { width: 0.2, height: 0.9, depth: 1.2 }, scene), dark);
      tip.position.set(s * 4.9, 0.2, -2.1);
      const tl = add(MeshBuilder.CreateSphere("ship-tiplight", { diameter: 0.22 }, scene), nav);
      tl.position.set(s * 4.95, 0.7, -2.1);
      this.lights.push(tl);

      // Engine pods
      const pod = add(MeshBuilder.CreateCylinder("ship-pod", { height: 3.6, diameterTop: 0.9, diameterBottom: 1.15, tessellation: 12 }, scene), dark);
      pod.rotation.x = Math.PI / 2;
      pod.position.set(s * 1.75, -0.1, -3.0);
      const ring = add(MeshBuilder.CreateTorus("ship-pod-ring", { diameter: 1.1, thickness: 0.12, tessellation: 20 }, scene), accent);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(s * 1.75, -0.1, -2.2);
      const nozzle = add(MeshBuilder.CreateDisc("ship-nozzle", { radius: 0.42, tessellation: 16 }, scene), glow);
      nozzle.position.set(s * 1.75, -0.1, -4.82);
      const fl = add(MeshBuilder.CreateCylinder("ship-flame", { height: 1, diameterTop: 0.75, diameterBottom: 0.0, tessellation: 12 }, scene), flame);
      fl.rotation.x = Math.PI / 2;
      fl.position.set(s * 1.75, -0.1, -5.3);
      this.flames.push(fl);
      const nz = new TransformNode("ship-nozzle-pt", scene);
      nz.parent = this.root;
      nz.position.set(s * 1.75, -0.1, -4.9);
      this.nozzles.push(nz);
    }
    const fin = add(MeshBuilder.CreateBox("ship-fin", { width: 0.16, height: 1.7, depth: 2.2 }, scene), hull);
    fin.position.set(0, 1.3, -3.2);
    fin.rotation.x = -0.35;
    const finLight = add(MeshBuilder.CreateSphere("ship-finlight", { diameter: 0.2 }, scene), nav);
    finLight.position.set(0, 2.1, -3.7);
    this.lights.push(finLight);

    // Landing skids (retract in flight).
    this.gear = new TransformNode("ship-gear", scene);
    this.gear.parent = this.root;
    for (const s of [-1, 1]) {
      const skid = add(MeshBuilder.CreateBox("ship-skid", { width: 0.22, height: 0.18, depth: 5.2 }, scene), dark, this.gear);
      skid.position.set(s * 1.5, -1.6, 0.2);
      for (const z of [-1.4, 1.8]) {
        const strut = add(MeshBuilder.CreateCylinder("ship-strut", { height: 1.1, diameter: 0.14 }, scene), dark, this.gear);
        strut.position.set(s * 1.25, -1.05, z);
        strut.rotation.z = s * 0.35;
      }
    }
    // Underside landing light.
    const belly = add(MeshBuilder.CreateDisc("ship-belly", { radius: 0.3, tessellation: 12 }, scene), glow);
    belly.rotation.x = Math.PI / 2;
    belly.position.set(0, -0.92, 1.2);
  }

  setPose(x: number, y: number, z: number, yaw: number, pitch: number, roll: number): void {
    this.root.position.set(x, y, z);
    this.root.rotation.set(-pitch, yaw, roll);
  }

  /** @param throttle 0..1 @param gearDown 0 (retracted) .. 1 (deployed) */
  animate(dt: number, throttle: number, boosting: boolean, gearDown: number, active: boolean): void {
    this.t += dt;
    for (const f of this.flames) {
      const len = active ? 0.4 + throttle * (boosting ? 5.5 : 3.2) : 0;
      f.setEnabled(len > 0.05);
      f.scaling.y = len * (0.9 + Math.random() * 0.2);
      f.position.z = -4.85 - len / 2;
    }
    const g = Math.max(0.05, gearDown);
    this.gear.scaling.set(1, g, 1);
    this.gear.position.y = (1 - g) * -0.2;
    const blink = Math.sin(this.t * 4) > 0.6;
    for (const l of this.lights) l.isVisible = blink || !active;
  }
}
