import { FreeCamera, Scene, Vector3 } from "../engine/babylon";
import { clamp, damp } from "../core/random";

export interface GroundQuery {
  groundAt(x: number, z: number): number;
}

/** Third-person camera for on-foot, chase (flight) and orbit (parked ship) modes. */
export class CameraRig {
  readonly camera: FreeCamera;
  yaw = 0;
  /** + looks down. */
  pitch = 0.25;
  /** (test/screenshot scripts set these three to frame close-ups) */
  distance = 6.5;
  desiredDistance = 6.5;
  smoothDist = 6.5;
  private readonly tmp = new Vector3();
  private readonly target = new Vector3();
  private initialized = false;

  constructor(scene: Scene) {
    this.camera = new FreeCamera("gf-cam", new Vector3(0, 10, -10), scene);
    this.camera.minZ = 0.1;
    this.camera.maxZ = 6000;
    this.camera.fov = 1.0;
    this.camera.inputs.clear();
  }

  get forward(): Vector3 {
    const cp = Math.cos(this.pitch);
    return new Vector3(Math.sin(this.yaw) * cp, -Math.sin(this.pitch), Math.cos(this.yaw) * cp);
  }

  zoom(delta: number, min: number, max: number): void {
    this.desiredDistance = clamp(this.desiredDistance + delta * 0.8, min, max);
  }

  look(dx: number, dy: number, minPitch = -0.55, maxPitch = 1.2): void {
    this.yaw += dx;
    this.pitch = clamp(this.pitch + dy, minPitch, maxPitch);
  }

  /** Place the camera behind a pivot with terrain avoidance. */
  private orbit(dt: number, pivot: Vector3, distance: number, shoulder: number, ground: GroundQuery, snap: boolean): void {
    const f = this.forward;
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    // Pull in if terrain blocks the line from pivot to camera.
    let allowed = distance;
    for (let i = 1; i <= 8; i++) {
      const t = (i / 8) * distance;
      const x = pivot.x - f.x * t + rx * shoulder;
      const y = pivot.y - f.y * t;
      const z = pivot.z - f.z * t + rz * shoulder;
      if (ground.groundAt(x, z) + 0.35 > y) {
        allowed = Math.max(1.2, t - distance / 8);
        break;
      }
    }
    if (snap || !this.initialized) this.smoothDist = allowed;
    else this.smoothDist += (allowed - this.smoothDist) * damp(allowed < this.smoothDist ? 20 : 4, dt);
    const d = this.smoothDist;
    const pos = this.tmp.set(pivot.x - f.x * d + rx * shoulder, pivot.y - f.y * d, pivot.z - f.z * d + rz * shoulder);
    pos.y = Math.max(pos.y, ground.groundAt(pos.x, pos.z) + 0.35);
    this.camera.position.copyFrom(pos);
    this.target.set(pivot.x + f.x * 20 + rx * shoulder, pivot.y + f.y * 20, pivot.z + f.z * 20 + rz * shoulder);
    this.camera.setTarget(this.target);
    this.initialized = true;
  }

  updateFoot(dt: number, playerPos: Vector3, ground: GroundQuery, snap = false): void {
    this.distance = this.desiredDistance;
    this.orbit(dt, this.tmp.set(playerPos.x, playerPos.y + 1.65, playerPos.z).clone(), this.distance, 0.6, ground, snap);
  }

  updateOrbit(dt: number, center: Vector3, distance: number, ground: GroundQuery, snap = false): void {
    this.orbit(dt, center, distance, 0, ground, snap);
  }

  /** Chase camera behind a flying ship. */
  updateChase(dt: number, pos: Vector3, yaw: number, pitch: number, ground: GroundQuery, snap = false): void {
    const camPitch = -pitch * 0.55 + 0.18;
    const cp = Math.cos(camPitch);
    const f = new Vector3(Math.sin(yaw) * cp, -Math.sin(camPitch), Math.cos(yaw) * cp);
    const dist = 21;
    const desired = new Vector3(pos.x - f.x * dist, pos.y - f.y * dist + 3.5, pos.z - f.z * dist);
    desired.y = Math.max(desired.y, ground.groundAt(desired.x, desired.z) + 1.2);
    if (snap || !this.initialized) this.camera.position.copyFrom(desired);
    else Vector3.LerpToRef(this.camera.position, desired, damp(7, dt), this.camera.position);
    this.target.set(pos.x + Math.sin(yaw) * 14, pos.y + 2 + Math.sin(pitch) * 14, pos.z + Math.cos(yaw) * 14);
    this.camera.setTarget(this.target);
    // Keep yaw/pitch in sync so leaving flight doesn't jump the view.
    this.yaw = yaw;
    this.pitch = clamp(camPitch, -0.5, 1.1);
    this.initialized = true;
  }
}
