# EvenPulse Demo Video Script

Shot list for `even-pulse-demo.mp4` (`1920x1080`, 30 fps) recorded with the companion UI at `http://localhost:5173` and a paired Telegram bot (`@evenpulse_bot` or a custom `@BotFather` bot).

## Scene 1 (0:00 - 0:11): Inbox triage on the 576x288 display

Show the EvenPulse companion view with the Even G2 right-eye waveguide mirror on `INBOX`, displaying triaged `[P0]`, `[P1]`, and `[P2]` Telegram messages. Send a real Telegram message or click `+ Simulate Urgent TG` to move a `[P0]` alert to the top row in four-level green contrast (`textColor` 1 to 4).

## Scene 2 (0:11 - 0:25): Two-tap AI reply to live Telegram

Click `● Tap` on the urgent message to open `MESSAGE`, displaying the 44-character summary and three AI reply drafts. Select `↳ Approve Ship` and click `◎ R1 Ring Tap` to deliver the reply through Telegram `sendMessage` and display the confirmation toast in the HUD footer.

## Scene 3 (0:25 - 0:42): Voice command and Work Brief checkoff

Press `🎙 Hold / Speak` or run the preset `"Add task to submit EvenPulse to DoraHacks before Sunday"` to switch to `VOICE` and log `Task Added to Brief`. Click `●● 2× Tap` to open `BRIEF`, showing the next meeting countdown and updated task list, then tap an item to toggle `[x]` alongside the `AI Work Brief & Tasks` panel.

## Scene 4 (0:42 - 0:57): Telegram slash commands, OS menu, and SDK telemetry

Show the `/start` confirmation message in Telegram with inline buttons (`Work Brief`, `Push P0 Alert to G2`, `Open Tasks`), plus `/urgent` and `/brief`. Switch back to the companion UI, trigger `☰ OS Menu` or `↗ Send Brief to TG`, and open the `SDK Telemetry` tab showing `createStartUpPageContainer`, `rebuildPageContainer`, and `validateEvenHubPageContainer` events.
