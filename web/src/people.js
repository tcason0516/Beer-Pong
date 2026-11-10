// Party guests and the opponent: skinned characters driven by retargeted
// Mixamo-style clips, a simple walking AI, and a procedural throwing arm.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { makeCup } from './scene.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[(Math.random() * a.length) | 0];
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();

// ---------- retargeting ----------
// Source clips (Xbot) use "mixamorig:Bone" names. Both our characters use the
// same Mixamo skeleton layout, so local rotations transfer directly, except for
// the hips, whose parent frame and scale differ per file.
function findBone(root, base) {
  let hit = null;
  root.traverse(o => { if (!hit && o.isBone && o.name.replace(/^mixamorig:?/, '') === base) hit = o; });
  return hit;
}
const PREFERRED_CHILD = { Hips: 'Spine', Spine2: 'Neck', LeftHand: 'LeftHandMiddle1', RightHand: 'RightHandMiddle1', Head: 'HeadTop_End' };
const baseName = (n) => n.replace(/^mixamorig:?/, '');

function boneMap(root) {
  const m = new Map(), order = [];
  root.traverse(o => { if (o.isBone) { m.set(baseName(o.name), o); order.push(o); } });
  return { m, order };
}
function mainChild(bone, map) {
  const want = PREFERRED_CHILD[baseName(bone.name)];
  if (want && map.has(want)) return map.get(want);
  return bone.children.find(c => c.isBone && map.has(baseName(c.name))) || null;
}

/**
 * Bake `clip` (animating srcRoot's skeleton) onto dstRoot's skeleton in world space.
 * The destination rest pose is first swung so every bone points the same way as
 * the source rest pose (A-pose -> T-pose), then per-frame world rotations are
 * transferred as deltas from rest.
 */
