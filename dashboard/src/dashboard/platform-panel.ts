// Superadmin "Platform" tab content — six sub-tabs (overview / organisations /
// users / jobs / interviews / audit), all reading cross-org data from
// backend/app/routers/platform.py (super_admin-gated server-side; this module
// assumes it's only ever mounted for a super_admin, per platform-nav.ts's
// visibility gate — the 403 from the backend is the real boundary either way).
//
// Each sub-tab follows the mandatory build->bind->render triple (career-panel.ts
// is the canonical reference): buildXPanel(data) is a pure string builder,
// bindXPanel(root) wires delegated listeners, renderX() finds its static
// container, shows a loading shell, fetches, fills innerHTML, and ALWAYS calls
// bind after.
import { document } from './runtime';
import { escapeHTML } from './escape';
import { showPremiumToast } from './sourcing';
import {
  apiGetPlatformOverview,
  apiGetPlatformOrganisations,
  apiSetPlatformOrganisationStatus,
  apiGetPlatformUsers,
  apiSetPlatformUserStatus,
  apiGetPlatformJobs,
  apiGetPlatformInterviews,
  apiGetPlatformAuditLog,
  apiSwitchContext,
} from './api';

const LOADING_HTML = '<div class="ia-loading"><span class="ia-spinner"></span> Loading…</div>';

function errorHtml(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return `<div class="jd-empty-pane">Could not load: ${escapeHTML(msg)}</div>`;
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return '—';
  const d = new Date(s);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

// Drops the superadmin into that org's own real dashboard (Jobs tab) — reuses
// the exact mechanism org-switcher.ts already uses, including the full reload
// (active_org_id is a cookie the vanilla-JS mount reads fresh on boot; a
// client-side nav would leave the already-mounted dashboard scoped to the old org).
async function openOrg(orgId: string): Promise<void> {
  try {
    await apiSwitchContext(orgId);
    window.location.href = '/dashboard';
  } catch (err) {
    showPremiumToast(`Could not open that organisation: ${err instanceof Error ? err.message : 'unknown error'}`, 'error');
  }
}

// ---------- Overview ----------

export function buildPlatformOverviewPanel(data: any): string {
  const stats = [
    ['Organisations', data.organisation_count],
    ['Users', data.user_count],
    ['Jobs', data.job_count],
    ['Published Jobs', data.published_job_count],
    ['Applicants', data.applicant_count],
  ];
  const statCards = stats.map(([label, value]) => `
    <div class="card-glass platform-stat-card">
      <div class="platform-stat-label">${escapeHTML(String(label))}</div>
      <div class="platform-stat-value">${escapeHTML(String(value))}</div>
    </div>`).join('');

  const rows = (data.organisations || []).map((o: any) => `
    <tr>
      <td>${escapeHTML(o.name || 'Untitled')}</td>
      <td><span class="status-badge ${o.status === 'suspended' ? 'rejected' : 'published'}"><span class="status-badge-dot"></span>${escapeHTML(o.status)}</span></td>
      <td>${o.job_count}</td>
      <td>${fmtDate(o.created_at)}</td>
    </tr>`).join('');

  return `
    <div class="platform-stat-grid">${statCards}</div>
    <table class="stage-data-table" style="margin-top:16px">
      <thead><tr><th>Organisation</th><th>Status</th><th>Jobs</th><th>Created</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--color-text-faint);">No organisations yet.</td></tr>'}</tbody>
    </table>`;
}

export function bindPlatformOverviewPanel(_root: HTMLElement | null): void {
  // Read-only view — nothing to bind.
}

export async function renderPlatformOverview(): Promise<void> {
  const container = document.getElementById('platform-overview-content');
  if (!container) return;
  container.innerHTML = LOADING_HTML;
  try {
    const data = await apiGetPlatformOverview();
    container.innerHTML = buildPlatformOverviewPanel(data);
    bindPlatformOverviewPanel(container);
  } catch (err) {
    container.innerHTML = errorHtml(err);
  }
}

// ---------- Organisations ----------

export function buildPlatformOrganisationsPanel(data: any): string {
  const rows = (data.organisations || []).map((o: any) => `
    <tr data-org-id="${escapeHTML(o.id)}">
      <td>${escapeHTML(o.name || 'Untitled')}</td>
      <td>${escapeHTML(o.contact_email || '—')}</td>
      <td><span class="status-badge ${o.status === 'suspended' ? 'rejected' : 'published'}"><span class="status-badge-dot"></span>${escapeHTML(o.status)}</span></td>
      <td>${o.job_count}</td>
      <td>${o.user_count}</td>
      <td>${fmtDate(o.created_at)}</td>
      <td class="platform-row-actions">
        <button class="btn-remarks platform-open-org" data-org-id="${escapeHTML(o.id)}">Open →</button>
        <button class="btn-remarks platform-toggle-org-status" data-org-id="${escapeHTML(o.id)}" data-next-status="${o.status === 'suspended' ? 'active' : 'suspended'}">${o.status === 'suspended' ? 'Reactivate' : 'Suspend'}</button>
      </td>
    </tr>`).join('');

  return `
    <table class="stage-data-table">
      <thead><tr><th>Organisation</th><th>Contact</th><th>Status</th><th>Jobs</th><th>Users</th><th>Created</th><th>Actions</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--color-text-faint);">No organisations yet.</td></tr>'}</tbody>
    </table>`;
}

export function bindPlatformOrganisationsPanel(root: HTMLElement | null): void {
  if (!root) return;
  root.querySelectorAll<HTMLButtonElement>('.platform-open-org').forEach((btn) => {
    btn.addEventListener('click', () => {
      const orgId = btn.getAttribute('data-org-id');
      if (orgId) void openOrg(orgId);
    });
  });
  root.querySelectorAll<HTMLButtonElement>('.platform-toggle-org-status').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const orgId = btn.getAttribute('data-org-id');
      const nextStatus = btn.getAttribute('data-next-status') as 'active' | 'suspended' | null;
      if (!orgId || !nextStatus) return;
      if (nextStatus === 'suspended' && !window.confirm('Suspend this organisation? Its members will be blocked from the dashboard immediately.')) return;
      try {
        await apiSetPlatformOrganisationStatus(orgId, nextStatus);
        showPremiumToast(`Organisation ${nextStatus === 'suspended' ? 'suspended' : 'reactivated'}.`, 'success');
        await renderPlatformOrganisations();
      } catch (err) {
        showPremiumToast(`Could not update status: ${err instanceof Error ? err.message : 'unknown error'}`, 'error');
      }
    });
  });
}

