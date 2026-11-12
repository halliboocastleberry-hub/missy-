# Missy Central — Development Handoff (v0.3, Nov 12 2026)

Owner: Halli S. Castleberry · Repo: github.com/halliboocastleberry-hub/missy-
Read this first if you're another AI (ChatGPT, Claude) or a developer continuing the work.

## Ground rules from Halli
- **Don't rebuild or redesign.** The look (Luxury Gallery, glass neon brain, Missy + Miss Claudie portraits) is approved. Improve incrementally.
- **Never invent business information.** Missy only states what a live check or her own records show; unconnected systems are reported as "not checked".
- Free or lowest cost. No paid services without Halli's approval.
- Spending, publishing, deleting, security and irreversible actions always need her approval.
- Halli prefers talking over typing. Give her copy-paste steps as ONE block.

## How Missy runs today
**Chrome edition (main):** double-click `Start Missy.command` → runs `node src/web/server.js --open` → opens Chrome at http://localhost:4747. Needs only Node.js (installed on her Mac). Keep the Terminal window open while using her.
- Data: `~/Library/Application Support/missy-central/data/` (database, backups, `secrets.json`). Survives downloading new versions.
- The server listens on 127.0.0.1 only and rejects requests from other websites.

**Desktop (Electron) edition:** `npm install && npm run desktop`. Electron's download failed repeatedly on her Mac (npm blocked install scripts), so it's parked. Same core, same data folder.

## Architecture
```
src/main/core/       Missy herself (plain Node, no Electron) — everything important lives here
  missy.js           Entry: handle(text) → quick commands → AI agent → command-engine fallback
  agent.js           AI loop: model returns {"say","actions"}; Missy executes actions; lookups get a 2nd pass
  ai.js              Brain providers: Gemini (free tier) → Groq (free tier) → Ollama (local) → none. OpenAI-compatible.
                     Auto-discovers model IDs via /models (model names change often).
  connectors.js      Live checks: website (status/speed/title), GitHub (commits/issues), Stripe (read-only rk_ key)
  secrets.js         API keys in secrets.json (0600), never in backups/exports/UI/git
  briefing.js        Morning scan, includes live checks for connected businesses
  store.js           JSON database with atomic writes, backups, export, corruption recovery
  alerts.js          Red/yellow/blue/green status; red can't be cleared by acknowledging
  when.js            Natural dates ("tomorrow at 3", "friday 10:30am")
  voice.js           macOS `say` + whisper.cpp (desktop edition only)
src/web/server.js    Chrome edition server + background jobs (reminders, overdue, nightly backup)
src/main/main.js     Electron shell (desktop edition)
src/renderer/        Interface (app.js, styles.css, theme-gallery.css, presence/*.js brains, assets/ portraits)
tests/core.test.js   npm test — 24 checks, fake internet (no real network needed)
```

## Status
### Working (tested)
- Interface: gallery look, glass brain with business labels + lightning, team portraits, panels.
- Voice in Chrome: talks back (browser voices, cute pitch per character), listens via Chrome's built-in speech recognition (pink mic or hold Space), hands-free follow-up listening after she asks a question.
- Understanding: with an AI key she understands normal conversation and takes actions (tasks, calendar, ideas/decisions, approvals, business checks, briefing). Without a key, an improved command engine handles natural phrasing like "Missy, can you check on SiteStyles for me?".
- SiteStyles live check: sitestyles.net (up/down, speed, title, placeholder detection), GitHub repo `-site-styles` (currently EMPTY — reported honestly), Stripe sales (once a read-only key is added).
- Tasks, approvals, Missy's own calendar with conflict checks, reminders 15 min before events, overdue notices, ideas vs decisions memory, backups, export, morning briefing, color status, red-alert interruption protocol, Missy vs Miss Claudie routing ("Claudie, …").

### Needs Halli (setup, not code)
1. **Free Gemini key** → Settings ⚙ → Missy's AI brain → paste → Save (aistudio.google.com/apikey). Without it Missy can't hold real conversations.
2. **Stripe restricted key** (Charges + Balance = Read) → Settings → Business connections.
3. Allow the microphone in Chrome the first time.

### Not built / known gaps
- Not connected: email, social accounts, Google/iCloud calendar, Schedule Up, Opulent Thoughts, MBS Essentials, Creator Hub.
- SiteStyles code isn't in its GitHub repo yet (repo is empty) and sitestyles.net may not be live yet.
- Desktop (Electron) edition doesn't install on her Mac yet.
- Voice is Chrome's built-in voices; a custom/cloned voice (e.g. ElevenLabs ~$5/mo) needs approval.
- Missy runs only while her Mac is awake and the Terminal window is open (cloud = Phase Four).
- Ideas Halli asked for later: Mac file organizer (clean Desktop/Downloads, approval before moving), 2.5D/3D animated characters.

## Recommended next steps (in order)
1. Halli adds the Gemini key; test real conversation for a day and collect what Missy gets wrong.
2. **Connect Schedule Up** (Halli's priority — it has a real job). Its code is in another Claude chat; push it to GitHub, then add a `scheduleup` connector (read scheduled/failed posts) in `connectors.js` and an action in `agent.js`.
3. Push SiteStyles' code to `-site-styles` so Missy's GitHub check shows real progress; set up sitestyles.net.
4. Google Calendar read access (OAuth) so "what's on my plate" includes her real calendar.
5. Mac organizer feature (suggest-then-approve).
6. Fix the Electron edition, or package the Chrome edition as a Mac app.

## Adding a new connector (pattern)
1. In `connectors.js`, write `async function checkX(config, secrets)` returning `{ source, ok, level, summary }` from a live request only.
2. Call it from `checkProjectConnections` when `project.connections.x` is set.
3. Add the field to Settings → Business connections in `src/renderer/app.js` (`data-conn` inputs save automatically).
4. Add a fake response for it in `tests/core.test.js` and a test.
