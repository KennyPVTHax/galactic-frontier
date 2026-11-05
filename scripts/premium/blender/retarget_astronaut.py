"""Retarget CC0 Quaternius clips onto the tnnv "Spacesuit (Confederation of Planets)" skeleton and export for Unity.

blender -b --python retarget_astronaut.py -- <tnnv.glb> <UAL1 Godot glb> <UAL2 Unreal-Godot glb> <out dir>

Method (rest-pose independent): for every driven bone, world rotation delta = pose * rest^-1 on the source rig,
re-applied on the target's rest rotation (after correcting for the two rigs' facing directions). Hips translation is
scaled by the height ratio. The right arm's IK-chain twins (upperarm_ik_r / lowerarm_ik_r, which carry the skin
weights on this model) receive the same delta as the FK arm. Output: <out>/astronaut.fbx (mesh + armature + baked
clips), <out>/Textures/*.png, <out>/clips.json.
"""
import bpy, sys, re, os, json, math
from mathutils import Matrix, Vector

ARGS = sys.argv[sys.argv.index("--") + 1:]
tnnv, ual1, ual2, out_dir = ARGS[:4]
PREVIEW = os.path.abspath(ARGS[4]) if len(ARGS) > 4 else None
os.makedirs(os.path.join(out_dir, "Textures"), exist_ok=True)

# (output clip name, source library, source action)
CLIPS = [
    ("Idle", 1, "Idle_Loop"), ("Walk", 1, "Walk_Loop"), ("Run", 1, "Jog_Fwd_Loop"), ("Sprint", 1, "Sprint_Loop"),
    ("JumpStart", 1, "Jump_Start"), ("Fall", 1, "Jump_Loop"), ("Land", 1, "Jump_Land"),
    ("Interact", 1, "Interact"), ("AimNeutral", 1, "Pistol_Aim_Neutral"), ("AimUp", 1, "Pistol_Aim_Up"), ("AimDown", 1, "Pistol_Aim_Down"),
    ("IdleTorch", 1, "Idle_Torch_Loop"),
    ("Mine", 2, "TreeChopping_Loop"), ("JetHover", 2, "NinjaJump_Idle_Loop"), ("OpenChest", 2, "Chest_Open"),
]

UAL1_MAP = {"hips": "pelvis", "spine.001": "spine_01", "spine.002": "spine_02", "spine.003": "spine_03", "neck": "neck_01", "head": "head",
            "shoulder.L": "clavicle_l", "shoulder.R": "clavicle_r", "upper_arm.L": "upperarm_l", "upper_arm.R": "upperarm_r",
            "forearm.L": "lowerarm_l", "forearm.R": "lowerarm_r", "hand.L": "hand_l", "hand.R": "hand_r",
            "thigh.L": "thigh_l", "thigh.R": "thigh_r", "shin.L": "calf_l", "shin.R": "calf_r", "foot.L": "foot_l", "foot.R": "foot_r",
            "toe.L": "ball_l", "toe.R": "ball_r", "root": "root"}


def canon_src(n):
    n = n.replace("DEF-", "")
    if n in UAL1_MAP:
        return UAL1_MAP[n]
    m = re.match(r"f_(index|middle|ring|pinky)\.(\d\d)\.([LR])$", n)
    if m:
        return f"{m.group(1)}_{m.group(2)}_{m.group(3).lower()}"
    m = re.match(r"thumb\.(\d\d)\.([LR])$", n)
    if m:
        return f"thumb_{m.group(1)}_{m.group(2).lower()}"
    return n.lower()  # UAL2 already uses Unreal-style names (Head -> head)


def canon_tgt(n):
    return re.sub(r"_\d+$", "", n)


def new_objects(before):
    return [o for o in bpy.data.objects if o.name not in before]


def clean_start():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def char_basis(arm, st, base_pose=None):
    """Rig-intrinsic frame (columns: right, forward, up) in WORLD space, from the rest pose, plus body height.
    st maps canonical bone names -> actual bone names for this rig. Independent of how the file was exported."""
    W = arm.matrix_world
    P = (lambda n: W @ base_pose[st[n]].translation) if base_pose else (lambda n: W @ arm.data.bones[st[n]].head_local)
    feet = (P("foot_l") + P("foot_r")) * 0.5
    up = (P("head") - feet).normalized()
    fwd_raw = P("ball_l") - P("foot_l")
    fwd = (fwd_raw - up * fwd_raw.dot(up)).normalized()
    right = fwd.cross(up).normalized()
    C = Matrix(((right.x, fwd.x, up.x), (right.y, fwd.y, up.y), (right.z, fwd.z, up.z)))
    return C, (P("head") - feet).length


