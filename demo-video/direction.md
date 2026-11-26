# Direction

## Facts

- Project name: EvenPulse AI (`com.evenpulse.g2`, v1.0.0) for Heads Up: Even Realities Hackathon (DoraHacks) — `app.json`, `README.md`, `SUBMISSION.md`
- Hackathon tracks: Track 01 (Messaging & News), Track 04 (AI Assistants & Work), Special Prize (Best Telegram Integration) — `README.md`, `SUBMISSION.md`
- Hardware target: Even Realities G2 576×288 4-bit green micro-LED display (`textColor` 1–4) + Temple touchpad & R1 Ring — `src/hud/layout.ts`, `src/hud/bridge.ts`
- Five HUD views validated by Vitest against `validateEvenHubPageContainer()`: `INBOX`, `MESSAGE`, `BRIEF`, `DIGEST`, `VOICE` — `tests/even-pulse.test.ts` (13 passed)
- Live Telegram Bot verified via `.env`: `@evenpulse_bot` connected (`Telegram: @evenpulse_bot`, `TG:LIVE`), supports `/start`, `/urgent`, `/task`, `/brief`, inline keyboards, and real reply delivery — live browser check at `http://localhost:5173`, `server/telegram.ts`, `server/index.ts`
- Triage & reply flow: condenses messages to <=44-char priority rows (`P0`, `P1`, `P2`), opens `MESSAGE` view with 3 reply drafts on tap, sends reply and marks `[OK]` / `REPLIED` on second tap — `src/hud/layout.ts`, `src/hud/bridge.ts`, `server/ai.ts`
- Voice Copilot: hold Temple/Ring triggers `audioControl(true, AudioInputSource.Glasses)`, encodes 16kHz PCM to RIFF WAV (`encodePcm16ToWav`), and routes `reply_telegram`, `create_task`, `brief`, `ask_ai` (Companion speech/text input + server STT when AI key set) — `src/hud/audio.ts`, `src/hud/bridge.ts`, `server/index.ts`
- Work Brief & OS Menu: `BRIEF` view shows next meeting (seeded `TVM Ventures Demo Sync · In 12m (15:00)` or live `.ics` sync) and 1-tap `[ ]`/`[x]` task toggles; native `MenuContainerProperty` provides 5 OS menu items including `Channel Digest` and `Send Brief to TG` — `src/hud/layout.ts`, `server/calendar.ts`
- Packaged deliverable: `even-pulse.ehpk` (51,057 bytes) built via `npm run pack`; `tsc --noEmit && vite build` passes cleanly — repo root, build check

## Brief

- **Asked for:** "make this video, my token in .env" following the 7-scene hackathon demo plan for `F:\hackaton\even-pulse`.
- **Product and promise:** EvenPulse turns Even Realities G2 smart glasses and the R1 Ring into a heads-up Telegram and AI Work copilot — read what matters, write in seconds.
- **Format:** 1920x1080 @ 60fps, ~80-90s, English narration and UI copy.
- **Platform and captions:** Hackathon submission video (DoraHacks / YouTube 16:9); 1920x1080 60fps master + compressed copy; no burned-in caption track (only on-screen visual callouts and rebuilt UI copy).
- **Assets:** Live `.env` Telegram Bot (`@evenpulse_bot`), live verified app UI (`index.html`, `src/styles.css`, `src/hud/layout.ts`), `even-pulse.ehpk`, `tests/even-pulse.test.ts`. No music file supplied.
- **Subject:** EvenPulse AI running live against `@evenpulse_bot` with founder pre-pitch messages (Alex Chen, Maya Lin, Daos Hub, DeployBot) and TVM Ventures Demo Sync work brief — private Chat ID redacted.
- **Invented:** Sample simulated incoming urgency timestamp (`14:48`), synthetic motion SFX cues, and visual stage framing around the rebuilt 576×288 optical display.

## Concept

- **Options:** (1) Before-Your-Pitch Live Walkthrough — single continuous founder story rebuilt in crisp 1080p HTML/CSS/SVG matching the G2 optical bezel; (2) Split-Screen Phone vs Glasses comparison; (3) System Architecture data-flow diagram explainer.
- **Chosen:** Concept 1 — puts the glowing 576×288 G2 micro-LED display at frame 0, follows one real pre-pitch storyline from incoming Telegram alert to 1-tap reply, voice task capture, task check-off, and SDK validation proof, with zero filler.
- **Copy system:** Crisp callout statements paired with rebuilt live UI components (`Space Grotesk` headlines + `JetBrains Mono` HUD/telemetry).

