import { Mesh, MeshBuilder, RawTexture, Scene, Texture, TransformNode, Vector3 } from "../engine/babylon";
import { WORLD, stationPadPosition } from "../core/worldConfig";
import type { MaterialLibrary } from "../graphics/materials";
import { PROFILES, type GraphicsTier } from "../graphics/profiles";
import { SurfaceMaterial, acquirePanels, makeGlowTexture, mulberry32, releasePanels, type PanelSet, type RGB, type SurfaceLook } from "../graphics/shipFx";

type Group = "core" | "detail" | "ultra";
type Part = "core" | "ring";
type LightKind = "beacon" | "chaser" | "buoy" | "mast" | "steady";
type MatKey = "metal" | "dark" | "accent" | "solar" | "windows" | "cyan" | "beacon" | "white" | "amber" | "pad";

/**
 * Halcyon Dock: orbital station with a rotating habitat ring and a docking pad.
 *
 * M3: window bands, habitat modules and lit spokes on the ring, radiator fins,
 * comm masts, docking guide lights (pad perimeter, pulsing approach corridor and
 * a chaser strip on the docking arm). Same centre, pad position and collision
 * radius as M2 (`WORLD.station`); nothing new extends past the M2 hull except
 * the small approach buoys beside the corridor (visual only).
 */
export class Station {
  readonly root: TransformNode;
  readonly ring: TransformNode;
  readonly padPosition: Vector3;
  readonly center: Vector3;
  readonly meshes: Mesh[] = [];
  detail: GraphicsTier = "enhanced";

  private readonly scene: Scene;
  private readonly lib: MaterialLibrary | null;
  private readonly mats = new Map<MatKey, SurfaceMaterial>();
  private readonly fxMats: SurfaceMaterial[] = [];
  private readonly groups = new Map<Group, Mesh[]>();
  private readonly beacons: Mesh[] = [];
  private readonly chasers: Mesh[] = [];
  private readonly buoys: Mesh[] = [];
  private readonly buoyRow: number[] = [];
  private readonly halos: { mesh: Mesh; base: number; kind: LightKind; index: number }[] = [];
  private readonly glowTex: RawTexture;
  private readonly windowTex: RawTexture;
  private readonly solarTex: RawTexture;
  private panels: PanelSet | null;
  private pbr = false;
  private explicitDetail = false;
  private t = 0;

  constructor(scene: Scene, lib?: MaterialLibrary | null) {
    this.scene = scene;
    this.lib = lib ?? null;
    const p = WORLD.station.position;
    this.center = new Vector3(p.x, p.y, p.z);
    const pad = stationPadPosition();
    this.padPosition = new Vector3(pad.x, pad.y, pad.z);

    const tier = this.autoTier();
    this.detail = tier;
    this.pbr = PROFILES[tier].pbr;
    this.panels = acquirePanels(scene, tier === "ultra" ? 1024 : tier === "enhanced" ? 512 : 256, "station");
    this.glowTex = makeGlowTexture(scene, "st-glow-tex", 64);
    this.windowTex = this.makeWindowTexture();
    this.solarTex = this.makeSolarTexture();

    const mk = (key: MatKey, look: SurfaceLook) => {
      const m = new SurfaceMaterial(`st-${key}`, scene, look, look.panels ? this.panels : null);
      m.setMode(this.pbr);
      this.mats.set(key, m);
      return m;
    };
    mk("metal", { color: [0.7, 0.7, 0.78], roughness: 0.42, metallic: 0.7, panels: true, env: 1.1 });
    mk("dark", { color: [0.2, 0.19, 0.27], roughness: 0.5, metallic: 0.6, emissive: [0.02, 0.01, 0.04], panels: true, env: 1.1 });
    mk("pad", { color: [0.16, 0.15, 0.21], roughness: 0.6, metallic: 0.4, panels: true, env: 0.9 });
    mk("accent", { color: [0.45, 0.25, 0.9], roughness: 0.35, metallic: 0.3, emissive: [0.18, 0.08, 0.4] });
    mk("solar", { color: [0.25, 0.3, 0.7], roughness: 0.18, metallic: 0.85, emissive: [0.02, 0.03, 0.12], map: this.solarTex });
    mk("windows", { color: [1, 1, 1], roughness: 1, metallic: 0, unlit: true, map: this.windowTex });
    mk("cyan", { color: [0.2, 0.9, 1], roughness: 1, metallic: 0, unlit: true });
    mk("beacon", { color: [1, 0.35, 0.5], roughness: 1, metallic: 0, unlit: true });
    mk("white", { color: [0.95, 0.95, 1], roughness: 1, metallic: 0, unlit: true });
    mk("amber", { color: [1, 0.7, 0.3], roughness: 1, metallic: 0, unlit: true });

    this.root = new TransformNode("halcyon", scene);
    this.root.position.copyFrom(this.center);
    this.ring = new TransformNode("st-ring", scene);
    this.ring.parent = this.root;

    this.build();
    this.applyDetail(tier, this.pbr);
  }

