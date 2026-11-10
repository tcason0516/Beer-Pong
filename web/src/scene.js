// The garage: floor, walls, garage door, workbench, shelving, fridge,
// folding table, party cups, lights.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import * as T from './textures.js';
import { TABLE, CUP, BALL_R, ROOM, cupRadiusAt } from './physics.js';

const R = T.rng;

function std(params) { return new THREE.MeshStandardMaterial(params); }
function box(w, h, d, mat, x, y, z, parent, cast = true, recv = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.castShadow = cast; m.receiveShadow = recv;
  parent.add(m); return m;
}
function cyl(rt, rb, h, mat, x, y, z, parent, seg = 24) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  parent.add(m); return m;
}

export function buildGarage(scene, onProgress = () => {}) {
  RectAreaLightUniformsLib.init();
  const g = new THREE.Group();
  scene.add(g);
  const W = ROOM.maxX - ROOM.minX, D = ROOM.maxZ - ROOM.minZ, H = ROOM.ceil;
  const cx = (ROOM.minX + ROOM.maxX) / 2, cz = (ROOM.minZ + ROOM.maxZ) / 2;

  // ---------- floor ----------
  onProgress('Pouring concrete');
  const con = T.concrete(1024);
  for (const k of ['map', 'normalMap', 'roughnessMap']) con[k].repeat.set(W / 3, D / 3);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D),
    std({ map: con.map, normalMap: con.normalMap, roughnessMap: con.roughnessMap, roughness: 1, metalness: 0, normalScale: new THREE.Vector2(0.7, 0.7) }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(cx, 0, cz);
  floor.receiveShadow = true; g.add(floor);

  // ---------- walls ----------
  onProgress('Hanging drywall');
  const dw = T.drywall();
  const wallMat = (rx, ry) => {
    const m = std({ map: dw.map.clone(), normalMap: dw.normalMap.clone(), roughness: 0.92 });
    m.map.repeat.set(rx, ry); m.normalMap.repeat.set(rx, ry);
    m.map.needsUpdate = m.normalMap.needsUpdate = true;
    return m;
  };
  // left / right
  const sideL = new THREE.Mesh(new THREE.PlaneGeometry(D, H), wallMat(D / 1.5, H / 1.5));
  sideL.position.set(ROOM.minX, H / 2, cz); sideL.rotation.y = Math.PI / 2; sideL.receiveShadow = true; g.add(sideL);
  const sideR = sideL.clone(); sideR.position.x = ROOM.maxX; sideR.rotation.y = -Math.PI / 2; g.add(sideR);
  // front (behind player) with a door to the house
  const front = new THREE.Mesh(new THREE.PlaneGeometry(W, H), wallMat(W / 1.5, H / 1.5));
  front.position.set(cx, H / 2, ROOM.maxZ); front.rotation.y = Math.PI; g.add(front);
  // ceiling
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), wallMat(W / 1.5, D / 1.5));
  ceil.position.set(cx, H, cz); ceil.rotation.x = Math.PI / 2; g.add(ceil);

  // back wall with garage door opening
  const doorW = 4.9, doorH = 2.15;
  const backMat = wallMat(2, 2);
  const sideW = (W - doorW) / 2;
  const bl = new THREE.Mesh(new THREE.PlaneGeometry(sideW, H), backMat);
  bl.position.set(ROOM.minX + sideW / 2, H / 2, ROOM.minZ); g.add(bl);
  const br = bl.clone(); br.position.x = ROOM.maxX - sideW / 2; g.add(br);
  const hdr = new THREE.Mesh(new THREE.PlaneGeometry(doorW, H - doorH), backMat);
  hdr.position.set(cx, doorH + (H - doorH) / 2, ROOM.minZ); g.add(hdr);
  // door
  onProgress('Installing garage door');
  const gd = T.garageDoor();
  const door = new THREE.Mesh(new THREE.PlaneGeometry(doorW, doorH),
    std({ map: gd.map, normalMap: gd.normalMap, roughness: 0.55, metalness: 0.15, normalScale: new THREE.Vector2(1.2, 1.2) }));
  door.position.set(cx, doorH / 2, ROOM.minZ + 0.06); door.receiveShadow = true; g.add(door);
  // window lites in top section (night outside)
  const glass = std({ color: 0x0b1424, roughness: 0.05, metalness: 0.0, emissive: 0x050a14 });
  for (let i = 0; i < 4; i++) {
    const wx = cx - doorW / 2 + doorW / 8 + i * doorW / 4;
    box(0.72, 0.2, 0.01, glass, wx, doorH - 0.27, ROOM.minZ + 0.065, g, false, false);
  }
  // weather seal + vertical tracks + horizontal ceiling tracks + opener
  const steel = std({ color: 0x8a8d90, metalness: 0.85, roughness: 0.38 });
  const darkSteel = std({ color: 0x3a3d40, metalness: 0.7, roughness: 0.5 });
  box(doorW + 0.1, 0.03, 0.05, std({ color: 0x111111, roughness: 0.9 }), cx, 0.015, ROOM.minZ + 0.07, g);
  for (const s of [-1, 1]) {
    box(0.05, doorH + 0.15, 0.08, steel, cx + s * (doorW / 2 + 0.04), (doorH + 0.15) / 2, ROOM.minZ + 0.12, g);
    box(0.05, 0.08, 3.0, steel, cx + s * (doorW / 2 + 0.04), doorH + 0.2, ROOM.minZ + 1.6, g);
    // spring bar
  }
  cyl(0.025, 0.025, doorW, steel, cx, doorH + 0.32, ROOM.minZ + 0.18, g).rotation.z = Math.PI / 2;
  box(0.04, 0.03, 2.9, darkSteel, cx, H - 0.2, ROOM.minZ + 1.6, g);
  box(0.38, 0.18, 0.5, std({ color: 0xe6e3dc, roughness: 0.6 }), cx, H - 0.25, ROOM.minZ + 3.2, g);
  box(0.02, 0.18, 0.02, darkSteel, cx, H - 0.09, ROOM.minZ + 3.2, g);

  // baseboard / trim
  const trim = std({ color: 0xdedad0, roughness: 0.7 });
  box(0.015, 0.1, D, trim, ROOM.minX + 0.008, 0.05, cz, g);
  box(0.015, 0.1, D, trim, ROOM.maxX - 0.008, 0.05, cz, g);

  // house door behind player
  const doorWood = std({ color: 0x7a5a3c, roughness: 0.6 });
  box(0.9, 2.05, 0.05, doorWood, ROOM.minX + 1.2, 1.025 + 0.18, ROOM.maxZ - 0.03, g);
  box(1.0, 0.18, 0.5, std({ color: 0x9a9a96, roughness: 0.95 }), ROOM.minX + 1.2, 0.09, ROOM.maxZ - 0.25, g);

  // ---------- left wall: pegboard + workbench ----------
  onProgress('Building the workbench');
  const pb = T.pegboard();
  const peg = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), std({ map: pb.map, roughness: 0.85 }));
  peg.position.set(ROOM.minX + 0.02, 1.6, -2.3); peg.rotation.y = Math.PI / 2; peg.receiveShadow = true; g.add(peg);
  const wd = T.wood();
  const benchTop = std({ map: wd.map, roughness: 0.75 });
  box(0.65, 0.05, 2.4, benchTop, ROOM.minX + 0.33, 0.9, -2.3, g);
  box(0.6, 0.03, 2.3, benchTop, ROOM.minX + 0.33, 0.25, -2.3, g);
  const post = std({ color: 0x9c7a55, roughness: 0.85 });
  for (const zz of [-3.45, -1.15]) for (const xx of [ROOM.minX + 0.06, ROOM.minX + 0.6])
    box(0.08, 0.88, 0.08, post, xx, 0.44, zz, g);
  // tools on pegboard
  const toolRed = std({ color: 0xb3221a, roughness: 0.45 });
  const toolBlk = std({ color: 0x1b1b1b, roughness: 0.5 });
  const chrome = std({ color: 0xcfd2d6, metalness: 1, roughness: 0.25 });
  for (let i = 0; i < 6; i++) { // wrench set
    const len = 0.14 + i * 0.025;
    box(0.008, len, 0.018, chrome, ROOM.minX + 0.04, 1.85 - len / 2, -3.2 + i * 0.045, g);
  }
  box(0.02, 0.3, 0.03, std({ color: 0x8a5a32, roughness: 0.7 }), ROOM.minX + 0.05, 1.55, -2.7, g); // hammer handle
  box(0.03, 0.04, 0.12, toolBlk, ROOM.minX + 0.05, 1.71, -2.7, g); // hammer head
  for (let i = 0; i < 4; i++) { // screwdrivers
    box(0.02, 0.1, 0.02, i % 2 ? toolRed : std({ color: 0xe0b020, roughness: 0.4 }), ROOM.minX + 0.05, 1.45, -2.45 + i * 0.05, g);
    box(0.006, 0.1, 0.006, chrome, ROOM.minX + 0.05, 1.35, -2.45 + i * 0.05, g);
  }
  const saw = box(0.004, 0.14, 0.5, chrome, ROOM.minX + 0.035, 1.95, -1.9, g);
  box(0.03, 0.15, 0.12, toolRed, ROOM.minX + 0.045, 1.95, -1.6, g);
  const cord = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.012, 8, 40), std({ color: 0xff6a10, roughness: 0.5 }));
  cord.position.set(ROOM.minX + 0.06, 1.55, -1.5); cord.rotation.y = Math.PI / 2; cord.castShadow = true; g.add(cord);
  // bench clutter: toolbox, speaker, cans
  box(0.25, 0.22, 0.5, toolRed, ROOM.minX + 0.3, 1.035, -3.0, g);
  box(0.26, 0.02, 0.51, toolBlk, ROOM.minX + 0.3, 1.15, -3.0, g);
  const speaker = box(0.12, 0.2, 0.28, std({ color: 0x202224, roughness: 0.8 }), ROOM.minX + 0.35, 1.025, -1.7, g);
  speaker.rotation.y = 0.3;
  const canMats = [T.canLabel(210, 'LAGER'), T.canLabel(5, 'PILS'), T.canLabel(140, 'LIGHT')]
    .map(t => [std({ map: t.map, metalness: 0.6, roughness: 0.3 }), std({ color: 0xc8cacc, metalness: 1, roughness: 0.3 }), std({ color: 0xc8cacc, metalness: 1, roughness: 0.3 })]);
  const can = (x, y, z, k, tipped = false) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.033, 0.122, 24), canMats[k % 3]);
    m.position.set(x, y, z); m.castShadow = true;
    if (tipped) { m.rotation.z = Math.PI / 2; m.rotation.y = R() * 3; }
    g.add(m); return m;
  };
  can(ROOM.minX + 0.45, 0.986, -2.2, 0); can(ROOM.minX + 0.5, 0.986, -2.05, 1); can(ROOM.minX + 0.3, 0.986, -2.4, 2);
  can(ROOM.minX + 0.4, 0.958, -1.3, 0, true);

  // ---------- right wall: steel shelving + fridge ----------
  onProgress('Stocking the shelves');
  const shelfX = ROOM.maxX - 0.25;
  for (const zz of [-3.9, -2.1]) for (const xx of [shelfX - 0.22, shelfX + 0.2])
    box(0.03, 1.85, 0.03, darkSteel, xx, 0.925, zz, g);
  const boxes = [T.cardboard('XMAS'), T.cardboard('GARAGE'), T.cardboard(''), T.cardboard('CAMPING')];
  const boxMats = boxes.map(b => std({ map: b.map, roughness: 0.9 }));
  const tote = std({ color: 0x5b6066, roughness: 0.5, transparent: true, opacity: 0.92 });
  const toteLid = std({ color: 0x1a4f8a, roughness: 0.5 });
  for (let s = 0; s < 4; s++) {
    const y = 0.15 + s * 0.52;
    box(0.45, 0.02, 1.85, std({ color: 0x55585c, metalness: 0.6, roughness: 0.45 }), shelfX, y, -3.0, g);
    let zz = -3.85;
    while (zz < -2.25) {
      const bw = 0.3 + R() * 0.25, bh = 0.2 + R() * 0.22;
      if (zz + bw > -2.15) break;
      if (R() < 0.3) {
        box(0.4, bh, bw, tote, shelfX, y + 0.01 + bh / 2, zz + bw / 2, g);
        box(0.42, 0.025, bw + 0.02, toteLid, shelfX, y + 0.01 + bh + 0.012, zz + bw / 2, g);
      } else if (R() < 0.25) {
        for (let k = 0; k < 2; k++) cyl(0.085, 0.085, 0.19, std({ color: 0xbfc3c6, metalness: 0.9, roughness: 0.35 }), shelfX, y + 0.105, zz + 0.09 + k * 0.18, g);
      } else {
        const b = box(0.38, bh, bw, boxMats[(R() * 4) | 0], shelfX - 0.02, y + 0.01 + bh / 2, zz + bw / 2, g);
        b.rotation.y = (R() - 0.5) * 0.1;
      }
      zz += bw + 0.04;
    }
  }
  // old garage fridge
  const fridgeMat = std({ color: 0xe8e0cc, roughness: 0.35, metalness: 0.05 });
  const fr = new THREE.Mesh(new RoundedBoxGeometry(0.72, 1.7, 0.7, 4, 0.04), fridgeMat);
  fr.position.set(ROOM.maxX - 0.4, 0.86, -1.35); fr.castShadow = fr.receiveShadow = true; g.add(fr);
  box(0.02, 0.012, 0.69, std({ color: 0x777066, roughness: 0.6 }), ROOM.maxX - 0.765, 1.18, -1.35, g, false);
  box(0.035, 0.45, 0.035, chrome, ROOM.maxX - 0.79, 1.42, -1.05, g);
  box(0.035, 0.3, 0.035, chrome, ROOM.maxX - 0.79, 0.85, -1.05, g);
  // magnets/papers on fridge door
  const paper = std({ color: 0xf5f3ee, roughness: 0.9 });
  box(0.003, 0.2, 0.15, paper, ROOM.maxX - 0.762, 1.4, -1.45, g, false).rotation.x = 0.06;
  box(0.003, 0.11, 0.09, std({ color: 0xffe066, roughness: 0.9 }), ROOM.maxX - 0.762, 1.05, -1.5, g, false);

  // cooler on the floor
  const cooler = std({ color: 0x1f5fa8, roughness: 0.4 });
  const coolerLid = std({ color: 0xf2f2f0, roughness: 0.4 });
  const cl = new THREE.Mesh(new RoundedBoxGeometry(0.75, 0.38, 0.42, 3, 0.03), cooler);
  cl.position.set(1.35, 0.19, 0.8); cl.rotation.y = -0.25; cl.castShadow = cl.receiveShadow = true; g.add(cl);
  const cll = new THREE.Mesh(new RoundedBoxGeometry(0.77, 0.07, 0.44, 3, 0.02), coolerLid);
  cll.position.set(1.35, 0.415, 0.8); cll.rotation.y = -0.25; cll.castShadow = true; g.add(cll);
  // a case of beer + trash can + empty cans on the floor
  const caseBox = box(0.4, 0.13, 0.27, std({ map: T.canLabel(25, 'GARAGE LAGER').map, roughness: 0.8 }), -1.2, 0.065, 0.95, g);
  caseBox.rotation.y = 0.4;
  const trash = cyl(0.24, 0.21, 0.72, std({ color: 0x2e3a2c, roughness: 0.55 }), -2.6, 0.36, 0.9, g, 32);
  can(-2.3, 0.033, 1.3, 1, true); can(-1.7, 0.033, -0.6, 0, true); can(1.9, 0.033, -0.9, 2, true);
  // folding chairs
  const chairMat = std({ color: 0x2b2d2f, metalness: 0.5, roughness: 0.5 });
  const chair = (x, z, ry) => {
    const c = new THREE.Group();
    box(0.42, 0.03, 0.4, chairMat, 0, 0.45, 0, c);
    box(0.42, 0.32, 0.03, chairMat, 0, 0.75, -0.2, c);
    for (const sx of [-0.19, 0.19]) { box(0.02, 0.9, 0.02, chairMat, sx, 0.45, -0.2, c).rotation.x = 0.12; box(0.02, 0.46, 0.02, chairMat, sx, 0.23, 0.18, c).rotation.x = -0.2; }
    c.position.set(x, 0, z); c.rotation.y = ry; g.add(c);
  };
  chair(-1.9, -1.1, 0.9); chair(2.0, 0.2, -1.2); chair(-2.0, -3.9, 0.6);

  // ---------- lights ----------
  onProgress('Wiring the shop lights');
  const housing = std({ color: 0xdedede, roughness: 0.5, metalness: 0.2 });
  const tubeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6e8, emissiveIntensity: 2.2 });
  const lights = [];
  for (const lz of [-0.15, -3.0]) {
    box(0.22, 0.05, 1.22, housing, 0, H - 0.08, lz, g, false, false);
    for (const tx of [-0.05, 0.05]) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.0125, 0.0125, 1.18, 12), tubeMat);
      t.rotation.x = Math.PI / 2; t.position.set(tx, H - 0.115, lz); g.add(t);
    }
    // chains
    box(0.004, 0.06, 0.004, darkSteel, 0, H - 0.03, lz - 0.5, g, false, false);
    box(0.004, 0.06, 0.004, darkSteel, 0, H - 0.03, lz + 0.5, g, false, false);
    const ra = new THREE.RectAreaLight(0xfff3e4, lz > -1 ? 9 : 6, 0.18, 1.2);
    ra.position.set(0, H - 0.13, lz); ra.lookAt(0, 0, lz); g.add(ra);
    lights.push(ra);
  }
  // shadow-caster over the table (stands in for the shop light)
  const key = new THREE.SpotLight(0xfff1e0, 11, 6, 1.05, 0.9, 1.6);
  key.position.set(0.05, H - 0.14, -0.1);
  key.target.position.set(0, 0, -0.1);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.5; key.shadow.camera.far = 4;
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02; key.shadow.radius = 3;
  g.add(key, key.target);
  const hemi = new THREE.HemisphereLight(0xfff4e6, 0x3a3530, 0.35);
  g.add(hemi);

  // warm string party lights along left wall and back wall
  const bulbs = [];
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xffb050, emissiveIntensity: 3 });
  const glowTex = T.glowSprite();
  const bulbGeo = new THREE.SphereGeometry(0.018, 10, 8);
  const wire = [];
  const addRun = (a, b, n, sag) => {
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = new THREE.Vector3().lerpVectors(a, b, t);
      p.y -= Math.sin(t * Math.PI * 3 % Math.PI) * sag;
      wire.push(p);
      if (i % 1 === 0) {
        const m = new THREE.Mesh(bulbGeo, bulbMat); m.position.copy(p); m.position.y -= 0.03; g.add(m);
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55 }));
        sp.scale.set(0.16, 0.16, 1); sp.position.copy(m.position); g.add(sp);
        bulbs.push(m);
      }
    }
  };
  addRun(new THREE.Vector3(ROOM.minX + 0.05, H - 0.1, 1.5), new THREE.Vector3(ROOM.minX + 0.05, H - 0.1, ROOM.minZ + 0.1), 24, 0.12);
  addRun(new THREE.Vector3(ROOM.minX + 0.1, doorH + 0.45, ROOM.minZ + 0.05), new THREE.Vector3(ROOM.maxX - 0.1, doorH + 0.45, ROOM.minZ + 0.05), 20, 0.1);
  const wireGeo = new THREE.BufferGeometry().setFromPoints(wire);
  g.add(new THREE.Line(wireGeo, new THREE.LineBasicMaterial({ color: 0x151515 })));
  const warm1 = new THREE.PointLight(0xffa64d, 1.4, 5, 1.8); warm1.position.set(ROOM.minX + 0.4, H - 0.4, -1.5); g.add(warm1);
  const warm2 = new THREE.PointLight(0xffa64d, 1.2, 5, 1.8); warm2.position.set(0, doorH + 0.3, ROOM.minZ + 0.5); g.add(warm2);

  return { group: g, keyLight: key, bulbs };
}

