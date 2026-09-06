import { document, setTimeout } from './runtime';

// Time-of-day greeting personalised with the signed-in user's name. The name is
// bridged in by the React auth guard via globalThis.IH_USER_NAME (set after
// /api/auth/me resolves). Falls back to a nameless greeting until it's known.
export function buildGreeting() {
  const name = (globalThis.IH_USER_NAME || '').trim();
  const h = new Date().getHours();
  const part = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  const icon = h < 12 ? '🌤️' : h < 18 ? '☀️' : '🌙';
  return name ? `${part}, ${name} ${icon}` : `${part} ${icon}`;
}
try { globalThis.__ihBuildGreeting = buildGreeting; } catch {}
import { escapeHTML } from './escape';
import { EXPERIENCE_BANDS_PROMPT } from './constants';
import { callDeepSeekAPI, enrichJobWithAI, parseAIJson, saveStateToLocalStorage } from './ai-api';
import { openJobFlowView, toggleHeaderElementsForJobFlow } from './job-flow';
import { renderKanbanBoard, resetWaveformAudio } from './kanban-swarm';
import { renderTalentFinderPane } from './talent-finder-panel';
import { renderAnalyticsTable, renderJobCards, renderTeamTable, hydrateUsageAnalytics } from './render-views';
import { renderCareerJobs } from './career-panel';
import { renderDataRights } from './data-rights-panel';
import {
  renderPlatformOverview,
  renderPlatformOrganisations,
  renderPlatformUsers,
  renderPlatformJobs,
  renderPlatformInterviews,
  renderPlatformAuditLog,
} from './platform-panel';
import { soundEngine } from './sound';
import { syncSettingsControls } from './settings-page';
import { AppState, generateJobId } from './state';
import { pushUrl } from './url-sync';
import { isApiMode, apiCreateJob, apiPatchJobParameters } from './api';

// ==========================================
// VIEW SWITCHER ROUTING
// ==========================================
// ==========================================
// VIEW SWITCHER ROUTING
// ==========================================
function navigateToTab(tabId) {
  AppState.activeTab = tabId;
  AppState.activeSubtab = '';

  const TAB_URLS = {
    'jobs':      '/dashboard/jobs',
    'analytics': '/dashboard/analytics',
    'talent':    '/dashboard/talent',
    'team':      '/dashboard/team',
    'career':    '/dashboard/career',
    'data-rights': '/dashboard/data-rights',
    'settings':  '/dashboard/settings/general',
  };
  const url = TAB_URLS[tabId];
  if (url) {
    pushUrl(url);
  }

  // Update Sidebar Active state
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
    if (item.getAttribute('data-tab') === tabId) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  // Remove subtab active markers
  document.querySelectorAll('.sub-nav li').forEach(li => li.classList.remove('active-sub'));

  // Update Dynamic views display
  document.querySelectorAll('.dashboard-view').forEach(view => {
    view.classList.remove('active-view');
  });

  // Set titles & buttons contextually
  const breadcrumb = document.getElementById('breadcrumb-title');
  const mainTitle = document.getElementById('header-main-title');
  const subText = document.getElementById('header-sub-text');
  const actionBtn = document.getElementById('header-action-btn');
  const actionBtnText = document.getElementById('header-action-btn-text');

  actionBtn.style.display = 'flex'; // Reset to visible
  toggleHeaderElementsForJobFlow(false);

  if (tabId === 'jobs') {
    breadcrumb.textContent = 'Jobs';
    mainTitle.textContent = buildGreeting();
    subText.textContent = 'A squad of AI agents working for you';
    actionBtnText.textContent = 'New Job';
    document.getElementById('view-jobs').classList.add('active-view');
    
    const isBoard = document.getElementById('btn-view-board').classList.contains('active');
    if (isBoard) {
      renderKanbanBoard();
    } else {
      renderJobCards();
    }
    soundEngine.playChime([261.63, 329.63], 0.12, 0.1);

  } else if (tabId === 'analytics') {
    breadcrumb.textContent = 'Usage Overview';
    mainTitle.textContent = 'Usage Overview';
    subText.textContent = 'Track applicants funnel metrics and pipelines';
    actionBtnText.textContent = 'New Job';
    document.getElementById('view-analytics').classList.add('active-view');
    // API mode → fetch the active org's real usage data; local mode falls back
    // to deriving the cards/table from AppState (handled inside the hydrator).
    hydrateUsageAnalytics();
    soundEngine.playChime([261.63, 329.63, 392.00], 0.12, 0.12);


  } else if (tabId === 'talent') {
    breadcrumb.textContent = 'Talent Finder';
    mainTitle.textContent = 'Talent Finder';
    subText.textContent = 'Compliant AI sourcing — search, rank, and reach out to candidates';
    actionBtn.style.display = 'none'; // No primary CTA for the talent finder page
    document.getElementById('view-talent').classList.add('active-view');
    renderTalentFinderPane(null);
    soundEngine.playChime([261.63, 392.00, 523.25], 0.15, 0.12);

  } else if (tabId === 'team') {
    breadcrumb.textContent = 'Team Access';
    mainTitle.textContent = 'Team Access Settings';
    subText.textContent = 'Manage organisation access, usertypes, and invite collaborators';
    actionBtnText.textContent = 'Invite Member';
    document.getElementById('view-team').classList.add('active-view');
    renderTeamTable();
    soundEngine.playChime([261.63, 329.63, 493.88], 0.15, 0.12);

  } else if (tabId === 'career') {
    breadcrumb.textContent = 'Career Page';
    mainTitle.textContent = 'Career Subdomain Control';
    subText.textContent = 'Design corporate listings page appearance and themes';
    actionBtn.style.display = 'none'; // No primary CTA for career config page
    document.getElementById('view-career').classList.add('active-view');
    renderCareerJobs(); // refresh the record panel on open (covers edits made on the Jobs view)
    soundEngine.playChime([329.63, 392.00, 523.25], 0.12, 0.15);

  } else if (tabId === 'data-rights') {
    breadcrumb.textContent = 'Data Rights';
    mainTitle.textContent = 'Data-Rights Requests';
    subText.textContent = 'Candidate access, correction, and deletion requests (DPDP Act 2023)';
    actionBtn.style.display = 'none';
    document.getElementById('view-data-rights').classList.add('active-view');
    renderDataRights();
  }
}

