/*
 * Push-to-talk recorder → 16 kHz mono WAV (the format whisper.cpp expects).
 * Also reports live mic level so the brain reacts while listening.
 */
(function () {
  'use strict';
  window.createRecorder = function ({ onLevel } = {}) {
    let ctx = null, stream = null, node = null, src = null, chunks = [], recording = false;

    async function start() {
      if (recording) return;
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      src = ctx.createMediaStreamSource(stream);
      node = ctx.createScriptProcessor(4096, 1, 1);
      chunks = [];
      node.onaudioprocess = e => {
        const data = e.inputBuffer.getChannelData(0);
        chunks.push(new Float32Array(data));
        if (onLevel) { let s = 0; for (let i = 0; i < data.length; i += 8) s += data[i] * data[i]; onLevel(Math.min(1, Math.sqrt(s / (data.length / 8)) * 6)); }
      };
      src.connect(node); node.connect(ctx.destination);
      recording = true;
    }

    async function stop() {
      if (!recording) return null;
      recording = false;
      const rate = ctx.sampleRate;
      node.disconnect(); src.disconnect();
      stream.getTracks().forEach(t => t.stop());
      await ctx.close();
      if (onLevel) onLevel(0);
      const total = chunks.reduce((n, c) => n + c.length, 0);
      if (total < rate * 0.3) return null; // under 0.3s: ignore accidental taps
      const merged = new Float32Array(total); let o = 0; for (const c of chunks) { merged.set(c, o); o += c.length; }
      return encodeWav(downsample(merged, rate, 16000), 16000);
    }

    return { start, stop, get recording() { return recording; } };
  };

  function downsample(buf, from, to) {
    if (from === to) return buf;
    const ratio = from / to, out = new Float32Array(Math.floor(buf.length / ratio));
    for (let i = 0; i < out.length; i++) {
      const s = Math.floor(i * ratio), e = Math.min(buf.length, Math.floor((i + 1) * ratio));
      let sum = 0; for (let j = s; j < e; j++) sum += buf[j]; out[i] = sum / Math.max(1, e - s);
    }
    return out;
  }

  function encodeWav(samples, rate) {
    const b = new ArrayBuffer(44 + samples.length * 2), v = new DataView(b);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
    v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) { const s = Math.max(-1, Math.min(1, samples[i])); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
    return new Uint8Array(b);
  }
})();
