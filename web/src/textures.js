// Procedural PBR textures drawn on canvases (no image downloads needed).
import * as THREE from 'three';

// ---------- noise ----------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const rng = mulberry32(1337);

function makeLattice(seed) {
  const r = mulberry32(seed);
  const n = 256, v = new Float32Array(n * n);
  for (let i = 0; i < v.length; i++) v[i] = r();
  return v;
}
const LAT = [makeLattice(11), makeLattice(23), makeLattice(37)];

// periodic value noise; period p must divide 256
function vnoise(x, y, p, lat) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const x0 = ((xi % p) + p) % p, y0 = ((yi % p) + p) % p;
  const x1 = (x0 + 1) % p, y1 = (y0 + 1) % p;
  const a = lat[y0 * 256 + x0], b = lat[y0 * 256 + x1];
  const c = lat[y1 * 256 + x0], d = lat[y1 * 256 + x1];
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
// tileable fbm over unit square [0,1)^2
export function fbm(u, v, base = 4, oct = 5, lat = 0) {
  let s = 0, amp = 0.5, f = base, norm = 0;
  for (let o = 0; o < oct; o++) {
    s += amp * vnoise(u * f, v * f, f, LAT[lat]);
    norm += amp; amp *= 0.5; f *= 2;
  }
  return s / norm;
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function toTex(c, srgb, repeat) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  t.needsUpdate = true;
  return t;
}

