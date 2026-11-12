# Exploração (Blender + MPFB2): cria as duas bases com rig game_engine e mede cada roupa/cabelo.
import bpy, addon_utils, bmesh, sys, json
addon_utils.enable("bl_ext.user_default.mpfb", default_set=True)
from bl_ext.user_default.mpfb.services.humanservice import HumanService
from bl_ext.user_default.mpfb.services.targetservice import TargetService
from bl_ext.user_default.mpfb.services.assetservice import AssetService
from bl_ext.user_default.mpfb.entities.clothes.mhclo import Mhclo

def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def make(gender):
    macro = TargetService.get_default_macro_info_dict()
    macro["gender"] = gender
    macro["age"] = 0.5
    basemesh = HumanService.create_human(macro_detail_dict=macro)
    rig = HumanService.add_builtin_rig(basemesh, "game_engine")
    return basemesh, rig

def parts(obj):
    bm = bmesh.new(); bm.from_mesh(obj.data); bm.verts.ensure_lookup_table()
    seen = set(); out = []
    for v in bm.verts:
        if v.index in seen: continue
        stack = [v]; comp = []
        seen.add(v.index)
        while stack:
            cur = stack.pop(); comp.append(cur)
            for e in cur.link_edges:
                o = e.other_vert(cur)
                if o.index not in seen: seen.add(o.index); stack.append(o)
        zs = [(obj.matrix_world @ c.co).z for c in comp]
        out.append((len(comp), round(min(zs), 3), round(max(zs), 3)))
    bm.free()
    out.sort(reverse=True)
    return out

report = {}
for gender, label in ((1.0, "male"), (0.0, "female")):
    clear()
    basemesh, rig = make(gender)
    zs = [(basemesh.matrix_world @ v.co).z for v in basemesh.data.vertices]
    report[label] = {"height": round(max(zs) - min(zs), 3), "verts": len(basemesh.data.vertices), "items": {}}
    names = sorted(p.stem for p in AssetService.list_mhclo_assets("clothes")) + ["hair:" + p.stem for p in AssetService.list_mhclo_assets("hair")]
    for name in names:
        sub = "hair" if name.startswith("hair:") else "clothes"
        stem = name.split(":")[-1]
        path = AssetService.find_asset_absolute_path(stem + "/" + stem + ".mhclo", sub) or AssetService.find_asset_absolute_path(stem + ".mhclo", sub)
        if not path:
            matches = [p for p in AssetService.list_mhclo_assets(sub) if p.stem == stem]
            path = str(matches[0]) if matches else None
        if not path: report[label]["items"][name] = "sem arquivo"; continue
        try:
            mh = Mhclo(); mh.load(path)
            before = set(bpy.data.objects)
            HumanService.add_mhclo_asset(path, basemesh, asset_type="Hair" if sub == "hair" else "Clothes", subdiv_levels=0, material_type="MAKESKIN")
            new = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
            info = {"delverts": len(mh.delverts or []), "objects": []}
            for o in new:
                pp = parts(o)
                info["objects"].append({"name": o.name, "verts": len(o.data.vertices), "tris": sum(len(p.vertices) - 2 for p in o.data.polygons), "materials": [m.name for m in o.data.materials if m], "parts": len(pp), "biggest": pp[:4]})
                bpy.data.objects.remove(o, do_unlink=True)
            report[label]["items"][name] = info
        except Exception as e:
            report[label]["items"][name] = "ERRO " + str(e)[:200]
json.dump(report, open(sys.argv[-1], "w"), indent=1)
print("EXPLORE OK")
