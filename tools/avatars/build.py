"""
Constrói os avatares no Blender com o MPFB2 (MakeHuman) — modo sem interface.

Uso (via tools/avatars/build.mjs):
  blender -b -P tools/avatars/build.py -- <sources.json> <pasta-saida> [male|female]

Para cada base (masculina/feminina):
  1. cria o humano (macros), assa os alvos, aplica o rig game_engine e a pele (material GAMEENGINE, exportável);
  2. olhos, sobrancelhas, cílios e dentes; visemas (boca para a fala) e barbas recebem os mesmos shape keys;
  3. variações de rosto como morph targets do corpo;
  4. veste cada roupa ajustada ao corpo (ajuste do MakeHuman), separa parte de cima/baixo, reduz a malha,
     marca o material principal para tingimento e calcula quais vértices do corpo ficam escondidos sob ela
     (lista delete_verts do próprio asset) — vira um atributo de bits no corpo (_hidea/_hideb);
  5. remove a geometria auxiliar (helpers) e exporta o corpo; exporta cada peça com o mesmo esqueleto;
  6. cria o headset (geometria original) preso ao osso da cabeça;
  7. grava build.json com medidas, arquivos, bits de ocultação e a origem/licença de cada asset.
"""
import bpy, addon_utils, bmesh, json, os, sys, math, shutil, traceback, glob
from mathutils import Vector, kdtree

addon_utils.enable("bl_ext.user_default.mpfb", default_set=True)
from bl_ext.user_default.mpfb.services.humanservice import HumanService
from bl_ext.user_default.mpfb.services.targetservice import TargetService
from bl_ext.user_default.mpfb.services.assetservice import AssetService
from bl_ext.user_default.mpfb.services.faceservice import FaceService
from bl_ext.user_default.mpfb.services.locationservice import LocationService
from bl_ext.user_default.mpfb.entities.clothes.mhclo import Mhclo

ARGS = sys.argv[sys.argv.index("--") + 1:]
SRC = json.load(open(ARGS[0], encoding="utf-8"))
OUT = ARGS[1]
ONLY = ARGS[2] if len(ARGS) > 2 else None
BUDGET = SRC["budgets"]
LOG = []


def log(*a):
    msg = " ".join(str(x) for x in a)
    LOG.append(msg)
    print("[avatar]", msg, flush=True)


# ---------- metadados dos pacotes (autor, licença, origem) ----------
PACK_META = {}
for pj in glob.glob(os.path.join(LocationService.get_user_data(), "packs", "*.json")):
    pack = os.path.splitext(os.path.basename(pj))[0]
    try:
        for stem, meta in json.load(open(pj, encoding="utf-8")).items():
            if isinstance(meta, dict):
                PACK_META[stem] = {"pack": pack, **{k: meta.get(k, "") for k in ("author", "license", "source", "original_author", "original_source", "type")}}
    except Exception as e:  # pacote sem metadados no formato esperado
        log("aviso: metadados ilegíveis em", pj, e)


def meta(stem):
    return PACK_META.get(stem, {"pack": "?", "author": "?", "license": "?", "source": ""})


def mhclo_path(stem, sub):
    for p in AssetService.list_mhclo_assets(sub):
        if p.stem == stem:
            return str(p)
    raise FileNotFoundError(f"{sub}/{stem}")


def mhmat_path(stem):
    for p in AssetService.list_mhmat_assets("skins"):
        if p.stem == stem:
            return str(p)
    raise FileNotFoundError(f"skins/{stem}")


def target_path(rel):
    base = LocationService.get_mpfb_data("targets")
    for ext in (".target.gz", ".target"):
        p = os.path.join(base, rel + ext)
        if os.path.isfile(p):
            return p
    raise FileNotFoundError(rel)


def viseme_path(stem):
    for root in (LocationService.get_user_data("targets"), LocationService.get_mpfb_data("targets")):
        for ext in (".target", ".target.gz"):
            p = os.path.join(root, "visemes", stem + ext)
            if os.path.isfile(p):
                return p
    raise FileNotFoundError("visemes/" + stem)


def object_mode():
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")


