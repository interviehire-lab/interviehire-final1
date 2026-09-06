// General Settings page (route /dashboard/settings/general). The markup is static
// in dashboard-crystal.js (#view-settings-general); this module makes every control
// actually do something:
//   • Update Password / Change Email / Delete Account → modal → backend (settings.py)
//   • Dark Mode      → drives the shared theme (body.light-theme + IntervieHire-theme)
//   • Email / Analytics notifications → persisted preferences
//   • Export My Data → client-side JSON download of the session's data
// initSettingsPage() binds once at mount; syncSettingsControls() refreshes the
// displayed email + toggle states each time the settings view is opened.
import { document, window } from './runtime';
import { escapeHTML } from './escape';
import { soundEngine } from './sound';
import { showPremiumToast } from './sourcing';
import { AppState } from './state';
import { apiChangePassword, apiChangeEmail, apiDeleteAccount, apiLogout, getDataSource } from './api';
import { API_BASE } from '../auth-client';

const PREF = {
  emailNotif: 'IntervieHire-email-notif',
  analytics: 'IntervieHire-analytics',
  theme: 'IntervieHire-theme',          // shared with the header theme toggle
};

const prefOn = (key, defaultOn = true) => {
  const v = localStorage.getItem(key);
  if (v == null) return defaultOn;
  return v === 'on';
};
const setPref = (key, on) => localStorage.setItem(key, on ? 'on' : 'off');
const setToggle = (el, on) => { if (el) el.classList.toggle('active', !!on); };

function setEmailDisplay(email) {
  const el = document.getElementById('settings-email-value');
  if (el && email) el.textContent = email;
}

// ── modal helper ────────────────────────────────────────────────────────────
// Reuses the schedule modal's overlay/card CSS for a consistent, theme-aware look;
// fields are simple inline-styled inputs. onConfirm(values, { close }) may be async
// and should throw an Error (message shown inline) to keep the modal open on failure.
function openSettingsModal({ title, description, fields = [], confirmLabel = 'Confirm', danger = false, onConfirm }) {
  const existing = document.getElementById('settings-modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'settings-modal-overlay';
  overlay.className = 'schedule-modal-overlay';

  const inputStyle = 'width:100%;box-sizing:border-box;margin-top:6px;padding:9px 11px;border-radius:9px;border:1px solid var(--glass-border);background:var(--color-surface-2);color:var(--color-text);font-size:0.85rem;font-family:var(--font-body);outline:none;';
  const fieldsHTML = fields.map((f) => `
    <div class="schedule-form-group" style="margin-bottom:12px;">
      <label style="font-size:0.74rem;font-weight:600;color:var(--color-text-muted);">${escapeHTML(f.label)}</label>
      <input id="${f.id}" type="${f.type || 'text'}" placeholder="${escapeHTML(f.placeholder || '')}" autocomplete="${f.autocomplete || 'off'}" style="${inputStyle}" />
    </div>`).join('');

  overlay.innerHTML = `
    <div class="schedule-modal" style="max-width:430px;">
      <button class="sched-close" id="settings-modal-cancel" aria-label="Close">✕</button>
      <h3>${escapeHTML(title)}</h3>
      ${description ? `<p style="font-size:0.8rem;color:var(--color-text-muted);line-height:1.5;margin:0 0 14px;">${escapeHTML(description)}</p>` : ''}
      ${fieldsHTML}
      <div id="settings-modal-error" style="display:none;color:#f87171;font-size:0.78rem;margin:2px 0 10px;"></div>
      <button class="btn-schedule-continue" id="settings-modal-confirm"${danger ? ' style="background:#ef4444;border-color:#ef4444;"' : ''}>${escapeHTML(confirmLabel)}</button>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  const errEl = overlay.querySelector('#settings-modal-error');
  const confirmBtn = overlay.querySelector('#settings-modal-confirm');

  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#settings-modal-cancel').addEventListener('click', close);

  const firstInput = overlay.querySelector('input');
  if (firstInput) setTimeout(() => firstInput.focus(), 30);

  const submit = async () => {
    const values = {};
    fields.forEach((f) => { values[f.id] = (overlay.querySelector(`#${f.id}`)?.value || '').trim(); });
    errEl.style.display = 'none';
    confirmBtn.disabled = true;
    const prevText = confirmBtn.textContent;
    confirmBtn.textContent = 'Working…';
    try {
      await onConfirm(values, { close });
    } catch (err) {
      errEl.textContent = (err && err.message) || 'Something went wrong.';
      errEl.style.display = 'block';
      confirmBtn.disabled = false;
      confirmBtn.textContent = prevText;
    }
  };
  confirmBtn.addEventListener('click', submit);
  // Enter from any input submits (keydown bubbles up from the focused field).
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
}

