// Web Audio mixer: garage reverb, synthesized SFX, crowd murmur, laughter,
// crowd reactions, and playback of voice clips.

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

// vowel formants (F1, F2, F3) for an average adult voice
const VOWELS = {
  a: [750, 1200, 2550], e: [550, 1800, 2500], i: [320, 2300, 2900],
  o: [500, 900, 2400], u: [350, 800, 2300], ae: [680, 1650, 2450], uh: [600, 1150, 2400],
};
const VOWEL_KEYS = Object.keys(VOWELS);

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.vol = { master: 1, voice: 1, crowd: 0.8, sfx: 1 };
    this.ambienceOn = false;
    this.talkers = [];
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = this.ctx = new AC({ latencyHint: 'interactive' });
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.2;
    this.master.connect(comp); comp.connect(ctx.destination);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeGarageIR(1.5);
    this.reverbOut = ctx.createGain(); this.reverbOut.gain.value = 0.55;
    this.reverb.connect(this.reverbOut); this.reverbOut.connect(this.master);

    const bus = (g, send) => {
      const b = ctx.createGain(); b.gain.value = g; b.connect(this.master);
      const s = ctx.createGain(); s.gain.value = send; b.connect(s); s.connect(this.reverb);
      return b;
    };
    this.sfxBus = bus(1, 0.18);
    this.voiceBus = bus(1, 0.22);
    this.crowdBus = bus(0.8, 0.6);
    this.ambBus = bus(1, 0.3);
    this.noiseBuf = this.makeNoise(2);
    this.applyVolumes();
  }

  unlock() {
    this.init();
    if (this.ctx.state !== 'running') this.ctx.resume();
  }
  suspend() { if (this.ctx) this.ctx.suspend(); }
  resume() { if (this.ctx) this.ctx.resume(); }

  setVolume(k, v) { this.vol[k] = v; this.applyVolumes(); }
  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.vol.master, t, 0.05);
    this.voiceBus.gain.setTargetAtTime(this.vol.voice * 1.1, t, 0.05);
    this.crowdBus.gain.setTargetAtTime(this.vol.crowd, t, 0.05);
    this.ambBus.gain.setTargetAtTime(this.vol.crowd, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(this.vol.sfx, t, 0.05);
  }

  // ---------- building blocks ----------
  makeNoise(sec) {
    const ctx = this.ctx, n = ctx.sampleRate * sec;
    const b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  // Small concrete room: dense early reflections + ~1.5s tail, brighter than a living room.
  makeGarageIR(sec) {
    const ctx = this.ctx, sr = ctx.sampleRate, n = Math.floor(sr * sec);
    const b = ctx.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const env = Math.exp(-t * 4.2);
        lp += ((Math.random() * 2 - 1) - lp) * (0.55 - t * 0.25); // darken over time
        d[i] = lp * env * 0.6;
      }
      // discrete early reflections off walls/door
      const taps = [0.0042, 0.0071, 0.0113, 0.0158, 0.0197, 0.0244, 0.031, 0.038];
      taps.forEach((tt, k) => { const i = Math.floor((tt + ch * 0.0013) * sr); if (i < n) d[i] += (k % 2 ? -1 : 1) * 0.5 * Math.exp(-k * 0.25); });
    }
    return b;
  }
  panner(pan) {
    const p = this.ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); return p;
  }
  noiseSrc(t, dur, rate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf; s.playbackRate.value = rate;
    s.start(t, Math.random() * 1.5, dur + 0.05);
    return s;
  }
  env(param, t, a, peak, dcy, sustain = 0) {
    param.cancelScheduledValues(t);
    param.setValueAtTime(0.0001, t);
    param.linearRampToValueAtTime(peak, t + a);
    param.exponentialRampToValueAtTime(Math.max(0.0001, sustain || 0.0001), t + a + dcy);
  }

  // ---------- SFX ----------
  // ball on hollow blow-molded table top: sharp "tok" + body resonance
  tableKnock(speed, pan = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, g0 = Math.min(1, speed / 4) * 0.9 + 0.05;
    const out = ctx.createGain(); out.gain.value = g0; out.connect(this.panner(pan)).connect(this.sfxBus);
    const n = this.noiseSrc(t, 0.03);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = rnd(2600, 3400); bp.Q.value = 1.4;
    const ng = ctx.createGain(); this.env(ng.gain, t, 0.0008, 0.9, 0.025);
    n.connect(bp).connect(ng).connect(out);
    for (const [f, a, d] of [[rnd(165, 190), 0.6, 0.07], [rnd(410, 450), 0.35, 0.05], [rnd(1150, 1250), 0.25, 0.03]]) {
      const o = ctx.createOscillator(); o.frequency.value = f;
      const og = ctx.createGain(); this.env(og.gain, t, 0.001, a, d);
      o.connect(og).connect(out); o.start(t); o.stop(t + d + 0.05);
    }
  }
  // concrete floor: brighter click with the ball's own ring
  floorBounce(speed, pan = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, g0 = Math.min(1, speed / 4) * 0.7 + 0.03;
    const out = ctx.createGain(); out.gain.value = g0; out.connect(this.panner(pan)).connect(this.sfxBus);
    const n = this.noiseSrc(t, 0.02);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
    const ng = ctx.createGain(); this.env(ng.gain, t, 0.0005, 0.8, 0.015);
    n.connect(hp).connect(ng).connect(out);
    const o = ctx.createOscillator(); o.frequency.value = rnd(1650, 1900);
    const og = ctx.createGain(); this.env(og.gain, t, 0.001, 0.3, 0.04);
    o.connect(og).connect(out); o.start(t); o.stop(t + 0.08);
  }
  // plastic cup rim/wall
  cupHit(speed, rim = true, pan = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, g0 = Math.min(1, speed / 3) * 0.8 + 0.08;
    const out = ctx.createGain(); out.gain.value = g0; out.connect(this.panner(pan)).connect(this.sfxBus);
    const n = this.noiseSrc(t, 0.05);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = rim ? 3800 : 1400; bp.Q.value = 2;
    const ng = ctx.createGain(); this.env(ng.gain, t, 0.0006, 0.7, 0.03);
    n.connect(bp).connect(ng).connect(out);
    const modes = rim ? [880, 1720, 2950] : [520, 980];
    for (const f of modes) {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f * rnd(0.95, 1.05);
      const og = ctx.createGain(); this.env(og.gain, t, 0.001, 0.18, rim ? 0.09 : 0.05);
      o.connect(og).connect(out); o.start(t); o.stop(t + 0.15);
    }
  }
  // ball dropping into beer: bubble "plunk" + splash
  splash(pan = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = ctx.createGain(); out.gain.value = 0.9; out.connect(this.panner(pan)).connect(this.sfxBus);
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(rnd(500, 650), t);
    o.frequency.exponentialRampToValueAtTime(rnd(1300, 1600), t + 0.05);
    const og = ctx.createGain(); this.env(og.gain, t, 0.002, 0.55, 0.09);
    o.connect(og).connect(out); o.start(t); o.stop(t + 0.15);
    const n = this.noiseSrc(t, 0.3);
    const lp = ctx.createBiquadFilter(); lp.type = 'bandpass'; lp.frequency.value = 1800; lp.Q.value = 0.6;
    const ng = ctx.createGain(); this.env(ng.gain, t + 0.005, 0.01, 0.45, 0.22);
    n.connect(lp).connect(ng).connect(out);
    // small droplets
    for (let k = 0; k < 4; k++) {
      const tk = t + rnd(0.04, 0.25);
      const d = ctx.createOscillator(); d.frequency.setValueAtTime(rnd(1200, 2200), tk);
      d.frequency.exponentialRampToValueAtTime(rnd(2400, 3600), tk + 0.02);
      const dg = ctx.createGain(); this.env(dg.gain, tk, 0.001, 0.08, 0.03);
      d.connect(dg).connect(out); d.start(tk); d.stop(tk + 0.06);
    }
  }
  wallThud(speed) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.frequency.value = 140;
    const og = ctx.createGain(); this.env(og.gain, t, 0.001, Math.min(0.4, speed / 6), 0.06);
    o.connect(og).connect(this.sfxBus); o.start(t); o.stop(t + 0.1);
  }
  // somebody cracks a can
  canOpen(pan = rnd(-0.8, 0.8), gain = 0.25) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = ctx.createGain(); out.gain.value = gain; out.connect(this.panner(pan)).connect(this.crowdBus);
    const click = this.noiseSrc(t, 0.01);
    const cg = ctx.createGain(); this.env(cg.gain, t, 0.0005, 1, 0.01);
    click.connect(cg).connect(out);
    const n = this.noiseSrc(t + 0.01, 0.4);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3500;
    const ng = ctx.createGain(); this.env(ng.gain, t + 0.01, 0.005, 0.6, 0.35);
    n.connect(hp).connect(ng).connect(out);
  }
  bottleClink(pan = rnd(-0.8, 0.8)) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = ctx.createGain(); out.gain.value = 0.08; out.connect(this.panner(pan)).connect(this.crowdBus);
    for (const f of [2300, 3550, 5100]) {
      const o = ctx.createOscillator(); o.frequency.value = f * rnd(0.97, 1.03);
      const og = ctx.createGain(); this.env(og.gain, t, 0.001, 0.4, 0.4);
      o.connect(og).connect(out); o.start(t); o.stop(t + 0.5);
    }
  }
  whoosh() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this.noiseSrc(t, 0.25);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(600, t); bp.frequency.exponentialRampToValueAtTime(2000, t + 0.15);
    const g = ctx.createGain(); this.env(g.gain, t, 0.04, 0.15, 0.18);
    n.connect(bp).connect(g).connect(this.sfxBus);
  }

  // ---------- human-ish voice synthesis (for crowd layers) ----------
  // One voiced syllable through formant filters. Returns end time.
  _syllable(out, t, f0, dur, vowel, amp, breath = 0.3, glide = 0) {
    const ctx = this.ctx;
    const src = ctx.createOscillator(); src.type = 'sawtooth';
    src.frequency.setValueAtTime(f0, t);
    src.frequency.linearRampToValueAtTime(f0 * (1 + glide), t + dur);
    const vib = ctx.createOscillator(); vib.frequency.value = rnd(4.5, 6.5);
    const vg = ctx.createGain(); vg.gain.value = f0 * 0.02; vib.connect(vg).connect(src.frequency);
    const g = ctx.createGain(); g.gain.value = 0;
    const F = VOWELS[vowel];
    const mix = ctx.createGain(); mix.gain.value = 1;
    [[F[0], 7, 1], [F[1], 9, 0.55], [F[2], 12, 0.25]].forEach(([f, q, a]) => {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * rnd(0.95, 1.08); bp.Q.value = q;
      const ga = ctx.createGain(); ga.gain.value = a * 3;
      src.connect(bp).connect(ga).connect(mix);
    });
    mix.connect(g).connect(out);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(amp, t + Math.min(0.03, dur * 0.3));
    g.gain.setValueAtTime(amp, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.start(t); vib.start(t); src.stop(t + dur + 0.02); vib.stop(t + dur + 0.02);
    if (breath > 0) { // aspiration "h"
      const n = this.noiseSrc(t - 0.03, dur * 0.5 + 0.03);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = F[1]; bp.Q.value = 1.2;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.0001, t - 0.03);
      ng.gain.linearRampToValueAtTime(amp * breath, t);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.5);
      n.connect(bp).connect(ng).connect(out);
    }
    return t + dur;
  }

  // A burst of laughter ("ha-ha-ha-ha") from one person somewhere in the room.
  laugh({ gain = 0.5, pan = rnd(-0.9, 0.9), female = Math.random() < 0.4, delay = 0, n = 0 } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const out = ctx.createGain(); out.gain.value = gain;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = rnd(2800, 4200);
    out.connect(lp).connect(this.panner(pan)).connect(this.crowdBus);
    let t = ctx.currentTime + delay;
    const base = female ? rnd(230, 320) : rnd(120, 175);
    const count = n || ((rnd(4, 9)) | 0);
    const vowel = pick(['a', 'a', 'ae', 'uh', 'e']);
    for (let i = 0; i < count; i++) {
      const prog = i / count;
      const f0 = base * (1.25 - prog * 0.35) * rnd(0.96, 1.05);
      const dur = rnd(0.085, 0.13) * (i === count - 1 ? 1.6 : 1);
      t = this._syllable(out, t, f0, dur, vowel, (0.9 - prog * 0.45) * rnd(0.8, 1), 0.55, -0.12);
      t += rnd(0.05, 0.085);
    }
    // inhale at the end
    const inh = this.noiseSrc(t + 0.05, 0.35);
    const ibp = ctx.createBiquadFilter(); ibp.type = 'bandpass'; ibp.frequency.value = 1300; ibp.Q.value = 2;
    const ig = ctx.createGain(); ig.gain.setValueAtTime(0.0001, t + 0.05);
    ig.gain.linearRampToValueAtTime(0.12, t + 0.25); ig.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    inh.connect(ibp).connect(ig).connect(out);
  }

  // Several people laughing together
  groupLaugh(size = 4, gain = 0.4) {
    for (let i = 0; i < size; i++) this.laugh({ gain: gain * rnd(0.6, 1.1), delay: rnd(0, 0.35) });
  }

  // Crowd vocal reaction: 'ooh' (near miss / big shot), 'cheer' (make), 'aww' (miss)
  crowdReact(kind = 'ooh', gain = 0.55, size = 7) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    for (let k = 0; k < size; k++) {
      const female = Math.random() < 0.4;
      const f0 = female ? rnd(210, 300) : rnd(105, 160);
      const out = ctx.createGain(); out.gain.value = gain * rnd(0.5, 1) / Math.sqrt(size) * 1.8;
      out.connect(this.panner(rnd(-0.9, 0.9))).connect(this.crowdBus);
      const t = t0 + rnd(0, 0.15);
      if (kind === 'ooh') {
        this._syllable(out, t, f0 * 0.9, rnd(0.7, 1.1), 'o', 0.8, 0.15, 0.35);
      } else if (kind === 'aww') {
        this._syllable(out, t, f0 * 1.15, rnd(0.6, 0.9), 'a', 0.7, 0.2, -0.3);
      } else { // cheer: "yeahhh" / "ayyy" + whoops
        this._syllable(out, t, f0 * 1.1, rnd(0.5, 0.9), pick(['ae', 'e', 'a']), 0.9, 0.3, rnd(-0.1, 0.25));
        if (Math.random() < 0.35) this._syllable(out, t + rnd(0.6, 0.9), f0 * 1.5, 0.35, 'u', 0.6, 0.2, 0.3);
      }
    }
    if (kind === 'cheer') this.clapping(rnd(1.2, 2), gain * 0.5);
  }

  clapping(sec = 1.5, gain = 0.3) {
    if (!this.ctx) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    for (let p = 0; p < 4; p++) {
      const pan = rnd(-0.8, 0.8); let t = t0 + rnd(0, 0.15);
      const rate = rnd(4.5, 6.5);
      while (t < t0 + sec) {
        const n = this.noiseSrc(t, 0.03);
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = rnd(1000, 2200); bp.Q.value = 1.5;
        const g = ctx.createGain(); this.env(g.gain, t, 0.001, gain * rnd(0.5, 1), 0.03);
        n.connect(bp).connect(g).connect(this.panner(pan)).connect(this.crowdBus);
        t += 1 / rate * rnd(0.9, 1.1);
      }
    }
  }

  // ---------- ambience ----------
  startAmbience() {
    if (!this.ctx || this.ambienceOn) return;
    this.ambienceOn = true;
    const ctx = this.ctx;
    // room tone
    const brown = ctx.createBufferSource();
    const n = ctx.sampleRate * 4, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    let last = 0; for (let i = 0; i < n; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
    brown.buffer = b; brown.loop = true;
    const rg = ctx.createGain(); rg.gain.value = 0.05;
    brown.connect(rg).connect(this.ambBus); brown.start();
    // old fridge compressor hum
    this.fridge = ctx.createGain(); this.fridge.gain.value = 0.0;
    for (const [f, a] of [[60, 1], [120, 0.6], [180, 0.25], [240, 0.12]]) {
      const o = ctx.createOscillator(); o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = a * 0.012;
      o.connect(g).connect(this.fridge); o.start();
    }
    this.fridge.connect(this.panner(0.7)).connect(this.ambBus);
    this._fridgeCycle();
    // murmur of indistinct conversation (6 synthetic talkers)
    for (let i = 0; i < 6; i++) this._talker(i);
    this._randomEvents();
  }
  _fridgeCycle() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, on = this.fridge.gain.value < 0.5;
    this.fridge.gain.setTargetAtTime(on ? 1 : 0, t, 0.6);
    setTimeout(() => this._fridgeCycle(), (on ? rnd(25, 50) : rnd(20, 40)) * 1000);
  }
  _talker(i) {
    const ctx = this.ctx;
    const female = i % 3 === 1;
    const out = ctx.createGain(); out.gain.value = rnd(0.05, 0.09);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1900;
    out.connect(lp).connect(this.panner(rnd(-1, 1))).connect(this.crowdBus);
    const base = female ? rnd(190, 240) : rnd(100, 135);
    const talk = () => {
      if (!this.ambienceOn) return;
      if (ctx.state !== 'running') { setTimeout(talk, 500); return; }
      // a phrase of 3-12 syllables, then a pause
      let t = ctx.currentTime + 0.05;
      const sylls = (rnd(3, 13)) | 0;
      let f = base * rnd(0.95, 1.15);
      for (let s = 0; s < sylls; s++) {
        const dur = rnd(0.09, 0.2);
        f *= rnd(0.94, 1.05);
        this._syllable(out, t, f, dur, pick(VOWEL_KEYS), rnd(0.4, 1), 0.25, rnd(-0.1, 0.08));
        t += dur + (Math.random() < 0.2 ? rnd(0.05, 0.12) : rnd(0.0, 0.03));
      }
      const pause = rnd(0.4, 2.8);
      setTimeout(talk, (t - ctx.currentTime + pause) * 1000);
    };
    setTimeout(talk, rnd(0, 2000));
  }
  _randomEvents() {
    if (!this.ambienceOn) return;
    if (this.ctx.state === 'running') {
      const r = Math.random();
      if (r < 0.25) this.laugh({ gain: rnd(0.12, 0.25) });
      else if (r < 0.35) this.groupLaugh(3, 0.15);
      else if (r < 0.5) this.canOpen(rnd(-0.9, 0.9), 0.15);
      else if (r < 0.62) this.bottleClink();
    }
    setTimeout(() => this._randomEvents(), rnd(3, 8) * 1000);
  }

  // ---------- voice clips ----------
  playVoice(buffer, { pan = 0, gain = 1, bus = 'voice', rate = 1, lowpass = 0, delay = 0 } = {}) {
    if (!this.ctx || !buffer) return null;
    const ctx = this.ctx;
    const s = ctx.createBufferSource(); s.buffer = buffer; s.playbackRate.value = rate;
    const g = ctx.createGain(); g.gain.value = gain;
    let node = s.connect(g);
    // gentle "in the room" EQ: cut the TTS sheen, add body
    const hs = ctx.createBiquadFilter(); hs.type = 'highshelf'; hs.frequency.value = 5000; hs.gain.value = -5;
    const pk = ctx.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = 220; pk.Q.value = 0.8; pk.gain.value = 2.5;
    node = node.connect(hs).connect(pk);
    if (lowpass) { const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = lowpass; node = node.connect(lp); }
    node.connect(this.panner(pan)).connect(bus === 'crowd' ? this.crowdBus : this.voiceBus);
    s.start(ctx.currentTime + delay);
    return s;
  }
  async decode(arrayBuffer) {
    this.init();
    return await this.ctx.decodeAudioData(arrayBuffer);
  }
}