clean_start()
bpy.ops.import_scene.gltf(filepath=tnnv)
tgt_objs = set(o.name for o in bpy.data.objects)
tgt = next(o for o in bpy.data.objects if o.type == "ARMATURE")
for o in list(bpy.data.objects):          # glTF importer's custom bone-shape helper
    if o.name.startswith("Icosphere"):
        bpy.data.objects.remove(o, do_unlink=True)

before = set(o.name for o in bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=ual1)
src1 = next(o for o in new_objects(before) if o.type == "ARMATURE")
for o in new_objects(before):
    if o.type == "MESH":
        bpy.data.objects.remove(o, do_unlink=True)
before = set(o.name for o in bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=ual2)
src2 = next(o for o in new_objects(before) if o.type == "ARMATURE")
for o in new_objects(before):
    if o.type == "MESH":
        bpy.data.objects.remove(o, do_unlink=True)
bpy.context.view_layer.update()
BASE_BASIS = {pb.name: pb.matrix_basis.copy() for pb in tgt.pose.bones}
BASE_POSE = {pb.name: pb.matrix.copy() for pb in tgt.pose.bones}   # evaluated import pose = the character's real rest

# ---- bone tables
tgt_by_canon = {}
for b in tgt.data.bones:
    tgt_by_canon.setdefault(canon_tgt(b.name), []).append(b.name)
driven_extra = {"upperarm_ik_r": "upperarm_r", "lowerarm_ik_r": "lowerarm_r"}   # IK-chain twins carry the right arm's skin weights


def source_table(src):
    tbl = {}
    for b in src.data.bones:
        tbl[canon_src(b.name)] = b.name
    return tbl


def build_map(src):
    st = source_table(src)
    m = {}   # tgt bone name -> src bone name
    for canon, names in tgt_by_canon.items():
        key = driven_extra.get(canon, canon)
        if key in st and "twist" not in canon and canon not in ("root",):
            for n in names:
                m[n] = st[key]
    return m


MAP = {1: build_map(src1), 2: build_map(src2)}
print("MAPPED1", len(MAP[1]), "MAPPED2", len(MAP[2]))
print("UNMAPPED_DEFORM", sorted(set(canon_tgt(b.name) for b in tgt.data.bones) - set(canon_tgt(n) for n in MAP[1]) - {"root"})[:80])

TGT_ST = {c: n[0] for c, n in tgt_by_canon.items()}
C_t, H_t = char_basis(tgt, TGT_ST, BASE_POSE)


def rest_info(src):
    C_s, H_s = char_basis(src, source_table(src))
    return C_s, H_s / 1.0


INFO = {1: rest_info(src1), 2: rest_info(src2)}
print("HEIGHTS tgt", round(H_t, 3), "src1", round(INFO[1][1], 3), "src2", round(INFO[2][1], 3))

Wt = tgt.matrix_world
Wt3 = Wt.to_quaternion().to_matrix()
tgt_bones_order = [pb.name for pb in tgt.pose.bones]   # parent-first
PEL = tgt_by_canon["pelvis"][0]


def rot3(m):
    return m.to_quaternion().to_matrix()



def setup_preview():
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.display.shading.light = "STUDIO"
    sc.display.shading.color_type = "SINGLE"
    sc.display.shading.single_color = (0.8, 0.82, 0.9)
    sc.render.resolution_x, sc.render.resolution_y = 420, 640
    sc.world = bpy.data.worlds.new("w"); sc.world.color = (0.12, 0.13, 0.16)
    cam = bpy.data.objects.new("pcam", bpy.data.cameras.new("pcam"))
    sc.collection.objects.link(cam); sc.camera = cam; cam.data.type = "ORTHO"
    os.makedirs(PREVIEW, exist_ok=True)
    return cam


