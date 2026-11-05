/**
 * Realistic astronaut for the Android / desktop FULL package (Checkpoint A).
 *
 * Original, procedural geometry (no downloaded or licensed assets). Same public API, joint origins and muzzle position as the
 * simple astronaut in src/player/astronaut.ts, so movement physics, hit-boxes, boarding, mining and camera behave identically —
 * only what is drawn (and how the limbs are articulated) changes.
 *
 *  - layered suit: fabric under-layer with accordion pleats at every joint, hard armour shells (shoulders, chest, knees, shins, boots),
 *    metal bearing rings (neck, shoulders, wrists, waist, ankles), harness straps, life-support backpack with tanks and hoses,
 *    chest control unit with a lit display
 *  - helmet with a gold reflective visor, rim, comms pods and side lamps
 *  - gloves with individually modelled fingers and thumb that curl (relaxed, running, gripping the mining tool)
 *  - boots with sole, heel and toe cap; the ankles keep the soles flat on the ground through the stride
 *  - animation: weight shift, breathing, head stabilisation, backpack inertia, sprint lean, airborne tuck, jetpack posture with
 *    gimballed flames, landing compression
 *
 * Draw calls: every bone's static pieces are merged per material, so the whole figure is ~30 meshes (the simple model had 36).
 * Not part of the Lite package (see src/presentation/astronaut.lite.ts).
 */
import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode, Vector3 } from "../../engine/babylon";
import { damp } from "../../core/random";
import type { MaterialLibrary } from "../../graphics/materials";

type Mat = ReturnType<MaterialLibrary["make"]> | StandardMaterial;

export class AstronautFull {
  readonly root: TransformNode;
  readonly meshes: Mesh[] = [];
  readonly muzzle: TransformNode;
  private readonly hips: TransformNode;
  private readonly chest: TransformNode;
  private readonly head: TransformNode;
  private readonly pack: TransformNode;
  private readonly thigh: [TransformNode, TransformNode];
  private readonly shin: [TransformNode, TransformNode];
  private readonly ankle: [TransformNode, TransformNode];
  private readonly upperArm: [TransformNode, TransformNode];
  private readonly forearm: [TransformNode, TransformNode];
  private readonly fingers: [TransformNode, TransformNode];
  private readonly thumbs: [TransformNode, TransformNode];
  private readonly flames: { mesh: Mesh; gimbal: TransformNode }[] = [];
  private phase = 0;
  private t = 0;
  private wRun = 0;
  private wAir = 0;
  private wJet = 0;
  private wAim = 0;
  private landing = 0;
  private wasGrounded = true;
  private lastVy = 0;
  private packLag = 0;
  private prevRun = 0;
  private lookYaw = 0;

