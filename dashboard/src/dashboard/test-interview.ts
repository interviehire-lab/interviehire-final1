// Test Interview — a dev launcher that runs a full functional interview for a
// job's authored blueprint in the candidate room (ai_components/apps/web), so
// the recruiter can see exactly what a candidate experiences while developing.
//
// api mode only: it hits POST /api/jobs/{id}/test-session (creates a throwaway
// tagged test candidate + a SCHEDULED-now InterviewSession from the blueprint,
// excluded from the funnel/analytics) and opens the candidate room at
// ${ENGINE_WEB_URL}/interviewcandidateroom?sessionId=… (defaults to :3001 — apps/web hardcodes
// :3000 which collides with the dashboard).

import { document, window } from './runtime';
import { escapeHTML } from './escape';
import { soundEngine } from './sound';
import { showPremiumToast } from './sourcing';
import { isApiMode, apiCreateTestSession, ENGINE_WEB_URL } from './api';
import { ensureFunctionalBlueprint } from './blueprint-engine';

const PREVIEW_LIMIT = 5;

function functionalStats(job) {
  const topics = ensureFunctionalBlueprint(job).topics || [];
  const questions = topics.flatMap((t) => Array.isArray(t.questions) ? t.questions : []);
  const minutes = questions.reduce((sum, q) => sum + (Number(q.estimatedMinutes) || 4), 0);
  return { topicCount: topics.length, questions, minutes };
}

export function renderTestInterviewPane(job, container) {
  if (!container) return;

  // Local mode has no backend to author a session from the blueprint, but we can
  // still launch the full candidate experience as a keyless demo session (the
  // candidate room bootstraps one via GET /api/interview/demo-session).
  if (!isApiMode()) {
    const roleLabelLocal = escapeHTML(job.cardName || job.roleName || 'this role');
    container.innerHTML = `
      <div class="ti-pane">
        <div class="ti-hero card-glass">
          <div class="ti-hero-glow"></div>
          <div class="ti-hero-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          </div>
          <div class="ti-hero-body">
            <span class="ti-eyebrow">Developer tool</span>
            <h3 class="ti-title">Run a test interview</h3>
            <p class="ti-subtitle">Launch the full candidate experience for <strong>${roleLabelLocal}</strong> — system check, 8-point gaze calibration, the live AI avatar, and real-time proctoring. This demo run uses a sample session and is excluded from the funnel and analytics.</p>
            <button class="ti-launch-btn" id="ti-launch-btn-demo">
              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
              Launch test interview
            </button>
            <p class="ti-hint">Runs right here inside the portal. Switch the dashboard to API mode to run from this job's authored blueprint instead.</p>
            <div class="ti-result" id="ti-result" hidden></div>
          </div>
        </div>
      </div>`;
    const demoBtn = container.querySelector('#ti-launch-btn-demo');
    if (demoBtn) {
      demoBtn.addEventListener('click', () => {
        soundEngine.playChime([392, 523.25], 0.1, 0.1);
        embedInterviewRoom(job, container, `${ENGINE_WEB_URL}/interviewcandidateroom`, roleLabelLocal);
        showPremiumToast('Test interview started inside the portal.', 'success');
      });
    }
    return;
  }

  const { topicCount, questions, minutes } = functionalStats(job);
  const ready = questions.length > 0;
  const roleLabel = escapeHTML(job.cardName || job.roleName || 'this role');

  const previewRows = questions.slice(0, PREVIEW_LIMIT).map((q, i) => `
    <li class="ti-preview-row">
      <span class="ti-preview-num">${i + 1}</span>
      <span class="ti-preview-text">${escapeHTML(q.prompt || 'Untitled question')}</span>
      ${q.difficulty ? `<span class="ti-preview-diff ti-diff-${escapeHTML((q.difficulty || '').toLowerCase())}">${escapeHTML(q.difficulty)}</span>` : ''}
    </li>`).join('');
  const moreCount = Math.max(0, questions.length - PREVIEW_LIMIT);

  container.innerHTML = `
    <div class="ti-pane">
      <div class="ti-hero card-glass">
        <div class="ti-hero-glow"></div>
        <div class="ti-hero-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        </div>
        <div class="ti-hero-body">
          <span class="ti-eyebrow">Developer tool</span>
          <h3 class="ti-title">Run a test interview</h3>
          <p class="ti-subtitle">Launch the full candidate experience for <strong>${roleLabel}</strong> using the functional blueprint you authored — questions, follow-ups, and scoring, exactly as a real candidate would see it. This test run is excluded from the funnel and analytics.</p>

          <div class="ti-stats">
            <div class="ti-stat"><span class="ti-stat-val">${topicCount}</span><span class="ti-stat-label">topic${topicCount === 1 ? '' : 's'}</span></div>
            <div class="ti-stat"><span class="ti-stat-val">${questions.length}</span><span class="ti-stat-label">question${questions.length === 1 ? '' : 's'}</span></div>
            <div class="ti-stat"><span class="ti-stat-val">~${minutes}</span><span class="ti-stat-label">min</span></div>
          </div>

          ${ready ? `
            <button class="ti-launch-btn" id="ti-launch-btn">
              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
              Launch test interview
            </button>
            <p class="ti-hint">Runs right here inside the portal — system check, gaze calibration, live avatar and proctoring.</p>
            <div class="ti-result" id="ti-result" hidden></div>
          ` : `
            <div class="ti-warn">
              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              <span>No functional questions yet. Author a blueprint in the <strong>Questions Generator</strong> tab for a full blueprint run — or open the candidate room now with a sample session.</span>
            </div>
            <button class="ti-launch-btn" id="ti-open-room">
              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
              Open candidate room
            </button>
            <p class="ti-hint">Opens the candidate room in-portal with a keyless sample session — system check, gaze calibration, live avatar and proctoring.</p>
            <div class="ti-result" id="ti-result" hidden></div>
          `}
        </div>
      </div>

      ${ready ? `
        <div class="ti-preview card-glass">
          <div class="ti-preview-head">
            <h4>What the candidate will be asked</h4>
            <span class="ti-preview-count">${questions.length} question${questions.length === 1 ? '' : 's'}</span>
          </div>
          <ol class="ti-preview-list">${previewRows}</ol>
          ${moreCount > 0 ? `<p class="ti-preview-more">+ ${moreCount} more in the full run</p>` : ''}
        </div>
      ` : ''}
    </div>`;

  const launchBtn = container.querySelector('#ti-launch-btn');
  if (launchBtn) {
    launchBtn.addEventListener('click', () => launchTestInterview(job, launchBtn, container));
  }

  // No authored blueprint → still let the recruiter open the (correct) candidate
  // room with a keyless sample session: the room bootstraps one via
  // GET /api/interview/demo-session, so no test-session is created from a blank
  // blueprint. The room itself owns the avatar + proctoring experience.
  const openRoomBtn = container.querySelector('#ti-open-room');
  if (openRoomBtn) {
    openRoomBtn.addEventListener('click', () => {
      soundEngine.playChime([392, 523.25], 0.1, 0.1);
      const roleLabelOpen = escapeHTML(job.cardName || job.roleName || 'this role');
      embedInterviewRoom(job, container, `${ENGINE_WEB_URL}/interviewcandidateroom`, roleLabelOpen);
      showPremiumToast('Candidate room opened inside the portal.', 'success');
    });
  }
}

