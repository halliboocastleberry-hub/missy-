'use strict';
/**
 * Missy's brain (the assistant itself), independent of any interface.
 * The 3D brain, a future avatar, or a phone app all talk to this same class.
 */
const { Store } = require('./store');
const { Alerts } = require('./alerts');
const { AI, PERSONALITY, MANAGER_PERSONALITY } = require('./ai');
const { Voice } = require('./voice');
const { runScan, overlaps } = require('./briefing');
const { parseWhen } = require('./when');
const { findProject, stripProject, slug } = require('./projects');
const { hardwareReport } = require('./system');
const { Secrets } = require('./secrets');
const { runAgent } = require('./agent');
const { checkProjectConnections } = require('./connectors');
const { nowISO, startOfDay, endOfDay, fmtTime, fmtDay, spokenCount, dayKey } = require('./util');

const APPROVAL_WORDS = /\b(publish|post live|pay|payment|purchase|buy|spend|refund|delete|remove all|deploy|production|launch|change (the )?password|permission|security)\b/i;

class Missy {
  constructor(dataDir, emit) {
    this.emit = emit || (() => {});
    this.store = new Store(dataDir);
    this.alerts = new Alerts(this.store, (ch, p) => this._onAlertEvent(ch, p));
    this.secrets = new Secrets(dataDir);
    this.ai = new AI(this.store, this.secrets);
    this.voice = new Voice(this.store, this.emit);
    this.pendingAction = null;   // something Missy proposed and is waiting on a yes for
    this.pendingInterrupt = null; // red alert waiting for "Go ahead, Missy"
    this.history = [];            // short conversational memory for the AI
    this._ensureDemoFree();
    this._ensureConnections();
  }

  /** Give SiteStyles its known live sources once (she can change them in Settings → Connections). */
  _ensureConnections() {
    if (this.store.meta().seededConnections) return;
    const ss = this.store.all('projects').find(p => p.key === 'sitestyles');
    if (ss && !ss.connections) {
      ss.connections = { website: 'https://sitestyles.net', github: 'halliboocastleberry-hub/-site-styles', stripe: true };
      ss.aliases = Array.from(new Set([...(ss.aliases || []), 'site styles', 'site style', 'sight styles']));
    }
    this.store.setMeta({ seededConnections: true });
  }

  _ensureDemoFree() {
    // Starter tasks so the dashboard isn't empty on day one — real tasks, clearly hers to edit or delete.
    if (this.store.meta().seededStarterTasks) return;
    const p = key => (this.store.all('projects').find(x => x.key === key) || {}).id || null;
    const starter = [
      { title: 'Add a free Gemini key so Missy understands conversation (Settings → Missy\'s AI brain)', projectId: null, priority: 'high' },
      { title: 'Connect Stripe (read-only) so Missy can see SiteStyles sales', projectId: null, priority: 'normal' },
      { title: 'Write the Opulent Thoughts brand voice guide', projectId: p('opulent-thoughts'), priority: 'high' },
      { title: 'Plan first 20 Opulent Thoughts posts (batch 1 of 6)', projectId: p('opulent-thoughts'), priority: 'normal' },
    ];
    for (const t of starter) this.store.insert('tasks', { status: 'todo', needsApproval: false, due: null, ...t }, 'tsk');
    this.store.setMeta({ seededStarterTasks: true });
  }

  _onAlertEvent(channel, payload) {
    this.emit(channel, payload);
    if (channel === 'alert:new' && payload.level === 'red') {
      const s = this.store.settings();
      if (payload.security) {
        // immediate safety/security risk — concise alert without waiting
        const msg = `${s.addressAs}, urgent: ${payload.title}.${payload.simulated ? ' This is a simulation.' : ''}`;
        this.emit('missy:say', { text: msg, urgent: true, speaker: 'manager' });
        this.voice.speak(msg, 'manager');
      } else {
        this.pendingInterrupt = payload.id;
        const msg = `${s.addressAs}, may I speak? I have something important to report.`;
        this.emit('missy:say', { text: msg, urgent: true, awaiting: 'go-ahead', speaker: 'manager' });
        this.voice.speak(msg, 'manager');
      }
    }
  }

  // ------------------------------------------------------------------ state for the UI
  snapshot() {
    const st = this.store;
    return {
      settings: st.settings(),
      projects: st.all('projects'),
      tasks: st.all('tasks'),
      events: st.all('events'),
      alerts: st.all('alerts'),
      knowledge: st.all('knowledge'),
      stickies: st.all('stickies'),
      log: st.all('log').slice(-200).reverse(),
      lastScan: st.all('scans').slice(-1)[0] || null,
      status: this.alerts.status(),
      meta: st.meta(),
      pendingAction: this.pendingAction ? { summary: this.pendingAction.summary } : null,
      secrets: this.secrets.summary(),
    };
  }

  changed() { this.emit('data:changed', this.snapshot()); }

