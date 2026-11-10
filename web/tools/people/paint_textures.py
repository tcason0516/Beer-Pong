#!/usr/bin/env python3
"""
Fabric/hair textures and per-character skin textures for build_people.py.

  python3 paint_textures.py fabrics <tex_dir>
  python3 paint_textures.py skins <people_dir> <mpfb_textures_dir>

Skins are painted in UV space: every texel gets the 3D position it maps to on
the body, so eyebrows, hairline, stubble and beard are drawn from anatomical
landmarks rather than hand-placed in the UV atlas.
"""
import glob, os, sys
import numpy as np
from PIL import Image, ImageFilter

rng = np.random.default_rng(11)


def save(a, path, q=88):
    im = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8))
    if path.endswith('.png'):
        im.save(path)
    else:
        im.convert('RGB').save(path, quality=q)


def tile_noise(n, scale, octaves=4, seed=0):
    """tileable value noise via FFT-filtered white noise"""
    r = np.random.default_rng(seed)
    out = np.zeros((n, n))
    amp = 1.0
    for o in range(octaves):
        f = np.fft.fft2(r.normal(size=(n, n)))
        ky = np.fft.fftfreq(n)[:, None]; kx = np.fft.fftfreq(n)[None, :]
        k = np.sqrt(kx ** 2 + ky ** 2)
        s = scale * (2 ** o)
        filt = np.exp(-(k * n / s) ** 2)
        out += amp * np.real(np.fft.ifft2(f * filt))
        amp *= 0.5
    out -= out.min(); out /= out.max()
    return out


