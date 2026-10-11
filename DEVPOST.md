# Deadpan: Devpost submission draft

Copy each section into the matching Devpost field. Items in [brackets] still need filling in.

## Project name

Deadpan

## Tagline (Devpost's "elevator pitch", 200 characters max)

A party bluff game where your phone reads your face and voice, and an AI detective questions the table, grills whoever cracks, and names the liar.

## Track and challenges

- **Track:** Creative
- **Side challenges (3):**
  - Best Use of ElevenLabs
  - Best Use of Gemini API
  - Mercedes: Best Application of Computer Vision

[Check the challenge names against the exact wording in the Devpost form.]

## Links

- **Live app:** https://deadpan.ink
- **A recorded round, no phones needed:** https://deadpan.ink/host/JGWG?demo=1&from=home
- **Code:** https://github.com/zen-ash/deadpan
- **Video:** [public link to the 2–3 minute video]

---

## Inspiration

Party games moved onto screens and stopped making us look at each other. Deadpan uses your phone to make you look at each other again.

Bluffing games are about tells: the pause before an answer, a voice that climbs, a sudden stillness. People are bad at spotting them in real time. A phone held at arm's length is good at it. So the idea was a game where every player's own phone quietly measures their nerves, and a detective with a voice and a personality decides who's lying, then shows its work.

## What it does

2–6 players join a room by scanning a QR code on a laptop. The laptop becomes the big screen: a film-noir interrogation room with a glowing 3D face mesh for every suspect and their signals pulsing on a card beside them.

1. **Calibration.** The detective asks everyone an easy question. That answer becomes each player's own calm baseline.
2. **The deal.** Each phone shows a secret, readable only while you press and hold it.
3. **Questions.** The detective asks each player out loud. The big screen shows the question, a timer, a live transcript, and every signal against that player's baseline.
4. **The follow-up.** Gemini reads every answer and grills the most suspicious player with a question written on the spot.
5. **The verdict.** A drumroll while Gemini decides, then the spotlight lands, the detective names the culprit, and the evidence appears.
6. **The evidence board.** The whole round on one timeline, with every answer, the filler words marked, and each spike against the player's baseline. Every round can be replayed exactly as it happened.

**Two games:**
- **Imposter:** everyone gets the secret word except one player, who has to bluff.
- **Two Truths and a Lie:** the detective asks everyone three questions about themselves. Each phone secretly tells its player which answer to lie on, and at the end the detective names every player's lie.

**What counts as evidence:** response time, hesitation (pauses, filler words, slower speech), pitch rising above your calm, blink rate and lip press, all measured against your own baseline. Looking away is shown on screen but labeled **MYTH**, because research says it isn't a sign of lying. The heart rate read from your skin colour is shown with a quality badge, but it's never used as evidence.

It's a party game, not a lie detector, and it says so.

## How we built it

- **Phones (on-device computer vision and audio):**
  - MediaPipe's Face Landmarker tracks 478 face points at about 15 fps on the phone's GPU.
  - From those points the phone measures blinks (eye aspect ratio), lip press, brow and gaze (blendshapes), head pose (the face transform), plus a camera pulse using the POS method on three skin patches.
  - pitchy tracks pitch, and Silero VAD detects when you start speaking.
  - The phone sends a few dozen numbers ten times a second plus a reduced face mesh. Video never leaves the phone.
- **Server:** one Node process running Express 5 and `ws`.
  - It holds the rooms, syncs every phone's clock NTP-style (response time is measured to the millisecond across devices), runs each round as one script, and scores every answer as z-scores against the player's baseline.
  - Each round is saved as a JSON file on a persistent disk, which powers the evidence board, the replays and the accuracy log.
- **ElevenLabs:**
  - **Eleven v4 Turbo** with inline audio tags gives the detective a gravelly noir voice. Gemini's lines stream to the big screen as they're generated.
  - **Scribe v2 Realtime** transcribes each answer straight from the phone, using a single-use token. Its word timestamps time every pause and filler.
  - **Sound effects** for the drumroll, the stinger, the room tone and the "case closed" stamp.
- **Gemini 3.8 Flash** (thinking low, structured JSON):
  - It gets every transcript and every signal with its z-score.
  - It writes the follow-up: it names a player, quotes something they said or did, and asks something a bluffer would have to guess.
  - It delivers the verdict, with evidence lines and a confidence.
- **Big screen:**
  - React Three Fiber, drei and postprocessing for the room: fog, light through blinds, and a swinging lamp that follows whoever is being questioned, sweeps during the drumroll and lands on the accused.
  - A **camera view** shows exactly what each phone sees, for the computer vision judges: face landmarks, blink detection, head pose and the pulse signal. It also runs a driver-drowsiness readout (PERCLOS, eyes shut, head down), because the same on-device pipeline could watch a driver without any video leaving the car.
- **Hosting:** Render, at https://deadpan.ink.

## Challenges we ran into