  // ------------------------------------------------------------------ morning protocol
  shouldAutoBrief() {
    const s = this.store.settings();
    return s.autoBriefing && this.store.meta().lastBriefingDay !== dayKey();
  }

  async morningBriefing(reason = 'morning') {
    this.emit('missy:state', 'processing');
    const scan = await runScan({ store: this.store, alerts: this.alerts, ai: this.ai, voice: this.voice, reason });
    this.changed();
    this.emit('missy:state', 'idle');
    return { text: scan.spoken, scan, speak: this.store.settings().spokenBriefing, speaker: 'assistant' };
  }

  // ------------------------------------------------------------------ main entry point
  async handle(rawText) {
    const text = String(rawText || '').trim();
    if (!text) return this._reply('I\'m listening.');
    this.store.logAction('heard', text);
    this.emit('missy:state', 'processing');
    let reply;
    this._speaker = this.addressee(text);
    try {
      reply = await this._route(text);
      if (this._aiFailNote) { reply.text = this._aiFailNote + reply.text; this._aiFailNote = ''; }
    } catch (err) {
      this.store.logAction('automation-failed', `Command failed: ${err.message}`);
      reply = this._reply(`Something went wrong on my side: ${err.message}. I've logged it.`);
    }
    this.history.push({ role: 'user', content: text }, { role: 'assistant', content: reply.text });
    if (this.history.length > 16) this.history.splice(0, this.history.length - 16);
    this.store.logAction('said', reply.text);
    this.changed();
    this.emit('missy:state', 'idle');
    return reply;
  }

  _reply(text, extra = {}) { return { text, speak: true, speaker: this._speaker || 'assistant', ...extra }; }

  /** Who she's talking to: "Miss Claudie, …" / "Claudie, …" → manager; otherwise Missy. */
  addressee(text) {
    return /^\s*(hey |ok |okay )?(miss |ms\.? )?claud(ie|y|i)\b/i.test(text) ? 'manager' : 'assistant';
  }
  teamName(role) { const t = this.store.settings().team || {}; return (t[role] && t[role].name) || (role === 'manager' ? 'Miss Claudie' : 'Missy'); }

