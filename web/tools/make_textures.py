#!/usr/bin/env python3
"""Repaint character textures: t-shirt + blue jeans for the men, and a
light-skinned, jeans-wearing variant of the woman. Reads the original GLB
textures and writes JPEGs to app/src/main/assets/game/models/tex/."""
import json, struct, io, os, sys
import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS = os.path.normpath(os.path.join(HERE, '../../app/src/main/assets/game/models'))
OUT = os.path.join(MODELS, 'tex')
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(7)

def glb_images(path):
    b = open(path, 'rb').read()
    l = struct.unpack('<I', b[12:16])[0]; j = json.loads(b[20:20 + l]); bin_ = b[20 + l + 8:]
    out = []
    for im in j['images']:
        bv = j['bufferViews'][im['bufferView']]; o = bv.get('byteOffset', 0)
        out.append(Image.open(io.BytesIO(bin_[o:o + bv['byteLength']])).convert('RGB'))
    tex = {i: t['source'] for i, t in enumerate(j['textures'])}
    mats = {m['name']: tex[m['pbrMetallicRoughness']['baseColorTexture']['index']] for m in j['materials']
            if 'baseColorTexture' in m.get('pbrMetallicRoughness', {})}
    return out, mats

def luma(a): return a[..., 0] * 0.299 + a[..., 1] * 0.587 + a[..., 2] * 0.114

def fabric(size, kind):
    h, w = size
    n = rng.normal(0, 1, (h, w))
    img = Image.fromarray(((n * 20) + 128).clip(0, 255).astype(np.uint8))
    if kind == 'denim':  # diagonal twill
        y, x = np.mgrid[0:h, 0:w]
        tw = np.sin((x + y) * 1.6) * 0.5 + 0.5
        f = np.asarray(img.filter(ImageFilter.GaussianBlur(0.6)), np.float32) / 255
        return 0.75 + 0.18 * tw + 0.25 * (f - 0.5)
    f = np.asarray(img.filter(ImageFilter.GaussianBlur(0.8)), np.float32) / 255
    return 0.92 + 0.16 * (f - 0.5)

def recolor_cloth(img, kind):
    a = np.asarray(img, np.float32) / 255
    L = luma(a)
    # keep only broad shading (folds, seams) from the original
    blur = np.asarray(Image.fromarray((L * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(10)), np.float32) / 255
    shade = 0.75 + 0.5 * (blur - blur.mean())
    edges = np.asarray(Image.fromarray((L * 255).astype(np.uint8)).filter(ImageFilter.FIND_EDGES).filter(ImageFilter.GaussianBlur(1.2)), np.float32) / 255
    fab = fabric(L.shape, kind)
    if kind == 'denim':
        base = np.array([0.30, 0.42, 0.62])
        v = (shade * fab)[..., None] * base
        v = v * (1 - edges[..., None] * 1.2) + edges[..., None] * np.array([0.75, 0.62, 0.35]) * 0.6  # stitching
        # slight fade on high points
        v = v + (np.clip(blur - blur.mean(), 0, 1) * 0.25)[..., None]
    else:  # tee: plain cotton, tinted per person in the game
        soft = np.asarray(Image.fromarray((L * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(40)), np.float32) / 255
        v = np.repeat(((0.9 + 0.15 * (soft - soft.mean())) * fab)[..., None], 3, 2)
    return Image.fromarray((np.clip(v, 0, 1) * 255).astype(np.uint8))

def recolor_woman(img, hair='brown'):
    a = np.asarray(img, np.float32) / 255
    hsv = np.asarray(img.convert('HSV'), np.float32) / 255
    H, S, V = hsv[..., 0] * 360, hsv[..., 1], hsv[..., 2]
    out = a.copy()
    skin = (H > 8) & (H < 42) & (S > 0.25) & (S < 0.8) & (V > 0.18) & (V < 0.8)
    pants = (H > 42) & (H < 70) & (S > 0.45) & (V > 0.55)
    hairm = (V < 0.2) & ~skin
    grey = (S < 0.22) & (V > 0.25) & (V < 0.85) & ~skin
    cyan = (H > 160) & (H < 210) & (S > 0.35)
    out[cyan] = np.array([0.30, 0.42, 0.62]) * 0.9
    # light skin: keep shading relative to the average skin tone
    ref = V[skin].mean() if skin.any() else 0.4
    k = np.clip(V / ref, 0.55, 1.35)[..., None]
    tone = np.array([0.93, 0.76, 0.66])
    out[skin] = np.clip(tone * k[skin], 0, 1)
    # jeans
    pk = np.clip(V / (V[pants].mean() if pants.any() else 1), 0.6, 1.3)[..., None]
    out[pants] = np.clip(np.array([0.30, 0.42, 0.62]) * pk[pants], 0, 1)
    # hair
    hk = np.clip(V / 0.08, 0.3, 2.5)[..., None]
    hc = np.array([0.36, 0.24, 0.14]) if hair == 'brown' else np.array([0.78, 0.63, 0.38])
    out[hairm] = np.clip(hc * (0.5 + 0.35 * hk[hairm]), 0, 1)
    # top: white tee
    tee = np.array([0.86, 0.36, 0.42]) if hair == 'brown' else np.array([0.32, 0.55, 0.62])
    out[grey] = np.clip(tee * (0.55 + 0.6 * V[grey][:, None]), 0, 1)
    sm = Image.fromarray((out * 255).astype(np.uint8))
    return sm

imgs, mats = glb_images(os.path.join(MODELS, 'guy.glb'))
recolor_cloth(imgs[mats['Wolf3D_Outfit_Top']], 'tee').save(os.path.join(OUT, 'tee.jpg'), quality=88)
recolor_cloth(imgs[mats['Wolf3D_Outfit_Bottom']], 'denim').save(os.path.join(OUT, 'jeans.jpg'), quality=88)
wimgs, wmats = glb_images(os.path.join(MODELS, 'girl.glb'))
base = wimgs[wmats['Ch03_Body']]
recolor_woman(base, 'brown').save(os.path.join(OUT, 'girl_brown.jpg'), quality=90)
recolor_woman(base, 'blonde').save(os.path.join(OUT, 'girl_blonde.jpg'), quality=90)
print('ok', os.listdir(OUT))
