'use strict';
/**
 * Real business checks. Every result comes from a live request made at that moment and says
 * where it came from. If a source isn't connected or can't be reached, the result says so —
 * Missy never fills the gap with old numbers or guesses.
 *
 * A project's connections (saved on the project record):
 *   website: "https://sitestyles.net"           → is the site up, how fast, page title (no login needed)
 *   github:  "owner/repo"                        → latest commit, open issues (public repos need no login)
 *   stripe:  true                                → sales & failed payments (needs a READ-ONLY restricted key)
 */

async function timed(url, opts = {}, ms = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  const started = Date.now();
  try {
    const res = await fetch(url, { redirect: 'follow', ...opts, signal: ctrl.signal });
    return { res, ms: Date.now() - started };
  } finally { clearTimeout(t); }
}

const why = err => (err && err.name === 'AbortError') ? 'it took longer than 12 seconds to answer'
  : (err && err.cause && err.cause.code === 'ENOTFOUND') ? 'the address couldn\'t be found — the domain may not be set up yet, or the internet is down'
  : (err && err.cause && err.cause.code) ? err.cause.code : (err && err.message) || 'unknown error';

// ------------------------------------------------------------------ website
async function checkWebsite(url) {
  const out = { source: 'website', target: url, checkedAt: new Date().toISOString() };
  try {
    const { res, ms } = await timed(url, { headers: { 'User-Agent': 'MissyCentral/0.3 (site health check)' } });
    const html = (res.headers.get('content-type') || '').includes('html') ? (await res.text()).slice(0, 200000) : '';
    const title = (html.match(/<title[^>]*>([^<]{0,140})<\/title>/i) || [])[1];
    out.ok = res.ok;
    out.status = res.status;
    out.ms = ms;
    out.finalUrl = res.url;
    out.title = title ? title.replace(/\s+/g, ' ').trim() : '';
    out.parked = /domain (is )?for sale|parked|buy this domain|coming soon|under construction/i.test(html.slice(0, 20000));
    out.summary = res.ok
      ? `${hostOf(url)} is up — answered in ${(ms / 1000).toFixed(1)} seconds${out.title ? `, page title "${out.title}"` : ''}${out.parked ? '. It looks like a placeholder or coming-soon page' : ''}.`
      : `${hostOf(url)} answered with an error (${res.status}).`;
    out.level = res.ok ? (out.parked ? 'yellow' : 'green') : 'red';
  } catch (err) {
    out.ok = false; out.level = 'red';
    out.summary = `${hostOf(url)} didn't load: ${why(err)}.`;
  }
  return out;
}

// ------------------------------------------------------------------ GitHub
async function checkGitHub(repo, token) {
  const out = { source: 'github', target: repo, checkedAt: new Date().toISOString() };
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'MissyCentral/0.3' };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const { res } = await timed(`https://api.github.com/repos/${repo}`, { headers });
    if (res.status === 404) { out.ok = false; out.level = 'yellow'; out.summary = `GitHub repo ${repo} wasn't found (or it's private and Missy has no GitHub token).`; return out; }
    if (res.status === 403) { out.ok = false; out.level = 'yellow'; out.summary = 'GitHub is limiting checks right now (free hourly limit). Try again later.'; return out; }
    const r = await res.json();
    out.openIssues = r.open_issues_count;
    out.pushedAt = r.pushed_at;
    const c = await timed(`https://api.github.com/repos/${repo}/commits?per_page=3`, { headers });
    if (c.res.status === 409) {
      out.ok = true; out.level = 'yellow'; out.empty = true;
      out.summary = `The GitHub repo ${repo} exists but has no code in it yet.`;
      return out;
    }
    const commits = c.res.ok ? await c.res.json() : [];
    out.ok = true; out.level = 'green';
    out.commits = commits.map(x => ({ msg: (x.commit.message || '').split('\n')[0], at: x.commit.author && x.commit.author.date }));
    const last = out.commits[0];
    out.summary = last
      ? `Latest code change ${ago(last.at)}: "${last.msg.slice(0, 90)}". ${r.open_issues_count} open issue${r.open_issues_count === 1 ? '' : 's'}.`
      : `GitHub repo found; no commits listed.`;
  } catch (err) {
    out.ok = false; out.level = 'yellow';
    out.summary = `Couldn't reach GitHub: ${why(err)}.`;
  }
  return out;
}

