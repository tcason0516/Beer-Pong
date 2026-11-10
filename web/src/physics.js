// Ping-pong ball physics: gravity, air drag, table/floor/wall bounces,
// cup rim + wall collisions, and "sink" detection.
import * as THREE from 'three';

export const G = 9.81;
export const BALL_R = 0.02;           // 40 mm ball
export const K_DRAG = 0.115;          // 0.5*rho*Cd*A/m  (1/m)
export const TABLE = { halfW: 0.381, halfL: 0.915, y: 0.74 }; // 6 ft Lifetime-style table
export const CUP = { H: 0.12, rB: 0.0295, rT: 0.0465, rimTube: 0.0022 };
export const ROOM = { minX: -3.2, maxX: 3.2, minZ: -5.0, maxZ: 2.6, ceil: 2.75 };

export const cupRadiusAt = (h) => CUP.rB + (CUP.rT - CUP.rB) * (h / CUP.H);

const tmp = new THREE.Vector3();

export class Ball {
  constructor() {
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.spin = new THREE.Vector3();
    this.active = false;
    this.sunk = -1;         // index into cups when made
    this.time = 0;
    this.restTime = 0;
    this.touchedTable = false;
    this.bounces = 0;
    this.rimHits = 0;
    this.onFloor = false;
  }
  launch(p, v) {
    this.pos.copy(p); this.vel.copy(v);
    this.active = true; this.sunk = -1; this.time = 0; this.restTime = 0;
    this.touchedTable = false; this.bounces = 0; this.rimHits = 0; this.onFloor = false;
  }
}

/**
 * Advance a ball by dt. cups: array of {x, z, active}. Emits events via cb(type, data).
 */
