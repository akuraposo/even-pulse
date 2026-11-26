# DoraHacks BUIDL submission: EvenPulse AI

Submission text for the Heads Up: Even Realities Hackathon on DoraHacks.

### Project name
EvenPulse AI

### One-line tagline
Telegram and work assistant for Even Realities G2 and R1 Ring that triages chats, sends 1-tap AI replies, and tracks tasks without reaching for your phone.

### Selected tracks
- Track 01: Messaging and News
- Track 04: AI Assistants and Work
- Special Bounty: Best Telegram Integration ($1,000)

### Problem
Checking active Telegram chats during meetings forces people to pull out their phone repeatedly to find urgent messages, send short replies, or note follow-up tasks. Raw notification mirroring crowds a 576x288 monochrome display with multi-paragraph text and still gives you no way to respond.

### Solution
EvenPulse filters Telegram threads on the server and sends short, interactive cards to the Even Realities G2 waveguide display and R1 Ring.

The server scores incoming messages as `P0`, `P1`, or `P2`, shortens each summary to 44 characters or fewer, and applies SDK `textColor` levels (1 to 4) for contrast. You scroll through items with the glasses temple touchpad or R1 Ring. One tap opens the summary and three short reply drafts; a second tap sends the selected draft back to Telegram.

Long-pressing the temple or ring activates `bridge.audioControl(true, AudioInputSource.Glasses)`, records 16 kHz mono PCM audio as a WAV payload, and routes the command (with Web Speech fallback in desktop browsers). Spoken commands handle actions such as `"Reply to Alex that I am joining in 5 minutes"` or `"Add task to review Q4 deck"`.

Double-tapping opens the AI Work Brief with your next synced `.ics` calendar meeting and open tasks that you can check off from the glasses. Sending `/start` in Telegram pairs your chat ID and returns inline buttons (`Work Brief`, `Push P0 Alert to G2`, `Open Tasks`), while `/urgent`, `/task`, and `/brief` work from chat in both directions.

### Technical details
- Built on `@evenrealities/even_hub_sdk` (`v0.0.16`) using `createStartUpPageContainer`, `rebuildPageContainer`, `MenuContainerProperty`, `audioControl`, `getDeviceInfo` / `onDeviceStatusChanged`, and `EventSourceType` (Glasses R vs. R1 Ring).
- Express bridge (`server/`) keeps Telegram Bot API tokens and OpenRouter/Gemini/OpenAI keys out of the frontend bundle, checks `.ics` calendar URLs against private and local IP ranges, and stores messages, tasks, and meeting prep in `data/state.json`.
- 19 Vitest checks validate all five HUD views (`INBOX`, `MESSAGE`, `BRIEF`, `DIGEST`, `VOICE`) against `validateEvenHubPageContainer()` and 576x288 pixel bounds, alongside AI JSON parsing, voice routing, Telegram token redaction, API config preservation, ICS parsing, PCM-to-WAV encoding, and controller events.
- `npm run pack` packages the build via `@evenrealities/evenhub-cli pack app.json dist -o even-pulse.ehpk`, paired with the demo video `even-pulse-final.mp4` (`1920x1080` at `60 fps`, cover `thumbnail.png`).

### Links and builder contact
- GitHub Repository: https://github.com/akuraposo/even-pulse
- Builder X / Twitter: [@balapanmlayu](https://x.com/balapanmlayu)
- Telegram Contact: [@akuraposo](https://t.me/akuraposo)
- Demo Bot: `@evenpulse_bot`