// ------------------------------------------------------------------ Stripe (read-only)
async function checkStripe(key) {
  const out = { source: 'stripe', checkedAt: new Date().toISOString() };
  if (!key) { out.ok = false; out.level = 'none'; out.notConnected = true; out.summary = 'Stripe isn\'t connected, so I can\'t see sales or payments yet.'; return out; }
  if (/^sk_/.test(key)) { out.ok = false; out.level = 'yellow'; out.summary = 'That Stripe key is a full secret key. For safety Missy only accepts a read-only restricted key (starts with rk_).'; return out; }
  const auth = { Authorization: 'Basic ' + Buffer.from(key + ':').toString('base64') };
  try {
    const since = Math.floor(Date.now() / 1000) - 7 * 86400;
    const [bal, ch] = await Promise.all([
      timed('https://api.stripe.com/v1/balance', { headers: auth }),
      timed(`https://api.stripe.com/v1/charges?limit=100&created[gte]=${since}`, { headers: auth }),
    ]);
    if (bal.res.status === 401 || ch.res.status === 401) { out.ok = false; out.level = 'yellow'; out.summary = 'Stripe rejected the key — it may be mistyped or revoked.'; return out; }
    if (ch.res.status === 403) { out.ok = false; out.level = 'yellow'; out.summary = 'The Stripe key doesn\'t have read permission for Charges. Edit the restricted key and give Charges "Read".'; return out; }
    const charges = ch.res.ok ? (await ch.res.json()).data || [] : [];
    const balance = bal.res.ok ? await bal.res.json() : null;
    const paid = charges.filter(c => c.status === 'succeeded' && c.paid && !c.refunded);
    const failed = charges.filter(c => c.status === 'failed');
    const total = paid.reduce((s, c) => s + c.amount, 0);
    const cur = (paid[0] && paid[0].currency) || 'usd';
    const money = cents => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: cur.toUpperCase() });
    const available = balance && balance.available ? balance.available.reduce((s, b) => s + b.amount, 0) : null;
    out.ok = true;
    out.level = failed.length ? 'yellow' : 'green';
    out.sales7d = paid.length; out.revenue7d = total; out.failed7d = failed.length; out.livemode = charges[0] ? charges[0].livemode : !/test/.test(key);
    out.summary = `${out.livemode === false ? '(Test mode) ' : ''}Stripe, last 7 days: ${paid.length} sale${paid.length === 1 ? '' : 's'} for ${money(total)}`
      + `${failed.length ? `, and ${failed.length} failed payment${failed.length === 1 ? '' : 's'}` : ', no failed payments'}`
      + `${available !== null ? `. Available balance ${money(available)}` : ''}.`;
  } catch (err) {
    out.ok = false; out.level = 'yellow';
    out.summary = `Couldn't reach Stripe: ${why(err)}.`;
  }
  return out;
}

// ------------------------------------------------------------------ run all for a project
async function checkProjectConnections(project, secrets) {
  const c = project.connections || {};
  const jobs = [];
  if (c.website) jobs.push(checkWebsite(normalizeUrl(c.website)));
  if (c.github) jobs.push(checkGitHub(c.github.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, ''), secrets && secrets.get('githubToken')));
  if (c.stripe) jobs.push(checkStripe(secrets && secrets.get('stripeKey')));
  return Promise.all(jobs);
}

function normalizeUrl(u) { u = String(u).trim(); return /^https?:\/\//i.test(u) ? u : 'https://' + u; }
function hostOf(u) { try { return new URL(normalizeUrl(u)).host; } catch { return u; } }
function ago(iso) {
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const h = Math.round(mins / 60); if (h < 36) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24); return `${d} day${d === 1 ? '' : 's'} ago`;
}

module.exports = { checkWebsite, checkGitHub, checkStripe, checkProjectConnections, normalizeUrl, hostOf };
