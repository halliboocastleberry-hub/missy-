'use strict';
/**
 * Voice I/O.
 *  Speaking:  macOS built-in `say` (free, offline). Interruptible.
 *  Listening: push-to-talk audio → local whisper.cpp (free, offline) when installed.
 *             Without it, Mac Dictation into the command bar still works.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');

const WHISPER_CANDIDATES = ['/opt/homebrew/bin/whisper-cli', '/usr/local/bin/whisper-cli', '/opt/homebrew/bin/whisper-cpp', '/usr/local/bin/whisper-cpp'];
const MODEL_DIRS = [path.join(os.homedir(), 'missy-models'), '/opt/homebrew/share/whisper-cpp/models', '/usr/local/share/whisper-cpp/models'];

class Voice {
  constructor(store, emit) {
    this.store = store;
    this.emit = emit || (() => {});
    this.proc = null;
  }

  // ---------- speaking ----------
  speak(text, speaker = 'assistant') {
    const s = this.store.settings();
    const who = (s.team && s.team[speaker]) || {};
    const voiceName = who.voice !== undefined ? who.voice : s.voiceName;
    const voiceRate = who.rate || s.voiceRate;
    if (!s.spokenResponses || !text) return Promise.resolve(false);
    this.stop();
    const clean = String(text).replace(/[*_#`]/g, '').slice(0, 4000);
    if (process.platform !== 'darwin') {
      this.emit('voice:speaking', false);
      return Promise.resolve(false); // renderer falls back to speechSynthesis
    }
    return new Promise(resolve => {
      const args = [];
      if (voiceName) args.push('-v', voiceName);
      if (voiceRate) args.push('-r', String(voiceRate));
      args.push(clean);
      const p = spawn('say', args);
      this.proc = p;
      this.emit('voice:speaking', true);
      this.emit('voice:speaker', speaker);
      p.on('error', () => resolve(false));
      p.on('close', (code, signal) => {
        if (this.proc === p) { this.proc = null; this.emit('voice:speaking', false); }
        if (code !== 0 && !signal && voiceName) {
          // chosen voice isn't installed on this Mac — fall back to the system default
          if (s.team && s.team[speaker]) { s.team[speaker].voice = ''; this.store.save(); } else this.store.updateSettings({ voiceName: '' });
          return resolve(this.speak(text, speaker));
        }
        resolve(code === 0);
      });
    });
  }

  stop() {
    if (this.proc) { try { this.proc.kill(); } catch { /* already gone */ } this.proc = null; this.emit('voice:speaking', false); }
  }

  listVoices() {
    return new Promise(resolve => {
      if (process.platform !== 'darwin') return resolve([]);
      execFile('say', ['-v', '?'], (err, out) => {
        if (err) return resolve([]);
        resolve(String(out).split('\n').map(l => {
          const m = l.match(/^(.+?)\s{2,}([a-z]{2}[_-][A-Z]{2})/);
          return m ? { name: m[1].trim(), lang: m[2] } : null;
        }).filter(v => v && v.lang.startsWith('en')));
      });
    });
  }

  // ---------- listening ----------
  findWhisper() {
    const s = this.store.settings();
    const bin = [s.whisperBinary, ...WHISPER_CANDIDATES].find(p => p && fs.existsSync(p)) || null;
    let model = s.whisperModel && fs.existsSync(s.whisperModel.replace(/^~/, os.homedir())) ? s.whisperModel.replace(/^~/, os.homedir()) : null;
    if (!model) {
      for (const dir of MODEL_DIRS) {
        if (!fs.existsSync(dir)) continue;
        const f = fs.readdirSync(dir).filter(n => /^ggml-.*\.bin$/.test(n)).sort((a, b) => rank(a) - rank(b))[0];
        if (f) { model = path.join(dir, f); break; }
      }
    }
    return { bin, model, ready: Boolean(bin && model) };
  }

  /** wavBuffer: 16 kHz mono 16-bit PCM WAV produced by the renderer. */
  transcribe(wavBuffer) {
    const w = this.findWhisper();
    if (!w.ready) return Promise.resolve({ ok: false, error: 'whisper-not-installed' });
    const file = path.join(os.tmpdir(), `missy-${Date.now()}.wav`);
    fs.writeFileSync(file, Buffer.from(wavBuffer));
    return new Promise(resolve => {
      execFile(w.bin, ['-m', w.model, '-f', file, '-nt', '-l', 'en', '-t', String(Math.max(2, Math.min(8, os.cpus().length - 1)))],
        { timeout: 60000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
          fs.unlink(file, () => {});
          if (err) return resolve({ ok: false, error: err.message });
          const text = String(stdout).replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
          resolve({ ok: true, text });
        });
    });
  }
}

function rank(name) {
  // prefer English small > base > tiny; avoid huge models by default
  const order = ['small.en', 'base.en', 'small', 'base', 'tiny.en', 'tiny', 'medium.en', 'medium', 'large'];
  const i = order.findIndex(k => name.includes(`-${k}`));
  return i === -1 ? 99 : i;
}

module.exports = { Voice };