// ---------- folding table (6 ft fold-in-half, white granite top, gray steel frame) ----------
export function buildTable(scene) {
  const g = new THREE.Group();
  const tt = T.tableTop();
  const topMat = new THREE.MeshPhysicalMaterial({
    map: tt.map, normalMap: tt.normalMap, normalScale: new THREE.Vector2(0.35, 0.35),
    roughness: 0.62, clearcoat: 0.15, clearcoatRoughness: 0.5,
  });
  const thick = 0.045;
  // rounded slab for the body; a separate textured plane carries the top surface
  const top = new THREE.Mesh(new RoundedBoxGeometry(TABLE.halfW * 2, thick, TABLE.halfL * 2, 4, 0.018), std({ color: 0xe9e6df, roughness: 0.65 }));
  top.position.y = TABLE.y - thick / 2; top.castShadow = top.receiveShadow = true;
  g.add(top);
  const surf = new THREE.Mesh(new THREE.PlaneGeometry(TABLE.halfW * 2 - 0.03, TABLE.halfL * 2 - 0.03), topMat);
  surf.rotation.x = -Math.PI / 2; surf.position.y = TABLE.y + 0.0006; surf.receiveShadow = true;
  g.add(surf);

  const frame = std({ color: 0x5d6064, metalness: 0.65, roughness: 0.42 });
  const capMat = std({ color: 0x1a1a1a, roughness: 0.8 });
  // perimeter rails under the top
  for (const s of [-1, 1]) {
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.035, TABLE.halfL * 2 - 0.08), frame);
    r.position.set(s * (TABLE.halfW - 0.035), TABLE.y - thick - 0.017, 0); r.castShadow = true; g.add(r);
  }
  // hinge plate
  const hinge = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.06), frame);
  for (const s of [-1, 1]) { const h = hinge.clone(); h.position.set(s * (TABLE.halfW - 0.035), TABLE.y - thick - 0.03, 0); g.add(h); }
  // leg assemblies
  const legR = 0.0127;
  const legGeo = new THREE.CylinderGeometry(legR, legR, 1, 12);
  const tube = (a, b) => {
    const m = new THREE.Mesh(legGeo, frame);
    const d = new THREE.Vector3().subVectors(b, a);
    m.scale.y = d.length();
    m.position.copy(a).addScaledVector(d, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    m.castShadow = true; g.add(m); return m;
  };
  for (const zs of [-1, 1]) {
    const zl = zs * (TABLE.halfL - 0.13);
    const topY = TABLE.y - thick - 0.03;
    const xs = TABLE.halfW - 0.06;
    for (const s of [-1, 1]) {
      tube(new THREE.Vector3(s * xs, topY, zl), new THREE.Vector3(s * xs, 0.02, zl + zs * 0.02));
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.018, 0.03, 12), capMat);
      cap.position.set(s * xs, 0.015, zl + zs * 0.02); g.add(cap);
      // diagonal brace toward table center
      tube(new THREE.Vector3(s * xs, 0.36, zl + zs * 0.01), new THREE.Vector3(s * (TABLE.halfW - 0.04), topY, zs * 0.33));
    }
    tube(new THREE.Vector3(-xs, 0.13, zl + zs * 0.017), new THREE.Vector3(xs, 0.13, zl + zs * 0.017)); // cross bar
    tube(new THREE.Vector3(-xs, topY, zl), new THREE.Vector3(xs, topY, zl)); // top bar
  }
  scene.add(g);
  return g;
}

