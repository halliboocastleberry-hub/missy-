'use strict';
/**
 * API keys live in their own file next to the database (secrets.json, owner-only permissions).
 * They are never included in backups, exports, the interface, logs, or GitHub.
 */
const fs = require('fs');
const path = require('path');

const KNOWN = ['geminiKey', 'groqKey', 'stripeKey', 'githubToken'];

class Secrets {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'secrets.json');
    this.data = {};
    try { this.data = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { this.data = {}; }
  }
  get(k) { return (this.data[k] || '').trim(); }
  has(k) { return Boolean(this.get(k)); }
  set(k, v) {
    if (!KNOWN.includes(k)) throw new Error('Unknown key ' + k);
    if (v) this.data[k] = String(v).trim(); else delete this.data[k];
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    try { fs.chmodSync(this.file, 0o600); } catch { /* best effort */ }
  }
  /** What the interface may know: which keys are saved, never their values. */
  summary() { return Object.fromEntries(KNOWN.map(k => [k, this.has(k) ? 'saved …' + this.get(k).slice(-4) : ''])); }
}

module.exports = { Secrets, KNOWN };