  constructor(scene: Scene, lib: MaterialLibrary) {
    // Two shared PBR materials carry every colour through vertex colours (one draw per bone per material, not per colour).
    const M = {
      cloth: lib.make("astro-cloth", { albedo: new Color3(1, 1, 1), roughness: 0.86, maps: "fabric", mapScale: 22 }),
      hard: lib.make("astro-hard", { albedo: new Color3(1, 1, 1), roughness: 0.36, metallic: 0.3, envIntensity: 1.1 }),
      visor: lib.make("astro-visor2", { albedo: new Color3(0.62, 0.46, 0.16), roughness: 0.03, metallic: 1, envIntensity: 1.6, emissive: new Color3(0.035, 0.03, 0.012) }),
    };
    const glow = new StandardMaterial("astro-glow2", scene);
    glow.emissiveColor = new Color3(0.45, 0.95, 1);
    glow.disableLighting = true;
    const flameMat = new StandardMaterial("astro-flame2", scene);
    flameMat.emissiveColor = new Color3(0.45, 0.8, 1);
    flameMat.disableLighting = true;
    flameMat.alpha = 0.75;
    // colour token -> material + sRGB colour (stored as linear, which is what the PBR albedo multiply expects)
    const TOKENS: Record<string, { m: "cloth" | "hard" | "visor" | "glow"; c: [number, number, number] }> = {
      fabric: { m: "cloth", c: [0.86, 0.85, 0.88] },
      fabric2: { m: "cloth", c: [0.6, 0.6, 0.66] },
      glove: { m: "cloth", c: [0.28, 0.28, 0.32] },
      rubber: { m: "cloth", c: [0.07, 0.07, 0.08] },
      armor: { m: "hard", c: [0.9, 0.9, 0.93] },
      accent: { m: "hard", c: [0.4, 0.22, 0.82] },
      dark: { m: "hard", c: [0.1, 0.1, 0.13] },
      metal: { m: "hard", c: [0.72, 0.74, 0.78] },
      reflect: { m: "hard", c: [0.85, 0.87, 0.9] },
      visor: { m: "visor", c: [1, 1, 1] },
      glow: { m: "glow", c: [1, 1, 1] },
      screen: { m: "glow", c: [1, 1, 1] },
      lamp: { m: "glow", c: [1, 1, 1] },
    };
    const MATS: Record<string, Mat> = { cloth: M.cloth, hard: M.hard, visor: M.visor, glow };

    this.root = new TransformNode("astronaut", scene);
    const node = (name: string, parent: TransformNode, x: number, y: number, z = 0) => {
      const n = new TransformNode(name, scene);
      n.parent = parent;
      n.position.set(x, y, z);
      return n;
    };

    // ---- merge-per-(bone, material) collection -----------------------------------------------------------------------
    const pending = new Map<string, { bone: TransformNode; mat: string; list: Mesh[] }>();
    const put = (bone: TransformNode, token: string, m: Mesh): Mesh => {
      const tk = TOKENS[token];
      m.parent = null;
      m.isPickable = false;
      if (tk.m !== "glow" && tk.m !== "visor") {
        const n = m.getTotalVertices();
        const col = new Float32Array(n * 4);
        const lin = tk.c.map((v) => Math.pow(v, 2.2));
        for (let i = 0; i < n; i++) col.set([lin[0], lin[1], lin[2], 1], i * 4);
        m.setVerticesData("color", col);
      }
      const key = `${bone.name}|${tk.m}`;
      let e = pending.get(key);
      if (!e) pending.set(key, (e = { bone, mat: tk.m, list: [] }));
      e.list.push(m);
      return m;
    };
    const at = (m: Mesh, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): Mesh => {
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      m.scaling.set(sx, sy, sz);
      return m;
    };
    const ell = (bone: TransformNode, mat: string, x: number, y: number, z: number, w: number, h: number, d: number, seg = 5, rx = 0, ry = 0, rz = 0) =>
      put(bone, mat, at(MeshBuilder.CreateSphere("e", { diameter: 1, segments: seg }, scene), x, y, z, rx, ry, rz, w, h, d));
    const cyl = (bone: TransformNode, mat: string, x: number, y: number, z: number, h: number, dTop: number, dBot: number, tess = 14, rx = 0, ry = 0, rz = 0) =>
      put(bone, mat, at(MeshBuilder.CreateCylinder("c", { height: h, diameterTop: dTop, diameterBottom: dBot, tessellation: tess }, scene), x, y, z, rx, ry, rz));
    const box = (bone: TransformNode, mat: string, x: number, y: number, z: number, w: number, h: number, d: number, rx = 0, ry = 0, rz = 0) =>
      put(bone, mat, at(MeshBuilder.CreateBox("b", { width: w, height: h, depth: d }, scene), x, y, z, rx, ry, rz));
    // Bearings, seals and pleats are thin cylinders (a torus costs ~10x the triangles for no visible gain at this size).
    const ring = (bone: TransformNode, mat: string, y: number, r: number, th: number, sx = 1, sz = 1, x = 0, z = 0) =>
      put(bone, mat, at(MeshBuilder.CreateCylinder("r", { height: th * 1.8, diameter: (r + th * 0.5) * 2, tessellation: 16 }, scene), x, y, z, 0, 0, 0, sx, 1, sz));
    const pleats = (bone: TransformNode, mat: string, y0: number, y1: number, r: number, th: number, n: number, sz = 1) => {
      for (let i = 0; i < n; i++) ring(bone, mat, y0 + ((y1 - y0) * i) / Math.max(1, n - 1), r * (i % 2 ? 0.93 : 1), th, 1, sz);
    };
    const tube = (bone: TransformNode, mat: string, pts: Vector3[], r: number) => put(bone, mat, MeshBuilder.CreateTube("t", { path: pts, radius: r, tessellation: 8, cap: Mesh.CAP_ALL }, scene));

    // ---- skeleton (joint origins identical to the simple astronaut) ----------------------------------------------------
    this.hips = node("astro-hips", this.root, 0, 0.95);
    this.chest = node("astro-chest", this.hips, 0, 0.1);
    this.head = node("astro-head", this.chest, 0, 0.78);
    this.pack = node("astro-pack", this.chest, 0, 0.32, -0.3);

    // ---- pelvis + waist ------------------------------------------------------------------------------------------------
    ell(this.hips, "fabric", 0, -0.02, 0, 0.5, 0.34, 0.4, 6);
    ring(this.hips, "metal", 0.07, 0.25, 0.035, 1, 0.84);
    box(this.hips, "accent", 0, 0.0, 0.2, 0.2, 0.07, 0.03);
    for (const sx of [-1, 1]) ell(this.hips, "armor", sx * 0.21, -0.02, 0.02, 0.13, 0.2, 0.3, 10);
    box(this.hips, "dark", 0, -0.05, -0.2, 0.26, 0.1, 0.06);

    // ---- torso (hard upper torso shell over a fabric layer) -----------------------------------------------------------
    ell(this.chest, "fabric", 0, 0.28, 0, 0.56, 0.72, 0.44, 8);
    ell(this.chest, "armor", 0, 0.38, 0.045, 0.5, 0.5, 0.4, 8);
    ring(this.chest, "metal", 0.62, 0.17, 0.04);
    ring(this.chest, "metal", 0.6, 0.2, 0.025);
    // chest control unit with display, switches and hose ports
    box(this.chest, "dark", 0, 0.38, 0.235, 0.3, 0.2, 0.06);
    box(this.chest, "screen", 0, 0.41, 0.268, 0.17, 0.07, 0.012);
    for (let i = 0; i < 3; i++) box(this.chest, i === 1 ? "accent" : "metal", -0.09 + i * 0.09, 0.32, 0.27, 0.05, 0.03, 0.015);
    for (const sx of [-1, 1]) {
      cyl(this.chest, "metal", sx * 0.16, 0.36, 0.265, 0.05, 0.05, 0.06, 12, Math.PI / 2);
    }
    // harness straps + chest stripe
    for (const sx of [-1, 1]) {
      box(this.chest, "accent", sx * 0.13, 0.5, 0.2, 0.05, 0.38, 0.015, 0.28 * sx * -1, 0, 0);
      box(this.chest, "accent", sx * 0.2, 0.52, -0.1, 0.05, 0.3, 0.015);
    }
    box(this.chest, "reflect", 0, 0.2, 0.225, 0.5, 0.022, 0.012);
    // shoulder bearings + pads
    for (const sx of [-1, 1]) {
      ell(this.chest, "armor", sx * 0.31, 0.52, 0, 0.22, 0.17, 0.24, 8);
      ring(this.chest, "metal", 0.5, 0.1, 0.03, 1, 1, sx * 0.34, 0);
      box(this.chest, "accent", sx * 0.37, 0.56, 0.05, 0.012, 0.07, 0.09);
    }

    // ---- life-support backpack (PLSS) ------------------------------------------------------------------------------------
    box(this.pack, "armor", 0, 0, 0, 0.44, 0.56, 0.2);
    ell(this.pack, "armor", 0, 0.28, 0, 0.44, 0.1, 0.2, 6);
    ell(this.pack, "armor", 0, -0.28, 0, 0.44, 0.08, 0.2, 6);
    box(this.pack, "accent", 0, 0.02, -0.105, 0.34, 0.22, 0.015);
    for (const sx of [-1, 1]) {
      cyl(this.pack, "metal", sx * 0.14, 0.05, -0.17, 0.5, 0.11, 0.11, 14);
      ell(this.pack, "metal", sx * 0.14, 0.3, -0.17, 0.11, 0.07, 0.11, 6);
      ell(this.pack, "metal", sx * 0.14, -0.2, -0.17, 0.11, 0.07, 0.11, 6);
      ring(this.pack, "dark", 0.18, 0.058, 0.014, 1, 1, sx * 0.14, -0.17);
      ring(this.pack, "dark", -0.1, 0.058, 0.014, 1, 1, sx * 0.14, -0.17);
      box(this.pack, "lamp", sx * 0.12, 0.12, -0.108, 0.04, 0.025, 0.012);
    }

    // jetpack nozzles + flames (gimballed)
    for (const sx of [-0.13, 0.13]) {
      cyl(this.pack, "dark", sx, -0.36, -0.01, 0.14, 0.1, 0.16, 14);
      ring(this.pack, "metal", -0.43, 0.075, 0.02, 1, 1, sx, -0.01);
      const gimbal = node("astro-gimbal", this.pack, sx, -0.43, -0.01);
      const fl = MeshBuilder.CreateCylinder("astro-flame", { height: 0.62, diameterTop: 0.13, diameterBottom: 0, tessellation: 10 }, scene);
      fl.parent = gimbal;
      fl.position.y = -0.31;
      fl.material = flameMat;
      fl.isPickable = false;
      fl.setEnabled(false);
      this.meshes.push(fl);
      this.flames.push({ mesh: fl, gimbal });
    }

    // ---- neck, helmet, visor --------------------------------------------------------------------------------------------
    ring(this.chest, "fabric", 0.66, 0.15, 0.06);
    ring(this.head, "metal", -0.22, 0.19, 0.045);
    ell(this.head, "armor", 0, 0.02, -0.01, 0.56, 0.54, 0.58, 12);
    ell(this.head, "armor", 0, -0.1, 0.0, 0.5, 0.2, 0.5, 6);
    ring(this.head, "metal", 0.0, 0.215, 0.022, 1, 1, 0, 0.1);
    // visor: mirrored gold shell, slightly proud of the helmet, with a dark inner face behind it
    ell(this.head, "visor", 0, 0.01, 0.1, 0.42, 0.33, 0.4, 12);
    ring(this.head, "metal", 0.115, 0.17, 0.016, 1, 1, 0, 0.14);
    for (const sx of [-1, 1]) {
      cyl(this.head, "dark", sx * 0.27, -0.02, 0.01, 0.1, 0.1, 0.1, 12, 0, 0, Math.PI / 2);
      cyl(this.head, "lamp", sx * 0.27, 0.12, 0.12, 0.03, 0.065, 0.065, 10, Math.PI / 2 - 0.4, 0, 0);
    }
    cyl(this.head, "metal", 0.2, 0.27, -0.06, 0.2, 0.012, 0.014, 6);
    ell(this.head, "glow", 0.2, 0.38, -0.06, 0.04, 0.04, 0.04, 4);
    box(this.head, "accent", 0, 0.255, 0.18, 0.1, 0.022, 0.04);

    // ---- legs ----------------------------------------------------------------------------------------------------------
    const legs = [-1, 1].map((sx) => {
      const hip = node(`astro-hip${sx}`, this.hips, sx * 0.14, 0.02);
      const knee = node(`astro-knee${sx}`, hip, 0, -0.44);
      const ankle = node(`astro-ankle${sx}`, knee, 0, -0.5);
      // thigh: tapered fabric volume + pleated hip joint
      cyl(hip, "fabric", 0, -0.2, 0, 0.44, 0.24, 0.19, 14);
      pleats(hip, "fabric2", -0.02, -0.07, 0.125, 0.04, 2);
      ell(hip, "armor", 0, -0.18, 0.08, 0.2, 0.3, 0.07, 6);
      ring(hip, "reflect", -0.3, 0.1, 0.014);
      box(hip, "accent", sx * 0.095, -0.2, 0.0, 0.012, 0.22, 0.08);
      // knee: accordion pleats + hard cap
      pleats(knee, "fabric2", 0.08, -0.08, 0.098, 0.035, 5);
      ell(knee, "armor", 0, 0.0, 0.075, 0.18, 0.2, 0.1, 8);
      ring(knee, "metal", 0.12, 0.1, 0.014);
      // shin: tapered fabric + armour shell
      cyl(knee, "fabric", 0, -0.27, 0, 0.42, 0.19, 0.15, 14);
      ell(knee, "armor", 0, -0.22, 0.075, 0.15, 0.32, 0.07, 6);
      ring(knee, "reflect", -0.34, 0.08, 0.012);
      // ankle bearing + boot
      ring(ankle, "metal", 0.02, 0.085, 0.026);
      cyl(ankle, "fabric2", 0, -0.0, 0, 0.1, 0.16, 0.19, 14);
      cyl(ankle, "armor", 0, -0.07, 0.02, 0.12, 0.17, 0.2, 14);
      ell(ankle, "armor", 0, -0.12, 0.1, 0.21, 0.12, 0.26, 8);
      box(ankle, "rubber", 0, -0.175, 0.045, 0.22, 0.05, 0.33);
      ell(ankle, "rubber", 0, -0.165, 0.2, 0.2, 0.055, 0.1, 6);
      box(ankle, "rubber", 0, -0.165, -0.1, 0.2, 0.06, 0.1);
      box(ankle, "accent", 0, -0.12, 0.215, 0.12, 0.018, 0.03);
      return { hip, knee, ankle };
    });
    this.thigh = [legs[0].hip, legs[1].hip];
    this.shin = [legs[0].knee, legs[1].knee];
    this.ankle = [legs[0].ankle, legs[1].ankle];

    // ---- arms + hands ------------------------------------------------------------------------------------------------
    const fingers: TransformNode[] = [];
    const thumbs: TransformNode[] = [];
    const arms = [-1, 1].map((sx) => {
      const sh = node(`astro-sh${sx}`, this.chest, sx * 0.36, 0.48);
      const el = node(`astro-elbow${sx}`, sh, 0, -0.31);
      const hand = node(`astro-hand${sx}`, el, 0, -0.34);
      pleats(sh, "fabric2", 0.02, -0.04, 0.095, 0.034, 2);
      cyl(sh, "fabric", 0, -0.15, 0, 0.3, 0.19, 0.16, 14);
      ell(sh, "armor", sx * 0.02, -0.12, 0, 0.1, 0.2, 0.15, 6);
      ring(sh, "reflect", -0.22, 0.083, 0.012);
      pleats(el, "fabric2", 0.05, -0.05, 0.08, 0.032, 4);
      ell(el, "armor", 0, -0.0, -0.065, 0.12, 0.14, 0.08, 6);
      cyl(el, "fabric", 0, -0.2, 0, 0.3, 0.16, 0.14, 14);
      ring(el, "metal", -0.33, 0.075, 0.026);
      // glove: palm + cuff, fingers curl at the knuckles
      cyl(hand, "dark", 0, 0.025, 0, 0.07, 0.15, 0.15, 12);
      ell(hand, "glove", 0, -0.05, 0.01, 0.1, 0.1, 0.06, 6);
      const fg = node(`astro-fingers${sx}`, hand, 0, -0.095);
      for (let f = 0; f < 4; f++) {
        const fx = (f - 1.5) * 0.024;
        const len = f === 1 || f === 2 ? 0.082 : 0.07;
        cyl(fg, "glove", fx, -len / 2, 0.006, len, 0.022, 0.02, 8);
        ell(fg, "glove", fx, -len, 0.01, 0.022, 0.022, 0.022, 4);
      }
      const th = node(`astro-thumb${sx}`, hand, sx * -0.05, -0.05, 0.02);
      cyl(th, "glove", 0, -0.025, 0.012, 0.06, 0.026, 0.022, 8, 0.5, 0, sx * 0.55);
      ell(th, "glove", sx * -0.015, -0.055, 0.025, 0.026, 0.026, 0.026, 4);
      fingers.push(fg);
      thumbs.push(th);
      return { sh, el, hand };
    });
    this.upperArm = [arms[0].sh, arms[1].sh];
    this.forearm = [arms[0].el, arms[1].el];
    this.fingers = [fingers[0], fingers[1]];
    this.thumbs = [thumbs[0], thumbs[1]];

    // mining tool in the right hand (same muzzle position as the simple astronaut)
    const hand = arms[1].hand;
    box(hand, "dark", 0, 0, 0.12, 0.1, 0.12, 0.32);
    box(hand, "metal", 0, 0.065, 0.12, 0.05, 0.02, 0.24);
    cyl(hand, "accent", 0, 0, 0.36, 0.22, 0.05, 0.05, 10, Math.PI / 2);
    ring(hand, "metal", 0, 0.034, 0.012, 1, 1, 0, 0.3);
    ell(hand, "glow", 0, 0, 0.47, 0.06, 0.06, 0.06, 5);
    this.muzzle = node("astro-muzzle", hand, 0, 0, 0.5);

    // ---- merge each (bone, material) group into one mesh ----------------------------------------------------------------
    for (const { bone, mat, list } of pending.values()) {
      const merged = list.length === 1 ? list[0] : Mesh.MergeMeshes(list, true, true, undefined, false, false);
      if (!merged) continue;
      merged.name = `astro-${bone.name}-${mat}`;
      merged.parent = bone;
      merged.isPickable = false;
      const m = MATS[mat];
      if (m instanceof StandardMaterial) merged.material = m;
      else lib.bind(merged, m);
      this.meshes.push(merged);
    }
  }

