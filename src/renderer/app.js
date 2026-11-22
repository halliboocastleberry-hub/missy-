/* Missy Central — interface controller. All data comes from window.missy (preload bridge). */
(function () {
  'use strict';
  const api = window.missy;
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtTime = d => new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const fmtDate = d => new Date(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const isToday = d => new Date(d).toDateString() === new Date().toDateString();
  const STATUS_TEXT = { green: 'Monitored systems normal', blue: 'Maintenance in progress', yellow: 'Attention required', red: 'Critical' };

  let snap = null;
  let tab = 'tasks';
  let taskFilter = 'open';
  let projectFilter = null;
  let memoryKind = 'decision';
  let focusProject = null;
  let speakingNative = false;
  let micInfo = { whisper: { ready: false } };
  let aiInfo = { available: false };

  // ---------------------------------------------------------------- presence
  let presence = null, presenceStyle = null;
  function makePresence(style) {
    if (presenceStyle === style && presence) return;
    if (presence) presence.destroy();
    // a WebGL canvas can't switch renderers, so swap in a fresh canvas
    const old = $('#brain'), fresh = old.cloneNode(false);
    old.replaceWith(fresh);
    presence = style === 'classic' || !window.createNeonBrainPresence ? window.createBrainPresence(fresh)
      : style === 'neon' ? window.createNeonBrainPresence(fresh) : window.createGlassBrainPresence(fresh);
    presenceStyle = style;
    labelBrain();
  }
  function labelBrain() {
    if (!presence || !presence.setLabels || !snap) return;
    const items = snap.projects.filter(p => p.key !== 'personal' && p.status !== 'archived').slice(0, 8).map(p => ({ id: p.id, name: p.name }));
    const sig = items.map(i => i.name).join('|');
    if (labelBrain.sig === sig && labelBrain.for === presence) return;
    labelBrain.sig = sig; labelBrain.for = presence;
    presence.setLabels(items, it => { projectFilter = it.id; focusProject = it.id; taskFilter = 'open'; setTab('tasks'); });
  }
  let busy = false, listening = false, speaking = false;
  function syncState() {
    let s = 'idle';
    if (snap && snap.status.level === 'red') s = 'alert';
    if (speaking) s = 'speaking';
    if (busy) s = 'processing';
    if (listening) s = 'listening';
    if (presence) presence.setState(s);
    document.body.dataset.state = s;
    $('#stateLabel').textContent = { idle: 'Online', listening: 'Listening', processing: 'Thinking', speaking: 'Speaking', alert: 'Critical alert' }[s];
  }
  // gentle "voice energy" while speaking
  setInterval(() => { if (!presence) return; if (speaking && !listening) presence.setLevel(0.25 + Math.random() * 0.45); else if (!listening) presence.setLevel(0); }, 120);

  // ---------------------------------------------------------------- speech out
  let talker = null; // which team member is speaking (for her portrait glow)
  let listenAfterSpeech = false;
  async function say(text, speaker = 'assistant', { followUp = false } = {}) {
    listenAfterSpeech = followUp && Boolean(snap && snap.settings.handsFree !== false) && /\?\s*$/.test(String(text || ''));
    if (!text || !snap || !snap.settings.spokenResponses) return;
    talker = speaker; renderTeamGlow();
    if (api.nativeSpeech) { api.speak(text, speaker); return; }
    // browser fallback (preview mode)
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text.replace(/[*_#`]/g, ''));
      const m = (snap.settings.team || {})[speaker] || {};
      u.rate = Math.max(0.6, Math.min(1.6, (m.rate || 185) / 180));
      u.pitch = m.pitch || (speaker === 'manager' ? 0.9 : 1.2);
      const v = pickBrowserVoice(m.voice, speaker);
      if (v) u.voice = v;
      u.onstart = () => { speaking = true; syncState(); };
      u.onend = u.onerror = () => {
        speaking = false; syncState(); renderTeamGlow();
        if (listenAfterSpeech && canBrowserListen()) { listenAfterSpeech = false; setTimeout(() => { if (!listening && !busy) startListening(); }, 350); }
      };
      speechSynthesis.speak(u);
    } catch { /* no speech available */ }
  }
  // Best available voice in the browser: her chosen one, else the sweetest-sounding installed voice
  const VOICE_PREFS = {
    assistant: ['Ava (Premium)', 'Zoe (Premium)', 'Samantha (Enhanced)', 'Ava (Enhanced)', 'Zoe (Enhanced)', 'Samantha', 'Google US English', 'Allison', 'Ava', 'Zoe'],
    manager: ['Karen (Premium)', 'Karen (Enhanced)', 'Karen', 'Moira', 'Victoria', 'Google UK English Female', 'Samantha'],
  };
  function englishVoices() { try { return speechSynthesis.getVoices().filter(v => /^en/i.test(v.lang)); } catch { return []; } }
  function pickBrowserVoice(wanted, speaker) {
    const vs = englishVoices(); if (!vs.length) return null;
    if (wanted) { const exact = vs.find(v => v.name === wanted) || vs.find(v => v.name.startsWith(wanted)); if (exact) return exact; }
    for (const n of VOICE_PREFS[speaker] || []) { const v = vs.find(x => x.name === n); if (v) return v; }
    return vs.find(v => /female|samantha|ava|zoe|allison/i.test(v.name)) || vs[0];
  }
  try { speechSynthesis.onvoiceschanged = () => { if (tab === 'settings') hydrateSettings(); }; } catch {}

  function stopSpeaking() { api.stopSpeaking(); try { speechSynthesis.cancel(); } catch {} speaking = false; syncState(); }

  // ---------------------------------------------------------------- transcript
  function bubble(who, text, urgent, speaker = 'assistant') {
    const box = $('#transcript');
    const b = document.createElement('div');
    b.className = `bubble ${who}${who === 'missy' && speaker === 'manager' ? ' boss' : ''}${urgent ? ' urgent' : ''}`;
    if (who === 'missy') b.dataset.name = teamName(speaker).toUpperCase();
    b.textContent = text;
    box.appendChild(b);
    while (box.children.length > 3) box.firstChild.remove();
    clearTimeout(bubble.t);
    bubble.t = setTimeout(() => { [...box.children].forEach(c => { c.style.transition = 'opacity 1s'; c.style.opacity = '0'; }); setTimeout(() => (box.innerHTML = ''), 1000); }, 45000);
  }

  function toast(text, level) {
    const t = document.createElement('div');
    t.className = `toast ${level || ''}`;
    t.textContent = text;
    $('#toasts').appendChild(t);
    setTimeout(() => t.remove(), level === 'red' ? 12000 : 5000);
  }

  // ---------------------------------------------------------------- talking to Missy
  async function ask(text) {
    text = text.trim();
    if (!text) return;
    stopSpeaking();
    bubble('you', text);
    busy = true; syncState();
    try {
      const r = await api.ask(text);
      bubble('missy', r.text, false, r.speaker);
      if (r.speak !== false) say(r.text, r.speaker, { followUp: true });
      if (r.panel === 'briefing') { await refresh(); showBriefing(snap.lastScan); }
      else if (r.panel && r.panel !== 'help') setTab(r.panel === 'settings' ? 'settings' : r.panel);
      if (r.focusProject) { focusProject = r.focusProject; setTab('projects'); }
    } catch (err) {
      bubble('missy', 'I hit an error: ' + err.message);
    } finally { busy = false; syncState(); }
  }

  $('#askForm').addEventListener('submit', e => { e.preventDefault(); const v = $('#askInput').value; $('#askInput').value = ''; ask(v); });
  $('#muteBtn').addEventListener('click', async () => {
    const on = !snap.settings.spokenResponses;
    await api.action('settings', { spokenResponses: on });
    if (!on) stopSpeaking();
    toast(on ? 'Missy\'s voice is on' : 'Missy is muted');
  });

  // ---------------------------------------------------------------- push-to-talk
  const recorder = window.createRecorder({ onLevel: v => { if (presence) presence.setLevel(v); $('#micBtn').style.setProperty('--lvl', v); } });
  // Chrome/Safari built-in speech recognition — free, nothing to install (used when whisper isn't set up)
  const BrowserSR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const canBrowserListen = () => Boolean(BrowserSR) && !api.nativeSpeech;
  let rec = null;
  function browserListen() {
    let finalText = '';
    rec = new BrowserSR();
    rec.lang = 'en-US'; rec.interimResults = true; rec.continuous = false;
    rec.onresult = e => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript;
      }
      $('#askInput').value = finalText + interim;
      if (presence) presence.setLevel(0.55);
    };
    rec.onerror = e => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('Click "Allow" for the microphone (or allow it in the address bar), then try again.', 'yellow');
      else if (e.error !== 'no-speech' && e.error !== 'aborted') toast('Listening problem: ' + e.error, 'yellow');
    };
    rec.onend = () => {
      rec = null; listening = false; if (presence) presence.setLevel(0); syncState();
      const said = finalText.trim() || $('#askInput').value.trim();
      $('#askInput').value = '';
      if (said) ask(said);
    };
    rec.start();
    listening = true; syncState();
  }

  async function startListening() {
    if (listening) return;
    stopSpeaking();
    if (!micInfo.whisper.ready && canBrowserListen()) { try { browserListen(); } catch (err) { toast('Microphone unavailable: ' + err.message, 'yellow'); } return; }
    if (!micInfo.whisper.ready) {
      $('#askInput').focus();
      toast('Voice transcription isn\'t installed yet — press the Mac dictation key (🎤 or Fn twice) and speak. See Settings → Voice setup.', 'yellow');
      return;
    }
    try {
      await api.micPermission();
      await recorder.start();
      listening = true; syncState();
    } catch (err) { toast('Microphone unavailable: ' + err.message, 'yellow'); }
  }
  async function stopListening() {
    if (!listening) return;
    if (rec) { rec.stop(); return; } // onend sends what she said
    listening = false; busy = true; syncState();
    try {
      const wav = await recorder.stop();
      if (!wav) { busy = false; syncState(); return; }
      const r = await api.transcribe(wav);
      busy = false; syncState();
      if (r.ok && r.text) ask(r.text);
      else if (r.ok) toast('I didn\'t catch that.');
      else toast('Transcription failed: ' + r.error, 'yellow');
    } catch (err) { busy = false; syncState(); toast('Voice error: ' + err.message, 'yellow'); }
  }
  let micClickMode = false;
  $('#micBtn').addEventListener('click', () => { if (listening) { micClickMode = false; stopListening(); } else { micClickMode = true; startListening(); } });
  const typing = () => ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
  window.addEventListener('keydown', e => {
    if (e.code === 'Space' && !typing() && !e.repeat) { e.preventDefault(); micClickMode = false; startListening(); }
    if (e.key === 'Escape') { stopSpeaking(); closeOverlay(); }
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); $('#askInput').focus(); }
  });
  window.addEventListener('keyup', e => { if (e.code === 'Space' && !typing() && !micClickMode) { e.preventDefault(); stopListening(); } });

  // ---------------------------------------------------------------- the team (Missy + Miss Claudie)
  const DEFAULT_PORTRAIT = { assistant: 'assets/missy.jpg', manager: 'assets/claudie.jpg' };
  const portraitOf = (m, role) => m.portrait || DEFAULT_PORTRAIT[role];
  function teamName(role) { return (snap && snap.settings.team && snap.settings.team[role] && snap.settings.team[role].name) || (role === 'manager' ? 'Miss Claudie' : 'Missy'); }

  function renderTeam() {
    const box = $('#teamList'); if (!box) return;
    const t = snap.settings.team;
    box.innerHTML = ['assistant', 'manager'].map(role => `
      <div class="member ${role}" data-role="${role}">
        <button class="cameo" data-portrait="${role}" title="Change her picture">
          <img src="${portraitOf(t[role], role)}" alt="${esc(t[role].name)}">
        </button>
        <div class="nm">${esc(t[role].name)}</div>
        <div class="rl">${role === 'manager' ? 'Operations Manager' : 'Executive Assistant'}</div>
      </div>`).join('');
    renderTeamGlow();
  }
  function renderTeamGlow() {
    document.querySelectorAll('.member').forEach(m => m.classList.toggle('speaking', speaking && m.dataset.role === talker));
  }

  // pick a picture, crop to a portrait and shrink it so it stores small
  function pickPortrait(role) {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = () => { if (input.files[0]) savePortrait(role, input.files[0]); };
    input.click();
  }
  function savePortrait(role, file) {
    const img = new Image();
    img.onload = async () => {
      const W = 480, H = 600, c = document.createElement('canvas'); c.width = W; c.height = H;
      const s = Math.max(W / img.width, H / img.height), w = img.width * s, h = img.height * s;
      c.getContext('2d').drawImage(img, (W - w) / 2, Math.min(0, (H - h) * 0.15), w, h); // keep the face near the top
      await api.action('team:update', { role, patch: { portrait: c.toDataURL('image/jpeg', 0.88) } });
      await refresh(); toast(`${teamName(role)}'s picture is in.`);
    };
    img.onerror = () => toast('That picture couldn\'t be opened — try a JPG or PNG.', 'yellow');
    const reader = new FileReader();             // data: URL (the app's security policy blocks blob: images)
    reader.onload = () => { img.src = reader.result; };
    reader.readAsDataURL(file);
  }
  document.addEventListener('dragover', e => { if (e.target.closest && e.target.closest('.cameo')) e.preventDefault(); });
  document.addEventListener('drop', e => {
    const c = e.target.closest && e.target.closest('.cameo'); if (!c) return;
    e.preventDefault(); const f = e.dataTransfer.files[0]; if (f && f.type.startsWith('image/')) savePortrait(c.dataset.portrait, f);
  });

  // ---------------------------------------------------------------- data + rendering
  async function refresh() { snap = await api.snapshot(); render(); }

  function render() {
    if (!snap) return;
    document.body.classList.toggle('theme-gallery', snap.settings.theme !== 'hq');
    makePresence(snap.settings.brainStyle || 'glass');
    labelBrain();
    const st = snap.status;
    document.body.dataset.status = st.level;
    $('#statusText').textContent = STATUS_TEXT[st.level] + (st.level === 'red' && st.simulatedOnly ? ' · simulation' : '') + (st.level === 'blue' ? ` · ${st.maintenance.join(', ')}` : '');
    $('#muteBtn').textContent = snap.settings.spokenResponses ? '🔊' : '🔇';
    const openAlerts = snap.alerts.filter(a => a.state !== 'resolved').length;
    $('#alertCount').hidden = !openAlerts; $('#alertCount').textContent = openAlerts;
    renderTeam(); renderAttention(); renderToday(); renderPanel(); syncState();
    const ls = snap.lastScan;
    $('#lastScan').textContent = ls ? `Last scan ${fmtDate(ls.finishedAt)} ${fmtTime(ls.finishedAt)}` : 'No scan yet';
  }

  const pName = id => (snap.projects.find(p => p.id === id) || {}).name || 'General';
  const pColor = id => (snap.projects.find(p => p.id === id) || {}).color || '#94a3b8';
  const openTasks = () => snap.tasks.filter(t => t.status !== 'done' && t.status !== 'archived');

  function renderAttention() {
    const items = [];
    snap.alerts.filter(a => a.state !== 'resolved').forEach(a => items.push({
      lvl: a.level === 'red' && a.state !== 'contained' ? 'red' : 'yellow', title: a.title,
      meta: `${a.simulated ? '<span class="tag sim">Simulation</span>' : ''} ${esc(a.state)}`, act: `<button class="icon-btn" data-goto="alerts">›</button>` }));
    const now = new Date();
    openTasks().filter(t => t.needsApproval).forEach(t => items.push({ lvl: 'yellow', title: t.title,
      meta: `<span class="tag approve">Approval</span> ${esc(pName(t.projectId))}`, act: `<button class="ghost-btn small gold" data-approve="${t.id}">Approve</button>` }));
    openTasks().filter(t => t.due && new Date(t.due) < now).forEach(t => items.push({ lvl: 'yellow', title: t.title, meta: `Overdue · ${esc(pName(t.projectId))}`, act: '' }));
    $('#attentionList').innerHTML = items.length ? items.slice(0, 8).map(i => `
      <div class="item"><span class="lvl ${i.lvl}"></span><div class="body"><div class="title">${esc(i.title)}</div><div class="meta">${i.meta}</div></div>${i.act}</div>`).join('')
      : `<div class="empty">Nothing needs you in the systems Missy monitors.</div>`;
  }

  function renderToday() {
    $('#todayLabel').textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    const events = snap.events.filter(e => isToday(e.start)).sort((a, b) => new Date(a.start) - new Date(b.start));
    const due = openTasks().filter(t => t.due && isToday(t.due));
    const rows = [
      ...events.map(e => `<div class="item"><span class="lvl ${new Date(e.end || e.start) < new Date() ? '' : 'green'}"></span><div class="body"><div class="title">${esc(e.title)}</div><div class="meta">${fmtTime(e.start)} · ${esc(e.calendar)}</div></div></div>`),
      ...due.map(t => `<div class="item"><span class="lvl yellow"></span><div class="body"><div class="title">${esc(t.title)}</div><div class="meta">Task due ${fmtTime(t.due)}</div></div></div>`),
    ];
    $('#todayList').innerHTML = rows.length ? rows.join('') : '<div class="empty">Clear calendar today.</div>';
  }

  function setTab(name) {
    if (!['tasks', 'calendar', 'projects', 'alerts', 'memory', 'stickies', 'log', 'settings'].includes(name)) return;
    tab = name;
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
    renderPanel();
  }
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('button[data-tab]'); if (b) setTab(b.dataset.tab); });

  function renderPanel() {
    const el = $('#panel');
    const keep = document.activeElement && el.contains(document.activeElement) && document.activeElement.tagName === 'INPUT';
    if (keep) return; // don't wipe a form she's typing into
    el.innerHTML = ({ tasks: panelTasks, calendar: panelCalendar, projects: panelProjects, alerts: panelAlerts, memory: panelMemory, stickies: panelStickies, log: panelLog, settings: panelSettings })[tab]();
    if (tab === 'settings') hydrateSettings();
  }

  const projectOptions = (sel) => `<option value="">General</option>` + snap.projects.map(p => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)}</option>`).join('');


  function panelStickies() {
    const colors = { gold: '#e8c15a', rose: '#ff92b6', mint: '#5addbb', blue: '#90bdff', lavender: '#c9a6ff' };
    const list = (snap.stickies || []).filter(x => !x.archived).sort((a, b) => Number(b.pinned) - Number(a.pinned) || String(b.createdAt).localeCompare(String(a.createdAt)));
    return `
      <form id="stickyForm" class="grid2">
        <input name="text" class="field full" maxlength="1000" placeholder="What's on your mind? Pin a note…" required aria-label="Sticky note text">
        <select name="scope" class="field" aria-label="Sticky note area">
          <option value="general">My day</option><option value="home">Home</option><option value="business">Business</option><option value="creator">Creator</option>
        </select>
        <select name="color" class="field" aria-label="Sticky note color">
          <option value="gold">Champagne</option><option value="rose">Rose</option><option value="mint">Mint</option><option value="blue">Blue</option><option value="lavender">Lavender</option>
        </select>
        <button class="ghost-btn pink full">Pin sticky</button>
      </form>
      <div class="stack">${list.length ? list.map(note => `
        <div class="item ${note.done ? 'done' : ''}" style="border-left:3px solid ${colors[note.color] || colors.gold}">
          <button class="check ${note.done ? 'on' : ''}" data-sticky-done="${note.id}" aria-label="${note.done ? 'Mark unfinished' : 'Mark complete'}">${note.done ? '✓' : ''}</button>
          <div class="body"><div class="title">${esc(note.text)}</div>
            <div class="meta">${esc(note.scope || 'general')} · ${note.pinned ? 'Pinned' : 'Unpinned'}</div>
          </div>
          <button class="icon-btn" data-sticky-pin="${note.id}" aria-label="${note.pinned ? 'Unpin' : 'Pin'}" title="${note.pinned ? 'Unpin' : 'Pin'}">📌</button>
          <button class="icon-btn" data-sticky-archive="${note.id}" aria-label="Archive note" title="Archive">✕</button>
        </div>`).join('') : '<div class="empty">No stickies yet. Add a quick thought, or tell Missy “pin a sticky saying buy bread.”</div>'}</div>`;
  }

  function panelTasks() {
    let list = snap.tasks.filter(t => t.status !== 'archived');
    if (taskFilter === 'open') list = list.filter(t => t.status !== 'done');
    if (taskFilter === 'approval') list = list.filter(t => t.needsApproval && t.status !== 'done');
    if (taskFilter === 'done') list = list.filter(t => t.status === 'done');
    if (projectFilter) list = list.filter(t => t.projectId === projectFilter);
    const rank = t => (t.needsApproval ? 0 : 1) * 10 + (t.priority === 'high' ? 0 : t.priority === 'low' ? 2 : 1) + (t.status === 'active' ? -0.5 : 0);
    list.sort((a, b) => rank(a) - rank(b) || (a.due ? new Date(a.due) : 9e15) - (b.due ? new Date(b.due) : 9e15));
    const now = new Date();
    return `
      <form id="taskForm" class="grid2">
        <input class="field full" name="title" placeholder="New task…" required>
        <select class="field" name="projectId">${projectOptions(projectFilter)}</select>
        <input class="field" name="due" type="datetime-local">
        <select class="field" name="priority"><option value="normal">Normal priority</option><option value="high">High priority</option><option value="low">Low priority</option></select>
        <button class="ghost-btn pink">Add task</button>
      </form>
      <div class="filters">
        ${['open', 'approval', 'done', 'all'].map(f => `<button data-tfilter="${f}" class="${taskFilter === f ? 'on' : ''}">${{ open: 'Open', approval: 'Needs approval', done: 'Done', all: 'All' }[f]}</button>`).join('')}
        ${projectFilter ? `<button data-pfilter="" class="on">${esc(pName(projectFilter))} ✕</button>` : ''}
      </div>
      <div class="stack">${list.length ? list.map(t => `
        <div class="item ${t.status === 'done' ? 'done' : ''}">
          <button class="check ${t.status === 'done' ? 'on' : ''}" data-toggle="${t.id}" title="Mark done">${t.status === 'done' ? '✓' : ''}</button>
          <div class="body">
            <div class="title">${esc(t.title)}</div>
            <div class="meta"><span><i class="pdot" style="background:${pColor(t.projectId)}"></i>${esc(pName(t.projectId))}</span>
              ${t.due ? `<span style="color:${new Date(t.due) < now && t.status !== 'done' ? 'var(--yellow)' : ''}">${fmtDate(t.due)} ${fmtTime(t.due)}</span>` : ''}
              ${t.status === 'active' ? '<span class="tag real">In progress</span>' : ''}
              ${t.priority === 'high' ? '<span class="tag high">High</span>' : ''}
              ${t.needsApproval && t.status !== 'done' ? `<span class="tag approve">Needs approval</span>` : ''}
              ${t.source === 'ai-plan' ? '<span class="tag unchecked">AI plan</span>' : ''}</div>
          </div>
          ${t.needsApproval && t.status !== 'done' ? `<button class="ghost-btn small gold" data-approve="${t.id}">Approve</button>` : ''}
          ${t.status === 'todo' ? `<button class="icon-btn" data-start="${t.id}" title="Start">▶</button>` : ''}
          <button class="icon-btn" data-archive="${t.id}" title="Archive">✕</button>
        </div>`).join('') : '<div class="empty">No tasks here.</div>'}</div>`;
  }

  function panelCalendar() {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const events = snap.events.filter(e => new Date(e.start) >= start).sort((a, b) => new Date(a.start) - new Date(b.start));
    const byDay = {};
    events.forEach(e => { const k = new Date(e.start).toDateString(); (byDay[k] = byDay[k] || []).push(e); });
    return `
      <form id="eventForm" class="grid2">
        <input class="field full" name="title" placeholder="Appointment or meeting…" required>
        <input class="field" name="start" type="datetime-local" required>
        <select class="field" name="mins"><option value="30">30 min</option><option value="60" selected>1 hour</option><option value="90">1.5 hours</option><option value="120">2 hours</option></select>
        <select class="field" name="calendar"><option value="business">Business calendar</option><option value="personal">Personal calendar</option></select>
        <button class="ghost-btn pink">Book</button>
      </form>
      <div class="muted tiny" style="margin-bottom:10px">This is Missy's own calendar. Google / iCloud sync is a Phase 2 connection — nothing is sent anywhere yet.</div>
      ${Object.keys(byDay).length ? Object.entries(byDay).map(([day, evs]) => `
        <div class="section-title">${isToday(day) ? 'Today' : fmtDate(day)}</div>
        <div class="stack">${evs.map(e => `<div class="item"><span class="lvl ${e.calendar === 'personal' ? 'blue' : 'green'}"></span>
          <div class="body"><div class="title">${esc(e.title)}</div><div class="meta">${fmtTime(e.start)}–${fmtTime(e.end || e.start)} · ${esc(e.calendar)}${e.withOthers ? ' · with others' : ''}</div></div>
          <button class="icon-btn" data-delevent="${e.id}" title="Remove">✕</button></div>`).join('')}</div>`).join('') : '<div class="empty">Nothing scheduled. Try “Missy, schedule a client call tomorrow at 2.”</div>'}`;
  }

  function panelProjects() {
    return `
      <form id="projectForm" class="inline"><input class="field" name="name" placeholder="Register a new business…" required><button class="ghost-btn gold">Add</button></form>
      <div class="proj-grid">${snap.projects.map(p => {
        const ts = snap.tasks.filter(t => t.projectId === p.id && t.status !== 'archived');
        const open = ts.filter(t => t.status !== 'done');
        const appr = open.filter(t => t.needsApproval).length;
        return `<div class="proj ${focusProject === p.id ? 'focus' : ''}" style="--pc:${p.color}" data-proj="${p.id}">
          <div class="pn">${esc(p.name)}</div>
          <div class="ps">${open.length} open · ${ts.length - open.length} done${appr ? ` · <span style="color:var(--yellow)">${appr} approval</span>` : ''}</div>
          <div class="ps">${esc((p.focus || []).slice(0, 2).join(' · '))}</div></div>`;
      }).join('')}</div>
      <div class="muted tiny" style="margin-top:12px">Click a business to see its tasks. Live checks (website, GitHub, Stripe) are set up in Settings → Business connections — ask "check SiteStyles" to run them.</div>`;
  }

  function panelAlerts() {
    const list = [...snap.alerts].sort((a, b) => (a.state === 'resolved') - (b.state === 'resolved') || new Date(b.createdAt) - new Date(a.createdAt));
    return `
      <div class="legend">
        <span class="sw" style="background:var(--red)"></span><span><b>Red — critical.</b> Stays red until the danger is <i>contained</i>. Acknowledging doesn't clear it.</span>
        <span class="sw" style="background:var(--yellow)"></span><span><b>Yellow — attention.</b> Approvals, overdue work, noncritical errors.</span>
        <span class="sw" style="background:var(--blue)"></span><span><b>Blue — maintenance.</b> A backup or sync is running.</span>
        <span class="sw" style="background:var(--green)"></span><span><b>Green — monitored systems normal.</b> Says nothing about systems that aren't connected.</span>
      </div>
      <div class="section-title">Alerts</div>
      <div class="stack">${list.length ? list.slice(0, 40).map(a => `
        <div class="item ${a.state === 'resolved' ? 'done' : ''}"><span class="lvl ${a.state === 'resolved' ? '' : a.level === 'red' && a.state !== 'contained' ? 'red' : 'yellow'}"></span>
          <div class="body"><div class="title">${esc(a.title)}</div>
            <div class="meta">${a.simulated ? '<span class="tag sim">Simulation</span>' : '<span class="tag real">Real</span>'} <span>${esc(a.state)}</span> <span>${fmtDate(a.createdAt)} ${fmtTime(a.createdAt)}</span></div>
            ${a.detail ? `<div class="meta">${esc(a.detail)}</div>` : ''}
            ${a.actionsTaken && a.actionsTaken.length ? `<div class="meta">Actions: ${esc(a.actionsTaken.join(' · '))}</div>` : ''}
            ${a.state !== 'resolved' ? `<div class="row" style="margin-top:8px">
              ${a.state === 'open' ? `<button class="ghost-btn small" data-ack="${a.id}">Acknowledge</button>` : ''}
              ${a.level === 'red' && a.state !== 'contained' ? `<button class="ghost-btn small gold" data-contain="${a.id}">Mark contained</button>` : ''}
              <button class="ghost-btn small" data-resolve="${a.id}" ${a.level === 'red' && a.state !== 'contained' ? 'disabled title="Contain it first"' : ''}>Resolve</button></div>` : ''}
          </div></div>`).join('') : '<div class="empty">No alerts on record.</div>'}</div>
      <div class="section-title">Test the alert system</div>
      <div class="row"><button class="ghost-btn small danger" data-sim="red">Simulate critical alert</button><button class="ghost-btn small pink" data-sim="security">Simulate security alert</button><button class="ghost-btn small" data-sim="yellow">Simulate attention alert</button></div>
      <div class="muted tiny" style="margin-top:6px">Simulations are labeled SIMULATION everywhere and never touch a real system.</div>`;
  }

  function panelMemory() {
    const kinds = { decision: 'Approved decisions', idea: 'Ideas', note: 'Notes', archived: 'Archived' };
    const items = snap.knowledge.filter(k => k.kind === memoryKind).slice().reverse();
    return `
      <div class="filters">${Object.entries(kinds).map(([k, v]) => `<button data-mkind="${k}" class="${memoryKind === k ? 'on' : ''}">${v} (${snap.knowledge.filter(x => x.kind === k).length})</button>`).join('')}</div>
      ${memoryKind !== 'archived' ? `<form id="memForm" class="inline"><input class="field" name="text" placeholder="${memoryKind === 'idea' ? 'Park an idea…' : memoryKind === 'decision' ? 'Record an approved decision…' : 'Add a note…'}" required><button class="ghost-btn gold">Save</button></form>` : ''}
      <div class="stack">${items.length ? items.map(k => `<div class="item"><span class="lvl ${k.kind === 'decision' ? 'green' : k.kind === 'idea' ? 'yellow' : ''}"></span>
        <div class="body"><div class="title">${esc(k.text)}</div><div class="meta">${k.projectId ? esc(pName(k.projectId)) + ' · ' : ''}${fmtDate(k.createdAt)}${k.previous ? ' · edited' : ''}</div></div>
        ${k.kind === 'idea' ? `<button class="ghost-btn small gold" data-promote="${k.id}" title="Approve as a decision">Approve</button>` : ''}
        ${k.kind !== 'archived' ? `<button class="icon-btn" data-karchive="${k.id}" title="Archive">✕</button>` : ''}</div>`).join('') : '<div class="empty">Nothing here yet. Say “Missy, idea: …” or “decision: …”.</div>'}</div>`;
  }

  function panelLog() {
    return `<div class="stack">${snap.log.slice(0, 150).map(l => `<div class="item"><div class="body"><div class="title">${esc(l.detail || l.action)}</div><div class="meta"><span class="tag unchecked">${esc(l.action)}</span> ${fmtDate(l.at)} ${fmtTime(l.at)}</div></div></div>`).join('')}</div>`;
  }

  function panelSettings() {
    const s = snap.settings;
    const sw = (key, label) => `<div class="toggle"><span>${label}</span><button class="switch ${s[key] ? 'on' : ''}" data-switch="${key}"></button></div>`;
    return `
      <div class="section-title">Voice & briefing</div>
      ${sw('spokenResponses', 'Missy speaks her replies')}
      ${sw('autoBriefing', 'Automatic morning briefing')}
      ${sw('spokenBriefing', 'Speak the morning briefing')}
      <div class="toggle"><span>Brain style</span><select class="field" style="width:190px" data-setting="brainStyle">${[['glass', 'Glass + lightning'], ['neon', 'Solid neon'], ['classic', 'Classic particles']].map(([v, l]) => `<option value="${v}" ${(s.brainStyle || 'glass') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="toggle"><span>Look</span><select class="field" style="width:190px" data-setting="theme"><option value="gallery" ${s.theme !== 'hq' ? 'selected' : ''}>Luxury Gallery</option><option value="hq" ${s.theme === 'hq' ? 'selected' : ''}>Neon HQ (original)</option></select></div>
      <div class="toggle"><span>They call you</span><input class="field" style="width:170px" data-setting="addressAs" value="${esc(s.addressAs)}"></div>

      <div class="section-title">The team</div>
      ${['assistant', 'manager'].map(role => { const m = s.team[role]; return `
        <div class="team-set">
          <button class="cameo small" data-portrait="${role}" title="Add or change her picture"><img src="${portraitOf(m, role)}" alt=""></button>
          <div style="flex:1">
            <div class="toggle"><span>${role === 'manager' ? 'Manager' : 'Assistant'}</span><input class="field" style="width:150px" data-team="${role}" data-key="name" value="${esc(m.name)}"></div>
            <div class="toggle"><span>Voice</span><select class="field voiceSel" style="width:150px" data-team="${role}" data-key="voice"><option value="${esc(m.voice)}">${esc(m.voice || 'System default')}</option></select></div>
            <div class="toggle"><span>Speed</span><input class="field" style="width:80px" type="number" min="120" max="260" data-team="${role}" data-key="rate" value="${m.rate}"></div>
            <div class="toggle"><span>Sweetness (pitch)</span><input class="field" style="width:80px" type="number" min="0.5" max="2" step="0.05" data-team="${role}" data-key="pitch" value="${m.pitch || 1}"></div>
            <div class="row"><button class="ghost-btn small" data-testvoice="${role}">Hear her</button>${m.portrait ? `<button class="ghost-btn small" data-clearportrait="${role}">Use original picture</button>` : ''}</div>
          </div>
        </div>`; }).join('')}

      <div class="section-title">This Mac</div>
      <div id="hwBox" class="kv"><div>Checking…</div><div></div></div>

      <div class="section-title">Missy's AI brain</div>
      <div id="aiBox" class="muted tiny">Checking…</div>
      <div class="setup-step tiny">
        <b>Free Google Gemini key (recommended):</b> go to <a href="#" data-url="https://aistudio.google.com/apikey">aistudio.google.com/apikey</a>, sign in with Google, click <i>Create API key</i>, copy it, paste it here and press Save. No card needed.
        <div class="row" style="margin-top:8px"><input class="field" style="flex:1" type="password" id="key-geminiKey" placeholder="${snap.secrets.geminiKey ? esc(snap.secrets.geminiKey) : 'Paste Gemini key'}" autocomplete="off"><button class="ghost-btn small gold" data-savekey="geminiKey">Save</button>${snap.secrets.geminiKey ? '<button class="ghost-btn small" data-clearkey="geminiKey">Remove</button>' : ''}</div>
        <div class="muted" style="margin-top:6px">Google's free tier may use what you say to improve its products, so don't tell Missy passwords or card numbers.</div>
      </div>
      <details class="setup-step tiny"><summary>Other free brains (backup)</summary>
        <div style="margin-top:8px"><b>Groq</b> (free, very fast): key from <a href="#" data-url="https://console.groq.com/keys">console.groq.com/keys</a>
          <div class="row" style="margin-top:6px"><input class="field" style="flex:1" type="password" id="key-groqKey" placeholder="${snap.secrets.groqKey ? esc(snap.secrets.groqKey) : 'Paste Groq key'}" autocomplete="off"><button class="ghost-btn small gold" data-savekey="groqKey">Save</button>${snap.secrets.groqKey ? '<button class="ghost-btn small" data-clearkey="groqKey">Remove</button>' : ''}</div></div>
        <div style="margin-top:8px"><b>Ollama</b> (free, fully private, runs on your Mac — needs 16 GB memory to be good): install from <a href="#" data-url="https://ollama.com/download">ollama.com</a>, then in Terminal <code>ollama pull llama3.2:3b</code>.</div>
        <div class="toggle"><span>Which brain</span><select class="field" style="width:190px" data-ai="provider">${[['auto', 'Automatic (best available)'], ['gemini', 'Gemini only'], ['groq', 'Groq only'], ['ollama', 'Ollama only'], ['off', 'Off (commands only)']].map(([v, l]) => `<option value="${v}" ${((s.ai && s.ai.provider) || 'auto') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      </details>
      ${sw('handsFree', 'Hands-free: listen again after Missy asks a question')}

      <div class="section-title">Business connections</div>
      <div class="muted tiny" style="margin-bottom:8px">Missy only reports what she can actually check. Each check runs live when you ask.</div>
      ${snap.projects.filter(p => p.key !== 'personal' && p.status !== 'archived').map(p => { const c = p.connections || {}; const on = Object.keys(c).length; return `
        <details class="setup-step tiny" ${p.key === 'sitestyles' ? 'open' : ''}><summary><b>${esc(p.name)}</b> ${on ? `<span class="tag real">connected</span>` : '<span class="tag unchecked">not connected</span>'}</summary>
          <div class="toggle"><span>Website</span><input class="field" style="width:210px" data-conn="${p.id}" data-key="website" value="${esc(c.website || '')}" placeholder="https://…"></div>
          <div class="toggle"><span>GitHub repo</span><input class="field" style="width:210px" data-conn="${p.id}" data-key="github" value="${esc(c.github || '')}" placeholder="owner/repo"></div>
          <div class="toggle"><span>Stripe sales</span><button class="switch ${c.stripe ? 'on' : ''}" data-connswitch="${p.id}"></button></div>
          ${p.lastCheck ? `<div class="muted" style="margin:6px 0">Last check ${fmtDate(p.lastCheck.at)} ${fmtTime(p.lastCheck.at)}: ${esc(p.lastCheck.results.map(r => r.summary).join(' '))}</div>` : ''}
          <button class="ghost-btn small gold" data-checkproj="${p.id}">Check now</button>
        </details>`; }).join('')}
      <div class="setup-step tiny"><b>Stripe (read-only):</b> in Stripe go to Developers → API keys → <i>Create restricted key</i>, name it "Missy", set <b>Charges</b> and <b>Balance</b> to <b>Read</b> (everything else None), create it and paste the key that starts with <code>rk_</code>. Missy refuses full secret keys.
        <div class="row" style="margin-top:8px"><input class="field" style="flex:1" type="password" id="key-stripeKey" placeholder="${snap.secrets.stripeKey ? esc(snap.secrets.stripeKey) : 'rk_live_…'}" autocomplete="off"><button class="ghost-btn small gold" data-savekey="stripeKey">Save</button>${snap.secrets.stripeKey ? '<button class="ghost-btn small" data-clearkey="stripeKey">Remove</button>' : ''}</div></div>
      <div class="muted tiny">Keys are stored only on this Mac (secrets.json in Missy's data folder). They're never shown again, backed up, exported or sent to GitHub.</div>

      <div class="section-title">Voice setup (push-to-talk)</div>
      <div id="micBox" class="muted tiny">Checking…</div>
      <div class="toggle"><span>Whisper model file</span><input class="field" style="width:220px" data-setting="whisperModel" value="${esc(s.whisperModel)}" placeholder="auto: ~/missy-models"></div>

      <div class="section-title">Your data</div>
      <div class="row"><button class="ghost-btn small" data-do="backup">Back up now</button><button class="ghost-btn small" data-do="export">Export everything</button><button class="ghost-btn small" data-do="folder">Open data folder</button></div>
      <div class="muted tiny" style="margin-top:6px">Everything stays on this Mac. Last backup: ${snap.meta.lastBackupAt ? fmtDate(snap.meta.lastBackupAt) + ' ' + fmtTime(snap.meta.lastBackupAt) : 'never'}.</div>

      <div class="section-title">What Missy monitors in this version</div>
      <div class="muted tiny"><b style="color:var(--green)">Checked:</b> ${snap.status.monitored.join(', ')}.<br><b>Not connected yet:</b> ${snap.status.notMonitored.join(', ')}.</div>`;
  }

  async function hydrateSettings() {
    const [hw, ai, mic] = await Promise.all([api.action('hardware'), api.action('ai:status'), api.action('voice:status')]);
    aiInfo = ai; micInfo = mic; updateBadges();
    if (tab !== 'settings') return;
    const hwBox = $('#hwBox');
    if (hwBox) hwBox.innerHTML = [['Chip', hw.chip], ['Memory', hw.ramGB + ' GB'], ['Free disk', hw.freeDiskGB != null ? hw.freeDiskGB + ' GB' : '—'], ['macOS', hw.macOS || hw.platform], ['Capability', hw.tier], ['AI advice', hw.aiAdvice], ['Voice advice', hw.whisperAdvice]]
      .map(([k, v]) => `<div>${k}</div><div>${esc(v)}</div>`).join('');
    const aiBox = $('#aiBox');
    if (aiBox) aiBox.innerHTML = ai.available && ai.model
      ? `<span style="color:var(--green)">● Connected</span> — ${esc(ai.label)}, model <b>${esc(ai.model)}</b>. Missy understands normal conversation.${ai.lastError ? `<br><span style="color:var(--yellow)">Last problem: ${esc(ai.lastError)}</span>` : ''}`
      : `<span style="color:var(--yellow)">● Not connected</span> — ${esc(ai.note)} Missy can only follow set commands until a brain is connected.`;
    const micBox = $('#micBox');
    if (micBox && !api.nativeSpeech) {
      micBox.innerHTML = canBrowserListen()
        ? '<span style="color:var(--green)">● Ready</span> — Chrome is listening for you. Click the pink mic (or hold Space) and talk; she sends it when you pause.'
        : '<span style="color:var(--yellow)">● This browser can\'t listen.</span> Open Missy in Google Chrome for voice.';
    } else
    if (micBox) micBox.innerHTML = mic.whisper.ready
      ? `<span style="color:var(--green)">Ready</span> — ${esc(mic.whisper.bin)}<br>${esc(mic.whisper.model)}<br>Hold <b>Space</b> (or click the mic) to talk.`
      : `<div class="setup-step">Until this is set up, click the message bar and use Mac Dictation (🎤 key or Fn twice).<br><br>1. Install Homebrew from <a href="#" data-url="https://brew.sh">brew.sh</a> if you don't have it.<br>2. <code>brew install whisper-cpp</code><br>3. <code>mkdir -p ~/missy-models && curl -L -o ~/missy-models/ggml-base.en.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin</code><br><br>Found: ${mic.whisper.bin ? 'whisper ✓' : 'whisper ✗'} · ${mic.whisper.model ? 'model ✓' : 'model ✗'}</div>`;
    const voiceList = api.nativeSpeech ? (mic.voices || []).map(v => v.name) : englishVoices().map(v => v.name);
    if (voiceList.length) document.querySelectorAll('.voiceSel').forEach(sel => {
      const role = sel.dataset.team, cur = snap.settings.team[role].voice;
      const active = api.nativeSpeech ? cur : (pickBrowserVoice(cur, role) || {}).name;
      sel.innerHTML = voiceList.map(n => `<option ${n === active ? 'selected' : ''}>${esc(n)}</option>`).join('');
    });
  }

  function updateBadges() {
    const a = $('#aiBadge'), m = $('#micBadge');
    a.textContent = aiInfo.available && aiInfo.model ? `AI · ${aiInfo.label || aiInfo.model.split(':')[0]}` : 'AI · not connected';
    a.title = aiInfo.available ? `${aiInfo.label}: ${aiInfo.model}` : (aiInfo.note || 'No AI brain connected');
    a.className = 'chip ' + (aiInfo.available && aiInfo.model ? 'ok' : 'warn');
    const live = micInfo.whisper.ready || canBrowserListen();
    m.textContent = micInfo.whisper.ready ? 'MIC · whisper' : canBrowserListen() ? 'MIC · ready' : 'MIC · dictation';
    m.className = 'chip ' + (live ? 'ok' : 'warn');
  }

  // ---------------------------------------------------------------- panel events (delegated)
  document.addEventListener('click', async e => {
    const d = e.target.closest('[data-toggle],[data-approve],[data-archive],[data-start],[data-tfilter],[data-pfilter],[data-delevent],[data-proj],[data-ack],[data-contain],[data-resolve],[data-sim],[data-mkind],[data-promote],[data-karchive],[data-switch],[data-do],[data-url],[data-goto],[data-close],[data-testvoice],[data-portrait],[data-clearportrait],[data-savekey],[data-clearkey],[data-connswitch],[data-checkproj],[data-sticky-done],[data-sticky-pin],[data-sticky-archive],#briefBtn,#statusPill,.close');
    if (!d) return;
    const ds = d.dataset;
    if (ds.stickyDone) {
      const note = (snap.stickies || []).find(x => x.id === ds.stickyDone);
      if (note) await api.action('sticky:update', { id: note.id, done: !note.done });
    }
    else if (ds.stickyPin) {
      const note = (snap.stickies || []).find(x => x.id === ds.stickyPin);
      if (note) await api.action('sticky:update', { id: note.id, pinned: !note.pinned });
    }
    else if (ds.stickyArchive) {
      await api.action('sticky:archive', { id: ds.stickyArchive });
    }
    else if (ds.toggle) { const t = snap.tasks.find(x => x.id === ds.toggle); await api.action('task:update', { id: t.id, patch: { status: t.status === 'done' ? 'todo' : 'done' } }); }
    else if (ds.approve) { await api.action('task:approve', { id: ds.approve }); toast('Approved and logged.'); }
    else if (ds.archive) await api.action('task:delete', { id: ds.archive });
    else if (ds.start) await api.action('task:update', { id: ds.start, patch: { status: 'active' } });
    else if (ds.tfilter) { taskFilter = ds.tfilter; renderPanel(); return; }
    else if ('pfilter' in ds) { projectFilter = ds.pfilter || null; renderPanel(); return; }
    else if (ds.delevent) {
      let r = await api.action('event:delete', { id: ds.delevent });
      if (r && r.needsConfirm && confirm(r.needsConfirm)) r = await api.action('event:delete', { id: ds.delevent, confirmed: true });
    }
    else if (ds.proj) { projectFilter = ds.proj; focusProject = ds.proj; taskFilter = 'open'; setTab('tasks'); return; }
    else if (ds.ack) await api.action('alert:ack', { id: ds.ack });
    else if (ds.contain) { const note = prompt('What was done to contain it?', 'Checked and contained by Ms. Castleberry'); if (note === null) return; await api.action('alert:contain', { id: ds.contain, note }); }
    else if (ds.resolve) { const r = await api.action('alert:resolve', { id: ds.resolve }); if (r && r.ok === false) toast(r.error, 'yellow'); }
    else if (ds.sim) {
      const args = ds.sim === 'yellow' ? { level: 'yellow', title: 'Demo: template download link expiring soon' } : ds.sim === 'security' ? { level: 'red', security: true, title: 'Demo: unusual sign-in attempt' } : {};
      await api.action('alert:simulate', args);
    }
    else if (ds.mkind) { memoryKind = ds.mkind; renderPanel(); return; }
    else if (ds.promote) { await api.action('knowledge:update', { id: ds.promote, patch: { kind: 'decision', approvedAt: new Date().toISOString() } }); toast('Idea approved as a decision.'); }
    else if (ds.karchive) await api.action('knowledge:update', { id: ds.karchive, patch: { kind: 'archived' } });
    else if (ds.switch) await api.action('settings', { [ds.switch]: !snap.settings[ds.switch] });
    else if (ds.do === 'backup') { await api.action('backup'); toast('Backup saved and verified.'); }
    else if (ds.do === 'export') { const r = await api.action('export'); toast('Exported to ' + r.dir); }
    else if (ds.do === 'folder') api.openDataFolder();
    else if (ds.url) { e.preventDefault(); api.openUrl(ds.url); return; }
    else if (ds.goto) { setTab(ds.goto); return; }
    else if (ds.close) { closeOverlay(); return; }
    else if (ds.testvoice) {
      const line = ds.testvoice === 'manager'
        ? `${snap.settings.addressAs}, ${teamName('manager')} here. I keep the team in line and tell you what matters.`
        : `Hi ${snap.settings.addressAs}, it's ${teamName('assistant')}. I've got your notes, your schedule, and your coffee order.`;
      bubble('missy', line, false, ds.testvoice); say(line, ds.testvoice); return;
    }
    else if (ds.portrait) { pickPortrait(ds.portrait); return; }
    else if (ds.savekey) {
      const input = $('#key-' + ds.savekey); const value = input && input.value.trim();
      if (!value) { toast('Paste the key first.', 'yellow'); return; }
      d.disabled = true; d.textContent = 'Checking…';
      try {
        const r = await api.action('secrets:set', { key: ds.savekey, value });
        if (r.ai) { aiInfo = r.ai; updateBadges(); toast(r.ai.available ? `Brain connected: ${r.ai.label} (${r.ai.model}). Try talking to her!` : `Saved, but it didn't connect: ${r.ai.note}`, r.ai.available ? '' : 'yellow'); }
        else toast('Saved on this Mac.');
      } catch (err) { toast('Could not save: ' + err.message, 'yellow'); }
    }
    else if (ds.clearkey) { await api.action('secrets:set', { key: ds.clearkey, value: '' }); toast('Removed.'); }
    else if (ds.connswitch) { const p = snap.projects.find(x => x.id === ds.connswitch); await api.action('project:connections', { id: p.id, connections: { stripe: !(p.connections && p.connections.stripe) } }); }
    else if (ds.checkproj) {
      d.disabled = true; d.textContent = 'Checking…'; busy = true; syncState();
      try { const r = await api.action('project:check', { id: ds.checkproj }); bubble('missy', r.text, false, 'assistant'); say(r.text, 'assistant'); }
      catch (err) { toast('Check failed: ' + err.message, 'yellow'); }
      busy = false; syncState();
    }
    else if (ds.clearportrait) { await api.action('team:update', { role: ds.clearportrait, patch: { portrait: '' } }); }
    else if (d.id === 'briefBtn') { runBriefing(); return; }
    else if (d.id === 'statusPill') { showLegend(); return; }
    else if (d.classList.contains('close')) { closeOverlay(); return; }
    await refresh();
  });

  document.addEventListener('change', async e => {
    if (e.target.dataset && e.target.dataset.conn) {
      await api.action('project:connections', { id: e.target.dataset.conn, connections: { [e.target.dataset.key]: e.target.value.trim() } });
      toast('Connection saved.'); await refresh(); return;
    }
    if (e.target.dataset && e.target.dataset.ai) {
      aiInfo = await api.action('ai:settings', { [e.target.dataset.ai]: e.target.value }); updateBadges(); await refresh(); return;
    }
    if (e.target.dataset && e.target.dataset.team) {
      let v = e.target.value; if (e.target.type === 'number') v = Number(v);
      await api.action('team:update', { role: e.target.dataset.team, patch: { [e.target.dataset.key]: v } });
      await refresh(); return;
    }
    const k = e.target.dataset && e.target.dataset.setting;
    if (!k) return;
    let v = e.target.value;
    if (e.target.type === 'number') v = Number(v);
    await api.action('settings', { [k]: v });
    await refresh();
  });

  document.addEventListener('submit', async e => {
    const f = e.target;
    if (f.id === 'askForm') return;
    e.preventDefault();
    const data = Object.fromEntries(new FormData(f).entries());
    if (f.id === 'stickyForm') await api.action('sticky:add', { text: data.text, scope: data.scope, color: data.color });
    if (f.id === 'taskForm') await api.action('task:add', { title: data.title, projectId: data.projectId || null, priority: data.priority, due: data.due ? new Date(data.due).toISOString() : null, source: 'manual' });
    if (f.id === 'eventForm') {
      const start = new Date(data.start), end = new Date(start.getTime() + Number(data.mins) * 60000);
      const ev = { title: data.title, start: start.toISOString(), end: end.toISOString(), calendar: data.calendar, withOthers: /with|call|meeting|client/i.test(data.title) };
      let r = await api.action('event:add', ev);
      if (r && r.conflict) {
        if (!confirm(`This overlaps: ${r.conflict.join(', ')}. Book it anyway?`)) return;
        r = await api.action('event:add', { ...ev, force: true });
      }
    }
    if (f.id === 'projectForm') { const r = await api.action('project:add', { name: data.name }); if (r && r.text) toast(r.text); }
    if (f.id === 'memForm') await api.action('knowledge:add', { kind: memoryKind, text: data.text });
    f.reset();
    document.activeElement.blur();
    await refresh();
  });

  // ---------------------------------------------------------------- briefing & legend overlays
  function closeOverlay() { $('#overlay').hidden = true; $('#overlay').innerHTML = ''; }

  function showBriefing(scan) {
    if (!scan) return;
    const tag = i => i.real ? '' : '<span class="tag unchecked">Not checked</span>';
    $('#overlay').innerHTML = `<div class="holo sheet">
      <button class="icon-btn close" title="Close">✕</button>
      <h2>Morning <b>Operations Scan</b></h2>
      <div class="muted tiny">${fmtDate(scan.finishedAt)} · ${fmtTime(scan.finishedAt)} · every line marked “Not checked” is a system Missy can't see yet</div>
      <div class="bubble missy" style="margin-top:14px;max-height:none">${esc(scan.spoken)}</div>
      <div class="brief-grid">${scan.sections.map((sec, i) => `<div class="brief-sec"><h4>${i + 1}. ${esc(sec.title)}</h4>
        ${sec.items.map(it => `<div class="line"><span class="lvl ${it.level === 'none' ? '' : it.level}"></span><span style="flex:1">${esc(it.text)}</span>${tag(it)}</div>`).join('')}</div>`).join('')}</div>
      <div class="row" style="margin-top:16px;justify-content:flex-end"><button class="ghost-btn small" data-close="1">Got it</button></div></div>`;
    $('#overlay').hidden = false;
  }

  function showLegend() {
    const st = snap.status;
    $('#overlay').innerHTML = `<div class="holo sheet" style="width:min(560px,92vw)">
      <button class="icon-btn close">✕</button>
      <h2>Status: <b style="color:var(--status)">${STATUS_TEXT[st.level]}</b></h2>
      <div class="legend">
        <span class="sw" style="background:var(--red)"></span><span>${st.reds} critical alert(s) not yet contained</span>
        <span class="sw" style="background:var(--yellow)"></span><span>${st.yellows} attention alert(s) · ${st.approvals} approval(s) · ${st.overdue} overdue task(s)</span>
        <span class="sw" style="background:var(--blue)"></span><span>${st.maintenance.length ? st.maintenance.join(', ') + ' running' : 'No maintenance running'}</span>
        <span class="sw" style="background:var(--green)"></span><span>Monitored: ${esc(st.monitored.join(', '))}</span>
      </div>
      <p class="muted tiny" style="margin-top:14px">Not connected (so not covered by green): ${esc(st.notMonitored.join(', '))}.</p></div>`;
    $('#overlay').hidden = false;
  }
  $('#overlay').addEventListener('click', e => { if (e.target.id === 'overlay') closeOverlay(); });

  async function runBriefing(auto) {
    busy = true; syncState();
    const r = auto ? await api.startupBriefing() : await api.briefing();
    busy = false;
    await refresh();
    showBriefing(r.scan);
    bubble('missy', r.text, false, 'assistant');
    if (r.speak) say(r.text, 'assistant');
  }

  // ---------------------------------------------------------------- events from Missy's core
  api.on((channel, payload) => {
    if (channel === 'data:changed') { snap = payload; render(); }
    if (channel === 'status' && snap) { snap.status = payload; render(); }
    if (channel === 'voice:speaking') { speaking = payload; syncState(); renderTeamGlow(); }
    if (channel === 'voice:speaker') { talker = payload; renderTeamGlow(); }
    if (channel === 'missy:say') { bubble('missy', payload.text, payload.urgent, payload.speaker); if (payload.urgent) toast(payload.text, 'red'); if (!api.nativeSpeech) say(payload.text, payload.speaker); }
    if (channel === 'alert:new') { refresh(); if (payload.level === 'red') setTab('alerts'); }
    if (channel === 'briefing') { refresh().then(() => showBriefing(payload.scan)); bubble('missy', payload.text); }
    if (channel === 'missy:state') { busy = payload === 'processing'; syncState(); }
  });

  // ---------------------------------------------------------------- clock + boot
  function tick() { $('#clock').textContent = new Date().toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  setInterval(tick, 15000); tick();

  (async function boot() {
    await refresh();
    Promise.all([api.action('ai:status'), api.action('voice:status')]).then(([ai, mic]) => { aiInfo = ai; micInfo = mic; updateBadges(); });
    if (await api.shouldBrief()) setTimeout(() => runBriefing(true), 1200);
    else bubble('missy', `Welcome back, ${snap.settings.addressAs}. Hold Space to talk, or type below.`);
  })();
})();
