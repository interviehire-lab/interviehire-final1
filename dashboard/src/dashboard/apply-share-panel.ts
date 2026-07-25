import { document, window } from './runtime';
import { AppState } from './state';
import { escapeHTML } from './escape';
import { isApiMode, apiSetApplicationsClose } from './api';
import { showPremiumToast } from './sourcing';

// "Apply Link" job-detail tab (its own pane, alongside Resume Analysis etc.).
// Everything a recruiter needs to distribute the candidate-facing apply link for
// one job: the shareable direct/careers links, a copy-paste embed button, a
// client-side QR (no third-party QR service), and an optional "applications
// close" deadline — all pointing at the backend-hosted apply page (public.py) so
// candidate data flows straight into this pipeline.
//
// Follows the dashboard build→bind pairing: renderApplyShare() fills the static
// #jd-apply-share shell and ALWAYS calls bindApplyShare() so the buttons/QR live.
// A short loading state covers the one async cost (dynamic-importing `qrcode`),
// and a signature guard skips redundant re-renders so tab switches / applicant
// hydrates (renderJobDetailPanes runs more than once per open) don't reflash it.

// Public origin for candidate-facing links. Referenced directly so Next.js inlines
// the configured value into the browser bundle (a typeof-process guard would be
// dead-code-eliminated and silently drop it). Defaults to the dashboard origin,
// which ALREADY proxies /api/public/* to the backend first-party (next.config.js
// rewrites) — so the link works with zero extra infra. Override the env to a
// branded apex (interviehire.com) only once that host also forwards /api/* to the
// backend.
const PUBLIC_BASE = (process.env.NEXT_PUBLIC_PUBLIC_BASE_URL || 'https://app.interviehire.com').replace(/\/+$/, '');

function directApplyUrl(jobId: string): string {
  return `${PUBLIC_BASE}/api/public/apply/${jobId}`;
}
function careersApplyUrl(sub: string, jobId: string): string {
  return `${PUBLIC_BASE}/api/public/careers/${encodeURIComponent(sub)}/apply/${jobId}`;
}