// Account actions require the live backend (these endpoints don't exist in localStorage mode).
function requireApi() {
  if (getDataSource() !== 'api') {
    showPremiumToast('Connect the live backend to manage your account.', 'info');
    return false;
  }
  return true;
}

function onUpdatePassword() {
  soundEngine.playClick();
  if (!requireApi()) return;
  openSettingsModal({
    title: 'Update Password',
    description: 'Enter your current password, then choose a new one.',
    confirmLabel: 'Update Password',
    fields: [
      { id: 'sm-current', label: 'Current password', type: 'password', autocomplete: 'current-password' },
      { id: 'sm-new', label: 'New password', type: 'password', autocomplete: 'new-password' },
      { id: 'sm-confirm', label: 'Confirm new password', type: 'password', autocomplete: 'new-password' },
    ],
    onConfirm: async (v, { close }) => {
      if (!v['sm-current'] || !v['sm-new']) throw new Error('All fields are required.');
      if (v['sm-new'].length < 8) throw new Error('New password must be at least 8 characters.');
      if (v['sm-new'] !== v['sm-confirm']) throw new Error('New passwords do not match.');
      await apiChangePassword(v['sm-current'], v['sm-new']);
      close();
      showPremiumToast('Password updated successfully.', 'success');
      const hint = document.getElementById('btn-change-password')?.closest('.settings-row')?.querySelector('.settings-row-hint');
      if (hint) hint.textContent = 'Last changed just now';
    },
  });
}

function onChangeEmail() {
  soundEngine.playClick();
  if (!requireApi()) return;
  const current = window.IH_USER_EMAIL || '';
  openSettingsModal({
    title: 'Change Email Address',
    description: current ? `Current address: ${current}` : 'Enter your new email address.',
    confirmLabel: 'Change Email',
    fields: [
      { id: 'sm-email', label: 'New email address', type: 'email', autocomplete: 'email' },
      { id: 'sm-pw', label: 'Current password', type: 'password', autocomplete: 'current-password' },
    ],
    onConfirm: async (v, { close }) => {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v['sm-email'])) throw new Error('Enter a valid email address.');
      if (!v['sm-pw']) throw new Error('Your current password is required.');
      const res = await apiChangeEmail(v['sm-email'], v['sm-pw']);
      const newEmail = (res && res.email) || v['sm-email'];
      window.IH_USER_EMAIL = newEmail;
      setEmailDisplay(newEmail);
      close();
      showPremiumToast('Email updated.', 'success');
    },
  });
}

function onDeleteAccount() {
  soundEngine.playClick();
  if (!requireApi()) return;
  openSettingsModal({
    title: 'Delete Account',
    description: 'This permanently deletes your account and signs you out. It cannot be undone. Type DELETE and enter your password to confirm.',
    confirmLabel: 'Delete my account',
    danger: true,
    fields: [
      { id: 'sm-confirmword', label: 'Type DELETE to confirm', type: 'text' },
      { id: 'sm-delpw', label: 'Current password', type: 'password', autocomplete: 'current-password' },
    ],
    onConfirm: async (v, { close }) => {
      if (v['sm-confirmword'] !== 'DELETE') throw new Error('Type DELETE (in capitals) to confirm.');
      if (!v['sm-delpw']) throw new Error('Your current password is required.');
      await apiDeleteAccount(v['sm-delpw']);
      close();
      showPremiumToast('Account deleted. Signing you out…', 'success');
      try { await apiLogout(); } catch { /* cookie is already cleared server-side */ }
      setTimeout(() => { window.location.href = '/login'; }, 900);
    },
  });
}