  private autoTier(): GraphicsTier {
    const L = this.lib;
    if (!L) return "enhanced";
    return L.pbr ? (L.triplanar ? "ultra" : "enhanced") : "basic";
  }

  private makeWindowTexture(): RawTexture {
    // Rows of lit windows (warm, a few cyan), some dark; u runs around the hull.
    const w = 256, h = 16;
    const px = new Uint8Array(w * h * 4);
    const rand = mulberry32(0xd0c4);
    for (let cx = 0; cx < w; cx += 8) {
      const lit = rand() < 0.72;
      const cyan = rand() < 0.15;
      const k = 0.65 + rand() * 0.35;
      const c: RGB = !lit ? [0.05, 0.05, 0.08] : cyan ? [0.35 * k, 0.9 * k, 1 * k] : [1 * k, 0.78 * k, 0.45 * k];
      for (let y = 0; y < h; y++) {
        for (let x = cx; x < cx + 8; x++) {
          const o = (y * w + x) * 4;
          const frame = x - cx < 2 || y < 4 || y > 11;
          const v: RGB = frame ? [0.03, 0.03, 0.05] : c;
          px[o] = Math.round(v[0] * 255);
          px[o + 1] = Math.round(v[1] * 255);
          px[o + 2] = Math.round(v[2] * 255);
          px[o + 3] = 255;
        }
      }
    }
    const t = RawTexture.CreateRGBATexture(px, w, h, this.scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
    t.name = "st-window-tex";
    t.wrapU = Texture.WRAP_ADDRESSMODE;
    t.wrapV = Texture.CLAMP_ADDRESSMODE;
    return t;
  }

  private makeSolarTexture(): RawTexture {
    const n = 64;
    const px = new Uint8Array(n * n * 4);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const o = (y * n + x) * 4;
        const line = x % 16 === 0 || y % 8 === 0;
        const v = line ? 0.85 : 0.35 + 0.08 * Math.sin(x * 0.4 + y * 0.9);
        px[o] = Math.round(v * 200);
        px[o + 1] = Math.round(v * 215);
        px[o + 2] = Math.round(Math.min(1, v * 1.25) * 255);
        px[o + 3] = 255;
      }
    }
    const t = RawTexture.CreateRGBATexture(px, n, n, this.scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
    t.name = "st-solar-tex";
    t.wrapU = t.wrapV = Texture.WRAP_ADDRESSMODE;
    return t;
  }

  // ---------------------------------------------------------------- build

