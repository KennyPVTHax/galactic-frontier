"""Convert Poly Haven glTF rocks to game-ready FBX LODs for Unity.

blender -b --python convert_rocks.py -- <PolyHaven/Models dir> <out dir>

* imports each <id>/<id>.gltf, merges meshes, applies transforms, recentres so the base sits at y=0
* LOD0 <= 14k tris, LOD1 <= 3.5k, LOD2 <= 900 (collapse decimation, keeps UVs/normals reasonably)
* exports FBX (Y-up, -Z forward) per LOD and copies the three 1k textures next to it
Prints a machine-readable summary line per asset: RESULT <id> <lod0 tris> <lod1> <lod2> <height m> <radius m>
"""
import bpy, sys, os, shutil, math

argv = sys.argv[sys.argv.index("--") + 1:]
src_dir, out_dir = argv[0], argv[1]
os.makedirs(out_dir, exist_ok=True)
BUDGETS = [14000, 3500, 900]


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def tris(obj):
    me = obj.data
    me.calc_loop_triangles()
    return len(me.loop_triangles)


def decimate_to(obj, target):
    n = tris(obj)
    if n <= target:
        return
    mod = obj.modifiers.new("dec", "DECIMATE")
    mod.ratio = target / n
    mod.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)


def export(obj, path):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.fbx(
        filepath=path, use_selection=True, object_types={"MESH"},
        axis_forward="-Z", axis_up="Y", global_scale=1.0, apply_unit_scale=True,
        apply_scale_options="FBX_SCALE_ALL", bake_space_transform=True,
        mesh_smooth_type="FACE", add_leaf_bones=False, path_mode="STRIP",
    )


for asset in sorted(os.listdir(src_dir)):
    gltf = os.path.join(src_dir, asset, asset + ".gltf")
    if not os.path.isfile(gltf):
        continue
    clear()
    bpy.ops.import_scene.gltf(filepath=gltf)
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    bpy.ops.object.select_all(action="DESELECT")
    for m in meshes:
        m.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    for ch in list(obj.children):
        ch.parent = None
    obj.parent = None
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    # base to y=0 (Blender Z up), centre on XY
    corners = [obj.matrix_world @ v.co for v in obj.data.vertices]
    minz = min(c.z for c in corners)
    cx = (min(c.x for c in corners) + max(c.x for c in corners)) / 2
    cy = (min(c.y for c in corners) + max(c.y for c in corners)) / 2
    for v in obj.data.vertices:
        v.co.x -= cx; v.co.y -= cy; v.co.z -= minz
    h = max(c.z for c in corners) - minz
    rad = max(max(abs(c.x - cx), abs(c.y - cy)) for c in corners)

    counts = []
    base_name = asset
    for lod, budget in enumerate(BUDGETS):
        dup = obj.copy(); dup.data = obj.data.copy(); dup.name = f"{asset}_LOD{lod}"
        bpy.context.collection.objects.link(dup)
        decimate_to(dup, budget)
        counts.append(tris(dup))
        export(dup, os.path.join(out_dir, f"{asset}_LOD{lod}.fbx"))
    tex_dir = os.path.join(src_dir, asset, "textures")
    if os.path.isdir(tex_dir):
        for f in os.listdir(tex_dir):
            shutil.copy2(os.path.join(tex_dir, f), os.path.join(out_dir, f))
    print("RESULT", asset, *counts, round(h, 3), round(rad, 3))
