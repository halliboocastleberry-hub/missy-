'use strict';
/**
 * Local persistent store.
 *
 * One JSON database file in the app's data folder, written atomically
 * (write temp file → rename) so a crash can never leave a half-written file.
 * Every collection lives behind this module, so it can be swapped for SQLite
 * or a cloud database later without touching the rest of Missy.
 */
const fs = require('fs');
const path = require('path');
const { id, nowISO } = require('./util');
const { PROJECTS, DEFAULT_SETTINGS } = require('./seed');

const SCHEMA_VERSION = 1;
const COLLECTIONS = ['projects', 'tasks', 'events', 'alerts', 'knowledge', 'log', 'scans'];

class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'missy-db.json');
    this.backupDir = path.join(dataDir, 'backups');
    this.exportDir = path.join(dataDir, 'exports');
    fs.mkdirSync(this.backupDir, { recursive: true });
    fs.mkdirSync(this.exportDir, { recursive: true });
    this.db = this._load();
  }

  _fresh() {
    const db = { schema: SCHEMA_VERSION, createdAt: nowISO(), settings: { ...DEFAULT_SETTINGS }, meta: {} };
    for (const c of COLLECTIONS) db[c] = [];
    db.projects = PROJECTS.map(p => ({ id: id('prj'), ...p, status: 'active', notes: '', createdAt: nowISO() }));
    db.knowledge.push({
      id: id('kn'), kind: 'decision', projectId: null, createdAt: nowISO(),
      text: 'Missy never presents simulated automation as completed real-world work.',
    });
    return db;
  }

  _load() {
    if (!fs.existsSync(this.file)) {
      const db = this._fresh();
      this._write(db);
      return db;
    }
    try {
      const db = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const c of COLLECTIONS) if (!Array.isArray(db[c])) db[c] = [];
      db.settings = { ...DEFAULT_SETTINGS, ...(db.settings || {}) };
      db.settings.team = {
        assistant: { ...DEFAULT_SETTINGS.team.assistant, ...((db.settings.team || {}).assistant || {}) },
        manager: { ...DEFAULT_SETTINGS.team.manager, ...((db.settings.team || {}).manager || {}) },
      };
      db.meta = db.meta || {};
      return db;
    } catch (err) {
      // Corrupt file: keep it for inspection, restore newest backup or start fresh.
      const bad = this.file + '.corrupt-' + Date.now();
      fs.renameSync(this.file, bad);
      const restored = this._newestBackup();
      const db = restored || this._fresh();
      db.meta = db.meta || {};
      db.meta.recoveredFrom = restored ? 'backup' : 'fresh';
      db.meta.corruptFile = bad;
      this._write(db);
      return db;
    }
  }

  _newestBackup() {
    const files = this.listBackups();
    for (const f of files) {
      try { return JSON.parse(fs.readFileSync(path.join(this.backupDir, f.name), 'utf8')); } catch { /* try older */ }
    }
    return null;
  }

  _write(db) {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, this.file);
  }

  save() { this._write(this.db); }

  // ---- generic collection helpers ----
  all(col) { return this.db[col]; }
  get(col, itemId) { return this.db[col].find(x => x.id === itemId) || null; }

  insert(col, item, prefix) {
    const rec = { id: id(prefix || col.slice(0, 3)), createdAt: nowISO(), ...item };
    this.db[col].push(rec);
    this.save();
    return rec;
  }

  update(col, itemId, patch) {
    const rec = this.get(col, itemId);
    if (!rec) return null;
    Object.assign(rec, patch, { updatedAt: nowISO() });
    this.save();
    return rec;
  }

  remove(col, itemId) {
    const before = this.db[col].length;
    this.db[col] = this.db[col].filter(x => x.id !== itemId);
    this.save();
    return this.db[col].length < before;
  }

  settings() { return this.db.settings; }
  updateSettings(patch) { Object.assign(this.db.settings, patch); this.save(); return this.db.settings; }
  meta() { return this.db.meta; }
  setMeta(patch) { Object.assign(this.db.meta, patch); this.save(); }

  // ---- log ----
  logAction(action, detail = '', extra = {}) {
    const entry = { id: id('log'), at: nowISO(), action, detail, ...extra };
    this.db.log.push(entry);
    if (this.db.log.length > 2000) this.db.log.splice(0, this.db.log.length - 2000);
    this.save();
    return entry;
  }

  // ---- integrity check (real check, used by the morning scan) ----
  integrityCheck() {
    const problems = [];
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      for (const c of COLLECTIONS) if (!Array.isArray(parsed[c])) problems.push(`Collection "${c}" missing`);
      const ids = new Set();
      for (const c of COLLECTIONS) for (const r of parsed[c]) {
        if (!r.id) problems.push(`Record without id in ${c}`);
        else if (ids.has(r.id)) problems.push(`Duplicate id ${r.id}`);
        ids.add(r.id);
      }
      const projectIds = new Set(parsed.projects.map(p => p.id));
      for (const t of parsed.tasks) if (t.projectId && !projectIds.has(t.projectId)) problems.push(`Task "${t.title}" points to a missing project`);
      // write-read round trip
      const probe = path.join(this.dataDir, '.probe');
      const token = String(Date.now());
      fs.writeFileSync(probe, token);
      if (fs.readFileSync(probe, 'utf8') !== token) problems.push('Disk write/read mismatch');
      fs.unlinkSync(probe);
    } catch (err) {
      problems.push(`Database unreadable: ${err.message}`);
    }
    return { ok: problems.length === 0, problems, sizeBytes: fs.existsSync(this.file) ? fs.statSync(this.file).size : 0 };
  }

  // ---- backups & export ----
  backup(reason = 'manual') {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const name = `missy-backup-${stamp}.json`;
    const full = path.join(this.backupDir, name);
    fs.writeFileSync(full, JSON.stringify(this.db, null, 2));
    // verify the copy actually parses before calling it a backup
    JSON.parse(fs.readFileSync(full, 'utf8'));
    const keep = this.db.settings.backupKeep || 14;
    const files = this.listBackups();
    for (const f of files.slice(keep)) fs.unlinkSync(path.join(this.backupDir, f.name));
    this.setMeta({ lastBackupAt: nowISO(), lastBackupFile: full });
    this.logAction('backup', `${reason} backup saved`, { file: full });
    return { file: full, at: this.db.meta.lastBackupAt };
  }

  listBackups() {
    if (!fs.existsSync(this.backupDir)) return [];
    return fs.readdirSync(this.backupDir)
      .filter(f => f.startsWith('missy-backup-') && f.endsWith('.json'))
      .map(name => ({ name, mtime: fs.statSync(path.join(this.backupDir, name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
  }

  exportAll() {
    const stamp = new Date().toISOString().slice(0, 10);
    const dir = path.join(this.exportDir, `missy-export-${stamp}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'missy-db.json'), JSON.stringify(this.db, null, 2));
    // plain, portable markdown copies too
    const p = id => (this.db.projects.find(x => x.id === id) || {}).name || 'General';
    const tasksMd = ['# Tasks', '', ...this.db.tasks.map(t => `- [${t.status === 'done' ? 'x' : ' '}] ${t.title} — ${p(t.projectId)}${t.due ? ` (due ${t.due.slice(0, 10)})` : ''}`)].join('\n');
    const knMd = ['# Knowledge', '', ...['decision', 'idea', 'archived'].flatMap(k => [`## ${k}`, ...this.db.knowledge.filter(x => x.kind === k).map(x => `- ${x.text}`), ''])].join('\n');
    fs.writeFileSync(path.join(dir, 'tasks.md'), tasksMd);
    fs.writeFileSync(path.join(dir, 'knowledge.md'), knMd);
    this.logAction('export', 'Full data export written', { dir });
    return { dir };
  }
}

module.exports = { Store, COLLECTIONS };