export async function renderPlatformOrganisations(): Promise<void> {
  const container = document.getElementById('platform-organisations-content');
  if (!container) return;
  container.innerHTML = LOADING_HTML;
  try {
    const data = await apiGetPlatformOrganisations();
    container.innerHTML = buildPlatformOrganisationsPanel(data);
    bindPlatformOrganisationsPanel(container);
  } catch (err) {
    container.innerHTML = errorHtml(err);
  }
}

// ---------- Users ----------

export function buildPlatformUsersPanel(data: any): string {
  const rows = (data.users || []).map((u: any) => `
    <tr data-user-id="${escapeHTML(u.id)}">
      <td>${escapeHTML(u.name || 'Untitled')}</td>
      <td>${escapeHTML(u.email || '—')}</td>
      <td>${escapeHTML(u.organisation_name || '—')}</td>
      <td>${escapeHTML(u.user_type || '—')}</td>
      <td><span class="status-badge ${u.status === 'inactive' ? 'rejected' : 'published'}"><span class="status-badge-dot"></span>${escapeHTML(u.status || '—')}</span></td>
      <td>${fmtDate(u.created_at)}</td>
      <td class="platform-row-actions">
        <button class="btn-remarks platform-toggle-user-status" data-user-id="${escapeHTML(u.id)}" data-next-status="${u.status === 'inactive' ? 'active' : 'inactive'}">${u.status === 'inactive' ? 'Reactivate' : 'Suspend'}</button>
      </td>
    </tr>`).join('');

  return `
    <table class="stage-data-table">
      <thead><tr><th>Name</th><th>Email</th><th>Organisation</th><th>Role</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--color-text-faint);">No users yet.</td></tr>'}</tbody>
    </table>`;
}

export function bindPlatformUsersPanel(root: HTMLElement | null): void {
  if (!root) return;
  root.querySelectorAll<HTMLButtonElement>('.platform-toggle-user-status').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const userId = btn.getAttribute('data-user-id');
      const nextStatus = btn.getAttribute('data-next-status') as 'active' | 'inactive' | null;
      if (!userId || !nextStatus) return;
      if (nextStatus === 'inactive' && !window.confirm('Suspend this user? They will be signed out immediately.')) return;
      try {
        await apiSetPlatformUserStatus(userId, nextStatus);
        showPremiumToast(`User ${nextStatus === 'inactive' ? 'suspended' : 'reactivated'}.`, 'success');
        await renderPlatformUsers();
      } catch (err) {
        showPremiumToast(`Could not update status: ${err instanceof Error ? err.message : 'unknown error'}`, 'error');
      }
    });
  });
}

export async function renderPlatformUsers(): Promise<void> {
  const container = document.getElementById('platform-users-content');
  if (!container) return;
  container.innerHTML = LOADING_HTML;
  try {
    const data = await apiGetPlatformUsers();
    container.innerHTML = buildPlatformUsersPanel(data);
    bindPlatformUsersPanel(container);
  } catch (err) {
    container.innerHTML = errorHtml(err);
  }
}

// ---------- Jobs ----------

