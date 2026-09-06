import { document, requestAnimationFrame } from './runtime';
import { drawFunnelSVG, drawScoreDistributionSVG } from './funnel-charts';
import { renderJobDetailPanes } from './job-detail-panes';
import { renderFunnelInsights, renderFunnelStages, toggleHeaderElementsForJobFlow } from './job-flow';
import { navigateToTab } from './navigation';
import { filterCandidatesByDateRange } from './render-views';
import { soundEngine } from './sound';
import { AppState } from './state';
import { isApiMode, apiFetchApplicants } from './api';
import { showPremiumToast } from './sourcing';
import { pushUrl } from './url-sync';
import { recalculateJobPipelines } from './kanban-swarm';
import { STAGE_SLUG_TO_TAB, jobStageUrl } from './job-stages';

// ==========================================
// JOB DETAIL VIEW
// ==========================================

function navigateToJobDetail(jobId, stage = 'overview') {
  const job = AppState.jobs.find(j => j.id === jobId);
  if (!job) return;

  // Resolve the requested stage to a valid tab id; default to Overview.
  const initialTab = document.querySelector(`.jd-tab[data-jd-tab="${stage}"]`) ? stage : 'overview';

  AppState.activeJobId = jobId;
  AppState.activeTab = 'job-detail';
  pushUrl(jobStageUrl(jobId, initialTab));

  // Recalculate pipelines first based on current AppState.candidates
  recalculateJobPipelines();


  // Sidebar: keep Jobs highlighted as parent
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
    item.classList.toggle('active', item.getAttribute('data-tab') === 'jobs');
  });
  document.querySelectorAll('.sub-nav li').forEach(li => li.classList.remove('active-sub'));

  // Breadcrumb — "Jobs" clickable link and Job Name clickable link
  const breadcrumb = document.getElementById('breadcrumb-title');
  const shortName = job.cardName.length > 30 ? job.cardName.slice(0, 30) + '…' : job.cardName;
  breadcrumb.innerHTML = `<span class="breadcrumb-link" id="bc-jobs-link">Jobs</span>
    <span class="breadcrumb-separator">/</span> <span class="breadcrumb-link" id="bc-jobname-link">${shortName}</span>
    <span class="breadcrumb-separator">/</span> Responses`;
  document.getElementById('bc-jobs-link').addEventListener('click', () => {
    navigateToTab('jobs');
    pushUrl('/dashboard/jobs');
  });
  document.getElementById('bc-jobname-link').addEventListener('click', () => {
    navigateToJobStage(job.id, 'overview');
    soundEngine.playClick();
  });

  // Header
  toggleHeaderElementsForJobFlow(false);
  document.getElementById('header-main-title').textContent = job.cardName;
  document.getElementById('header-sub-text').textContent =
    `${job.pipeline.total} total candidate${job.pipeline.total !== 1 ? 's' : ''} · ${job.roleName}`;
  document.getElementById('header-action-btn').style.display = 'none';

  // Show view
  document.querySelectorAll('.dashboard-view').forEach(v => v.classList.remove('active-view'));
  document.getElementById('view-job-detail').classList.add('active-view');

  // Sub-tab counts. jd-count-resume has no matching element in the template
  // (only screening/functional pills exist, dashboard-crystal.js) — guard it
  // the same way the refresh path below (line ~138) already does.
  const jdCountResumeEl = document.getElementById('jd-count-resume');
  if (jdCountResumeEl) jdCountResumeEl.textContent = job.pipeline.resume;
  document.getElementById('jd-count-screening').textContent = job.pipeline.screening;
  document.getElementById('jd-count-functional').textContent = job.pipeline.functional;

  // Dynamic tabs hiding based on pipeline config
  const cfg = job.pipelineConfig || {
    resumeAnalysis: { enabled: true },
    recruiterScreening: { enabled: true },
    functionalInterview: { enabled: true }
  };

  const tabResume = document.querySelector('.jd-tab[data-jd-tab="resume"]');
  const tabScreening = document.querySelector('.jd-tab[data-jd-tab="screening"]');
  const tabFunctional = document.querySelector('.jd-tab[data-jd-tab="functional"]');

  if (tabResume) tabResume.style.display = cfg.resumeAnalysis?.enabled !== false ? '' : 'none';
  if (tabScreening) tabScreening.style.display = cfg.recruiterScreening?.enabled !== false ? '' : 'none';
  if (tabFunctional) tabFunctional.style.display = cfg.functionalInterview?.enabled !== false ? '' : 'none';

  // Activate the requested stage tab (defaults to Overview).
  document.querySelectorAll('.jd-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.jd-tab[data-jd-tab="${initialTab}"]`)?.classList.add('active');
  document.querySelectorAll('.jd-pane').forEach(p => p.classList.remove('active'));
  document.getElementById(`jd-pane-${initialTab}`)?.classList.add('active');

  const jobCandidates = filterCandidatesByDateRange(AppState.candidates).filter(c => {
    if (isApiMode() && job._backend) {
      return c.jobId === job.id;
    }
    return c.jobApplied === job.roleName || c.jobApplied === job.cardName;
  });

  renderFunnelStages(job);
  renderFunnelInsights(job);
  renderJobDetailPanes(job);

  // SVG needs layout to be painted first
  requestAnimationFrame(() => {
    drawFunnelSVG(job, jobCandidates);
    drawScoreDistributionSVG(job, jobCandidates);
  });

  hydrateBackendApplicants(job);

  soundEngine.playChime([440.00, 523.25, 659.25], 0.12, 0.08);
}

