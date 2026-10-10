# Deadpan kickoff: step by step on your Mac

This uses Claude Code inside the **Claude desktop app** (the Code tab). It runs the same engine and models as the terminal version, so you lose nothing by skipping the terminal.

## Start building

1. **Put the plan in the project folder.** Download `PLAN.md`, `SPEC.md` and this file from the thread and move them into `~/Developer/deadpan`.
2. **Open a session.** In the Claude desktop app, open the **Code** tab and start a new session (**Cmd+N**). Choose **Local**, not cloud: a cloud session runs on Anthropic's servers and can't reach the app running on your laptop. Pick `~/Developer/deadpan` as the project folder.
3. **Set the model.** In the model menu next to the send button (**Cmd+Shift+I**), pick **Opus 5.5**. Then press **Cmd+Shift+E** and pick **xhigh**. Press **Cmd+Shift+M** and pick **Accept edits**, so Claude doesn't stop to ask before every file change.
4. **Check your tools.** Send:
   > Check that Node 20 or newer, pnpm, git, the GitHub CLI (gh) and cloudflared are installed on this Mac, and install anything missing with Homebrew.

   Then log in to GitHub once: press **Ctrl+`** to open the app's built-in terminal pane, type `gh auth login` and follow the prompts (pick GitHub.com, HTTPS, log in with a web browser). This is the only command you type yourself.
5. **Start the milestones.** You don't need to copy each prompt; Claude can read this file. Send:
   > Follow the milestone prompts in KICKOFF.md, starting with M0. Do one milestone at a time. When each one is done, stop, tell me exactly what to test on my phone, and wait until I say "next".

   After that, test on your phone and type "next", or paste the error if something broke.
6. **Make accounts and keys while Claude builds M0.** M0 doesn't need any keys.
   - **Gemini:** an API key from aistudio.google.com. Turn billing on so free-tier limits can't stall your demo.
   - **ElevenLabs:** an API key. MLH emails a promo code; otherwise the Creator plan is $11 for the first month. Before M3, pick the detective's voice on the ElevenLabs website and save its voice ID.
   - **Tiger Cloud:** create a service and copy its connection string.
   - **Render:** create an account and connect it to your GitHub.
7. **Put your keys in `.env`.** Ask Claude to copy `.env.example` to `.env`, then open `.env` and paste your keys in yourself. Never commit it.
8. **Turn on Web Inspector** on your iPhone (Settings → Apps → Safari → Advanced) so you can see phone errors from Safari on your Mac.
9. **Phone testing loop.**
   - Tell Claude: "Start the dev server and a cloudflared tunnel in the background and give me the https link." Their output shows in the app's tasks pane.
   - Open the `https://….trycloudflare.com` link on your phone. It's HTTPS, so the camera works, and it goes over the internet, so venue Wi-Fi can't block it.
   - The big screen is the same link with `/host/...` open on your laptop.
   - The tunnel link changes every time it restarts, so ask Claude for the new one if the phone stops connecting.
10. After each milestone, test on both phones, then tell Claude "commit and push".
11. **Deploy once M0 works on your phone.** In the Render dashboard: New → Blueprint → pick the repo (it reads the `render.yaml` Claude made) → add the same keys as environment variables. Pick the Starter instance, because free ones fall asleep and take about 50 seconds to wake up. That Render URL is what you demo from.
12. **If Claude gets stuck,** paste the exact error. For iPhone problems, plug the phone into your Mac, then in Safari open Develop → your iPhone → the page, and copy the console output to Claude.

## Prompts to paste, one per milestone

**M0:**
> Read SPEC.md and PLAN.md. We're building Deadpan at Hacklanta, and all code has to be written during the event. Do milestone M0 only:
> - Set up the pnpm monorepo from SPEC.md (apps/web, server, packages/shared).
> - Build a Node server that serves the web app and a WebSocket.
> - Add routes /host/:room and /play/:room.
> - Make a phone page with a "Tap to start" button that opens the front camera and mic and shows the preview, following the iOS rules in SPEC.md.
> - Make a host page that lists the players who joined.
> - Add .env.example, .gitignore and a render.yaml for deploying to Render as one web service, init git, and create a public GitHub repo named deadpan with gh.
>
> Then start the dev server and a cloudflared tunnel in the background, give me the https link to open on my phone, and tell me what I should see. Stop after M0.

**M1:**
> M0 works on my phone. Do M1 from SPEC.md:
> - MediaPipe FaceLandmarker: pin @mediapipe/tasks-vision 1.0.1, self-host the wasm and model files, use the WebGL GPU delegate, run at about 15 fps.
> - From the face: blink rate, lip press, brow, gaze and head motion.
> - From the voice: pitch with pitchy, speech onset with vad-web.
> - Send features plus decimated landmarks at 10 Hz.
> - On the host, show live bars and a neon face mesh per player in React Three Fiber.
> - Add a debug overlay on the phone showing fps and the feature values.

**M2:**
> Do M2 from SPEC.md:
> - The server state machine for Imposter mode: lobby → baseline → deal → 2 questions per player → follow-up → verdict.
> - Clock sync and response-time measurement.
> - ElevenLabs Scribe v2 Realtime during the active player's turn only, using single-use tokens.
> - Per-player baselines and z-scores.
>
> Use placeholder text questions for now, with no AI yet.

**M3:**
> Do M3 from SPEC.md:
> - The Gemini detective: follow-up questions with gemini-3.5-flash-lite, the verdict with gemini-3.8-flash at low thinking, using the JSON schemas in SPEC.md.
> - The local fallback verdict and canned lines.
> - The ElevenLabs eleven_v4_turbo voice with audio tags, streamed over HTTP to the host.
> - Pre-generated sound effects.
>
> Every network call gets a timeout. Goal: a full Imposter round end to end with 2 phones.

**M4:**
> Do M4 from SPEC.md:
> - The noir interrogation room.
> - Neon face meshes that pulse with the heartbeat.
> - Suspect cards with the gaze meter labeled MYTH.
> - The spotlight verdict sequence.
> - The evidence-board replay.
> - Phone UI polish: the secret card, "tap when done" and the health dot.

**M5:**
> Do M5 from SPEC.md:
> - Tiger Data: the samples hypertable, a continuous aggregate for baselines, and the replay query.
> - Buffer writes if the database is down.
>
> If there's time, add Two Truths and a Lie mode.

**M6 (do this before you stop adding features):**
> Do M6 hardening from SPEC.md:
> - Reconnects.
> - Silent-mic detection with a reload button.
> - A phone health strip on the host.
> - Timeouts everywhere.
> - Demo mode (?demo=1) that replays a recorded round.
> - Log every round to rounds.jsonl.
>
> Then walk me through the acceptance test.

**Docs (after the feature freeze):**
> Write the README: what Deadpan is, an architecture diagram in Mermaid, setup steps, the sponsor tech used, and a disclosure of the AI tools used. Then draft the Devpost write-up in DEVPOST.md.

## Optional: a second session in parallel

Once M3 works, give the big screen its own session with its own copy of the code, so the two sessions don't overwrite each other:
1. Press **Cmd+N** for a new Local session in `~/Developer/deadpan`, and select **worktree** next to the branch name before sending anything.
2. Set the same model and effort as your first session (Cmd+Shift+I, Cmd+Shift+E).
3. Paste: "Work on a branch named big-screen. First run pnpm install here and copy .env from ~/Developer/deadpan into this folder. Then:" followed by Prompt M4.

Keep the first session on hardening and tuning. When M4 is done, tell the first session "merge the big-screen branch into main".