function retarget(clip, srcRoot, dstRoot, fps = 30) {
  const S = boneMap(srcRoot), D = boneMap(dstRoot);
  const saved = D.order.map(b => b.quaternion.clone());
  const sSaved = S.order.map(b => [b.position.clone(), b.quaternion.clone(), b.scale.clone()]);
  srcRoot.updateMatrixWorld(true); dstRoot.updateMatrixWorld(true);
  const wq = (o) => o.getWorldQuaternion(new THREE.Quaternion());
  const wp = (o) => o.getWorldPosition(new THREE.Vector3());

  // 1) align destination rest directions to the source rest
  for (const b of D.order) {
    const name = baseName(b.name), sb = S.m.get(name);
    if (!sb) continue;
    const dc = mainChild(b, D.m), sc = dc && S.m.get(baseName(dc.name));
    if (!dc || !sc) continue;
    const td = wp(dc).sub(wp(b)), sd = wp(sc).sub(wp(sb));
    if (td.lengthSq() < 1e-10 || sd.lengthSq() < 1e-10) continue;
    const rot = new THREE.Quaternion().setFromUnitVectors(td.normalize(), sd.normalize());
    const nw = rot.multiply(wq(b));
    b.quaternion.copy(wq(b.parent).invert().multiply(nw));
    b.updateMatrixWorld(true);
  }
  const dRest = new Map(), sRestInv = new Map();
  for (const b of D.order) dRest.set(b, wq(b));
  for (const [n, sb] of S.m) sRestInv.set(n, wq(sb).invert());
  const dHips = D.m.get('Hips'), sHips = S.m.get('Hips');
  const dHipW = wp(dHips), sHipW = wp(sHips);
  const scale = dHipW.y / sHipW.y;
  const dHipsParentInv = dHips.parent.matrixWorld.clone().invert();
  const dParentRest = new Map(), dLocalRest = new Map();
  for (const b of D.order) { dParentRest.set(b, wq(b.parent)); dLocalRest.set(b, b.quaternion.clone()); }

  // 2) sample the source animation
  const mixer = new THREE.AnimationMixer(srcRoot);
  const act = mixer.clipAction(clip); act.play();
  const n = Math.max(2, Math.round(clip.duration * fps) + 1);
  const times = new Float32Array(n);
  const qv = new Map(D.order.map(b => [b, new Float32Array(n * 4)]));
  const pv = new Float32Array(n * 3);
  const curW = new Map();
  for (let i = 0; i < n; i++) {
    const t = Math.min(clip.duration, i / fps); times[i] = t;
    mixer.setTime(t); srcRoot.updateMatrixWorld(true);
    curW.clear();
    for (const b of D.order) {
      const name = baseName(b.name), sb = S.m.get(name);
      let w;
      if (sb) w = wq(sb).multiply(sRestInv.get(name)).multiply(dRest.get(b));
      else w = (curW.get(b.parent) || dParentRest.get(b)).clone().multiply(dLocalRest.get(b));
      curW.set(b, w);
      const pw = curW.get(b.parent) || dParentRest.get(b);
      pw.clone().invert().multiply(w).toArray(qv.get(b), i * 4);
    }
    const hw = wp(sHips);
    new THREE.Vector3(dHipW.x, dHipW.y + (hw.y - sHipW.y) * scale, dHipW.z).applyMatrix4(dHipsParentInv).toArray(pv, i * 3);
  }
  act.stop(); mixer.uncacheRoot(srcRoot);
  // reset source to bind pose and restore destination
  S.order.forEach((b, i) => { b.position.copy(sSaved[i][0]); b.quaternion.copy(sSaved[i][1]); b.scale.copy(sSaved[i][2]); });
  srcRoot.updateMatrixWorld(true);
  D.order.forEach((b, i) => b.quaternion.copy(saved[i]));
  dstRoot.updateMatrixWorld(true);

  const tracks = [];
  for (const b of D.order) {
    tracks.push(new THREE.QuaternionKeyframeTrack(b.name + '.quaternion', times, qv.get(b)));
  }
  tracks.push(new THREE.VectorKeyframeTrack(dHips.name + '.position', times, pv));
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

// ---------- character ----------
class Person {
  constructor(tpl, clips, opts) {
    this.root = SkeletonUtils.clone(tpl.scene);
    this.root.scale.setScalar(tpl.scale * (opts.heightMul || 1));
    this.root.traverse(o => {
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
        if (o.material) {
          o.material = o.material.clone();
          const tint = opts.tint && opts.tint[o.name];
          if (tint === null) o.visible = false;
          else if (tint) o.material.color.setHex(tint);
          const map = opts.maps && opts.maps[o.name];
          if (map) { o.material.map = map; o.material.needsUpdate = true; }
          o.material.envMapIntensity = 0.6;
        }
      }
    });
    this.mixer = new THREE.AnimationMixer(this.root);
    this.actions = {};
    for (const [k, c] of Object.entries(clips)) this.actions[k] = this.mixer.clipAction(c);
    this.current = null;
    this.play('idle', 0);
    this.mixer.setTime(Math.random() * 5);
    this.bones = {};
    for (const b of ['Hips', 'Spine2', 'Neck', 'Head', 'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', 'LeftArm', 'LeftForeArm', 'LeftHand',
      'RightHandMiddle1', 'RightHandMiddle2', 'RightHandThumb1', 'RightHandThumb2'])
      this.bones[b] = findBone(this.root, b);
    this.heading = 0;
    this.lookTarget = null;
  }
  play(name, fade = 0.35, once = false) {
    const a = this.actions[name];
    if (!a || (this.current === a && !once)) return;
    a.reset();
    a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    a.clampWhenFinished = once;
    a.enabled = true; a.setEffectiveWeight(1);
    if (this.current && fade > 0) a.crossFadeFrom(this.current, fade, true);
    else if (this.current) this.current.stop();
    a.play();
    this.prev = this.current; this.current = a;
    if (once) {
      clearTimeout(this._onceT);
      this._onceT = setTimeout(() => { if (this.current === a) this.play(this.walking ? 'walk' : 'idle', 0.4); }, Math.max(0.2, a.getClip().duration - 0.35) * 1000);
    }
  }
  setPos(x, z, heading) {
    this.root.position.set(x, 0, z);
    if (heading !== undefined) { this.heading = heading; this.root.rotation.y = heading; }
  }
  update(dt) { this.mixer.update(dt); }
  // turn the head toward a world point (post-animation)
  lookAt(p, amount = 0.6) {
    const head = this.bones.Head; if (!head) return;
    head.updateWorldMatrix(true, false);
    const hp = head.getWorldPosition(_v);
    const dir = _v2.copy(p).sub(hp).normalize();
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.root.quaternion);
    const yaw = THREE.MathUtils.clamp(Math.atan2(dir.x, dir.z) - Math.atan2(fwd.x, fwd.z), -1, 1);
    const pitch = THREE.MathUtils.clamp(-Math.asin(dir.y) * 0.6, -0.4, 0.4);
    const qy = _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), wrap(yaw) * amount);
    const qx = _q2.setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch * amount);
    head.quaternion.premultiply(qy).multiply(qx);
  }
}
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// rotate `bone` (world space) so the direction to `childWorld` points at `targetWorld`
function aimBone(bone, childWorld, targetWorld, weight = 1) {
  const bp = bone.getWorldPosition(new THREE.Vector3());
  const cur = childWorld.clone().sub(bp).normalize();
  const des = targetWorld.clone().sub(bp).normalize();
  const rot = new THREE.Quaternion().setFromUnitVectors(cur, des);
  if (weight < 1) rot.slerp(new THREE.Quaternion(), 1 - weight);
  const bw = bone.getWorldQuaternion(new THREE.Quaternion());
  const pw = bone.parent.getWorldQuaternion(new THREE.Quaternion());
  const nw = rot.multiply(bw);
  bone.quaternion.copy(pw.invert().multiply(nw));
  bone.updateMatrixWorld(true);
}

