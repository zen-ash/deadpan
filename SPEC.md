# Deadpan: build spec for Claude Code

*Hand this to Claude Code as the kickoff brief. It's a plan, not code: all code gets written during the hacking period, as the rules require. Where it names a model ID or API detail, check the current docs before relying on it.*

## Product in one paragraph

Deadpan is a multiplayer bluff game for 2–6 players with an AI detective. Each player joins a room on their own phone by scanning a QR code shown on a laptop "big screen". Each phone reads its player's face and voice **on the device**: MediaPipe face mesh, pitch, response time, pauses and fillers. It sends only numbers, about 10 times a second. In **Imposter mode**, everyone sees a secret word except one player. The detective asks each player questions out loud, adapts its follow-ups to whoever is drifting furthest from their own calm baseline, then names the imposter and shows the evidence. The big screen is a noir interrogation room built in React Three Fiber, with each player shown as a live neon face mesh.

## Hard constraints

- Phones are iPhone (Safari, iOS 26+) and Android (Chrome). The app must run over **HTTPS** and work on cellular data, so venue Wi-Fi can't break it.
- No video or raw audio leaves the phone except the active speaker's audio stream to ElevenLabs Scribe during their turn.
- Every network call in the game loop has a timeout and a canned fallback. A round must always finish.
- Keep it simple to run: one Node service serving both the built web app and the WebSocket. No Docker or Kubernetes.

## Stack

- **Monorepo** (pnpm): `apps/web` (Vite + React + TypeScript), `server` (Node + TypeScript), `packages/shared` (message types and game constants).
- **Web:** React, React Three Fiber + drei (big screen), `@mediapipe/tasks-vision` **pinned to 1.0.1** (1.1.0 only came out Oct 6, so stay on the known-good version unless 1.0.1 breaks) with self-hosted wasm and `face_landmarker.task`, `pitchy` 4.x (pitch), `@ricky0123/vad-web` (speech onset), `qrcode` (join QR).
- **Server:** `ws`, `@google/genai` (Gemini), `@elevenlabs/elevenlabs-js` (TTS, single-use Scribe tokens, sound effects). No database.
- **Models** (all IDs below were checked against the Gemini and ElevenLabs docs on Oct 10, 2026; the Gemini docs now lead with `client.interactions.create` in `@google/genai`, so follow whichever call the current docs show):
  - `gemini-3.8-flash` with thinking set to **low** (`minimal` errors on this model) for the verdict.
  - `gemini-3.5-flash-lite` for fast follow-up questions.
  - `eleven_v4_turbo` for the detective's voice, with inline audio tags. Use the HTTP `/stream` endpoint: v4 is reportedly not on the classic `stream-input` WebSocket.
  - `scribe_v2_realtime` with `include_timestamps`, filler words kept, `filter_background_audio` on.
- **Hosting:** Render web service (HTTPS).

## Routes

- `/` landing page: create a room, and the URL to type.
- `/host/:room`: the big screen (laptop).
- `/play/:room`: the phone (opened from the QR code).
- `/replay/:room/:round`: evidence board (also embedded in host after the verdict).

## Phone client (`/play/:room`)

1. **One "Tap to start" button.** Inside its click handler, in this order:
   - Create and resume the `AudioContext` synchronously.
   - Don't set `navigator.audioSession.type` to `'playback'` on the phone. That type is meant for media playback, while mic capture uses `'play-and-record'`, and the phone never plays sound anyway. Leave it at the default.
   - Call `getUserMedia({ video: { facingMode: 'user', width: 640, height: 480, frameRate: 30 }, audio: true })` **once**. A second call kills the first stream on iOS.
   - Request a Wake Lock.
   - Video element: `playsinline muted autoplay`.
2. **Face:** FaceLandmarker in VIDEO mode with the **GPU (WebGL) delegate**, about 15 fps, `outputFaceBlendshapes: true`, `outputFacialTransformationMatrixes: true`. Use `requestVideoFrameCallback` for frame timing. Derived per frame:
   - blink events (`eyeBlinkLeft/Right` cross-checked with eye aspect ratio), giving blinks per minute;
   - lip press (`mouthPressLeft/Right`, `mouthRollLower`);
   - brow (`browInnerUp`);
   - gaze-off-center (`eyeLook*`), shown on screen as **MYTH**;
   - head motion (frame-to-frame change in the transform matrix);
   - `jawOpen` as a "speaking" gate.
