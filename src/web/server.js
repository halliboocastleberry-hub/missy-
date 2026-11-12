'use strict';
/**
 * Missy Central — Chrome edition (the main way to run Missy right now).
 * Runs Missy's real core on your Mac and serves her interface to Chrome at http://localhost:4747.
 * Needs only Node.js — no Electron download.
 *
 *   node src/web/server.js --open      (what "Start Missy.command" runs)
 *
 * Privacy: listens on 127.0.0.1 only, so nothing else on your Wi-Fi can reach her.
 * Data: ~/Library/Application Support/missy-central/data (same folder the desktop app uses),
 *       so downloading a new version of Missy never loses your tasks, calendar or keys.
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { Missy } = require('../main/core/missy');

const PORT = Number(process.env.PORT || 4747);
const HOST = '127.0.0.1';
const URL = `http://localhost:${PORT}`;
const root = path.join(__dirname, '..', 'renderer');
const projectRoot = path.join(__dirname, '..', '..');

function defaultDataDir() {
  if (process.env.MISSY_DATA) return process.env.MISSY_DATA;
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'missy-central', 'data');
  return path.join(os.homedir(), '.missy-central', 'data');
}
const dataDir = defaultDataDir();

// One-time move: earlier versions kept data inside the download folder (.preview-data).
(function migrateOldData() {
  const old = path.join(projectRoot, '.preview-data', 'missy-db.json');
  const target = path.join(dataDir, 'missy-db.json');
  if (!process.env.MISSY_DATA && fs.existsSync(old) && !fs.existsSync(target)) {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.copyFileSync(old, target);
    console.log('Moved your earlier Missy data to', dataDir);
  }
})();

function openBrowser() {
  if (process.platform !== 'darwin') return console.log(`Open ${URL} in Chrome.`);
  // Chrome gives the best voice recognition; fall back to the default browser.
  execFile('open', ['-a', 'Google Chrome', URL], err => { if (err) execFile('open', [URL], () => {}); });
}

const clients = new Set();
const emit = (channel, payload) => {
  const msg = `data: ${JSON.stringify({ channel, payload })}\n\n`;
  clients.forEach(c => { try { c.write(msg); } catch { clients.delete(c); } });
};

const missy = new Missy(dataDir, emit);
missy.voice.speak = async () => false; // Chrome does the speaking in this edition
missy.store.logAction('startup', 'Missy Central started (Chrome edition)');

const SHIM = `
window.missy = (function(){
  const call = (m, ...args) => fetch('/api/' + m, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(args) })
    .then(async r => { const j = await r.json().catch(() => null); if (!r.ok) throw new Error((j && j.error) || ('Missy server error ' + r.status)); return j; });
  return {
    nativeSpeech: false, edition: 'chrome',
    snapshot: () => call('snapshot'), ask: t => call('ask', t), speak: () => Promise.resolve(false), stopSpeaking: () => Promise.resolve(),
    briefing: () => call('briefing'), shouldBrief: () => call('shouldBrief'), startupBriefing: () => call('startupBriefing'),
    action: (n, a) => call('action', n, a), transcribe: () => Promise.resolve({ ok:false, error:'chrome' }), micPermission: () => Promise.resolve(true),
    openDataFolder: () => call('openDataFolder'), openUrl: u => window.open(u, '_blank'),
    on: h => { const es = new EventSource('/events'); es.onmessage = e => { const m = JSON.parse(e.data); h(m.channel, m.payload); }; return () => es.close(); },
  };
})();`;

const handlers = {
  snapshot: () => missy.snapshot(),
  ask: t => missy.handle(t),
  briefing: () => missy.morningBriefing('manual'),
  shouldBrief: () => missy.shouldAutoBrief(),
  startupBriefing: () => missy.morningBriefing('morning'),
  action: (n, a) => missy.action(n, a),
  openDataFolder: () => { if (process.platform === 'darwin') execFile('open', [dataDir], () => {}); return dataDir; },
};

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

const server = http.createServer(async (req, res) => {
  try {
    // Only pages Missy serves herself may call her (blocks other websites from poking at localhost).
    const origin = req.headers.origin;
    if (origin && !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) { res.writeHead(403); return res.end('forbidden'); }

    if (req.url === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(': connected\n\n');
      clients.add(res); req.on('close', () => clients.delete(res)); return;
    }
    if (req.url.startsWith('/api/')) {
      if (req.method !== 'POST') { res.writeHead(405); return res.end('{}'); }
      const name = req.url.slice(5);
      let body = ''; for await (const chunk of req) body += chunk;
      const args = body ? JSON.parse(body) : [];
      if (!handlers[name]) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end('{"error":"unknown"}'); }
      try {
        const out = await handlers[name](...args);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(out ?? null));
      } catch (err) {
        missy.store.logAction('automation-failed', `${name}: ${err.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: err.message }));
      }
    }
    if (req.url === '/shim.js') { res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' }); return res.end(SHIM); }
    let file = path.normalize(path.join(root, decodeURIComponent(req.url.split('?')[0])));
    if (req.url === '/' || req.url.startsWith('/?')) file = path.join(root, 'index.html');
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    let content = fs.readFileSync(file);
    if (file.endsWith('index.html')) content = String(content).replace('<script src="presence/brain.js">', '<script src="/shim.js"></script>\n  <script src="presence/brain.js">');
    // no-store: a new download of Missy always shows up without a hard refresh
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(content);
  } catch (err) {
    res.writeHead(500); res.end(String(err && err.message));
  }
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.log(`Missy is already running. Opening ${URL} …`);
    if (process.argv.includes('--open')) openBrowser();
    setTimeout(() => process.exit(0), 500);
  } else { console.error(err); process.exit(1); }
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  ✨ Missy Central is running →', URL);
  console.log('  Keep this window open while you use her. Close it (or press Control+C) to stop her.');
  console.log('  Your data:', dataDir);
  console.log('');
  if (process.argv.includes('--open')) openBrowser();
});

// ---- background jobs while she's running: event reminders, overdue notices, nightly backup ----
setInterval(async () => {
  try {
    const now = new Date();
    for (const e of missy.store.all('events')) {
      const mins = (new Date(e.start) - now) / 60000;
      if (mins > 0 && mins <= 15 && !e.reminded) {
        missy.store.update('events', e.id, { reminded: true });
        emit('missy:say', { text: `${missy.store.settings().addressAs}, ${e.title} starts in ${Math.round(mins)} minutes.`, speaker: 'assistant' });
      }
    }
    for (const t of missy.store.all('tasks')) {
      if (t.due && t.status !== 'done' && t.status !== 'archived' && new Date(t.due) < now && !t.overdueNotified) {
        missy.store.update('tasks', t.id, { overdueNotified: true });
        emit('missy:say', { text: `"${t.title}" is now overdue.`, speaker: 'assistant' });
      }
    }
    const last = missy.store.meta().lastBackupAt;
    if (!last || now - new Date(last) > 24 * 36e5) missy.store.backup('nightly');
    emit('status', missy.alerts.status());
  } catch (err) { missy.store.logAction('automation-failed', `Scheduler: ${err.message}`); }
}, 60 * 1000);

module.exports = { server, missy };
