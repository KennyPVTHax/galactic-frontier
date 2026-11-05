/**
 * Warp-travel effect: star streaks that stretch past the camera plus a FOV kick.
 * One thin-instanced mesh (1 draw call); the streak count comes from the render profile
 * (Basic 120 · Enhanced/Extreme more) so it stays cheap on Telegram.
 */
import { Camera, Color3, Material, Matrix, Mesh, MeshBuilder, Quaternion, Scene, StandardMaterial, Vector3 } from "../engine/babylon";

export type WarpPhase = "idle" | "spool" | "tunnel" | "exit";

export class WarpFx {
  private readonly mesh: Mesh;
  private readonly mat: StandardMaterial;
  private readonly buf: Float32Array;
  private readonly seeds: Float32Array;
  private readonly count: number;
  private phase: WarpPhase = "idle";
  private amount = 0;
  private baseFov = 0;
  private time = 0;
  private disposed = false;
  private readonly tmpS = new Vector3();
  private readonly tmpT = new Vector3();
  private readonly q = Quaternion.Identity();

  constructor(
    private readonly scene: Scene,
    private readonly camera: Camera,
    streaks = 120,
  ) {
    this.count = Math.max(24, Math.min(600, Math.round(streaks)));
    this.mesh = MeshBuilder.CreateBox("gf-warp-streaks", { size: 1 }, scene);
    this.mesh.isPickable = false;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.parent = camera;
    this.mesh.renderingGroupId = 1;
    this.mat = new StandardMaterial("gf-warp-mat", scene);
    this.mat.disableLighting = true;
    this.mat.emissiveColor = new Color3(0.7, 0.9, 1);
    this.mat.alpha = 0;
    this.mat.alphaMode = 1; // ALPHA_ADD
    this.mat.backFaceCulling = false;
    this.mat.disableDepthWrite = true;
    this.mat.transparencyMode = Material.MATERIAL_ALPHABLEND;
    this.mesh.material = this.mat;
    this.buf = new Float32Array(this.count * 16);
    this.seeds = new Float32Array(this.count * 3); // angle, radius, depth 0..1
    for (let i = 0; i < this.count; i++) {
      this.seeds[i * 3] = Math.random() * Math.PI * 2;
      this.seeds[i * 3 + 1] = 3 + Math.random() * 28;
      this.seeds[i * 3 + 2] = Math.random();
    }
    this.mesh.thinInstanceSetBuffer("matrix", this.buf, 16, false);
    this.mesh.setEnabled(false);
  }

  /** `t` is progress through the phase (0..1). */
  setPhase(phase: WarpPhase, t = 0): void {
    if (this.disposed) return;
    if (phase === "idle") {
      if (this.phase !== "idle" && this.baseFov > 0) this.camera.fov = this.baseFov;
      this.phase = "idle";
      this.amount = 0;
      this.mesh.setEnabled(false);
      this.mat.alpha = 0;
      this.baseFov = 0;
      return;
    }
    if (this.phase === "idle") this.baseFov = this.camera.fov;
    this.phase = phase;
    this.amount = phase === "spool" ? t * 0.55 : phase === "tunnel" ? 0.55 + t * 0.45 : 1 - t;
    this.mesh.setEnabled(true);
    this.mat.alpha = Math.min(1, 0.15 + this.amount * 0.85);
    if (this.baseFov > 0) this.camera.fov = this.baseFov * (1 + this.amount * 0.38);
  }

  update(dt: number): void {
    if (this.disposed || this.phase === "idle") return;
    this.time += dt;
    const speed = 40 + this.amount * 520;
    const len = 1 + this.amount * this.amount * 90;
    const m = Matrix.Identity();
    for (let i = 0; i < this.count; i++) {
      let d = this.seeds[i * 3 + 2] - (speed * dt) / 900;
      if (d < 0) d += 1;
      this.seeds[i * 3 + 2] = d;
      const a = this.seeds[i * 3];
      const r = this.seeds[i * 3 + 1];
      const z = 4 + d * 900;
      this.tmpS.set(0.05 + this.amount * 0.05, 0.05 + this.amount * 0.05, len);
      this.tmpT.set(Math.cos(a) * r, Math.sin(a) * r, z);
      Matrix.ComposeToRef(this.tmpS, this.q, this.tmpT, m);
      m.copyToArray(this.buf, i * 16);
    }
    this.mesh.thinInstanceBufferUpdated("matrix");
  }

  get active(): boolean {
    return this.phase !== "idle";
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.phase !== "idle" && this.baseFov > 0) this.camera.fov = this.baseFov;
    this.mesh.dispose(false, true);
    this.mat.dispose();
  }
}