3. **Heart rate (decorative):** POS method on the average RGB of forehead and cheek regions taken from the landmarks. Resample to 30 Hz, band-pass 0.7–3.5 Hz, use a 15 s window, take the FFT peak. Signal quality = peak power ÷ band power. Send `hr: null` when quality is low or the head is moving. **Never** use it in the verdict.
4. **Voice:** an AudioWorklet or analyser running pitchy on frames, keeping frames with clarity ≥ 0.9 in 70–400 Hz. vad-web gives speech onset and offset, with a higher threshold and min speech length to reject chatter. Record each phone's noise floor during the lobby. If running vad-web next to MediaPipe drops an iPhone below about 12 fps, replace vad-web with an RMS threshold above that noise floor.
5. **Turn audio:** when the server says it's this player's turn, open a Scribe v2 Realtime WebSocket using a single-use token from the server. Stream mic audio, and close it as soon as the turn ends. Only one Scribe socket is open across the whole room at any time.
6. **Sending data:** a `features` packet every 100 ms (see Messages), plus about 120 decimated face landmarks quantized to int16 every 100 ms, for the big-screen mesh. Send the landmarks as a binary WebSocket frame, not JSON.
7. **UI:**
   - Secret card (word or "IMPOSTER — blend in"), shown only while the player is pressing and holding the card.
   - "Your turn" state with a big **Tap when done** button.
   - A health dot (camera, mic and socket OK), and a **Reload** button if the mic track goes silent (iOS 26 audio-reset bug).
   - Never call `speechSynthesis` on the phone: it mutes the camera and mic.

## Server

- Rooms in memory: players, a game state machine, and clock offset per phone from ping/pong (NTP-style, median of 5).
- **State machine (Imposter):** `lobby → baseline → deal → (question → answer){2 per player} → followup → verdict → replay → lobby`.
  - **baseline:** each player answers 1–2 softballs ("Say your name and what you ate today"). Store mean and std per feature as that player's baseline.
  - **deal:** pick the word. Use a curated list of 200 safe words, with Gemini as an option for themed categories. Pick the imposter at random.
  - **question:** the server asks the TTS for the line and sends it to the host to play. The host tells the server when playback ends (`tts_end`), and the server sends that moment (server time) to the active phone as `questionEnd`. The phone measures **response time = first speech onset − questionEnd**, using its clock offset.
  - **answer:** ends when the player taps done, after 2.5 s of silence, or after a 15 s cap.
- **Per-answer features**, each turned into a z-score against that player's baseline:
  - response time;
  - pause count and total pause time, and speech rate (from Scribe word timestamps);
  - filler count ("um", "uh", "like", "you know");
  - median pitch shift in semitones;
  - blink rate;
  - lip-press mean.
- **Delivery score** = weighted sum, starting at: response time 0.30, pitch 0.20, pauses/fillers 0.25, blink 0.15, lip press 0.10. Tune these on the playtest logs.
- **Detective (Gemini):**
  - **Follow-up call** (Flash-Lite, 2.5 s timeout). Input: the word (never revealed in output), transcripts so far, and per-player delivery scores. Output JSON: `{ "target_player_id": string, "question": string, "spoken_line": string }`. `spoken_line` carries v4 audio tags like `[whispers]`, `[pause]`, `[low, gravelly]`.
  - **Verdict call** (3.8 Flash, thinking low, 6 s timeout, started at the drumroll). Input: everything above. Output JSON: `{ "accused_player_id": string, "confidence": 0-1, "content_evidence": string[], "delivery_evidence": string[], "spoken_verdict": string }`.
  - **Fallback:** if either call times out, use the highest combined score (delivery plus a simple content check: does the answer contain words related to the secret?). Pick from 20 canned detective lines.
- **TTS:** server-side ElevenLabs `eleven_v4_turbo` via the HTTP stream, piped to host as audio. Pre-generate and cache the sound effects (drumroll, stinger, noir room tone, "case closed") and the canned lines at startup.
- **Round recording (no database):** the server keeps every `features` packet and transcript word for the current round in memory, and when the round ends writes it to `rounds/<room>-<round>.json`. The evidence-board replay and demo mode both read from these files. Render's disk resets on every deploy, so commit one good recorded round to the repo for demo mode.

