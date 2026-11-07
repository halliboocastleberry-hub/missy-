'use strict';
/**
 * Optional local AI through Ollama (free, runs on the Mac).
 * Missy works without it — the command engine handles everyday requests —
 * and uses the model for open conversation, brainstorming and planning.
 */

const PERSONALITY = `You are Missy Central, the AI executive assistant and operations manager for Halli Castleberry,
a serial entrepreneur. Address her as "Ms. Castleberry" occasionally, not every sentence.
You are professional, warm, conversational, intelligent and occasionally witty.
You do not simply agree: when you see a better approach, say so and offer the alternative.
Your replies are spoken aloud, so keep them short (2-4 sentences), plain text, no markdown, no lists unless asked.
Never claim you did real-world work (sent, published, paid, checked a system) unless the context says it was done.
If something needs her approval (spending, publishing, deleting, security, irreversible changes), say it needs approval.`;

class AI {
  constructor(store) { this.store = store; this._model = null; }

  get url() { return this.store.settings().ollamaUrl || 'http://127.0.0.1:11434'; }

  async _fetch(pathname, body, timeoutMs = 60000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(this.url + pathname, {
        method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`Ollama ${res.status}`);
      return await res.json();
    } finally { clearTimeout(t); }
  }

  async status() {
    try {
      const tags = await this._fetch('/api/tags', null, 2500);
      const models = (tags.models || []).map(m => m.name);
      const wanted = this.store.settings().ollamaModel;
      this._model = wanted && models.includes(wanted) ? wanted : (models[0] || null);
      return { available: true, models, model: this._model, note: models.length ? '' : 'Ollama is running but no model is installed yet.' };
    } catch {
      this._model = null;
      return { available: false, models: [], model: null, note: 'Ollama is not running. Missy is using her built-in command engine.' };
    }
  }

  async chat(userText, context, history = [], persona = PERSONALITY) {
    const st = await this.status();
    if (!st.available || !st.model) return null;
    const messages = [
      { role: 'system', content: persona + '\n\nCurrent context:\n' + context },
      ...history.slice(-8),
      { role: 'user', content: userText },
    ];
    const out = await this._fetch('/api/chat', { model: st.model, messages, stream: false, options: { temperature: 0.7 } });
    return (out.message && out.message.content || '').trim();
  }

  /** Break a goal into concrete tasks. Returns [{title, priority}] or null. */
  async plan(goal, projectName) {
    const st = await this.status();
    if (!st.available || !st.model) return null;
    const prompt = `Break this goal into 3-7 concrete, actionable tasks for ${projectName || 'the business'}.
Goal: ${goal}
Respond ONLY with JSON: {"tasks":[{"title":"...","priority":"high|normal|low"}]}`;
    const out = await this._fetch('/api/chat', {
      model: st.model, stream: false, format: 'json',
      messages: [{ role: 'system', content: 'You are a precise project planner. Output JSON only.' }, { role: 'user', content: prompt }],
    });
    try {
      const parsed = JSON.parse(out.message.content);
      return (parsed.tasks || []).filter(t => t && t.title).slice(0, 10);
    } catch { return null; }
  }
}

const MANAGER_PERSONALITY = `You are Miss Claudie, operations manager of Halli Castleberry's AI team and Missy's boss.
Missy (Miss Essentials) is the assistant who handles the day-to-day; you handle oversight: priorities, approvals, risks, and holding work to a high standard.
You are sharp, confident, edgy and direct, with dry wit — bossy toward the team, but always respectful to Ms. Castleberry, who is the owner and final authority.
Give the bottom line first. Push back when an idea is weak and say what you'd do instead.
Your replies are spoken aloud: 2-4 sentences, plain text, no markdown.
Never claim real-world work was done unless the context says so. Spending, publishing, deleting, security and irreversible changes need Ms. Castleberry's approval.`;

module.exports = { AI, PERSONALITY, MANAGER_PERSONALITY };
