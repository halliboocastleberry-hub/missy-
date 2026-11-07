'use strict';
/** Hardware check — tells Missy (and Halli) what this Mac can realistically run. */
const os = require('os');
const { execFile } = require('child_process');

function run(cmd, args) {
  return new Promise(resolve => {
    execFile(cmd, args, { timeout: 4000 }, (err, stdout) => resolve(err ? '' : String(stdout).trim()));
  });
}

async function hardwareReport() {
  const ramGB = Math.round(os.totalmem() / 1024 ** 3);
  const cpu = (os.cpus()[0] || {}).model || 'unknown';
  const arch = os.arch();
  let chip = cpu;
  let macModel = '';
  let macOS = '';
  if (process.platform === 'darwin') {
    chip = (await run('sysctl', ['-n', 'machdep.cpu.brand_string'])) || cpu;
    macModel = await run('sysctl', ['-n', 'hw.model']);
    macOS = await run('sw_vers', ['-productVersion']);
  }
  const freeDiskGB = await diskFreeGB();
  const appleSilicon = arch === 'arm64';

  let tier, aiAdvice, whisperAdvice;
  if (appleSilicon && ramGB >= 16) {
    tier = 'strong';
    aiAdvice = 'Can run a capable local model. Suggested: llama3.1:8b or qwen2.5:7b in Ollama.';
    whisperAdvice = 'Use the "small.en" Whisper model for better accuracy.';
  } else if (appleSilicon && ramGB >= 8) {
    tier = 'moderate';
    aiAdvice = 'Use a small local model: llama3.2:3b (about 2 GB). Larger models will be slow.';
    whisperAdvice = 'Use the "base.en" Whisper model.';
  } else {
    tier = 'light';
    aiAdvice = 'Local AI will be slow here. Missy runs fine without it using her built-in command engine; consider a cloud model later (needs your approval for any cost).';
    whisperAdvice = 'Use the "tiny.en" Whisper model, or Mac dictation instead.';
  }
  if (freeDiskGB !== null && freeDiskGB < 10) aiAdvice += ` Only ${freeDiskGB} GB free disk — free up space before downloading models.`;

  return { platform: process.platform, macModel, macOS, chip, arch, appleSilicon, ramGB, cores: os.cpus().length, freeDiskGB, tier, aiAdvice, whisperAdvice };
}

async function diskFreeGB() {
  const out = await run('df', ['-k', os.homedir()]);
  const line = out.split('\n')[1];
  if (!line) return null;
  const parts = line.trim().split(/\s+/);
  const availKB = Number(parts[3]);
  return Number.isFinite(availKB) ? Math.round(availKB / 1024 / 1024) : null;
}

module.exports = { hardwareReport };