export function stepBall(ball, dt, cups, cb) {
  if (!ball.active) return;
  const p = ball.pos, v = ball.vel;
  ball.time += dt;

  // gravity + quadratic drag
  const sp = v.length();
  v.x += -K_DRAG * sp * v.x * dt;
  v.y += (-G - K_DRAG * sp * v.y) * dt;
  v.z += -K_DRAG * sp * v.z * dt;
  p.addScaledVector(v, dt);

  const R = BALL_R;
  const ty = TABLE.y;

  // ---- cups ----
  for (let i = 0; i < cups.length; i++) {
    const c = cups[i];
    if (!c.active) continue;
    const dx = p.x - c.x, dz = p.z - c.z;
    const d = Math.hypot(dx, dz);
    if (d > CUP.rT + R + 0.01) continue;
    const h = p.y - ty;
    if (h > CUP.H + R + 0.01 || h < -R) continue;

    // sink: centre drops through the opening, well inside the rim
    if (h <= CUP.H - 0.004 && h > CUP.H - 0.07 && d < CUP.rT - R * 0.55 && v.y < 0) {
      ball.sunk = i; ball.active = false;
      cb('sink', { cup: i, speed: sp });
      return;
    }

    // rim (torus) collision
    if (d > 1e-6) {
      const qx = c.x + (dx / d) * CUP.rT, qz = c.z + (dz / d) * CUP.rT, qy = ty + CUP.H;
      tmp.set(p.x - qx, p.y - qy, p.z - qz);
      const dist = tmp.length();
      const minD = R + CUP.rimTube;
      if (dist < minD && dist > 1e-6) {
        tmp.multiplyScalar(1 / dist);
        p.addScaledVector(tmp, minD - dist);
        const vn = v.dot(tmp);
        if (vn < 0) {
          v.addScaledVector(tmp, -(1 + 0.5) * vn);
          // tangential friction
          const vt = v.clone().addScaledVector(tmp, -v.dot(tmp));
          v.addScaledVector(vt, -0.08);
          ball.rimHits++;
          cb('rim', { cup: i, speed: -vn });
        }
        continue;
      }
    }

    // outer wall (only below the rim)
    if (h > 0 && h < CUP.H) {
      const rr = cupRadiusAt(h);
      if (d < rr + R && d > rr - 0.012) {
        const nx = dx / d, nz = dz / d;
        // wall leans outward: normal tilts slightly downward
        const slope = (CUP.rT - CUP.rB) / CUP.H;
        const n = tmp.set(nx, -slope, nz).normalize();
        const pen = rr + R - d;
        p.x += nx * pen; p.z += nz * pen;
        const vn = v.dot(n);
        if (vn < 0) {
          v.addScaledVector(n, -(1 + 0.45) * vn);
          cb('cupwall', { cup: i, speed: -vn });
        }
      }
    }
  }

  // ---- table ----
  const onTable = Math.abs(p.x) < TABLE.halfW + R * 0.3 && Math.abs(p.z) < TABLE.halfL + R * 0.3;
  if (onTable && p.y - R < ty && p.y - R > ty - 0.04 && v.y < 0) {
    p.y = ty + R;
    const vy = -v.y;
    v.y = vy * 0.78;
    v.x *= 0.93; v.z *= 0.93;
    ball.touchedTable = true; ball.bounces++;
    if (vy > 0.25) cb('table', { speed: vy });
    if (v.y < 0.12) v.y = 0; // rolling
  }
  // table edge thickness: if below top and inside footprint, push out sideways
  if (onTable && p.y < ty - 0.005 && p.y > ty - 0.05) {
    const ox = TABLE.halfW + R - Math.abs(p.x), oz = TABLE.halfL + R - Math.abs(p.z);
    if (ox < oz) { p.x = Math.sign(p.x) * (TABLE.halfW + R); v.x = -v.x * 0.5; }
    else { p.z = Math.sign(p.z) * (TABLE.halfL + R); v.z = -v.z * 0.5; }
    cb('tableedge', { speed: sp });
  }

  // ---- floor ----
  if (p.y - R < 0) {
    p.y = R;
    if (v.y < 0) {
      const vy = -v.y;
      v.y = vy * 0.72;
      v.x *= 0.9; v.z *= 0.9;
      ball.onFloor = true;
      if (vy > 0.3) cb('floor', { speed: vy });
      if (v.y < 0.15) { v.y = 0; v.x *= 0.995; v.z *= 0.995; }
    }
  }
  // ---- walls / ceiling ----
  if (p.x < ROOM.minX + R) { p.x = ROOM.minX + R; v.x = Math.abs(v.x) * 0.6; cb('wall', { speed: Math.abs(v.x) }); }
  if (p.x > ROOM.maxX - R) { p.x = ROOM.maxX - R; v.x = -Math.abs(v.x) * 0.6; cb('wall', { speed: Math.abs(v.x) }); }
  if (p.z < ROOM.minZ + R) { p.z = ROOM.minZ + R; v.z = Math.abs(v.z) * 0.6; cb('wall', { speed: Math.abs(v.z) }); }
  if (p.z > ROOM.maxZ - R) { p.z = ROOM.maxZ - R; v.z = -Math.abs(v.z) * 0.6; cb('wall', { speed: Math.abs(v.z) }); }
  if (p.y > ROOM.ceil - R) { p.y = ROOM.ceil - R; v.y = -Math.abs(v.y) * 0.5; }

  // resting detection
  if (v.lengthSq() < 0.02 && (ball.onFloor || Math.abs(p.y - (ty + R)) < 0.002)) ball.restTime += dt;
}

/**
 * Find launch velocity from `from` so a drag-affected ball, launched at
 * `angle` (radians above horizontal), passes through `target` while descending.
 */
export function solveLaunch(from, target, angle) {
  const dx = target.x - from.x, dz = target.z - from.z;
  const D = Math.hypot(dx, dz);
  const ux = dx / D, uz = dz / D;
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const dt = 1 / 240;
  const reach = (speed) => {
    let x = 0, y = from.y, vx = speed * ca, vy = speed * sa;
    let prevX = 0, prevY = y;
    for (let i = 0; i < 1200; i++) {
      const s = Math.hypot(vx, vy);
      vx += -K_DRAG * s * vx * dt;
      vy += (-G - K_DRAG * s * vy) * dt;
      prevX = x; prevY = y;
      x += vx * dt; y += vy * dt;
      if (vy < 0 && y <= target.y) {
        const f = (prevY - target.y) / (prevY - y || 1);
        return prevX + (x - prevX) * f;
      }
    }
    return x;
  };
  let lo = 0.5, hi = 14;
  for (let k = 0; k < 28; k++) {
    const mid = (lo + hi) / 2;
    if (reach(mid) < D) lo = mid; else hi = mid;
  }
  const s = (lo + hi) / 2;
  return new THREE.Vector3(ux * s * ca, s * sa, uz * s * ca);
}

export function gaussian(rand = Math.random) {
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