// analytic two-bone IK for an arm: shoulder->elbow->hand reaches `target`, elbow bends toward `pole`
function armIK(upper, lower, hand, target, pole, weight = 1) {
  upper.updateWorldMatrix(true, true);
  const S = upper.getWorldPosition(new THREE.Vector3());
  const E = lower.getWorldPosition(new THREE.Vector3());
  const H = hand.getWorldPosition(new THREE.Vector3());
  const L1 = S.distanceTo(E), L2 = E.distanceTo(H);
  const T = target.clone();
  const d = Math.min(S.distanceTo(T), (L1 + L2) * 0.999);
  const dir = T.clone().sub(S).normalize();
  T.copy(S).addScaledVector(dir, d);
  const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  const poleDir = pole.clone().sub(S);
  poleDir.addScaledVector(dir, -poleDir.dot(dir)).normalize();
  const elbow = S.clone().addScaledVector(dir, a).addScaledVector(poleDir, h);
  aimBone(upper, E, elbow, weight);
  const E2 = lower.getWorldPosition(new THREE.Vector3());
  const H2 = hand.getWorldPosition(new THREE.Vector3());
  aimBone(lower, H2, T, weight);
  return E2;
}

// ---------- the crowd ----------
export class People {
  constructor(scene) {
    this.scene = scene;
    this.guests = [];
    this.opp = null;
    this.ready = false;
    this.time = 0;
  }