export function buildPlatformJobsPanel(data: any): string {
  const rows = (data.jobs || []).map((j: any) => `
    <tr data-job-id="${escapeHTML(j.id)}">
      <td>${escapeHTML(j.title || j.role_name || 'Untitled')}</td>
      <td>${escapeHTML(j.organisation_name || '—')}</td>
      <td><span class="status-badge ${escapeHTML(j.status || '')}"><span class="status-badge-dot"></span>${escapeHTML(j.status || '—')}</span></td>
      <td>${j.applicant_count}</td>
      <td>${fmtDate(j.created_at)}</td>
      <td class="platform-row-actions">
        <button class="btn-remarks platform-open-org" data-org-id="${escapeHTML(j.organisation_id || '')}">Open →</button>
      </td>
    </tr>`).join('');

  return `
    <table class="stage-data-table">
      <thead><tr><th>Job</th><th>Organisation</th><th>Status</th><th>Applicants</th><th>Created</th><th>Actions</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--color-text-faint);">No jobs yet.</td></tr>'}</tbody>
    </table>`;
}

export function bindPlatformJobsPanel(root: HTMLElement | null): void {
  if (!root) return;
  root.querySelectorAll<HTMLButtonElement>('.platform-open-org').forEach((btn) => {
    btn.addEventListener('click', () => {
      const orgId = btn.getAttribute('data-org-id');
      if (orgId) void openOrg(orgId);
    });
  });
}

export async function renderPlatformJobs(): Promise<void> {
  const container = document.getElementById('platform-jobs-content');
  if (!container) return;
  container.innerHTML = LOADING_HTML;
  try {
    const data = await apiGetPlatformJobs();
    container.innerHTML = buildPlatformJobsPanel(data);
    bindPlatformJobsPanel(container);
  } catch (err) {
    container.innerHTML = errorHtml(err);
  }
}

// ---------- Interviews ----------

export function buildPlatformInterviewsPanel(data: any): string {
  const rows = (data.interviews || []).map((i: any) => {
    const status = i.functional_status || i.screening_status || i.session_status || '—';
    const score = i.functional_score ?? i.screening_score;
    return `
    <tr data-applicant-id="${escapeHTML(i.applicant_id)}">
      <td>${escapeHTML(i.candidate_name || 'Untitled')}</td>
      <td>${escapeHTML(i.job_title || '—')}</td>
      <td>${escapeHTML(i.organisation_name || '—')}</td>
      <td>${escapeHTML(String(status))}</td>
      <td>${score != null ? escapeHTML(String(Math.round(score))) : '—'}</td>
      <td>${fmtDate(i.attempted_at)}</td>
      <td class="platform-row-actions">
        <button class="btn-remarks platform-open-org" data-org-id="${escapeHTML(i.organisation_id || '')}">Open org →</button>
      </td>
    </tr>`;
  }).join('');

  return `
    <table class="stage-data-table">
      <thead><tr><th>Candidate</th><th>Job</th><th>Organisation</th><th>Status</th><th>Score</th><th>Attempted</th><th>Actions</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--color-text-faint);">No interviews yet.</td></tr>'}</tbody>
    </table>`;
}

export function bindPlatformInterviewsPanel(root: HTMLElement | null): void {
  if (!root) return;
  root.querySelectorAll<HTMLButtonElement>('.platform-open-org').forEach((btn) => {
    btn.addEventListener('click', () => {
      const orgId = btn.getAttribute('data-org-id');
      if (orgId) void openOrg(orgId);
    });
  });
}

export async function renderPlatformInterviews(): Promise<void> {
  const container = document.getElementById('platform-interviews-content');
  if (!container) return;
  container.innerHTML = LOADING_HTML;
  try {
    const data = await apiGetPlatformInterviews();
    container.innerHTML = buildPlatformInterviewsPanel(data);
    bindPlatformInterviewsPanel(container);
  } catch (err) {
    container.innerHTML = errorHtml(err);
  }
}

// ---------- Audit log ----------

export function buildPlatformAuditLogPanel(data: any): string {
  const rows = (data.entries || []).map((e: any) => `
    <tr>
      <td>${escapeHTML(e.action)}</td>
      <td>${escapeHTML(e.entity_type || '—')}</td>
      <td>${escapeHTML(e.actor_id || '—')}</td>
      <td><pre class="platform-audit-detail">${escapeHTML(JSON.stringify(e.detail || {}))}</pre></td>
      <td>${fmtDate(e.created_at)}</td>
    </tr>`).join('');

  return `
    <table class="stage-data-table">
      <thead><tr><th>Action</th><th>Entity</th><th>Actor</th><th>Detail</th><th>When</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--color-text-faint);">No superadmin actions logged yet.</td></tr>'}</tbody>
    </table>`;
}

export function bindPlatformAuditLogPanel(_root: HTMLElement | null): void {
  // Read-only view — nothing to bind.
}

export async function renderPlatformAuditLog(): Promise<void> {
  const container = document.getElementById('platform-audit-content');
  if (!container) return;
  container.innerHTML = LOADING_HTML;
  try {
    const data = await apiGetPlatformAuditLog();
    container.innerHTML = buildPlatformAuditLogPanel(data);
    bindPlatformAuditLogPanel(container);
  } catch (err) {
    container.innerHTML = errorHtml(err);
  }
}
