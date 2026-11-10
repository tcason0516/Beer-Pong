#!/usr/bin/env python3
"""
Render all game dialogue with the Kokoro neural TTS model (Apache-2.0)
into Opus .ogg clips + voices/index.json for the game.

  pip install kokoro-onnx soundfile
  # model files: https://github.com/thewh1teagle/kokoro-onnx/releases (model-files-v1.0)
  python3 web/tools/render_voices.py --model kokoro-v1.0.onnx --voices voices-v1.0.bin

Edit the lines below and re-run; unchanged clips are skipped.
"""
import argparse, hashlib, json, os, subprocess, sys, tempfile
from concurrent.futures import ProcessPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, '../../app/src/main/assets/game/voices'))

# ---------------------------------------------------------------- opponents
OPPONENTS = {
    'rick': {'voice': 'am_onyx', 'speed': 0.95},
    'tyler': {'voice': 'am_puck', 'speed': 1.08},
    'mike': {'voice': 'am_fenrir', 'speed': 1.0},
}

SHARED = {
    'playerMiss': [
        "Air ball! Holy shit, you missed the whole table.",
        "Were you aiming for the fridge, dumbass?",
        "My grandma throws better than that, and she's dead.",
        "That's not even close. That's not even in the same zip code.",
        "Hey genius, the cups are over here!",
        "Did you close your eyes? Be honest.",
        "That was embarrassing. For all of us.",
        "Brick! Absolute brick!",
        "You throw like you've never seen a ball before.",
        "That one's gonna be under the fridge till Christmas.",
        "Somebody get this clown some glasses.",
        "Wow. Just wow. That was pathetic.",
        "Is your arm broken, or are you just bad?",
        "You suck at this. Like, genuinely.",
        "I've seen better aim from a drunk raccoon.",
        "Keep shooting like that and I'll never have to drink.",
        "That's the worst shot I've seen all year, and I've watched Kevin play.",
        "Nice. Real nice. Go fetch it, bitch.",
    ],
    'playerRimOut': [
        "Rimmed out! Even the cup thinks you're a loser.",
        "Ooh, so close. Still sucks to be you.",
        "The cup said hell no!",
        "Rejected! Get that weak shit out of here.",
        "Almost doesn't count, sweetheart.",
    ],
    'playerMake': [
        "Okay, okay. Lucky shot.",
        "Even a broken clock is right twice a day.",
        "Alright, you got one. Don't get cocky.",
        "Ugh. Fine. Whatever.",
        "That had no business going in.",
        "Wow, you finally hit one. You want a trophy?",
        "Enjoy it, that's the last one you're getting.",
        "God damn it.",
        "Pure luck. Everybody saw that.",
    ],
    'aiMake': [
        "Drink up, buttercup!",
        "Nothing but beer, baby!",
        "Too easy. Is this your first time?",
        "Get used to that feeling.",
        "Splash! Chug it, loser.",
        "Bottoms up, champ. You're gonna be doing a lot of that.",
        "Did you see that? Of course you did. Now drink.",
        "That's called skill. Look it up.",
        "Cash that cup and cry about it.",
        "You're getting smoked in front of everybody.",
        "Drink! Drink! Drink!",
        "I could do this with my eyes closed. Wanna see?",
    ],
    'aiMiss': [
        "The table's crooked, man.",
        "Somebody bumped the damn table!",
        "I'm giving you a chance. You need it.",
        "Ugh, the light got in my eyes.",
        "That's on purpose. Strategy.",
        "Okay, that one slipped. Don't get excited.",
        "Who moved the cups? Seriously, who moved them?",
        "Shut up. Nobody say anything.",
    ],
    'ballsBackAi': ["Balls back, baby!", "Run it back! Gimme those balls.", "Two for two! Sit down."],
    'ballsBackPlayer': ["Seriously? Balls back. Whatever.", "Fine, take your stupid balls back."],
    'rerack': ["Re-rack it. Let's go.", "Tighten that up. Re-rack.", "Re-rack! Make it pretty for me."],
    'slow': [
        "Any day now!", "Shoot already, my beer's getting warm!", "Are you throwing or proposing?",
        "Tick tock, dumbass.", "We don't have all night. Throw the damn ball.",
    ],
    'aiLastCup': ["One more and you're done.", "Last cup. Say goodnight.", "Island time, baby. One left. Start crying."],
    'playerLastCup': ["Okay. I'm locked in now.", "Pressure's on you, buddy. One cup.", "I've come back from worse. Way worse."],
    'aiWin': [
        "Game! Sit your ass down.", "Get off my table.", "That's how it's done in this garage.",
        "Next! Who's got next? This guy's done.", "Thanks for the free beer, loser.",
    ],
    'playerWin': [
        "Rematch. Right now. Rack 'em.", "You got lucky and you know it.",
        "No way. No way! Best two out of three.", "Fine. Good game. I hate you.",
    ],
}

SPECIFIC = {
    'rick': {
        'start': [
            "Alright kiddo, let's see what you got.",
            "I was the champ of this garage before you could walk.",
            "Your dad couldn't beat me either. Runs in the family, I guess.",
        ],
        'playerMiss': [
            "Back in my day we had a word for shots like that. Garbage.",
            "Son, I've had hip surgery and I still throw better than you.",
        ],
        'aiMake': ["Still got it! Old man strength, baby!", "Forty years of practice, kid. Drink."],
    },
    'tyler': {
        'start': [
            "Let's go! Loser buys the next case.",
            "Rack 'em up, bro. I'm feeling dangerous tonight.",
            "Hope you stretched, 'cause this is gonna hurt.",
        ],
        'playerMiss': ["Bro. Bro! What was that?", "Dude, that was so bad I'm actually embarrassed for you."],
        'aiMake': ["Let's goooo! Too easy, bro!", "Somebody film this, I'm on fire!"],
    },
    'mike': {
        'start': [
            "Welcome to my house. You're gonna lose in it.",
            "I haven't lost on this table since college. You're not gonna be the first.",
            "Take a good look at those cups. You're gonna be drinking all of 'em.",
        ],
        'playerMiss': ["Pathetic. I've seen better from freshmen.", "You're not even worth warming up for."],
        'aiMake': ["That's ten years of practice, rookie. Drink.", "Legend. Says it right on the table."],
    },
}

