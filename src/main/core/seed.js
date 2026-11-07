'use strict';
/**
 * Initial project registry and settings. Add a business later from the
 * Projects panel or by voice ("Missy, add a business called ...") —
 * nothing here needs editing to grow the registry.
 */

const PROJECTS = [
  { key: 'sitestyles', name: 'SiteStyles', color: '#7c5cff',
    focus: ['Website template store', 'Template licensing', 'Customer accounts', 'Automated digital delivery', 'Custom website inquiries', 'CRM promotion'] },
  { key: 'halli-originals', name: 'Halli Originals', color: '#d4af37',
    focus: ['Premium website collection', 'Custom design requests', 'Creative approvals'] },
  { key: 'post-roulette', name: 'Post Roulette', color: '#ff5c8a',
    focus: ['Content creation', 'Content organization', 'Draft management', 'Publishing workflows'] },
  { key: 'ecom-radar', name: 'Ecom Radar', color: '#22d3ee',
    focus: ['Product research', 'Supplier research', 'Research dashboards', 'Software development'] },
  { key: 'opulent-thoughts', name: 'Opulent Thoughts', color: '#f5c46b',
    focus: ['Quote creation', 'Content batching', 'Brand consistency', 'Social media scheduling'] },
  { key: 'scheduleup', name: 'ScheduleUp', color: '#34d399',
    focus: ['Appointment scheduling', 'Social media scheduling', 'Automation workflows'] },
  { key: 'mbs-essentials', name: 'MBS Essentials', color: '#fb923c',
    focus: ['E-commerce operations', 'Product organization', 'Marketing tasks'] },
  { key: 'personal-brand', name: 'Personal Brand Website', color: '#a78bfa', aliases: ['personal brand', 'my website', 'the castle', 'castle site'],
    focus: ['Development', 'Maintenance', 'Creative updates'] },
  { key: 'personal', name: 'Personal', color: '#94a3b8',
    focus: ['Family', 'Appointments', 'Errands'] },
];

const DEFAULT_SETTINGS = {
  addressAs: 'Ms. Castleberry',
  theme: 'gallery',           // 'gallery' (luxury Style Gallery desk) or 'hq' (original neon HQ)
  brainStyle: 'glass',        // 'glass' (see-through neon + lightning), 'neon' (solid glossy) or 'classic' (particles)
  spokenResponses: true,
  spokenBriefing: true,
  autoBriefing: true,
  voiceName: 'Samantha',
  voiceRate: 185,
  // The team: Missy (assistant) does the day-to-day; Miss Claudie (manager) handles
  // oversight — priorities, approvals and anything critical. Portraits are added in Settings.
  team: {
    assistant: { name: 'Missy', fullName: 'Miss Essentials', voice: 'Samantha', rate: 185, pitch: 1.2, portrait: '' },
    manager: { name: 'Miss Claudie', fullName: 'Miss Claudie', voice: 'Karen', rate: 192, pitch: 0.9, portrait: '' },
  },
  alertSound: true,
  ollamaUrl: 'http://127.0.0.1:11434',
  ollamaModel: '',            // empty = auto-pick the first installed model
  whisperBinary: '',          // empty = auto-detect whisper-cli on PATH / Homebrew
  whisperModel: '',           // path to a ggml model file, e.g. ~/missy-models/ggml-base.en.bin
  backupKeep: 14,
  approvalRules: {
    spendingLimitUSD: 0,
    requireApproval: ['spending', 'financial', 'irreversible', 'delete', 'publish', 'security', 'production-deploy'],
  },
};

module.exports = { PROJECTS, DEFAULT_SETTINGS };