## Look

- **Palette candidates:** (1) Obsidian Waveguide & Micro-LED Green (`#060908`, `#0d1411`, `#34ff8a`, `#e8f5ee`) sampled from EvenPulse; (2) Daylight Slate & Emerald (`#f5f5f7`, `#ffffff`, `#16a34a`); (3) Midnight Blue & Telegram Cyan (`#0b1120`, `#38bdf8`).
- **Frame and palette:** Dark (`#060908` bg, `#0d1411` bg-2, `#121c18` surface, `#e8f5ee` fg, `#8fb39f` muted, `#34ff8a` accent, `#03150a` on-accent) — matches EvenPulse's actual 4-bit green micro-LED optics and keeps high contrast without borrowing Telegram's blue.
- **Type:** `Space Grotesk Variable` (display & callouts) + `JetBrains Mono Variable` (G2 HUD, badges, telemetry, code proof), fetched locally via `video.mjs font`.
- **World:** Dark optical lab stage with soft radial waveguide light pools, rebuilt G2 bezel + 2:1 lens with subtle scanlines, Telegram `@evenpulse_bot` chat card, Work Brief card, OS Menu overlay, and SDK Telemetry / Vitest terminal cards.

## Sound

- **Mode:** English TTS voiceover (`kokoro`) + synthesized UI/motion effects (`data-sfx`) + subtle distant `sound.bed` tested against `.no-bed.mp4`. No music (none supplied).
- **Concept:** Material `glass` & `synth` (crisp optical taps, soft notification blips, mechanical checkmarks, subtle transitions in C major / A minor, tight room). Gaps between spoken phrases stay calm and intentional.
- **Arc:** Scene 1 warm hook (`0.45`) -> Scene 2 urgent alert arrival (`0.35 -> 0.85`) -> Scene 3 1-tap reply payoff (`0.95`) -> Scene 4 voice capture (`0.7`) -> Scene 5 brief completion (`0.8`) -> Scene 6 SDK proof (`0.65`) -> Scene 7 clean close (`0.5 -> 0.2`).

## Beats

| Time | Scene | Idea and composition | On screen and action (cue times) | Copy | Sound (primary / quiet) |
| --- | --- | --- | --- | --- | --- |
| 0.0–12.0 | 01-hook | Calm G2 lens cuts through noisy phone buzz; hero centered | G2 Optical Display (`INBOX (3) \| TG:LIVE`) rests at frame 0; noisy phone alert chips scatter out as G2 rows lock sharp | EvenPulse · Heads-Up G2 Copilot | whoosh / blip, pop |
| 12.0–25.0 | 02-triage | Live Telegram alert routes to P0 HUD headline | Split: Telegram `@evenpulse_bot` sends `/urgent` message; pulse travels connector line into G2 `INBOX (4)` `[P0]` top row | Real-Time P0 / P1 / P2 Triage | blip / swoosh, pop |
| 25.0–42.0 | 03-reply | Two-tap Read & Write loop sends real Telegram reply | Cursor glides to `R1 Ring Tap` -> `MESSAGE` view + 3 drafts -> second tap sends `✓ Sent` & live reply bubble pops in `@evenpulse_bot` | Tap 1: Read · Tap 2: Sent Live | success / click, pop |
| 42.0–55.0 | 04-voice | Hold to speak captures intent into Work Brief | Voice bar activates `● G2 MIC ACTIVE`, waveform animates, `VOICE COPILOT` resolves `Task Added to Brief` | Voice Copilot · Intent Router | toggle-on / ding |
| 55.0–68.0 | 05-brief | Double-tap to Work Brief & 1-tap task check-off | `2× Tap` pill presses -> `AI WORK BRIEF` shows `TVM Ventures Demo Sync` + 4 tasks -> tap checks `[x]` (`3 OPEN TASKS`) | Meeting Prep + 1-Tap Tasks | tick / click |
| 68.0–80.0 | 06-sdk | Native OS Menu + SDK Telemetry + Vitest proof | `☰ OS Menu` opens 5 items -> selects `Channel Digest`; right card shows `SDK Telemetry` + `13/13` tests & `.ehpk` badge | @evenrealities/even_hub_sdk v0.0.16 | shimmer / pop, tick |
| 80.0–86.0 | 07-close | Clean brand lockup and hackathon track summary | Minimalist G2 vector glyph + `EvenPulse AI` + 3 track pills (`@evenpulse_bot`, `576×288 HUD`, `even-pulse.ehpk`) | Read what matters. Write in seconds. | sting / — |
