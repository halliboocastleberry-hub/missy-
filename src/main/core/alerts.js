'use strict';
/**
 * Color-coded operational status.
 *
 *  RED    critical — stays red until the danger is CONTAINED (acknowledging is not enough)
 *  YELLOW attention required — approvals, overdue work, noncritical errors
 *  BLUE   maintenance in progress — backups, sync
 *  GREEN  every MONITORED system is normal (never a claim about unmonitored systems)
 */
const { nowISO } = require('./util');

const LEVELS = ['green', 'blue', 'yellow', 'red'];

class Alerts {
  constructor(store, emit) {
    this.store = store;
    this.emit = emit || (() => {});
    this.maintenance = new Map(); // name -> started
  }

  raise({ level, title, detail = '', source = 'system', simulated = false, security = false, actionsTaken = [] }) {
    if (!['red', 'yellow'].includes(level)) throw new Error('Alerts are red or yellow; blue/green are statuses');
    // de-duplicate an identical open alert
    const existing = this.store.all('alerts').find(a => a.state !== 'resolved' && a.title === title && a.source === source && a.simulated === simulated);
    if (existing) return existing;
    const alert = this.store.insert('alerts', {
      level, title, detail, source, simulated, security,
      state: 'open', actionsTaken, history: [{ at: nowISO(), event: 'raised' }],
    }, 'alr');
    this.store.logAction('alert', `${level.toUpperCase()}: ${title}${simulated ? ' (SIMULATION)' : ''}`, { alertId: alert.id });
    this.emit('alert:new', alert);
    this.emit('status', this.status());
    return alert;
  }

  _transition(alertId, event, patch) {
    const a = this.store.get('alerts', alertId);
    if (!a) return { ok: false, error: 'Alert not found' };
    a.history.push({ at: nowISO(), event });
    this.store.update('alerts', alertId, patch);
    this.store.logAction('alert', `${event}: ${a.title}`, { alertId });
    this.emit('status', this.status());
    return { ok: true, alert: a };
  }

  acknowledge(alertId) {
    // Acknowledged means "I've seen it". A red alert stays red.
    return this._transition(alertId, 'acknowledged', { state: 'acknowledged' });
  }

  contain(alertId, note = '') {
    const a = this.store.get('alerts', alertId);
    if (!a) return { ok: false, error: 'Alert not found' };
    if (note) a.actionsTaken.push(note);
    return this._transition(alertId, 'contained', { state: 'contained' });
  }

  resolve(alertId) {
    const a = this.store.get('alerts', alertId);
    if (!a) return { ok: false, error: 'Alert not found' };
    if (a.level === 'red' && a.state !== 'contained') {
      return { ok: false, error: 'A critical alert can only be resolved after the danger is marked contained.' };
    }
    return this._transition(alertId, 'resolved', { state: 'resolved', resolvedAt: nowISO() });
  }

  addAction(alertId, note) {
    const a = this.store.get('alerts', alertId);
    if (!a) return null;
    a.actionsTaken.push(note);
    this.store.save();
    return a;
  }

  startMaintenance(name) { this.maintenance.set(name, Date.now()); this.emit('status', this.status()); }
  endMaintenance(name) { this.maintenance.delete(name); this.emit('status', this.status()); }

  active() {
    return this.store.all('alerts').filter(a => a.state !== 'resolved');
  }

  /** The single status color for the app border, plus why. */
  status() {
    const open = this.active();
    // red only while not yet contained; contained reds drop to yellow (follow-up needed)
    const reds = open.filter(a => a.level === 'red' && a.state !== 'contained');
    const yellows = open.filter(a => a.level === 'yellow' || (a.level === 'red' && a.state === 'contained'));
    const tasks = this.store.all('tasks');
    const now = Date.now();
    const approvals = tasks.filter(t => t.needsApproval && t.status !== 'done' && t.status !== 'archived');
    const overdue = tasks.filter(t => t.due && t.status !== 'done' && t.status !== 'archived' && new Date(t.due).getTime() < now);

    let level = 'green';
    if (this.maintenance.size) level = 'blue';
    if (yellows.length || approvals.length || overdue.length) level = 'yellow';
    if (reds.length) level = 'red';

    return {
      level,
      reds: reds.length,
      yellows: yellows.length,
      approvals: approvals.length,
      overdue: overdue.length,
      maintenance: [...this.maintenance.keys()],
      simulatedOnly: reds.length > 0 && reds.every(a => a.simulated),
      monitored: Alerts.MONITORED,
      notMonitored: Alerts.NOT_MONITORED,
    };
  }
}

/** Honest list of what Missy can actually see in this version. */
Alerts.MONITORED = ['Missy database', 'Local backups', 'Tasks & deadlines', 'Missy calendar', 'Local AI (Ollama)', 'Voice transcription'];
Alerts.NOT_MONITORED = ['SiteStyles store & orders', 'Payments', 'Customer inbox / CRM', 'Social accounts', 'Websites & hosting', 'Google / iCloud calendars'];

module.exports = { Alerts, LEVELS };