## Big screen (`/host/:room`)

- R3F scene: a dark room with one swinging lamp, film grain and a vignette.
- One "suspect" per player:
  - neon point/line face mesh from the streamed landmarks;
  - a heartbeat pulse rippling across the mesh when `hr` is present;
  - colour shifting from calm blue to hot red with the live delivery score.
- Suspect card: name, live bars for response time, pitch shift, fillers, blinks and lip press, a heart icon with a quality badge, and the gaze meter labeled **MYTH**.
- **Phases:**
  - Lobby: QR code, typed URL, players popping in.
  - Baseline: "Calibrating…" rings around each face.
  - Question: subtitles of the detective's line, with the active player under the spotlight.
  - Verdict: drumroll, then the spotlight sweeps and lands on the accused, then the spoken verdict with evidence chips appearing one by one.
  - Replay: the evidence board, a timeline of the round with transcript words and signal spikes aligned.
- Phone health strip along the bottom: a dot per player, so a dead mic is visible before the demo starts.
- **Demo mode** (`?demo=1`): replay a recorded round from JSON with identical visuals and audio, for when live fails.

## Messages (`packages/shared`)

```ts
type ClientToServer =
  | { t: 'join'; room: string; name: string }
  | { t: 'ping'; c: number }
  | { t: 'features'; ts: number; face: { blinkPm: number; lipPress: number; brow: number; gazeOff: number; headMotion: number; speaking: boolean };
      voice: { pitchHz: number | null; clarity: number; vad: boolean; rms: number }; hr: { bpm: number | null; quality: number } }
  | { t: 'mesh'; ts: number; pts: Int16Array }
  | { t: 'speech_onset'; ts: number } | { t: 'speech_end'; ts: number }
  | { t: 'transcript'; final: boolean; words: { w: string; start: number; end: number }[] }
  | { t: 'done' };

type HostToServer =
  | { t: 'host_join'; room: string }
  | { t: 'tts_end'; lineId: string }
  | { t: 'start_round' };

type ServerToClient =
  | { t: 'pong'; c: number; s: number }
  | { t: 'state'; phase: string; round: number; activePlayer?: string }
  | { t: 'secret'; word: string | null }       // null = imposter
  | { t: 'your_turn'; questionEnd: number; scribeToken: string }
  | { t: 'turn_over' };
```

The host receives the room state plus forwarded `features` and `mesh` for every player.

## Milestones (each one ends with a commit and a deploy)

1. **M0, phone talks to screen:** deployed over HTTPS; the phone shows the camera and the host lists the player.
2. **M1, live signals:** face and voice features flow at 10 Hz; host shows bars and the mesh; **tested on a real iPhone and an Android**.
3. **M2, turn engine:** the state machine runs a round with response times and Scribe transcripts, and baselines are stored.
4. **M3, the detective:** Gemini follow-ups and verdict, v4 voice and sound effects, fallbacks. **A full Imposter round runs end to end with 2 phones.**
5. **M4, the show:** noir scene, spotlight reveal, evidence-board replay, phone UI polish.
6. **M5, computer vision showcase and mode 2:** a "camera view" toggle on the host for the Mercedes computer vision judges, showing each phone's live landmarks, blink and lip-press detections, head motion, heart-rate signal quality and on-device fps; custom domain; Two Truths and a Lie if ahead.
7. **M6, hardening:**
   - reconnect handling;
   - silent-mic detection and reload;
   - timeouts everywhere;
   - demo mode;
   - a test on a phone hotspot;
   - a log of every round (accused vs. actual imposter) to `rounds.jsonl` for the accuracy stat.

## Acceptance test for the demo

Two phones join by QR in under 15 seconds. Then baseline, deal, 2 questions each, a follow-up and the verdict all finish in **under 90 seconds**, with no step waiting more than 3 seconds on the network. Pull the Wi-Fi on the laptop mid-round: the round still finishes on cellular or hotspot. Kill Gemini (bad key): the round still finishes, using the fallback verdict.

## Not building

Accounts and logins, persistent profiles, more than 6 players, native apps, anything that claims to be a real lie detector.
