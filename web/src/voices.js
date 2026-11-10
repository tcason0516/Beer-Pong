// Dialogue: trash talk lines, party chatter, and how they become audio.
// On Android the phone's text-to-speech engine renders each line to a WAV
// (see VoiceBank.kt) so it can be mixed with reverb and the crowd.
// Real recordings dropped into assets/game/sounds/ override any category.

export const OPPONENTS = {
  rick: { name: 'Uncle Rick', difficulty: 'Casual', sigma: 0.115, pitch: 0.78, rate: 0.92, male: true,
    intro: ["Alright kiddo, let's see what you got.", "I used to be the champ of this garage, you know."] },
  tyler: { name: 'Tyler', difficulty: 'Regular', sigma: 0.075, pitch: 1.0, rate: 1.08, male: true,
    intro: ["Let's go! Loser buys the next case.", "Rack 'em up, I'm feeling it tonight."] },
  mike: { name: 'Big Mike', difficulty: 'Frat Legend', sigma: 0.042, pitch: 0.86, rate: 1.0, male: true,
    intro: ["Welcome to my house. You're gonna lose in it.", "I haven't lost on this table since college."] },
};

// {name} is replaced with the opponent's name
export const LINES = {
  start: ["Alright, let's see what you got.", "Loser buys the next case.", "Hope you stretched, 'cause this is gonna hurt.", "You sure you wanna do this?"],
  playerMiss: [
    "Oof. Air ball!", "Were you aiming for the fridge?", "My grandma throws better than that, and she's got two bad hips.",
    "You missed the whole table, bro.", "That's not even close!", "Hey! The cups are over here!", "Did you blink?",
    "Is your arm on backwards?", "Nice shot. For the dog.", "Ha! Brick!", "You throw like you're scared of the ball.",
    "Somebody get this guy some glasses.", "That one's gonna be under the fridge for a year.", "Wow. Just... wow.",
  ],
  playerRimOut: ["Ooh, rimmed out! Not today!", "So close. And yet, not even a little bit.", "The cup said no thank you!", "Rejected!"],
  playerMake: [
    "Okay, okay, lucky shot.", "Even a broken clock is right twice a day.", "Alright, you got one. Don't get cocky.",
    "Ugh. Fine.", "Whatever, I'm just warming up.", "That had no business going in.", "Sure, sure. Enjoy it while it lasts.",
  ],
  aiMake: [
    "Drink up, buttercup!", "Nothing but beer!", "Too easy. Is this your first time?", "Get used to that feeling.",
    "Splash! That's going in the highlight reel.", "Bottoms up, champ.", "You might wanna sit down for this.",
    "Did you see that? Of course you did. Drink.", "That's called skill. Look it up.", "Cash that cup!",
  ],
  aiMiss: [
    "The table's crooked, man.", "Somebody bumped the table!", "I'm giving you a chance, that's all.", "Ugh, the light got in my eyes.",
    "Wind must've caught it.", "That's on purpose. Strategy.", "Okay, that one slipped.", "Who moved the cups?",
  ],
  ballsBackAi: ["Balls back, baby!", "Run it back!", "Two for two! Gimme those balls."],
  ballsBackPlayer: ["Seriously? Balls back. Whatever.", "Fine, take your balls back."],
  rerack: ["Re-rack it, let's go.", "Tighten that up. Re-rack.", "Re-rack! Make it pretty."],
  slow: ["Any day now!", "Shoot already, my beer's getting warm!", "Are you throwing or proposing?", "Tick tock!"],
  aiLastCup: ["One more and you're done.", "Last cup. Say goodnight.", "Island time, baby. One left."],
  playerLastCup: ["Okay. I'm locked in now.", "Pressure's on you, buddy. One cup.", "I've come back from worse."],
  aiWin: ["Game! Sit down, rookie.", "Get off my table.", "And that's how it's done in this garage.", "Next! Who's got next?"],
  playerWin: ["Rematch. Right now. Rack 'em.", "You got lucky and you know it.", "No way. No way! Best two out of three.", "Fine. Good game. I hate you."],
};

// background party chatter from other people in the garage
export const CHATTER = [
  "Who brought the chips?", "Dude, did you see the game last night?", "Is there any more ice?",
  "Hey, grab me one from the fridge.", "Wait, whose turn is it?", "I got next game!", "Somebody turn the music up.",
  "My truck's making that noise again.", "Are you staying for the fire pit later?", "Who's winning?",
  "Okay but hear me out.", "Bro, that's my cup.", "Yeah, he always does that.", "No way!", "What time is it?",
  "Is the pizza here yet?", "I'm telling you, it was this big.", "Did you text Jess?", "Who parked behind me?",
  "That's what I said!", "Hold on, I gotta hear this.", "Ha! Yeah, totally.", "Somebody close the door, it's freezing.",
  "Wait, are we out of beer already?", "I'm not even tired.", "Pass me the bottle opener.",
];
export const REACTIONS = {
  make: ["Let's go!", "Oh! No way!", "Drink!", "Ohhh!", "Yeah!", "Get wrecked!", "Oh snap!"],
  miss: ["Oof!", "Ohhh, no.", "Brutal.", "Yikes."],
};

