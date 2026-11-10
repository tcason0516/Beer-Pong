#!/usr/bin/env python3
"""
Build the game's party guests and opponents from MakeHuman (CC0) parts in Blender.

  pip install bpy             # Blender as a Python module (5.x)
  # MPFB2 add-on source: https://github.com/makehumancommunity/mpfb2 (copied into Blender's addons dir)
  python3 build_people.py --mh-data <makehuman/data> --out <assets/game/models/people>

Each character is a white man or woman in a t-shirt, blue jeans and sneakers,
rigged with the Mixamo skeleton. Clothes are modelled from the body's own
"tights" helper shell; skins are painted by paint_textures.py.
"""
import argparse, json, math, os, sys
import bpy, bmesh, addon_utils
from mathutils import Vector, Matrix
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
os.makedirs('/tmp/mpfb_user', exist_ok=True)
bpy.utils.extension_path_user = lambda *a, **k: '/tmp/mpfb_user'
addon_utils.enable('mpfb', default_set=True)
from mpfb.services.humanservice import HumanService  # noqa: E402
from mpfb.services.targetservice import TargetService  # noqa: E402

# ---------------------------------------------------------------- cast
PEOPLE = {
    # opponents
    'rick':  dict(gender=1.0, age=0.82, muscle=0.45, weight=0.72, height=0.45, cap=True, hair='buzz', beard='full', seed=1),
    'tyler': dict(gender=1.0, age=0.42, muscle=0.55, weight=0.42, height=0.55, cap=True, hair='buzz', beard='short', seed=2),
    'mike':  dict(gender=1.0, age=0.55, muscle=0.75, weight=0.70, height=0.62, cap=True, hair='buzz', beard='full', seed=3),
    # guests
    'guest_m1': dict(gender=1.0, age=0.48, muscle=0.5, weight=0.55, height=0.5, cap=True, hair='buzz', beard='full', seed=4),
    'guest_m2': dict(gender=1.0, age=0.5, muscle=0.6, weight=0.48, height=0.62, cap=True, hair='buzz', beard='short', seed=5),
    'guest_f1': dict(gender=0.0, age=0.45, muscle=0.45, weight=0.45, height=0.5, cap=False, hair='bob', beard=None, seed=6),
    'guest_f2': dict(gender=0.0, age=0.5, muscle=0.5, weight=0.55, height=0.42, cap=False, hair='ponytail', beard=None, seed=7),
}

B = lambda n: 'mixamorig:' + n


def reset():
    for coll in (bpy.data.objects, bpy.data.meshes, bpy.data.armatures, bpy.data.materials, bpy.data.images):
        for x in list(coll):
            coll.remove(x)


def make_human(cfg):
    m = TargetService.get_default_macro_info_dict()
    for k in ('gender', 'age', 'muscle', 'weight', 'height'):
        m[k] = cfg[k]
    m['proportions'] = 0.6
    m['race'] = {'asian': 0.0, 'caucasian': 1.0, 'african': 0.0}
    h = HumanService.create_human(macro_detail_dict=m)
    rig = HumanService.add_builtin_rig(h, 'mixamo')
    TargetService.bake_targets(h)
    for mod in list(h.modifiers):
        if mod.type == 'MASK':
            h.modifiers.remove(mod)
    return h, rig


def weights_of(obj):
    """per-vertex dict bone->weight"""
    names = {g.index: g.name for g in obj.vertex_groups}
    out = []
    for v in obj.data.vertices:
        out.append({names[g.group]: g.weight for g in v.groups})
    return out


def in_group(w, name, thr=0.5):
    return w.get(name, 0) > thr


def duplicate(obj, name):
    o = obj.copy(); o.data = obj.data.copy(); o.name = o.data.name = name
    bpy.context.collection.objects.link(o)
    return o


def keep_verts(obj, keep):
    """delete every vertex where keep[i] is False"""
    bm = bmesh.new(); bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not keep[v.index]], context='VERTS')
    bm.to_mesh(obj.data); bm.free()


