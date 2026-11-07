'use strict';
/** The only bridge between the interface and Missy's core. */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('missy', {
  snapshot: () => ipcRenderer.invoke('missy:snapshot'),
  ask: text => ipcRenderer.invoke('missy:ask', text),
  speak: (text, speaker) => ipcRenderer.invoke('missy:speak', text, speaker),
  stopSpeaking: () => ipcRenderer.invoke('missy:stopSpeaking'),
  briefing: () => ipcRenderer.invoke('missy:briefing'),
  shouldBrief: () => ipcRenderer.invoke('missy:shouldBrief'),
  startupBriefing: () => ipcRenderer.invoke('missy:startupBriefing'),
  action: (name, args) => ipcRenderer.invoke('missy:action', name, args),
  transcribe: wav => ipcRenderer.invoke('missy:transcribe', wav),
  micPermission: () => ipcRenderer.invoke('missy:micPermission'),
  openDataFolder: () => ipcRenderer.invoke('missy:openDataFolder'),
  openUrl: url => ipcRenderer.invoke('missy:openUrl', url),
  nativeSpeech: true,
  on: handler => {
    const fn = (_e, msg) => handler(msg.channel, msg.payload);
    ipcRenderer.on('missy:event', fn);
    return () => ipcRenderer.removeListener('missy:event', fn);
  },
});
