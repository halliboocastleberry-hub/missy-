# Missy Central — v0.1 (Phase One prototype)

Private AI executive assistant and operations HQ for Halli S. Castleberry.
Runs entirely on your Mac. Costs nothing. Nothing leaves the computer.

---

## 1. Install (about 5 minutes)

1. **Install Node.js** (free): https://nodejs.org → download the **LTS** version → run the installer.
2. **Unzip** `missy-central.zip` somewhere you'll keep it, e.g. `~/Documents/missy-central`.
3. **Double-click `Start Missy.command`.**
   - First time only, macOS may say it's from an unidentified developer: right-click the file → **Open** → **Open**.
   - The first launch downloads Electron (the app shell, ~100 MB) once. After that it opens in seconds.
   - Prefer Terminal? `cd ~/Documents/missy-central && npm install && npm start`

Missy opens, runs her first morning scan, and speaks the briefing.

## 2. Tell me about your Mac (the only hardware info needed)

Open **⚙ Settings → This Mac**. Missy reads your chip, memory and free disk and tells you what local AI model fits. Send me those three lines (chip, memory, free disk) and I'll tune the defaults.

| Your Mac | Local AI | Voice model |
|---|---|---|
| Apple Silicon, 16 GB+ | `llama3.1:8b` | `small.en` |
| Apple Silicon, 8 GB | `llama3.2:3b` | `base.en` |
| Intel Mac | skip for now (Missy works without it) | `tiny.en` or Mac Dictation |

## 3. Optional free upgrades

**Push-to-talk voice (whisper, offline):**
```bash
# needs Homebrew: https://brew.sh
brew install whisper-cpp
mkdir -p ~/missy-models
curl -L -o ~/missy-models/ggml-base.en.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin
```
Restart Missy. The **MIC** chip turns green. Hold **Space** (or click the pink mic) and talk; let go to send.
Until then: click the message bar and use **Mac Dictation** (🎤 key or press Fn twice) — that already works.

**Open conversation & planning (Ollama, offline):**
1. Install from https://ollama.com/download
2. Terminal: `ollama pull llama3.2:3b` (or the model from the table above)
3. The **AI** chip turns green. Now Missy can brainstorm, disagree with you, and break goals into tasks.

## 3½. The look

Missy opens in the **Luxury Gallery** look: dark marble, gold trim, glass display-case panels and purple neon, with a **see-through glass brain** on a lit gold pedestal. Each glowing section of the brain carries one of your businesses — click a name to open its tasks. Lightning crackles off the brain when she's listening, thinking or talking.

Settings → **Look** and **Brain style** switch back to the earlier versions anytime (Neon HQ; solid neon or particle brain). Nothing old was deleted.

## 3¾. Your team: Missy & Miss Claudie

- **Missy** (Miss Essentials) — your executive assistant. Briefings, schedule, tasks, notes, reminders. She answers by default.
- **Miss Claudie** — the operations manager and Missy's boss. Priorities, approvals and anything critical; she's the one who says *"Ms. Castleberry, may I speak?"*. Start with **"Miss Claudie, …"** or **"Claudie, …"** to talk to her directly.

Each has her own voice (Missy: Samantha; Claudie: Karen — change in Settings → The team) and her own personality when the local AI is installed.

**Add their pictures:** click either gold frame under *The team* (or drag a picture onto it) and pick the image. It's cropped to a portrait and saved inside Missy.

## 4. Things to say