def select_only(objs, active=None):
    object_mode()
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or objs[0]


def tris(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def decimate(obj, target):
    t = tris(obj)
    if t <= target or (obj.data.shape_keys and len(obj.data.shape_keys.key_blocks) > 1):
        return t
    m = obj.modifiers.new("Decimate", "DECIMATE")
    m.ratio = max(0.05, target / t)
    select_only([obj])
    bpy.ops.object.modifier_move_to_index(modifier="Decimate", index=0)
    bpy.ops.object.modifier_apply(modifier="Decimate")
    return tris(obj)


def strip_modifiers(obj, keep=("ARMATURE",)):
    for m in list(obj.modifiers):
        if m.type not in keep:
            obj.modifiers.remove(m)


def export(objs, rig, path, morph=True):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    select_only(objs + [rig], active=rig)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, export_skins=True, export_morph=morph,
        export_morph_normal=False, export_attributes=True, export_animations=False, export_apply=False, export_yup=True,
        export_cameras=False, export_lights=False, export_extras=False, export_try_sparse_sk=True, export_def_bones=False,
        export_rest_position_armature=True, export_image_format="AUTO",
    )


def kd_of(objs):
    pts = [o.matrix_world @ v.co for o in objs for v in o.data.vertices]
    kd = kdtree.KDTree(len(pts))
    for i, p in enumerate(pts):
        kd.insert(p, i)
    kd.balance()
    return kd


def delverts_of(path):
    mh = Mhclo()
    mh.load(path)
    if not getattr(mh, "delete", False) or not mh.delverts:
        return []
    dv = mh.delverts
    return sorted(int(i) for i in (dv.keys() if isinstance(dv, dict) else dv))


def copy_for_tint(obj):
    """Material principal da peça vira 'tint' (com imagem própria: o tingimento não afeta as outras partes)."""
    for i, slot in enumerate(obj.material_slots):
        if not slot.material:
            continue
        m = slot.material.copy()
        m.name = "tint"
        if m.node_tree:
            for n in m.node_tree.nodes:
                if n.type == "TEX_IMAGE" and n.image:
                    img = n.image.copy()
                    img.name = "tint_" + n.image.name
                    n.image = img
        slot.material = m
        break


class Bits:
    """Bit global por peça que esconde pele (mesmo bit nas duas bases)."""

    def __init__(self):
        self.map = {}

    def bit(self, item_id):
        if item_id not in self.map:
            if len(self.map) >= 48:
                raise RuntimeError("Mais de 48 peças com máscara de pele")
            self.map[item_id] = len(self.map)
        return self.map[item_id]


BITS = Bits()
# reserva os bits na ordem das fontes (estáveis entre execuções e entre bases)
for src in SRC["outfits"]:
    BITS.bit("top." + src)
    BITS.bit("bottom." + src)
for src in SRC["shoes"]:
    BITS.bit("shoes." + src)