async function launchTestInterview(job, btn, container) {
  soundEngine.playChime([392, 523.25], 0.1, 0.1);
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.classList.add('is-loading');
  btn.innerHTML = `<span class="ti-spinner"></span> Preparing interview…`;

  try {
    const sessionId = await apiCreateTestSession(job.id);
    if (!sessionId) throw new Error('No session id returned');

    const url = `${ENGINE_WEB_URL}/interviewcandidateroom?sessionId=${encodeURIComponent(sessionId)}`;
    embedInterviewRoom(job, container, url, escapeHTML(job.cardName || job.roleName || 'this role'));
    showPremiumToast('Test interview started inside the portal.', 'success');
    soundEngine.playChime([523.25, 659.25, 783.99], 0.14, 0.08);
  } catch (err) {
    console.error('Test interview launch failed:', err);
    showPremiumToast(`Could not launch test interview. ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.classList.remove('is-loading');
    btn.innerHTML = original;
  }
}

// Embed the candidate interview room *inside* the portal (an iframe in the Test
// Interview pane) instead of opening a new tab, so the whole experience — system
// check, gaze calibration, live avatar and proctoring — runs in-portal. Camera,
// microphone, screen-share and fullscreen are delegated to the frame via `allow`.
function embedInterviewRoom(job, container, url, roleLabel) {
  container.innerHTML = `
    <div class="ti-embed">
      <div class="ti-embed-bar">
        <div class="ti-embed-title">
          <span class="ti-embed-dot"></span>
          <span>Test interview · <strong>${roleLabel}</strong></span>
        </div>
        <div class="ti-embed-actions">
          <a class="ti-embed-link" href="${escapeHTML(url)}" target="_blank" rel="noopener">Open in new tab ↗</a>
          <button class="ti-embed-close" type="button" id="ti-embed-close">✕ End &amp; close</button>
        </div>
      </div>
      <iframe
        class="ti-embed-frame"
        src="${escapeHTML(url)}"
        title="Candidate interview room"
        allow="camera; microphone; display-capture; autoplay; fullscreen; clipboard-write; gamepad; xr-spatial-tracking"
        allowfullscreen
      ></iframe>
    </div>`;
  const closeBtn = container.querySelector('#ti-embed-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      try { soundEngine.playChime([523.25, 392], 0.1, 0.1); } catch (e) { /* noop */ }
      renderTestInterviewPane(job, container);
    });
  }
}