// ── expiry helpers ─────────────────────────────────────────────────────────────
// Stored value is a UTC ISO string (or null). datetime-local inputs speak local
// wall-clock with no zone, so convert on the way in/out.
function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function localInputToIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return isNaN(d.getTime()) ? null : d.toISOString();
}
function formatDeadline(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
function isClosed(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  return !isNaN(d.getTime()) && d.getTime() <= Date.now();
}

// Re-render signature — rebuild only when the job or its apply-state actually
// changes, so repeated renderJobDetailPanes() calls don't reflash the QR.
function panelSig(job: any): string {
  return [String(job.id), job.status, job.listedOnCareer, job.applicationsCloseAt || ''].join('|');
}

// Panel-local keyframes / hover styles, injected once into <head>.
function ensureStyles(): void {
  if (document.getElementById('apply-share-styles')) return;
  const s = document.createElement('style');
  s.id = 'apply-share-styles';
  s.textContent = `
    @keyframes apply-spin { to { transform: rotate(360deg); } }
    @keyframes apply-fade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
    .apply-spinner { width: 22px; height: 22px; border-radius: 50%;
      border: 2.5px solid rgba(56,189,248,0.22); border-top-color: #38bdf8;
      animation: apply-spin .7s linear infinite; }
    .apply-fade-in { animation: apply-fade .28s ease both; }
    .btn-copy-share:hover { background: rgba(56,189,248,0.22) !important; }
    .apply-ghost-btn:hover { background: rgba(255,255,255,0.09) !important; }
    #apply-expiry-save:hover { background: rgba(56,189,248,0.24) !important; }`;
  document.head.appendChild(s);
}

// ── pieces ───────────────────────────────────────────────────────────────────
function headerBlock(): string {
  return `
    <div style="display:flex;align-items:flex-start;gap:13px;">
      <div style="flex:0 0 auto;width:40px;height:40px;border-radius:11px;display:flex;align-items:center;justify-content:center;background:rgba(56,189,248,0.12);border:1px solid rgba(56,189,248,0.28);">
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>
      </div>
      <div>
        <h3 style="margin:0;font-size:16px;font-weight:700;color:#f1f5f9;letter-spacing:-0.01em;">Apply link &amp; share</h3>
        <p style="margin:4px 0 0;font-size:13px;color:#94a3b8;line-height:1.5;max-width:580px;">Share one link wherever candidates apply — your website, LinkedIn, email, or a QR. Applicants land on your hosted apply page and flow straight into this pipeline.</p>
      </div>
    </div>`;
}

function statusBanner(job: any): string {
  const isLive = job.status === 'published' && job.listedOnCareer === true;
  const closeAt = job.applicationsCloseAt || null;
  const wrap = (bg: string, border: string, color: string, dot: string, text: string) => `
    <div style="display:flex;align-items:center;gap:10px;margin-top:15px;padding:11px 14px;border-radius:11px;background:${bg};border:1px solid ${border};color:${color};font-size:12.5px;font-weight:500;line-height:1.4;">
      <span style="flex:0 0 auto;width:8px;height:8px;border-radius:50%;background:${dot};box-shadow:0 0 0 3px ${bg};"></span>
      <span>${text}</span>
    </div>`;
  if (!isLive) {
    return wrap('rgba(251,191,36,0.1)', 'rgba(251,191,36,0.28)', '#fbbf24', '#fbbf24',
      'Publish this job and list it on your career page to activate the link.');
  }
  if (isClosed(closeAt)) {
    return wrap('rgba(248,113,113,0.1)', 'rgba(248,113,113,0.3)', '#f87171', '#f87171',
      `Applications closed on ${escapeHTML(formatDeadline(closeAt))}. Clear the deadline below to reopen.`);
  }
  if (closeAt) {
    return wrap('rgba(52,211,153,0.09)', 'rgba(52,211,153,0.24)', '#34d399', '#34d399',
      `Live — applications close ${escapeHTML(formatDeadline(closeAt))}.`);
  }
  return wrap('rgba(52,211,153,0.09)', 'rgba(52,211,153,0.24)', '#34d399', '#34d399',
    'Live — the link stays open while this job is published &amp; listed.');
}

function copyButton(target: string, extraStyle = ''): string {
  return `<button type="button" class="btn-copy-share" data-copy-target="${escapeHTML(target)}"
    style="display:inline-flex;align-items:center;gap:6px;padding:11px 15px;border-radius:10px;border:1px solid rgba(56,189,248,0.35);background:rgba(56,189,248,0.14);color:#38bdf8;font-weight:600;font-size:13px;cursor:pointer;white-space:nowrap;transition:background .15s;${extraStyle}">
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
    <span class="copy-label">Copy</span>
  </button>`;
}

function linkField(label: string, value: string, id: string, hint: string): string {
  return `
    <div style="margin-bottom:16px;">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:6px;">
        <label style="font-size:12px;font-weight:600;color:#cbd5e1;">${escapeHTML(label)}</label>
        ${hint ? `<span style="font-size:11px;color:#64748b;white-space:nowrap;">${escapeHTML(hint)}</span>` : ''}
      </div>
      <div style="display:flex;gap:8px;">
        <input id="${escapeHTML(id)}" type="text" readonly value="${escapeHTML(value)}"
          style="flex:1;min-width:0;padding:11px 13px;border-radius:10px;border:1px solid rgba(255,255,255,0.1);background:rgba(2,6,23,0.55);color:#e2e8f0;font-size:12.5px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;" />
        ${copyButton(id)}
      </div>
    </div>`;
}

function qrCard(): string {
  return `
    <div style="flex:0 0 auto;display:flex;flex-direction:column;align-items:center;gap:12px;padding:18px 20px;border-radius:14px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.02);">
      <div style="font-size:12px;font-weight:600;color:#cbd5e1;align-self:flex-start;">QR code</div>
      <div style="position:relative;width:168px;height:168px;border-radius:12px;background:#fff;box-shadow:0 6px 20px rgba(0,0,0,0.28);display:flex;align-items:center;justify-content:center;overflow:hidden;">
        <div id="apply-qr-loading" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;background:#fff;color:#64748b;font-size:11px;">
          <span class="apply-spinner"></span>Generating…
        </div>
        <canvas id="apply-qr" width="150" height="150" role="img" aria-label="Apply link QR code" style="display:block;"></canvas>
      </div>
      <button type="button" id="apply-qr-download" class="apply-ghost-btn"
        style="display:inline-flex;align-items:center;gap:6px;padding:9px 16px;border-radius:9px;border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.04);color:#cbd5e1;font-size:12px;font-weight:600;cursor:pointer;transition:background .15s;">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
        Download PNG
      </button>
      <div style="font-size:11px;color:#64748b;text-align:center;max-width:180px;line-height:1.5;">Print on posters, flyers, or campus boards — a scan opens the apply page.</div>
    </div>`;
}

// Deadline editor (only in API mode — needs a backend job to persist to).
function deadlineSection(job: any): string {
  if (!isApiMode() || !job._backend) return '';
  const closeAt = job.applicationsCloseAt || null;
  const val = escapeHTML(isoToLocalInput(closeAt));
  const clearBtn = closeAt
    ? `<button type="button" id="apply-expiry-clear" class="apply-ghost-btn" style="padding:10px 16px;border-radius:10px;border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.04);color:#cbd5e1;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;transition:background .15s;">Clear</button>`
    : '';
  return `
    <div style="margin-top:24px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.08);">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
        <label style="font-size:13px;font-weight:600;color:#e2e8f0;">Application deadline</label>
        <span style="font-size:11px;color:#64748b;">optional</span>
      </div>
      <p style="color:#94a3b8;font-size:12px;margin:0 0 11px;line-height:1.5;max-width:560px;">Automatically stop accepting applications after a chosen date &amp; time. Leave empty to keep the link open while the job is published &amp; listed — after the deadline, the apply page shows a “closed” message.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <input id="apply-expiry" type="datetime-local" value="${val}"
          style="flex:1;min-width:220px;padding:10px 13px;border-radius:10px;border:1px solid rgba(255,255,255,0.12);background:rgba(2,6,23,0.55);color:#e2e8f0;font-size:13px;color-scheme:dark;" />
        <button type="button" id="apply-expiry-save"
          style="padding:10px 18px;border-radius:10px;border:1px solid rgba(56,189,248,0.35);background:rgba(56,189,248,0.16);color:#38bdf8;font-weight:600;font-size:13px;cursor:pointer;white-space:nowrap;transition:background .15s;">Save deadline</button>
        ${clearBtn}
      </div>
    </div>`;
}

function buildLoading(): string {
  return `
    <div class="apply-fade-in" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:15px;min-height:280px;padding:40px 20px;">
      <span class="apply-spinner" style="width:30px;height:30px;border-width:3px;"></span>
      <div style="color:#94a3b8;font-size:13px;">Preparing your apply link…</div>
    </div>`;
}

export function buildApplyShare(job: any): string {
  const jobId = String(job.id);
  const sub = (AppState.careerSubdomain || '').trim();
  const direct = directApplyUrl(jobId);
  const careers = sub ? careersApplyUrl(sub, jobId) : '';
  const role = escapeHTML(job.roleName || job.cardName || 'this role');
  const embed = `<a href="${escapeHTML(direct)}" target="_blank" rel="noopener" style="display:inline-block;padding:12px 24px;background:#38bdf8;color:#0f172a;font-weight:600;border-radius:8px;text-decoration:none;font-family:sans-serif;">Apply for ${role}</a>`;

  return `
    <div class="apply-fade-in">
      ${headerBlock()}
      ${statusBanner(job)}
      <div style="display:flex;gap:26px;flex-wrap:wrap;align-items:flex-start;margin-top:20px;">
        <div style="flex:1 1 340px;min-width:290px;">
          ${linkField('Direct apply link', direct, 'apply-url-direct', 'Website · LinkedIn · email')}
          ${careers ? linkField('Careers-page link', careers, 'apply-url-careers', 'Branded subdomain') : ''}
          <div>
            <label style="display:block;font-size:12px;font-weight:600;color:#cbd5e1;margin-bottom:6px;">Embed button <span style="font-weight:400;color:#64748b;">— paste into your site</span></label>
            <div style="display:flex;gap:8px;align-items:flex-start;">
              <textarea id="apply-embed" readonly rows="3"
                style="flex:1;min-width:0;padding:11px 13px;border-radius:10px;border:1px solid rgba(255,255,255,0.1);background:rgba(2,6,23,0.55);color:#e2e8f0;font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;resize:vertical;line-height:1.5;">${escapeHTML(embed)}</textarea>
              ${copyButton('apply-embed', 'align-self:flex-start;')}
            </div>
          </div>
        </div>
        ${qrCard()}
      </div>
      ${deadlineSection(job)}
    </div>`;
}

export function bindApplyShare(root: any, job: any): void {
  if (!root) return;
  const jobId = String(job.id);
  const direct = directApplyUrl(jobId);

  // QR — rendered fully client-side (no third-party service). The lib is already
  // warmed by renderApplyShare, so this draws immediately; the spinner overlay
  // hides on completion.
  const canvas = root.querySelector('#apply-qr');
  const qrLoading = root.querySelector('#apply-qr-loading');
  if (canvas) {
    import('qrcode')
      .then((mod: any) => {
        const QR = mod && (mod.default || mod);
        if (QR && typeof QR.toCanvas === 'function') {
          QR.toCanvas(canvas, direct, { width: 150, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0f172a', light: '#ffffff' } }, () => {
            if (qrLoading) qrLoading.style.display = 'none';
          });
        } else if (qrLoading) {
          qrLoading.textContent = 'Copy the link instead';
        }
      })
      .catch(() => {
        // Lib unavailable (shouldn't happen once bundled) — leave a hint, not a blank box.
        if (qrLoading) qrLoading.textContent = 'Copy the link instead';
      });

    const dl = root.querySelector('#apply-qr-download');
    if (dl) {
      dl.addEventListener('click', () => {
        try {
          const url = canvas.toDataURL('image/png');
          const a = document.createElement('a');
          a.href = url;
          a.download = `apply-qr-${jobId}.png`;
          document.body.appendChild(a);
          a.click();
          a.remove();
        } catch (e) {
          showPremiumToast('Could not export the QR image.', 'error');
        }
      });
    }
  }

  // Copy buttons — toggle the inner label so the icon survives the "Copied!" flash.
  root.querySelectorAll('.btn-copy-share').forEach((btn: any) => {
    btn.addEventListener('click', async () => {
      const targetId = btn.getAttribute('data-copy-target');
      const field = targetId && root.querySelector('#' + targetId);
      if (!field) return;
      const label = btn.querySelector('.copy-label');
      try {
        await window.navigator.clipboard.writeText(field.value != null ? field.value : '');
        if (label) {
          const original = label.textContent;
          label.textContent = 'Copied!';
          window.setTimeout(() => { label.textContent = original; }, 1400);
        }
      } catch (e) {
        // Clipboard blocked (insecure context / permissions) — select for manual copy.
        if (typeof field.select === 'function') field.select();
      }
    });
  });

  // Deadline: save / clear, then re-render this panel from the updated job.
  const saveBtn = root.querySelector('#apply-expiry-save');
  const clearBtn = root.querySelector('#apply-expiry-clear');

  const rerender = () => {
    // Reflect the new state in-place (no loading flash) and keep the signature in
    // sync so a later renderJobDetailPanes() doesn't rebuild again.
    const container = document.getElementById('jd-apply-share');
    if (container) container.dataset.sig = panelSig(job);
    root.innerHTML = buildApplyShare(job);
    bindApplyShare(root, job);
  };

  async function persist(iso: string | null, btn: any, doneLabel: string) {
    if (!job._backend) { showPremiumToast('Connect the live backend to set an apply deadline.', 'error'); return; }
    const original = btn.textContent;
    btn.textContent = 'Saving…'; btn.disabled = true;
    try {
      await apiSetApplicationsClose(String(job.id), iso);
      job.applicationsCloseAt = iso;               // keep local job in sync
      showPremiumToast(doneLabel, 'success');
      rerender();
    } catch (e: any) {
      btn.textContent = original; btn.disabled = false;
      showPremiumToast(`Could not update the deadline: ${(e && e.message) || 'backend error'}`, 'error');
    }
  }

  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      const input = root.querySelector('#apply-expiry');
      const iso = localInputToIso(input ? input.value : '');
      if (!iso) { showPremiumToast('Pick a date and time, or use Clear to remove the deadline.', 'error'); return; }
      if (new Date(iso).getTime() <= Date.now()
        && !window.confirm('That time is in the past — the apply link will be closed immediately. Continue?')) return;
      persist(iso, saveBtn, 'Apply deadline saved.');
    });
  }
  if (clearBtn) {
    clearBtn.addEventListener('click', () => persist(null, clearBtn, 'Apply deadline cleared — link reopened.'));
  }
}

// Hydrate / re-render entry point. No-op when the Apply Link shell isn't mounted.
// Shows a brief loading state while the async `qrcode` import lands, then swaps in
// the fully-formed panel. A signature guard skips redundant re-renders so tab
// switches and applicant hydrates don't reflash the QR.
export function renderApplyShare(job: any): void {
  const container = document.getElementById('jd-apply-share');
  if (!container || !job) return;
  ensureStyles();

  const sig = panelSig(job);
  if (container.dataset.sig === sig && container.dataset.ready === '1') return;
  container.dataset.sig = sig;
  container.dataset.ready = '';

  // Loading screen while the one async cost — the dynamic `qrcode` import — lands.
  container.innerHTML = buildLoading();
  const finish = () => {
    if (container.dataset.sig !== sig) return; // job changed while the lib loaded
    container.innerHTML = buildApplyShare(job);
    bindApplyShare(container, job);
    container.dataset.ready = '1';
  };
  import('qrcode').then(finish).catch(finish);
}
