'use strict';
/** Fuzzy project lookup — "site styles", "sitestyles", "opulent" all work. */

function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

function findProject(projects, text) {
  const t = norm(text);
  if (!t) return null;
  let best = null, bestLen = 0;
  for (const p of projects) {
    const names = [p.name, p.key, ...(p.aliases || [])].map(norm).filter(Boolean);
    for (const n of names) {
      if (t.includes(n) && n.length > bestLen) { best = p; bestLen = n.length; }
    }
  }
  if (best) return best;
  // first-word match: "opulent", "ecom", "mbs"
  for (const p of projects) {
    const first = norm(p.name.split(/\s+/)[0]);
    if (first.length >= 3 && t.includes(first)) return p;
  }
  return null;
}

/** Remove the project's name from a phrase, plus connecting words like "for", "on". */
function stripProject(text, project) {
  if (!project) return text;
  let out = text;
  const variants = [project.name, project.name.replace(/\s+/g, ''), project.name.replace(/([a-z])([A-Z])/g, '$1 $2'), ...(project.aliases || [])];
  for (const v of variants) {
    const re = new RegExp(`\\s*\\b(for|on|in|under|to)?\\s*(the )?${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*')}( project| business)?\\b`, 'ig');
    out = out.replace(re, ' ');
  }
  return out.replace(/\s+/g, ' ').trim();
}

function slug(name) { return String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

module.exports = { findProject, stripProject, norm, slug };
