'use strict';
/**
 * Morning Operations Protocol.
 * Every line is tagged with whether it came from a REAL check. Systems that are
 * not connected are reported as "not checked" — never as healthy.
 */
const { nowISO, startOfDay, endOfDay, fmtTime, spokenCount, dayKey } = require('./util');
const { Alerts } = require('./alerts');

async function runScan({ store, alerts, ai, voice, reason = 'manual' }) {
  const startedAt = nowISO();
  const sections = [];
  const tasks = store.all('tasks');
  const projects = store.all('projects');
  const pName = id => (projects.find(p => p.id === id) || {}).name || 'General';
  const now = new Date();
  const open = tasks.filter(t => t.status !== 'done' && t.status !== 'archived');

  // ---------- 1. System health ----------
  const health = [];
  const integrity = store.integrityCheck();
  if (integrity.ok) health.push({ level: 'green', text: `Database healthy (${Math.round(integrity.sizeBytes / 1024)} KB, write/read test passed).`, real: true });
  else {
    health.push({ level: 'red', text: `Database problems: ${integrity.problems.join('; ')}`, real: true });
    alerts.raise({ level: 'red', title: 'Database integrity problem', detail: integrity.problems.join('\n'), source: 'scan',
      actionsTaken: ['Detected during scan', 'Automatic backup attempted before any repair'] });
  }

  const lastBackup = store.meta().lastBackupAt ? new Date(store.meta().lastBackupAt) : null;
  const hoursSince = lastBackup ? (now - lastBackup) / 36e5 : Infinity;
  if (hoursSince > 20) {
    alerts.startMaintenance('Backup');
    try {
      const b = store.backup('scan');
      health.push({ level: 'blue', text: `Backup was ${lastBackup ? Math.round(hoursSince) + ' hours old' : 'never made'} — fresh backup saved and verified.`, real: true, file: b.file });
    } catch (err) {
      health.push({ level: 'red', text: `Backup failed: ${err.message}`, real: true });
      alerts.raise({ level: 'red', title: 'Backup failed', detail: err.message, source: 'scan' });
    } finally { alerts.endMaintenance('Backup'); }
  } else {
    health.push({ level: 'green', text: `Last backup ${Math.round(hoursSince)} hours ago.`, real: true });
  }

  const activeAlerts = alerts.active();
  const reds = activeAlerts.filter(a => a.level === 'red' && a.state !== 'contained');
  if (reds.length) health.push({ level: 'red', text: `${reds.length} critical alert(s) still open: ${reds.map(a => a.title + (a.simulated ? ' [SIMULATION]' : '')).join(', ')}`, real: true });

  const failedAutomations = store.all('log').filter(l => l.action === 'automation-failed' && new Date(l.at) > new Date(now - 864e5));
  health.push(failedAutomations.length
    ? { level: 'yellow', text: `${failedAutomations.length} automation failure(s) in the last 24 hours.`, real: true }
    : { level: 'green', text: 'No failed Missy automations in the last 24 hours.', real: true });

  const aiStatus = await ai.status();
  health.push({ level: aiStatus.available && aiStatus.model ? 'green' : 'yellow',
    text: aiStatus.available && aiStatus.model ? `Local AI online (${aiStatus.model}).` : aiStatus.note, real: true, info: true });
  const w = voice.findWhisper();
  health.push({ level: w.ready ? 'green' : 'yellow', text: w.ready ? 'Voice transcription ready (whisper).' : 'Voice transcription not installed — Mac Dictation works in the command bar.', real: true, info: true });
  sections.push({ key: 'health', title: 'System health', items: health });

  // ---------- 2. Revenue & customers ----------
  sections.push({ key: 'revenue', title: 'Revenue & customers', items: [
    { level: 'none', text: 'Orders, subscriptions, payments and customer requests: not connected yet — not checked.', real: false },
    ...open.filter(t => /custom (website|site|design)|inquiry|customer/i.test(t.title))
      .map(t => ({ level: 'yellow', text: `Customer work pending: ${t.title} (${pName(t.projectId)})`, real: true })),
  ] });

  // ---------- 3. Outstanding work ----------
  const overdue = open.filter(t => t.due && new Date(t.due) < now);
  const approvals = open.filter(t => t.needsApproval);
  const inProgress = open.filter(t => t.status === 'active');
  const work = [];
  overdue.forEach(t => work.push({ level: 'yellow', text: `Overdue: ${t.title} — ${pName(t.projectId)}`, real: true, taskId: t.id }));
  approvals.forEach(t => work.push({ level: 'yellow', text: `Needs your approval: ${t.title}`, real: true, taskId: t.id }));
  work.push({ level: 'none', text: `${open.length} open task(s), ${inProgress.length} in progress.`, real: true });
  sections.push({ key: 'work', title: 'Outstanding work', items: work });

  // ---------- 4. Opportunities ----------
  const opp = [];
  const soon = new Date(now.getTime() + 14 * 864e5);
  projects.filter(p => p.launchDate && new Date(p.launchDate) <= soon && new Date(p.launchDate) >= startOfDay(now))
    .forEach(p => opp.push({ level: 'none', text: `${p.name} launches ${new Date(p.launchDate).toDateString()}.`, real: true }));
  open.filter(t => t.revenue).slice(0, 3).forEach(t => opp.push({ level: 'none', text: `Revenue task ready: ${t.title}`, real: true, taskId: t.id }));
  open.filter(t => t.priority === 'high' && !t.needsApproval && !(t.due && new Date(t.due) < now)).slice(0, 3)
    .forEach(t => opp.push({ level: 'none', text: `High priority: ${t.title} (${pName(t.projectId)})`, real: true, taskId: t.id }));
  if (!opp.length) opp.push({ level: 'none', text: 'No launches or revenue-tagged tasks on file yet.', real: true });
  sections.push({ key: 'opportunities', title: 'Business opportunities', items: opp });

  // ---------- 5. Personal schedule ----------
  const todays = store.all('events').filter(e => new Date(e.start) >= startOfDay(now) && new Date(e.start) <= endOfDay(now))
    .sort((a, b) => new Date(a.start) - new Date(b.start));
  const sched = todays.map(e => ({ level: 'none', text: `${fmtTime(e.start)} — ${e.title}${e.calendar === 'personal' ? ' (personal)' : ''}`, real: true }));
  const conflicts = findConflicts(todays);
  conflicts.forEach(([a, b]) => sched.push({ level: 'yellow', text: `Conflict: "${a.title}" overlaps "${b.title}".`, real: true }));
  if (!todays.length) sched.push({ level: 'none', text: 'Nothing on Missy\'s calendar today.', real: true });
  sched.push({ level: 'none', text: 'Google / iCloud calendars: not connected yet — not checked.', real: false });
  sections.push({ key: 'schedule', title: 'Personal schedule', items: sched });

  // ---------- spoken summary ----------
  const s = store.settings();
  const hour = now.getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const parts = [`${greet}, ${s.addressAs}. Your system scan is complete.`];
  if (reds.length) parts.push(`There ${reds.length === 1 ? 'is' : 'are'} ${spokenCount(reds.length, 'critical alert')} open${reds.every(a => a.simulated) ? ', and it is a simulation' : ''}.`);
  else if (!integrity.ok) parts.push('I found a problem with the database.');
  else parts.push('No critical errors were detected in the systems I checked.');
  const bits = [];
  if (approvals.length) bits.push(spokenCount(approvals.length, 'pending approval'));
  if (overdue.length) bits.push(spokenCount(overdue.length, 'overdue task'));
  const unfinished = open.length - overdue.length - approvals.length;
  if (unfinished > 0) bits.push(spokenCount(unfinished, 'unfinished task'));
  if (todays.length) {
    const next = todays.find(e => new Date(e.start) > now);
    bits.push(spokenCount(todays.length, 'appointment') + ' today' + (next ? `, next at ${fmtTime(next.start)}` : ''));
  }
  if (bits.length) parts.push('You have ' + joinList(bits) + '.');
  if (conflicts.length) parts.push(`Heads up: ${spokenCount(conflicts.length, 'calendar conflict')}.`);
  parts.push('Your store and payment systems aren\'t connected yet, so I didn\'t check those.');
  parts.push(`${s.addressAs}, what's first today?`);
  const spoken = parts.join(' ');

  const scan = store.insert('scans', { reason, startedAt, finishedAt: nowISO(), day: dayKey(now), sections, spoken,
    monitored: Alerts.MONITORED, notMonitored: Alerts.NOT_MONITORED }, 'scn');
  store.setMeta({ lastScanAt: scan.finishedAt, lastBriefingDay: reason === 'morning' ? dayKey(now) : store.meta().lastBriefingDay });
  store.logAction('scan', `${reason} scan complete`, { scanId: scan.id });
  // keep 60 scans
  const scans = store.all('scans');
  if (scans.length > 60) { scans.splice(0, scans.length - 60); store.save(); }
  return scan;
}

function findConflicts(events) {
  const out = [];
  for (let i = 0; i < events.length; i++) for (let j = i + 1; j < events.length; j++) {
    const a = events[i], b = events[j];
    if (overlaps(a, b)) out.push([a, b]);
  }
  return out;
}

function overlaps(a, b) {
  const aS = new Date(a.start), aE = new Date(a.end || new Date(aS.getTime() + 36e5));
  const bS = new Date(b.start), bE = new Date(b.end || new Date(bS.getTime() + 36e5));
  return aS < bE && bS < aE;
}

function joinList(arr) {
  if (arr.length <= 1) return arr.join('');
  return arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1];
}

module.exports = { runScan, findConflicts, overlaps, joinList };
