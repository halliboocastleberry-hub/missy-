'use strict';
/**
 * The AI brain's working loop.
 * 1. The model reads what Halli said plus Missy's real records, and answers with JSON:
 *      { "say": "...", "actions": [ { "type": "...", ... } ] }
 * 2. Missy carries out the actions herself (the model never touches data directly).
 * 3. If an action looks something up (checking a business, running the briefing), the real
 *    results go back to the model so her spoken answer is based on them — not on memory.
 * If an action fails or needs a decision, Missy says what actually happened instead of the model's guess.
 */
const { PERSONALITY, MANAGER_PERSONALITY, parseJSON } = require('./ai');
const { fmtTime, fmtDay, startOfDay } = require('./util');

const ACTIONS_HELP = `Actions you can request (use exact field names; omit fields you don't know):
- {"type":"add_task","title":"...","project":"business name or omit","when":"natural date like 'friday 3pm' or omit","priority":"high|normal|low"}
- {"type":"complete_task","task":"words from the task title"}
- {"type":"approve_task","task":"words from the task title"}
- {"type":"start_task","task":"words from the task title"}
- {"type":"schedule","title":"...","when":"natural date and time","minutes":60,"calendar":"business|personal"}
- {"type":"remember","kind":"idea|decision|note","text":"...","project":"optional"}
- {"type":"check_business","project":"business name"}   ← runs LIVE checks (website, GitHub, Stripe) and returns real results
- {"type":"briefing"}                                    ← runs the full morning system scan
- {"type":"add_business","name":"..."}

Rules:
- Only request an action when she asked for it or clearly agreed to it. If details are missing (like a time), ask a short follow-up question instead of guessing.
- Saving an idea vs a decision: only call it a "decision" if she says it's decided/approved.
- Never state business numbers, sales, site status or progress unless they appear in the records below or in a check_business result. If you don't know, say so and offer to check.
- To answer "how is X doing / check X / what's going on with X", request check_business.
- "say" is spoken aloud: 1-3 short sentences, natural, no markdown, no emojis. You may end with a brief follow-up question when useful.
Respond with ONLY a JSON object: {"say":"...","actions":[...]}`;

function contextFor(missy) {
  const st = missy.store;
  const now = new Date();
  const projects = st.all('projects').filter(p => p.status !== 'archived');
  const pName = id => (projects.find(p => p.id === id) || {}).name || 'General';
  const open = st.all('tasks').filter(t => t.status !== 'done' && t.status !== 'archived');
  const week = new Date(now.getTime() + 7 * 864e5);
  const events = st.all('events').filter(e => new Date(e.start) >= startOfDay(now) && new Date(e.start) <= week)
    .sort((a, b) => new Date(a.start) - new Date(b.start));
  const kn = st.all('knowledge');
  const alerts = missy.alerts.active();
  const conn = p => {
    const c = p.connections || {};
    const parts = [c.website && 'website', c.github && 'GitHub', c.stripe && (missy.secrets.has('stripeKey') ? 'Stripe' : 'Stripe (key missing)')].filter(Boolean);
    return parts.length ? `live checks: ${parts.join(', ')}` : 'no live connections';
  };
  return [
    `Right now: ${now.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}`,
    `Businesses: ${projects.map(p => `${p.name} (${conn(p)})`).join('; ')}`,
    `Open tasks (${open.length}): ${open.slice(0, 25).map(t => `"${t.title}" [${pName(t.projectId)}${t.due ? ', due ' + fmtDay(t.due) + ' ' + fmtTime(t.due) : ''}${t.needsApproval ? ', NEEDS APPROVAL' : ''}${t.status === 'active' ? ', in progress' : ''}${t.priority === 'high' ? ', high priority' : ''}]`).join('; ') || 'none'}`,
    `Calendar, next 7 days: ${events.map(e => `${fmtDay(e.start)} ${fmtTime(e.start)} "${e.title}" (${e.calendar})`).join('; ') || 'nothing booked'}`,
    `Open alerts: ${alerts.map(a => `${a.level} "${a.title}"${a.simulated ? ' (simulation)' : ''}`).join('; ') || 'none'}`,
    `Approved decisions: ${kn.filter(k => k.kind === 'decision').slice(-8).map(k => k.text).join(' | ') || 'none'}`,
    `Parked ideas: ${kn.filter(k => k.kind === 'idea').slice(-6).map(k => k.text).join(' | ') || 'none'}`,
    `Not connected to anything yet: email, social accounts, Google/iCloud calendars, and any business without live checks above.`,
  ].join('\n');
}