- **iPhone media rules:**
  - Camera and mic have to start from one tap with one `getUserMedia` call.
  - The audio context can fall asleep right after capture starts.
  - A mic track can stay "live" while delivering pure silence, so the phone checks for that and offers a reload.
  - The phone must never use speech synthesis, which mutes the mic.
- **Timing across devices:** response time is the strongest cue, so it has to be right. The laptop reports the moment each question stopped playing in server time, and every phone's clock is synced to the server.
- **Echo versus quick answers:** the phone hears the detective's own voice from the laptop, so speech in the first 200 ms used to be thrown away. Playtests showed some people really do answer that fast. Their answers were being timed from their next pause, which made a quick answerer look like they'd stalled for 3 seconds. Now an instant answer counts unless the phone was hearing the detective at the end of the question.
- **Pitch tracking jumps octaves**, especially through Bluetooth earbuds, which switch to call-quality audio. One reading told the detective a voice had "shot up an entire octave". The scorer now drops octave jumps, and phones on a headset ask the player to take it out.
- **AI latency in a live show:** a Gemini call can take 2–8 seconds. The follow-up hides behind a thoughtful "Hmm…", and the verdict call starts while the detective says "I've heard enough" and the drumroll plays.
- **A round must always finish.** Every network call has a timeout and a fallback: a local verdict from the same scores, cached voice lines, the laptop's own voice. Phones that drop out keep their seat for 45 seconds and rejoin the same turn.

## Accomplishments that we're proud of

- **It's accurate, honestly measured:** in 18 two-player playtest rounds, the detective named the imposter 13 times (72%), where a coin flip gets 50%. It's a small, informal sample with mostly the same few players. Re-scoring the same rounds after fixing two measurement bugs they exposed gave 78%.
- **All the vision runs on the phone in real time**, with nothing but numbers leaving the device.
- **Every round is a complete recording.** The evidence board and the demo replay play back the faces, signals, voice and verdict exactly as they happened.
- **It never stalls on stage.** It survives a slow AI, a dead voice service or a phone dropping out mid-answer.
- **Two complete game modes**, from one round engine.

## What we learned

- **Personal baselines matter more than any single signal.** A fast talker and a slow thinker can only be judged against themselves.
- **Measure before you trust a number.** Re-scoring the saved Two Truths rounds showed that both lies the detective "found" were found because of measurement bugs. With the bugs fixed, it missed both. Without recordings of every round, that would have gone unnoticed.
- **Some famous tells are myths.** Looking away tells you almost nothing (DePaulo et al., 2003, 116 studies), so the game shows gaze but labels it as a myth instead of quietly using it.
- **Latency is a design problem as much as an engineering one.** A detective who says "Hmm…" while thinking feels more alive than one who answers instantly.

## What's next for Deadpan

- More rounds with more players, for a stronger accuracy number. Two Truths and a Lie needs its own.
- Testing on Android phones.
- A streamer mode, where the chat votes alongside the detective.
- More bluffing games on the same engine.

## Built with

typescript, react, vite, three.js, react-three-fiber, mediapipe, pitchy, silero-vad, onnxruntime-web, node.js, express, websockets, gemini, elevenlabs, render, cloudflare

## Testing instructions for judges

**Without phones (30 seconds):**
1. Open https://deadpan.ink on a laptop and click **Watch a recorded round**.
2. Press **Play the round**, with sound on. It's a real 2-player game, played back with its faces, signals and voice.
3. After the reveal, open **See the evidence** for the full timeline, or **Camera view** to see what each phone tracked.

**Live:**
1. On a laptop, open https://deadpan.ink and click **Create a room**. Turn the sound on.
2. On each phone (iPhone in Safari or Chrome), scan the QR code, enter a name and tap **Start camera and join**. Allow the camera and the mic.
   - Hold the phone 20–30 cm from your face.
   - Use the phone's own mic, not earbuds.
3. Pick **Imposter** (2 or more players) or **Two truths, one lie** (works with 1). Press **Start round**.
4. Answer out loud when your phone flashes gold, then tap **Done**.
5. After the verdict, open **See the evidence**, or **Camera view** at any time.

## Built at the hackathon, and AI tool use

- **Code:** all of it was written during Hacklanta 2026.
- **Writing the code:** Claude Code (Anthropic's AI coding agent) wrote the code, one milestone at a time from the build spec and milestone prompts in the repo (`SPEC.md`, `KICKOFF.md`). Every milestone was tested by hand on a real iPhone and laptop before it was committed. The tuning, the playtests and the game design decisions came from playing it.
- **Planning and design:** the plan and the build spec were drafted with Claude before coding started. The visual redesign started from mockups made with Claude Design.
- **In the product:** Gemini (the detective's reasoning and lines) and ElevenLabs (voice, transcription and sound effects).
- **Other people's work:** open-source libraries (React, three.js, React Three Fiber, MediaPipe Tasks Vision and its face landmarker model, pitchy, vad-web, Express, ws and others), and the Instrument Sans and Instrument Serif fonts.