def normal_from_height(h, strength):
    gx = np.roll(h, -1, 1) - np.roll(h, 1, 1)
    gy = np.roll(h, -1, 0) - np.roll(h, 1, 0)
    n = np.dstack([-gx * strength, gy * strength, np.ones_like(h)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return n * 0.5 + 0.5


def fabrics(d):
    os.makedirs(d, exist_ok=True)
    N = 512
    y, x = np.mgrid[0:N, 0:N]
    # ---- denim: 3/1 right-hand twill with slubby weft and indigo fade
    twill = (np.sin((x + y * 1.0) * 2 * np.pi / 4.0) * 0.5 + 0.5)
    slub = tile_noise(N, 3, 3, 1)
    weft = tile_noise(N, 40, 2, 2)
    warp = np.repeat(rng.normal(0, 1, (1, N)), N, 0)
    v = 0.55 + 0.25 * twill + 0.18 * (slub - 0.5) + 0.06 * (weft - 0.5) + 0.03 * warp
    indigo = np.array([0.20, 0.30, 0.50]); white = np.array([0.78, 0.82, 0.88])
    t = np.clip((v - 0.35) * 0.9, 0, 1)[..., None] * 0.55
    denim = indigo * (1 - t) + white * t
    save(denim, os.path.join(d, 'denim.jpg'))
    save(normal_from_height(twill * 0.7 + slub * 0.6, 1.2), os.path.join(d, 'denim_n.jpg'))
    # ---- cotton jersey: fine knit columns, very light (tinted per person in the game)
    knit = np.abs(np.sin(x * 2 * np.pi / 3.0)) * 0.5 + np.abs(np.sin(y * 2 * np.pi / 5.0)) * 0.2
    soft = tile_noise(N, 4, 3, 3)
    c = 0.86 + 0.06 * (knit - 0.35) + 0.08 * (soft - 0.5)
    save(np.dstack([c, c, c]), os.path.join(d, 'cotton.jpg'))
    save(normal_from_height(knit * 0.5 + soft * 0.8, 0.9), os.path.join(d, 'cotton_n.jpg'))
    # ---- sneaker: white canvas with a grey rubber sole band at the bottom of the tile
    s = 0.9 + 0.06 * (tile_noise(N, 20, 2, 4) - 0.5)
    sn = np.dstack([s, s, s * 0.98])
    sn[: N // 8] *= 0.55
    save(sn, os.path.join(d, 'sneaker.jpg'))
    # ---- long hair strands (RGBA): vertical streaks, ragged ends
    for name, base in (('brown', (0.24, 0.15, 0.09)), ('blonde', (0.74, 0.58, 0.36))):
        streak = tile_noise(N, 1, 1, 5)
        cols = rng.normal(0, 1, N)
        cols = np.convolve(cols, np.ones(3) / 3, 'same')
        st = np.repeat(cols[None, :], N, 0) * 0.5 + (tile_noise(N, 2, 3, 6) - 0.5)
        lum = 0.75 + 0.35 * np.tanh(st)
        rgb = np.array(base)[None, None, :] * lum[..., None]
        # ragged ends at the bottom of the texture (v=0 is the hair tips)
        yy = np.arange(N)[:, None] / N            # 0 top .. 1 bottom row
        ends = 0.9 + 0.08 * np.repeat(rng.random((1, N)), N, 0)
        a = (yy < ends).astype(np.float64)
        rgb = rgb * (1 - 0.25 * np.clip((yy - 0.7) / 0.3, 0, 1))[..., None]
        hair = np.dstack([rgb, a])
        save(hair, os.path.join(d, 'hair_%s.png' % name))


# ---------------------------------------------------------------- skins
def raster(paint, S):
    """per texel: interpolated 3D position + normal, and coverage mask"""
    tris, loops, uv, pos, nrm = paint['tris'], paint['loops'], paint['uv'], paint['pos'], paint['nrm']
    P = np.zeros((S, S, 3), np.float32); Nn = np.zeros((S, S, 3), np.float32); M = np.zeros((S, S), bool)
    U = uv[loops] * (S - 1)             # (T,3,2)
    U[..., 1] = (S - 1) - U[..., 1]     # image rows go down
    for t in range(len(tris)):
        (x0, y0), (x1, y1), (x2, y2) = U[t]
        xmin, xmax = int(max(0, np.floor(min(x0, x1, x2)))), int(min(S - 1, np.ceil(max(x0, x1, x2))))
        ymin, ymax = int(max(0, np.floor(min(y0, y1, y2)))), int(min(S - 1, np.ceil(max(y0, y1, y2))))
        if xmax < xmin or ymax < ymin:
            continue
        yy, xx = np.mgrid[ymin:ymax + 1, xmin:xmax + 1]
        den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
        if abs(den) < 1e-9:
            continue
        a = ((y1 - y2) * (xx - x2) + (x2 - x1) * (yy - y2)) / den
        b = ((y2 - y0) * (xx - x2) + (x0 - x2) * (yy - y2)) / den
        c = 1 - a - b
        ins = (a >= -0.02) & (b >= -0.02) & (c >= -0.02)
        if not ins.any():
            continue
        vi = tris[t]
        p = a[..., None] * pos[vi[0]] + b[..., None] * pos[vi[1]] + c[..., None] * pos[vi[2]]
        n = a[..., None] * nrm[vi[0]] + b[..., None] * nrm[vi[1]] + c[..., None] * nrm[vi[2]]
        sl = (slice(ymin, ymax + 1), slice(xmin, xmax + 1))
        P[sl][ins] = p[ins]; Nn[sl][ins] = n[ins]; M[sl][ins] = True
    return P, Nn, M


def dilate(img, mask, n=6):
    """bleed colours past UV island borders to avoid seams"""
    out = img.copy(); m = mask.copy()
    for _ in range(n):
        acc = np.zeros_like(out); cnt = np.zeros(m.shape)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            sm = np.roll(np.roll(m, dy, 0), dx, 1)
            acc += np.roll(np.roll(out, dy, 0), dx, 1) * sm[..., None]; cnt += sm
        grow = (~m) & (cnt > 0)
        out[grow] = acc[grow] / cnt[grow][:, None]
        m = m | grow
    return out


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def paint_skin(npz, mpfb_tex, out_path, S=2048):
    d = np.load(npz, allow_pickle=True)
    male = float(d['gender']) > 0.5
    seed = int(d['seed'])
    r = np.random.default_rng(seed)
    P, N, M = raster(d, S)
    lm = {k[3:]: d[k] for k in d.files if k.startswith('lm_')}
    eyeL, eyeR, mouth, jaw, neck = lm['eye_l'], lm['eye_r'], lm['mouth'], lm['jaw'], lm['neck']
    eye_c = (eyeL + eyeR) / 2
    X, Y, Z = P[..., 0], P[..., 1], P[..., 2]

    def mask_img(name):
        im = Image.open(os.path.join(mpfb_tex, name)).convert('L').resize((S, S), Image.BILINEAR)
        return np.asarray(im, np.float32) / 255

    face_m, lips_m, lids_m, ears_m = mask_img('mpfb_face.jpg'), mask_img('mpfb_lips.jpg'), mask_img('mpfb_eyelids.jpg'), mask_img('mpfb_ears.jpg')

    # ---- base skin (light / fair), with blotches, pores and warm extremities
    tone = np.array([0.90, 0.71, 0.60]) if male else np.array([0.94, 0.76, 0.66])
    tone = tone * (1 + r.normal(0, 0.02, 3))
    blot = np.asarray(Image.fromarray((r.random((S // 16, S // 16)) * 255).astype(np.uint8)).resize((S, S), Image.BICUBIC), np.float32) / 255
    pores = r.normal(0, 1, (S, S)); pores = np.asarray(Image.fromarray(((pores * 18) + 128).clip(0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.7)), np.float32) / 255 - 0.5
    col = np.ones((S, S, 3)) * tone
    col *= (1 + 0.05 * (blot - 0.5))[..., None]
    col *= (1 + 0.06 * pores)[..., None]
    red = np.array([0.88, 0.52, 0.48])
    col = col * (1 - 0.18 * ears_m[..., None]) + red * 0.18 * ears_m[..., None]
    # cheeks/nose flush
    flush = face_m * smoothstep(0.03, 0.0, np.abs(Z - (eye_c[2] - 0.035))) * (np.abs(X) > 0.015)
    col = col * (1 - 0.12 * flush[..., None]) + red * 0.12 * flush[..., None]
    # lips
    lipc = np.array([0.74, 0.50, 0.46]) if male else np.array([0.78, 0.44, 0.44])
    lm_ = np.clip(lips_m * 1.4, 0, 1)[..., None]
    col = col * (1 - lm_ * 0.75) + lipc * lm_ * 0.75
    # eyelids slightly darker
    col *= (1 - 0.08 * lids_m)[..., None]

    front = N[..., 1] < 0.3   # (MakeHuman: -Y is forward)
    # ---- eyebrows: arcs above each eye
    brow = np.zeros((S, S))
    for e, sgn in ((eyeL, 1), (eyeR, -1)):
        dx = (X - e[0]) * sgn                       # outward positive
        t = np.clip((dx + 0.016) / 0.05, 0, 1)      # 0 inner .. 1 outer end
        centre = e[2] + 0.017 + 0.007 * np.sin(t * np.pi * 0.9) - 0.004 * t
        thick = (0.0075 if male else 0.0045) * (1.1 - 0.6 * t)
        inside = (dx > -0.016) & (dx < 0.036) & front & (Y < e[1] + 0.02)
        b = smoothstep(thick, thick * 0.3, np.abs(Z - centre)) * inside
        brow = np.maximum(brow, b)
    hairs = np.asarray(Image.fromarray((r.random((S, S)) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.6)), np.float32) / 255
    brow *= 0.55 + 0.6 * hairs
    hair_col = np.array([0.20, 0.13, 0.08]) if seed % 2 == 0 else np.array([0.33, 0.22, 0.12])
    if not male and seed % 2 == 1:
        hair_col = np.array([0.55, 0.40, 0.24])
    b3 = np.clip(brow, 0, 1)[..., None] * 0.9
    col = col * (1 - b3) + hair_col * b3

    # ---- men: buzz-cut hairline, stubble/beard
    if male:
        head_c = np.array([0.0, eye_c[1] + 0.085, eye_c[2]])
        ang = np.arctan2(X - head_c[0], -(Y - head_c[1]))   # 0 = front
        a = np.abs(ang)
        hl = np.interp(a, [0, 0.6, 1.2, 1.6, 2.0, np.pi], [0.068, 0.058, 0.035, 0.02, -0.035, -0.075]) + eye_c[2]
        scalp = smoothstep(-0.004, 0.006, Z - hl) * (1 - np.clip(ears_m * 3, 0, 1))
        scalp *= Z > neck[2] + 0.02
        dots = r.random((S, S)) < 0.55
        buzz = scalp * (0.5 + 0.35 * dots)
        bc = hair_col * 0.9
        col = col * (1 - buzz[..., None]) + bc * buzz[..., None]
        kind = str(d['beard'])
        if kind != 'None':
            # real mouth position from the lips mask
            lipsel = (lips_m > 0.5) & M
            mz, mx, mtop = Z[lipsel].mean(), X[lipsel].mean(), Z[lipsel].max()
            mouth = np.array([mx, 0, mz])
            dxm = np.abs(X - mouth[0])
            cheek_top = mtop + 0.012 + np.clip((dxm - 0.03) / 0.045, 0, 1) ** 1.3 * (eye_c[2] - 0.04 - mtop - 0.012)
            low = jaw[2] - (0.02 if kind == 'full' else 0.01)
            region = (Z < cheek_top) & (Y < head_c[1] + 0.03)
            region &= ~(ears_m > 0.2)
            region &= ~((dxm < 0.022) & (Z > mtop + 0.004))  # keep the nose clear
            soft = smoothstep(0.0, 0.012, cheek_top - Z) * smoothstep(low - 0.012, low + 0.008, Z) * region
            lipclear = np.clip(lips_m * 2.5, 0, 1)
            dens = (0.78 if kind == 'full' else 0.5)
            # short downward hairs: sparse seeds smeared vertically
            seeds = (r.random((S, S)) < 0.18).astype(np.float32)
            k = np.ones(7) / 7
            strands = np.apply_along_axis(lambda c: np.convolve(c, k, 'same'), 0, seeds)
            strands = np.clip(strands * 3.2, 0, 1)
            chin = smoothstep(mtop + 0.01, mz - 0.03, Z)          # fuller on the chin and jaw
            beard = soft * (1 - lipclear) * dens * (0.35 + 0.45 * chin + 0.5 * strands)
            beard = np.clip(beard, 0, 0.95)[..., None]
            col = col * (1 - beard) + hair_col * 0.75 * beard

    col = dilate(col, M, 8)
    col[~M] = tone * 0.9
    save(col, out_path, 90)


if __name__ == '__main__':
    if sys.argv[1] == 'fabrics':
        fabrics(sys.argv[2])
    else:
        for f in sorted(glob.glob(os.path.join(sys.argv[2], '*.paint.npz'))):
            out = f.replace('.paint.npz', '_skin.jpg')
            paint_skin(f, sys.argv[3], out)
            print('painted', out)
