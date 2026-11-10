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
    for (const b of ['Hips', 'Spine2', 'Neck', 'Head', 'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', 'LeftArm', 'LeftForeArm', 'LeftHand'])
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

    const looks = [
      { kind: 'guy', tint: { Wolf3D_Outfit_Top: 0x7a2a22, Wolf3D_Outfit_Bottom: 0x3b3b3b, Wolf3D_Beard: null, Wolf3D_Headwear: null }, h: 0.97 },
      { kind: 'girl', tint: {}, h: 1.0 },
      { kind: 'guy', tint: { Wolf3D_Outfit_Top: 0x3d5a3a, Wolf3D_Outfit_Bottom: 0x5a4b3a }, h: 1.03 },
      { kind: 'guy', tint: { Wolf3D_Outfit_Top: 0x9a9488, Wolf3D_Outfit_Bottom: 0x2b3448, Wolf3D_Headwear: null }, h: 0.95 },
    ];
    // two people chatting behind the opponent on the left
    const a = this._person(looks[0].kind, { tint: looks[0].tint, heightMul: looks[0].h });
    a.setPos(-1.25, -2.75, 1.2); a.mode = 'talk';
    const b = this._person(looks[1].kind, { tint: looks[1].tint, heightMul: looks[1].h });
    b.setPos(-0.55, -2.95, -1.0); b.mode = 'talk';
    a.partner = b; b.partner = a;
    // a spectator on the right watching the game
    const c = this._person(looks[2].kind, { tint: looks[2].tint, heightMul: looks[2].h });
    c.setPos(1.25, -2.35, -0.7); c.mode = 'watch';
    // someone wandering between the fridge, the door and the workbench
    const d = this._person(looks[3].kind, { tint: looks[3].tint, heightMul: looks[3].h });
    d.setPos(2.3, -1.9, Math.PI); d.mode = 'walk';
    d.route = [new THREE.Vector3(2.25, 0, -1.4), new THREE.Vector3(1.6, 0, -3.6), new THREE.Vector3(-0.2, 0, -4.1),
      new THREE.Vector3(-2.2, 0, -3.3), new THREE.Vector3(-2.2, 0, -1.7), new THREE.Vector3(-1.4, 0, -3.9), new THREE.Vector3(1.0, 0, -3.8)];
    d.leg = 0; d.wait = 1;
    this.guests = [a, b, c, d];
    for (const g of [a, b, c, d]) this._cupInHand(g);
    for (const g of this.guests) g.nextGesture = rnd(2, 6);
  }

  /** Dress the opponent for who you're playing. */
  setOpponentLook(key) {
    const L = {
      rick: { top: 0x6b4a2e, bottom: 0x3a3836, hat: true, beard: true, h: 0.97 },
      tyler: { top: 0x26375a, bottom: 0x5a6878, hat: false, beard: false, h: 1.0 },
      mike: { top: 0x1e1e20, bottom: 0x2c2c2e, hat: false, beard: true, h: 1.07 },
    }[key] || {};
    const o = this.opp; if (!o) return;
    o.root.scale.setScalar(this.tplGuy.scale * (L.h || 1));
    o.root.traverse(m => {
      if (!m.isMesh) return;
      if (m.name === 'Wolf3D_Outfit_Top') m.material.color.setHex(L.top);
      if (m.name === 'Wolf3D_Outfit_Bottom') m.material.color.setHex(L.bottom);
      if (m.name === 'Wolf3D_Headwear') m.visible = !!L.hat;
      if (m.name === 'Wolf3D_Beard') m.visible = !!L.beard;
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
    const h = this.opp && this.opp.bones.RightHand;
    if (!h) return out.set(0.1, 1.42, -1.25);
    h.getWorldPosition(out);
    // palm is a little in front of the wrist joint
    return out.add(new THREE.Vector3(0, 0.02, 0.06));
  }

  update(dt, camPos, ballPos) {
    if (!this.ready) return;
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