// ==========================================
// CREATE JOB + ARIA CHAT NAVIGATION
// ==========================================

function navigateToCreateJob() {
  AppState.activeTab = 'create-job';
  AppState.activeSubtab = '';

  document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
    item.classList.toggle('active', item.getAttribute('data-tab') === 'jobs');
  });
  document.querySelectorAll('.sub-nav li').forEach(li => li.classList.remove('active-sub'));
  document.querySelectorAll('.dashboard-view').forEach(v => v.classList.remove('active-view'));

  const breadcrumb = document.getElementById('breadcrumb-title');
  breadcrumb.innerHTML = `<span class="breadcrumb-link" id="bc-jobs-link-cj">Jobs</span> <span class="breadcrumb-separator">/</span> Create Job`;
  document.getElementById('bc-jobs-link-cj').addEventListener('click', () => navigateToTab('jobs'));
  document.getElementById('header-main-title').textContent = 'Create Job';
  document.getElementById('header-sub-text').textContent = 'Choose how you\'d like to create your new job posting';
  document.getElementById('header-action-btn').style.display = 'none';
  document.getElementById('view-create-job').classList.add('active-view');

  // Reset create-job state
  const filePreview = document.getElementById('dropzone-file-preview');
  const pasteArea = document.getElementById('create-jd-paste');
  const dropzone = document.getElementById('jd-dropzone');
  const fileInput = document.getElementById('jd-file-input');
  if (filePreview) { filePreview.style.display = 'none'; filePreview.innerHTML = ''; }
  if (pasteArea) { pasteArea.style.display = 'none'; pasteArea.value = ''; }
  if (dropzone) dropzone.classList.remove('has-file', 'drag-over');
  if (fileInput) fileInput.value = '';
  createJobUpload.fileName = null;
  createJobUpload.text = null;

  soundEngine.playChime([392, 523.25], 0.12, 0.1);
}

let ariaChatHistory = [];

