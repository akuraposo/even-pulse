# DoraHacks BUIDL Submission: EvenPulse AI

Submission text for the Heads Up: Even Realities Hackathon on DoraHacks.

### Project Name
EvenPulse AI

### One-Line Tagline
Telegram and work assistant for Even Realities G2 & R1 Ring that triages chats, sends 1-tap AI replies, and tracks tasks without reaching for your phone.

### Selected Tracks
- Track 01: Messaging & News
- Track 04: AI Assistants & Work
- Special Bounty: Best Telegram Integration ($1,000)

### Problem
Checking active Telegram work chats during meetings forces people to unlock their phone repeatedly just to tell urgent deploys apart from casual chatter, type short confirmations, or note follow-up tasks. Raw notification forwarding clutters a 576x288 monochrome display with multi-paragraph messages and still offers no way to respond.

### Solution
EvenPulse filters Telegram threads on the server and sends short, interactive cards to the Even Realities G2 waveguide display and R1 Ring.

Incoming messages are scored `P0`, `P1`, or `P2`, summarized to 44 characters or fewer, and styled with SDK `textColor` hierarchy levels (1 to 4). Scrolling with the glasses temple touchpad or R1 Ring picks a thread. One tap opens the AI summary alongside three short reply drafts; a second tap sends that reply straight back to Telegram.

Long-pressing the temple or ring activates `bridge.audioControl(true, AudioInputSource.Glasses)`, captures 16 kHz mono PCM frames, encodes a WAV payload for speech-to-intent routing (with Web Speech fallback on desktop), and executes actions such as `"Reply to Alex that I am joining in 5 minutes"` or `"Add task to review Q4 deck"`.

Double-tapping switches to the AI Work Brief, showing the next synced `.ics` calendar meeting and open action items that can be toggled from the glasses. Sending `/start` in Telegram auto-pairs the chat ID and attaches inline keyboard actions (`Work Brief`, `Push P0 Alert to G2`, `Open Tasks`), while `/urgent`, `/task`, and `/brief` work from chat in both directions.

### Technical details
- Built on `@evenrealities/even_hub_sdk` (`v0.0.16`) with `createStartUpPageContainer`, `rebuildPageContainer`, `MenuContainerProperty`, `audioControl`, `getDeviceInfo` / `onDeviceStatusChanged`, and `EventSourceType` (Glasses R vs. R1 Ring).
- Express bridge (`server/`) isolates Telegram Bot API tokens and OpenRouter/Gemini/OpenAI keys from the frontend bundle, checks `.ics` calendar URLs against private/local networks, and persists messages, tasks, and next-meeting prep in `data/state.json`.
- Vitest validates all five HUD views (`INBOX`, `MESSAGE`, `BRIEF`, `DIGEST`, `VOICE`) against `validateEvenHubPageContainer()` and 576x288 bounds, alongside AI JSON parsing, voice routing, Telegram secret redaction, API config preservation, ICS parsing, PCM-to-WAV encoding, and controller event handling.
- Packages to `even-pulse.ehpk` via `@evenrealities/evenhub-cli pack app.json dist -o even-pulse.ehpk`, accompanied by `even-pulse-final.mp4`.