// ---------- party cup ----------
let cupAssets = null;
function makeCupAssets() {
  const H = CUP.H;
  const outerPts = [];
  const ridge = (h) => [0.036, 0.054, 0.083].some(r => h > r && h < r + 0.003);
  outerPts.push(new THREE.Vector2(0.0001, 0.0015));
  outerPts.push(new THREE.Vector2(CUP.rB - 0.002, 0.0));
  outerPts.push(new THREE.Vector2(CUP.rB, 0.002));
  for (let i = 1; i <= 60; i++) {
    const h = (i / 60) * (H - 0.002);
    outerPts.push(new THREE.Vector2(cupRadiusAt(h) + (ridge(h) ? 0.0009 : 0), h));
  }
  const outerGeo = new THREE.LatheGeometry(outerPts, 48);
  const innerPts = [];
  for (let i = 0; i <= 40; i++) {
    const h = 0.004 + (i / 40) * (H - 0.006);
    innerPts.push(new THREE.Vector2(cupRadiusAt(h) - 0.0007, h));
  }
  const innerGeo = new THREE.LatheGeometry(innerPts, 48);
  const rimGeo = new THREE.TorusGeometry(CUP.rT + 0.0003, CUP.rimTube, 8, 48);
  rimGeo.rotateX(Math.PI / 2); rimGeo.translate(0, H - 0.0005, 0);
  const red = new THREE.MeshPhysicalMaterial({ color: 0xc0131c, roughness: 0.32, clearcoat: 0.35, clearcoatRoughness: 0.3, sheen: 0.2 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.4, side: THREE.BackSide });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xf5f2ec, roughness: 0.35 });
  const fill = 0.08;
  const beerGeo = new THREE.CircleGeometry(cupRadiusAt(fill) - 0.0008, 40); beerGeo.rotateX(-Math.PI / 2); beerGeo.translate(0, fill, 0);
  const beerMat = new THREE.MeshPhysicalMaterial({ color: 0xd99a1e, roughness: 0.08, metalness: 0, emissive: 0x3a2004, clearcoat: 1, transparent: true, opacity: 0.95 });
  const foamGeo = new THREE.RingGeometry(cupRadiusAt(fill) - 0.008, cupRadiusAt(fill) - 0.0008, 40); foamGeo.rotateX(-Math.PI / 2); foamGeo.translate(0, fill + 0.0004, 0);
  const foamMat = new THREE.MeshStandardMaterial({ color: 0xf6edd6, roughness: 0.9, transparent: true, opacity: 0.85 });
  cupAssets = { outerGeo, innerGeo, rimGeo, red, white, rimMat, beerGeo, beerMat, foamGeo, foamMat };
}