function navigateToAriaChat() {
  AppState.activeTab = 'aria-chat';
  AppState.activeSubtab = '';

  document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
    item.classList.toggle('active', item.getAttribute('data-tab') === 'jobs');
  });
  document.querySelectorAll('.dashboard-view').forEach(v => v.classList.remove('active-view'));

  const breadcrumb = document.getElementById('breadcrumb-title');
  breadcrumb.innerHTML = `<span class="breadcrumb-link" id="bc-jobs-link-aria">Jobs</span> <span class="breadcrumb-separator">/</span> <span class="breadcrumb-link" id="bc-cj-link-aria">Create Job</span> <span class="breadcrumb-separator">/</span> Lina`;
  document.getElementById('bc-jobs-link-aria').addEventListener('click', () => navigateToTab('jobs'));
  document.getElementById('bc-cj-link-aria').addEventListener('click', navigateToCreateJob);
  document.getElementById('header-main-title').textContent = 'Lina Requisition';
  document.getElementById('header-sub-text').textContent = 'Creating a new job through AI conversation';
  document.getElementById('header-action-btn').style.display = 'none';
  document.getElementById('view-aria-chat').classList.add('active-view');

  // Reset chat
  ariaChatHistory = [];
  const messagesContainer = document.getElementById('aria-chat-messages');
  if (messagesContainer) messagesContainer.innerHTML = '';
  const chatInput = document.getElementById('aria-chat-input');
  if (chatInput) { chatInput.value = ''; chatInput.disabled = false; }
  const sendBtn = document.getElementById('btn-aria-send');
  if (sendBtn) sendBtn.disabled = false;

  // Lina opening message
  const opening = "Hi! I'm Lina, your AI recruiting assistant. Tell me about the role you're hiring for — what's the job title and what will this person be doing?";
  appendAriaMessage(opening, 'aria');
  ariaChatHistory.push({ role: 'assistant', content: opening });

  soundEngine.playChime([329.63, 392, 523.25], 0.12, 0.1);
}

function appendAriaMessage(text, sender) {
  const container = document.getElementById('aria-chat-messages');
  if (!container) return;

  const isTyping = sender === 'aria-typing';
  const row = document.createElement('div');
  row.className = `aria-msg aria-msg-from-aria${isTyping ? ' aria-msg-typing' : ''}`;

  if (sender === 'user') {
    row.className = 'aria-msg aria-msg-from-user';
    row.innerHTML = `<div class="aria-msg-bubble">${escapeHTML(text)}</div>`;
  } else {
    row.innerHTML = `
      <div class="aria-msg-avatar">A</div>
      <div class="aria-msg-bubble">${isTyping ? '<span class="dot-flash">●&nbsp;●&nbsp;●</span>' : escapeHTML(text)}</div>`;
  }

  container.appendChild(row);
  container.scrollTop = container.scrollHeight;
  return row;
}

async function sendAriaMessage(text) {
  if (!text.trim()) return;
  const input = document.getElementById('aria-chat-input');
  const sendBtn = document.getElementById('btn-aria-send');
  input.value = '';
  input.disabled = true;
  sendBtn.disabled = true;

  appendAriaMessage(text, 'user');
  ariaChatHistory.push({ role: 'user', content: text });

  const typingRow = appendAriaMessage('', 'aria-typing');

  const systemPrompt = `You are Lina, an AI recruiting assistant for IntervieHire. Help hiring managers create job postings through a brief natural conversation.

Based on the conversation so far, determine if you have enough information to create a job posting. You need:
1. Job title / role name
2. Experience level
3. A brief description of responsibilities

If you have all three, respond ONLY with this JSON (no extra text):
{"ready":true,"roleName":"...","cardName":"...","experienceBand":"one of: ${EXPERIENCE_BANDS_PROMPT}","description":"2-3 sentence professional job description"}

If you need more info, respond ONLY with this JSON (no extra text):
{"ready":false,"message":"your warm 1-2 sentence follow-up question"}`;

  try {
    const response = await callDeepSeekAPI([
      { role: 'system', content: systemPrompt },
      ...ariaChatHistory
    ], true);

    if (typingRow && typingRow.parentNode) typingRow.remove();

    const parsed = parseAIJson(response);

    if (parsed.ready) {
      const jobDraft = {
        roleName: parsed.roleName,
        cardName: parsed.cardName || parsed.roleName,
        created: new Date().toLocaleString('en-US', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }),
        status: 'draft',
        customJobId: '-',
        experienceBand: parsed.experienceBand || 'Upto 2 Years',
        createdBy: globalThis.IH_USER_NAME || 'You',
        description: parsed.description,
        questions: [],
        pipeline: { total: 0, resume: 0, screening: 0, functional: 0 },
        pipelineConfig: { resumeAnalysis: { enabled: true }, recruiterScreening: { enabled: true }, functionalInterview: { enabled: true } },
      };
      // api mode: persist to the backend first; local mode keeps a local id.
      const newJob = isApiMode() ? await apiCreateJob(jobDraft) : { ...jobDraft, id: generateJobId() } as any;
      AppState.jobs.unshift(newJob);
      saveStateToLocalStorage();
      appendAriaMessage(`Great! I've created "${parsed.roleName}". Now generating your screening criteria, interview questions, and pipeline — hang tight...`, 'aria');
      soundEngine.playChime([329.63, 392, 523.25], 0.15, 0.08);

      try {
        await enrichJobWithAI(newJob, parsed.description);
        if (newJob._backend) {
          try { await apiPatchJobParameters(newJob.id, newJob); }
          catch (e) { console.warn('Job created but blueprint sync failed:', e); }
        }
        appendAriaMessage(`Done! Your full interview pipeline is ready. Taking you there now...`, 'aria');
        soundEngine.playChime([523.25, 659.25, 783.99], 0.2, 0.08);
        setTimeout(() => openJobFlowView(newJob.id, true), 1200);
      } catch (enrichErr) {
        console.error('Enrichment failed:', enrichErr);
        appendAriaMessage(`Job created, but I couldn't generate the full pipeline. You can configure it manually.`, 'aria');
        setTimeout(() => openJobFlowView(newJob.id, true), 1200);
      }
    } else {
      appendAriaMessage(parsed.message, 'aria');
      ariaChatHistory.push({ role: 'assistant', content: parsed.message });
      input.disabled = false;
      sendBtn.disabled = false;
      input.focus();
    }
  } catch (err) {
    if (typingRow && typingRow.parentNode) typingRow.remove();
    appendAriaMessage("Sorry, I ran into a connectivity issue. Please try again.", 'aria');
    console.error("Lina chat error:", err);
    input.disabled = false;
    sendBtn.disabled = false;
  }
}

