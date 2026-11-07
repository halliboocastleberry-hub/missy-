'use strict';
/**
 * Browser preview of Missy Central without Electron:
 *   npm run preview  →  open http://localhost:4747
 * Uses the real core (same database code) with browser speech instead of macOS `say`.
 * Data lives in ./.preview-data so it never touches the real app's data.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Missy } = require('../src/main/core/missy');

const PORT = Number(process.env.PORT || 4747);
const root = path.join(__dirname, '..', 'src', 'renderer');
const dataDir = process.env.MISSY_DATA || path.join(__dirname, '..', '.preview-data');
const clients = new Set();
const emit = (channel, payload) => { const msg = `data: ${JSON.stringify({ channel, payload })}\n\n`; clients.forEach(c => c.write(msg)); };
const missy = new Missy(dataDir, emit);
missy.voice.speak = async () => false; // the browser speaks in preview mode

const SHIM = `
window.missy = (function(){
  const call = (m, ...args) => fetch('/api/' + m, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(args) }).then(r => r.json());
  return {
    nativeSpeech: false,
    snapshot: () => call('snapshot'), ask: t => call('ask', t), speak: () => Promise.resolve(false), stopSpeaking: () => Promise.resolve(),
    briefing: () => call('briefing'), shouldBrief: () => call('shouldBrief'), startupBriefing: () => call('startupBriefing'),
    action: (n, a) => call('action', n, a), transcribe: () => Promise.resolve({ ok:false, error:'preview' }), micPermission: () => Promise.resolve(true),
    openDataFolder: () => {}, openUrl: u => window.open(u),
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
};

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

http.createServer(async (req, res) => {
  try {
    if (req.url === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      clients.add(res); req.on('close', () => clients.delete(res)); return;
    }
    if (req.url.startsWith('/api/')) {
      const name = req.url.slice(5);
      let body = ''; for await (const chunk of req) body += chunk;
      const args = body ? JSON.parse(body) : [];
      if (!handlers[name]) { res.writeHead(404); return res.end('{}'); }
      const out = await handlers[name](...args);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(out ?? null));
    }
    if (req.url === '/shim.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(SHIM); }
    let file = path.join(root, decodeURIComponent(req.url.split('?')[0]));
    if (req.url === '/' ) file = path.join(root, 'index.html');
    if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
    let content = fs.readFileSync(file);
    if (file.endsWith('index.html')) content = String(content).replace('<script src="presence/brain.js">', '<script src="/shim.js"></script>\n  <script src="presence/brain.js">');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(content);
  } catch (err) {
    res.writeHead(500); res.end(String(err && err.message));
  }
}).listen(PORT, () => console.log(`Missy Central preview → http://localhost:${PORT}`));
