# Garage Pong 🍺

A 3D beer pong game for Android. It's set in a two-car garage at night: a 6 ft white folding table, red party cups, shop lights, string lights, a pegboard, an old fridge, and a crowd that won't stop talking.

## Install on your phone

1. On your Android phone, open **Releases → latest** in this repo and download `GaragePong.apk`.
2. Tap the download to install. If asked, allow your browser to *install unknown apps*.

Every push to `main` rebuilds the APK through GitHub Actions (`.github/workflows/build.yml`) and updates the **latest** release.

## How to play

- **Swipe up** to throw. A longer swipe throws farther, and a faster flick gives a flatter shot. Moving sideways aims left or right.
- The meter on the right shows how long your swipe is. The red zone marks the swipe lengths that reach the cups. You can turn the meter off under Pause.
- House rules: 10 cups, two throws per turn, balls back if you make both, and an automatic re-rack at 6 and 3 cups.
- Opponents: **Uncle Rick** (casual), **Tyler** (regular), **Big Mike** (frat legend).
- Every cup your opponent makes adds to your buzz, and your aim gets a little shakier.

## People

Your opponent stands at the far end of the table. He winds up, throws with his arm, celebrates his makes, shakes his head at his misses and watches the ball. A few guests stand around holding drinks, talk to each other, react to big shots, and one wanders between the fridge, the garage door and the workbench. The men wear ball caps, beards, tees and jeans. These are generated at load time in `people.js`, and the repainted textures come from `web/tools/make_textures.py`.

Your own view drifts around the garage now and then, toward the guests, the fridge or the workbench, and snaps back the moment you touch the screen.

## Sound

- **Voices:** every line of trash talk, heckling and party chatter is pre-recorded with the **Kokoro** neural text-to-speech model, with a different voice for each opponent and six crowd voices. The clips live in `app/src/main/assets/game/voices/`. To change the dialogue, edit `web/tools/render_voices.py` and re-run it (instructions at the top of the file). If that folder is missing, the game falls back to the phone's own text-to-speech.
- **Laughing, "ooohs", cheers, background murmur, the fridge hum, cans cracking, and ball/table/cup/splash sounds** are synthesized live with Web Audio.

### Use real recordings (recommended)

Put your own audio files in `app/src/main/assets/game/sounds/` and list them in `manifest.json`. Real recordings of friends trash talking sound best. Any category with files replaces the generated sound:

```json
{
  "laugh": ["laugh1.mp3", "laugh2.mp3"],
  "chatter": ["party_walla.mp3"],
  "crowd_make": ["lets_go.mp3"],
  "opp_playerMiss": ["airball.mp3", "were_you_aiming_for_the_fridge.mp3"],
  "opp_aiMake": ["drink_up.mp3"]
}
```

Real recordings beat generated audio for laughter in particular. Opponent categories: `opp_start`, `opp_playerMiss`, `opp_playerRimOut`, `opp_playerMake`, `opp_aiMake`, `opp_aiMiss`, `opp_ballsBackAi`, `opp_rerack`, `opp_slow`, `opp_aiLastCup`, `opp_aiWin`, `opp_playerWin`. Crowd categories: `crowd_make`, `crowd_miss`, `crowd_heckle`.

## Project layout

```
app/                    Android app (Kotlin): full-screen WebView + TTS voice bank
  src/main/assets/game/ built game (index.html, game.js) and sounds/
web/src/                game source (Three.js)
  scene.js              garage, table, cups, lights
  textures.js           procedural concrete / table / drywall / door textures
  physics.js            ball flight with drag, bounces, cup rim collisions
  audio.js              mixer, reverb, synthesized SFX, laughter, crowd
  voices.js             trash-talk lines, chatter, voice playback
  people.js             characters, animation retargeting, opponent throwing arm
  game.js               rules, AI, controls, HUD
web/tools/render_voices.py   dialogue + neural voice rendering
```

### Build locally

```bash
cd web && npm ci && npm run build      # bundles web/src -> app/src/main/assets/game/game.js
cd .. && ./gradlew assembleRelease     # needs the Android SDK (or open the folder in Android Studio)
```

To try the game in a desktop browser, serve `app/src/main/assets/game/` (for example `python3 -m http.server`) and use the mouse to swipe. Voices fall back to the browser's speech engine there.

## Credits

- Voices: [Kokoro-82M](https://github.com/thewh1teagle/kokoro-onnx) (Apache-2.0).
- Characters and animations come from the [three.js examples](https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf): a Ready Player Me avatar (`guy.glb`), plus Michelle (`girl.glb`) and X Bot (animation source, `anims.glb`) from Adobe Mixamo. Check those providers' terms before you publish the game commercially.
- 3D engine: [three.js](https://threejs.org) (MIT).