def build_base(base):
    conf = SRC["bases"][base]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    macro = TargetService.get_default_macro_info_dict()
    for k, v in conf["macro"].items():
        macro[k] = v
    basemesh = HumanService.create_human(macro_detail_dict=macro)
    basemesh.name = "body"
    TargetService.bake_targets(basemesh)
    rig = HumanService.add_builtin_rig(basemesh, SRC["rig"])
    rig.name = "rig"
    HumanService.set_character_skin(mhmat_path(conf["skin"]), basemesh, skin_type="GAMEENGINE")
    for slot in basemesh.material_slots:
        if slot.material:
            slot.material.name = "skin"
    parts = {}
    for stem, sub, kind in ((SRC["eyes"], "eyes", "Eyes"), (conf["eyebrows"], "eyebrows", "Eyebrows"), (conf["eyelashes"], "eyelashes", "Eyelashes"), (SRC["teeth"], "teeth", "Teeth")):
        o = HumanService.add_mhclo_asset(mhclo_path(stem, sub), basemesh, asset_type=kind, subdiv_levels=0, material_type="GAMEENGINE")
        o.name = sub
        strip_modifiers(o)
        parts[sub] = o
    # visemas (boca para a fala): só os necessários
    for v in SRC["visemes"]:
        TargetService.load_target(basemesh, viseme_path(v), weight=0.0, name="viseme_" + v)
    # barbas (só na base masculina) entram antes da interpolação para receberem os visemas
    beards = []
    if base == "male":
        for stem in SRC["beards"]:
            o = HumanService.add_mhclo_asset(mhclo_path(stem, "clothes"), basemesh, asset_type="Clothes", subdiv_levels=0, material_type="GAMEENGINE")
            o.name = "beard." + stem
            strip_modifiers(o)
            beards.append((stem, o))
    try:
        FaceService.interpolate_targets(basemesh)
    except Exception as e:
        log("aviso: interpolação de visemas para partes do rosto falhou:", e)
    # variações de rosto (morph targets relativos à base)
    for face in SRC["faces"]:
        if not face["targets"]:
            continue
        added = []
        for rel, w in face["targets"].items():
            name = "tmp_" + rel.replace("/", "_")
            TargetService.load_target(basemesh, target_path(rel), weight=w, name=name)
            added.append(name)
        for kb in basemesh.data.shape_keys.key_blocks:
            if kb.name.startswith("viseme_"):
                kb.value = 0.0
        basemesh.shape_key_add(name="face_" + face["id"], from_mix=True)
        for name in added:
            basemesh.shape_key_remove(basemesh.data.shape_keys.key_blocks[name])
    for kb in basemesh.data.shape_keys.key_blocks:
        kb.value = 0.0

    # medidas
    zs = [(basemesh.matrix_world @ v.co).z for v in basemesh.data.vertices]
    body_group = basemesh.vertex_groups.get("body")
    gi = body_group.index if body_group else None
    keep = [i for i, v in enumerate(basemesh.data.vertices) if gi is None or any(g.group == gi and g.weight > 0.5 for g in v.groups)]
    keep_set = set(keep)
    head_top = max(zs[i] for i in keep)
    bottom_max_z = 0.62 * head_top
    log(base, "altura até o topo da cabeça:", round(head_top, 3), "m · vértices do corpo:", len(keep), "de", len(zs))
    hide = {}
    items = []
    lod_ratio = BUDGET["lod1Ratio"]

    def finish_item(item_id, slot, src_stem, obj, budget, *, tint, lod, hide_classes=None):
        strip_modifiers(obj)
        obj.name = item_id
        before = tris(obj)
        after = decimate(obj, budget)
        if tint:
            copy_for_tint(obj)
        path = os.path.join(OUT, base, item_id + ".glb")
        export([obj], rig, path)
        lod_path = None
        if lod:
            dup = obj.copy()
            dup.data = obj.data.copy()
            bpy.context.collection.objects.link(dup)
            decimate(dup, max(300, int(after * lod_ratio)))
            lod_path = os.path.join(OUT, base, "lod1", item_id + ".glb")
            export([dup], rig, lod_path, morph=False)
            bpy.data.objects.remove(dup, do_unlink=True)
        items.append({
            "id": item_id, "slot": slot, "base": base, "source": src_stem, "file": os.path.relpath(path, OUT).replace("\\", "/"),
            "lod1": os.path.relpath(lod_path, OUT).replace("\\", "/") if lod_path else None, "trisOriginal": before, "tris": after,
            "tint": tint, "hideBit": BITS.map.get(item_id), "meta": meta(src_stem),
        })
        log(f"  {item_id}: {before} → {after} triângulos")

    # roupas: separa parte de cima/baixo
    for src in SRC["outfits"]:
        try:
            path = mhclo_path(src, "clothes")
            obj = HumanService.add_mhclo_asset(path, basemesh, asset_type="Clothes", subdiv_levels=0, material_type="GAMEENGINE")
            strip_modifiers(obj)
            select_only([obj])
            bpy.ops.object.mode_set(mode="EDIT")
            bpy.ops.mesh.select_all(action="SELECT")
            bpy.ops.mesh.separate(type="LOOSE")
            bpy.ops.object.mode_set(mode="OBJECT")
            pieces = [o for o in bpy.context.selected_objects if o.type == "MESH"]
            classes = {"top": [], "bottom": []}
            for p in pieces:
                # parte de baixo = peça que fica inteira abaixo de ~62% da altura (calça, saia, cinto); o resto é parte de cima
                top_z = max((p.matrix_world @ v.co).z for v in p.data.vertices)
                classes["bottom" if top_z < bottom_max_z else "top"].append(p)
            # pele escondida: cada vértice da lista delete_verts vai para a parte mais próxima
            dv = [i for i in delverts_of(path) if i < len(basemesh.data.vertices)]
            trees = {k: kd_of(v) for k, v in classes.items() if v}
            for i in dv:
                co = basemesh.matrix_world @ basemesh.data.vertices[i].co
                best = min(trees.items(), key=lambda kv: kv[1].find(co)[2])[0]
                hide[i] = hide.get(i, 0) | (1 << BITS.bit(f"{best}.{src}"))
            for cls, objs in classes.items():
                if not objs:
                    continue
                objs.sort(key=lambda o: len(o.data.vertices), reverse=True)
                primary = objs[0]
                copy_for_tint(primary)  # só a parte principal (paletó, camisa, calça) recebe a cor escolhida
                if len(objs) > 1:
                    select_only(objs, active=primary)
                    bpy.ops.object.join()
                finish_item(f"{cls}.{src}", cls, src, primary, BUDGET[cls], tint=False, lod=True)
                items[-1]["tint"] = True
                bpy.data.objects.remove(primary, do_unlink=True)
        except Exception:
            log("ERRO roupa", src, traceback.format_exc(limit=2))

    for src in SRC["shoes"]:
        try:
            path = mhclo_path(src, "clothes")
            obj = HumanService.add_mhclo_asset(path, basemesh, asset_type="Clothes", subdiv_levels=0, material_type="GAMEENGINE")
            for i in delverts_of(path):
                if i < len(basemesh.data.vertices):
                    hide[i] = hide.get(i, 0) | (1 << BITS.bit("shoes." + src))
            finish_item("shoes." + src, "shoes", src, obj, BUDGET["shoes"], tint=True, lod=False)
            bpy.data.objects.remove(obj, do_unlink=True)
        except Exception:
            log("ERRO sapato", src, traceback.format_exc(limit=2))

    for src in SRC["hair"]:
        try:
            obj = HumanService.add_mhclo_asset(mhclo_path(src, "hair"), basemesh, asset_type="Hair", subdiv_levels=0, material_type="GAMEENGINE")
            finish_item("hair." + src, "hair", src, obj, BUDGET["hair"], tint=True, lod=True)
            bpy.data.objects.remove(obj, do_unlink=True)
        except Exception:
            log("ERRO cabelo", src, traceback.format_exc(limit=2))

    for src in SRC["glasses"]:
        try:
            obj = HumanService.add_mhclo_asset(mhclo_path(src, "clothes"), basemesh, asset_type="Clothes", subdiv_levels=0, material_type="GAMEENGINE")
            finish_item("glasses." + src, "glasses", src, obj, BUDGET["glasses"], tint=False, lod=False)
            bpy.data.objects.remove(obj, do_unlink=True)
        except Exception:
            log("ERRO óculos", src, traceback.format_exc(limit=2))

    for stem, obj in beards:
        try:
            finish_item("beard." + stem, "beard", stem, obj, BUDGET["beard"], tint=True, lod=False)
            bpy.data.objects.remove(obj, do_unlink=True)
        except Exception:
            log("ERRO barba", stem, traceback.format_exc(limit=2))

    # ---------- headset: geometria original presa ao osso da cabeça ----------
    head_pts = [basemesh.matrix_world @ basemesh.data.vertices[i].co for i in keep]
    head_bone = rig.data.bones.get("head")
    head_z0 = (rig.matrix_world @ head_bone.head_local).z
    hp = [p for p in head_pts if p.z >= head_z0]
    hw = max(abs(p.x) for p in hp)
    eyes = parts["eyes"]
    ez = sum((eyes.matrix_world @ v.co).z for v in eyes.data.vertices) / len(eyes.data.vertices)
    ey = sum((eyes.matrix_world @ v.co).y for v in eyes.data.vertices) / len(eyes.data.vertices)
    ys = [p.y for p in hp]
    y_center = (min(ys) + max(ys)) / 2
    front_y = min(ys)  # MakeHuman olha para -Y no Blender
    ear = Vector((hw + 0.006, y_center + 0.012, ez - 0.012))
    top_z = max(p.z for p in hp)
    mouth = Vector((0.0, front_y - 0.012, ez - 0.075))
    headset = build_headset(ear, top_z, mouth)
    headset.name = "headset"
    mw = headset.matrix_world.copy()
    headset.parent = rig
    headset.parent_type = "BONE"
    headset.parent_bone = "head"
    headset.matrix_world = mw
    hs_path = os.path.join(OUT, base, "headset.office.glb")
    export([headset], rig, hs_path, morph=False)
    items.append({"id": "headset.office", "slot": "headset", "base": base, "source": "office3d-procedural", "file": f"{base}/headset.office.glb", "lod1": None,
                  "tris": tris(headset), "trisOriginal": tris(headset), "tint": False, "hideBit": None, "attach": "head",
                  "meta": {"pack": "office3d", "author": "Office 3D (geometria original)", "license": "Original do projeto", "source": "tools/avatars/build.py"}})
    bpy.data.objects.remove(headset, do_unlink=True)

    # ---------- corpo: remove helpers, grava a máscara de pele e exporta ----------
    before_coords = [basemesh.data.vertices[i].co.copy() for i in keep[:50]]
    remap = {old: new for new, old in enumerate(keep)}
    strip_modifiers(basemesh)
    bm = bmesh.new()
    bm.from_mesh(basemesh.data)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.index not in keep_set], context="VERTS")
    bm.to_mesh(basemesh.data)
    bm.free()
    assert len(basemesh.data.vertices) == len(keep), "remoção de helpers mudou a contagem"
    for j in range(len(before_coords)):
        assert (basemesh.data.vertices[j].co - before_coords[j]).length < 1e-6, "ordem dos vértices mudou ao remover helpers"
    a = [0.0] * len(keep)
    b = [0.0] * len(keep)
    for old, bits in hide.items():
        if old in remap:
            n = remap[old]
            a[n] = float(bits & 0xFFFFFF)
            b[n] = float((bits >> 24) & 0xFFFFFF)
    for name, data in (("_hidea", a), ("_hideb", b)):
        attr = basemesh.data.attributes.new(name, "FLOAT", "POINT")
        attr.data.foreach_set("value", data)
    for g in [g for g in basemesh.vertex_groups if g.name.startswith("Delete") or g.name.startswith("helper") or g.name.startswith("joint")]:
        basemesh.vertex_groups.remove(g)
    body_objs = [basemesh, parts["eyes"], parts["eyebrows"], parts["eyelashes"], parts["teeth"]]
    body_path = os.path.join(OUT, base, "body.glb")
    export(body_objs, rig, body_path)
    # LOD1 do corpo: sem morphs, malha reduzida
    lod = basemesh.copy()
    lod.data = basemesh.data.copy()
    bpy.context.collection.objects.link(lod)
    lod.shape_key_clear()
    decimate(lod, int(tris(basemesh) * BUDGET["lod1Ratio"]))
    export([lod, parts["eyes"]], rig, os.path.join(OUT, base, "lod1", "body.glb"), morph=False)

    # peles (texturas difusas para trocar o tom)
    skins = []
    for s in SRC["skins"]:
        try:
            mm = mhmat_path(s[base])
            tex = None
            for line in open(mm, encoding="utf-8", errors="ignore"):
                if line.startswith("diffuseTexture"):
                    tex = line.split(None, 1)[1].strip()
            if tex:
                src_img = os.path.join(os.path.dirname(mm), tex)
                dst = os.path.join(OUT, "skins", base, s["id"] + os.path.splitext(tex)[1])
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                shutil.copyfile(src_img, dst)
                skins.append({"id": s["id"], "file": os.path.relpath(dst, OUT).replace("\\", "/"), "source": s[base], "meta": meta(s[base])})
        except Exception:
            log("ERRO pele", s["id"], traceback.format_exc(limit=1))

    shape_keys = [kb.name for kb in basemesh.data.shape_keys.key_blocks][1:] if basemesh.data.shape_keys else []
    return {
        "base": base, "headTop": round(head_top, 4), "bodyVerts": len(keep), "bodyTris": tris(basemesh), "bones": [b.name for b in rig.data.bones],
        "shapeKeys": shape_keys, "body": f"{base}/body.glb", "bodyLod1": f"{base}/lod1/body.glb", "items": items, "skins": skins,
        "parts": {k: {"source": (SRC["eyes"] if k == "eyes" else SRC["teeth"] if k == "teeth" else conf[k]), "meta": meta(SRC["eyes"] if k == "eyes" else SRC["teeth"] if k == "teeth" else conf[k])} for k in parts},
        "skinDefault": conf["skin"], "skinDefaultMeta": meta(conf["skin"]),
    }


