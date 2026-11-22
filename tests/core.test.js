'use strict';
/* Run with: npm test   (plain Node, no Electron needed) */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Missy } = require('../src/main/core/missy');
const { parseWhen } = require('../src/main/core/when');

// ---- fake internet so tests never depend on real sites ----
const FAKE = {
  'https://sitestyles.net': () => new Response('<html><head><title>Site Styles — Website Templates</title></head><body>Templates</body></html>', { status: 200, headers: { 'content-type': 'text/html' } }),
  'https://api.github.com/repos/halliboocastleberry-hub/-site-styles': () => Response.json({ open_issues_count: 0, pushed_at: '2026-11-10T18:56:42Z' }),
  'https://api.github.com/repos/halliboocastleberry-hub/-site-styles/commits?per_page=3': () => Response.json({ message: 'Git Repository is empty.' }, { status: 409 }),
};
let aiScript = null; // when set, plays the role of the cloud AI
global.fetch = async (url, opts = {}) => {
  url = String(url);
  if (aiScript && url.endsWith('/models')) return Response.json({ data: [{ id: 'models/gemini-9.0-flash' }, { id: 'models/text-embedding-004' }] });
  if (aiScript && url.endsWith('/chat/completions')) { const next = aiScript.shift(); return Response.json({ choices: [{ message: { content: typeof next === 'string' ? next : JSON.stringify(next) } }] }); }
  if (url.startsWith('https://api.stripe.com/v1/balance')) return Response.json({ available: [{ amount: 9900, currency: 'usd' }] });
  if (url.startsWith('https://api.stripe.com/v1/charges')) return Response.json({ data: [
    { status: 'succeeded', paid: true, refunded: false, amount: 9900, currency: 'usd', livemode: true },
    { status: 'failed', paid: false, refunded: false, amount: 9900, currency: 'usd', livemode: true }] });
  if (FAKE[url]) return FAKE[url]();
  const e = new Error('fetch failed'); e.cause = { code: 'ECONNREFUSED' }; throw e;
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'missy-test-'));
const events = [];
const missy = new Missy(dir, (ch, p) => events.push([ch, p]));
missy.store.updateSettings({ spokenResponses: false, ollamaUrl: 'http://127.0.0.1:9' }); // no AI, no speech in tests

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { console.log('  ✗', name, '\n    ', e.message); process.exitCode = 1; }
}

