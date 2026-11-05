/**
 * The Android / desktop FULL astronaut: a professionally authored, skinned, PBR glTF 2.0 / GLB character when one is shipped, and the
 * procedural `AstronautFull` as a SAFE FALLBACK when none is (or it fails to load, or the graphics tier is Basic).
 *
 * Same public API as the simple astronaut, so Player / game code is unchanged: `root` is positioned and rotated by the player,
 * `animate()` gets the same inputs, `muzzle` is a node whose absolute position is where the mining beam starts.
 * No gameplay value is read from or written to the model: collision, hit-boxes, movement and interactions live in `Player`.
 *
 * The procedural astronaut is NOT the realistic character; `status.mode` reports honestly which one is on screen.
 */
import { TransformNode, Vector3, Scene, StandardMaterial, Color3, Mesh, MeshBuilder } from "../../engine/babylon";
import type { AbstractMesh } from "../../engine/babylon";
import type { MaterialLibrary } from "../../graphics/materials";
import { AstronautFull } from "./astronautFull";
import { fetchManifest, loadModel, registerGlbSupport, type AssetEntry, type LoadedModel } from "./assets/glbLoader";
import { GaitState } from "./assets/gait";
import { RigDriver } from "./assets/rigDriver";

export type HeroMode = "procedural" | "loading" | "glb" | "failed";
export interface HeroStatus {
  mode: HeroMode;
  /** Why the procedural fallback is on screen (when it is). */
  detail: string;
  url?: string;
  loadMs?: number;
  triangles?: number;
  meshes?: number;
  missingBones?: string[];
  license?: AssetEntry["license"];
}

declare const __GF_DEBUG__: boolean | undefined;

declare global {
  interface Window {
    /** Debug/test override for where models are served from (`?models=` in main.ts). */
    gfModelsBase?: string;
  }
}

export class AstronautHero {
  readonly root: TransformNode;
  status: HeroStatus = { mode: "procedural", detail: "no hero asset requested yet" };
  private readonly fallback: AstronautFull;
  private readonly muzzleProc: TransformNode;
  private readonly muzzleGlb: TransformNode;
  private glb: { holder: TransformNode; model: LoadedModel; rig: RigDriver; flames: Mesh[]; scale: number } | null = null;
  private readonly gait = new GaitState();
  private tier = "basic";
  private started = false;
  private visible = true;

  constructor(private readonly scene: Scene, private readonly lib: MaterialLibrary) {
    this.root = new TransformNode("astronaut", scene);
    this.fallback = new AstronautFull(scene, lib);
    this.fallback.root.parent = this.root;
    this.muzzleProc = this.fallback.muzzle;
    this.muzzleGlb = new TransformNode("astro-muzzle-glb", scene);
    this.muzzleGlb.parent = this.root;
  }

  get meshes(): AbstractMesh[] {
    return this.glb ? (this.glb.model.meshes.filter((m) => m.getTotalVertices() > 0) as AbstractMesh[]) : this.fallback.meshes;
  }
  get muzzle(): TransformNode {
    return this.glb ? this.muzzleGlb : this.muzzleProc;
  }
  get position(): Vector3 {
    return this.root.position;
  }
  get usingAuthoredModel(): boolean {
    return !!this.glb;
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.root.setEnabled(v);
  }

  /** Called by the game whenever the graphics tier is (re)applied. Starts the one-time asset load for Enhanced / Extreme HD. */
  setTier(tier: string): void {
    this.tier = tier;
    if (tier === "basic") {
      // Basic keeps the cheap procedural character: no download, no skinned mesh.
      if (this.glb) this.glb.holder.setEnabled(false);
      this.fallback.root.setEnabled(true);
      if (!this.glb) this.status = { mode: "procedural", detail: "Basic tier" };
      return;
    }
    if (this.glb) {
      this.glb.holder.setEnabled(true);
      this.fallback.root.setEnabled(false);
      return;
    }
    if (!this.started) {
      this.started = true;
      void this.loadHero();
    }
  }