  async _route(original) {
    const t = normalize(original);
    const s = this.store.settings();

    // Interruption protocol
    if (/^(go ahead|yes go ahead|go on|what is it|what's wrong)\b/.test(t) && this.pendingInterrupt) return this._explainInterrupt();
    if (/^(stop|quiet|be quiet|hush|stop talking|cancel)$/.test(t)) { this.voice.stop(); this.pendingAction = null; return { text: 'Okay.', speak: false }; }

    // Confirmations for a pending proposal
    if (this.pendingAction && /^(yes|yeah|yep|do it|confirm|book it( anyway)?|go for it|add them|sounds good|handle (that|it)|please do)\b/.test(t)) {
      const act = this.pendingAction; this.pendingAction = null;
      return act.run();
    }
    if (this.pendingAction && /^(no|nope|don't|never ?mind|skip it)\b/.test(t)) { this.pendingAction = null; return this._reply('Okay, I won\'t.'); }
    if (/^handle (that|it)$/.test(t)) return this._reply('There\'s nothing waiting on my end right now. Tell me what you\'d like handled and I\'ll take it from there.');

    // Stickies are local, deterministic actions: they work even with AI unavailable.
    // A voice request must be explicit before Missy writes any sticky.
    const plain = original.replace(/^\s*(?:hey\s+)?missy[,! ]*\s*/i, '').trim();
    const stickyCreate = plain.match(/^(?:pin|add|make|create)\s+(?:(?:a|new)\s+)?(?:sticky|sticky note)(?:\s+(?:saying|that says|for))?\s*[:,-]?\s*(.+)$/i);
    if (stickyCreate) {
      const note = stickyCreate[1].trim();
      if (!note) return this._reply('What should the sticky say?');
      const result = await this.action('sticky:add', { text: note, scope: 'general' });
      return this._reply(`Pinned your sticky: "${result.text}".`, { panel: 'stickies' });
    }
    if (/^(?:read|show|list|what are)\s+(?:me\s+)?(?:my\s+)?(?:pinned\s+)?(?:sticky notes|stickies)$/i.test(plain)) {
      const notes = this.store.all('stickies').filter(x => !x.archived && x.pinned && !x.done);
      return this._reply(notes.length ? 'Your stickies: ' + notes.map(x => x.text).join('; ') : 'You have no open pinned stickies.', { panel: 'stickies' });
    }

    // With an AI brain, everything except instant commands goes to her — she understands normal speech
    // and decides which actions to take. If the AI fails, the command engine below still runs.
    const quick = /^(catch me up|morning briefing|briefing|run (a |the )?(system )?scan|help|what can you do|back ?up|backup|export)$/.test(t);
    const ai = await this.ai.status();
    if (ai.available && !quick) {
      try { return await runAgent(this, original); }
      catch (err) {
        this.store.logAction('automation-failed', `AI: ${err.message}`);
        this._aiFailNote = `(My AI brain had a problem: ${err.message}. I used my basic commands instead.) `;
      }
    }

    if (/\b(catch me up|morning briefing|briefing|run (a |the )?(system )?scan|system scan|status report)\b/.test(t)) {
      const r = await this.morningBriefing('manual');
      return this._reply(r.text, { panel: 'briefing' });
    }
    if (/\b(on my plate|my day|what do i have|what's today|today's schedule|agenda)\b/.test(t)) return this._today();
    if (/\b(needs? my attention|what's urgent|anything urgent|what should i (look at|worry about))\b/.test(t)) return this._attention();

    let m;
    if ((m = t.match(/^(?:add|create|register) (?:a |new )?(?:business|project|brand) (?:called |named )?(.+)$/))) return this._addProject(m[1]);
    if ((m = t.match(/^(?:check|how(?:'s| is)|status (?:of|on)|update on) (.+)$/)) && findProject(this.store.all('projects'), m[1])) return this._checkProject(m[1]);
    // Any sentence that names a business and asks about it ("what's going on with SiteStyles?")
    if (/\b(check|status|how|going on|update|doing|look(ing)? at|pull up|report|numbers|sales|up and running|live)\b/.test(t) && findProject(this.store.all('projects'), t)
        && !/^(add|create|schedule|book|remind|idea|decision|remember|note|mark|approve|start)\b/.test(t)) return this._checkProject(t);

    if ((m = t.match(/^(?:schedule|book|put|add)\b(.+?)(?:on|to)? ?(?:my |the )?(personal |business )?calendar\b(.*)$/)) ||
        (m = t.match(/^(?:schedule|book)\s+(.+)$/))) {
      const body = m.length > 3 ? (m[1] + ' ' + (m[3] || '')) : m[1];
      return this._schedule(body, m.length > 3 && m[2] ? m[2].trim() : null, original);
    }
    if ((m = t.match(/^(?:add (?:a )?task|new task|task|to ?do|add to my (?:to ?do )?list|remind me to|i need to|add)\s*:?\s*(?:to )?(.+)$/))) return this._addTask(m[1]);
    if ((m = t.match(/^(?:mark|set)\s+(.+?)\s+(?:as )?(?:done|complete|completed|finished)$/)) || (m = t.match(/^(?:i )?(?:finished|completed|done with|i did)\s+(.+)$/))) return this._completeTask(m[1]);
    if ((m = t.match(/^approve(?:d)?\s+(.+)$/))) return this._approveTask(m[1]);
    if ((m = t.match(/^(?:start|start working on|working on)\s+(.+)$/))) return this._startTask(m[1]);

    if ((m = t.match(/^(?:idea|i have an idea|new idea)\s*:?\s*(.+)$/))) return this._remember(m[1], 'idea');
    if ((m = t.match(/^(?:decision|we decided|i decided|approved decision|it's decided)\s*:?\s*(?:that )?(.+)$/))) return this._remember(m[1], 'decision');
    if ((m = t.match(/^(?:remember|note|make a note|save this)\s*(?:that|:)?\s*(.+)$/))) return this._remember(m[1], 'note');
    if ((m = t.match(/^(?:correction|actually|update)\s*:?\s*(.+?)\s+(?:is now|should be|is)\s+(.+)$/))) return this._correct(m[1], m[2]);

    if (/\b(back ?up|backup)\b/.test(t)) return this._backup();
    if (/\bexport\b/.test(t)) { const r = this.store.exportAll(); return this._reply('I\'ve exported everything to a folder you own.', { reveal: r.dir }); }
    if ((m = t.match(/^(?:plan|break down|make a plan (?:for|to))\s+(.+)$/))) return this._plan(m[1]);
    if (/\b(hardware|my mac|system info|specs)\b/.test(t)) return this._hardware();
    if (/\b(what can you do|help|commands)\b/.test(t)) return this._help();

    // Nothing matched and no AI brain is available — say so honestly and specifically.
    void PERSONALITY; void MANAGER_PERSONALITY;
    return this._reply(`I didn't catch a command in "${original.slice(0, 80)}". My AI brain isn't connected yet, so for now I understand things like "check SiteStyles", "add a task to…", "schedule… tomorrow at 2", or "what's on my plate". Add a free Gemini key in Settings → Connections and I'll understand normal conversation.`, { panel: ai.available ? null : 'settings' });
  }

  // ------------------------------------------------------------------ intents
  _openTasks() { return this.store.all('tasks').filter(t => t.status !== 'done' && t.status !== 'archived'); }
  _pName(id) { return (this.store.all('projects').find(p => p.id === id) || {}).name || 'General'; }

  _today() {
    const now = new Date();
    const events = this.store.all('events').filter(e => new Date(e.start) >= startOfDay(now) && new Date(e.start) <= endOfDay(now)).sort((a, b) => new Date(a.start) - new Date(b.start));
    const open = this._openTasks();
    const dueToday = open.filter(t => t.due && new Date(t.due) <= endOfDay(now));
    const high = open.filter(t => t.priority === 'high' && !dueToday.includes(t));
    const parts = [];
    if (events.length) parts.push(`On the calendar: ${events.map(e => `${e.title} at ${fmtTime(e.start)}`).join('; ')}.`);
    else parts.push('Your calendar is clear today.');
    if (dueToday.length) parts.push(`Due today or overdue: ${dueToday.slice(0, 4).map(t => t.title).join('; ')}.`);
    if (high.length) parts.push(`High priority: ${high.slice(0, 3).map(t => t.title).join('; ')}.`);
    if (!dueToday.length && !high.length) parts.push(`You have ${spokenCount(open.length, 'open task')}, nothing urgent.`);
    return this._reply(parts.join(' '), { panel: 'tasks' });
  }

  _attention() {
    const st = this.alerts.status();
    const active = this.alerts.active();
    const open = this._openTasks();
    const approvals = open.filter(t => t.needsApproval);
    const overdue = open.filter(t => t.due && new Date(t.due) < new Date());
    const parts = [];
    const reds = active.filter(a => a.level === 'red' && a.state !== 'contained');
    if (reds.length) parts.push(`Critical: ${reds.map(a => a.title + (a.simulated ? ' (simulation)' : '')).join('; ')}.`);
    if (approvals.length) parts.push(`Waiting on your approval: ${approvals.slice(0, 4).map(t => t.title).join('; ')}.`);
    if (overdue.length) parts.push(`Overdue: ${overdue.slice(0, 4).map(t => t.title).join('; ')}.`);
    const yellows = active.filter(a => a.level === 'yellow' || a.state === 'contained');
    if (yellows.length) parts.push(`Also flagged: ${yellows.slice(0, 3).map(a => a.title).join('; ')}.`);
    if (!parts.length) parts.push('Nothing in the systems we monitor needs you right now. Your store and payments aren\'t connected yet, so I can\'t speak for those.');
    // oversight belongs to the manager
    return this._reply(`Bottom line, ${this.store.settings().addressAs}: ` + parts.join(' '), { panel: st.level === 'red' ? 'alerts' : 'tasks', speaker: 'manager' });
  }

  async _checkProject(phrase) {
    const p = findProject(this.store.all('projects'), phrase);
    const r = await this._checkProjectLive(p);
    return this._reply(r.text, { panel: 'projects', focusProject: p.id });
  }

  /** Live checks + Missy's own records for one business. Returns spoken text and raw facts for the AI. */
  async _checkProjectLive(p) {
    this.emit('missy:state', 'processing');
    const live = await checkProjectConnections(p, this.secrets);
    const record = this._projectRecord(p);
    const checkedAt = new Date().toISOString();
    this.store.update('projects', p.id, { lastCheck: { at: checkedAt, results: live.map(({ source, target, ok, level, summary }) => ({ source, target, ok, level, summary })) } });
    this.store.logAction('check', `Checked ${p.name}: ${live.map(x => `${x.source} ${x.ok ? 'ok' : 'problem'}`).join(', ') || 'no live connections'}`);
    const liveText = live.length ? live.map(x => x.summary).join(' ') : `${p.name} has no live connections yet, so I can only see my own records for it.`;
    const notConnected = [];
    const c = p.connections || {};
    if (!c.website) notConnected.push('its website');
    if (!c.stripe) notConnected.push('payments');
    const text = `I just checked ${p.name}. ${liveText} From my records: ${record}${notConnected.length && live.length ? ` Not connected yet: ${notConnected.join(' and ')}.` : ''}`;
    const facts = [`Business: ${p.name} (checked ${new Date(checkedAt).toLocaleTimeString('en-US')})`,
      ...live.map(x => `LIVE ${x.source}${x.target ? ' ' + x.target : ''}: ${x.summary}`),
      live.length ? '' : 'No live connections configured for this business.',
      `Missy's own records: ${record}`].filter(Boolean).join('\n');
    return { text, facts, live };
  }

  _projectRecord(p) {
    const tasks = this.store.all('tasks').filter(t => t.projectId === p.id);
    const open = tasks.filter(t => t.status !== 'done' && t.status !== 'archived');
    const done = tasks.filter(t => t.status === 'done');
    const overdue = open.filter(t => t.due && new Date(t.due) < new Date());
    const ideas = this.store.all('knowledge').filter(k => k.projectId === p.id && k.kind === 'idea');
    let text = `${spokenCount(open.length, 'open task')}, ${done.length} done.`;
    if (overdue.length) text += ` ${overdue.length} overdue, starting with ${overdue[0].title}.`;
    const next = open.find(t => t.priority === 'high') || open[0];
    if (next) text += ` Next up: ${next.title}.`;
    if (ideas.length) text += ` ${spokenCount(ideas.length, 'idea')} parked.`;
    return text;
  }

  /** Used by the AI brain: structured task creation (no sentence parsing of the title). */
  _addTaskStructured({ title, project, when, priority }) {
    const w = when ? parseWhen(String(when)) : { date: null, hasTime: false };
    const clean = String(title).trim().replace(/[.]+$/, '');
    const t = clean.charAt(0).toUpperCase() + clean.slice(1);
    const needsApproval = APPROVAL_WORDS.test(t);
    const task = this.store.insert('tasks', {
      title: t, projectId: project ? project.id : null, status: 'todo', priority: ['high', 'low'].includes(priority) ? priority : 'normal',
      due: w.date ? w.date.toISOString() : null, needsApproval, source: 'ai',
    }, 'tsk');
    this.store.logAction('task', `Added: ${t}`, { taskId: task.id });
    return `Added "${t}"${project ? ` to ${project.name}` : ''}${task.due ? `, due ${fmtDay(task.due)}${w.hasTime ? ' at ' + fmtTime(task.due) : ''}` : ''}.${needsApproval ? ' It needs your approval before anything goes out.' : ''}`;
  }

  _addProject(name) {
    const clean = name.replace(/\b(please|for me)\b/g, '').trim();
    const title = clean.replace(/\b\w/g, c => c.toUpperCase());
    if (findProject(this.store.all('projects'), title) && this.store.all('projects').some(p => p.name.toLowerCase() === title.toLowerCase()))
      return this._reply(`${title} is already in the registry.`);
    const palette = ['#60a5fa', '#f472b6', '#facc15', '#4ade80', '#c084fc', '#2dd4bf'];
    const p = this.store.insert('projects', { key: slug(title), name: title, color: palette[this.store.all('projects').length % palette.length], focus: [], status: 'active', notes: '' }, 'prj');
    this.store.logAction('project', `Registered ${p.name}`);
    return this._reply(`${p.name} is registered. Tell me its first task whenever you're ready.`, { panel: 'projects' });
  }

  _addTask(body) {
    const projects = this.store.all('projects');
    const when = parseWhen(body);
    let rest = when.date ? when.rest : body;
    rest = rest.replace(/\b(due|by|on|for)\s*$/i, '').trim();
    const project = findProject(projects, rest);
    let title = stripProject(rest, project).replace(/^(to|that|a task to)\s+/i, '').replace(/\s+(due|by)$/i, '').trim();
    let priority = 'normal';
    if (/\b(urgent|asap|high priority|important)\b/i.test(title)) { priority = 'high'; title = title.replace(/,?\s*\b(urgent|asap|high priority|important)\b/ig, '').trim(); }
    if (!title) return this._reply('What should the task say?');
    title = title.charAt(0).toUpperCase() + title.slice(1);
    const needsApproval = APPROVAL_WORDS.test(title);
    const task = this.store.insert('tasks', {
      title, projectId: project ? project.id : null, status: 'todo', priority,
      due: when.date ? when.date.toISOString() : null, needsApproval, source: 'voice',
    }, 'tsk');
    this.store.logAction('task', `Added: ${title}`, { taskId: task.id });
    let text = `Added "${title}"${project ? ` to ${project.name}` : ''}${task.due ? `, due ${fmtDay(task.due)}${when.hasTime ? ' at ' + fmtTime(task.due) : ''}` : ''}.`;
    if (needsApproval) text += ' I\'ve marked it as needing your approval before anything goes out.';
    return this._reply(text, { panel: 'tasks' });
  }

  _matchTask(phrase, filter = () => true) {
    const words = phrase.toLowerCase().replace(/\b(the|a|an|task|my)\b/g, ' ').split(/\s+/).filter(w => w.length > 2);
    let best = null, bestScore = 0;
    for (const t of this.store.all('tasks').filter(filter)) {
      const title = t.title.toLowerCase();
      const score = words.filter(w => title.includes(w)).length / Math.max(words.length, 1);
      if (score > bestScore) { best = t; bestScore = score; }
    }
    return bestScore >= 0.5 ? best : null;
  }

  _completeTask(phrase) {
    const t = this._matchTask(phrase, x => x.status !== 'done');
    if (!t) return this._reply(`I couldn't find an open task matching "${phrase}".`);
    this.store.update('tasks', t.id, { status: 'done', completedAt: nowISO(), verifiedBy: 'Halli (voice)' });
    this.store.logAction('task', `Completed: ${t.title}`, { taskId: t.id });
    return this._reply(`Marked "${t.title}" done. Nice.`, { panel: 'tasks' });
  }

  _approveTask(phrase) {
    const t = this._matchTask(phrase, x => x.needsApproval && x.status !== 'done');
    if (!t) return this._reply(`Nothing waiting for approval matches "${phrase}".`);
    this.store.update('tasks', t.id, { needsApproval: false, approvedAt: nowISO() });
    this.store.logAction('approval', `Approved: ${t.title}`, { taskId: t.id });
    return this._reply(`Approved "${t.title}". Logged — the team can move on it.`, { panel: 'tasks', speaker: 'manager' });
  }

  _startTask(phrase) {
    const t = this._matchTask(phrase, x => x.status === 'todo');
    if (!t) return this._addTask(phrase);
    this.store.update('tasks', t.id, { status: 'active' });
    return this._reply(`"${t.title}" is now in progress.`, { panel: 'tasks' });
  }

  _schedule(body, calendarWord, original) {
    const when = parseWhen(body);
    if (!when.date) return this._reply('When should I schedule it? For example, "tomorrow at 3".');
    let title = when.rest.replace(/^(a|an|my|the)\s+/i, '').replace(/\b(for|at|on)\s*$/i, '').replace(/\b(meeting|appointment)\s+(with)\b/i, '$1 $2').trim();
    const isPersonal = calendarWord === 'personal' || /\b(dentist|doctor|school|kids?|son|daughter|family|haircut|nails|church|birthday|game|practice)\b/i.test(title);
    const withOthers = /\bwith\b|\bcall\b|\bmeeting\b|\bclient\b/i.test(title);
    if (!title) title = 'Appointment';
    title = title.charAt(0).toUpperCase() + title.slice(1);
    const durMatch = original.toLowerCase().match(/\bfor (\d+|an|one|two|half an) ?(hour|hours|minutes|min)\b/);
    let mins = 60;
    if (durMatch) mins = durMatch[2].startsWith('min') ? Number(durMatch[1]) || 30 : ((durMatch[1] === 'half an') ? 30 : (Number(durMatch[1]) || 1) * 60);
    const start = when.date;
    const end = new Date(start.getTime() + mins * 60000);
    const ev = { title, start: start.toISOString(), end: end.toISOString(), calendar: isPersonal ? 'personal' : 'business', withOthers, allDayGuess: !when.hasTime };
    const conflicts = this.store.all('events').filter(e => overlaps(e, ev));
    const book = () => {
      const saved = this.store.insert('events', ev, 'evt');
      this.store.logAction('calendar', `Booked: ${title} ${fmtDay(start)} ${fmtTime(start)}`, { eventId: saved.id });
      return this._reply(`Booked "${title}" for ${fmtDay(start)} at ${fmtTime(start)} on your ${ev.calendar} calendar.${!when.hasTime ? ' I guessed 9 AM since you didn\'t give a time — say the time if that\'s wrong.' : ''}`, { panel: 'calendar' });
    };
    if (conflicts.length) {
      this.pendingAction = { summary: `Book "${title}" despite conflict`, run: book };
      return this._reply(`Heads up: that overlaps "${conflicts[0].title}" at ${fmtTime(conflicts[0].start)}. Should I book it anyway?`, { panel: 'calendar' });
    }
    return book();
  }

  _remember(text, kind) {
    const project = findProject(this.store.all('projects'), text);
    const clean = text.charAt(0).toUpperCase() + text.slice(1);
    this.store.insert('knowledge', { kind, text: clean, projectId: project ? project.id : null, source: 'voice' }, 'kn');
    this.store.logAction('memory', `${kind}: ${clean}`);
    const label = { idea: 'Parked that as an idea — not approved yet.', decision: 'Logged as an approved decision.', note: 'Got it, noted.' }[kind];
    return this._reply(label + (project ? ` Filed under ${project.name}.` : ''), { panel: 'memory' });
  }

  _correct(subject, value) {
    const items = this.store.all('knowledge');
    const words = subject.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const hit = items.find(k => words.every(w => k.text.toLowerCase().includes(w)));
    if (hit) {
      const old = hit.text;
      this.store.update('knowledge', hit.id, { text: `${subject.charAt(0).toUpperCase() + subject.slice(1)} is ${value}`, previous: old });
      return this._reply(`Updated. It used to say: "${old}".`, { panel: 'memory' });
    }
    return this._remember(`${subject} is ${value}`, 'note');
  }

  _backup() {
    this.alerts.startMaintenance('Backup');
    try {
      const b = this.store.backup('manual');
      return this._reply('Backup saved and verified.', { reveal: b.file });
    } finally { this.alerts.endMaintenance('Backup'); }
  }

  async _plan(goal) {
    const project = findProject(this.store.all('projects'), goal);
    const tasks = await this.ai.plan(goal, project && project.name).catch(() => null);
    if (!tasks || !tasks.length) return this._reply('Planning needs the local AI model, and it isn\'t running. Once Ollama is installed, ask me again.');
    this.pendingAction = {
      summary: `Add ${tasks.length} planned tasks`,
      run: () => {
        for (const t of tasks) this.store.insert('tasks', { title: t.title, projectId: project ? project.id : null, status: 'todo', priority: ['high', 'low'].includes(t.priority) ? t.priority : 'normal', due: null, needsApproval: APPROVAL_WORDS.test(t.title), source: 'ai-plan' }, 'tsk');
        this.store.logAction('task', `Added ${tasks.length} AI-planned tasks for: ${goal}`);
        return this._reply(`Added ${spokenCount(tasks.length, 'task')}${project ? ' to ' + project.name : ''}.`, { panel: 'tasks' });
      },
    };
    return this._reply(`Here's my plan: ${tasks.map((t, i) => `${i + 1}, ${t.title}`).join('. ')}. Want me to add these as tasks?`, { plan: tasks });
  }

  async _hardware() {
    const h = await hardwareReport();
    return this._reply(`You're on ${h.chip} with ${h.ramGB} gigabytes of memory${h.freeDiskGB != null ? ` and ${h.freeDiskGB} gigabytes free` : ''}. ${h.aiAdvice}`, { panel: 'settings', hardware: h });
  }

  _help() {
    return this._reply('Try: "catch me up", "what\'s on my plate", "what needs my attention", "check SiteStyles", "add a task to update the template previews for SiteStyles due Friday", "schedule a client call tomorrow at 2", "idea: ...", "back up", or "plan a holiday promo for Opulent Thoughts".', { panel: 'help' });
  }

  _explainInterrupt() {
    const a = this.store.get('alerts', this.pendingInterrupt);
    this.pendingInterrupt = null;
    if (!a) return this._reply('It\'s already been handled.');
    const actions = a.actionsTaken && a.actionsTaken.length ? ` What I've done so far: ${a.actionsTaken.join('; ')}.` : ' I haven\'t been able to take any action on it yet.';
    return this._reply(`${a.simulated ? 'This is a simulation. ' : ''}${a.title}. ${a.detail || ''}${actions} It stays critical until it's contained — that needs you to check it and mark it contained in the Alerts panel.`, { panel: 'alerts', speaker: 'manager' });
  }

  _contextSummary() {
    const open = this._openTasks();
    const st = this.alerts.status();
    const now = new Date();
    const todays = this.store.all('events').filter(e => new Date(e.start) >= startOfDay(now) && new Date(e.start) <= endOfDay(now));
    const decisions = this.store.all('knowledge').filter(k => k.kind === 'decision').slice(-10).map(k => '- ' + k.text);
    return [
      `Now: ${now.toString()}`,
      `Status: ${st.level}. Monitored: ${st.monitored.join(', ')}. NOT connected: ${st.notMonitored.join(', ')}.`,
      `Businesses: ${this.store.all('projects').map(p => p.name).join(', ')}`,
      `Open tasks (${open.length}): ${open.slice(0, 12).map(t => `${t.title} [${this._pName(t.projectId)}${t.due ? ', due ' + t.due.slice(0, 10) : ''}]`).join('; ')}`,
      `Today's calendar: ${todays.map(e => `${fmtTime(e.start)} ${e.title}`).join('; ') || 'clear'}`,
      `Approved decisions:\n${decisions.join('\n') || '(none)'}`,
    ].join('\n');
  }

  // ------------------------------------------------------------------ direct UI actions
  async action(name, args) {
    args = args || {}; // the Chrome edition sends null for "no arguments"
    const st = this.store;
    let result;
    switch (name) {
      case 'task:add': result = st.insert('tasks', { status: 'todo', priority: 'normal', due: null, projectId: null, ...args, needsApproval: args.needsApproval ?? APPROVAL_WORDS.test(args.title || '') }, 'tsk'); st.logAction('task', `Added: ${args.title}`); break;
      case 'task:update': result = st.update('tasks', args.id, args.patch); if (args.patch.status === 'done') st.update('tasks', args.id, { completedAt: nowISO(), verifiedBy: 'Halli' }); break;
      case 'task:approve': result = st.update('tasks', args.id, { needsApproval: false, approvedAt: nowISO() }); st.logAction('approval', `Approved: ${result && result.title}`); break;
      case 'task:delete': result = st.update('tasks', args.id, { status: 'archived' }); st.logAction('task', `Archived: ${result && result.title}`); break;
      case 'event:add': {
        const conflicts = st.all('events').filter(e => overlaps(e, args));
        if (conflicts.length && !args.force) { result = { conflict: conflicts.map(c => c.title) }; break; }
        result = st.insert('events', args, 'evt'); st.logAction('calendar', `Booked: ${args.title}`); break;
      }
      case 'event:delete': {
        const ev = st.get('events', args.id);
        if (ev && ev.withOthers && !args.confirmed) { result = { needsConfirm: 'This appointment involves other people. Remove it?' }; break; }
        st.remove('events', args.id); st.logAction('calendar', `Removed: ${ev && ev.title}`); result = { ok: true }; break;
      }
      case 'project:add': return this._addProject(args.name);
      case 'project:update': result = st.update('projects', args.id, args.patch); break;
      case 'sticky:add': {
        const text = String(args.text || '').trim();
        if (!text || text.length > 1000) throw new Error('Sticky text must be between 1 and 1000 characters.');
        const scope = ['general', 'home', 'business', 'creator'].includes(args.scope) ? args.scope : 'general';
        const color = ['gold', 'rose', 'mint', 'blue', 'lavender'].includes(args.color) ? args.color : 'gold';
        result = st.insert('stickies', { text, scope, color, done: false, pinned: true, archived: false }, 'sty');
        st.logAction('sticky', 'Pinned a sticky', { stickyId: result.id });
        break;
      }
      case 'sticky:update': {
        const current = st.get('stickies', args.id);
        if (!current || current.archived) throw new Error('Sticky not found.');
        const patch = {};
        if (typeof args.done === 'boolean') patch.done = args.done;
        if (typeof args.pinned === 'boolean') patch.pinned = args.pinned;
        if (typeof args.text === 'string') {
          patch.text = args.text.trim();
          if (!patch.text || patch.text.length > 1000) throw new Error('Invalid sticky text.');
        }
        result = st.update('stickies', args.id, patch);
        break;
      }
      case 'sticky:archive': {
        const current = st.get('stickies', args.id);
        if (!current) throw new Error('Sticky not found.');
        result = st.update('stickies', args.id, { archived: true });
        st.logAction('sticky', 'Archived a sticky', { stickyId: args.id });
        break;
      }
      case 'knowledge:add': result = st.insert('knowledge', { kind: args.kind || 'note', text: args.text, projectId: args.projectId || null }, 'kn'); break;
      case 'knowledge:update': result = st.update('knowledge', args.id, args.patch); break;
      case 'alert:ack': result = this.alerts.acknowledge(args.id); break;
      case 'alert:contain': result = this.alerts.contain(args.id, args.note); break;
      case 'alert:resolve': result = this.alerts.resolve(args.id); break;
      case 'alert:simulate': result = this.alerts.raise({ level: args.level || 'red', title: args.title || 'Demo: checkout automation stopped responding', detail: 'This is a SIMULATED alert to test the alert system. No real system is affected.', source: 'demo', simulated: true, security: Boolean(args.security), actionsTaken: ['(simulation) Paused the affected automation', '(simulation) Saved a backup'] }); break;
      case 'backup': return this._backup();
      case 'export': { const r = st.exportAll(); result = r; break; }
      case 'settings': result = st.updateSettings(args); break;
      case 'team:update': {
        const team = st.settings().team;
        if (!team[args.role]) throw new Error('Unknown team member');
        Object.assign(team[args.role], args.patch);
        st.save(); st.logAction('settings', `Updated ${team[args.role].name}${args.patch.portrait !== undefined ? ' portrait' : ''}`);
        result = team[args.role]; break;
      }
      case 'hardware': return hardwareReport();
      case 'ai:status': return this.ai.status(Boolean(args.force));
      case 'secrets:set': {
        this.secrets.set(args.key, args.value || '');
        this.ai.invalidate();
        st.logAction('settings', `${args.value ? 'Saved' : 'Removed'} ${args.key}`);
        result = { saved: this.secrets.summary() };
        if (/gemini|groq/i.test(args.key) && args.value) result.ai = await this.ai.status(true);
        break;
      }
      case 'ai:settings': st.updateSettings({ ai: { ...(st.settings().ai || {}), ...args } }); this.ai.invalidate(); result = await this.ai.status(true); break;
      case 'project:connections': {
        const p = st.get('projects', args.id);
        if (!p) throw new Error('Unknown project');
        p.connections = { ...(p.connections || {}), ...args.connections };
        for (const k of Object.keys(p.connections)) if (!p.connections[k]) delete p.connections[k];
        st.save(); st.logAction('settings', `Updated connections for ${p.name}`);
        result = p; break;
      }
      case 'project:check': { const p = st.get('projects', args.id); result = await this._checkProjectLive(p); break; }
      case 'voice:status': return { whisper: this.voice.findWhisper(), voices: await this.voice.listVoices() };
      default: throw new Error(`Unknown action ${name}`);
    }
    this.changed();
    return result;
  }
}

/** Strip her name, politeness and filler so "Missy, can you please check on SiteStyles for me?" → "check on sitestyles". */
function normalize(text) {
  let t = String(text).toLowerCase().replace(/[’]/g, "'").trim();
  t = t.replace(/^(hey|hi|ok|okay|yo|so|um|uh)[,!.]?\s+/, '');
  t = t.replace(/^((miss |ms\.? )?claud(ie|y|i)|missy( central)?|miss essentials|miss thing)[,!.]?\s*/, '');
  t = t.replace(/[?!.]+$/, '').trim();
  for (let i = 0; i < 3; i++) {
    t = t.replace(/^(can you|could you|would you|will you|can u|please|i want you to|i need you to|i'd like you to|go ahead and|real quick|quickly|let's|lets)\s+/, '');
  }
  t = t.replace(/\s+(for me|please|real quick|right now|thanks|thank you)$/g, '').trim();
  return t;
}

module.exports = { Missy, APPROVAL_WORDS, normalize };