  async load(base = 'models/') {
    const loader = new GLTFLoader();
    const [guy, girl, anim] = await Promise.all([
      loader.loadAsync(base + 'guy.glb'), loader.loadAsync(base + 'girl.glb'), loader.loadAsync(base + 'anims.glb'),
    ]);
    const tplOf = (g, height) => {
      g.scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(g.scene);
      return { scene: g.scene, scale: height / (box.max.y - box.min.y || 1) };
    };
    // retarget in bind pose: put the source in its rest pose first
    const src = anim.scene;
    const want = { idle: 'idle', walk: 'walk', agree: 'agree', headShake: 'headShake' };
    const byName = Object.fromEntries(anim.animations.map(a => [a.name, a]));
    const mk = (dst) => {
      const out = {};
      for (const [k, n] of Object.entries(want)) if (byName[n]) out[k] = retarget(byName[n], src, dst);
      return out;
    };
    const tl = new THREE.TextureLoader();
    const tex = async (f) => { const t = await tl.loadAsync(base + 'tex/' + f); t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
    [this.texTee, this.texJeans, this.texGirlBrown, this.texGirlBlonde] = await Promise.all(
      ['tee.jpg', 'jeans.jpg', 'girl_brown.jpg', 'girl_blonde.jpg'].map(tex));
    outfitGuy(guy.scene, this.texTee, this.texJeans);
    this.tplGuy = tplOf(guy, 1.8);
    this.tplGirl = tplOf(girl, 1.66);
    this.clipsGuy = mk(guy.scene);
    this.clipsGirl = mk(girl.scene);
    this._spawn();
    this.ready = true;
  }

  _person(kind, opts) {
    const p = kind === 'girl' ? new Person(this.tplGirl, this.clipsGirl, opts) : new Person(this.tplGuy, this.clipsGuy, opts);
    this.scene.add(p.root);
    return p;
  }

  _cupInHand(p) {
    if (!p.bones.RightHand) return;
    const cup = makeCup();
    cup.traverse(o => { if (o.isMesh) o.castShadow = true; });
    this.scene.add(cup);
    p.cup = cup;
  }
  // cup stays upright in the guest's right hand
  _placeCup(p) {
    const h = p.bones.RightHand.getWorldPosition(_v);
    const yaw = p.root.rotation.y;
    p.cup.position.set(h.x + Math.sin(yaw) * 0.035, h.y - 0.075, h.z + Math.cos(yaw) * 0.035);
    p.cup.rotation.set(0, yaw, 0);
  }

  _spawn() {
    // opponent: stands behind the far end of the table
    this.opp = this._person('guy', { tint: { Wolf3D_Outfit_Top: 0x2f4f7a } });
    this.opp.setPos(0.05, -1.42, 0);
    this.opp.home = new THREE.Vector3(0.05, 0, -1.42);

    const guy = (tee, jeans, cap, beard, h) => ({ kind: 'guy', h,
      tint: { Wolf3D_Outfit_Top: tee, Wolf3D_Outfit_Bottom: jeans, Cap: cap, Beard3D: beard, Wolf3D_Beard: beard } });
    const looks = [
      guy(0x8c2b2b, 0xffffff, 0x1d2a44, 0x7a5235, 0.97),       // red tee, navy cap
      { kind: 'girl', maps: { Ch03: this.texGirlBrown }, h: 1.0 },
      guy(0x4d5b3f, 0xc8d4ff, 0xb9b2a3, 0x5a3d26, 1.03),       // olive tee, khaki cap
      { kind: 'girl', maps: { Ch03: this.texGirlBlonde }, h: 0.97 },
    ];
    const mk = (L) => this._person(L.kind, { tint: L.tint || {}, maps: L.maps, heightMul: L.h });
    // two people chatting behind the opponent on the left
    const a = mk(looks[0]); a.setPos(-1.25, -2.75, 1.2); a.mode = 'talk';
    const b = mk(looks[1]); b.setPos(-0.55, -2.95, -1.0); b.mode = 'talk';
    a.partner = b; b.partner = a;
    // a spectator on the right watching the game
    const c = mk(looks[2]); c.setPos(1.25, -2.35, -0.7); c.mode = 'watch';
    // someone wandering between the fridge, the door and the workbench
    const d = mk(looks[3]); d.setPos(2.3, -1.9, Math.PI); d.mode = 'walk';
    d.route = [new THREE.Vector3(2.25, 0, -1.4), new THREE.Vector3(1.6, 0, -3.6), new THREE.Vector3(-0.2, 0, -4.1),
      new THREE.Vector3(-2.2, 0, -3.3), new THREE.Vector3(-2.2, 0, -1.7), new THREE.Vector3(-1.4, 0, -3.9), new THREE.Vector3(1.0, 0, -3.8)];
    d.leg = 0; d.wait = 1;
    this.guests = [a, b, c, d];
    for (const g of this.guests) this._cupInHand(g);
    for (const g of this.guests) g.nextGesture = rnd(2, 6);
  }

  /** Dress the opponent for who you're playing. */
  setOpponentLook(key) {
    const L = {
      rick: { top: 0x8a8d90, bottom: 0xd6dcff, cap: 0x7a1f1f, beard: 0xb0aaa2, h: 0.97 },
      tyler: { top: 0xf2f2f0, bottom: 0xffffff, cap: 0x26375a, beard: 0x8a5a36, h: 1.0 },
      mike: { top: 0x232325, bottom: 0xaab4d8, cap: 0x151515, beard: 0x4a3324, h: 1.07 },
    }[key] || {};
    const o = this.opp; if (!o) return;
    o.root.scale.setScalar(this.tplGuy.scale * (L.h || 1));
    o.root.traverse(m => {
      if (!m.isMesh) return;
      if (m.name === 'Wolf3D_Outfit_Top') m.material.color.setHex(L.top);
      if (m.name === 'Wolf3D_Outfit_Bottom') m.material.color.setHex(L.bottom);
      if (m.name === 'Cap') m.material.color.setHex(L.cap);
      if (m.name === 'Beard3D' || m.name === 'Wolf3D_Beard') m.material.color.setHex(L.beard);
    });
  }
  /** Stereo position (-1..1) of a world point as seen from the camera. */
  panOf(obj, camera) {
    if (!obj) return 0;
    const p = obj.getWorldPosition(new THREE.Vector3()).project(camera);
    return THREE.MathUtils.clamp(p.x * 0.8, -1, 1);
  }

  // ---- reactions ----
  react(kind) {
    if (!this.ready) return;
    for (const g of this.guests) {
      if (g.mode === 'walk' && g.walking) continue;
      setTimeout(() => {
        if (kind === 'make' || kind === 'laugh') g.play('agree', 0.2, true);
        else if (kind === 'miss') g.play('headShake', 0.2, true);
      }, rnd(0, 350));
    }
  }
  oppGesture(kind) {
    if (!this.opp || this.opp.throwing) return;
    if (kind === 'yes') this.opp.play('agree', 0.2, true);
    else if (kind === 'no') this.opp.play('headShake', 0.2, true);
    else if (kind === 'celebrate') { this.opp.celebrate = 1.2; this.opp.play('agree', 0.2, true); }
  }

  // ---- opponent throw ----
  /** Start lining up a throw; the ball follows the opponent's hand. */
  startWindup() { const o = this.opp; o.throwing = 'aim'; o.throwT = 0; }
  /** Release: arm snaps forward. */
  release() { const o = this.opp; o.throwing = 'release'; o.throwT = 0; }
  handPos(out = new THREE.Vector3()) {
    const b = this.opp && this.opp.bones;
    if (!b || !b.RightHand) return out.set(0.1, 1.42, -1.25);
    // ball sits between the thumb and the index/middle fingers
    const f = b.RightHandMiddle2 || b.RightHandMiddle1, th = b.RightHandThumb2 || b.RightHandThumb1;
    if (!f || !th) return b.RightHand.getWorldPosition(out);
    const pf = f.getWorldPosition(new THREE.Vector3()), pt = th.getWorldPosition(new THREE.Vector3());
    const wrist = b.RightHand.getWorldPosition(new THREE.Vector3());
    out.copy(pf).lerp(pt, 0.45);
    // push out of the palm, away from the wrist
    out.addScaledVector(out.clone().sub(wrist).normalize(), 0.012);
    return out;
  }

  update(dt, camPos, ballPos) {
    if (!this.ready || !(dt > 0)) return;
    this.time += dt;
    for (const g of this.guests) this._updateGuest(g, dt, camPos, ballPos);
    this._updateOpp(dt, camPos, ballPos);
  }

  _updateGuest(g, dt, camPos, ballPos) {
    if (g.mode === 'walk') {
      if (g.wait > 0) {
        g.wait -= dt; g.play('idle');
        if (g.wait <= 0) { g.leg = (g.leg + 1) % g.route.length; g.walking = true; }
      } else {
        const tgt = g.route[g.leg];
        const pos = g.root.position;
        const to = _v.set(tgt.x - pos.x, 0, tgt.z - pos.z);
        const dist = to.length();
        if (dist < 0.08) { g.walking = false; g.wait = rnd(2, 7); }
        else {
          g.play('walk', 0.3);
          const want = Math.atan2(to.x, to.z);
          g.heading += wrap(want - g.heading) * Math.min(1, dt * 4);
          g.root.rotation.y = g.heading;
          const sp = 1.05 * Math.min(1, dist / 0.4 + 0.3);
          pos.x += Math.sin(g.heading) * sp * dt; pos.z += Math.cos(g.heading) * sp * dt;
        }
      }
    } else {
      g.nextGesture -= dt;
      if (g.nextGesture <= 0) {
        g.nextGesture = rnd(3, 8);
        if (g.mode === 'talk' && Math.random() < 0.6) g.play(Math.random() < 0.7 ? 'agree' : 'headShake', 0.3, true);
      }
    }
    g.update(dt);
    // heads: talkers look at each other, everyone glances at the ball in play
    if (ballPos && g.mode !== 'walk') g.lookAt(ballPos, 0.8);
    else if (g.partner) g.lookAt(g.partner.bones.Head ? g.partner.bones.Head.getWorldPosition(new THREE.Vector3()) : camPos, 0.7);
    if (g.cup) { this._holdCup(g, dt); g.root.updateMatrixWorld(true); this._placeCup(g); }
  }

  // keep the guests' cups held at chest height instead of dangling
  _holdCup(g) {
    const b = g.bones; if (!b.RightArm || !b.RightForeArm || !b.RightHand) return;
    if (g.mode === 'walk' && g.walking) return;
    g.root.updateMatrixWorld(true);
    const fwd = new THREE.Vector3(Math.sin(g.root.rotation.y), 0, Math.cos(g.root.rotation.y));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const sh = b.RightArm.getWorldPosition(new THREE.Vector3());
    const h = g.root.scale.x / this.tplGuy.scale; // rough height factor
    const target = sh.clone().addScaledVector(fwd, 0.22).addScaledVector(right, 0.06).add(new THREE.Vector3(0, -0.28 * Math.min(1.2, h || 1), 0));
    const pole = sh.clone().addScaledVector(right, 0.3).add(new THREE.Vector3(0, -0.6, 0)).addScaledVector(fwd, -0.2);
    armIK(b.RightArm, b.RightForeArm, b.RightHand, target, pole, 1);
  }

  _updateOpp(dt, camPos, ballPos) {
    const o = this.opp;
    o.update(dt);
    o.root.rotation.y = Math.sin(this.time * 0.35) * 0.08; // shifts weight a little
    const b = o.bones;
    if (!b.RightArm) return;
    o.root.updateMatrixWorld(true);
    const sh = b.RightArm.getWorldPosition(new THREE.Vector3());
    if (o.throwing) {
      o.throwT += dt;
      let target, pole = sh.clone().add(new THREE.Vector3(-0.45, -0.4, -0.2));
      if (o.throwing === 'aim') {
        // ball held up near the eye line, small aiming bob
        const s = Math.min(1, o.throwT / 0.5);
        const e = s * s * (3 - 2 * s);
        const rest = sh.clone().add(new THREE.Vector3(0.05, -0.45, 0.1));
        const aim = sh.clone().add(new THREE.Vector3(0.1, 0.22 + Math.sin(this.time * 6) * 0.01, 0.3 + Math.sin(this.time * 2.3) * 0.015));
        if (o.throwT > 0.6) aim.z -= Math.min(0.12, (o.throwT - 0.6) * 0.5); // cock back
        target = rest.lerp(aim, e);
      } else {
        const k = Math.min(1, o.throwT / 0.5);
        const e = 1 - Math.pow(1 - k, 3);
        const from = sh.clone().add(new THREE.Vector3(0.1, 0.22, 0.2));
        const to = sh.clone().add(new THREE.Vector3(0.1, 0.12, 0.62));
        target = from.lerp(to, e);
        if (o.throwT > 0.9) {
          const r = Math.min(1, (o.throwT - 0.9) / 0.6);
          target.lerp(sh.clone().add(new THREE.Vector3(0.05, -0.45, 0.1)), r);
          if (r >= 1) o.throwing = null;
        }
      }
      armIK(b.RightArm, b.RightForeArm, b.RightHand, target, pole, 1);
      if (b.Spine2) { b.Spine2.rotation.x += 0.12; }
    } else if (o.celebrate > 0) {
      o.celebrate -= dt;
      const up = sh.clone().add(new THREE.Vector3(0.05, 0.55 + Math.sin(this.time * 14) * 0.05, 0.1));
      armIK(b.RightArm, b.RightForeArm, b.RightHand, up, sh.clone().add(new THREE.Vector3(-0.5, 0, -0.3)), Math.min(1, o.celebrate * 3));
    }
    // look at the ball when it's flying, otherwise at the player
    o.lookAt(ballPos || camPos, 0.85);
  }
}

function worldScaleOf(obj, stop) {
  let s = 1, o = obj;
  while (o && o !== stop) { s *= o.scale.x; o = o.parent; }
  return s;
}

// ---------- men's outfit: tee, jeans, ball cap, full beard ----------
function skinnedWorldPositions(mesh) {
  const pos = mesh.geometry.attributes.position, out = new Float32Array(pos.count * 3), v = new THREE.Vector3();
  mesh.updateMatrixWorld(true);
  for (let i = 0; i < pos.count; i++) {
    mesh.getVertexPosition(i, v); v.applyMatrix4(mesh.matrixWorld); v.toArray(out, i * 3);
  }
  return out;
}
function boxOf(arr, filter) {
  const b = new THREE.Box3(), v = new THREE.Vector3();
  for (let i = 0; i < arr.length; i += 3) { v.fromArray(arr, i); if (!filter || filter(v)) b.expandByPoint(v); }
  return b;
}

function outfitGuy(root, tee, jeans) {
  root.updateMatrixWorld(true);
  const meshes = {};
  root.traverse(o => { if (o.isMesh) meshes[o.name] = o; });
  if (meshes.Wolf3D_Outfit_Top) { meshes.Wolf3D_Outfit_Top.material.map = tee; meshes.Wolf3D_Outfit_Top.material.color.setHex(0xffffff); }
  if (meshes.Wolf3D_Outfit_Bottom) { meshes.Wolf3D_Outfit_Bottom.material.map = jeans; meshes.Wolf3D_Outfit_Bottom.material.color.setHex(0xffffff); }
  if (meshes.Wolf3D_Headwear) meshes.Wolf3D_Headwear.visible = false;
  if (meshes.Wolf3D_Outfit_Top && meshes.Wolf3D_Outfit_Bottom) {
    const top = meshes.Wolf3D_Outfit_Top, tp = skinnedWorldPositions(top);
    const pants = boxOf(skinnedWorldPositions(meshes.Wolf3D_Outfit_Bottom));
    const cut = pants.max.y - 0.07; // a little below the waistband
    const g = top.geometry, idx = g.index.array, keep = [];
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      if (Math.max(tp[a * 3 + 1], tp[b * 3 + 1], tp[c * 3 + 1]) > cut) keep.push(a, b, c);
    }
    // drop the bow tie: the front-most geometry just under the chin
    const eb = boxOf(skinnedWorldPositions(meshes.EyeLeft));
    const neckY = (eb.min.y + eb.max.y) / 2 - 0.15;
    let maxZ = -Infinity;
    for (let i = 0; i < tp.length; i += 3) if (tp[i + 1] < neckY + 0.02 && tp[i + 1] > neckY - 0.12 && Math.abs(tp[i]) < 0.08) maxZ = Math.max(maxZ, tp[i + 2]);
    const inTie = (i) => tp[i * 3 + 1] < neckY + 0.02 && tp[i * 3 + 1] > neckY - 0.12 && Math.abs(tp[i * 3]) < 0.085 && tp[i * 3 + 2] > maxZ - 0.03;
    const keep2 = [];
    for (let t = 0; t < keep.length; t += 3) if (!(inTie(keep[t]) && inTie(keep[t + 1]) && inTie(keep[t + 2]))) keep2.push(keep[t], keep[t + 1], keep[t + 2]);
    g.setIndex(keep2);
  }
  const head = meshes.Wolf3D_Head; if (!head) return;
  const hp = skinnedWorldPositions(head);
  const eyes = boxOf(skinnedWorldPositions(meshes.EyeLeft)).union(boxOf(skinnedWorldPositions(meshes.EyeRight)));
  const eyeY = (eyes.min.y + eyes.max.y) / 2;
  const skull = boxOf(hp, v => v.y > eyeY);
  const cx = (skull.min.x + skull.max.x) / 2, cz = (skull.min.z + skull.max.z) / 2;
  const rx = (skull.max.x - skull.min.x) / 2, rz = (skull.max.z - skull.min.z) / 2;
  const front = boxOf(hp).max.z;