def build_headset(ear, top_z, mouth):
    """Headset de escritório: arco, duas conchas e haste com microfone (geometria original)."""
    bm = bmesh.new()

    def cyl(r, depth, center, axis, segs=20):
        m = bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r, radius2=r, depth=depth)
        verts = m["verts"]
        rot = Vector((0, 0, 1)).rotation_difference(axis.normalized()).to_matrix().to_4x4()
        bmesh.ops.transform(bm, matrix=rot, verts=verts)
        bmesh.ops.translate(bm, vec=center, verts=verts)

    for s in (-1, 1):
        cyl(0.034, 0.024, Vector((s * ear.x, ear.y, ear.z)), Vector((1, 0, 0)), 24)   # concha
        cyl(0.028, 0.008, Vector((s * (ear.x - 0.014), ear.y, ear.z)), Vector((1, 0, 0)), 24)  # almofada
    # arco: segmentos ao longo de uma elipse sobre a cabeça
    a = ear.x + 0.004
    bz = (top_z + 0.014) - ear.z
    n = 22
    prev = None
    for k in range(n + 1):
        t = math.pi * k / n
        p = Vector((math.cos(t) * a, ear.y, ear.z + math.sin(t) * bz))
        if prev is not None:
            mid = (p + prev) / 2
            d = p - prev
            cyl(0.006, d.length + 0.002, mid, d, 10)
        prev = p
    # haste do microfone: da concha esquerda até a frente da boca
    start = Vector((-(ear.x + 0.012), ear.y - 0.012, ear.z - 0.012))
    mid = Vector((-(ear.x - 0.01), mouth.y + 0.035, mouth.z + 0.01))
    end = Vector((-0.03, mouth.y + 0.004, mouth.z))
    for p0, p1 in ((start, mid), (mid, end)):
        d = p1 - p0
        cyl(0.0035, d.length, (p0 + p1) / 2, d, 8)
    bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=0.009)
    sphere = [v for v in bm.verts if (v.co.length < 0.0095)]
    bmesh.ops.translate(bm, vec=end, verts=sphere)
    mesh = bpy.data.meshes.new("headset")
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new("headset", mesh)
    bpy.context.collection.objects.link(obj)
    mat = bpy.data.materials.new("headset")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (0.03, 0.035, 0.045, 1)
    bsdf.inputs["Roughness"].default_value = 0.45
    bsdf.inputs["Metallic"].default_value = 0.2
    obj.data.materials.append(mat)
    for p in obj.data.polygons:
        p.use_smooth = True
    return obj


result = {"rig": SRC["rig"], "bits": BITS.map, "bases": {}, "faces": SRC["faces"], "visemes": SRC["visemes"], "skins": SRC["skins"], "log": LOG}
for base in ("male", "female"):
    if ONLY and base != ONLY:
        continue
    try:
        result["bases"][base] = build_base(base)
    except Exception:
        log("ERRO base", base, traceback.format_exc())
os.makedirs(OUT, exist_ok=True)
name = "build.json" if not ONLY else f"build.{ONLY}.json"
json.dump(result, open(os.path.join(OUT, name), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print("[avatar] BUILD DONE", flush=True)