  private build(): void {
    const S = this.scene;
    const parts = new Map<string, Mesh[]>();
    const put = (part: Part, group: Group, mat: MatKey, m: Mesh) => {
      const k = `${part}|${group}|${mat}`;
      if (!parts.has(k)) parts.set(k, []);
      parts.get(k)!.push(m);
      return m;
    };
    const uv = (m: Mesh, su: number, sv: number) => {
      const d = m.getVerticesData("uv");
      if (d) {
        for (let i = 0; i < d.length; i += 2) {
          d[i] *= su;
          d[i + 1] *= sv;
        }
        m.setVerticesData("uv", d);
      }
      return m;
    };
    const T = 14; // metres per panel tile
    const box = (part: Part, g: Group, mat: MatKey, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0) => {
      const m = MeshBuilder.CreateBox("p", { width: w, height: h, depth: d }, S);
      m.position.set(x, y, z);
      m.rotation.y = ry;
      return put(part, g, mat, uv(m, Math.max(w, d) / T, Math.max(h, d) / T));
    };

    // --- Core spine.
    put("core", "core", "metal", uv(MeshBuilder.CreateCylinder("p", { height: 34, diameter: 16, tessellation: 24 }, S), 50 / T, 34 / T));
    const capT = MeshBuilder.CreateSphere("p", { diameter: 16, segments: 16, slice: 0.5 }, S);
    capT.position.y = 17;
    put("core", "core", "dark", uv(capT, 3, 2));
    const capB = MeshBuilder.CreateCylinder("p", { height: 10, diameterTop: 16, diameterBottom: 4, tessellation: 24 }, S);
    capB.position.y = -22;
    put("core", "core", "dark", uv(capB, 3, 1));
    const thruster = MeshBuilder.CreateCylinder("p", { height: 2.5, diameterTop: 3.6, diameterBottom: 5, tessellation: 16 }, S);
    thruster.position.y = -28;
    put("core", "detail", "metal", thruster);
    for (let i = 0; i < 4; i++) {
      const band = MeshBuilder.CreateTorus("p", { diameter: 16.4, thickness: 0.8, tessellation: 40 }, S);
      band.position.y = -12 + i * 8;
      put("core", "core", i % 2 ? "accent" : "dark", band);
    }
    // Window bands (unlit emissive strips around the core).
    for (const y of [-8, -2, 4, 10]) {
      const wb = MeshBuilder.CreateCylinder("p", { height: 1.1, diameter: 16.12, tessellation: 40, cap: Mesh.NO_CAP }, S);
      wb.position.y = y;
      put("core", "core", "windows", uv(wb, 3, 1));
    }
    // Radiator fins (detail) and greeble boxes.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.2;
      const r = box("core", "detail", "dark", 0.25, 9, 3.2, Math.cos(a) * 9.4, -14, Math.sin(a) * 9.4, -a);
      r.rotation.y = -a + Math.PI / 2;
      for (let k = 0; k < 3; k++) box("core", "ultra", "metal", 0.6, 0.9, 0.9, Math.cos(a + 0.35) * 8.3, 6 + k * 2.4, Math.sin(a + 0.35) * 8.3, -a);
    }
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      box("core", "detail", "metal", 1.6, 1.0, 1.2, Math.cos(a) * 8.1, 14 - (i % 3) * 1.3, Math.sin(a) * 8.1, -a);
    }

    // --- Rotating habitat ring.
    put("ring", "core", "metal", uv(MeshBuilder.CreateTorus("p", { diameter: 82, thickness: 6.5, tessellation: 72 }, S), 260 / T, 20 / T));
    for (const oy of [-1.6, 1.6]) {
      const glowRing = MeshBuilder.CreateTorus("p", { diameter: 82, thickness: 0.5, tessellation: 72 }, S);
      glowRing.position.y = oy;
      glowRing.scaling.set(1.07, 1, 1.07);
      put("ring", "core", "cyan", glowRing);
    }
    // Outer window band on the ring.
    const rw = MeshBuilder.CreateCylinder("p", { height: 1.4, diameter: 88.6, tessellation: 96, cap: Mesh.NO_CAP }, S);
    put("ring", "core", "windows", uv(rw, 14, 1));
    const rwi = MeshBuilder.CreateCylinder("p", { height: 1.2, diameter: 75.6, tessellation: 96, cap: Mesh.NO_CAP, sideOrientation: Mesh.BACKSIDE }, S);
    put("ring", "detail", "windows", uv(rwi, 12, 1));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      // Spokes with lit strips.
      box("ring", "core", "dark", 1.6, 1.6, 33, Math.sin(a) * 24.5, 0, Math.cos(a) * 24.5, a);
      box("ring", "detail", "cyan", 0.25, 0.25, 30, Math.sin(a) * 24.5, 0.92, Math.cos(a) * 24.5, a);
      // Habitat modules between spokes.
      const b = a + Math.PI / 6;
      const mod = box("ring", "detail", "metal", 9, 8.2, 7.5, Math.sin(b) * 41, 0, Math.cos(b) * 41, b);
      mod.rotation.y = b;
      const ml = box("ring", "detail", "windows", 7.6, 1.0, 7.7, Math.sin(b) * 41, 1.5, Math.cos(b) * 41, b);
      ml.rotation.y = b;
      // Joints at the spoke ends.
      const j = MeshBuilder.CreateCylinder("p", { height: 7.6, diameter: 3.4, tessellation: 12 }, S);
      j.position.set(Math.sin(a) * 41, 0, Math.cos(a) * 41);
      put("ring", "core", "accent", j);
      box("ring", "ultra", "metal", 1.2, 1.2, 2.4, Math.sin(a) * 41 + Math.cos(a) * 3.2, 3.6, Math.cos(a) * 41 - Math.sin(a) * 3.2, a);
    }

    // --- Solar arrays (cell texture, frames).
    for (const s of [-1, 1]) {
      box("core", "core", "dark", 38, 1, 1, s * 27, 26, 0);
      for (let k = 0; k < 3; k++) {
        const panel = box("core", "core", "solar", 9, 0.25, 22, s * (14 + k * 10.5), 26, 0);
        panel.rotation.x = 0.35;
        uv(panel, 9 / 4.5 / Math.max(9, 22) * T, 22 / 4.5 / Math.max(0.25, 22) * T);
        const frame = box("core", "detail", "metal", 9.3, 0.35, 0.35, s * (14 + k * 10.5), 26 + Math.sin(0.35) * 11, Math.cos(0.35) * -11);
        frame.rotation.x = 0.35;
        const frame2 = box("core", "detail", "metal", 9.3, 0.35, 0.35, s * (14 + k * 10.5), 26 - Math.sin(0.35) * 11, Math.cos(0.35) * 11);
        frame2.rotation.x = 0.35;
      }
    }
    const dish = MeshBuilder.CreateCylinder("p", { height: 1.2, diameterTop: 9, diameterBottom: 2, tessellation: 32 }, S);
    dish.position.set(0, 31, -3);
    dish.rotation.x = -0.6;
    put("core", "core", "metal", dish);
    const feed = MeshBuilder.CreateCylinder("p", { height: 3.2, diameterTop: 0.2, diameterBottom: 0.5, tessellation: 8 }, S);
    feed.position.set(0, 32.6, -4.2);
    feed.rotation.x = -0.6;
    put("core", "detail", "dark", feed);
    const ant = MeshBuilder.CreateCylinder("p", { height: 14, diameter: 0.4 }, S);
    ant.position.y = 32;
    put("core", "core", "dark", ant);
    // Comm masts with blinking tips.
    const lights: [Vector3, MatKey, number, LightKind, Part][] = [];
    for (const [x, z, h] of [[5.5, 3, 7], [-5, -4, 5], [3, -6, 4]] as const) {
      const m = MeshBuilder.CreateCylinder("p", { height: h, diameter: 0.25, tessellation: 6 }, S);
      m.position.set(x, 24 + h / 2, z);
      put("core", "detail", "metal", m);
      lights.push([new Vector3(x, 24 + h, z), "beacon", 2.2, "mast", "core"]);
    }
    lights.push([new Vector3(0, 39, 0), "beacon", 3, "mast", "core"]);

    // --- Docking arm and pad (world-space offsets converted to local).
    const local = this.padPosition.subtract(this.center);
    const armLen = Math.abs(local.z) - 8;
    box("core", "core", "dark", 3.5, 2.5, armLen, local.x, local.y - 1.4, local.z / 2 - 2);
    box("core", "detail", "metal", 1.2, 1.2, armLen, local.x + 2.1, local.y - 2.2, local.z / 2 - 2);
    box("core", "detail", "metal", 1.2, 1.2, armLen, local.x - 2.1, local.y - 2.2, local.z / 2 - 2);
    for (let k = 0; k < 6; k++) box("core", "detail", "accent", 4.0, 0.4, 0.5, local.x, local.y - 0.1, -10 - k * ((armLen - 8) / 6));
    const padM = MeshBuilder.CreateCylinder("p", { height: 1.4, diameter: 22, tessellation: 48 }, S);
    padM.position.set(local.x, local.y - 0.7, local.z);
    put("core", "core", "metal", uv(padM, 66 / T, 1));
    const padTop = MeshBuilder.CreateCylinder("p", { height: 0.1, diameter: 20, tessellation: 48 }, S);
    padTop.position.set(local.x, local.y + 0.02, local.z);
    put("core", "core", "pad", uv(padTop, 20 / T, 20 / T));
    const padRing = MeshBuilder.CreateTorus("p", { diameter: 16, thickness: 0.35, tessellation: 64 }, S);
    padRing.position.set(local.x, local.y + 0.12, local.z);
    put("core", "core", "cyan", padRing);
    const padRing2 = MeshBuilder.CreateTorus("p", { diameter: 6, thickness: 0.25, tessellation: 32 }, S);
    padRing2.position.set(local.x, local.y + 0.12, local.z);
    put("core", "core", "accent", padRing2);
    // Pad markings: dashed outer circle and landing chevrons.
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      box("core", "detail", "white", 0.9, 0.06, 0.18, local.x + Math.cos(a) * 9.3, local.y + 0.09, local.z + Math.sin(a) * 9.3, -a + Math.PI / 2);
    }
    for (const s of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const c = box("core", "detail", "amber", 0.25, 0.06, 1.6, local.x + s * (0.9 + k * 0.05), local.y + 0.09, local.z - 4.2 - k * 1.1, s * 0.6);
        c.rotation.y = s * 0.6;
      }
    }
    // Guide posts around the pad with lights on top.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const b = MeshBuilder.CreateSphere("st-beacon", { diameter: 0.7, segments: 8 }, S);
      b.position.set(local.x + Math.cos(a) * 10.4, local.y + 0.6, local.z + Math.sin(a) * 10.4);
      b.parent = this.root;
      b.isPickable = false;
      this.mats.get("beacon")!.bind(b);
      this.addGroup("core", b);
      this.meshes.push(b);
      this.beacons.push(b);
      lights.push([b.position.clone(), "beacon", 2.6, "beacon", "core"]);
      const post = MeshBuilder.CreateCylinder("p", { height: 0.5, diameter: 0.4, tessellation: 8 }, S);
      post.position.set(b.position.x, local.y + 0.2, b.position.z);
      put("core", "detail", "dark", post);
    }
    const under = MeshBuilder.CreateCylinder("p", { height: 4, diameterTop: 14, diameterBottom: 3, tessellation: 32 }, S);
    under.position.set(local.x, local.y - 3.4, local.z);
    put("core", "core", "dark", under);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      box("core", "ultra", "metal", 0.4, 3.2, 0.4, local.x + Math.cos(a) * 5, local.y - 3.3, local.z + Math.sin(a) * 5, -a);
    }
    // Chaser strip along the arm top (runs toward the pad).
    for (let k = 0; k < 8; k++) {
      const z = -9 - k * ((armLen - 6) / 8);
      const c = MeshBuilder.CreateBox("st-chaser", { width: 0.5, height: 0.2, depth: 0.8 }, S);
      c.position.set(local.x, local.y - 0.1, z);
      c.parent = this.root;
      c.isPickable = false;
      this.mats.get("cyan")!.bind(c);
      this.addGroup("detail", c);
      this.chasers.push(c);
      lights.push([c.position.clone(), "cyan", 1.8, "chaser", "core"]);
    }
    // Approach corridor buoys (outside the pad, beside the flight path).
    for (let k = 0; k < 5; k++) {
      for (const s of [-1, 1]) {
        const pos = new Vector3(local.x + s * 15, local.y + 1.5, local.z - 22 - k * 16);
        const b = MeshBuilder.CreateSphere("st-buoy", { diameter: 0.6, segments: 6 }, S);
        b.position.copyFrom(pos);
        b.parent = this.root;
        b.isPickable = false;
        this.mats.get("amber")!.bind(b);
        this.addGroup("detail", b);
        this.buoys.push(b);
        const housing = MeshBuilder.CreateCylinder("p", { height: 1.4, diameterTop: 0.5, diameterBottom: 1.0, tessellation: 8 }, S);
        housing.position.set(pos.x, pos.y - 0.9, pos.z);
        put("core", "detail", "dark", housing);
        lights.push([pos, "amber", 4.2, "buoy", "core"]);
        this.buoyRow.push(k);
      }
    }
    // Steady white floodlights on the arm.
    for (const s of [-1, 1]) lights.push([new Vector3(local.x + s * 1.8, local.y + 0.3, local.z + 11.5), "white", 2.4, "steady", "core"]);

    // Halos.
    const haloMats = new Map<MatKey, SurfaceMaterial>();
    const counters = new Map<LightKind, number>();
    for (const [pos, key, size, kind, part] of lights) {
      const index = counters.get(kind) ?? 0;
      counters.set(kind, index + 1);
      let hm = haloMats.get(key);
      if (!hm) {
        hm = new SurfaceMaterial(`st-halo-${key}`, S, { color: [...this.mats.get(key)!.look.color], roughness: 1, metallic: 0, unlit: true, additive: true, opacity: this.glowTex, backFaceCulling: false }, null);
        haloMats.set(key, hm);
        this.fxMats.push(hm);
      }
      const h = MeshBuilder.CreatePlane("st-halo", { size: 1 }, S);
      h.position.copyFrom(pos);
      h.scaling.setAll(size);
      h.billboardMode = Mesh.BILLBOARDMODE_ALL;
      h.parent = part === "ring" ? this.ring : this.root;
      h.isPickable = false;
      hm.bind(h);
      this.halos.push({ mesh: h, base: size, kind, index });
    }

    // Merge per part / group / material.
    for (const [k, list] of parts) {
      const [part, group, mat] = k.split("|") as [Part, Group, MatKey];
      const merged = Mesh.MergeMeshes(list, true, true);
      if (!merged) continue;
      merged.name = `st-${part}-${group}-${mat}`;
      merged.parent = part === "ring" ? this.ring : this.root;
      merged.isPickable = false;
      const m = this.mats.get(mat)!;
      m.bind(merged);
      this.addGroup(group, merged);
      this.meshes.push(merged);
      if (part === "core") merged.freezeWorldMatrix();
    }
  }

  private addGroup(g: Group, m: Mesh): void {
    if (!this.groups.has(g)) this.groups.set(g, []);
    this.groups.get(g)!.push(m);
  }

  /** Mesh detail + shading per tier (Basic: core meshes, Standard; Enhanced: + detail; Extreme HD: + micro greebles). */
  setDetail(tier: GraphicsTier, pbr = PROFILES[tier].pbr): void {
    this.explicitDetail = true;
    this.applyDetail(tier, pbr);
  }

  private applyDetail(tier: GraphicsTier, pbr: boolean): void {
    this.detail = tier;
    this.pbr = pbr;
    const size = tier === "ultra" ? 1024 : tier === "enhanced" ? 512 : 256;
    if (!this.panels || !this.panels.key.endsWith(`-${size}`)) {
      const old = this.panels;
      this.panels = acquirePanels(this.scene, size, "station");
      for (const m of this.mats.values()) if (m.look.panels) m.setPanels(this.panels);
      releasePanels(this.scene, old);
    }
    for (const m of this.mats.values()) m.setMode(pbr);
    const on = (g: Group) => g === "core" || (g === "detail" && tier !== "basic") || (g === "ultra" && tier === "ultra");
    for (const [g, list] of this.groups) for (const m of list) m.setEnabled(on(g));
    for (const h of this.halos) h.mesh.setEnabled(tier !== "basic" || h.kind === "beacon" || h.kind === "mast");
  }

  update(dt: number): void {
    this.t += dt;
    if (!this.explicitDetail && this.lib) {
      const want = this.autoTier();
      if (want !== this.detail || PROFILES[want].pbr !== this.pbr) this.applyDetail(want, PROFILES[want].pbr);
    }
    this.ring.rotation.y += dt * 0.05;
    this.beacons.forEach((b, i) => (b.isVisible = Math.sin(this.t * 3 - i * 0.9) > 0));
    // Chasers run toward the pad; buoys pulse in sequence away from it (approach guidance).
    const n = this.chasers.length;
    const head = Math.floor((this.t * 10) % (n + 4));
    this.chasers.forEach((c, i) => (c.isVisible = n - 1 - i === head || n - 1 - i === head - 1));
    // Buoy rows pulse in a wave that travels in toward the pad.
    const wave = 5 - ((this.t * 1.6) % 1) * 6;
    for (const h of this.halos) {
      let s = 1;
      if (h.kind === "beacon") s = this.beacons[h.index]?.isVisible ? 1 : 0;
      else if (h.kind === "chaser") s = this.chasers[h.index]?.isVisible ? 1 : 0;
      else if (h.kind === "buoy") s = 0.6 + 0.6 * Math.max(0, 1 - Math.abs(wave - this.buoyRow[h.index]));
      else if (h.kind === "mast") s = Math.sin(this.t * 2.2 + h.index * 1.3) > 0.4 ? 1 : 0.1;
      h.mesh.isVisible = s > 0.02;
      h.mesh.scaling.setAll(h.base * Math.max(0.02, s));
    }
  }

  dispose(): void {
    this.root.dispose(false, false);
    for (const m of this.mats.values()) m.dispose();
    for (const m of this.fxMats) m.dispose();
    this.glowTex.dispose();
    this.windowTex.dispose();
    this.solarTex.dispose();
    releasePanels(this.scene, this.panels);
    this.panels = null;
    this.meshes.length = 0;
    this.groups.clear();
  }
}
