/**
 * Humanoid bone mapping: finds the standard bones in an arbitrary authored skeleton (Mixamo, Rigify/Blender, AccuRig/Reallusion CC,
 * 3ds Max Biped, Unreal-style names, …) by normalised name, so a rigged GLB can be driven without hand-written per-asset tables.
 * Pure: it only needs `{ name, parent }` pairs, so it is unit-tested without an engine.
 */
export const HUMANOID_BONES = [
  "hips", "spine", "chest", "neck", "head",
  "lShoulder", "lArm", "lForeArm", "lHand", "rShoulder", "rArm", "rForeArm", "rHand",
  "lUpLeg", "lLeg", "lFoot", "lToe", "rUpLeg", "rLeg", "rFoot", "rToe",
] as const;
export type HumanoidBone = (typeof HUMANOID_BONES)[number];
export type HumanoidMap = Partial<Record<HumanoidBone, number>>;

export interface BoneInfo {
  name: string;
  parent: number | null;
}

const FINGER = /thumb|index|middle|ring|pinky|pinkie|finger|little/;
const SKIP = /twist|roll|helper|ik$|ik_|_ik|pole|corrective|end$|top$|nub|jiggle|cloth|cape|weapon|prop|gun|tool|attach|socket/;

function sideOf(raw: string): "l" | "r" | null {
  const s = raw.toLowerCase();
  if (/left/.test(s)) return "l";
  if (/right/.test(s)) return "r";
  if (/(^|[^a-z])l([^a-z]|$)/.test(s) || /^l[A-Z]/.test(raw) || /[a-z]_l$/.test(s) || /\.l$/.test(s)) return "l";
  if (/(^|[^a-z])r([^a-z]|$)/.test(s) || /^r[A-Z]/.test(raw) || /[a-z]_r$/.test(s) || /\.r$/.test(s)) return "r";
  return null;
}

/** Lower-case, strips rig prefixes/side words/punctuation: "mixamorig:LeftForeArm" -> "forearm". */
export function coreName(raw: string): string {
  let s = raw.toLowerCase();
  s = s.replace(/^.*[:|]/, ""); // "mixamorig:Hips", "Armature|Hips"
  s = s.replace(/^(bip0*1 |bip0*1_|bip0*1|cc_base_|def[-_.]|deform[-_.]|org[-_.]|mch[-_.]|j_bip_[lcr]_|j_)/, "");
  s = s.replace(/left|right/g, "");
  s = s.replace(/(^|[._\- ])[lr]([._\- ]|$)/g, "$1$2");
  s = s.replace(/[^a-z]/g, ""); // drop digits and separators
  return s;
}

function classify(core: string, raw: string): HumanoidBone | "spineish" | null {
  if (SKIP.test(raw.toLowerCase()) || FINGER.test(core)) return null;
  if (/^(hips|pelvis|hip)$/.test(core)) return "hips";
  if (/^(spine|abdomen|chest|upperchest|lowerchest|torso|trunk)$/.test(core)) return "spineish";
  if (core === "neck") return "neck";
  if (core === "head") return "head";
  if (/^(shoulder|clavicle|collar)$/.test(core)) return "lShoulder"; // side applied by caller
  if (/^(upperarm|arm|armupper|uparm)$/.test(core)) return "lArm";
  if (/^(forearm|lowerarm|armlower|elbow)$/.test(core)) return "lForeArm";
  if (core === "hand" || core === "wrist") return "lHand";
  if (/^(upleg|thigh|upperleg|legupper|upleg)$/.test(core)) return "lUpLeg";
  if (/^(leg|calf|shin|lowerleg|leglower|knee)$/.test(core)) return "lLeg";
  if (/^(foot|ankle)$/.test(core)) return "lFoot";
  if (/^(toe|toebase|ball|toes)$/.test(core)) return "lToe";
  return null;
}

/** Maps bone indices (into `bones`) to the standard humanoid set. Prefers the shallowest match; spine bones are ordered by depth. */
export function mapHumanoid(bones: BoneInfo[]): HumanoidMap {
  const depth = bones.map((_, i) => {
    let d = 0;
    for (let p = bones[i].parent; p !== null; p = bones[p].parent) d++;
    return d;
  });
  const out: HumanoidMap = {};
  const spine: number[] = [];
  bones.forEach((b, i) => {
    const core = coreName(b.name);
    const cls = classify(core, b.name);
    if (!cls) return;
    if (cls === "spineish") {
      spine.push(i);
      return;
    }
    let key: HumanoidBone = cls;
    if (cls !== "hips" && cls !== "neck" && cls !== "head") {
      const side = sideOf(b.name);
      if (!side) return;
      key = (side + cls.slice(1)) as HumanoidBone;
    }
    const cur = out[key];
    if (cur === undefined || depth[i] < depth[cur]) out[key] = i;
  });
  spine.sort((a, b) => depth[a] - depth[b]);
  if (spine.length) out.spine = spine[0];
  if (spine.length > 1) out.chest = spine[spine.length - 1];
  return out;
}

/** The set a driver needs at minimum to animate a walking, jumping, jetting character. */
export const REQUIRED_BONES: HumanoidBone[] = ["hips", "head", "lArm", "rArm", "lForeArm", "rForeArm", "lUpLeg", "rUpLeg", "lLeg", "rLeg"];
export function missingBones(map: HumanoidMap): HumanoidBone[] {
  return REQUIRED_BONES.filter((b) => map[b] === undefined);
}

const IK_TOKEN = /(^|[._\- :])ik(?=[._\- :]|$)/i;

/**
 * Some exporters (FBX -> Unreal-style rigs) leave a duplicate "IK" arm/leg chain that actually parents the forearm-twist and hand bones,
 * while the FK twin (`lowerarm_r`) is a leaf. Skin weights then sit on bones under the IK chain, so the SAME pose command must reach both.
 * A bone is an IK twin of a mapped bone when its name is that bone's name plus an `ik` token (same side) AND it parents another mapped bone
 * (so pure IK *targets* such as `foot_ik_r` are not mistaken for deformation bones).
 */
export function findIkTwins(bones: BoneInfo[], map: HumanoidMap): HumanoidMap {
  const children = bones.map(() => [] as number[]);
  bones.forEach((b, i) => { if (b.parent !== null) children[b.parent].push(i); });
  const mappedSet = new Set(Object.values(map).filter((v): v is number => v !== undefined));
  const subtreeHasMapped = (i: number): boolean => children[i].some((c) => mappedSet.has(c) || subtreeHasMapped(c));
  const twins: HumanoidMap = {};
  bones.forEach((b, i) => {
    if (!IK_TOKEN.test(b.name)) return;
    const stripped = b.name.replace(IK_TOKEN, "$1").replace(/[._\- :]{2,}/g, "_");
    const core = coreName(stripped);
    const cls = classify(core, stripped);
    const side = sideOf(stripped);
    if (!cls || cls === "spineish" || !side || cls === "hips" || cls === "neck" || cls === "head") return;
    const key = (side + cls.slice(1)) as HumanoidBone;
    if (map[key] === undefined || map[key] === i || !subtreeHasMapped(i)) return;
    twins[key] = i;
  });
  return twins;
}