  private async loadHero(): Promise<void> {
    this.status = { mode: "loading", detail: "looking for models/manifest.json" };
    // The override is a debug/test affordance only; esbuild folds it away in release and Android builds.
    const debugBase = typeof __GF_DEBUG__ === "undefined" || __GF_DEBUG__ ? window.gfModelsBase : undefined;
    const base = debugBase || new URL("models/", document.baseURI).toString();
    // A page opened straight from disk (file://) cannot fetch its own files; skip the lookup instead of logging a CORS error.
    if (!debugBase && new URL(base).protocol === "file:") {
      this.status = { mode: "procedural", detail: "page opened from file:// — models cannot be fetched; procedural fallback in use" };
      return;
    }
    const found = await fetchManifest(base);
    if (!found) {
      this.status = { mode: "procedural", detail: "no hero asset shipped (models/manifest.json not found) — procedural fallback in use" };
      return;
    }
    registerGlbSupport(found.manifest.decoders ? this.resolveDecoders(found.manifest.decoders, base) : {});
    const entry = found.manifest.assets["astronaut"];
    const rel = entry && (this.tier === "ultra" ? entry.variants.ultra ?? entry.variants.enhanced : entry.variants.enhanced ?? entry.variants.ultra);
    if (!entry || !rel) {
      this.status = { mode: "procedural", detail: "manifest has no astronaut entry for this tier — procedural fallback in use" };
      return;
    }
    const url = new URL(rel, base).toString();
    const r = await loadModel(this.scene, url);
    if (!r.ok) {
      this.status = { mode: "failed", detail: `GLB failed to load (${r.reason}) — procedural fallback in use`, url };
      return;
    }
    try {
      this.adopt(r.model, entry, url);
    } catch (e) {
      r.model.container.dispose();
      this.status = { mode: "failed", detail: `GLB could not be set up (${e instanceof Error ? e.message : String(e)}) — procedural fallback in use`, url };
    }
  }

  private resolveDecoders(d: NonNullable<Parameters<typeof registerGlbSupport>[0]>, base: string): NonNullable<Parameters<typeof registerGlbSupport>[0]> {
    const abs = (u: string) => new URL(u, base).toString();
    const out: NonNullable<Parameters<typeof registerGlbSupport>[0]> = {};
    if (d.draco) out.draco = { wasmUrl: abs(d.draco.wasmUrl), wasmBinaryUrl: abs(d.draco.wasmBinaryUrl), fallbackUrl: abs(d.draco.fallbackUrl) };
    if (d.ktx2) out.ktx2 = Object.fromEntries(Object.entries(d.ktx2).map(([k, v]) => [k, abs(v as string)])) as NonNullable<typeof d.ktx2>;
    return out;
  }

  private adopt(model: LoadedModel, entry: AssetEntry, url: string): void {
    model.container.addAllToScene();
    const frame = (model.container.meshes.find((m) => m.name === "__root__") ?? model.container.transformNodes.find((n) => n.name === "__root__") ?? null) as TransformNode | null;
    const rig = new RigDriver(frame, model.nodes);
    if (!rig.usable) {
      model.container.dispose();
      this.status = { mode: "failed", detail: `skeleton is missing required humanoid bones (${rig.missing.join(", ")}) — procedural fallback in use`, url, missingBones: rig.missing };
      return;
    }
    // Normalise: feet on the ground, requested height, facing +Z.
    const holder = new TransformNode("astro-glb", this.scene);
    holder.parent = this.root;
    if (frame) frame.parent = holder;
    else for (const n of model.container.rootNodes) (n as TransformNode).parent = holder;
    holder.computeWorldMatrix(true);
    const skinned = model.meshes.filter((m) => m.getTotalVertices() > 0);
    for (const m of skinned) m.refreshBoundingInfo({ applySkeleton: true });
    let minY = Infinity, maxY = -Infinity;
    for (const m of skinned) {
      const b = m.getBoundingInfo().boundingBox;
      minY = Math.min(minY, b.minimumWorld.y);
      maxY = Math.max(maxY, b.maximumWorld.y);
    }
    const h = Math.max(1e-3, maxY - minY);
    const scale = (entry.height ?? 1.8) / h;
    holder.scaling.setAll(scale);
    holder.position.y = -minY * scale + this.root.position.y * 0;
    holder.rotation.y = entry.yaw ?? this.detectYaw(rig, holder);
    for (const m of skinned) {
      m.isPickable = false;
      m.alwaysSelectAsActiveMesh = true; // skinned bounds do not follow the pose; the character is always in view when on foot
      const mat = m.material as { environmentIntensity?: number } | null;
      if (mat && "environmentIntensity" in mat) mat.environmentIntensity = 1.1;
    }
    for (const g of model.clips) g.stop();
    // Jetpack flames (the authored model has none): two cones behind the shoulder blades.
    const flameMat = new StandardMaterial("astro-hero-flame", this.scene);
    flameMat.emissiveColor = new Color3(0.45, 0.8, 1);
    flameMat.disableLighting = true;
    flameMat.alpha = 0.75;
    const flames: Mesh[] = [];
    for (const sx of [-0.13, 0.13]) {
      const f = MeshBuilder.CreateCylinder("astro-hero-flame", { height: 0.62, diameterTop: 0.13, diameterBottom: 0, tessellation: 10 }, this.scene);
      f.parent = this.root;
      f.position.set(sx, 0.72, -0.34);
      f.material = flameMat;
      f.isPickable = false;
      f.setEnabled(false);
      flames.push(f);
    }
    this.glb = { holder, model, rig, flames, scale };
    this.fallback.root.setEnabled(false);
    this.status = {
      mode: "glb",
      detail: "authored GLB active",
      url,
      loadMs: model.loadMs,
      meshes: skinned.length,
      triangles: Math.round(skinned.reduce((a, m) => a + m.getTotalIndices() / 3, 0)),
      license: entry.license,
    };
  }