  // ---- ball cap (child of the Head bone) ----
  let headBone = null; root.traverse(o => { if (o.isBone && baseName(o.name) === 'Head') headBone = o; });
  const capMat = new THREE.MeshStandardMaterial({ color: 0x1d2a44, roughness: 0.85, side: THREE.DoubleSide });
  const cap = new THREE.Group();
  const baseY = eyeY + 0.019;
  const crownH = skull.max.y - baseY + 0.012;
  const prof = [[1.0, 0], [1.0, 0.3], [0.96, 0.55], [0.86, 0.75], [0.66, 0.9], [0.36, 0.985], [0.001, 1.0]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  const crownGeo = new THREE.LatheGeometry(prof, 40);
  const crown = new THREE.Mesh(crownGeo, capMat);
  crown.name = 'Cap';
  const crx = rx + 0.014, crz = rz + 0.014;
  crown.scale.set(crx, crownH, crz);
  crown.position.set(cx, baseY, cz - 0.004);
  crown.rotation.x = 0.02;
  const ext = 0;
  // brim: half-ellipse sticking out of the front of the crown, curved down at the sides
  const sh = new THREE.Shape();
  sh.absellipse(0, 0, crx * 0.92, 0.078, 0, Math.PI, false);
  const billGeo = new THREE.ExtrudeGeometry(sh, { depth: 0.006, bevelEnabled: false, curveSegments: 24 });
  billGeo.rotateX(Math.PI / 2); // shape y -> world z forward... flip to point forward
  const bp = billGeo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < bp.count; i++) {
    v.fromBufferAttribute(bp, i);
    v.y -= (v.x * v.x) * 1.6 + Math.max(0, v.z) * 0.12; // curve
    bp.setXYZ(i, v.x, v.y, v.z);
  }
  billGeo.computeVertexNormals();
  const bill = new THREE.Mesh(billGeo, capMat);
  bill.name = 'Cap';
  bill.position.set(cx, baseY + 0.021, cz + crz * 0.93);
  bill.rotation.x = 0.16;
  const button = new THREE.Mesh(new THREE.SphereGeometry(0.0065, 10, 6), capMat);
  button.name = 'Cap'; button.position.set(cx, crown.position.y + crownH - 0.003, cz - 0.01);
  cap.add(crown, bill, button);
  cap.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
  if (headBone) {
    headBone.updateMatrixWorld(true);
    const inv = headBone.matrixWorld.clone().invert();
    cap.applyMatrix4(inv);
    headBone.add(cap);
  }