const pick = (a) => a[(Math.random() * a.length) | 0];

export class VoiceManager {
  constructor(audio) {
    this.audio = audio;
    this.native = window.NativeVoice || null;
    this.buffers = new Map();  // key -> AudioBuffer
    this.pending = new Map();  // id -> {resolve}
    this.queue = [];
    this.custom = {};          // category -> [AudioBuffer]
    this.voices = [];
    this.ready = false;
    this.seq = 0;
    this.lastLine = {};
    this.crowdProfiles = [];
    this.oppProfile = null;
    window.__nv = {
      done: (id, url) => this._done(id, url),
      fail: (id) => this._fail(id),
    };
  }

  async init(onStatus = () => {}) {
    await this._loadCustom();
    if (!this.native) { this.ready = true; return; }
    onStatus('Warming up voices');
    for (let i = 0; i < 100; i++) { // wait up to ~10s for TTS engine
      const s = this.native.status();
      if (s !== 'init') break;
      await new Promise(r => setTimeout(r, 100));
    }
    if (this.native.status() !== 'ready') { this.native = null; this.ready = true; return; }
    try { this.voices = JSON.parse(this.native.voices()); } catch { this.voices = []; }
    // Google TTS voice ids that are male / female (best effort)
    const male = /(iom|iol|tpd|gbd|rjs|gbg|aud|ene|mol)/i;
    const female = /(sfg|iob|iog|tpc|tpf|gba|gbc|aua|auc|fis)/i;
    const males = this.voices.filter(v => male.test(v.name));
    const females = this.voices.filter(v => female.test(v.name));
    const any = this.voices.length ? this.voices : [{ name: '' }];
    this.maleVoices = males.length ? males : any;
    this.femaleVoices = females.length ? females : any;
    // crowd: a mix of distinct people
    const crowd = [];
    for (let i = 0; i < 6; i++) {
      const fem = i % 2 === 1;
      const pool = fem ? this.femaleVoices : this.maleVoices;
      crowd.push({ voice: pool[i % pool.length].name, pitch: (fem ? 1.0 : 0.85) + (i * 0.07) % 0.3, rate: 1.0 + ((i * 0.13) % 0.25), pan: -0.9 + (i / 5) * 1.8 });
    }
    this.crowdProfiles = crowd;
    this.ready = true;
  }

  setOpponent(opp) {
    const pool = this.maleVoices || [{ name: '' }];
    const idx = { rick: 2, tyler: 1, mike: 0 }[opp.key] || 0;
    this.oppProfile = { voice: pool[idx % pool.length].name, pitch: opp.pitch, rate: opp.rate };
    this.opp = opp;
    this.prewarm();
  }

  // Render all opponent lines + reactions + chatter in the background.
  prewarm() {
    if (!this.native) return;
    const o = this.oppProfile;
    const order = ['start', 'playerMiss', 'aiMake', 'playerMake', 'aiMiss', 'playerRimOut', 'ballsBackAi', 'ballsBackPlayer',
      'rerack', 'slow', 'aiLastCup', 'playerLastCup', 'aiWin', 'playerWin'];
    for (const t of this.opp.intro) this.request(t, o);
    for (const k of order) for (const t of LINES[k]) this.request(t, o);
    REACTIONS.make.forEach((t, i) => this.request(t, this.crowdProfiles[i % this.crowdProfiles.length]));
    REACTIONS.miss.forEach((t, i) => this.request(t, this.crowdProfiles[(i + 2) % this.crowdProfiles.length]));
    CHATTER.forEach((t, i) => this.request(t, this.crowdProfiles[i % this.crowdProfiles.length]));
  }

  key(text, prof) { return `${prof.voice}|${prof.pitch}|${prof.rate}|${text}`; }

  request(text, prof) {
    const k = this.key(text, prof);
    if (this.buffers.has(k)) return Promise.resolve(this.buffers.get(k));
    if (this.pending.has(k)) return this.pending.get(k).promise;
    let resolve;
    const promise = new Promise(r => (resolve = r));
    const id = 'v' + (this.seq++);
    this.pending.set(k, { promise, resolve, id });
    this.pending.set(id, { k, resolve });
    try { this.native.synth(id, text, prof.voice, prof.pitch, prof.rate); }
    catch { resolve(null); }
    return promise;
  }
  async _done(id, url) {
    const p = this.pending.get(id); if (!p) return;
    this.pending.delete(id);
    try {
      const res = await fetch(url);
      const buf = await this.audio.decode(await res.arrayBuffer());
      this.buffers.set(p.k, buf);
      p.resolve(buf);
    } catch { p.resolve(null); }
    this.pending.delete(p.k);
  }
  _fail(id) {
    const p = this.pending.get(id); if (!p) return;
    this.pending.delete(id); this.pending.delete(p.k); p.resolve(null);
  }