  /** Rotation about Y that makes the authored model face +Z (game forward): measured from the left foot -> toe direction at rest. */
  private detectYaw(rig: RigDriver, holder: TransformNode): number {
    const foot = rig.bone("lFoot") ?? rig.bone("rFoot");
    const toe = rig.bone("lToe") ?? rig.bone("rToe");
    if (!foot || !toe) return 0;
    holder.computeWorldMatrix(true);
    foot.computeWorldMatrix(true);
    toe.computeWorldMatrix(true);
    this.root.computeWorldMatrix(true);
    const inv = this.root.getWorldMatrix().clone().invert();
    const v = Vector3.TransformCoordinates(toe.getAbsolutePosition(), inv).subtract(Vector3.TransformCoordinates(foot.getAbsolutePosition(), inv));
    if (Math.hypot(v.x, v.z) < 1e-4) return 0;
    return -Math.atan2(v.x, v.z);
  }

  animate(dt: number, speed: number, grounded: boolean, jetting: boolean, aiming: boolean, aimPitch: number, vy = 0): void {
    if (!this.glb) {
      this.fallback.animate(dt, speed, grounded, jetting, aiming, aimPitch, vy);
      return;
    }
    const pose = this.gait.update(dt, speed, grounded, jetting, aiming, aimPitch, vy);
    this.glb.rig.applyPose(pose, this.glb.scale);
    for (const f of this.glb.flames) {
      f.setEnabled(pose.jet > 0);
      if (pose.jet > 0) {
        f.scaling.y = (0.8 + 0.2 * Math.sin(performance.now() * 0.06)) * pose.jet;
        f.rotation.x = pose.gimbal;
      }
    }
    // Mining beam origin: just past the right hand, along the forearm direction (the authored model has no tool prop yet).
    const hand = this.glb.rig.bone("rHand"), fore = this.glb.rig.bone("rForeArm");
    if (hand && fore) {
      hand.computeWorldMatrix(true);
      fore.computeWorldMatrix(true);
      const hp = hand.getAbsolutePosition();
      const dir = hp.subtract(fore.getAbsolutePosition()).normalize();
      const world = hp.add(dir.scale(0.28));
      this.muzzleGlb.position.copyFrom(Vector3.TransformCoordinates(world, this.root.getWorldMatrix().clone().invert()));
    }
  }

  /** Render-cost numbers for reports (geometry only; not a frame rate). */
  stats(): { mode: HeroMode; meshes: number; triangles: number } {
    if (this.glb) return { mode: "glb", meshes: this.status.meshes ?? 0, triangles: this.status.triangles ?? 0 };
    return { mode: this.status.mode, ...this.fallback.stats() };
  }
}
