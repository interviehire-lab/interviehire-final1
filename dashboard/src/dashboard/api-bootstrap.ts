// API-mode bootstrap: when DATA_SOURCE='api', hydrate the dashboard from the
// live FastAPI backend instead of localStorage seed data. Runs at startup
// (after loadStateFromLocalStorage). Cookie auth — if not signed in, shows a
// minimal login overlay, then hydrates. Inert in 'local' mode.

import { document } from './runtime';
import { AppState } from './state';
import { renderJobCards, renderTeamTable, updateJobsCounters } from './render-views';
import { showPremiumToast } from './sourcing';
import { isApiMode, apiLogin, apiFetchJobs, apiListTeam } from './api';

export async function bootstrapApiData() {
  if (!isApiMode()) return;
  try {
    await hydrateJobs();
  } catch (e) {
    const msg = (e && e.message) || '';
    if (/401|not authenticated|unauthor|credential/i.test(msg)) showLoginOverlay();
    else {
      // Backend is down, not an auth issue: drop the unhydrated demo seed and
      // resolve the jobs skeleton to the existing "No jobs found" empty state
      // instead of leaving it shimmering (or flashing the demo jobs).
      AppState.jobs = [];
      AppState.jobsHydrated = true;
      try { renderJobCards(); } catch {}
      showPremiumToast(`Live backend unreachable: ${msg}`, 'error');
    }
  }
  // Team is non-critical to the jobs view — hydrate it best-effort so a failure
  // here never blocks the dashboard or triggers the login overlay twice.
  try {
    await hydrateTeam();
  } catch { /* keep the localStorage-restored team */ }
}

async function hydrateTeam() {
  const members = await apiListTeam();
  if (Array.isArray(members) && members.length > 0) {
    AppState.team = members;
    try { renderTeamTable(); } catch {}
  }
}

async function hydrateJobs() {
  const jobs = await apiFetchJobs();
  AppState.jobs = jobs;
  AppState.jobsHydrated = true;
  renderJobCards();
  try { updateJobsCounters(); } catch {}
  // Usage cards are owned by /usage/stats (hydrateUsageAnalytics); do NOT derive
  // them from AppState here — in API mode that wrote demo-candidate numbers.
  showPremiumToast(`Loaded ${jobs.length} job${jobs.length !== 1 ? 's' : ''} from the live backend.`, 'success');

  if (typeof window !== 'undefined' && window.__ihDashboardMounted) {
    const segments = window.location.pathname.split('/').filter(Boolean);
    if (segments[0] === 'dashboard' && segments[1] === 'jobs' && segments[2]) {
      if (typeof window.__ihNavigateToPath === 'function') {
        window.__ihNavigateToPath(window.location.pathname);
      }
    }
  }
}

function showLoginOverlay() {
  if (document.getElementById('ih-api-login')) return;
  const wrap = document.createElement('div');
  wrap.id = 'ih-api-login';
  wrap.innerHTML = `
    <div style="position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.62);backdrop-filter:blur(6px);">
      <form id="ih-login-form" style="width:340px;background:var(--color-surface-solid,#111);border:1px solid var(--glass-border,rgba(255,255,255,.1));border-radius:16px;padding:22px;box-shadow:0 24px 60px rgba(0,0,0,.55);font-family:var(--font-body,system-ui,sans-serif);">
        <input id="ih-email" type="email" value="devasri@interviehire.ai" placeholder="Email" autocomplete="username" style="width:100%;margin-bottom:10px;padding:10px 12px;border-radius:9px;border:1px solid var(--glass-border,rgba(255,255,255,.12));background:var(--color-surface-2,rgba(255,255,255,.03));color:var(--color-text,#e8e8e8);font-size:.85rem;box-sizing:border-box;" />
        <input id="ih-pass" type="password" placeholder="Password" autocomplete="current-password" style="width:100%;margin-bottom:14px;padding:10px 12px;border-radius:9px;border:1px solid var(--glass-border,rgba(255,255,255,.12));background:var(--color-surface-2,rgba(255,255,255,.03));color:var(--color-text,#e8e8e8);font-size:.85rem;box-sizing:border-box;" />
        <button type="submit" id="ih-login-btn" style="width:100%;padding:11px;border:none;border-radius:9px;background:var(--color-gold,#2dd4bf);color:#06201d;font-weight:600;font-size:.85rem;cursor:pointer;">Sign in</button>
        <div id="ih-login-err" style="color:#f87171;font-size:.72rem;margin-top:10px;min-height:14px;"></div>
      </form>
    </div>`;
  document.body.appendChild(wrap);

  const form = wrap.querySelector('#ih-login-form');
  const errEl = wrap.querySelector('#ih-login-err');
  const btn = wrap.querySelector('#ih-login-btn');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = wrap.querySelector('#ih-email').value.trim();
    const password = wrap.querySelector('#ih-pass').value;
    btn.disabled = true; btn.textContent = 'Signing in…'; errEl.textContent = '';
    try {
      await apiLogin(email, password);
      wrap.remove();
      await hydrateJobs();
    } catch (err) {
      errEl.textContent = (err && err.message) || 'Sign in failed';
      btn.disabled = false; btn.textContent = 'Sign in';
    }
  });
}
