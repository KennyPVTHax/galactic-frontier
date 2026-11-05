/**
 * GLB / skeleton pipeline (Full package): bone mapping across rig conventions, the pure gait, and the retargeting driver on a real
 * skinned GLB loaded through Babylon's glTF loader (headless NullEngine). The fixture is a generated test rig, not visual content.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3, Quaternion } from "@babylonjs/core/Maths/math.vector";
import { coreName, mapHumanoid, missingBones, type BoneInfo } from "../src/presentation/full/assets/humanoidRig";
import { GaitState } from "../src/presentation/full/assets/gait";
import { loadModel, registerGlbSupport } from "../src/presentation/full/assets/glbLoader";
import { RigDriver } from "../src/presentation/full/assets/rigDriver";

const chain = (names: string[]): BoneInfo[] => names.map((name, i) => ({ name, parent: i === 0 ? null : 0 }));

test("coreName strips rig prefixes, sides and punctuation", () => {
  assert.equal(coreName("mixamorig:LeftForeArm"), "forearm");
  assert.equal(coreName("CC_Base_L_Upperarm"), "upperarm");
  assert.equal(coreName("upper_arm.L"), "upperarm");
  assert.equal(coreName("Bip01 L Thigh"), "thigh");
  assert.equal(coreName("Armature|Hips"), "hips");
});

test("humanoid mapping works for Mixamo, Rigify, Reallusion CC and Biped naming", () => {
  const sets: Record<string, string[]> = {
    mixamo: ["mixamorig:Hips", "mixamorig:Spine", "mixamorig:Spine1", "mixamorig:Spine2", "mixamorig:Neck", "mixamorig:Head", "mixamorig:LeftShoulder", "mixamorig:LeftArm", "mixamorig:LeftForeArm", "mixamorig:LeftHand", "mixamorig:LeftHandThumb1", "mixamorig:RightShoulder", "mixamorig:RightArm", "mixamorig:RightForeArm", "mixamorig:RightHand", "mixamorig:LeftUpLeg", "mixamorig:LeftLeg", "mixamorig:LeftFoot", "mixamorig:LeftToeBase", "mixamorig:RightUpLeg", "mixamorig:RightLeg", "mixamorig:RightFoot", "mixamorig:RightToeBase"],
    rigify: ["spine", "spine.001", "spine.002", "neck", "head", "shoulder.L", "upper_arm.L", "forearm.L", "hand.L", "shoulder.R", "upper_arm.R", "forearm.R", "hand.R", "thigh.L", "shin.L", "foot.L", "toe.L", "thigh.R", "shin.R", "foot.R", "toe.R", "pelvis"],
    cc: ["CC_Base_Hip", "CC_Base_Waist", "CC_Base_Spine01", "CC_Base_Spine02", "CC_Base_NeckTwist01", "CC_Base_Head", "CC_Base_L_Clavicle", "CC_Base_L_Upperarm", "CC_Base_L_Forearm", "CC_Base_L_Hand", "CC_Base_R_Clavicle", "CC_Base_R_Upperarm", "CC_Base_R_Forearm", "CC_Base_R_Hand", "CC_Base_L_Thigh", "CC_Base_L_Calf", "CC_Base_L_Foot", "CC_Base_R_Thigh", "CC_Base_R_Calf", "CC_Base_R_Foot"],
    biped: ["Bip01 Pelvis", "Bip01 Spine", "Bip01 Spine1", "Bip01 Neck", "Bip01 Head", "Bip01 L Clavicle", "Bip01 L UpperArm", "Bip01 L Forearm", "Bip01 L Hand", "Bip01 R Clavicle", "Bip01 R UpperArm", "Bip01 R Forearm", "Bip01 R Hand", "Bip01 L Thigh", "Bip01 L Calf", "Bip01 L Foot", "Bip01 R Thigh", "Bip01 R Calf", "Bip01 R Foot"],
  };
  for (const [rig, names] of Object.entries(sets)) {
    const m = mapHumanoid(chain(names));
    assert.deepEqual(missingBones(m), [], `${rig}: all required bones found`);
    const n = (k: keyof typeof m) => names[m[k] as number];
    assert.match(n("lArm").toLowerCase(), /arm/, rig);
    assert.ok(!/fore|lower/i.test(n("lArm")), `${rig}: upper arm is not the forearm`);
    assert.match(n("lForeArm").toLowerCase(), /fore/, rig);
    assert.match(n("lLeg").toLowerCase(), /leg|shin|calf/, rig);
    assert.ok(!/up/i.test(n("lLeg")) && !/thigh/i.test(n("lLeg")), `${rig}: lower leg is not the thigh`);
    assert.match(n("lUpLeg").toLowerCase(), /upleg|thigh/, rig);
    assert.ok(/left|\.l|_l_|\bl\b/i.test(n("lArm")) && /right|\.r|_r_|\br\b/i.test(n("rArm")), `${rig}: sides`);
  }
  // fingers and twist helpers are never mistaken for the hand / arm
  const m = mapHumanoid(chain(["Hips", "LeftArm", "LeftArmTwist", "LeftHand", "LeftHandIndex1"]));
  assert.equal(m.lHand, 3);
  assert.equal(m.lArm, 1);
});

test("gait: idle is calm, running swings the legs, jet and aim set their poses", () => {
  const g = new GaitState();
  let p = g.update(0.016, 0, true, false, false, 0);
  for (let i = 0; i < 60; i++) p = g.update(0.016, 0, true, false, false, 0);
  assert.ok(Math.abs(p.thighX[0]) < 0.05 && p.jet === 0);
  let maxSwing = 0;
  for (let i = 0; i < 240; i++) { p = g.update(0.016, 8, true, false, false, 0); maxSwing = Math.max(maxSwing, Math.abs(p.thighX[0])); }
  assert.ok(maxSwing > 0.4, `running swing ${maxSwing}`);
  for (let i = 0; i < 120; i++) p = g.update(0.016, 0, false, true, false, 0, 3);
  assert.ok(p.jet > 0.8);
  for (let i = 0; i < 120; i++) p = g.update(0.016, 0, true, false, true, 0.2);
  assert.ok(p.armX[1] < -1.2 && p.grip[1] > 0.7, "right arm raised and gripping the tool");
});

/** Loads the fixture through the real glTF loader on a headless engine. */
async function loadFixture() {
  registerGlbSupport();
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const bytes = readFileSync(fileURLToPath(new URL("./fixtures/humanoid-test.glb", import.meta.url)));
  const url = "data:application/octet-stream;base64," + bytes.toString("base64");
  const r = await loadModel(scene, url, 20000);
  assert.ok(r.ok, r.ok ? "" : r.reason);
  if (!r.ok) throw new Error("unreachable");
  r.model.container.addAllToScene();
  const frame = (r.model.container.meshes.find((m) => m.name === "__root__") ?? null) as TransformNode | null;
  return { scene, model: r.model, frame, engine };
}
const bone = (nodes: TransformNode[], n: string) => nodes.find((x) => x.name === "mixamorig:" + n)!;
const wp = (n: TransformNode) => { n.computeWorldMatrix(true); return n.getAbsolutePosition().clone(); };