def preview_frame(cam, tag):
    right, fwd, up = C_t.col[0], C_t.col[1], C_t.col[2]
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for o in bpy.data.objects:
        if o.type == "MESH":
            e = o.evaluated_get(dg)
            pts += [e.matrix_world @ Vector(c) for c in e.bound_box]
    c = sum(pts, Vector()) / len(pts)
    size = max((max(p[i] for p in pts) - min(p[i] for p in pts)) for i in range(3))
    cam.data.ortho_scale = size * 1.2
    cam.location = c + right * size * 3
    cam.rotation_euler = Matrix(((fwd.x, up.x, right.x), (fwd.y, up.y, right.y), (fwd.z, up.z, right.z))).to_euler()
    cam.rotation_euler.rotate_axis('Z', math.pi) if (fwd.cross(up)).dot(right) < 0 else None
    bpy.context.scene.render.filepath = os.path.join(PREVIEW, tag + ".png")
    bpy.ops.render.render(write_still=True)


def bake_clip(out_name, lib, action_name):
    src = src1 if lib == 1 else src2
    act = bpy.data.actions.get(action_name)
    if act is None:
        raise RuntimeError("missing action " + action_name)
    src.animation_data_create()
    src.animation_data.action = act
    fs, fe = int(act.frame_range[0]), int(act.frame_range[1])
    C_s, H_s = INFO[lib]
    hscale = H_t / H_s
    # world-space change of basis: source character frame -> target character frame
    Y = C_t @ C_s.inverted()
    Ws3 = src.matrix_world.to_3x3()
    mp = MAP[lib]
    st = source_table(src)

    tgt.animation_data_create()
    new = bpy.data.actions.new(out_name)
    new.use_fake_user = True
    tgt.animation_data.action = new
    for pb in tgt.pose.bones:
        pb.rotation_mode = "QUATERNION"

    s_pel = src.data.bones[st["pelvis"]]
    s_pel_rest_w = (src.matrix_world @ s_pel.head_local)
    t_pel_rest_w = Wt @ BASE_POSE[PEL].translation

    fwd_arm = (Wt3.inverted() @ C_t.col[1]).normalized()
    unit = Wt.to_scale()[0]
    exc = {"foot_l": [], "foot_r": []}
    for f in range(fs, fe + 1):
        bpy.context.scene.frame_set(f)
        pose_arm = {}   # tgt bone -> armature-space pose matrix
        for name in tgt_bones_order:
            pb = tgt.pose.bones[name]
            bone = pb.bone
            if bone.parent:
                par = bone.parent
                P_pose = pose_arm[par.name]
                chain = P_pose @ par.matrix_local.inverted() @ bone.matrix_local   # pose if this bone had identity basis
            else:
                chain = bone.matrix_local.copy()
            chain0 = chain
            if name in mp:
                sb = src.pose.bones[mp[name]]
                Rp = rot3(src.matrix_world @ sb.matrix)
                Rr = rot3(src.matrix_world @ sb.bone.matrix_local)
                d = Y @ (Rp @ Rr.inverted()) @ Y.inverted()
                Rt = rot3(Wt @ BASE_POSE[name])
                desired_w = d @ Rt
                R_arm = Wt3.inverted() @ desired_w
                trans = (chain0 @ BASE_BASIS[name]).to_translation()
                if name == PEL:
                    dw = (src.matrix_world @ sb.head) - s_pel_rest_w
                    dw = (Y @ dw) * hscale
                    tw = t_pel_rest_w + dw
                    trans = Wt.inverted() @ tw
                M = R_arm.to_4x4()
                M.translation = trans
                basis = chain0.inverted() @ M
                pb.rotation_quaternion = basis.to_quaternion()
                pb.location = basis.to_translation()
                pb.keyframe_insert("rotation_quaternion", frame=f, group=name)
                if name == PEL or basis.to_translation().length > 1e-5:
                    pb.keyframe_insert("location", frame=f, group=name)
                pose_arm[name] = M
            else:
                pose_arm[name] = chain0 @ BASE_BASIS[name]
        for k in exc:
            exc[k].append(((pose_arm[tgt_by_canon[k][0]].translation - pose_arm[PEL].translation).dot(fwd_arm)) * unit)
    if True:
        dur = max(1e-3, (fe - fs) / 30.0)
        pp = sum(max(v) - min(v) for v in exc.values()) / 2.0
        SPEEDS[out_name] = round(2.0 * pp / dur, 2)
    if PREVIEW and out_name == "Idle":
        bpy.context.scene.frame_set(fs); bpy.context.view_layer.update()
        bad = []
        for pb in tgt.pose.bones:
            exp = pose_arm.get(pb.name)
            if exp is None: continue
            d = (pb.matrix.translation - exp.translation).length
            r = (pb.matrix.to_quaternion().rotation_difference(exp.to_quaternion())).angle
            bad.append((d + r, pb.name, round(d, 4), round(math.degrees(r), 1), pb.bone.inherit_scale, pb.bone.use_inherit_rotation, pb.bone.use_connect))
        for nm in (PEL, "root_01", "head_07", "foot_l_063"):
            pbx = tgt.pose.bones[nm]
            print("DBG", nm, "exp", tuple(round(v,2) for v in pose_arm[nm].translation), "act", tuple(round(v,2) for v in pbx.matrix.translation), "rest", tuple(round(v,2) for v in pbx.bone.matrix_local.translation))
        print("DBG Wt", tuple(round(v,3) for v in Wt.to_scale()), tuple(round(v,2) for v in Wt.translation), "C_t cols", [tuple(round(x,2) for x in c) for c in C_t.col])
        bad.sort(reverse=True)
        for row in bad[:12]: print("DIAG", row)
    if PREVIEW:
        for k, fr in enumerate((fs + (fe - fs) * 0.1, fs + (fe - fs) * 0.55)):
            bpy.context.scene.frame_set(int(fr)); bpy.context.view_layer.update()
            preview_frame(PCAM, f"{out_name}_{k}")
    src.animation_data.action = None
    return fe - fs + 1