async function runAgent(missy, userText) {
  const persona = missy._speaker === 'manager' ? MANAGER_PERSONALITY : PERSONALITY;
  const system = `${persona}\n\n${ACTIONS_HELP}\n\nMissy's records (real, current):\n${contextFor(missy)}`;
  const messages = [{ role: 'system', content: system }, ...missy.history.slice(-10), { role: 'user', content: userText }];

  const first = parseJSON(await missy.ai.complete(messages, { json: true }));
  if (!first || (typeof first.say !== 'string' && !Array.isArray(first.actions))) throw new Error('The AI answered in a format I couldn\'t read.');
  const actions = Array.isArray(first.actions) ? first.actions.slice(0, 6) : [];

  const results = [];
  let panel = null, focusProject = null;
  for (const a of actions) {
    const r = await executeAction(missy, a || {});
    results.push({ action: a.type, ...r });
    panel = r.panel || panel; focusProject = r.focusProject || focusProject;
  }

  const lookups = results.filter(r => r.lookup);
  let say = String(first.say || '').trim();

  if (lookups.length) {
    // Second pass: answer from the real results only.
    const facts = lookups.map(r => r.facts).join('\n');
    const second = parseJSON(await missy.ai.complete([
      ...messages,
      { role: 'assistant', content: JSON.stringify(first) },
      { role: 'user', content: `TOOL RESULTS (live, just now):\n${facts}\n\nNow give your spoken answer to Ms. Castleberry based ONLY on these results and the records. Say plainly what was checked and what isn't connected. Respond with ONLY {"say":"..."}` },
    ], { json: true }).catch(() => null));
    say = (second && second.say) || lookups.map(r => r.text).join(' ');
  }

  const problems = results.filter(r => !r.ok && !r.lookup);
  const questions = results.filter(r => r.question);
  if (problems.length || questions.length) {
    // Don't let the model claim success for something that didn't happen.
    const done = results.filter(r => r.ok && !r.lookup && !r.question).map(r => r.text);
    say = [...done, ...problems.map(r => r.text), ...questions.map(r => r.text)].join(' ');
  }
  if (!say) say = results.map(r => r.text).join(' ') || 'Okay.';

  missy.store.logAction('ai', `${missy.ai._cache && missy.ai._cache.status ? missy.ai._cache.status.label : 'AI'} handled: "${userText.slice(0, 80)}" → ${results.map(r => r.action).join(', ') || 'conversation'}`);
  return missy._reply(say, { panel, focusProject, actions: results.map(({ action, ok, text }) => ({ action, ok, text })) });
}

async function executeAction(missy, a) {
  const projects = missy.store.all('projects');
  const { findProject } = require('./projects');
  try {
    switch (a.type) {
      case 'add_task': {
        if (!a.title) return { ok: false, text: 'I need a title for that task.' };
        const p = a.project ? findProject(projects, a.project) : null;
        const r = missy._addTaskStructured({ title: a.title, project: p, when: a.when, priority: a.priority });
        return { ok: true, text: r, panel: 'tasks' };
      }
      case 'complete_task': return wrap(missy._completeTask(String(a.task || '')), /^Marked/, 'tasks');
      case 'approve_task': return wrap(missy._approveTask(String(a.task || '')), /^Approved/, 'tasks');
      case 'start_task': return wrap(missy._startTask(String(a.task || '')), /in progress|^Added/, 'tasks');
      case 'schedule': {
        if (!a.when) return { ok: false, question: true, text: 'What day and time should I book it for?' };
        const r = missy._schedule(`${a.title || 'Appointment'} ${a.when}${a.minutes ? ` for ${a.minutes} minutes` : ''}`, a.calendar === 'personal' ? 'personal' : a.calendar === 'business' ? 'business' : null, `${a.title || ''} ${a.when} ${a.minutes ? `for ${a.minutes} minutes` : ''}`);
        if (/overlaps/.test(r.text)) return { ok: true, question: true, text: r.text, panel: 'calendar' };
        if (/^When should/.test(r.text)) return { ok: false, question: true, text: r.text };
        return { ok: true, text: r.text, panel: 'calendar' };
      }
      case 'remember': return wrap(missy._remember(String(a.text || ''), ['idea', 'decision', 'note'].includes(a.kind) ? a.kind : 'note'), null, 'memory');
      case 'add_business': return wrap(missy._addProject(String(a.name || '')), /registered|already/, 'projects');
      case 'check_business': {
        const p = findProject(projects, String(a.project || ''));
        if (!p) return { ok: false, lookup: true, text: `I don't have a business called "${a.project}".`, facts: `No business matches "${a.project}". Known: ${projects.map(x => x.name).join(', ')}` };
        const r = await missy._checkProjectLive(p);
        return { ok: true, lookup: true, text: r.text, facts: r.facts, panel: 'projects', focusProject: p.id };
      }
      case 'briefing': {
        const r = await missy.morningBriefing('manual');
        return { ok: true, lookup: true, text: r.text, facts: 'Morning scan results:\n' + r.scan.sections.map(s => `${s.title}: ${s.items.map(i => i.text + (i.real ? '' : ' [NOT CHECKED]')).join(' / ')}`).join('\n'), panel: 'briefing' };
      }
      default: return { ok: false, text: '' };
    }
  } catch (err) {
    missy.store.logAction('automation-failed', `AI action ${a.type} failed: ${err.message}`);
    return { ok: false, text: `I couldn't finish that (${err.message}).` };
  }
}

function wrap(reply, success, panel) {
  const text = reply && reply.text ? reply.text : String(reply || '');
  return { ok: success ? success.test(text) : true, text, panel };
}

module.exports = { runAgent, contextFor, ACTIONS_HELP };
