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

## Sound

- **Trash talk & party chatter:** the game writes each line of dialogue to a WAV with your phone's built-in text-to-speech voices (`VoiceBank.kt`), then plays it through a garage reverb, panned around the room. Different people get different voices and pitches. If your phone has more voices installed (Settings → Text-to-speech → Google → Install voice data), you'll hear more variety. The first launch takes a few seconds to render the lines. After that they're cached.
- **Laughing, "ooohs", cheers, the murmur of conversation, the fridge hum, cans cracking, ball/table/cup/splash sounds** are all synthesized live with Web Audio.

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

Opponent categories: `opp_start`, `opp_playerMiss`, `opp_playerRimOut`, `opp_playerMake`, `opp_aiMake`, `opp_aiMiss`, `opp_ballsBackAi`, `opp_rerack`, `opp_slow`, `opp_aiLastCup`, `opp_aiWin`, `opp_playerWin`. Crowd categories: `crowd_make`, `crowd_miss`.

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
  game.js               rules, AI, controls, HUD
```

### Build locally

```bash
cd web && npm ci && npm run build      # bundles web/src -> app/src/main/assets/game/game.js
cd .. && ./gradlew assembleRelease     # needs the Android SDK (or open the folder in Android Studio)
```

To try the game in a desktop browser, serve `app/src/main/assets/game/` (for example `python3 -m http.server`) and use the mouse to swipe. Voices fall back to the browser's speech engine there.