test("the fixture loads through the glTF loader as a skinned, animated, PBR model", async () => {
  const { model } = await loadFixture();
  assert.equal(model.skeletons.length, 1);
  assert.equal(model.skeletons[0].bones.length, 22);
  assert.equal(model.clips.length, 1);
  assert.equal(model.clips[0].name, "Walk");
  const mesh = model.meshes.find((m) => m.getTotalVertices() > 0)!;
  assert.ok(mesh.skeleton, "mesh is skinned");
  assert.ok(mesh.material && mesh.material.getClassName() === "PBRMaterial", "PBR material");
});

test("rig driver: T-pose arms are brought down, and commands move the limbs the right way", async () => {
  const { model, frame, scene } = await loadFixture();
  const rd = new RigDriver(frame, model.nodes);
  assert.ok(rd.usable, `missing ${rd.missing.join(",")}`);
  const nodes = model.nodes;
  const hand = bone(nodes, "LeftHand"), arm = bone(nodes, "LeftArm"), foot = bone(nodes, "LeftFoot"), hips = bone(nodes, "Hips");
  const restHand = wp(hand), restArm = wp(arm);
  assert.ok(Math.abs(restHand.y - restArm.y) < 0.05, "fixture is a T-pose (hand level with the shoulder)");
  const neutral = new GaitState().update(0.016, 0, true, false, false, 0);
  rd.applyPose({ ...neutral, armX: [0, 0], armZ: [0, 0], foreX: [0, 0], thighX: [0, 0], thighZ: [0, 0], shinX: [0, 0], ankleX: [0, 0], hipsX: 0, hipsY_rot: 0, hipsZ: 0, chestX: 0, chestY: 0, chestZ: 0, headX: 0, headY: 0, headZ: 0, hipsY: 0 });
  const down = wp(hand);
  assert.ok(restArm.y - down.y > 0.4, `arm hangs down: hand ${down.y.toFixed(2)} vs shoulder ${wp(arm).y.toFixed(2)}`);
  assert.ok(Math.abs(wp(foot).y - wp(hips).y) > 0.8, "legs stay straight down");
  // a forward leg swing: same direction as the procedural astronaut's `thigh.rotation.x = +θ`
  const ref = new TransformNode("ref", scene); const refKnee = new TransformNode("refKnee", scene); refKnee.parent = ref; refKnee.position.set(0, -0.4, 0);
  ref.rotation.x = 0.5; refKnee.computeWorldMatrix(true);
  const procZ = refKnee.getAbsolutePosition().z;
  const footBefore = wp(foot);
  rd.applyPose({ ...neutral, armX: [0, 0], armZ: [0, 0], foreX: [0, 0], thighX: [0.5, 0], thighZ: [0, 0], shinX: [0, 0], ankleX: [0, 0], hipsX: 0, hipsY_rot: 0, hipsZ: 0, chestX: 0, chestY: 0, chestZ: 0, headX: 0, headY: 0, headZ: 0, hipsY: 0 });
  const footAfter = wp(foot);
  assert.ok(Math.abs(footAfter.z - footBefore.z) > 0.2, "foot swings");
  assert.equal(Math.sign(footAfter.z - footBefore.z), Math.sign(procZ), "same swing direction as the procedural rig");
  // elbow flexion command bends the forearm the same way as the procedural rig (about the side axis once the arm hangs)
  const fore = bone(nodes, "LeftForeArm");
  rd.reset();
  rd.applyPose({ ...neutral, armX: [0, 0], armZ: [0, 0], foreX: [-1.0, 0], thighX: [0, 0], thighZ: [0, 0], shinX: [0, 0], ankleX: [0, 0], hipsX: 0, hipsY_rot: 0, hipsZ: 0, chestX: 0, chestY: 0, chestZ: 0, headX: 0, headY: 0, headZ: 0, hipsY: 0 });
  const elbow = wp(fore), handNow = wp(hand);
  const refA = new TransformNode("refA", scene); const refB = new TransformNode("refB", scene); refB.parent = refA; refB.position.set(0, -0.3, 0); refA.rotation.x = -1.0; refA.computeWorldMatrix(true); refB.computeWorldMatrix(true);
  assert.equal(Math.sign(handNow.z - elbow.z), Math.sign(refB.getAbsolutePosition().z - refA.getAbsolutePosition().z), "elbow bends toward the same side");
  rd.reset();
  const back = wp(hand);
  assert.ok(Vector3.Distance(back, restHand) < 0.02, "reset restores the authored rest pose");
  void Quaternion;
});

test("loading a missing model resolves with a reason instead of throwing (safe fallback)", async () => {
  registerGlbSupport();
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const r = await loadModel(scene, "data:application/octet-stream;base64,AAAA", 3000);
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.reason.length > 0);
});
