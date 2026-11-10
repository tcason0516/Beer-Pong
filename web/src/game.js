import * as THREE from 'three';
import { buildGarage, buildTable, makeCup, makeBall, rackPositions } from './scene.js';
import { Ball, stepBall, solveLaunch, gaussian, TABLE, CUP, BALL_R } from './physics.js';
import { AudioEngine } from './audio.js';
import { VoiceManager, OPPONENTS } from './voices.js';
import { People } from './people.js';

const $ = (id) => document.getElementById(id);
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const PLAYER = 1, AI = -1; // which end of the table (z sign)
const DT = 1 / 240;

const SETTINGS_KEY = 'garagepong.settings';
function loadSettings() {
  const d = { voice: 1, crowd: 0.8, sfx: 1, captions: true, meter: true };
  try { return Object.assign(d, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch { return d; }
}

export class Game {
  constructor() {
    this.settings = loadSettings();
    this.audio = new AudioEngine();
    this.voice = new VoiceManager(this.audio);
    this.state = 'loading';
    this.cups = [];
    this.anims = [];
    this.ball = new Ball();
    this.clock = new THREE.Clock();
    this.camPose = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
    this.camTarget = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
    this.drag = null;
    this.speakingUntil = 0;
    this.buzz = 0;
  }

  async boot() {
    const status = (s) => { $('loadText').textContent = s + '…'; };
    status('Opening the garage');
    await sleep(30);

    const canvas = $('c');
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    r.setSize(window.innerWidth, window.innerHeight);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.95;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d0d0f);
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.03, 30);

    const steps = [];
    const garage = await this._yieldingBuild(() => buildGarage(scene, (s) => steps.push(s)), status, steps);
    this.garage = garage;
    status('Unfolding the table');
    await sleep(10);
    buildTable(scene);

    status('Lighting it up');
    await sleep(10);
    // environment reflections captured from the garage itself (at eye height over the table)
    const pm = new THREE.PMREMGenerator(r);
    for (const c of scene.children) c.position.y -= 1.2;
    scene.environment = pm.fromScene(scene, 0.035, 0.05, 20).texture;
    for (const c of scene.children) c.position.y += 1.2;
    scene.environmentIntensity = 0.55;
    pm.dispose();

    status('Pouring the beer');
    await sleep(10);
    for (const side of [PLAYER, AI]) {
      rackPositions(10, side).forEach((p) => {
        const mesh = makeCup();
        mesh.position.set(p.x, TABLE.y, p.z);
        mesh.rotation.y = Math.random() * Math.PI * 2;
        scene.add(mesh);
        this.cups.push({ mesh, x: p.x, z: p.z, side, active: true });
      });
    }
    this.ballMesh = makeBall();
    this.ballMesh.visible = false;
    scene.add(this.ballMesh);
    this._makeSplash();

    window.addEventListener('resize', () => this.onResize());
    this.onResize();
    this._bindUi();
    this._bindInput();

    status('Inviting people over');
    this.people = new People(scene);
    try { await this.people.load(); } catch (e) { console.warn('people failed to load', e); }
    await this.voice.init(status);

    this._setCam('title', true);
    this.state = 'title';
    $('loading').classList.add('hidden');
    $('title').classList.remove('hidden');
    r.compile(scene, this.camera);
    r.setAnimationLoop(() => this.frame());
  }

  async _yieldingBuild(fn, status, steps) {
    const tick = setInterval(() => { if (steps.length) status(steps[steps.length - 1]); }, 50);
    await sleep(20);
    const out = fn();
    clearInterval(tick);
    return out;
  }

  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    // keep the table framed in portrait and landscape
    this.camera.fov = w < h ? 50 : 40;
    this.camera.updateProjectionMatrix();
  }

  // ---------------- camera ----------------
  _setCam(kind, snap = false) {
    const P = {
      title: [new THREE.Vector3(1.6, 1.75, 2.0), new THREE.Vector3(0, 0.8, -0.5)],
      player: [new THREE.Vector3(0, 1.55, 1.32), new THREE.Vector3(0, 0.86, -0.8)],
      ai: [new THREE.Vector3(0.0, 1.6, 1.85), new THREE.Vector3(0, 0.95, -0.35)],
      over: [new THREE.Vector3(-1.2, 1.7, 1.9), new THREE.Vector3(0, 0.8, 0)],
    }[kind];
    this.camKind = kind;
    this.camTarget.pos.copy(P[0]); this.camTarget.look.copy(P[1]);
    if (snap) { this.camPose.pos.copy(P[0]); this.camPose.look.copy(P[1]); }
  }
  _updateCam(dt, t) {
    const k = 1 - Math.exp(-Math.max(dt, this.rawDt || 0) * 3.2);
    if (this.camKind === 'title') {
      const a = t * 0.08;
      this.camTarget.pos.set(Math.sin(a) * 2.3, 1.65 + Math.sin(t * 0.3) * 0.08, Math.cos(a) * 2.3 + 0.2);
    }
    this.camPose.pos.lerp(this.camTarget.pos, k);
    this.camPose.look.lerp(this.camTarget.look, k);
    // subtle hand-held breathing; more after a few drinks
    const sway = 0.0025 + this.buzz * 0.0016;
    const c = this.camera;
    c.position.copy(this.camPose.pos);
    c.position.x += Math.sin(t * 0.7) * sway + Math.sin(t * 1.9) * sway * 0.3;
    c.position.y += Math.sin(t * 1.1) * sway * 0.8;
    const look = this.camPose.look.clone();
    look.x += Math.sin(t * 0.43) * sway * 2;
    c.lookAt(look);
  }

  // ---------------- UI ----------------
  _bindUi() {
    const s = this.settings;
    document.querySelectorAll('.opp').forEach(el => {
      el.addEventListener('click', () => { this.audio.unlock(); this.startGame(el.dataset.opp); });
    });
    $('pauseBtn').addEventListener('click', () => this.pause());
    $('resumeBtn').addEventListener('click', () => this.resume());
    $('restartBtn').addEventListener('click', () => { this.resume(); this.startGame(this.oppKey); });
    $('quitBtn').addEventListener('click', () => this.toTitle());
    $('rematchBtn').addEventListener('click', () => this.startGame(this.oppKey));
    $('menuBtn').addEventListener('click', () => this.toTitle());
    for (const k of ['voice', 'crowd', 'sfx']) {
      const el = $('vol_' + k);
      el.value = s[k];
      this.audio.vol[k] = s[k];
      el.addEventListener('input', () => { s[k] = +el.value; this.audio.setVolume(k, s[k]); this._save(); });
    }
    for (const k of ['captions', 'meter']) {
      const el = $('opt_' + k);
      el.checked = s[k];
      el.addEventListener('change', () => { s[k] = el.checked; this._save(); });
    }
    window.onBackButton = () => {
      if (this.state === 'paused') { this.resume(); return true; }
      if (['aim', 'flight', 'ai', 'resolve'].includes(this.state)) { this.pause(); return true; }
      if (this.state === 'over') { this.toTitle(); return true; }
      return false;
    };
    window.onAppPause = () => { if (['aim', 'flight', 'ai', 'resolve'].includes(this.state)) this.pause(); this.audio.suspend(); };
    window.onAppResume = () => { this.audio.resume(); };
  }
  _save() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch { } }

  pause() {
    if (this.state === 'paused' || this.state === 'title' || this.state === 'over') return;
    this.prevState = this.state; this.state = 'paused';
    $('pause').classList.remove('hidden');
  }
  resume() {
    if (this.state !== 'paused') return;
    this.state = this.prevState;
    $('pause').classList.add('hidden');
    this.clock.getDelta();
  }
  toTitle() {
    this.state = 'title'; this.gameId = (this.gameId || 0) + 1;
    ['pause', 'over', 'hud'].forEach(id => $(id).classList.add('hidden'));
    $('title').classList.remove('hidden');
    this.ballMesh.visible = false; this.ball.active = false;
    this._setCam('title');
  }

  caption(text, who) {
    if (!this.settings.captions || !text) return;
    const el = $('caption');
    el.innerHTML = `<b>${who}</b> ${text}`;
    el.classList.add('show');
    clearTimeout(this._capT);
    this._capT = setTimeout(() => el.classList.remove('show'), 1400 + text.length * 55);
  }
  banner(text, ms = 1400) {
    const el = $('banner');
    el.textContent = text; el.classList.add('show');
    clearTimeout(this._banT);
    this._banT = setTimeout(() => el.classList.remove('show'), ms);
  }
  hint(text) {
    const el = $('hint');
    el.textContent = text || ''; el.classList.toggle('show', !!text);
  }
  async talk(cat, force = false, chance = 1) {
    const now = performance.now();
    if (!force && (now < this.speakingUntil || Math.random() > chance)) return;
    this.speakingUntil = now + 2500;
    const gid = this.gameId;
    const { text, dur } = await this.voice.say(cat);
    if (gid !== this.gameId) return;
    this.speakingUntil = performance.now() + (dur || 2) * 1000 + 300;
    this.caption(text, this.opp.name + ':');
  }

  _updateHud() {
    const draw = (el, side) => {
      const n = this.cups.filter(c => c.side === side && c.active).length;
      el.innerHTML = '';
      for (let i = 0; i < 10; i++) {
        const d = document.createElement('i');
        if (i >= n) d.className = 'gone';
        el.appendChild(d);
      }
      return n;
    };
    draw($('cupsYou'), PLAYER);
    draw($('cupsOpp'), AI);
    $('oppName').textContent = this.opp.name;
  }

  // ---------------- game flow ----------------
  startGame(key) {
    this.gameId = (this.gameId || 0) + 1;
    this.oppKey = key;
    this.opp = { ...OPPONENTS[key], key };
    this.voice.setOpponent(this.opp);
    if (this.people && this.people.ready) {
      const P = this.people;
      P.setOpponentLook(key);
      this.voice.oppPan = () => P.panOf(P.opp.bones.Head, this.camera);
      // female voices (even indices) come from the woman or from people off to the sides
      this.voice.panFor = (v) => {
        const g = v % 2 === 0 ? (Math.random() < 0.5 ? P.guests[1] : null) : P.guests[[0, 2, 3][(v >> 1) % 3]];
        return g ? P.panOf(g.bones.Head, this.camera) : (Math.random() < 0.5 ? -0.9 : 0.9);
      };
    }
    this.buzz = 0;
    this.reracked = { [PLAYER]: {}, [AI]: {} };
    // reset cups
    for (const side of [PLAYER, AI]) {
      const pos = rackPositions(10, side);
      this.cups.filter(c => c.side === side).forEach((c, i) => {
        c.x = pos[i].x; c.z = pos[i].z; c.active = true;
        c.mesh.visible = true;
        c.mesh.position.set(c.x, TABLE.y, c.z);
        c.mesh.rotation.x = 0; c.mesh.rotation.z = 0;
        this._setCupOpacity(c, 1);
      });
    }
    this.anims = [];
    ['title', 'over', 'pause'].forEach(id => $(id).classList.add('hidden'));
    $('hud').classList.remove('hidden');
    this._updateHud();
    this.audio.unlock();
    this.audio.startAmbience();
    this._scheduleChatter();
    this.firstThrow = true;
    const gid = this.gameId;
    setTimeout(async () => {
      if (gid !== this.gameId) return;
      const { text } = await this.voice.say('start', { text: this.opp.intro[(Math.random() * this.opp.intro.length) | 0] });
      this.caption(text, this.opp.name + ':');
    }, 600);
    this.beginTurn(PLAYER);
  }

  _scheduleChatter() {
    clearTimeout(this._chatT);
    const loop = () => {
      if (this.state !== 'paused' && this.state !== 'title' && performance.now() > this.speakingUntil) this.voice.chatter();
      this._chatT = setTimeout(loop, rnd(3500, 8000));
    };
    this._chatT = setTimeout(loop, 4000);
  }

  async beginTurn(shooter, ballsBack = false) {
    this.turn = { shooter, shots: 2, makes: 0 };
    const target = -shooter;
    const left = this.cups.filter(c => c.side === target && c.active).length;
    if ((left === 6 || left === 3) && !this.reracked[target][left]) {
      this.reracked[target][left] = true;
      await this._rerack(target, left);
    }
    if (shooter === PLAYER) {
      if (left === 1 && !ballsBack) this.talk('playerLastCup', false, 0.8);
      this._setCam('player');
      this.banner(ballsBack ? 'BALLS BACK!' : 'YOUR SHOT');
      this._readyPlayerBall();
    } else {
      if (left === 1 && !ballsBack) this.talk('aiLastCup', false, 0.9);
      this._setCam('ai');
      this.banner(ballsBack ? `${this.opp.name.toUpperCase()}: BALLS BACK` : `${this.opp.name.toUpperCase()}'S SHOT`);
      this._aiThrow();
    }
  }

  async _rerack(side, count) {
    const gid = this.gameId;
    const active = this.cups.filter(c => c.side === side && c.active);
    const pos = rackPositions(count, side);
    this.talk('rerack', true);
    this.banner('RE-RACK');
    await sleep(500);
    if (gid !== this.gameId) return;
    active.forEach((c, i) => {
      const from = { x: c.x, z: c.z }, to = pos[i];
      c.x = to.x; c.z = to.z;
      this.anims.push({ t: 0, dur: 0.7, fn: (k) => { const e = ease(k); c.mesh.position.set(lerp(from.x, to.x, e), TABLE.y + Math.sin(k * Math.PI) * 0.03, lerp(from.z, to.z, e)); } });
    });
    this.audio.cupHit(0.6, false);
    await sleep(800);
  }

  _readyPlayerBall() {
    this.state = 'aim';
    this.aimSince = performance.now();
    this.ball.active = false;
    this.ballMesh.visible = true;
    this.slowNagged = false;
    if (this.firstThrow) this.hint('Swipe up to throw · longer swipe = farther · quick flick = flatter shot');
  }

  _holdPos(dx = 0, dy = 0) {
    // ball held in front of the camera, offset by finger drag
    const v = new THREE.Vector3(0.0 + dx * 0.12, -0.16 + dy * 0.1, -0.42);
    return this.camera.localToWorld(v);
  }

  // ---------------- input ----------------
  _bindInput() {
    const el = $('touch');
    const pt = (e) => (e.touches ? e.touches[0] || e.changedTouches[0] : e);
    const down = (e) => {
      this.audio.unlock();
      if (this.state !== 'aim') return;
      const p = pt(e);
      this.drag = { x0: p.clientX, y0: p.clientY, x: p.clientX, y: p.clientY, pts: [{ x: p.clientX, y: p.clientY, t: performance.now() }] };
      this.hint('');
      e.preventDefault();
    };
    const move = (e) => {
      if (!this.drag) return;
      const p = pt(e);
      this.drag.x = p.clientX; this.drag.y = p.clientY;
      this.drag.pts.push({ x: p.clientX, y: p.clientY, t: performance.now() });
      if (this.drag.pts.length > 30) this.drag.pts.shift();
      e.preventDefault();
    };
    const up = (e) => {
      if (!this.drag) return;
      const d = this.drag; this.drag = null;
      $('meter').classList.remove('show');
      if (this.state !== 'aim') return;
      this._playerRelease(d);
      e.preventDefault();
    };
    el.addEventListener('touchstart', down, { passive: false });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', up, { passive: false });
    el.addEventListener('touchcancel', up, { passive: false });
    el.addEventListener('mousedown', down);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  _swipeToShot(d, release) {
    const W = window.innerWidth, H = window.innerHeight;
    const f = (d.y0 - d.y) / H;
    const D = 0.55 + f * 3.3;                     // landing distance from release (m)
    const lateral = ((d.x - d.x0) / W) * 1.15;    // sideways aim (m at the rack)
    return { f, D, lateral };
  }

  _playerRelease(d) {
    const H = window.innerHeight;
    const f = (d.y0 - d.y) / H;
    if (f < 0.05) { this.hint('Swipe UP to throw'); return; }
    // flick speed from the last ~100ms of the swipe
    const now = d.pts[d.pts.length - 1];
    let first = d.pts[0];
    for (const p of d.pts) if (now.t - p.t <= 110) { first = p; break; }
    const dtS = Math.max(0.016, (now.t - first.t) / 1000);
    const speed = ((first.y - now.y) / H) / dtS; // screen heights per second
    const angle = THREE.MathUtils.degToRad(clamp(lerp(64, 40, (speed - 0.8) / 3.2), 40, 64));

    const W = window.innerWidth;
    const release = this._holdPos((d.x - d.x0) / W, (d.y0 - d.y) / H * 0.5);
    const { D, lateral } = this._swipeToShot(d, release);
    const wobble = 0.014 + this.buzz * 0.004;
    const target = new THREE.Vector3(
      release.x + lateral + gaussian() * wobble,
      TABLE.y + CUP.H,
      release.z - D + gaussian() * wobble);
    const v = solveLaunch(release, target, angle);
    this.firstThrow = false;
    this._launch(release, v, PLAYER);
  }

  _launch(from, v, shooter) {
    this.ball.launch(from, v);
    this.ballMesh.visible = true;
    this.ballMesh.position.copy(from);
    this.state = 'flight';
    this.shooter = shooter;
    this.audio.whoosh();
  }

  async _aiThrow() {
    const gid = this.gameId;
    this.state = 'ai';
    const P = this.people && this.people.ready ? this.people : null;
    const origin = new THREE.Vector3(rnd(-0.14, 0.14), rnd(1.33, 1.45), -TABLE.halfL - rnd(0.3, 0.42));
    this.ballMesh.visible = true;
    this.aiOrigin = origin;
    this.aiHolding = !!P;
    if (P) P.startWindup(); else this.ballMesh.position.copy(origin);
    await sleep(rnd(1300, 2000));
    if (gid !== this.gameId) return;
    while (this.state === 'paused') { await sleep(100); if (gid !== this.gameId) return; }
    if (P) { P.release(); await sleep(140); if (gid !== this.gameId) return; }
    this.aiHolding = false;
    const from = P ? P.handPos() : this.ballMesh.position.clone();
    const targets = this.cups.filter(c => c.side === PLAYER && c.active);
    if (!targets.length) return;
    // front cups are a bit more tempting
    targets.sort((a, b) => a.z - b.z);
    const cup = Math.random() < 0.5 ? targets[0] : targets[(Math.random() * targets.length) | 0];
    let sigma = this.opp.sigma;
    if (Math.random() < 0.06) sigma *= 3; // the occasional brick
    const target = new THREE.Vector3(cup.x + gaussian() * sigma, TABLE.y + CUP.H, cup.z + gaussian() * sigma * 1.2);
    const angle = THREE.MathUtils.degToRad(rnd(42, 56));
    const v = solveLaunch(from, target, angle);
    this._launch(from, v, AI);
  }

  // ---------------- simulation ----------------
  _physics(dt) {
    const b = this.ball;
    if (!b.active) return;
    let steps = Math.min(120, Math.round(dt / DT));
    const pan = () => clamp(b.pos.x * 1.2, -1, 1);
    while (steps-- > 0 && b.active) {
      stepBall(b, DT, this.cups, (type, d) => {
        if (type === 'table') this.audio.tableKnock(d.speed, pan());
        else if (type === 'floor') this.audio.floorBounce(d.speed, pan());
        else if (type === 'rim') this.audio.cupHit(d.speed, true, pan());
        else if (type === 'cupwall') this.audio.cupHit(d.speed, false, pan());
        else if (type === 'wall') this.audio.wallThud(d.speed);
        else if (type === 'sink') this._onSink(d.cup);
      });
    }
    this.ballMesh.position.copy(b.pos);
    // spin the ball visually
    this.ballMesh.rotation.x += b.vel.z * dt * 20;
    this.ballMesh.rotation.z -= b.vel.x * dt * 20;
    if (b.active && (b.restTime > 0.5 || b.time > 6 || (b.onFloor && b.time > 3.5))) {
      b.active = false;
      this._resolve({ made: false, rim: b.rimHits > 0, air: !b.touchedTable && b.rimHits === 0 });
    }
  }

  _onSink(ci) {
    const cup = this.cups[ci];
    this.audio.splash(clamp(cup.x * 1.5, -1, 1));
    // settle the ball onto the beer
    const start = this.ballMesh.position.clone();
    const end = new THREE.Vector3(cup.x + rnd(-0.008, 0.008), TABLE.y + 0.08 + BALL_R * 0.55, cup.z + rnd(-0.008, 0.008));
    this.anims.push({ t: 0, dur: 0.18, fn: (k) => this.ballMesh.position.lerpVectors(start, end, k) });
    this.anims.push({ t: 0, dur: 1.2, delay: 0.18, fn: (k) => { this.ballMesh.position.y = end.y + Math.sin(k * 18) * 0.003 * (1 - k); } });
    this._splashAt(cup);
    this._resolve({ made: true, cup });
  }

  async _resolve(res) {
    const gid = this.gameId;
    this.state = 'resolve';
    const shooter = this.shooter;
    const t = this.turn;
    t.shots--;
    if (res.made) {
      t.makes++;
      const cup = res.cup;
      cup.active = false;
      const P = this.people;
      if (shooter === PLAYER) {
        if (P) { P.oppGesture('no'); P.react('make'); }
        this.audio.crowdReact('cheer', 0.5);
        this.voice.react('make');
        this.banner('SPLASH!', 1000);
        if (cup.side === AI) this.talk('playerMake', false, 0.75);
      } else {
        if (P) { P.oppGesture('celebrate'); P.react('make'); }
        this.audio.crowdReact('cheer', 0.45);
        setTimeout(() => this.voice.react('make'), 300);
        this.buzz++;
        this.talk('aiMake', false, 0.9);
        if (Math.random() < 0.5) setTimeout(() => this.voice.laugh(2, 0.35), 600);
      }
      await sleep(1100);
      if (gid !== this.gameId) return;
      this._removeCup(cup);
      this.ballMesh.visible = false;
      this._updateHud();
      await sleep(500);
    } else {
      const P = this.people;
      if (shooter === PLAYER) {
        if (res.rim) { this.audio.crowdReact('ooh', 0.5); this.talk('playerRimOut', false, 0.85); if (P) P.react('miss'); }
        else if (res.air) {
          this.voice.laugh(4, 0.45); this.talk('playerMiss', false, 0.95);
          if (P) { P.oppGesture('yes'); P.react('laugh'); }
          setTimeout(() => (Math.random() < 0.6 ? this.voice.heckle() : this.voice.react('miss')), 700);
        } else {
          this.talk('playerMiss', false, 0.75);
          if (P) P.oppGesture('yes');
          if (Math.random() < 0.4) this.voice.laugh(2, 0.3);
          if (Math.random() < 0.35) setTimeout(() => this.voice.heckle(), 900);
        }
      } else {
        if (res.rim) this.audio.crowdReact('ooh', 0.4);
        if (P) P.oppGesture('no');
        this.talk('aiMiss', false, 0.5);
      }
      await sleep(900);
      if (gid !== this.gameId) return;
      this.ballMesh.visible = false;
    }
    while (this.state === 'paused') { await sleep(100); if (gid !== this.gameId) return; }

    // win?
    const pLeft = this.cups.filter(c => c.side === PLAYER && c.active).length;
    const aLeft = this.cups.filter(c => c.side === AI && c.active).length;
    if (aLeft === 0 || pLeft === 0) return this._gameOver(aLeft === 0 ? PLAYER : AI);

    if (t.shots > 0) {
      this.state = 'between';
      if (shooter === PLAYER) this._readyPlayerBall(); else this._aiThrow();
      return;
    }
    if (t.makes >= 2) {
      if (shooter === AI) this.talk('ballsBackAi', true); else this.talk('ballsBackPlayer', false, 0.8);
      return this.beginTurn(shooter, true);
    }
    this.beginTurn(-shooter);
  }

  _removeCup(cup) {
    // someone grabs the cup and carries it off to the side
    const m = cup.mesh, from = m.position.clone();
    const sx = from.x >= 0 ? 1 : -1;
    this.anims.push({
      t: 0, dur: 0.65, fn: (k) => {
        const e = ease(k);
        m.position.set(from.x + sx * e * 0.45, from.y + Math.sin(e * Math.PI * 0.5) * 0.18, from.z);
        m.rotation.z = -sx * e * 0.25;
        this._setCupOpacity(cup, 1 - e);
        if (k >= 1) m.visible = false;
      }
    });
  }
  _setCupOpacity(cup, a) {
    cup.mesh.traverse(o => {
      if (!o.material) return;
      const mt = o.material;
      if (mt.userData.baseOpacity === undefined) mt.userData.baseOpacity = mt.opacity;
      mt.transparent = a < 1 || mt.userData.baseOpacity < 1;
      mt.opacity = mt.userData.baseOpacity * a;
    });
  }

  _makeSplash() {
    const mat = new THREE.MeshStandardMaterial({ color: 0xe8b04a, roughness: 0.1, transparent: true, opacity: 0.85 });
    const geo = new THREE.SphereGeometry(0.0035, 6, 4);
    this.drops = [];
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(geo, mat); m.visible = false; this.scene.add(m);
      this.drops.push({ m, v: new THREE.Vector3(), life: 0 });
    }
    this.ripple = new THREE.Mesh(new THREE.RingGeometry(0.6, 1, 32), new THREE.MeshBasicMaterial({ color: 0xfff1d0, transparent: true, opacity: 0.6, depthWrite: false }));
    this.ripple.rotation.x = -Math.PI / 2; this.ripple.visible = false; this.scene.add(this.ripple);
  }
  _splashAt(cup) {
    const y = TABLE.y + 0.082;
    for (const d of this.drops) {
      d.m.position.set(cup.x + rnd(-0.01, 0.01), y, cup.z + rnd(-0.01, 0.01));
      d.v.set(rnd(-0.35, 0.35), rnd(0.6, 1.3), rnd(-0.35, 0.35));
      d.life = rnd(0.35, 0.6); d.m.visible = true;
    }
    this.ripple.position.set(cup.x, y + 0.001, cup.z);
    this.ripple.visible = true;
    this.anims.push({ t: 0, dur: 0.6, fn: (k) => { const s = 0.006 + k * 0.03; this.ripple.scale.set(s, s, s); this.ripple.material.opacity = 0.6 * (1 - k); if (k >= 1) this.ripple.visible = false; } });
  }

  async _gameOver(winner) {
    const gid = this.gameId;
    this.state = 'over';
    this._setCam('over');
    if (this.people) { this.people.oppGesture(winner === PLAYER ? 'no' : 'celebrate'); this.people.react(winner === PLAYER ? 'make' : 'laugh'); }
    if (winner === PLAYER) {
      this.audio.crowdReact('cheer', 0.7, 9);
      this.voice.react('make');
      this.talk('playerWin', true);
      $('overTitle').textContent = 'YOU WIN!';
      $('overSub').textContent = `${this.opp.name} has to buy the next case.`;
    } else {
      this.voice.laugh(5, 0.5);
      this.talk('aiWin', true);
      $('overTitle').textContent = `${this.opp.name.toUpperCase()} WINS`;
      $('overSub').textContent = 'Shake it off. Run it back?';
    }
    await sleep(1500);
    if (gid !== this.gameId) return;
    $('hud').classList.add('hidden');
    $('over').classList.remove('hidden');
  }

  // ---------------- per-frame ----------------
  frame() {
    this.rawDt = Math.min(0.5, this.clock.getDelta());
    const dt = Math.min(this.maxDt || 0.05, this.rawDt);
    const t = this.clock.elapsedTime;
    const paused = this.state === 'paused';

    if (!paused) {
      this._physics(dt);
      for (const a of this.anims) {
        if (a.delay > 0) { a.delay -= dt; continue; }
        a.t += dt; a.fn(Math.min(1, a.t / a.dur));
      }
      this.anims = this.anims.filter(a => a.t < a.dur);
      for (const d of this.drops) {
        if (d.life <= 0) continue;
        d.life -= dt; d.v.y -= 9.81 * dt; d.m.position.addScaledVector(d.v, dt);
        if (d.life <= 0 || d.m.position.y < TABLE.y) d.m.visible = false;
      }
    }
    this._updateCam(dt, t);
    if (this.people) this.people.update(paused ? 0 : dt, this.camera.position, this.ball.active ? this.ball.pos : null);

    // held ball follows finger
    if (this.state === 'aim') {
      const d = this.drag;
      const W = window.innerWidth, H = window.innerHeight;
      const hp = d ? this._holdPos((d.x - d.x0) / W, (d.y0 - d.y) / H * 0.5) : this._holdPos(0, Math.sin(t * 2) * 0.02);
      this.ballMesh.position.lerp(hp, 0.5);
      if (d) this._updateMeter(d);
      if (!this.slowNagged && performance.now() - this.aimSince > 11000) { this.slowNagged = true; this.talk('slow', false, 1); }
    }
    if (this.state === 'ai' && this.aiHolding && this.people) {
      this.ballMesh.position.copy(this.people.handPos());
    } else if (this.state === 'ai' && this.aiOrigin) {
      // opponent lining up the shot
      this.ballMesh.position.set(this.aiOrigin.x + Math.sin(t * 2.3) * 0.01, this.aiOrigin.y + Math.sin(t * 5) * 0.015, this.aiOrigin.z);
    }
    this.renderer.render(this.scene, this.camera);
  }

  _updateMeter(d) {
    const el = $('meter');
    if (!this.settings.meter) { el.classList.remove('show'); return; }
    el.classList.add('show');
    const H = window.innerHeight;
    const release = this._holdPos(0, 0);
    // swipe fraction that lands on the front and back of the opponent's rack
    const aiCups = this.cups.filter(c => c.side === AI && c.active);
    const zs = aiCups.map(c => c.z);
    const zFront = Math.max(...zs) + CUP.rT, zBack = Math.min(...zs) - CUP.rT;
    const fOf = (z) => ((release.z - z) - 0.55) / 3.3;
    const f = clamp((d.y0 - d.y) / H, 0, 0.9);
    const toPct = (x) => clamp(x / 0.9, 0, 1) * 100;
    $('meterZone').style.bottom = toPct(fOf(zFront)) + '%';
    $('meterZone').style.height = (toPct(fOf(zBack)) - toPct(fOf(zFront))) + '%';
    $('meterFill').style.height = toPct(f) + '%';
  }
}