  setVisible(v: boolean): void {
    this.root.setEnabled(v);
  }

  /** Vertices across all drawn parts (render-cost reporting; the flames are excluded). */
  stats(): { meshes: number; triangles: number } {
    let tris = 0;
    for (const m of this.meshes) if (!this.flames.some((f) => f.mesh === m)) tris += m.getTotalIndices() / 3;
    return { meshes: this.meshes.length, triangles: Math.round(tris) };
  }

  animate(dt: number, speed: number, grounded: boolean, jetting: boolean, aiming: boolean, aimPitch: number, vy = 0): void {
    this.t += dt;
    const k = damp(10, dt);
    this.wRun += (Math.min(1, speed / 10) - this.wRun) * k;
    this.wAir += ((grounded ? 0 : 1) - this.wAir) * damp(8, dt);
    this.wJet += ((jetting ? 1 : 0) - this.wJet) * damp(8, dt);
    this.wAim += ((aiming ? 1 : 0) - this.wAim) * damp(14, dt);
    if (grounded && !this.wasGrounded) this.landing = Math.min(1, Math.max(0.25, -this.lastVy / 12));
    this.wasGrounded = grounded;
    this.lastVy = vy;
    this.landing = Math.max(0, this.landing - dt * 3.5);

    const move = Math.min(1, speed / 2.5);
    this.phase += dt * (3.6 + speed * 1.05) * (grounded ? 1 : 0.15);
    const s = Math.sin(this.phase);
    const c = Math.cos(this.phase);
    const stride = (0.3 + this.wRun * 0.55) * move * (1 - this.wAir);

    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const ph = s * side;
      const lift = Math.max(0, Math.cos(this.phase + (side > 0 ? 0 : Math.PI)));
      const airTuck = this.wAir * (0.5 - this.wJet * 0.35);
      const th = ph * stride - airTuck * (i === 0 ? 0.9 : 0.4) - this.landing * 0.45 + this.wJet * 0.15;
      const sn = lift * stride * 1.3 + airTuck * (i === 0 ? 1.2 : 0.7) + this.landing * 0.9 + this.wJet * 0.25;
      this.thigh[i].rotation.x = th;
      this.shin[i].rotation.x = sn;
      // Ankle keeps the sole level through the stride; toes point down in the air / jet, push-off as the leg trails.
      const trail = Math.max(0, -ph) * stride;
      this.ankle[i].rotation.x = -(th + sn) * 0.9 + trail * 0.35 + this.wAir * 0.35 + this.wJet * 0.25;
      this.thigh[i].rotation.z = side * -0.03 * (1 - this.wAir) + side * this.wAir * -0.06;
      const armSwing = -ph * stride * 0.9;
      const ua = this.upperArm[i];
      const fa = this.forearm[i];
      ua.rotation.x = armSwing + this.wAir * 0.35 - this.wJet * 0.2;
      ua.rotation.z = side * (0.1 + this.wAir * 0.35 + this.wJet * 0.25);
      fa.rotation.x = -(0.18 + this.wRun * 0.75 * move + this.wAir * 0.3);
      // Fingers: relaxed curl, tighter when running, hands open in the air.
      const curl = 0.55 + this.wRun * 0.35 - this.wAir * 0.3;
      this.fingers[i].rotation.x = curl;
      this.thumbs[i].rotation.z = side * 0.18;
    }
    // Aim pose overrides the right arm (grip the mining tool).
    const ra = this.upperArm[1];
    const rf = this.forearm[1];
    ra.rotation.x = ra.rotation.x * (1 - this.wAim) + (-Math.PI / 2 + aimPitch) * this.wAim;
    ra.rotation.z = ra.rotation.z * (1 - this.wAim) + 0.04 * this.wAim;
    rf.rotation.x = rf.rotation.x * (1 - this.wAim);
    this.fingers[1].rotation.x = this.fingers[1].rotation.x * (1 - this.wAim) + 1.25 * this.wAim;
    const la = this.upperArm[0];
    la.rotation.x = la.rotation.x * (1 - this.wAim * 0.6) + -0.7 * this.wAim * 0.6;

