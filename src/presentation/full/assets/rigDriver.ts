/**
 * Drives ANY humanoid skeleton from the game's few animation inputs, whatever its rest pose (T-pose, A-pose) or bone-axis convention.
 *
 * Method (retargeting by world-space deltas): for every controlled bone we know its rest world rotation, expressed in the skeleton's own
 * frame (the node tree below the glTF loader's coordinate-conversion root). A command is a rotation in the character frame
 * (X = side axis, Y = up, Z = forward). The bone's new local rotation is solved top-down so that
 *      desiredWorld = command * parentDelta * restWorld,   local = inverse(currentParentWorld) * desiredWorld
 * which makes the same "knee bends 40°" command work on a Mixamo T-pose and a Rigify A-pose. Arms get an extra base rotation that brings
 * the rest direction (shoulder->elbow) to hang down, so authored T-pose characters walk with their arms at their sides.
 *
 * The loader converts glTF's right-handed space to Babylon's left-handed one with a mirrored root; all maths here stays in the glTF
 * (right-handed) frame, so commands authored for Babylon's frame are reflected (y,z quaternion components negated) on the way in.
 */
import { Quaternion, TransformNode, Vector3, Matrix } from "../../../engine/babylon";
import { HUMANOID_BONES, mapHumanoid, missingBones, type HumanoidBone, type HumanoidMap } from "./humanoidRig";
import type { Pose } from "./gait";

const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);
const DOWN = new Vector3(0, -1, 0);

const rot = (axis: Vector3, a: number): Quaternion => Quaternion.RotationAxis(axis, a);
/** Reflect a Babylon-frame rotation into the glTF frame (mirror across the YZ plane). */
const reflect = (q: Quaternion): Quaternion => new Quaternion(q.x, -q.y, -q.z, q.w);
const mul = (a: Quaternion, b: Quaternion): Quaternion => a.multiply(b);
const inv = (q: Quaternion): Quaternion => Quaternion.Inverse(q);
const IDENT = () => Quaternion.Identity();

function fromTo(a: Vector3, b: Vector3): Quaternion {
  const u = a.normalizeToNew(), v = b.normalizeToNew();
  const d = Vector3.Dot(u, v);
  if (d > 0.999999) return IDENT();
  if (d < -0.999999) return rot(Z, Math.PI);
  const axis = Vector3.Cross(u, v).normalize();
  return rot(axis, Math.acos(Math.max(-1, Math.min(1, d))));
}

interface Ctl {
  key: HumanoidBone;
  node: TransformNode;
  parent: TransformNode | null;
  restLocal: Quaternion;
  restWorld: Quaternion;
  base: Quaternion;
}

export class RigDriver {
  readonly map: HumanoidMap;
  readonly missing: HumanoidBone[];
  private readonly nodes: TransformNode[];
  private readonly ctl = new Map<HumanoidBone, Ctl>();
  private readonly order: HumanoidBone[] = [];
  private readonly hipsRestPos = new Vector3();

  /**
   * @param frameRoot     the loader's coordinate-conversion root (`__root__`); rotations are measured below it, in glTF space
   * @param nodes         every TransformNode of the model (bones among them)
   */
  constructor(private readonly frameRoot: TransformNode | null, nodes: TransformNode[]) {
    this.nodes = nodes;
    // Rest world rotation of EVERY node, captured before anything is posed.
    for (const n of nodes) this.restCache.set(n, this.worldRot(n).clone());
    const index = new Map(nodes.map((n, i) => [n, i] as const));
    const info = nodes.map((n) => ({ name: n.name, parent: n.parent && index.has(n.parent as TransformNode) ? (index.get(n.parent as TransformNode) as number) : null }));
    this.map = mapHumanoid(info);
    this.missing = missingBones(this.map);
    this.bind();
  }

  get usable(): boolean {
    return this.missing.length === 0;
  }

  private local(n: TransformNode): Quaternion {
    if (!n.rotationQuaternion) n.rotationQuaternion = Quaternion.FromEulerVector(n.rotation);
    return n.rotationQuaternion;
  }

  /** World rotation of `n` in the glTF frame = product of local rotations from the skeleton root down. */
  private worldRot(n: TransformNode | null): Quaternion {
    if (!n || n === this.frameRoot) return IDENT();
    const stack: TransformNode[] = [];
    for (let c: TransformNode | null = n; c && c !== this.frameRoot; c = c.parent as TransformNode | null) stack.push(c);
    let q = IDENT();
    for (let i = stack.length - 1; i >= 0; i--) q = mul(q, this.local(stack[i]));
    return q;
  }

