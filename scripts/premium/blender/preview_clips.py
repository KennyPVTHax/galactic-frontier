"""Render a contact sheet of baked astronaut clips (workbench, solid) to verify retargeting.
blender -b --python preview_clips.py -- <astronaut.fbx> <out dir>
"""
import bpy, sys, os, math
from mathutils import Vector

fbx, out = [os.path.abspath(a) for a in sys.argv[sys.argv.index("--") + 1:][:2]]
os.makedirs(out, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=fbx)
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
print("ACTIONS", sorted(a.name for a in bpy.data.actions))

sc = bpy.context.scene
sc.render.engine = "BLENDER_WORKBENCH"
sc.display.shading.light = "STUDIO"
sc.display.shading.color_type = "SINGLE"
sc.display.shading.single_color = (0.8, 0.82, 0.9)
sc.render.resolution_x, sc.render.resolution_y = 420, 640
sc.render.film_transparent = False
bpy.context.scene.world = bpy.data.worlds.new("w"); bpy.context.scene.world.color = (0.12, 0.13, 0.16)

cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = "ORTHO"

def bbox():
    pts = []
    for m in meshes:
        dg = bpy.context.evaluated_depsgraph_get()
        e = m.evaluated_get(dg)
        pts += [e.matrix_world @ Vector(c) for c in e.bound_box]
    return pts

# find 'up' axis from the data: tallest extent at rest
def aim(frame_pts, side):
    lo = Vector((min(p.x for p in frame_pts), min(p.y for p in frame_pts), min(p.z for p in frame_pts)))
    hi = Vector((max(p.x for p in frame_pts), max(p.y for p in frame_pts), max(p.z for p in frame_pts)))
    c = (lo + hi) / 2
    size = max(hi - lo)
    cam.data.ortho_scale = size * 1.25
    d = Vector((1, 0, 0)) if side == "side" else Vector((0, -1, 0))
    cam.location = c + d * size * 3
    cam.rotation_euler = (c - cam.location).to_track_quat("-Z", "Y").to_euler()

names = ["Idle", "Walk", "Run", "Sprint", "JumpStart", "Fall", "Land", "Mine", "JetHover", "AimNeutral"]
arm.animation_data_create()
for n in names:
    act = bpy.data.actions.get(n)
    if not act:
        # FBX importer may prefix "<armature>|<take>"
        act = next((a for a in bpy.data.actions if a.name.endswith(n)), None)
    if not act:
        print("MISSING", n); continue
    arm.animation_data.action = act
    f0, f1 = act.frame_range
    for k, fr in enumerate((f0 + (f1 - f0) * 0.1, f0 + (f1 - f0) * 0.55)):
        sc.frame_set(int(fr))
        bpy.context.view_layer.update()
        aim(bbox(), "side")
        sc.render.filepath = os.path.join(out, f"{n}_{k}.png")
        bpy.ops.render.render(write_still=True)
print("RENDERED")