export function makeCup() {
  if (!cupAssets) makeCupAssets();
  const a = cupAssets;
  const g = new THREE.Group();
  const o = new THREE.Mesh(a.outerGeo, a.red.clone()); o.castShadow = true; o.receiveShadow = true;
  const i = new THREE.Mesh(a.innerGeo, a.white.clone()); i.receiveShadow = true;
  const r = new THREE.Mesh(a.rimGeo, a.rimMat.clone()); r.castShadow = true;
  const b = new THREE.Mesh(a.beerGeo, a.beerMat.clone());
  const f = new THREE.Mesh(a.foamGeo, a.foamMat.clone());
  g.add(o, i, r, b, f);
  g.userData.beer = b;
  return g;
}

export function makeBall() {
  const m = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 32, 20),
    new THREE.MeshPhysicalMaterial({ color: 0xfbfaf6, roughness: 0.42, sheen: 0.5, sheenColor: new THREE.Color(0xffffff), clearcoat: 0.1 }));
  m.castShadow = true;
  return m;
}

// standard 10-cup triangle; side +1 = player end (z>0), -1 = opponent end
export function rackPositions(count, side) {
  const s = CUP.rT * 2 + 0.002; // touching cups
  const rowDz = s * Math.sqrt(3) / 2;
  const rows = count >= 10 ? [4, 3, 2, 1] : count >= 6 ? [3, 2, 1] : count >= 3 ? [2, 1] : count === 2 ? [2] : [1];
  const backZ = TABLE.halfL - CUP.rT - 0.02;
  const out = [];
  rows.forEach((n, ri) => {
    for (let k = 0; k < n; k++) {
      out.push({ x: (k - (n - 1) / 2) * s, z: side * (backZ - ri * rowDz) });
    }
  });
  return out.slice(0, count);
}