def delete_faces(obj, drop_vert):
    """delete faces whose vertices are all flagged"""
    bm = bmesh.new(); bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    faces = [f for f in bm.faces if all(drop_vert[v.index] for v in f.verts)]
    bmesh.ops.delete(bm, geom=faces, context='FACES_ONLY')
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context='VERTS')
    bm.to_mesh(obj.data); bm.free()


def inflate(obj, amount_fn, smooth_iters=0, smooth_factor=0.5):
    bm = bmesh.new(); bm.from_mesh(obj.data)
    bm.normal_update()
    moves = [(v, v.normal.copy() * amount_fn(v.co)) for v in bm.verts]
    for v, d in moves:
        v.co += d
    for _ in range(smooth_iters):
        bmesh.ops.smooth_vert(bm, verts=bm.verts, factor=smooth_factor, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    bm.to_mesh(obj.data); bm.free()
    obj.data.update()


def bone_head(rig, n):
    return rig.matrix_world @ rig.data.bones[B(n)].head_local


def bone_tail(rig, n):
    return rig.matrix_world @ rig.data.bones[B(n)].tail_local


def seg_t(p, a, b):
    ab = b - a
    return (p - a).dot(ab) / ab.length_squared


def group_center(obj, name):
    gi = obj.vertex_groups[name].index
    pts = [v.co for v in obj.data.vertices if any(g.group == gi and g.weight > 0.5 for g in v.groups)]
    return sum(pts, Vector()) / len(pts)


def landmarks(h, rig):
    L = {}
    for k, g in [('eye_l', 'joint-l-eye'), ('eye_r', 'joint-r-eye'), ('mouth', 'joint-mouth'), ('jaw', 'joint-jaw'),
                 ('neck', 'joint-neck'), ('head', 'joint-head'), ('head2', 'joint-head-2'), ('pelvis', 'joint-pelvis'),
                 ('knee_l', 'joint-l-knee'), ('ankle_l', 'joint-l-ankle'), ('knee_r', 'joint-r-knee'), ('ankle_r', 'joint-r-ankle'),
                 ('shoulder_l', 'joint-l-shoulder'), ('elbow_l', 'joint-l-elbow'), ('shoulder_r', 'joint-r-shoulder'), ('elbow_r', 'joint-r-elbow')]:
        L[k] = group_center(h, g)
    zs = [v.co.z for v in h.data.vertices]
    L['top'] = max(zs)
    return L


# ---------------------------------------------------------------- UVs
def cylinder_uvs(obj, axis_fn, tile=0.25):
    """u = arc length around a local axis, v = height; both in tiles"""
    me = obj.data
    if not me.uv_layers:
        me.uv_layers.new(name='UVMap')
    uv = me.uv_layers.active.data
    for poly in me.polygons:
        us = []
        for li in poly.loop_indices:
            p = me.vertices[me.loops[li].vertex_index].co
            c, r = axis_fn(p)
            ang = math.atan2(p.x - c.x, -(p.y - c.y))  # 0 = front
            us.append((ang, r, p.z))
        # avoid wrap-around inside one face
        angs = [a for a, _, _ in us]
        if max(angs) - min(angs) > math.pi:
            us = [((a + 2 * math.pi) if a < 0 else a, r, z) for a, r, z in us]
        for li, (a, r, z) in zip(poly.loop_indices, us):
            uv[li].uv = (a * r / tile, z / tile)


# ---------------------------------------------------------------- materials
def material(name, image=None, color=(1, 1, 1, 1), rough=0.8, alpha_clip=False, normal=None, vcol=False, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = color
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    src = None
    if image:
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = bpy.data.images.load(image)
        src = tex
        if vcol:
            vc = nt.nodes.new('ShaderNodeVertexColor'); vc.layer_name = 'Col'
            mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'
            mix.inputs['Factor'].default_value = 1.0
            nt.links.new(tex.outputs['Color'], mix.inputs[6]); nt.links.new(vc.outputs['Color'], mix.inputs[7])
            nt.links.new(mix.outputs[2], bsdf.inputs['Base Color'])
        else:
            nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
        if alpha_clip:
            nt.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
            m.blend_method = 'CLIP'
    m.use_backface_culling = False
    if normal:
        nm = nt.nodes.new('ShaderNodeTexImage'); nm.image = bpy.data.images.load(normal)
        nm.image.colorspace_settings.name = 'Non-Color'
        nmap = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(nm.outputs['Color'], nmap.inputs['Color'])
        nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
    return m


def set_vertex_colors(obj, fn):
    me = obj.data
    attr = me.color_attributes.new(name='Col', type='BYTE_COLOR', domain='POINT')
    for v in me.vertices:
        c = fn(v.co)
        attr.data[v.index].color = (c[0], c[1], c[2], 1.0)


def assign(obj, mat):
    obj.data.materials.clear(); obj.data.materials.append(mat)


# ---------------------------------------------------------------- build
def build(key, cfg, tex_dir, mh_data, out_dir):
    reset()
    rng = np.random.default_rng(cfg['seed'])
    h, rig = make_human(cfg)
    rig.name = 'Armature'
    L = landmarks(h, rig)
    W = weights_of(h)
    co = [v.co.copy() for v in h.data.vertices]
    tights = [in_group(w, 'helper-tights') for w in W]
    body = [in_group(w, 'body') for w in W]
    hairh = [in_group(w, 'helper-hair') for w in W]

    hip = bone_head(rig, 'Hips')
    waist_z = hip.z + 0.045 if cfg['gender'] > 0.5 else hip.z + 0.07
    shirt_hem = hip.z - 0.06
    ankle_z = (L['ankle_l'].z + L['ankle_r'].z) / 2
    neck_z = L['neck'].z

    def arm_t(p, side):
        a, b = bone_head(rig, side + 'Arm'), bone_tail(rig, side + 'Arm')
        return seg_t(p, a, b)

    def is_arm(w):
        return sum(w.get(B(s + n), 0) for s in ('Left', 'Right') for n in ('Arm', 'ForeArm', 'Hand')) > 0.5

    def side_of(p):
        return 'Left' if p.x > 0 else 'Right'

    # ---- t-shirt: tights shell above the hem, sleeves to mid upper-arm
    sleeve_end = 0.52 if cfg['gender'] > 0.5 else 0.42

    neck_c = L['neck']
    collar_r = 0.072 if cfg['gender'] > 0.5 else 0.066

    def in_shirt(i, margin=0.0):
        p, w = co[i], W[i]
        if p.z < shirt_hem + margin or p.z > neck_z + 0.03:
            return False
        # neck opening: round collar around the base of the neck
        dn = math.hypot(p.x - neck_c.x, (p.y - neck_c.y) * 1.15)
        if p.z > neck_z - 0.075 and dn < collar_r + (p.z - (neck_z - 0.075)) * 0.6 + margin:
            return False
        if w.get(B('Neck'), 0) + w.get(B('Head'), 0) > 0.5:
            return False
        if is_arm(w):
            return arm_t(p, side_of(p)) < sleeve_end - margin * 4
        return True

    shirt = duplicate(h, 'Shirt')
    keep_verts(shirt, [tights[i] and in_shirt(i) for i in range(len(co))])
    hem_z = shirt_hem
    inflate(shirt, lambda p: 0.006 + 0.012 * max(0, 1 - (p.z - hem_z) / 0.25) + (0.004 if abs(p.x) > 0.17 else 0), smooth_iters=6, smooth_factor=0.6)

    # ---- jeans: tights shell from the waist to the ankles
    def in_jeans(i, margin=0.0):
        p = co[i]
        return ankle_z + 0.015 + margin < p.z < waist_z - margin and not is_arm(W[i])

    jeans = duplicate(h, 'Jeans')
    keep_verts(jeans, [tights[i] and in_jeans(i) for i in range(len(co))])
    knee_z = (L['knee_l'].z + L['knee_r'].z) / 2

    def jeans_puff(p):
        t = max(0.0, min(1.0, (knee_z + 0.15 - p.z) / 0.5))  # looser below the thigh
        return 0.004 + 0.016 * t
    inflate(jeans, jeans_puff, smooth_iters=4, smooth_factor=0.5)

    # ---- sneakers: tights shell around the feet
    shoes = duplicate(h, 'Shoes')
    keep_verts(shoes, [tights[i] and co[i].z < ankle_z + 0.035 for i in range(len(co))])
    inflate(shoes, lambda p: 0.007 + (0.004 if p.z < 0.03 else 0), smooth_iters=3)
    bm = bmesh.new(); bm.from_mesh(shoes.data)
    for v in bm.verts:
        if v.co.z < 0.012:
            v.co.z = 0.0  # flat sole
    bm.to_mesh(shoes.data); bm.free()

    # ---- body: drop helpers and everything hidden under the clothes
    drop = []
    for i in range(len(co)):
        if not body[i]:
            drop.append(True); continue
        p = co[i]
        hidden = in_shirt(i, margin=0.02) or (ankle_z + 0.01 < p.z < waist_z - 0.03) or p.z < ankle_z - 0.01
        drop.append(hidden)
    bodyo = duplicate(h, 'Body')
    delete_faces(bodyo, drop)

    # ---- hair
    hair = None
    if cfg['hair'] in ('bob', 'ponytail'):
        hair = make_hair(bodyo, L, rig, cfg['hair'])

    # ---- eyes (MakeHuman high-poly eye proxy)
    eyes = HumanService.add_mhclo_asset(os.path.join(mh_data, 'eyes/high-poly/high-poly.mhclo'), h, asset_type='Eyes', subdiv_levels=0)
    eyes.name = 'Eyes'

    # ---- ball cap (bone-parented to the head)
    cap = None
    if cfg['cap']:
        cap = make_cap(h, co, W, L, rig)

    # ---- landmark data for the texture painter
    dump_paint_data(bodyo, L, cfg, os.path.join(out_dir, key + '.paint.npz'))

    # ---- uv + materials
    hips_c = Vector((0, hip.y, 0))

    def torso_axis(p):
        if abs(p.x) > 0.17 or (p.z < hip.z - 0.12):
            if p.z < hip.z - 0.05:  # legs
                s = 'Left' if p.x > 0 else 'Right'
                a, b = bone_head(rig, s + 'UpLeg'), bone_tail(rig, s + 'Leg')
                t = max(0, min(1, seg_t(p, a, b)))
                c = a.lerp(b, t)
                return c, 0.07
            s = side_of(p)
            a, b = bone_head(rig, s + 'Arm'), bone_tail(rig, s + 'Arm')
            t = max(0, min(1, seg_t(p, a, b)))
            return a.lerp(b, t), 0.05
        return Vector((0, hip.y, p.z)), 0.16
    cylinder_uvs(shirt, torso_axis)
    cylinder_uvs(jeans, torso_axis)
    cylinder_uvs(shoes, lambda p: (Vector((0.1 if p.x > 0 else -0.1, -0.05, p.z)), 0.05))

    # jeans: darker waistband, stitched side seams, faded thighs/knees
    def jeans_col(p):
        c = 1.0
        if p.z > waist_z - 0.035: c *= 0.78
        front = p.y < hip.y - 0.03
        if front and knee_z - 0.08 < p.z < hip.z - 0.12: c *= 1.12
        if p.z < ankle_z + 0.05: c *= 0.86
        return (min(1, c), min(1, c), min(1, c))
    set_vertex_colors(jeans, jeans_col)

    def shirt_col(p):
        c = 1.0
        if p.z > neck_z - 0.06: c *= 0.86  # ribbed collar
        if p.z < hem_z + 0.02: c *= 0.9
        return (c, c, c)
    set_vertex_colors(shirt, shirt_col)

    skin = os.path.join(out_dir, key + '_skin.jpg')
    if not os.path.exists(skin):
        from PIL import Image as _I; _I.new('RGB', (8, 8), (230, 185, 160)).save(skin)
    assign(bodyo, material('Skin', os.path.join(out_dir, key + '_skin.jpg'), rough=0.62))
    assign(shirt, material('Tee', os.path.join(tex_dir, 'cotton.jpg'), rough=0.95, normal=os.path.join(tex_dir, 'cotton_n.jpg'), vcol=True))
    assign(jeans, material('Denim', os.path.join(tex_dir, 'denim.jpg'), rough=0.9, normal=os.path.join(tex_dir, 'denim_n.jpg'), vcol=True))
    assign(shoes, material('Sneaker', os.path.join(tex_dir, 'sneaker.jpg'), rough=0.7))
    if hair:
        assign(hair, material('Hair', os.path.join(tex_dir, 'hair_%s.png' % ('brown' if cfg['seed'] % 2 == 0 else 'blonde')), rough=0.55, alpha_clip=True))
    if cap:
        assign_all(cap, material('Cap', os.path.join(tex_dir, 'cotton.jpg'), rough=0.9))

    # ---- export
    for o in bpy.data.objects:
        o.select_set(False)
    objs = [rig, bodyo, shirt, jeans, shoes, eyes] + ([hair] if hair else []) + (cap if cap else [])
    for o in objs:
        o.select_set(True)
    h.hide_set(True)
    path = os.path.join(out_dir, key + '.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True,
                              export_animations=False, export_skins=True, export_morph=False,
                              export_image_format='JPEG', export_jpeg_quality=85, export_yup=True)
    print('exported', path, os.path.getsize(path))


def make_hair(body, L, rig, style):
    """Hair shaped around the head by ray casting from the head's vertical axis."""
    from mathutils.bvhtree import BVHTree
    dg = bpy.context.evaluated_depsgraph_get()
    bvh = BVHTree.FromObject(body, dg)
    eye = (L['eye_l'] + L['eye_r']) / 2
    pts = [v.co for v in body.data.vertices if v.co.z > eye.z - 0.02]
    yc = (min(p.y for p in pts) + max(p.y for p in pts)) / 2
    top = L['top']
    jaw = L['jaw'].z
    end_z = (jaw - 0.075) if style == 'bob' else (eye.z - 0.035)
    nth, nz = 64, 48

    def surf(theta, z):
        d = Vector((math.sin(theta), math.cos(theta), 0))   # theta 0 = back (+y)
        o = Vector((0, yc, z))
        hit = bvh.ray_cast(o + d * 0.3, -d)                 # from outside, inward
        return (0.3 - hit[3]) if hit[0] is not None else None

    def hairline(theta):
        a = abs(math.atan2(math.sin(theta), math.cos(theta)))   # 0 back .. pi front
        return eye.z + np.interp(a, [0, 1.5, 2.2, 2.6, math.pi], [-0.09, -0.04, 0.04, 0.066, 0.075])

    bm = bmesh.new()
    grid = {}
    ear_r = {}
    snapped = {}
    for j in range(nz + 1):
        z0 = top - 0.012
        z = z0 - (z0 - end_z) * (j / nz)
        for i in range(nth):
            th = -math.pi + 2 * math.pi * i / nth
            a = abs(math.atan2(math.sin(th), math.cos(th)))
            hl = hairline(th)
            r = surf(th, z)
            face_open = a > 2.15 and z < hl              # leave the face clear
            if style == 'ponytail' and z < hl and a > 1.2:
                face_open = True
            if face_open:
                # snap the first open vertex of a column onto the hairline for a smooth edge
                if (i, j - 1) in grid and (i, j) not in grid and not snapped.get(i):
                    snapped[i] = True
                    rr = surf(th, hl)
                    if rr is not None:
                        rr += 0.012
                        grid[(i, j)] = bm.verts.new((math.sin(th) * rr, yc + math.cos(th) * rr, hl))
                continue
            if r is None:
                if i in ear_r:
                    r = ear_r[i]
                else:
                    continue
            vol = 0.012 + 0.006 * max(0, (z - eye.z) / (top - eye.z))
            if z < eye.z - 0.02:                         # hangs straight below the ears
                r = max(r + vol, ear_r.get(i, r) * 0.98)
            else:
                ear_r[i] = r + vol
                r = r + vol
            grid[(i, j)] = bm.verts.new((math.sin(th) * r, yc + math.cos(th) * r, z))
    uvs = {}
    for (i, j), v in grid.items():
        uvs[(i, j)] = (i / nth * 6.0, 1.0 - j / nz * 0.92)
    faces = []
    for j in range(nz):
        for i in range(nth):
            q = [(i, j), ((i + 1) % nth, j), ((i + 1) % nth, j + 1), (i, j + 1)]
            if all(k in grid for k in q):
                faces.append((bm.faces.new([grid[k] for k in q]), q))
    # cap the crown
    ring = [grid[(i, 0)] for i in range(nth) if (i, 0) in grid]
    if len(ring) == nth:
        c = bm.verts.new((0, yc, top + 0.003))
        for i in range(nth):
            f = bm.faces.new((grid[(i, 0)], grid[((i + 1) % nth, 0)], c)); faces.append((f, None))
    me = bpy.data.meshes.new('Hair'); bm.to_mesh(me)
    uvl = me.uv_layers.new(name='UVMap')
    poly_i = 0
    for f, q in faces:
        poly = me.polygons[poly_i]; poly_i += 1
        for k, li in enumerate(poly.loop_indices):
            if q is None:
                uvl.data[li].uv = (k / 3.0, 1.0)
            else:
                u, v = uvs[q[k]]
                if q[k][0] == 0 and any(x[0] == nth - 1 for x in q):
                    u = 6.0
                uvl.data[li].uv = (u, v)
    bm.free()
    for poly in me.polygons:
        poly.use_smooth = True
    hair = bpy.data.objects.new('Hair', me)
    bpy.context.collection.objects.link(hair)
    if style == 'ponytail':
        add_ponytail(hair, yc, eye, L)
    # skin to the head bone
    vg = hair.vertex_groups.new(name=B('Head'))
    vg.add(list(range(len(hair.data.vertices))), 1.0, 'REPLACE')
    hair.parent = rig
    mod = hair.modifiers.new('Armature', 'ARMATURE'); mod.object = rig
    return hair


def add_ponytail(hair, yc, eye, L):
    bm = bmesh.new(); bm.from_mesh(hair.data)
    uvl = bm.loops.layers.uv.active
    seg, rings = 12, 14
    start = Vector((0, yc + 0.095, eye.z + 0.005))
    prev = None
    for k in range(rings + 1):
        t = k / rings
        p = start + Vector((0, 0.035 * math.sin(t * 1.2), -0.2 * t))
        rad = (0.036 * (1 - t) ** 0.7 + 0.008) if k > 0 else 0.018
        ring = [bm.verts.new(p + Vector((math.cos(a) * rad, math.sin(a) * rad * 0.8, 0))) for a in [s / seg * 2 * math.pi for s in range(seg)]]
        if prev:
            for s in range(seg):
                f = bm.faces.new((prev[s], prev[(s + 1) % seg], ring[(s + 1) % seg], ring[s]))
                for li, (uu, vv) in zip(f.loops, ((s / seg, 1 - (k - 1) / rings * 0.9), ((s + 1) / seg, 1 - (k - 1) / rings * 0.9), ((s + 1) / seg, 1 - k / rings * 0.9), (s / seg, 1 - k / rings * 0.9))):
                    li[uvl].uv = (uu, vv)
                f.smooth = True
        prev = ring
    bm.to_mesh(hair.data); bm.free()


def assign_all(objs, mat):
    for o in objs:
        assign(o, mat)


def make_cap(h, co, W, L, rig):
    """crown + curved brim around the top of the head"""
    head_pts = [co[i] for i, w in enumerate(W) if in_group(w, 'body') and co[i].z > (L['eye_l'].z + 0.02)]
    xs = [p.x for p in head_pts]; ys = [p.y for p in head_pts]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    rx, ry = (max(xs) - min(xs)) / 2 + 0.012, (max(ys) - min(ys)) / 2 + 0.012
    base = L['eye_l'].z + 0.028
    top = L['top'] + 0.012
    hgt = top - base
    # crown profile (radius factor, height factor)
    prof = [(1.0, 0.0), (1.0, 0.28), (0.97, 0.52), (0.88, 0.72), (0.68, 0.88), (0.38, 0.975), (0.0, 1.0)]
    seg = 40
    bm = bmesh.new()
    rings = []
    for rf, hf in prof:
        ring = []
        for s in range(seg):
            a = s / seg * 2 * math.pi
            ring.append(bm.verts.new((cx + math.sin(a) * rx * rf, cy - math.cos(a) * ry * rf, base + hf * hgt)))
        rings.append(ring)
    for r in range(len(rings) - 1):
        for s in range(seg):
            a, b = rings[r][s], rings[r][(s + 1) % seg]
            c, d = rings[r + 1][(s + 1) % seg], rings[r + 1][s]
            if r + 1 == len(rings) - 1:
                bm.faces.new((a, b, c)) if c != d else None
            else:
                bm.faces.new((a, b, c, d))
    # brim: half-ellipse in front (-y), slightly curved down
    bseg, brim_len = 20, 0.075
    inner, outer = [], []
    for s in range(bseg + 1):
        a = -math.pi / 2 + s / bseg * math.pi  # -90..90 deg around the front
        x0, y0 = cx + math.sin(a) * rx, cy - math.cos(a) * ry
        x1 = cx + math.sin(a) * rx * 0.98
        y1 = cy - math.cos(a) * (ry + brim_len)
        droop = 0.012 * (abs(math.sin(a)) ** 2) + 0.01
        inner.append(bm.verts.new((x0, y0, base + 0.004)))
        outer.append(bm.verts.new((x1, y1, base - droop)))
    for s in range(bseg):
        bm.faces.new((inner[s], inner[s + 1], outer[s + 1], outer[s]))
    me = bpy.data.meshes.new('Cap'); bm.to_mesh(me); bm.free()
    cap = bpy.data.objects.new('Cap', me)
    bpy.context.collection.objects.link(cap)
    cap.data.uv_layers.new(name='UVMap')
    for poly in cap.data.polygons:
        poly.use_smooth = True
    # parent to the head bone, keeping its world placement
    hb = rig.data.bones[B('Head')]
    cap.parent = rig; cap.parent_type = 'BONE'; cap.parent_bone = B('Head')
    cap.matrix_parent_inverse = (rig.matrix_world @ hb.matrix_local @ Matrix.Translation((0, hb.length, 0))).inverted()
    return [cap]


def dump_paint_data(obj, L, cfg, path):
    me = obj.data
    me.calc_loop_triangles()
    tris = np.array([[me.loops[li].vertex_index for li in t.loops] for t in me.loop_triangles])
    loops = np.array([[li for li in t.loops] for t in me.loop_triangles])
    uv = np.array([d.uv[:] for d in me.uv_layers[0].data])
    pos = np.array([v.co[:] for v in me.vertices])
    nrm = np.array([v.normal[:] for v in me.vertices])
    lm = {k: np.array(v[:]) if hasattr(v, '__len__') else np.array([v]) for k, v in L.items()}
    np.savez_compressed(path, tris=tris, loops=loops, uv=uv, pos=pos, nrm=nrm, gender=cfg['gender'],
                        beard=str(cfg['beard']), hair=cfg['hair'], seed=cfg['seed'], **{'lm_' + k: v for k, v in lm.items()})


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--mh-data', required=True)
    ap.add_argument('--tex', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--only', default='')
    ap.add_argument('--stage', default='all', help='paint: only dump paint data')
    a = ap.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])
    os.makedirs(a.out, exist_ok=True)
    for k, cfg in PEOPLE.items():
        if a.only and k not in a.only.split(','):
            continue
        build(k, cfg, a.tex, a.mh_data, a.out)