    const bob = grounded ? Math.abs(c) * 0.05 * move * (0.6 + this.wRun) : 0;
    const idle = 1 - move;
    const breathe = Math.sin(this.t * 1.8) * 0.008 * idle;
    const sway = Math.sin(this.t * 0.7) * 0.012 * idle;
    this.hips.position.y = 0.95 + bob + breathe - this.landing * 0.16;
    this.hips.position.x = sway * 0.5;
    this.hips.rotation.x = this.wRun * 0.16 + this.wJet * 0.22 + this.landing * 0.12;
    this.hips.rotation.y = s * 0.08 * stride;
    this.hips.rotation.z = sway + c * 0.025 * stride;
    this.chest.rotation.y = -s * 0.14 * stride;
    this.chest.rotation.x = breathe * 2 + this.wAim * 0.05;
    this.chest.rotation.z = -sway * 1.2 - c * 0.02 * stride;
    this.chest.scaling.y = 1 + Math.sin(this.t * 1.8) * 0.005 * idle;
    // Head stays level and looks slowly around when idle.
    this.lookYaw += ((Math.sin(this.t * 0.35) * 0.35 * idle - this.lookYaw) * damp(2, dt));
    this.head.rotation.x = aiming ? aimPitch * 0.5 : -this.hips.rotation.x * 0.6;
    this.head.rotation.y = this.chest.rotation.y * -0.7 + this.lookYaw;
    this.head.rotation.z = -this.chest.rotation.z * 0.5;
    // Backpack lags behind sudden speed changes.
    const acc = (this.wRun - this.prevRun) / Math.max(dt, 1e-3);
    this.prevRun = this.wRun;
    this.packLag += (Math.max(-0.5, Math.min(0.5, -acc * 0.05)) - this.packLag) * damp(6, dt);
    this.pack.rotation.x = this.packLag + this.wJet * -0.05;

    for (let i = 0; i < this.flames.length; i++) {
      const f = this.flames[i];
      const on = this.wJet > 0.05;
      f.mesh.setEnabled(on);
      if (on) {
        f.mesh.scaling.y = (0.8 + 0.2 * Math.sin(this.t * 60 + i * 2) + 0.12 * Math.sin(this.t * 37)) * this.wJet;
        f.gimbal.rotation.x = -this.hips.rotation.x * 0.5 + Math.sin(this.t * 9 + i) * 0.06;
      }
    }
  }

  get position(): Vector3 {
    return this.root.position;
  }
}