  // ---- full beard: a thin shell over the jaw, cheeks and chin of the head mesh ----
  const must = meshes.Wolf3D_Beard ? boxOf(skinnedWorldPositions(meshes.Wolf3D_Beard)) : null;
  const mustMid = meshes.Wolf3D_Beard ? boxOf(skinnedWorldPositions(meshes.Wolf3D_Beard), p => Math.abs(p.x - cx) < 0.008) : null;
  const mouthY = mustMid && !mustMid.isEmpty() ? mustMid.min.y - 0.011 : eyeY - 0.085;
  const noseBaseY = must ? must.max.y : eyeY - 0.06;
  const chin = boxOf(hp, p => p.z > front - 0.03 && Math.abs(p.x - cx) < 0.02 && p.y < mouthY);
  const chinY = chin.isEmpty() ? mouthY - 0.05 : chin.min.y;
  const inBeard = (x, y, z) => {
    const dx = Math.abs(x - cx);
    // cheek line: from the corners of the mustache up to the sideburns by the ears
    const top = THREE.MathUtils.lerp(noseBaseY - 0.012, eyeY - 0.012, THREE.MathUtils.clamp((dx - 0.025) / 0.05, 0, 1));
    if (y > top || y < chinY - 0.03) return false;
    if (z < cz - 0.035) return false;                                  // not the back of the head
    if (y < chinY + 0.005 && z < front - 0.075) return false;          // only a little under the chin
    if (Math.abs(x - cx) < 0.03 && y > noseBaseY - 0.004) return false;  // nose
    if (y > noseBaseY + 0.004 && z > front - 0.05 && Math.abs(x - cx) < 0.045) return false; // upper cheeks by the nose
    const ex = (x - cx) / 0.026, ey = (y - mouthY) / 0.011;
    if (ex * ex + ey * ey < 1 && z > front - 0.04) return false;      // keep the lips clear
    return true;
  };
  const g = head.geometry, idx = g.index ? g.index.array : null;
  const triCount = (idx ? idx.length : g.attributes.position.count) / 3;
  const sel = [];
  const vin = new Uint8Array(g.attributes.position.count);
  for (let i = 0; i < vin.length; i++) vin[i] = inBeard(hp[i * 3], hp[i * 3 + 1], hp[i * 3 + 2]) ? 1 : 0;
  const edge = new Uint8Array(vin.length);
  for (let t = 0; t < triCount; t++) {
    const a = idx ? idx[t * 3] : t * 3, b = idx ? idx[t * 3 + 1] : t * 3 + 1, c = idx ? idx[t * 3 + 2] : t * 3 + 2;
    const n = vin[a] + vin[b] + vin[c];
    if (n === 3) sel.push(a, b, c);
    else if (n > 0) { edge[a] = edge[b] = edge[c] = 1; }
  }
  if (sel.length) {
    const ng = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'uv', 'skinIndex', 'skinWeight']) {
      const src = g.attributes[name]; if (!src) continue;
      const arr = new (src.array.constructor)(sel.length * src.itemSize);
      sel.forEach((vi, k) => { for (let c = 0; c < src.itemSize; c++) arr[k * src.itemSize + c] = src.getComponent ? src.getComponent(vi, c) : src.array[vi * src.itemSize + c]; });
      ng.setAttribute(name, new THREE.BufferAttribute(arr, src.itemSize, src.normalized));
    }
    // push out along the normal; fade alpha at the edge of the beard
    const P = ng.attributes.position, N = ng.attributes.normal;
    const col = new Float32Array(sel.length * 4);
    sel.forEach((vi, k) => {
      const thick = edge[vi] ? 0.0015 : 0.005;
      P.setXYZ(k, P.getX(k) + N.getX(k) * thick, P.getY(k) + N.getY(k) * thick, P.getZ(k) + N.getZ(k) * thick);
      col[k * 4] = col[k * 4 + 1] = col[k * 4 + 2] = 1; col[k * 4 + 3] = edge[vi] ? 0.15 : 1;
    });
    ng.setAttribute('color', new THREE.BufferAttribute(col, 4));
    const bm = new THREE.MeshStandardMaterial({ color: 0x4a3020, roughness: 0.95, map: beardTexture(), vertexColors: true, transparent: true, alphaTest: 0.05 });
    const beard = new THREE.SkinnedMesh(ng, bm);
    beard.name = 'Beard3D';
    beard.bind(head.skeleton, head.bindMatrix);
    beard.castShadow = true;
    head.parent.add(beard);
  }
}

let _beardTex = null;
function beardTexture() {
  if (_beardTex) return _beardTex;
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#9a9a9a'; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5000; i++) {
    const px = Math.random() * 256, py = Math.random() * 256, a = Math.PI / 2 + (Math.random() - 0.5) * 0.9, l = 3 + Math.random() * 6;
    const g = 90 + Math.random() * 140;
    x.strokeStyle = `rgba(${g},${g},${g},0.8)`; x.lineWidth = 0.8;
    x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); x.stroke();
  }
  _beardTex = new THREE.CanvasTexture(c);
  _beardTex.colorSpace = THREE.SRGBColorSpace;
  _beardTex.wrapS = _beardTex.wrapT = THREE.RepeatWrapping;
  _beardTex.repeat.set(6, 6);
  return _beardTex;
}
