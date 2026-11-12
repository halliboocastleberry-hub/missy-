'use strict';
/**
 * Missy's AI brain. Three free options, tried in this order when provider = "auto":
 *   1. Google Gemini free tier  (free key from aistudio.google.com — best quality, needs internet)
 *   2. Groq free tier           (free key from console.groq.com — very fast, needs internet)
 *   3. Ollama                   (free app, runs fully on the Mac, private — needs a capable Mac)
 * Gemini and Groq both speak the OpenAI-compatible chat format, so one adapter covers them.
 * Model names change often, so Missy asks each service which models it has instead of hard-coding.
 */

const PERSONALITY = `You are Missy (full name Miss Essentials), the AI executive assistant for Halli Castleberry,
a serial entrepreneur who runs several businesses. Call her "Ms. Castleberry" now and then, not every sentence.
You are warm, sharp, conversational and occasionally witty. You don't just agree: when you see a better approach, say so.
Your replies are spoken aloud: keep them short (1-3 sentences unless she asks for detail), plain text, no markdown, no lists.
Never claim you did real-world work (sent, published, paid, checked a system) unless a tool result says it happened.
If something needs her approval (spending, publishing, deleting, security, irreversible changes), say it needs approval.`;

const MANAGER_PERSONALITY = `You are Miss Claudie, operations manager of Halli Castleberry's AI team and Missy's boss.
Missy (Miss Essentials) is the assistant who handles the day-to-day; you handle oversight: priorities, approvals, risks, and holding work to a high standard.
You are sharp, confident, edgy and direct, with dry wit — bossy toward the team, but always respectful to Ms. Castleberry, who is the owner and final authority.
Give the bottom line first. Push back when an idea is weak and say what you'd do instead.
Your replies are spoken aloud: 1-3 sentences, plain text, no markdown.
Never claim real-world work was done unless a tool result says so. Spending, publishing, deleting, security and irreversible changes need Ms. Castleberry's approval.`;

const PROVIDERS = {
  gemini: { label: 'Gemini', base: 'https://generativelanguage.googleapis.com/v1beta/openai', key: 'geminiKey' },
  groq: { label: 'Groq', base: 'https://api.groq.com/openai/v1', key: 'groqKey' },
};