  private bind(): void {
    // rest positions in the glTF frame, from the node chain (translation rotated by parent rotation, scaled by parent scale)
    const restPos = new Map<TransformNode, Vector3>();
    const posOf = (n: TransformNode): Vector3 => {
      const c = restPos.get(n);
      if (c) return c;
      const par = n.parent as TransformNode | null;
      let p: Vector3;
      if (!par || par === this.frameRoot) p = n.position.clone();
      else {
        const pr = this.worldRot(par);
        const m = new Matrix();
        pr.toRotationMatrix(m);
        const sc = par.scaling;
        p = Vector3.TransformCoordinates(new Vector3(n.position.x * sc.x, n.position.y * sc.y, n.position.z * sc.z), m).add(posOf(par));
      }
      restPos.set(n, p);
      return p;
    };
    for (const key of HUMANOID_BONES) {
      const i = this.map[key];
      if (i === undefined) continue;
      const node = this.nodes[i];
      const restLocal = this.local(node).clone();
      const restWorld = this.worldRot(node).clone();
      let base = IDENT();
      if (key === "lArm" || key === "rArm") {
        const child = this.map[key === "lArm" ? "lForeArm" : "rForeArm"];
        if (child !== undefined) {
          const dir = posOf(this.nodes[child]).subtract(posOf(node));
          // Authored T/A poses: bring the upper arm to hang down (children inherit through parentDelta).
          base = fromTo(dir, DOWN);
        }
      }
      this.ctl.set(key, { key, node, parent: node.parent as TransformNode | null, restLocal, restWorld, base });
      this.order.push(key);
    }
    // top-down order = by depth
    const depth = (n: TransformNode) => { let d = 0; for (let c = n.parent as TransformNode | null; c; c = c.parent as TransformNode | null) d++; return d; };
    this.order.sort((a, b) => depth(this.ctl.get(a)!.node) - depth(this.ctl.get(b)!.node));
    const hips = this.map.hips !== undefined ? this.nodes[this.map.hips] : null;
    if (hips) this.hipsRestPos.copyFrom(hips.position);
  }

  /** Restores the rest pose. */
  reset(): void {
    for (const c of this.ctl.values()) this.local(c.node).copyFrom(c.restLocal);
    const hips = this.map.hips !== undefined ? this.nodes[this.map.hips] : null;
    if (hips) hips.position.copyFrom(this.hipsRestPos);
  }

  /** Solve a command (character-frame, Babylon convention) for one bone. */
  private apply(key: HumanoidBone, cmd: Quaternion, withBase = false): void {
    const c = this.ctl.get(key);
    if (!c) return;
    const parentNow = this.worldRot(c.parent);
    // delta of the parent versus rest: parentNow * inverse(parentRest)
    const parentRest = c.parent ? this.restOf(c.parent) : IDENT();
    const parentDelta = mul(parentNow, inv(parentRest));
    const command = reflect(cmd);
    const desired = mul(command, mul(parentDelta, mul(withBase ? c.base : IDENT(), c.restWorld)));
    const local = mul(inv(parentNow), desired);
    this.local(c.node).copyFrom(local.normalize());
  }

  private readonly restCache = new Map<TransformNode, Quaternion>();
  private restOf(n: TransformNode): Quaternion {
    return this.restCache.get(n) ?? IDENT();
  }

  /** Apply a full pose. Commands use the same axes/signs as `AstronautFull` (Babylon frame, +Z forward, X side). */
  applyPose(p: Pose, scale = 1): void {
    const E = (x: number, y: number, z: number) => mul(rot(Y, y), mul(rot(X, x), rot(Z, z)));
    const hips = this.map.hips !== undefined ? this.nodes[this.map.hips] : null;
    if (hips) hips.position.set(this.hipsRestPos.x, this.hipsRestPos.y + p.hipsY / Math.max(1e-6, scale), this.hipsRestPos.z);
    for (const key of this.order) {
      switch (key) {
        case "hips": this.apply(key, E(p.hipsX, p.hipsY_rot, p.hipsZ)); break;
        case "chest": this.apply(key, E(p.chestX, p.chestY, p.chestZ)); break;
        case "head": this.apply(key, E(p.headX, p.headY, p.headZ)); break;
        case "lArm": this.apply(key, mul(E(p.armX[0], 0, p.armZ[0]), IDENT()), true); break;
        case "rArm": this.apply(key, mul(E(p.armX[1], 0, p.armZ[1]), IDENT()), true); break;
        case "lForeArm": this.apply(key, rot(X, p.foreX[0])); break;
        case "rForeArm": this.apply(key, rot(X, p.foreX[1])); break;
        case "lUpLeg": this.apply(key, E(p.thighX[0], 0, p.thighZ[0])); break;
        case "rUpLeg": this.apply(key, E(p.thighX[1], 0, p.thighZ[1])); break;
        case "lLeg": this.apply(key, rot(X, p.shinX[0])); break;
        case "rLeg": this.apply(key, rot(X, p.shinX[1])); break;
        case "lFoot": this.apply(key, rot(X, p.ankleX[0])); break;
        case "rFoot": this.apply(key, rot(X, p.ankleX[1])); break;
        default: break;
      }
    }
  }

  /** World position of a bone (Babylon world frame) — used to pin the mining-laser muzzle to the right hand. */
  bone(key: HumanoidBone): TransformNode | null {
    const i = this.map[key];
    return i === undefined ? null : this.nodes[i];
  }
}