// In api mode a job's applicants live in the backend, not localStorage. Fetch
// them on open, tag each to this job so the existing name-based candidate
// filters match, merge into AppState, and re-render. Fire-and-forget: panes
// render immediately (empty) then fill in when the fetch lands. Inert otherwise.
async function hydrateBackendApplicants(job) {
  if (!isApiMode() || !job._backend) return;
  let applicants;
  try {
    applicants = await apiFetchApplicants(job.id, 'resume');
  } catch (e) {
    showPremiumToast(`Couldn't load candidates: ${(e && e.message) || 'backend error'}`, 'error');
    return;
  }
  applicants.forEach((c) => { c.jobApplied = job.roleName; c.jobId = job.id; });
  const others = (AppState.candidates || []).filter((c) => c.jobId !== job.id);
  AppState.candidates = [...others, ...applicants];

  // Only refresh if the user is still viewing this job.
  if (AppState.activeJobId !== job.id) return;

  // Recalculate pipelines first based on newly hydrated candidates
  recalculateJobPipelines();

  // Update sub-tab counts
  const elResume = document.getElementById('jd-count-resume');
  if (elResume) elResume.textContent = job.pipeline.resume;
  const elScreening = document.getElementById('jd-count-screening');
  if (elScreening) elScreening.textContent = job.pipeline.screening;
  const elFunctional = document.getElementById('jd-count-functional');
  if (elFunctional) elFunctional.textContent = job.pipeline.functional;

  renderFunnelStages(job);
  renderFunnelInsights(job);
  renderJobDetailPanes(job);
  const jobCandidates = filterCandidatesByDateRange(AppState.candidates).filter(c => {
    if (isApiMode() && job._backend) {
      return c.jobId === job.id;
    }
    return c.jobApplied === job.roleName || c.jobApplied === job.cardName;
  });
  requestAnimationFrame(() => {
    drawFunnelSVG(job, jobCandidates);
    drawScoreDistributionSVG(job, jobCandidates);
  });
}


// Deep-link / tab entry point: open `jobId` at the given URL stage slug
// (e.g. 'functional-interview'). On first open it delegates to
// navigateToJobDetail; for an already-open job it just switches the tab/pane
// so URL-driven navigation stays idempotent (no double render, no loop).
function navigateToJobStage(jobId, slug) {
  const tabId = STAGE_SLUG_TO_TAB[slug] || 'overview';
  const alreadyOpen = AppState.activeJobId === jobId &&
    document.getElementById('view-job-detail')?.classList.contains('active-view');
  if (!alreadyOpen) {
    navigateToJobDetail(jobId, tabId);
    return;
  }
  const tab = document.querySelector(`.jd-tab[data-jd-tab="${tabId}"]`);
  if (!tab || tab.classList.contains('active')) return; // already on this stage
  document.querySelectorAll('.jd-tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  document.querySelectorAll('.jd-pane').forEach(p => p.classList.remove('active'));
  document.getElementById(`jd-pane-${tabId}`)?.classList.add('active');
  pushUrl(jobStageUrl(jobId, tabId));
  const job = AppState.jobs.find(j => j.id === jobId);
  if (job) renderJobDetailPanes(job);
}

export { navigateToJobDetail, navigateToJobStage };