/** Pick the best general chat model from a provider's list. */
function chooseModel(provider, ids) {
  const usable = ids.filter(id => !/embed|tts|audio|image|vision-only|whisper|guard|moderation|aqa|imagen|veo|live|native-audio|computer-use|robotics/i.test(id));
  const version = id => { const m = id.match(/(\d+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : 0; };
  if (provider === 'gemini') {
    const flash = usable.filter(id => /gemini/i.test(id) && /flash/i.test(id) && !/lite|preview|exp|thinking/i.test(id));
    const pool = flash.length ? flash : usable.filter(id => /gemini/i.test(id) && /flash/i.test(id));
    return pool.sort((a, b) => version(b) - version(a))[0] || usable[0] || null;
  }
  if (provider === 'groq') {
    const prefs = [/gpt-oss-120b/, /llama-3\.3-70b/, /qwen.*\d{2}b/, /llama.*70b/, /gpt-oss/, /llama/];
    for (const re of prefs) { const hit = usable.find(id => re.test(id)); if (hit) return hit; }
    return usable[0] || null;
  }
  return usable[0] || null;
}

async function timedFetch(url, opts = {}, timeoutMs = 45000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

class AI {
  constructor(store, secrets) {
    this.store = store;
    this.secrets = secrets;
    this._cache = null;       // { at, status }
    this._lastError = '';
  }

  get ollamaUrl() { return this.store.settings().ollamaUrl || 'http://127.0.0.1:11434'; }

  // ---------------------------------------------------------------- discovery
  async _cloudModels(name) {
    const p = PROVIDERS[name];
    const key = this.secrets && this.secrets.get(p.key);
    if (!key) return { ok: false, note: `No ${p.label} key saved.` };
    try {
      const res = await timedFetch(`${p.base}/models`, { headers: { Authorization: `Bearer ${key}` } }, 8000);
      if (res.status === 401 || res.status === 403) return { ok: false, note: `${p.label} rejected the key (check it was copied fully).` };
      if (!res.ok) return { ok: false, note: `${p.label} answered ${res.status}.` };
      const j = await res.json();
      const ids = (j.data || []).map(m => String(m.id || '').replace(/^models\//, '')).filter(Boolean);
      return { ok: true, models: ids };
    } catch (err) {
      return { ok: false, note: `Couldn't reach ${p.label}: ${err.name === 'AbortError' ? 'timed out' : err.message}.` };
    }
  }

  async _ollamaModels() {
    try {
      const res = await timedFetch(this.ollamaUrl + '/api/tags', {}, 2500);
      if (!res.ok) return { ok: false, note: 'Ollama answered ' + res.status };
      const j = await res.json();
      const models = (j.models || []).map(m => m.name);
      return models.length ? { ok: true, models } : { ok: false, note: 'Ollama is running but has no model yet.' };
    } catch { return { ok: false, note: 'Ollama is not running.' }; }
  }

  /** Which brain Missy will use right now. Cached for a minute. */
  async status(force = false) {
    if (!force && this._cache && Date.now() - this._cache.at < 60000) return this._cache.status;
    const s = this.store.settings();
    const want = (s.ai && s.ai.provider) || 'auto';
    const order = want === 'auto' ? ['gemini', 'groq', 'ollama'] : [want];
    const notes = [];
    let status = { available: false, provider: null, label: 'Commands only', model: null, models: [] };
    if (want !== 'off') {
      for (const name of order) {
        const r = name === 'ollama' ? await this._ollamaModels() : await this._cloudModels(name);
        if (!r.ok) { notes.push(r.note); continue; }
        const pinned = (s.ai && s.ai.model) || (name === 'ollama' ? s.ollamaModel : '');
        const model = pinned && r.models.includes(pinned) ? pinned : chooseModel(name, r.models);
        if (!model) { notes.push(`${name}: no usable model`); continue; }
        status = { available: true, provider: name, label: name === 'ollama' ? 'Ollama (on this Mac)' : PROVIDERS[name].label, model, models: r.models };
        break;
      }
    }
    status.note = status.available ? '' : (want === 'off' ? 'AI is switched off in Settings.' : (notes.join(' ') || 'No AI brain set up yet.'));
    status.lastError = this._lastError;
    this._cache = { at: Date.now(), status };
    return status;
  }

  invalidate() { this._cache = null; }

  // ---------------------------------------------------------------- talking
  /** messages: [{role, content}] → text. json=true asks for a JSON object back. */
  async complete(messages, { json = false, temperature = 0.6, timeoutMs = 45000 } = {}) {
    const st = await this.status();
    if (!st.available) return null;
    try {
      let text;
      if (st.provider === 'ollama') {
        const res = await timedFetch(this.ollamaUrl + '/api/chat', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: st.model, messages, stream: false, format: json ? 'json' : undefined, options: { temperature } }),
        }, Math.max(timeoutMs, 90000));
        if (!res.ok) throw new Error('Ollama ' + res.status);
        const j = await res.json();
        text = j.message && j.message.content;
      } else {
        const p = PROVIDERS[st.provider];
        const body = { model: st.model, messages, temperature };
        if (json) body.response_format = { type: 'json_object' };
        let res = await timedFetch(`${p.base}/chat/completions`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.secrets.get(p.key)}` }, body: JSON.stringify(body),
        }, timeoutMs);
        if (res.status === 400 && json) { // some models don't take response_format — retry without it
          delete body.response_format;
          res = await timedFetch(`${p.base}/chat/completions`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.secrets.get(p.key)}` }, body: JSON.stringify(body),
          }, timeoutMs);
        }
        if (res.status === 429) throw new Error(`${p.label} free-tier limit reached for now`);
        if (!res.ok) throw new Error(`${p.label} ${res.status}: ${(await res.text()).slice(0, 160)}`);
        const j = await res.json();
        text = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      }
      this._lastError = '';
      return (text || '').trim();
    } catch (err) {
      this._lastError = err.name === 'AbortError' ? 'The AI took too long to answer.' : err.message;
      this.invalidate();
      throw new Error(this._lastError);
    }
  }

  /** Plain conversation (kept for older callers). */
  async chat(userText, context, history = [], persona = PERSONALITY) {
    return this.complete([
      { role: 'system', content: persona + '\n\nCurrent context:\n' + context },
      ...history.slice(-8),
      { role: 'user', content: userText },
    ]).catch(() => null);
  }

  /** Break a goal into concrete tasks. Returns [{title, priority}] or null. */
  async plan(goal, projectName) {
    const out = await this.complete([
      { role: 'system', content: 'You are a precise project planner. Output JSON only.' },
      { role: 'user', content: `Break this goal into 3-7 concrete, actionable tasks for ${projectName || 'the business'}.\nGoal: ${goal}\nRespond ONLY with JSON: {"tasks":[{"title":"...","priority":"high|normal|low"}]}` },
    ], { json: true }).catch(() => null);
    const parsed = parseJSON(out);
    return parsed && Array.isArray(parsed.tasks) ? parsed.tasks.filter(t => t && t.title).slice(0, 10) : null;
  }
}

/** Lenient JSON reader: handles code fences or chatter around the object. */
function parseJSON(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { /* fall through */ }
  const m = String(text).match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* give up */ } }
  return null;
}

module.exports = { AI, PERSONALITY, MANAGER_PERSONALITY, PROVIDERS, chooseModel, parseJSON };