PCAM = setup_preview() if PREVIEW else None
SPEEDS = {}
lengths = {}
for out_name, lib, aname in CLIPS:
    n = bake_clip(out_name, lib, aname)
    lengths[out_name] = n
    print("BAKED", out_name, n, "frames from", aname)

# remove sources so only baked actions get exported
for a in [src1, src2]:
    bpy.data.objects.remove(a, do_unlink=True)
keep = set(c[0] for c in CLIPS)
for act in list(bpy.data.actions):
    if act.name not in keep:
        bpy.data.actions.remove(act)
tgt.animation_data.action = None

# ---- textures out (named by role)
roles = {"Image_0": "suit_base", "Image_1": "suit_mr", "Image_2": "suit_nor", "Image_3": "body_base",
         "Image_4": "helmet_base", "Image_5": "helmet_mr", "Image_6": "helmet_nor", "Image_7": "glass_nor"}
for img in bpy.data.images:
    base = img.name.split(".")[0]
    if base in roles:
        p = os.path.join(out_dir, "Textures", roles[base] + ".png")
        img.save_render(p)

# ---- name meshes by material for stable Unity lookup
for o in bpy.data.objects:
    if o.type == "MESH" and o.data.materials:
        o.name = "Mesh_" + o.data.materials[0].name
        print("MESH", o.name, len(o.data.polygons), "polys", "skinned" if o.modifiers else "rigid", "parent", o.parent.name if o.parent else None, o.parent_type, o.parent_bone)

bpy.context.scene.render.fps = 30
bpy.context.scene.frame_start = 1
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.fbx(
    filepath=os.path.join(out_dir, "astronaut.fbx"), use_selection=True,
    object_types={"ARMATURE", "MESH", "EMPTY"}, axis_forward="-Z", axis_up="Y", global_scale=1.0,
    apply_unit_scale=True, apply_scale_options="FBX_SCALE_ALL", bake_space_transform=True,
    add_leaf_bones=False, primary_bone_axis="Y", secondary_bone_axis="X", mesh_smooth_type="FACE",
    bake_anim=True, bake_anim_use_all_actions=True, bake_anim_use_nla_strips=False, bake_anim_use_all_bones=False,
    bake_anim_force_startend_keying=True, bake_anim_simplify_factor=0.0, path_mode="STRIP",
)
json.dump({"fps": 30, "clips": lengths, "footSpeed": SPEEDS}, open(os.path.join(out_dir, "clips.json"), "w"), indent=1)
print("DONE")