// height (Float32Array w*h, 0..1) -> tangent-space normal map canvas
function normalFromHeight(hgt, w, h, strength) {
  const c = canvas(w, h), ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const xl = hgt[y * w + ((x - 1 + w) % w)], xr = hgt[y * w + ((x + 1) % w)];
      const yu = hgt[((y - 1 + h) % h) * w + x], yd = hgt[((y + 1) % h) * w + x];
      let nx = (xl - xr) * strength, ny = (yd - yu) * strength, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      const i = (y * w + x) * 4;
      d[i] = (nx / l * 0.5 + 0.5) * 255;
      d[i + 1] = (ny / l * 0.5 + 0.5) * 255;
      d[i + 2] = (nz / l * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function grayCanvas(vals, w, h) {
  const c = canvas(w, h), ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h), d = img.data;
  for (let i = 0; i < w * h; i++) {
    const g = Math.max(0, Math.min(255, vals[i] * 255));
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = g; d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// ---------- concrete garage floor (one tile = 3m x 3m slab) ----------
export function concrete(size = 1024) {
  const w = size, h = size;
  const col = canvas(w, h), ctx = col.getContext('2d');
  const img = ctx.createImageData(w, h), d = img.data;
  const hgt = new Float32Array(w * h), rough = new Float32Array(w * h);
  const r = mulberry32(99);
  // oil / beer stain blobs
  const stains = [];
  for (let i = 0; i < 7; i++) stains.push([r(), r(), 0.03 + r() * 0.12, 0.25 + r() * 0.5]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w, v = y / h;
      const n1 = fbm(u, v, 4, 6, 0);
      const n2 = fbm(u, v, 32, 3, 1);
      const n3 = fbm(u, v, 128, 2, 2);
      let g = 0.50 + (n1 - 0.5) * 0.22 + (n2 - 0.5) * 0.10 + (n3 - 0.5) * 0.08;
      let rr = 0.82 + (n2 - 0.5) * 0.15;
      let st = 0;
      for (const [sx, sy, sr, sa] of stains) {
        let dx = Math.abs(u - sx); dx = Math.min(dx, 1 - dx);
        let dy = Math.abs(v - sy); dy = Math.min(dy, 1 - dy);
        const dist = Math.hypot(dx, dy * 1.3) / sr + (fbm(u, v, 16, 3, 1) - 0.5) * 0.9;
        if (dist < 1) st = Math.max(st, (1 - dist) * sa);
      }
      g *= 1 - st * 0.45; rr -= st * 0.35;
      // control joint saw-cut at the tile edge
      const ex = Math.min(x, w - 1 - x), ey = Math.min(y, h - 1 - y);
      const e = Math.min(ex, ey);
      let ht = n2 * 0.6 + n3 * 0.4;
      if (e < 2) { g *= 0.35; ht = 0; rr = 0.95; } else if (e < 4) { g *= 0.8; ht *= 0.6; }
      // aggregate speckles
      if (n3 > 0.78) g *= 0.82;
      const i = y * w + x;
      hgt[i] = ht; rough[i] = rr;
      d[i * 4] = g * 255 * 0.98;
      d[i * 4 + 1] = g * 255 * 0.97;
      d[i * 4 + 2] = g * 255 * 0.94;
      d[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // hairline cracks
  ctx.strokeStyle = 'rgba(40,38,36,0.55)'; ctx.lineWidth = 1.2;
  for (let k = 0; k < 5; k++) {
    let x = r() * w, y = r() * h, a = r() * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let s = 0; s < 40; s++) { a += (r() - 0.5) * 0.8; x += Math.cos(a) * 6; y += Math.sin(a) * 6; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  return {
    map: toTex(col, true),
    normalMap: toTex(normalFromHeight(hgt, w, h, 5), false),
    roughnessMap: toTex(grayCanvas(rough, w, h), false),
  };
}

// ---------- folding table top: white/light-gray granite-fleck HDPE ----------
export function tableTop(w = 512, h = 1024) {
  const col = canvas(w, h), ctx = col.getContext('2d');
  const img = ctx.createImageData(w, h), d = img.data;
  const hgt = new Float32Array(w * h);
  const r = mulberry32(5);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w, v = y / h;
      const pebble = fbm(u * 2, v, 64, 2, 2);
      const low = fbm(u, v, 4, 4, 0);
      let g = 0.80 + (low - 0.5) * 0.06;
      // granite flecks
      const f = r();
      if (f > 0.985) g -= 0.35 * r();
      else if (f > 0.965) g -= 0.12;
      // edge grime
      const ex = Math.min(x, w - 1 - x) / w, ey = Math.min(y, h - 1 - y) / h;
      g -= Math.max(0, 0.04 - Math.min(ex, ey)) * 2.5;
      // center hinge seam
      if (Math.abs(y - h / 2) < 1.5) g *= 0.45;
      const i = y * w + x;
      hgt[i] = pebble;
      d[i * 4] = g * 248; d[i * 4 + 1] = g * 246; d[i * 4 + 2] = g * 240; d[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // faint dried beer rings and scuffs
  for (let k = 0; k < 9; k++) {
    ctx.strokeStyle = `rgba(150,120,60,${0.06 + r() * 0.08})`;
    ctx.lineWidth = 2 + r() * 2;
    ctx.beginPath();
    ctx.arc(r() * w, r() * h, 22 + r() * 6, 0, Math.PI * 2 * (0.6 + r() * 0.4));
    ctx.stroke();
  }
  for (let k = 0; k < 25; k++) {
    ctx.strokeStyle = `rgba(60,60,60,${0.04 + r() * 0.06})`;
    ctx.lineWidth = 1;
    const x = r() * w, y = r() * h, a = r() * Math.PI;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * 30 * r(), y + Math.sin(a) * 30 * r()); ctx.stroke();
  }
  return {
    map: toTex(col, true),
    normalMap: toTex(normalFromHeight(hgt, w, h, 1.6), false),
  };
}

// ---------- painted drywall ----------
export function drywall(tint = [0.86, 0.84, 0.79]) {
  const w = 512, h = 512;
  const col = canvas(w, h), ctx = col.getContext('2d');
  const img = ctx.createImageData(w, h), d = img.data;
  const hgt = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / w, v = y / h;
    const n = fbm(u, v, 8, 4, 0), m = fbm(u, v, 128, 2, 1);
    const g = 0.96 + (n - 0.5) * 0.06 + (m - 0.5) * 0.03;
    const i = y * w + x;
    hgt[i] = m;
    d[i * 4] = g * tint[0] * 255; d[i * 4 + 1] = g * tint[1] * 255; d[i * 4 + 2] = g * tint[2] * 255; d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return { map: toTex(col, true), normalMap: toTex(normalFromHeight(hgt, w, h, 0.8), false) };
}

// ---------- sectional steel garage door with raised long panels ----------
export function garageDoor() {
  const w = 1024, h = 512; // 4.9m x 2.15m
  const hgt = new Float32Array(w * h);
  const col = canvas(w, h), ctx = col.getContext('2d');
  const img = ctx.createImageData(w, h), d = img.data;
  const sections = 4, cols = 4;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sv = (y / h) * sections, s = Math.floor(sv), fy = sv - s;
    const cu = (x / w) * cols, fx = cu - Math.floor(cu);
    let ht = 0.5;
    if (fy < 0.025 || fy > 0.975) ht = 0.0; // section joints
    else {
      const inx = fx > 0.06 && fx < 0.94, iny = fy > 0.16 && fy < 0.84;
      if (inx && iny) ht = 0.85;
      const bx = Math.min(Math.abs(fx - 0.06), Math.abs(fx - 0.94));
      const by = Math.min(Math.abs(fy - 0.16), Math.abs(fy - 0.84));
      if ((bx < 0.01 && iny) || (by < 0.02 && inx)) ht = 0.65;
    }
    const u = x / w, v = y / h;
    const n = fbm(u, v, 8, 3, 1);
    let g = 0.93 + (n - 0.5) * 0.05 - (ht === 0 ? 0.35 : 0);
    g -= Math.max(0, v - 0.85) * 0.5 * (0.6 + n); // dirt near bottom
    const i = y * w + x;
    hgt[i] = ht;
    d[i * 4] = g * 238; d[i * 4 + 1] = g * 236; d[i * 4 + 2] = g * 230; d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // blur height a touch for soft emboss
  const hb = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let k = -2; k <= 2; k++) s += hgt[y * w + Math.min(w - 1, Math.max(0, x + k))] + hgt[Math.min(h - 1, Math.max(0, y + k)) * w + x];
    hb[y * w + x] = s / 10;
  }
  return { map: toTex(col, true), normalMap: toTex(normalFromHeight(hb, w, h, 6), false) };
}

// ---------- pegboard ----------
export function pegboard() {
  const w = 512, h = 256;
  const c = canvas(w, h), ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const n = fbm(x / w, y / h, 16, 4, 0);
    const g = 0.95 + (n - 0.5) * 0.2;
    const i = (y * w + x) * 4;
    d[i] = 150 * g; d[i + 1] = 108 * g; d[i + 2] = 70 * g; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  ctx.fillStyle = 'rgba(25,18,12,0.95)';
  const step = 10.6; // 1" grid on a 2.4 x 1.2 m board
  for (let y = step / 2; y < h; y += step) for (let x = step / 2; x < w; x += step) {
    ctx.beginPath(); ctx.arc(x, y, 1.8, 0, Math.PI * 2); ctx.fill();
  }
  return { map: toTex(c, true) };
}

// ---------- wood ----------
export function wood(dark = false) {
  const w = 512, h = 512;
  const c = canvas(w, h), ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / w, v = y / h;
    const n = fbm(u * 0.25, v, 8, 4, 1);
    const grain = Math.sin((u * 40 + n * 12) * Math.PI) * 0.5 + 0.5;
    const plank = Math.floor(v * 4);
    const g = 0.75 + grain * 0.15 + (fbm(u, v, 64, 2, 2) - 0.5) * 0.1 + (plank % 2) * 0.04;
    const seam = (v * 4) % 1 < 0.01 ? 0.5 : 1;
    const base = dark ? [120, 82, 52] : [196, 158, 112];
    const i = (y * w + x) * 4;
    d[i] = base[0] * g * seam; d[i + 1] = base[1] * g * seam; d[i + 2] = base[2] * g * seam; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return { map: toTex(c, true) };
}

// ---------- cardboard box ----------
export function cardboard(label) {
  const w = 256, h = 256;
  const c = canvas(w, h), ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const n = fbm(x / w, y / h, 16, 3, 2);
    const corr = Math.sin(x * 0.9) * 0.015;
    const g = 0.9 + (n - 0.5) * 0.15 + corr;
    const i = (y * w + x) * 4;
    d[i] = 176 * g; d[i + 1] = 134 * g; d[i + 2] = 88 * g; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  ctx.fillStyle = 'rgba(205,180,130,0.85)';
  ctx.fillRect(w / 2 - 18, 0, 36, h);
  if (label) {
    ctx.fillStyle = 'rgba(30,30,30,0.75)';
    ctx.font = 'bold 30px "Marker Felt", "Comic Sans MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.save(); ctx.translate(w / 2, h * 0.62); ctx.rotate(-0.05);
    ctx.fillText(label, 0, 0); ctx.restore();
  }
  return { map: toTex(c, true) };
}

// ---------- beer can label (generic, made-up brand) ----------
export function canLabel(hue = 210, text = 'LAGER') {
  const w = 256, h = 128;
  const c = canvas(w, h), ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, `hsl(${hue},60%,45%)`);
  g.addColorStop(1, `hsl(${hue},65%,28%)`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = 'bold 34px Georgia, serif'; ctx.textAlign = 'center';
  ctx.fillText(text, w / 2, h * 0.62);
  ctx.fillStyle = 'rgba(255,215,120,0.9)'; ctx.fillRect(0, h * 0.12, w, 4); ctx.fillRect(0, h * 0.84, w, 4);
  return { map: toTex(c, true) };
}

// soft radial glow sprite
export function glowSprite() {
  const c = canvas(64, 64), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,220,160,1)');
  g.addColorStop(0.25, 'rgba(255,190,110,0.5)');
  g.addColorStop(1, 'rgba(255,170,80,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// blob shadow
export function blobShadow() {
  const c = canvas(64, 64), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