| Say | What happens |
|---|---|
| "Missy, catch me up" | Runs the 5-part operations scan and speaks the briefing |
| "What's on my plate today?" | Calendar + due + high-priority work |
| "What needs my attention?" | Critical alerts, approvals, overdue work |
| "Check SiteStyles" | Status of one business |
| "Add a task to update the template previews for SiteStyles due Friday" | Task with business + due date |
| "Schedule a client call tomorrow at 2" | Books it — and warns first if it conflicts |
| "Approve holiday collection" / "I finished the template previews" | Approvals and completions, logged |
| "Idea: gold foil quote series for Opulent Thoughts" | Parked as an idea (not approved) |
| "Decision: Opulent Thoughts posts twice a day" | Saved as an approved decision |
| "Add a business called Castle Travel Co" | Registers a new business — no code changes |
| "Plan a holiday promo for Opulent Thoughts" | (needs Ollama) proposes tasks, adds them on "yes" |
| "Back up" / "Export" | Verified backup / full export to a folder you own |
| "Go ahead, Missy" | Answers her "may I speak?" interruption |
| "Stop" or **Esc** | Stops her talking |

**Shortcuts:** hold Space = talk · ⌘K = type · Esc = quiet / close.

## 5. The status colors

- **Red** — critical. Animated border, notification, Missy asks *"Ms. Castleberry, may I speak?"*. It stays red until the danger is **marked contained** — acknowledging doesn't clear it. Security alerts skip the polite ask.
- **Yellow** — approvals, overdue work, noncritical errors.
- **Blue** — a backup or maintenance is running.
- **Green** — every *monitored* system is normal. Click the status pill to see exactly what is and isn't monitored.

Test it anytime: **Alerts → Simulate critical alert**. Simulations are labeled SIMULATION everywhere.

## 6. What is real vs. not connected yet (honest list)

**Really checked in v0.1:** Missy's database (integrity + disk write test), backups (auto-made and verified daily), tasks & deadlines, Missy's own calendar & conflicts, local AI status, voice setup.

**Not connected yet — reported as "Not checked", never as healthy:** SiteStyles store & orders, payments, customer inbox/CRM, social accounts, websites & hosting, Google/iCloud calendars.

**Runs while:** the Mac is awake and Missy is open (closing the window keeps her in the Dock, so reminders and backups continue). True 24/7 operation is Phase Four (cloud).

## 7. Where your data lives

`~/Library/Application Support/missy-central/data/`
- `missy-db.json` — everything (written atomically; auto-recovers from the newest backup if ever damaged)
- `backups/` — last 14 verified backups
- `exports/` — portable copies incl. `tasks.md` and `knowledge.md`

Settings → **Open data folder** takes you there. You own all of it.

## 8. How it's built (for you, your son, or the next Claude session)

```
src/main/main.js          Electron window, background scheduler (briefing, reminders, nightly backup)
src/main/preload.js       The only bridge between the interface and Missy
src/main/core/            Missy herself — no Electron code, so she can move to the cloud later
  missy.js                Command engine, intents, approvals, interruption protocol
  store.js                Local database, backups, export, integrity check (swap-ready for SQLite/cloud)
  briefing.js             Morning Operations Protocol (5 sections, real vs. not checked)
  alerts.js               Red/Yellow/Blue/Green lifecycle
  ai.js                   Ollama adapter + personality
  voice.js                macOS `say` + whisper.cpp
  when.js                 "tomorrow at 3" date parsing
  seed.js                 Business registry + default settings
src/renderer/
  presence/neon-brain.js  Glass + solid neon brain with lightning and business labels
  theme-gallery.css       Luxury Gallery look
  presence/brain.js       Classic particle brain. Every brain is replaceable: any avatar implementing
                          setState / setLevel / destroy drops in without touching Missy
  app.js, styles.css      Command center interface
tests/core.test.js        npm test — 19 checks on the core logic
tests/preview-server.js   npm run preview — browser preview at localhost:4747 (no Electron)
```

**Approval rules built in:** tasks mentioning publishing, payments, spending, deleting, deploying or security are flagged *Needs approval* automatically. Removing a calendar event with other people asks first. Every significant action is in the Log tab.

## 9. Next (Phase Two)

Google/iCloud calendar sync · recurring tasks · Opulent Thoughts content worker (120 posts in batches of 20, drafts only until approved) · development handoff generator for Claude/ChatGPT.