const createJobUpload = { fileName: null, text: null, file: null };

function navigateToSubtab(subtabId) {
  // Derive the parent tab from the subtab id's own prefix ('settings-general' ->
  // 'settings', 'platform-overview' -> 'platform') instead of hardcoding 'settings' —
  // this only works because every has-sub parent tab id today is a single word with
  // no internal hyphen; if that ever changes, this needs a real lookup table instead.
  const parentTab = subtabId.split('-')[0];
  AppState.activeTab = parentTab;
  AppState.activeSubtab = subtabId;

  const SUBTAB_URLS = {
    'settings-general': '/dashboard/settings/general',
    'platform-overview': '/dashboard/platform/overview',
    'platform-organisations': '/dashboard/platform/organisations',
    'platform-users': '/dashboard/platform/users',
    'platform-jobs': '/dashboard/platform/jobs',
    'platform-interviews': '/dashboard/platform/interviews',
    'platform-audit': '/dashboard/platform/audit',
  };
  const url = SUBTAB_URLS[subtabId];
  if (url) {
    pushUrl(url);
  }

  // Make sure the parent menu node is visually highlighted and open
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
    if (item.getAttribute('data-tab') === parentTab) {
      item.classList.add('active');
      item.classList.add('open');
    } else {
      item.classList.remove('active');
    }
  });

  // Make subtab item look selected
  document.querySelectorAll('.sub-nav li').forEach(li => {
    if (li.getAttribute('data-subtab') === subtabId) {
      li.classList.add('active-sub');
    } else {
      li.classList.remove('active-sub');
    }
  });

  // Show corresponding subtab view
  document.querySelectorAll('.dashboard-view').forEach(view => {
    view.classList.remove('active-view');
  });

  const breadcrumb = document.getElementById('breadcrumb-title');
  const mainTitle = document.getElementById('header-main-title');
  const subText = document.getElementById('header-sub-text');
  const actionBtn = document.getElementById('header-action-btn');

  actionBtn.style.display = 'none';

  if (subtabId === 'settings-general') {
    breadcrumb.textContent = 'Settings';
    mainTitle.textContent = 'General Settings';
    subText.textContent = 'Manage your account, notifications, and preferences';
    document.getElementById('view-settings-general').classList.add('active-view');
    syncSettingsControls();
    soundEngine.playChime([261.63, 293.66, 329.63], 0.1, 0.08);
  } else if (subtabId === 'platform-overview') {
    breadcrumb.textContent = 'Platform';
    mainTitle.textContent = 'Platform Overview';
    subText.textContent = 'Counts and recent activity across every organisation';
    document.getElementById('view-platform-overview').classList.add('active-view');
    renderPlatformOverview();
    soundEngine.playChime([261.63, 293.66, 329.63], 0.1, 0.08);
  } else if (subtabId === 'platform-organisations') {
    breadcrumb.textContent = 'Platform';
    mainTitle.textContent = 'All Organisations';
    subText.textContent = 'Every organisation on the platform';
    document.getElementById('view-platform-organisations').classList.add('active-view');
    renderPlatformOrganisations();
    soundEngine.playChime([261.63, 293.66, 329.63], 0.1, 0.08);
  } else if (subtabId === 'platform-users') {
    breadcrumb.textContent = 'Platform';
    mainTitle.textContent = 'All Users';
    subText.textContent = 'Every user across every organisation';
    document.getElementById('view-platform-users').classList.add('active-view');
    renderPlatformUsers();
    soundEngine.playChime([261.63, 293.66, 329.63], 0.1, 0.08);
  } else if (subtabId === 'platform-jobs') {
    breadcrumb.textContent = 'Platform';
    mainTitle.textContent = 'All Jobs';
    subText.textContent = 'Every job across every organisation';
    document.getElementById('view-platform-jobs').classList.add('active-view');
    renderPlatformJobs();
    soundEngine.playChime([261.63, 293.66, 329.63], 0.1, 0.08);
  } else if (subtabId === 'platform-interviews') {
    breadcrumb.textContent = 'Platform';
    mainTitle.textContent = 'All Interviews';
    subText.textContent = 'Every interview session across every organisation';
    document.getElementById('view-platform-interviews').classList.add('active-view');
    renderPlatformInterviews();
    soundEngine.playChime([261.63, 293.66, 329.63], 0.1, 0.08);
  } else if (subtabId === 'platform-audit') {
    breadcrumb.textContent = 'Platform';
    mainTitle.textContent = 'Audit Log';
    subText.textContent = 'Every action taken from this Platform tab';
    document.getElementById('view-platform-audit').classList.add('active-view');
    renderPlatformAuditLog();
    soundEngine.playChime([261.63, 293.66, 329.63], 0.1, 0.08);
  }
}

