// Super-admin-only organisation switcher in the dashboard header. Lets a
// super-admin choose which organisation's data the dashboard shows by setting
// the backend `active_org_id` cookie, then reloading so every list re-scopes.
//
// Gated on window.IH_USER_TYPE (set by DashboardShell from /me). org_admins and
// members never see the trigger — and the backend 403s these endpoints anyway,
// so this is defence in depth, not the only guard.
import { document, window, signal } from './runtime';
import { escapeHTML } from './escape';
import { showPremiumToast } from './sourcing';
import { apiListOrganisations, apiSwitchContext } from './api';

let cachedOrgs = null; // fetched once per session; re-rendered on every init.
let docListenerSignal = null; // the runtime signal the outside-click listener is bound under.

function renderOrgs(menu) {
  const orgs = Array.isArray(cachedOrgs) ? cachedOrgs : [];
  const activeId = window.IH_ACTIVE_ORG_ID == null ? '' : String(window.IH_ACTIVE_ORG_ID);
  if (!orgs.length) {
    menu.innerHTML = '<div class="bulk-dd-item" style="opacity:0.6;cursor:default;">No organisations</div>';
    return;
  }
  menu.innerHTML = orgs.map((org) => {
    const id = String(org.id);
    const name = org.org_name || org.name || 'Untitled';
    const active = id === activeId;
    return `<button class="bulk-dd-item${active ? ' active' : ''}" data-org-id="${escapeHTML(id)}" type="button">`
      + `<span class="org-name">${escapeHTML(name)}</span>`
      + (active ? '<span class="org-check">✓</span>' : '')
      + '</button>';
  }).join('');
}

function updateLabel(trigger) {
  const labelEl = trigger.querySelector('.org-switcher-label');
  if (labelEl) labelEl.textContent = (window.IH_ORG_NAME || '').trim() || 'All organisations';
}

export async function initOrgSwitcher() {
  const wrap = document.getElementById('org-switcher');
  const trigger = document.getElementById('btn-org-switcher');
  const menu = document.getElementById('org-switcher-menu');
  if (!wrap || !trigger || !menu) return;

  // Only super-admins get the switcher; everyone else keeps it hidden.
  if (window.IH_USER_TYPE !== 'super_admin') {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = '';
  updateLabel(trigger);

  // Native, element-scoped listeners (trigger + menu) live as long as the DOM
  // element, so bind them once per element. The dataset flag survives module
  // re-init but resets when a remount replaces the trigger. Mirrors the
  // logout-button binding pattern in DashboardShell. (The outside-click listener
  // is bound separately below — it has a different, signal-scoped lifetime.)
  if (!trigger.dataset.ihOrgBound) {
    trigger.dataset.ihOrgBound = '1';

    const closeMenu = () => {
      menu.style.display = 'none';
      trigger.setAttribute('aria-expanded', 'false');
    };

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      if (menu.style.display !== 'none') { closeMenu(); return; }
      menu.style.display = 'block';
      trigger.setAttribute('aria-expanded', 'true');
    });

    // Delegated item clicks → switch active org + reload into that context.
    menu.addEventListener('click', async (e) => {
      const item = e.target.closest('.bulk-dd-item');
      if (!item) return;
      const orgId = item.getAttribute('data-org-id');
      if (!orgId) return;
      if (orgId === String(window.IH_ACTIVE_ORG_ID)) { closeMenu(); return; }
      item.setAttribute('disabled', '');
      try {
        await apiSwitchContext(orgId);
        window.location.reload();
      } catch (err) {
        item.removeAttribute('disabled');
        showPremiumToast((err && err.message) || 'Could not switch organisation.', 'error');
      }
    });
  }

  // Outside-click closes the menu. This listener lives on the runtime `document`,
  // so it carries the AbortController signal and is torn down by disposeRuntime()
  // even when the trigger DOM (and its dataset flag) survives the re-init — which
  // would otherwise leave it permanently unbound after a remount. Gate it on the
  // signal identity (not the per-element flag) so it re-binds whenever the runtime
  // is fresh, and resolve nodes at click-time so it never holds a detached wrap.
  if (docListenerSignal !== signal) {
    docListenerSignal = signal;
    document.addEventListener('click', (e) => {
      const w = document.getElementById('org-switcher');
      if (!w || w.contains(e.target)) return;
      const m = document.getElementById('org-switcher-menu');
      if (m) m.style.display = 'none';
      const t = document.getElementById('btn-org-switcher');
      if (t) t.setAttribute('aria-expanded', 'false');
    });
  }

  // Fetch the org list once, but re-render every init (the DOM may be fresh
  // after a remount, and the active selection can change).
  try {
    if (!cachedOrgs) {
      // Placeholder so a click during the first fetch opens "Loading…" rather than
      // an empty box (a race-driven "sometimes" failure on initial load).
      if (!menu.children.length) menu.innerHTML = '<div class="bulk-dd-item" style="opacity:0.6;cursor:default;">Loading…</div>';
      cachedOrgs = await apiListOrganisations();
    }
    renderOrgs(menu);
  } catch (err) {
    showPremiumToast((err && err.message) || 'Could not load organisations.', 'error');
  }
}