  async _loadCustom() {
    try {
      const res = await fetch('sounds/manifest.json');
      if (!res.ok) return;
      const m = await res.json();
      for (const [cat, files] of Object.entries(m)) {
        if (!Array.isArray(files) || !files.length) continue;
        this.custom[cat] = [];
        for (const f of files) {
          try {
            const r = await fetch('sounds/' + f);
            if (r.ok) this.custom[cat].push(await this.audio.decode(await r.arrayBuffer()));
          } catch { /* skip bad file */ }
        }
      }
    } catch { /* no custom sounds */ }
  }
  hasCustom(cat) { return this.custom[cat] && this.custom[cat].length > 0; }
  playCustom(cat, opts) { if (this.hasCustom(cat)) return this.audio.playVoice(pick(this.custom[cat]), opts); }

  // choose a line, avoiding immediate repeats
  choose(cat) {
    const arr = LINES[cat];
    let t = pick(arr);
    if (arr.length > 2) { let n = 0; while (t === this.lastLine[cat] && n++ < 5) t = pick(arr); }
    this.lastLine[cat] = t;
    return t;
  }

  /** Opponent speaks a line from a category. Returns the text (for captions). */
  async say(cat, { text } = {}) {
    if (this.hasCustom('opp_' + cat)) {
      const src = this.playCustom('opp_' + cat, { pan: 0, gain: 1.2 });
      return { text: null, dur: src && src.buffer ? src.buffer.duration : 2 };
    }
    const line = text || this.choose(cat);
    let dur = 0.4 + line.length * 0.06;
    if (this.native && this.oppProfile) {
      const p = this.request(line, this.oppProfile);
      const buf = await Promise.race([p, new Promise(r => setTimeout(() => r(null), 2500))]);
      if (buf) { this.audio.playVoice(buf, { pan: 0.05, gain: 1.25 }); dur = buf.duration; }
    } else {
      this._webSpeech(line, this.opp ? this.opp.pitch : 1, this.opp ? this.opp.rate : 1);
    }
    return { text: line, dur };
  }

  /** Someone in the crowd shouts a reaction. */
  async react(kind) {
    if (this.hasCustom('crowd_' + kind)) { this.playCustom('crowd_' + kind, { bus: 'crowd', gain: 0.9, pan: (Math.random() - 0.5) * 1.6 }); return; }
    if (!this.native || !this.crowdProfiles.length) return;
    const n = kind === 'make' ? 2 : 1;
    for (let i = 0; i < n; i++) {
      // only use already-rendered clips so reactions are instant
      const any = this._anyBuffered(REACTIONS[kind]);
      if (any) this.audio.playVoice(any.buf, { bus: 'crowd', pan: any.pan, gain: 0.7, delay: i * 0.25 + Math.random() * 0.15 });
    }
  }
  _anyBuffered(texts) {
    const found = [];
    for (const prof of this.crowdProfiles) for (const t of texts) {
      const b = this.buffers.get(this.key(t, prof));
      if (b) found.push({ buf: b, pan: prof.pan });
    }
    return found.length ? pick(found) : null;
  }

  /** Background conversation snippet from somewhere in the room. */
  chatter() {
    if (this.hasCustom('chatter')) {
      this.playCustom('chatter', { bus: 'crowd', gain: 0.45, pan: (Math.random() - 0.5) * 1.8, lowpass: 3000 });
      return;
    }
    if (!this.native) return;
    const found = [];
    CHATTER.forEach((t, i) => {
      const prof = this.crowdProfiles[i % this.crowdProfiles.length];
      const b = prof && this.buffers.get(this.key(t, prof));
      if (b) found.push({ b, prof });
    });
    if (!found.length) return;
    const { b, prof } = pick(found);
    this.audio.playVoice(b, { bus: 'crowd', gain: 0.32, pan: prof.pan * 0.9, lowpass: 2800 });
  }
  /** Real laugh recording if provided, otherwise synthesized laughter. */
  laugh(size = 3, gain = 0.45) {
    if (this.hasCustom('laugh')) { this.playCustom('laugh', { bus: 'crowd', gain: 0.8, pan: (Math.random() - 0.5) * 1.4 }); return; }
    this.audio.groupLaugh(size, gain);
  }

  _webSpeech(text, pitch, rate) {
    try {
      const ss = window.speechSynthesis; if (!ss) return;
      const u = new SpeechSynthesisUtterance(text);
      u.pitch = pitch; u.rate = rate;
      const v = ss.getVoices().find(v => /en[-_]US/i.test(v.lang) && /male|david|guy|fred|daniel/i.test(v.name)) || ss.getVoices().find(v => /^en/i.test(v.lang));
      if (v) u.voice = v;
      ss.speak(u);
    } catch { /* ignore */ }
  }
}