function onExportData() {
  soundEngine.playClick();
  try {
    const payload = {
      exportedAt: new Date().toISOString(),
      account: {
        name: window.IH_USER_NAME || '',
        email: window.IH_USER_EMAIL || '',
        organisation: window.IH_ORG_NAME || '',
      },
      jobs: AppState.jobs || [],
      candidates: AppState.candidates || [],
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `interviehire-data-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showPremiumToast('Your data has been downloaded.', 'success');
  } catch (err) {
    showPremiumToast(`Could not export data: ${(err && err.message) || ''}`, 'error');
  }
}

// Bind a settings toggle once. onChange(nextOn) fires after the visual flip.
function bindToggle(id, onChange) {
  const el = document.getElementById(id);
  if (!el || el.dataset.ihBound) return;
  el.dataset.ihBound = '1';
  el.addEventListener('click', () => {
    const on = !el.classList.contains('active');
    setToggle(el, on);
    onChange(on);
  });
}

function setTheme(dark) {
  const shouldBeLight = !dark;
  const isLight = document.body.classList.contains('light-theme');
  if (shouldBeLight !== isLight) {
    document.body.classList.toggle('light-theme', shouldBeLight);
    localStorage.setItem(PREF.theme, shouldBeLight ? 'light' : 'dark');
    const careerSel = document.getElementById('career-theme');
    if (careerSel) careerSel.value = shouldBeLight ? 'light' : 'dark';
    soundEngine.playChime(shouldBeLight ? [329.63, 392.00, 523.25] : [523.25, 392.00, 261.63], 0.12, 0.1);
  }
}

let inited = false;
export function initSettingsPage() {
  if (inited) return;
  inited = true;

  document.getElementById('btn-change-password')?.addEventListener('click', onUpdatePassword);
  document.getElementById('btn-change-email')?.addEventListener('click', onChangeEmail);
  document.getElementById('btn-export-data')?.addEventListener('click', onExportData);
  document.getElementById('btn-delete-account')?.addEventListener('click', onDeleteAccount);
  // Full-page redirect (not a fetch) — this hands off to Google's own consent
  // screen, then lands back on /api/public/oauth2callback which persists the
  // refresh token onto this user's row (see google_drive.py / public.py).
  document.getElementById('btn-connect-drive')?.addEventListener('click', () => {
    if (!window.IH_USER_ID) return;
    window.location.href = `${API_BASE}/public/oauth/connect?user_id=${encodeURIComponent(window.IH_USER_ID)}`;
  });

  bindToggle('toggle-dark-mode', (on) => setTheme(on));
  bindToggle('toggle-email-notif', (on) => { setPref(PREF.emailNotif, on); soundEngine.playClick(); });
  bindToggle('toggle-analytics', (on) => { setPref(PREF.analytics, on); soundEngine.playClick(); });

  syncSettingsControls();
}

// Re-sync the displayed email + toggle states whenever the settings view opens (the
// email arrives from /me after mount, and the theme can change via the header toggle).
export function syncSettingsControls() {
  setEmailDisplay(window.IH_USER_EMAIL || '');
  const driveStatus = document.getElementById('settings-drive-status');
  const driveBtn = document.getElementById('btn-connect-drive');
  if (driveStatus) {
    const connected = !!window.IH_GOOGLE_DRIVE_CONNECTED;
    driveStatus.textContent = connected
      ? 'Connected — interview recordings upload here automatically.'
      : 'Not connected — recordings run in simulation mode until this is connected.';
    if (driveBtn) driveBtn.textContent = connected ? 'Reconnect' : 'Connect';
  }
  setToggle(document.getElementById('toggle-email-notif'), prefOn(PREF.emailNotif, true));
  setToggle(document.getElementById('toggle-analytics'), prefOn(PREF.analytics, true));
  setToggle(document.getElementById('toggle-dark-mode'), !document.body.classList.contains('light-theme'));
}