// ==========================================
// DRAWERS SHOW / HIDE CONTROL
// ==========================================
function openDrawer(drawerType, jobId = null) {
  const overlay = document.getElementById('drawer-backdrop');
  overlay.classList.add('active');

  soundEngine.playChime([392.00, 523.25], 0.12, 0.1);

  if (drawerType === 'job') {
    document.getElementById('drawer-job').classList.add('active');
  } else if (drawerType === 'member') {
    document.getElementById('drawer-member').classList.add('active');
  } else if (drawerType === 'view-jd') {
    const drawer = document.getElementById('drawer-view-jd');
    drawer.classList.add('active');
    if (jobId) {
      const job = AppState.jobs.find(j => j.id === jobId);
      if (job) {
        document.getElementById('drawer-jd-text').value = job.description || "";
        drawer.setAttribute('data-current-job-id', jobId);
      }
    }
  }
}

function closeDrawers() {
  document.getElementById('drawer-backdrop').classList.remove('active');
  document.getElementById('drawer-job').classList.remove('active');
  document.getElementById('drawer-member').classList.remove('active');
  
  const jdDrawer = document.getElementById('drawer-view-jd');
  if (jdDrawer) {
    jdDrawer.classList.remove('active');
  }
  
  const reportDrawer = document.getElementById('drawer-report');
  if (reportDrawer) {
    reportDrawer.classList.remove('active');
    reportDrawer.style.right = '-880px';
  }

  resetWaveformAudio();
  soundEngine.playClick();
}

// ==========================================
// EXPORTING SCRIPTS (MOCKED EXCEL EXPORTS)
// ==========================================
function triggerExcelExport(dataType) {
  soundEngine.playChime([523.25, 659.25, 783.99], 0.2, 0.08);
  
  let csvContent = "data:text/csv;charset=utf-8,";
  let filename = "export.csv";

  if (dataType === 'jobs') {
    csvContent += "Job ID,Role Name,Card Name,Experience Band,Created By\n";
    AppState.jobs.forEach(j => {
      csvContent += `"${j.id}","${j.roleName}","${j.cardName}","${j.experienceBand}","${j.createdBy}"\n`;
    });
    filename = "IntervieHire_jobs_export.csv";
  } else if (dataType === 'candidates') {
    csvContent += "Candidate ID,Name,Email,Job Applied,Status,Score,Registered On\n";
    AppState.candidates.forEach(c => {
      csvContent += `"${c.id}","${c.name}","${c.email}","${c.jobApplied}","${c.status}","${c.score}","${c.registeredOn}"\n`;
    });
    filename = "IntervieHire_candidates_export.csv";
  } else if (dataType === 'team') {
    csvContent += "Team Member,Email,Designation,Usertype,Registered On,Status\n";
    AppState.team.forEach(t => {
      csvContent += `"${t.name}","${t.email}","${t.designation}","${t.usertype}","${t.registeredOn}","${t.status}"\n`;
    });
    filename = "IntervieHire_team_export.csv";
  }

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}


export { appendAriaMessage, ariaChatHistory, closeDrawers, createJobUpload, navigateToAriaChat, navigateToCreateJob, navigateToSubtab, navigateToTab, openDrawer, sendAriaMessage, triggerExcelExport };
