'use strict';
/**
 * Electron shell for Missy Central. Only window + plumbing live here;
 * all assistant behavior is in ./core so it can move to the cloud later.
 */
const { app, BrowserWindow, ipcMain, shell, systemPreferences, Notification, powerSaveBlocker } = require('electron');
const path = require('path');
const { Missy } = require('./core/missy');

let win = null;
let missy = null;
let scheduler = null;

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send('missy:event', { channel, payload });
}

function emit(channel, payload) {
  send(channel, payload);
  // Red alerts also reach macOS Notification Center, even if the window is hidden.
  if (channel === 'alert:new' && payload.level === 'red' && Notification.isSupported()) {
    new Notification({ title: `Missy Central — ${payload.simulated ? 'SIMULATION' : 'CRITICAL'}`, body: payload.title, urgency: 'critical' }).show();
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1480, height: 920, minWidth: 1100, minHeight: 720,
    backgroundColor: '#03040a',
    titleBarStyle: 'hiddenInset',
    title: 'Missy Central',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

function startScheduler() {
  // Background loop while the Mac is awake: daily briefing, deadline reminders, nightly backup.
  const remindedTaskIds = new Set();
  scheduler = setInterval(async () => {
    try {
      const now = new Date();
      if (missy.shouldAutoBrief() && now.getHours() >= 5) {
        const r = await missy.morningBriefing('morning');
        send('briefing', r);
        if (r.speak) missy.voice.speak(r.text, 'assistant');
      }
      // reminders 15 min before events
      for (const e of missy.store.all('events')) {
        const mins = (new Date(e.start) - now) / 60000;
        if (mins > 0 && mins <= 15 && !e.reminded) {
          missy.store.update('events', e.id, { reminded: true });
          const msg = `${missy.store.settings().addressAs}, ${e.title} starts in ${Math.round(mins)} minutes.`;
          send('missy:say', { text: msg });
          missy.voice.speak(msg);
          if (Notification.isSupported()) new Notification({ title: 'Missy Central', body: msg }).show();
        }
      }
      // tasks that just became overdue
      for (const t of missy.store.all('tasks')) {
        if (t.due && t.status !== 'done' && t.status !== 'archived' && new Date(t.due) < now && !t.overdueNotified && !remindedTaskIds.has(t.id)) {
          remindedTaskIds.add(t.id);
          missy.store.update('tasks', t.id, { overdueNotified: true });
          send('missy:say', { text: `"${t.title}" is now overdue.` });
        }
      }
      // nightly backup
      const last = missy.store.meta().lastBackupAt;
      if (!last || now - new Date(last) > 24 * 36e5) missy.action('backup');
      send('status', missy.alerts.status());
    } catch (err) {
      missy.store.logAction('automation-failed', `Scheduler: ${err.message}`);
    }
  }, 60 * 1000);
}

app.whenReady().then(async () => {
  missy = new Missy(path.join(app.getPath('userData'), 'data'), emit);
  missy.store.logAction('startup', 'Missy Central started');

  ipcMain.handle('missy:snapshot', () => missy.snapshot());
  ipcMain.handle('missy:ask', async (_e, text) => {
    const r = await missy.handle(text);
    if (r.reveal) shell.showItemInFolder(r.reveal);
    return r;
  });
  ipcMain.handle('missy:speak', (_e, text, speaker) => missy.voice.speak(text, speaker));
  ipcMain.handle('missy:stopSpeaking', () => missy.voice.stop());
  ipcMain.handle('missy:briefing', async () => missy.morningBriefing('manual'));
  ipcMain.handle('missy:shouldBrief', () => missy.shouldAutoBrief());
  ipcMain.handle('missy:startupBriefing', async () => missy.morningBriefing('morning'));
  ipcMain.handle('missy:action', async (_e, name, args) => {
    const r = await missy.action(name, args);
    if (name === 'export' && r && r.dir) shell.openPath(r.dir);
    return r;
  });
  ipcMain.handle('missy:transcribe', async (_e, wav) => missy.voice.transcribe(wav));
  ipcMain.handle('missy:micPermission', async () => {
    if (process.platform !== 'darwin') return true;
    const st = systemPreferences.getMediaAccessStatus('microphone');
    if (st === 'granted') return true;
    return systemPreferences.askForMediaAccess('microphone');
  });
  ipcMain.handle('missy:openDataFolder', () => shell.openPath(missy.store.dataDir));
  ipcMain.handle('missy:openUrl', (_e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });

  createWindow();
  startScheduler();
  // keep timers honest while the window is in the background (does not keep the Mac awake)
  powerSaveBlocker.start('prevent-app-suspension');

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  // On macOS Missy keeps running in the Dock so reminders and backups continue.
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (scheduler) clearInterval(scheduler);
  if (missy) { missy.voice.stop(); missy.store.logAction('shutdown', 'Missy Central closed'); }
});