(async () => {
  console.log('Missy Central core tests');
  const now = new Date(2026, 9, 29, 14, 0); // Thu Oct 29 2026, 2 PM

  await test('date parsing: tomorrow at 3', () => {
    const r = parseWhen('client call tomorrow at 3', now);
    assert.equal(r.date.getDate(), 30); assert.equal(r.date.getHours(), 15); assert.equal(r.rest, 'client call');
  });
  await test('date parsing: friday 10:30am', () => {
    const r = parseWhen('dentist friday 10:30am', now);
    assert.equal(r.date.getDay(), 5); assert.equal(r.date.getHours(), 10); assert.equal(r.date.getMinutes(), 30);
  });
  await test('date parsing: november 5 at noon', () => {
    const r = parseWhen('launch review november 5 at noon', now);
    assert.equal(r.date.getMonth(), 10); assert.equal(r.date.getDate(), 5); assert.equal(r.date.getHours(), 12);
  });
  await test('date parsing: in 2 hours', () => {
    const r = parseWhen('check the upload in 2 hours', now);
    assert.equal(r.date.getHours(), 16);
  });

  await test('project registry seeded', () => {
    const names = missy.store.all('projects').map(p => p.name);
    for (const n of ['SiteStyles', 'Halli Originals', 'Post Roulette', 'Ecom Radar', 'Opulent Thoughts', 'ScheduleUp', 'MBS Essentials', 'Personal Brand Website'])
      assert.ok(names.includes(n), n);
  });

  await test('voice: add task with project + due date', async () => {
    const r = await missy.handle('Missy, add a task to update the template previews for SiteStyles due Friday');
    assert.match(r.text, /Added "Update the template previews" to SiteStyles/);
    const t = missy.store.all('tasks').find(x => x.title === 'Update the template previews');
    assert.ok(t && t.due);
  });

  await test('risky tasks are flagged for approval', async () => {
    const r = await missy.handle('add task publish the holiday collection for Halli Originals');
    assert.match(r.text, /needing your approval/);
  });

  await test('approve a task by voice', async () => {
    const r = await missy.handle('approve holiday collection');
    assert.match(r.text, /Approved/);
  });

  await test('schedule + conflict detection before booking', async () => {
    const r1 = await missy.handle('Missy, schedule a client call tomorrow at 2');
    assert.match(r1.text, /Booked "Client call"/);
    const r2 = await missy.handle('schedule dentist tomorrow at 2:30pm');
    assert.match(r2.text, /overlaps/);
    assert.equal(missy.store.all('events').length, 1, 'not booked yet');
    const r3 = await missy.handle('book it anyway');
    assert.match(r3.text, /Booked "Dentist".*personal/);
    assert.equal(missy.store.all('events').length, 2);
  });

  await test('check a project', async () => {
    const r = await missy.handle('Missy, can you check on SiteStyles for me?');
    assert.match(r.text, /^I just checked SiteStyles\. sitestyles\.net is up/);
    assert.match(r.text, /no code in it yet/);
    assert.match(r.text, /Stripe isn't connected/);
    assert.match(r.text, /From my records: one open task/);
    const r2 = await missy.handle("what's going on with site styles");
    assert.match(r2.text, /^I just checked SiteStyles/);
  });

  await test('ideas vs decisions are stored separately', async () => {
    await missy.handle('idea: a gold foil quote series for Opulent Thoughts');
    await missy.handle('decision: Opulent Thoughts posts twice a day');
    const kn = missy.store.all('knowledge');
    assert.ok(kn.find(k => k.kind === 'idea' && /gold foil/.test(k.text)));
    assert.ok(kn.find(k => k.kind === 'decision' && /twice a day/.test(k.text)));
  });

  await test('complete a task by voice', async () => {
    const r = await missy.handle("I finished the template previews");
    assert.match(r.text, /Marked "Update the template previews" done/);
  });

  await test('without local AI, open chat answers honestly', async () => {
    const r = await missy.handle('what do you think about my logo colors');
    assert.match(r.text, /AI brain isn't connected yet/);
  });

  await test('morning scan: real checks, honest about unconnected systems', async () => {
    const r = await missy.morningBriefing('morning');
    assert.match(r.text, /system scan is complete/);
    assert.match(r.text, /what's first today\?$/);
    assert.match(r.text, /aren't connected yet/);
    const rev = r.scan.sections.find(s => s.key === 'revenue');
    assert.ok(rev.items.find(i => /SiteStyles — sitestyles\.net is up/.test(i.text) && i.real), 'live site check in scan');
    assert.ok(rev.items.find(i => /Stripe isn't connected/.test(i.text) && !i.real), 'stripe honestly not checked');
    assert.ok(missy.store.meta().lastBackupAt, 'scan made a backup');
    assert.equal(missy.shouldAutoBrief(), false, 'only once per day');
  });

  await test('red alert: interruption protocol + cannot resolve by acknowledging', async () => {
    const a = await missy.action('alert:simulate', {});
    assert.ok(events.find(([ch, p]) => ch === 'missy:say' && /may I speak/.test(p.text)));
    assert.equal(missy.alerts.status().level, 'red');
    const r = await missy.handle('Go ahead, Missy');
    assert.match(r.text, /This is a simulation/);
    missy.alerts.acknowledge(a.id);
    assert.equal(missy.alerts.status().level, 'red', 'still red after acknowledging');
    const bad = missy.alerts.resolve(a.id);
    assert.equal(bad.ok, false);
    missy.alerts.contain(a.id, 'Checked by Halli');
    assert.notEqual(missy.alerts.status().level, 'red');
    assert.equal(missy.alerts.resolve(a.id).ok, true);
  });

  await test('team: Miss Claudie answers when addressed, Missy by default', async () => {
    const r1 = await missy.handle('Miss Claudie, what needs my attention?');
    assert.equal(r1.speaker, 'manager'); assert.match(r1.text, /^Bottom line/);
    const r2 = await missy.handle("Missy, what's on my plate today?");
    assert.equal(r2.speaker, 'assistant');
    const r3 = await missy.handle('Claudie, add a task to review the SiteStyles pricing');
    assert.equal(r3.speaker, 'manager'); assert.match(r3.text, /Added "Review (the )?pricing" to SiteStyles/);
    await missy.action('team:update', { role: 'manager', patch: { portrait: 'data:image/jpeg;base64,AAA' } });
    assert.equal(missy.store.settings().team.manager.portrait, 'data:image/jpeg;base64,AAA');
    assert.equal(missy.store.settings().team.assistant.name, 'Missy');
  });

  await test('stripe: refuses full secret keys, reads sales with a restricted key', async () => {
    const { checkStripe } = require('../src/main/core/connectors');
    assert.match((await checkStripe('sk_live_abc')).summary, /read-only restricted key/);
    const ok = await checkStripe('rk_live_abc');
    assert.match(ok.summary, /1 sale for \$99\.00, and 1 failed payment/);
  });

  await test('AI brain: understands, acts, and answers from live results', async () => {
    aiScript = []; missy.secrets.set('geminiKey', 'test-key'); missy.ai.invalidate();
    const st = await missy.ai.status(true);
    assert.equal(st.provider, 'gemini'); assert.equal(st.model, 'gemini-9.0-flash');
    aiScript = [
      { say: 'Let me look.', actions: [{ type: 'check_business', project: 'site styles' }, { type: 'add_task', title: 'Set up Stripe checkout', project: 'SiteStyles', when: 'tomorrow at 3pm', priority: 'high' }] },
      { say: 'SiteStyles is up and loading fast, but the GitHub repo is still empty. I added the Stripe task for tomorrow at 3.' },
    ];
    const r = await missy.handle('Hey Missy, how is SiteStyles doing? Also remind me to set up Stripe tomorrow at 3');
    assert.match(r.text, /^SiteStyles is up/);
    const t = missy.store.all('tasks').find(x => x.title === 'Set up Stripe checkout');
    assert.ok(t && t.due && t.priority === 'high');
    assert.ok(missy.store.get('projects', missy.store.all('projects').find(p => p.key === 'sitestyles').id).lastCheck);
  });

  await test('AI brain: a failed action overrides the model claiming success', async () => {
    aiScript = [{ say: 'Done, I marked it complete!', actions: [{ type: 'complete_task', task: 'nonexistent unicorn task' }] }];
    const r = await missy.handle('I finished the unicorn thing');
    assert.match(r.text, /couldn't find an open task/);
  });

  await test('AI brain: if the AI breaks, basic commands still work', async () => {
    aiScript = ['this is not json at all'];
    const r = await missy.handle('add a task to call the printer friday');
    assert.match(r.text, /AI brain had a problem/); assert.match(r.text, /Added "Call the printer"/);
    missy.secrets.set('geminiKey', ''); missy.ai.invalidate(); aiScript = null;
  });

  await test('add a new business without code changes', async () => {
    const r = await missy.handle('add a business called Castle Travel Co');
    assert.match(r.text, /Castle Travel Co is registered/);
    const r2 = await missy.handle('add task build the booking page for castle travel co');
    assert.match(r2.text, /to Castle Travel Co/);
  });

  await test('Stickies work by voice without AI, persist, and archive without deleting history', async () => {
    const r = await missy.handle('Missy, pin a sticky saying buy bread');
    assert.match(r.text, /Pinned your sticky/);
    const note = missy.snapshot().stickies.find(x => x.text === 'buy bread');
    assert.ok(note && note.pinned && !note.done && note.scope === 'general');
    const read = await missy.handle('Missy, read my stickies');
    assert.match(read.text, /buy bread/);
    const updated = await missy.action('sticky:update', { id: note.id, done: true });
    assert.equal(updated.done, true);
    const again = new Missy(dir);
    assert.equal(again.snapshot().stickies.find(x => x.id === note.id).done, true);
    await missy.action('sticky:archive', { id: note.id });
    assert.ok(missy.snapshot().stickies.find(x => x.id === note.id).archived);
  });

  await test('export writes portable files', () => {
    const r = missy.store.exportAll();
    assert.ok(fs.existsSync(path.join(r.dir, 'tasks.md')));
    assert.ok(fs.existsSync(path.join(r.dir, 'missy-db.json')));
  });

  await test('database survives restart', () => {
    const again = new Missy(dir);
    assert.ok(again.store.all('tasks').length >= 6);
  });

  await test('corrupt database recovers from backup', () => {
    fs.writeFileSync(path.join(dir, 'missy-db.json'), '{ not json');
    const again = new Missy(dir);
    assert.equal(again.store.meta().recoveredFrom, 'backup');
    assert.ok(again.store.all('projects').length >= 9);
  });

  console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
  fs.rmSync(dir, { recursive: true, force: true });
})();