# ---------------------------------------------------------------- crowd
CROWD_VOICES = [
    {'voice': 'af_bella', 'speed': 1.05}, {'voice': 'am_eric', 'speed': 1.0}, {'voice': 'af_sarah', 'speed': 1.08},
    {'voice': 'am_adam', 'speed': 1.0}, {'voice': 'af_jessica', 'speed': 1.05}, {'voice': 'am_liam', 'speed': 1.08},
]
CROWD = {
    'make': ["Let's go!", "Oh! No way!", "Drink!", "Oh shit!", "Yeah!", "Get wrecked!", "Oh snap!", "Holy shit!"],
    'miss': ["Oof!", "Oh, no.", "Brutal.", "Yikes.", "Oh my god, that was awful.", "Ha! Terrible."],
    'heckle': [
        "You suck!", "Air ball! Air ball!", "Somebody sub this guy out!", "Wow, that was trash.",
        "Drink, loser!", "Bury him!", "Bro can't hit water from a boat.", "That's so sad.",
    ],
    'chatter': [
        "Who brought the chips?", "Dude, did you see the game last night?", "Is there any more ice?",
        "Hey, grab me one from the fridge.", "Wait, whose turn is it?", "I got next game!",
        "Somebody turn the music up.", "My truck's making that noise again.", "Are you staying for the fire pit later?",
        "Who's winning?", "Okay but hear me out.", "Bro, that's my cup.", "Yeah, he always does that.",
        "No way!", "Is the pizza here yet?", "I'm telling you, it was this big.", "Did you text Jess?",
        "Who parked behind me?", "That's what I said!", "Hold on, I gotta hear this.",
        "Somebody close the door, it's freezing.", "Wait, are we out of beer already?", "Pass me the bottle opener.",
        "Oh my god, stop, I'm dying.", "He did not say that.", "Dude, I'm so full.", "Who invited Kevin?",
    ],
}


def plan():
    jobs = []  # (relpath, text, voice, speed)
    index = {'opponents': {}, 'crowd': {}}
    for opp, cfg in OPPONENTS.items():
        cats = {}
        allcats = set(SHARED) | set(SPECIFIC[opp])
        for cat in sorted(allcats):
            lines = SPECIFIC[opp].get(cat, []) + SHARED.get(cat, [])
            items = []
            for t in lines:
                h = hashlib.sha1(f"{cfg['voice']}|{cfg['speed']}|{t}".encode()).hexdigest()[:12]
                rel = f"{opp}/{h}.ogg"
                jobs.append((rel, t, cfg['voice'], cfg['speed']))
                items.append({'f': rel, 't': t})
            cats[cat] = items
        index['opponents'][opp] = cats
    for cat, lines in CROWD.items():
        items = []
        for i, t in enumerate(lines):
            # chatter gets one voice per line; reactions get two different voices each
            vs = [CROWD_VOICES[i % len(CROWD_VOICES)]] if cat == 'chatter' else \
                 [CROWD_VOICES[i % len(CROWD_VOICES)], CROWD_VOICES[(i + 3) % len(CROWD_VOICES)]]
            for vi, v in enumerate(vs):
                h = hashlib.sha1(f"{v['voice']}|{v['speed']}|{t}".encode()).hexdigest()[:12]
                rel = f"crowd/{h}.ogg"
                jobs.append((rel, t, v['voice'], v['speed']))
                items.append({'f': rel, 't': t, 'v': CROWD_VOICES.index(v)})
        index['crowd'][cat] = items
    return jobs, index


_k = None
def _render(args):
    rel, text, voice, speed, model, voices = args
    global _k
    dst = os.path.join(OUT, rel)
    if os.path.exists(dst):
        return rel, 'skip'
    if _k is None:
        from kokoro_onnx import Kokoro
        _k = Kokoro(model, voices)
    import soundfile as sf
    samples, sr = _k.create(text, voice=voice, speed=speed, lang='en-us')
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tf:
        sf.write(tf.name, samples, sr)
        # trim silence, normalise loudness, encode Opus
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', tf.name, '-af',
                        'silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse,loudnorm=I=-16:TP=-1.5',
                        '-ar', '48000', '-ac', '1', '-c:a', 'libopus', '-b:a', '28k', dst], check=True)
        os.unlink(tf.name)
    return rel, 'ok'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', required=True)
    ap.add_argument('--voices', required=True)
    ap.add_argument('--jobs', type=int, default=2)
    a = ap.parse_args()
    jobs, index = plan()
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, 'index.json'), 'w') as f:
        json.dump(index, f, indent=1)
    work = [j + (a.model, a.voices) for j in jobs]
    done = 0
    with ProcessPoolExecutor(a.jobs) as ex:
        for rel, st in ex.map(_render, work, chunksize=4):
            done += 1
            if done % 20 == 0:
                print(f'{done}/{len(work)}', flush=True)
    keep = {j[0] for j in jobs}
    for sub in ('crowd', *OPPONENTS):
        d = os.path.join(OUT, sub)
        if os.path.isdir(d):
            for fn in os.listdir(d):
                if f'{sub}/{fn}' not in keep:
                    os.unlink(os.path.join(d, fn))
    print('done', len(work), 'clips')


if __name__ == '__main__':
    main()
