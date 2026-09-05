import { document, window, requestAnimationFrame, setTimeout, setInterval, clearInterval } from './runtime';
import { escapeHTML } from './escape';
import { navigateToJobDetail } from './job-detail';
import { appendTerminalLog, recalculateJobPipelines, renderKanbanBoard } from './kanban-swarm';
import { navigateToTab, openDrawer } from './navigation';
import { updateAllSlidingPills } from './pills';
import { applyDateRangeGlobally, renderAnalyticsTable, renderJobCards, updateSummaryMetrics } from './render-views';
import { isGarbageText, resumeIdentityCache, resumeTextCache, runBulkResumeAnalysis } from './resume-analysis';
import { soundEngine } from './sound';
import { AppState, defaultInterviewSettings } from './state';
import { pushUrl } from './url-sync';
import { isApiMode, apiAddApplicant, apiUpdateApplicant, scheduleJobSave } from './api';
import { saveStateToLocalStorage } from './ai-api';

// ============================================================
// SOURCING VIEW CONTROLLER & MASS INTAKE LOGIC
// ============================================================

let sourcingQueue = [];
let csvParsedCandidates = [];
let uploadedFiles = [];
let currentSourcingMode = 'schedule';
let currentSourcingTab = 'csv';
// The stage the user was on when they clicked '+ Add Applicants'.
// 'resume' | 'screening' | 'functional' | null (pipeline start)
let currentTargetStage = null;

function initSourcing() {
  // Bind click on '+ Add Applicants' in the job-detail top bar.
  // Always navigate to the Sourcing view, but carry the current stage as context
  // so candidates land in the right stage (screening / functional / resume).
  const addApplicantsBtn = document.getElementById('btn-jd-add-applicants') || document.querySelector('.jd-actions .btn-jd-primary');
  if (addApplicantsBtn) {
    addApplicantsBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const activeTabEl = document.querySelector('.jd-tab.active');
      const tabId = activeTabEl ? activeTabEl.getAttribute('data-jd-tab') : null;
      // Map the job-detail tab id to a sourcing stage
      const stageMap = { resume: 'resume', screening: 'screening', functional: 'functional' };
      const stage = stageMap[tabId] || null;
      navigateToSourcing(AppState.activeJobId, stage);
    });
  }

  // Breadcrumbs navigation link back clicks
  const srcBcJobs = document.getElementById('src-bc-jobs');
  if (srcBcJobs) {
    srcBcJobs.addEventListener('click', () => {
      navigateToTab('jobs');
      pushUrl('/dashboard/jobs');
    });
  }
  
  const srcBcJobname = document.getElementById('src-bc-jobname');
  if (srcBcJobname) {
    srcBcJobname.addEventListener('click', () => {
      if (typeof window.navigateToJobStage === 'function') {
        window.navigateToJobStage(AppState.activeJobId, 'overview');
      } else {
        navigateToJobDetail(AppState.activeJobId);
      }
    });
  }

  // View Responses button click (goes back to job detail overview)
  const viewResponsesBtn = document.getElementById('btn-src-view-responses');
  if (viewResponsesBtn) {
    viewResponsesBtn.addEventListener('click', () => {
      navigateToJobDetail(AppState.activeJobId);
    });
  }

  // Add Collaborator inside sourcing and job details
  const srcCollabBtn = document.getElementById('btn-src-collaborator');
  if (srcCollabBtn) {
    srcCollabBtn.addEventListener('click', () => {
      openDrawer('member');
    });
  }
  const jdCollabBtn = document.getElementById('btn-jd-collaborator');
  if (jdCollabBtn) {
    jdCollabBtn.addEventListener('click', () => {
      openDrawer('member');
    });
  }

  const isetBtn = document.getElementById('btn-interview-settings');
  const isetOverlay = document.getElementById('interview-settings-overlay');
  const isetClose = document.getElementById('btn-close-iset');
  const isetSave = document.getElementById('btn-save-iset');
  if (isetBtn && isetOverlay) {
    // toggle key → DOM id (camelCase keys flow unchanged to backend + engine)
    const ISET_TOGGLES = {
      interviewEnabled: 'iset-toggle-status', allowMobile: 'iset-toggle-mobile',
      allowLate: 'iset-toggle-late', continueFromMiddle: 'iset-toggle-continue',
      allowReattempt: 'iset-toggle-reattempt', requireCv: 'iset-toggle-cv',
      proctoring: 'iset-toggle-proctor', conversationalInterview: 'iset-toggle-conversational',
      whiteLabel: 'iset-toggle-whitelabel',
    };
    const activeJob = () => AppState.jobs.find(j => j.id === AppState.activeJobId);
    const applySettingsToUi = (s) => {
      Object.entries(ISET_TOGGLES).forEach(([key, id]) => {
        document.getElementById(id)?.classList.toggle('active', !!s[key]);
      });
      const sel = document.getElementById('iset-access');
      if (sel) sel.value = s.accessControl || 'link';
    };
    isetBtn.addEventListener('click', () => {
      const job = activeJob();
      applySettingsToUi((job && job.interviewSettings) || defaultInterviewSettings());
      isetOverlay.classList.add('open');
      soundEngine.playClick();
    });
    isetClose?.addEventListener('click', () => {
      isetOverlay.classList.remove('open');
      soundEngine.playClick();
    });
    isetOverlay.addEventListener('click', (e) => {
      if (e.target === isetOverlay) isetOverlay.classList.remove('open');
    });
    isetSave?.addEventListener('click', () => {
      const job = activeJob();
      if (job) {
        const s: any = {};
        Object.entries(ISET_TOGGLES).forEach(([key, id]) => {
          s[key] = !!document.getElementById(id)?.classList.contains('active');
        });
        s.accessControl = document.getElementById('iset-access')?.value || 'link';
        job.interviewSettings = s;
        saveStateToLocalStorage();
        scheduleJobSave(job);
      } else {
        showPremiumToast('Open a job first to save its interview settings.', 'error');
      }
      isetOverlay.classList.remove('open');
      showPremiumToast('Interview settings saved.', 'success');
      soundEngine.playChime([523.25], 0.15);
    });
    isetOverlay.querySelectorAll('.settings-toggle').forEach(toggle => {
      toggle.addEventListener('click', () => {
        toggle.classList.toggle('active');
        soundEngine.playClick();
      });
    });
  }

  // Sourcing mode toggle buttons
  const modeButtons = document.querySelectorAll('.mode-toggle-btn');
  modeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-sourcing-mode');
      switchSourcingMode(mode);
    });
  });

  // Tab card selectors
  const tabCards = document.querySelectorAll('.sourcing-tab-card');
  tabCards.forEach(card => {
    card.addEventListener('click', () => {
      if (card.classList.contains('locked')) {
        soundEngine.playClick();
        switchSourcingTab('ats');
        return;
      }
      const tab = card.getAttribute('data-sourcing-tab');
      switchSourcingTab(tab);
    });
  });

  // === CSV Panel Event Bindings ===
  const btnDownloadCsv = document.getElementById('btn-download-csv-template');
  if (btnDownloadCsv) {
    btnDownloadCsv.addEventListener('click', (e) => {
      e.preventDefault();
      downloadCsvTemplate();
    });
  }

  const btnBrowseCsv = document.getElementById('btn-browse-csv');
  const inputFileCsv = document.getElementById('input-file-csv');
  if (btnBrowseCsv && inputFileCsv) {
    btnBrowseCsv.addEventListener('click', (e) => {
      e.stopPropagation();
      inputFileCsv.click();
    });
    inputFileCsv.addEventListener('change', handleCsvFileSelect);
  }

  // Drag & drop for CSV
  const dropzoneCsv = document.getElementById('dropzone-csv');
  if (dropzoneCsv) {
    dropzoneCsv.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzoneCsv.classList.add('dragover');
    });
    dropzoneCsv.addEventListener('dragleave', () => {
      dropzoneCsv.classList.remove('dragover');
    });
    dropzoneCsv.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzoneCsv.classList.remove('dragover');
      const files = e.dataTransfer.files;
      if (files.length > 0 && files[0].name.endsWith('.csv')) {
        parseCsvFile(files[0]);
      } else {
        showPremiumToast("Please drop a valid .csv file.", "error");
      }
    });
    dropzoneCsv.addEventListener('click', (e) => {
      if (e.target !== btnBrowseCsv) {
        inputFileCsv.click();
      }
    });
  }

  const btnCsvCancel = document.getElementById('btn-csv-cancel');
  if (btnCsvCancel) {
    btnCsvCancel.addEventListener('click', () => {
      csvParsedCandidates = [];
      document.getElementById('csv-preview-box').style.display = 'none';
      if (inputFileCsv) inputFileCsv.value = '';
      soundEngine.playClick();
      const dropzone = document.getElementById('dropzone-csv');
      if (dropzone) dropzone.style.display = '';
      const footer = dropzone ? dropzone.parentElement.querySelector('.sourcing-panel-footer') : null;
      if (footer) footer.style.display = '';
    });
  }

  const btnCsvImport = document.getElementById('btn-csv-import');
  if (btnCsvImport) {
    btnCsvImport.addEventListener('click', () => {
      importCsvCandidates();
    });
  }

  // === Resumes Panel Event Bindings ===
  const btnBrowseResumes = document.getElementById('btn-browse-resumes');
  const inputFileResumes = document.getElementById('input-file-resumes');
  if (btnBrowseResumes && inputFileResumes) {
    btnBrowseResumes.addEventListener('click', (e) => {
      e.stopPropagation();
      inputFileResumes.click();
    });
    inputFileResumes.addEventListener('change', handleResumesFileSelect);
  }

  // Drag & drop for Resumes
  const dropzoneResumes = document.getElementById('dropzone-resumes');
  if (dropzoneResumes) {
    dropzoneResumes.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzoneResumes.classList.add('dragover');
    });
    dropzoneResumes.addEventListener('dragleave', () => {
      dropzoneResumes.classList.remove('dragover');
    });
    dropzoneResumes.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzoneResumes.classList.remove('dragover');
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        simulateResumesParsing(files);
      }
    });
    dropzoneResumes.addEventListener('click', (e) => {
      if (e.target !== btnBrowseResumes) {
        inputFileResumes.click();
      }
    });
  }

  const btnResumesCancel = document.getElementById('btn-resumes-cancel');
  if (btnResumesCancel) {
    btnResumesCancel.addEventListener('click', () => {
      uploadedFiles = [];
      document.getElementById('resumes-preview-box').style.display = 'none';
      if (inputFileResumes) inputFileResumes.value = '';
      soundEngine.playClick();
      const dropzone = document.getElementById('dropzone-resumes');
      if (dropzone) dropzone.style.display = '';
      const footer = dropzone ? dropzone.parentElement.querySelector('.sourcing-panel-footer') : null;
      if (footer) footer.style.display = '';
    });
  }

  const btnResumesImport = document.getElementById('btn-resumes-import');
  if (btnResumesImport) {
    btnResumesImport.addEventListener('click', () => {
      importResumesCandidates();
    });
  }

  // === Manual Entry Event Bindings ===
  const formManual = document.getElementById('form-manual-candidate');
  if (formManual) {
    formManual.addEventListener('submit', (e) => {
      e.preventDefault();
      addCandidateToManualQueue();
    });
  }

  const btnClearManual = document.getElementById('btn-clear-manual');
  if (btnClearManual) {
    btnClearManual.addEventListener('click', () => {
      sourcingQueue = [];
      renderManualQueue();
      soundEngine.playClick();
    });
  }

  const btnManualImport = document.getElementById('btn-manual-import');
  if (btnManualImport) {
    btnManualImport.addEventListener('click', () => {
      importManualQueue();
    });
  }

  // === Locked ATS features event ===
  const btnUpgradeSourcing = document.querySelector('.btn-upgrade-sourcing');
  if (btnUpgradeSourcing) {
    btnUpgradeSourcing.addEventListener('click', () => {
      soundEngine.playClick();
      showPremiumToast("ATS Integration is an Enterprise level feature. Please upgrade your plan.", "error");
    });
  }

  const dateRangeSelect = document.getElementById('date-range-select');

  const analyticsDrBtn = document.getElementById('btn-analytics-daterange');
  const analyticsDrDrop = document.getElementById('analytics-daterange-dropdown');
  if (analyticsDrBtn && analyticsDrDrop) {
    analyticsDrBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      analyticsDrDrop.classList.toggle('open');
      soundEngine.playClick();
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#analytics-date-range-wrap')) analyticsDrDrop.classList.remove('open');
    });
    analyticsDrDrop.querySelectorAll('.dr-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        analyticsDrDrop.querySelectorAll('.dr-preset').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        AppState.dateRange = btn.getAttribute('data-range');
        document.getElementById('analytics-daterange-label').textContent = btn.textContent;
        if (dateRangeSelect) dateRangeSelect.value = AppState.dateRange;
        const jdLabel = document.getElementById('jd-daterange-label');
        if (jdLabel) jdLabel.textContent = btn.textContent;
        const jdDrop = document.getElementById('jd-daterange-dropdown');
        if (jdDrop) jdDrop.querySelectorAll('.jd-dr-preset').forEach(b => {
          b.classList.toggle('active', b.getAttribute('data-range') === AppState.dateRange);
        });
        soundEngine.playClick();
        applyDateRangeGlobally();
        analyticsDrDrop.classList.remove('open');
      });
    });
  }

  const dateFrom = document.getElementById('date-from');
  const dateTo = document.getElementById('date-to');
  const drApply = document.getElementById('dr-apply-custom');
  if (dateFrom && dateTo && drApply) {
    drApply.addEventListener('click', () => {
      AppState.dateRange = 'custom';
      AppState.customDateFrom = dateFrom.value;
      AppState.customDateTo = dateTo.value;
      if (dateRangeSelect) dateRangeSelect.value = 'custom';
      document.getElementById('analytics-daterange-label').textContent = 'Custom Range';
      if (analyticsDrDrop) {
        analyticsDrDrop.querySelectorAll('.dr-preset').forEach(b => b.classList.remove('active'));
        analyticsDrDrop.classList.remove('open');
      }
      soundEngine.playClick();
      applyDateRangeGlobally();
    });
  }

  // Job Detail Date Range dropdown
  const jdDrBtn = document.getElementById('btn-jd-daterange');
  const jdDrDrop = document.getElementById('jd-daterange-dropdown');
  if (jdDrBtn && jdDrDrop) {
    jdDrBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      jdDrDrop.classList.toggle('open');
      soundEngine.playClick();
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#jd-date-range-wrap')) jdDrDrop.classList.remove('open');
    });
    jdDrDrop.querySelectorAll('.jd-dr-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        jdDrDrop.querySelectorAll('.jd-dr-preset').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        AppState.dateRange = btn.getAttribute('data-range');
        document.getElementById('jd-daterange-label').textContent = btn.textContent;
        // sync analytics bar dropdown
        const sel = document.getElementById('date-range-select');
        if (sel) sel.value = AppState.dateRange;
        soundEngine.playClick();
        applyDateRangeGlobally();
        jdDrDrop.classList.remove('open');
      });
    });
    const jdDateFrom = document.getElementById('jd-date-from');
    const jdDateTo = document.getElementById('jd-date-to');
    if (jdDateFrom && jdDateTo) {
      [jdDateFrom, jdDateTo].forEach(inp => {
        inp.addEventListener('change', () => {
          jdDrDrop.querySelectorAll('.jd-dr-preset').forEach(b => b.classList.remove('active'));
          AppState.dateRange = 'custom';
          AppState.customDateFrom = jdDateFrom.value;
          AppState.customDateTo = jdDateTo.value;
          document.getElementById('jd-daterange-label').textContent = 'Custom';
          // sync analytics bar dropdown
          const sel2 = document.getElementById('date-range-select');
          if (sel2) sel2.value = 'custom';
          const drc = document.getElementById('date-range-custom');
          if (drc) drc.style.display = 'flex';
          if (document.getElementById('date-from')) document.getElementById('date-from').value = jdDateFrom.value;
          if (document.getElementById('date-to')) document.getElementById('date-to').value = jdDateTo.value;
          soundEngine.playClick();
          applyDateRangeGlobally();
        });
      });
    }
  }

  const btnLogout = document.querySelector('.btn-logout');
  if (btnLogout) {
    btnLogout.addEventListener('click', () => {
      soundEngine.playClick();
      showPremiumToast("You have been logged out.", "success");
      setTimeout(() => { window.location.reload(); }, 1200);
    });
  }

  const btnUpgrade = document.querySelector('.btn-upgrade');
  if (btnUpgrade) {
    btnUpgrade.addEventListener('click', () => {
      soundEngine.playClick();
      showPremiumToast("Plan upgrade flow coming soon. Contact sales for Enterprise access.", "info");
    });
  }
}

function navigateToSourcing(jobId, targetStage = null) {
  const job = AppState.jobs.find(j => j.id === jobId);
  if (!job) return;

  AppState.activeJobId = jobId;
  AppState.activeTab = 'sourcing';
  // Store the target stage so all import functions know where candidates land.
  currentTargetStage = targetStage;
  pushUrl(`/dashboard/sourcing/${jobId}`);

  // Highlight Jobs sidebar
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
    item.classList.toggle('active', item.getAttribute('data-tab') === 'jobs');
  });

  // Breadcrumbs text config
  const shortName = job.cardName.length > 24 ? job.cardName.slice(0, 24) + '…' : job.cardName;
  const srcBcJobname = document.getElementById('src-bc-jobname');
  if (srcBcJobname) {
    srcBcJobname.textContent = shortName;
  }

  // Stage context banner
  const stageCtx = document.getElementById('sourcing-stage-context');
  const stageLabel = document.getElementById('sourcing-stage-label');
  if (stageCtx && stageLabel) {
    if (targetStage) {
      const stageNames = { resume: 'Resume Analysis', screening: 'Recruiter Screening', functional: 'Functional Interview' };
      stageLabel.textContent = stageNames[targetStage] || targetStage;
      stageCtx.style.display = 'flex';
    } else {
      stageCtx.style.display = 'none';
    }
  }

  // Switch view section visibility
  document.querySelectorAll('.dashboard-view').forEach(v => v.classList.remove('active-view'));
  document.getElementById('view-sourcing').classList.add('active-view');

  // Hide the global page header action button
  const actionBtn = document.getElementById('header-action-btn');
  if (actionBtn) actionBtn.style.display = 'none';

  // Reset inputs & states
  sourcingQueue = [];
  csvParsedCandidates = [];
  uploadedFiles = [];
  renderManualQueue();
  document.getElementById('csv-preview-box').style.display = 'none';
  document.getElementById('resumes-preview-box').style.display = 'none';
  
  const formManual = document.getElementById('form-manual-candidate');
  if (formManual) formManual.reset();

  const fileCsv = document.getElementById('input-file-csv');
  if (fileCsv) fileCsv.value = '';
  const fileRes = document.getElementById('input-file-resumes');
  if (fileRes) fileRes.value = '';

  // Default mode & tab
  switchSourcingMode('schedule');

  setTimeout(updateAllSlidingPills, 50);
  soundEngine.playChime([329.63, 392.00, 523.25], 0.15, 0.08);
}

function switchSourcingMode(mode) {
  currentSourcingMode = mode;

  // Toggle active class on pills
  const modeButtons = document.querySelectorAll('.mode-toggle-btn');
  modeButtons.forEach(btn => {
    const btnMode = btn.getAttribute('data-sourcing-mode');
    btn.classList.toggle('active', btnMode === mode);
  });

  // Show/Hide Grid cards based on active mode
  const csvCard = document.getElementById('card-src-csv');
  const manualCard = document.getElementById('card-src-manual');

  if (mode === 'analyse') {
    if (csvCard) csvCard.style.display = 'none';
    if (manualCard) manualCard.style.display = 'none';
    
    // Default to Resumes tab for Analyse mode
    if (currentSourcingTab !== 'resumes' && currentSourcingTab !== 'ats') {
      currentSourcingTab = 'resumes';
    }
  } else {
    if (csvCard) csvCard.style.display = 'flex';
    if (manualCard) manualCard.style.display = 'flex';
  }

  // Refresh active tab views
  switchSourcingTab(currentSourcingTab);
  setTimeout(updateAllSlidingPills, 50);
  soundEngine.playClick();
}

function switchSourcingTab(tab) {
  currentSourcingTab = tab;

  // Toggle card active states
  const tabCards = document.querySelectorAll('.sourcing-tab-card');
  tabCards.forEach(card => {
    const cardTab = card.getAttribute('data-sourcing-tab');
    card.classList.toggle('active', cardTab === tab);
  });

  // Toggle active workspace panel visibility
  const panels = document.querySelectorAll('.sourcing-panel');
  panels.forEach(panel => {
    const panelId = panel.id;
    const isActive = panelId === `panel-src-${tab}`;
    panel.classList.toggle('active', isActive);
    panel.style.display = isActive ? 'block' : 'none';
  });

  setTimeout(updateAllSlidingPills, 50);
  soundEngine.playClick();
}

// === CSV Intake Logic ===
function downloadCsvTemplate() {
  const csvContent = "Name,Email,Phone\nJohn Doe,john.doe@example.com,+15550192834\nJane Smith,jane.smith@example.com,\nAditya Rana,aditya@IntervieHire.com,+919988776655";
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", "IntervieHire_candidates_template.csv");
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  soundEngine.playClick();
}

function handleCsvFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;
  parseCsvFile(file);
}

function parseCsvFile(file) {
  const reader = new FileReader();
  reader.onload = function(e) {
    const text = e.target.result;
    processCsvText(text);
  };
  reader.readAsText(file);
}

function processCsvText(text) {
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) return;

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  const nameIndex = headers.indexOf('name');
  const emailIndex = headers.indexOf('email');
  const phoneIndex = headers.indexOf('phone');

  if (nameIndex === -1 || emailIndex === -1) {
    showPremiumToast("Invalid CSV. Header row must contain Name and Email.", "error");
    return;
  }

  csvParsedCandidates = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = line.split(',').map(c => c.trim());
    if (cols.length <= Math.max(nameIndex, emailIndex)) continue;

    const name = cols[nameIndex];
    const email = cols[emailIndex];
    const phone = phoneIndex !== -1 ? (cols[phoneIndex] || '') : '';

    if (name && email) {
      csvParsedCandidates.push({ name, email, phone });
    }
  }

  if (csvParsedCandidates.length === 0) {
    showPremiumToast("No valid candidates found in CSV.", "error");
    return;
  }

  renderCsvPreview();
}

function renderCsvPreview() {
  const box = document.getElementById('csv-preview-box');
  const countSpan = document.getElementById('csv-parsed-count');
  const tbody = document.getElementById('csv-preview-rows');

  if (!box || !countSpan || !tbody) return;

  countSpan.textContent = csvParsedCandidates.length;
  tbody.innerHTML = csvParsedCandidates.map(cand => `
    <tr>
      <td><strong>${escapeHTML(cand.name)}</strong></td>
      <td>${escapeHTML(cand.email)}</td>
      <td>${cand.phone ? escapeHTML(cand.phone) : '-'}</td>
      <td><span class="upload-file-status-badge done">Ready to Sync</span></td>
    </tr>
  `).join('');

  box.style.display = 'block';
  const dropzone = document.getElementById('dropzone-csv');
  if (dropzone) dropzone.style.display = 'none';
  const footer = dropzone ? dropzone.parentElement.querySelector('.sourcing-panel-footer') : null;
  if (footer) footer.style.display = 'none';
  soundEngine.playChime([392.00, 523.25], 0.15, 0.08);
}

async function importCsvCandidates() {
  if (csvParsedCandidates.length === 0) return;

  const activeJob = AppState.jobs.find(j => j.id === AppState.activeJobId);
  if (!activeJob) return;

  // Determine the ApplicantSource to send to backend based on which stage triggered sourcing.
  // 'screening' stage → source='scheduled' (screening_status=pending on backend)
  // 'functional' stage → source='functional' (functional_status=pending on backend)
  // null / 'resume' → source='bulk_upload' (resume analysis stage)
  const sourceMap = { screening: 'scheduled', functional: 'functional', resume: 'bulk_upload' };
  const apiSource = sourceMap[currentTargetStage] || 'bulk_upload';

  const localIds = [];
  csvParsedCandidates.forEach(cand => {
    const candId = addCandidateToAppState(cand.name, cand.email, cand.phone, activeJob, null, currentTargetStage);
    if (candId) localIds.push(candId);
  });


  // Persist to backend if in API mode
  import('./api.js').then(({ isApiMode, apiAddApplicantsBulk }) => {
    if (isApiMode() && activeJob._backend) {
      const payload = csvParsedCandidates.map(cand => ({
        name: cand.name,
        email: cand.email,
        phone: cand.phone || null,
        source: apiSource,
      }));
      apiAddApplicantsBulk(activeJob.id, payload).catch(err => {
        console.warn('CSV bulk add to backend failed:', err);
      });
    }
  }).catch(() => {});

  soundEngine.playChime([392.00, 523.25, 659.25], 0.2, 0.08);
  const stageLabel = currentTargetStage ? { screening: 'Recruiter Screening', functional: 'Functional Interview', resume: 'Resume Analysis' }[currentTargetStage] : activeJob.roleName;
  showPremiumToast(`Successfully imported ${csvParsedCandidates.length} candidate(s) into "${escapeHTML(stageLabel || activeJob.roleName)}".`, 'success');

  // Reset
  csvParsedCandidates = [];
  document.getElementById('csv-preview-box').style.display = 'none';
  const fileCsv = document.getElementById('input-file-csv');
  if (fileCsv) fileCsv.value = '';
  const dropzone = document.getElementById('dropzone-csv');
  if (dropzone) dropzone.style.display = '';
  const footer = dropzone ? dropzone.parentElement.querySelector('.sourcing-panel-footer') : null;
  if (footer) footer.style.display = '';

  // Synchronize and navigate back
  recalculateJobPipelines();
  updateSummaryMetrics();
  renderAnalyticsTable();
  
  if (document.getElementById('jobs-board-container') && document.getElementById('jobs-board-container').style.display !== 'none') {
    renderKanbanBoard();
  } else {
    renderJobCards();
  }

  // Persist to the backend BEFORE navigating — the job-detail hydrate then fetches
  // and shows them, so no manual refresh is needed (api mode).
  await persistImportedCandidates(localIds, activeJob);
  navigateToJobDetail(AppState.activeJobId);
}

// === Resumes Intake Logic ===
function handleResumesFileSelect(event) {
  const files = event.target.files;
  if (files.length === 0) return;
  simulateResumesParsing(files);
}

function simulateResumesParsing(files) {
  const box = document.getElementById('resumes-preview-box');
  const filesList = document.getElementById('resumes-files-list');
  const countSpan = document.getElementById('resumes-upload-count');
  const importBtn = document.getElementById('btn-resumes-import');

  if (!box || !filesList || !countSpan || !importBtn) return;

  box.style.display = 'block';
  const dropzone = document.getElementById('dropzone-resumes');
  if (dropzone) dropzone.style.display = 'none';
  const footer = dropzone ? dropzone.parentElement.querySelector('.sourcing-panel-footer') : null;
  if (footer) footer.style.display = 'none';
  countSpan.textContent = files.length;
  importBtn.disabled = true;

  uploadedFiles = [];
  filesList.innerHTML = '';

  appendTerminalLog(`<code>[${new Date().toLocaleTimeString()}] Aria:</code> Dropped ${files.length} candidate file(s). Initiating bulk text extraction...`);

  Array.from(files).forEach((file: any, idx) => {
    const item = {
      name: file.name,
      size: (file.size / 1024).toFixed(1) + ' KB',
      progress: 0,
      status: 'parsing',
      textContent: null,
      identity: null
    };
    uploadedFiles.push(item);

    const fileRow = document.createElement('div');
    fileRow.className = 'upload-file-item';
    fileRow.id = `file-item-${idx}`;
    fileRow.innerHTML = `
      <div class="upload-file-icon">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
      </div>
      <div class="upload-file-info">
        <span class="upload-file-name">${item.name}</span>
        <div class="upload-file-size">${item.size}</div>
      </div>
      <div class="upload-file-progress-wrap">
        <div class="upload-file-progress-bar">
          <div class="upload-file-progress-inner" id="progress-inner-${idx}"></div>
        </div>
      </div>
      <span class="upload-file-status-badge parsing" id="status-badge-${idx}">Analyzing...</span>
    `;
    filesList.appendChild(fileRow);

    let currentProgress = 0;
    const interval = setInterval(() => {
      currentProgress = Math.min(92, currentProgress + Math.floor(Math.random() * 14 + 8));
      const progressInner = document.getElementById(`progress-inner-${idx}`);
      if (progressInner) {
        progressInner.style.setProperty('--progress', currentProgress / 100);
      }
    }, 150 + Math.random() * 150);

    extractTextFromResumeFile(file)
      .then(text => {
        const fallbackName = extractCandidateNameFromFilename(file.name);
        if (text && !isGarbageText(text)) {
          item.textContent = text;
          item.identity = extractResumeIdentity(text, fallbackName, file.name);
        } else {
          item.identity = extractResumeIdentity('', fallbackName, file.name);
        }
      })
      .catch(() => {
        item.identity = extractResumeIdentity('', extractCandidateNameFromFilename(file.name), file.name);
      })
      .finally(() => {
        clearInterval(interval);
        currentProgress = 100;

        const progressInner = document.getElementById(`progress-inner-${idx}`);
        if (progressInner) {
          progressInner.style.setProperty('--progress', 1);
        }

        const badge = document.getElementById(`status-badge-${idx}`);
        if (badge) {
          badge.textContent = item.textContent ? 'Extracted' : 'Name only';
          badge.className = 'upload-file-status-badge done';
        }

        const nameEl = fileRow.querySelector('.upload-file-name');
        if (nameEl && item.identity?.name) {
          nameEl.textContent = item.identity.name;
          nameEl.title = file.name;
        }

        appendTerminalLog(`<code>[${new Date().toLocaleTimeString()}] Aria:</code> ${item.textContent ? 'Extracted text and identity' : 'Used filename fallback'} for <strong>${file.name}</strong>${item.identity?.name ? ` as <strong>${item.identity.name}</strong>` : ''}.`);

        item.status = 'done';
        checkAllResumesDone();
      });
  });
}

function checkAllResumesDone() {
  const allDone = uploadedFiles.every(f => f.status === 'done');
  if (allDone) {
    const importBtn = document.getElementById('btn-resumes-import');
    if (importBtn) importBtn.disabled = false;
    soundEngine.playChime([523.25, 659.25], 0.12, 0.08);
  }
}

async function extractTextFromResumeFile(file) {
  const isTxt = /\.(txt|text)$/i.test(file.name);
  const isPdfOrDocx = /\.(pdf|docx?)$/i.test(file.name);

  if (isTxt) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result || '');
      reader.onerror = reject;
      reader.readAsText(file);
    });
  }

  if (isPdfOrDocx) {
    const fd = new FormData();
    fd.append('file', file);
    const resp = await fetch('/api/parse-file', { method: 'POST', body: fd });
    if (!resp.ok) throw new Error('Parse failed');
    const data = await resp.json();
    return data.text || '';
  }

  return '';
}

async function importResumesCandidates() {
  if (uploadedFiles.length === 0) return;

  const activeJob = AppState.jobs.find(j => j.id === AppState.activeJobId);
  if (!activeJob) return;

  const importedCandIds = [];
  uploadedFiles.forEach(file => {
    const fallbackName = extractCandidateNameFromFilename(file.name);
    const identity = file.identity || extractResumeIdentity(file.textContent, fallbackName, file.name);
    const name = identity.name || fallbackName;
    const email = identity.email || createPlaceholderEmail(name);
    const phone = identity.phone || '';
    const candId = addCandidateToAppState(name, email, phone, activeJob, file.textContent, currentTargetStage);
    importedCandIds.push(candId);
  });

  const localIds = [...importedCandIds];

  soundEngine.playChime([392.00, 523.25, 659.25], 0.2, 0.08);
  showPremiumToast(`Imported ${uploadedFiles.length} candidate(s) — running AI analysis...`, 'success');

  uploadedFiles = [];
  document.getElementById('resumes-preview-box').style.display = 'none';
  const fileRes = document.getElementById('input-file-resumes');
  if (fileRes) fileRes.value = '';
  const dropzone = document.getElementById('dropzone-resumes');
  if (dropzone) dropzone.style.display = '';
  const footer = dropzone ? dropzone.parentElement.querySelector('.sourcing-panel-footer') : null;
  if (footer) footer.style.display = '';

  recalculateJobPipelines();
  updateSummaryMetrics();
  renderAnalyticsTable();

  if (document.getElementById('jobs-board-container') && document.getElementById('jobs-board-container').style.display !== 'none') {
    renderKanbanBoard();
  } else {
    renderJobCards();
  }

  // Persist first so the candidates survive the hydrate (no manual refresh), then
  // analyse against their real backend ids (the resume caches were re-keyed).
  const backendIds = await persistImportedCandidates(importedCandIds, activeJob);
  navigateToJobDetail(AppState.activeJobId);

  if (currentSourcingMode === 'analyse' && !currentTargetStage) {
    setTimeout(() => {
      runBulkResumeAnalysis(backendIds, activeJob);
    }, 600);
  }
}

function extractCandidateNameFromFilename(filename) {
  let name = filename.replace(/\.[^/.]+$/, "");
  name = name.replace(/[_\-.]/g, " ");
  name = name.replace(/\b(resume|cv|hiring|job|developer|executive|profile|senior|junior|doc|pdf|en)\b/gi, "");
  name = name.trim().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  if (!name) name = "Candidate " + Math.floor(Math.random() * 1000);
  return name;
}

function extractResumeIdentity(text = '', fallbackName = '', filename = '') {
  const cleanText = normalizeResumeText(text);
  const email = extractResumeEmail(cleanText);
  const phone = extractResumePhone(cleanText);
  const linkedin = extractResumeLinkedIn(cleanText);
  const explicitName = extractExplicitResumeName(cleanText);
  const headerName = explicitName || extractHeaderResumeName(cleanText);
  const emailName = email ? nameFromEmail(email) : '';
  const filenameName = fallbackName || (filename ? extractCandidateNameFromFilename(filename) : '');
  const name = normalizeCandidateName(headerName || emailName || filenameName);

  return {
    name,
    email,
    phone,
    linkedin,
    source: headerName ? 'resume' : emailName ? 'email' : filename ? 'filename' : 'provided'
  };
}

function normalizeResumeText(text = '') {
  return String(text)
    .replace(/\u0000/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\r\n?/g, '\n')
    .trim();
}

function extractResumeEmail(text) {
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : '';
}

function extractResumePhone(text) {
  const candidates = text.match(/(?:\+?\d[\d\s().-]{7,}\d)/g) || [];
  for (const candidate of candidates) {
    const digits = candidate.replace(/\D/g, '');
    if (digits.length >= 10 && digits.length <= 15) {
      return candidate.replace(/\s+/g, ' ').trim();
    }
  }
  return '';
}

function extractResumeLinkedIn(text) {
  const match = text.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[^\s)]+/i);
  return match ? match[0].replace(/[.,;]+$/, '') : '';
}

function extractExplicitResumeName(text) {
  const patterns = [
    /(?:^|\n)\s*(?:name|full name|candidate name)\s*[:-]\s*([A-Za-z][A-Za-z.' -]{2,80})/i,
    /(?:^|\n)\s*(?:candidate)\s*[:-]\s*([A-Za-z][A-Za-z.' -]{2,80})/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const candidate = cleanNameLine(match[1]);
      if (isLikelyPersonName(candidate)) return candidate;
    }
  }
  return '';
}

function extractHeaderResumeName(text) {
  const lines = text.split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, 30);

  for (const line of lines) {
    const parts = line.split(/\s+[|]\s+|\s+-\s+|\s+--\s+/);
    for (const part of parts.slice(0, 2)) {
      const candidate = cleanNameLine(part);
      if (isLikelyPersonName(candidate)) return candidate;
    }
  }
  return '';
}

function cleanNameLine(line = '') {
  return line
    .replace(/^[^A-Za-z]+|[^A-Za-z.' -]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCandidateName(name = '') {
  const cleaned = cleanNameLine(name);
  if (!cleaned) return '';
  return cleaned.split(/\s+/).map(part => {
    if (/^[A-Z]{2,}$/.test(part)) {
      return part.charAt(0) + part.slice(1).toLowerCase();
    }
    return part.charAt(0).toUpperCase() + part.slice(1);
  }).join(' ');
}

function isLikelyPersonName(name = '') {
  const cleaned = cleanNameLine(name);
  if (!cleaned || cleaned.length < 4 || cleaned.length > 60) return false;
  if (/[0-9@:/\\]/.test(cleaned)) return false;

  const lower = cleaned.toLowerCase();
  const blocked = [
    'resume', 'curriculum vitae', 'cv', 'profile', 'summary', 'objective',
    'education', 'experience', 'employment', 'skills', 'projects', 'certifications',
    'contact', 'email', 'phone', 'mobile', 'address', 'linkedin', 'github',
    'developer', 'engineer', 'manager', 'executive', 'consultant', 'analyst',
    'full stack', 'frontend', 'backend', 'software', 'tender', 'proposal'
  ];
  if (blocked.some(word => lower === word || lower.includes(`${word} `) || lower.includes(` ${word}`))) return false;

  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 5) return false;
  return words.every(word => /^[A-Za-z][A-Za-z.'-]{1,}$/.test(word));
}

function nameFromEmail(email) {
  const local = email.split('@')[0] || '';
  const parts = local
    .replace(/[0-9]+/g, ' ')
    .split(/[._+-]+/)
    .map(part => part.trim())
    .filter(part => part.length > 1 && !['info', 'contact', 'mail', 'hello', 'admin', 'resume', 'cv'].includes(part.toLowerCase()));
  if (parts.length < 2) return '';
  return normalizeCandidateName(parts.slice(0, 3).join(' '));
}

function createPlaceholderEmail(name) {
  const slug = normalizeCandidateName(name)
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .trim()
    .replace(/\s+/g, '.');
  return `${slug || 'candidate'}@resume.local`;
}

// === Manual Queue Intake Logic ===
function addCandidateToManualQueue() {
  const nameInput = document.getElementById('manual-name');
  const emailInput = document.getElementById('manual-email');
  const phoneInput = document.getElementById('manual-phone');

  if (!nameInput || !emailInput) return;

  const name = nameInput.value.trim();
  const email = emailInput.value.trim();
  const phone = phoneInput ? phoneInput.value.trim() : '';

  if (!name || !email) return;

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    showPremiumToast("Please enter a valid email address.", "error");
    return;
  }

  sourcingQueue.push({ name, email, phone });
  renderManualQueue();

  // Reset inputs
  nameInput.value = '';
  emailInput.value = '';
  if (phoneInput) phoneInput.value = '';

  soundEngine.playClick();
}

function removeCandidateFromQueue(index) {
  sourcingQueue.splice(index, 1);
  renderManualQueue();
  soundEngine.playClick();
}

function renderManualQueue() {
  const container = document.getElementById('manual-queue-list');
  const countSpan = document.getElementById('manual-queue-count');
  const clearBtn = document.getElementById('btn-clear-manual');
  const importBtn = document.getElementById('btn-manual-import');
  const emptyState = document.getElementById('manual-queue-empty');

  if (!container || !countSpan || !clearBtn || !importBtn || !emptyState) return;

  countSpan.textContent = sourcingQueue.length;

  if (sourcingQueue.length === 0) {
    emptyState.style.display = 'flex';
    container.innerHTML = '';
    clearBtn.style.display = 'none';
    importBtn.disabled = true;
    return;
  }

  emptyState.style.display = 'none';
  clearBtn.style.display = 'block';
  importBtn.disabled = false;

  container.innerHTML = sourcingQueue.map((cand, idx) => `
    <li class="queue-item">
      <div class="queue-item-details">
        <span class="queue-item-name">${escapeHTML(cand.name)}</span>
        <span class="queue-item-email">${escapeHTML(cand.email)} ${cand.phone ? ' · ' + escapeHTML(cand.phone) : ''}</span>
      </div>
      <button class="btn-remove-queue" onclick="removeCandidateFromQueue(${idx})" title="Remove">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    </li>
  `).join('');
}

async function importManualQueue() {
  if (sourcingQueue.length === 0) return;

  const activeJob = AppState.jobs.find(j => j.id === AppState.activeJobId);
  if (!activeJob) return;

  // Determine ApplicantSource for backend based on targetStage
  const sourceMap = { screening: 'scheduled', functional: 'functional', resume: 'bulk_upload' };
  const apiSource = sourceMap[currentTargetStage] || 'bulk_upload';

  const localIds = [];
  sourcingQueue.forEach(cand => {
    const candId = addCandidateToAppState(cand.name, cand.email, cand.phone, activeJob, null, currentTargetStage);
    if (candId) localIds.push(candId);
  });


  // Persist each candidate to backend if in API mode
  import('./api.js').then(({ isApiMode, apiAddApplicantsBulk }) => {
    if (isApiMode() && activeJob._backend) {
      const payload = sourcingQueue.map(cand => ({
        name: cand.name,
        email: cand.email,
        phone: cand.phone || null,
        source: apiSource,
      }));
      apiAddApplicantsBulk(activeJob.id, payload).catch(err => {
        console.warn('Manual bulk add to backend failed:', err);
      });
    }
  }).catch(() => {});

  soundEngine.playChime([392.00, 523.25, 659.25], 0.2, 0.08);
  const stageLabel = currentTargetStage ? { screening: 'Recruiter Screening', functional: 'Functional Interview', resume: 'Resume Analysis' }[currentTargetStage] : activeJob.roleName;
  showPremiumToast(`Successfully imported ${sourcingQueue.length} candidate(s) into "${escapeHTML(stageLabel || activeJob.roleName)}".`, 'success');

  sourcingQueue = [];
  renderManualQueue();

  // Synchronize and navigate back
  recalculateJobPipelines();
  updateSummaryMetrics();
  renderAnalyticsTable();

  if (document.getElementById('jobs-board-container') && document.getElementById('jobs-board-container').style.display !== 'none') {
    renderKanbanBoard();
  } else {
    renderJobCards();
  }

  // Persist before navigating so the hydrate shows them without a manual refresh.
  await persistImportedCandidates(localIds, activeJob);
  navigateToJobDetail(AppState.activeJobId);
}

// === Shared Candidate Insertion helper ===
function addCandidateToAppState(name, email, phone, job, resumeText?, targetStage?) {
  const identity = extractResumeIdentity(resumeText, name);
  const candidateName = identity.name || normalizeCandidateName(name) || name;
  const candidateEmail = identity.email || email || createPlaceholderEmail(candidateName);
  const candidatePhone = identity.phone || phone || '';

  const idChars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let candId = 'CAN-';
  for (let i = 0; i < 4; i++) {
    candId += idChars[Math.floor(Math.random() * 10)];
  }
  candId += '-' + idChars[Math.floor(Math.random() * idChars.length)] + idChars[Math.floor(Math.random() * idChars.length)] + Math.floor(Math.random() * 9);

  const now = new Date();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const hours = now.getHours();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const formatHour = hours % 12 || 12;
  const dateStr = `${now.getDate().toString().padStart(2, '0')} ${months[now.getMonth()]} ${now.getFullYear()}, ${formatHour.toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')} ${ampm}`;

  // Determine which pipeline stage this candidate enters.
  // targetStage takes priority; falls back to currentSourcingMode for backwards-compat.
  let status;
  if (targetStage === 'screening') {
    status = 'Screening';
  } else if (targetStage === 'functional') {
    status = 'Functional';
  } else if (targetStage === 'resume' || !targetStage) {
    status = currentSourcingMode === 'analyse' ? 'Resume' : 'Screening';
  } else {
    status = 'Screening';
  }
  const score = '—';

  AppState.candidates.push({
    id: candId,
    name: candidateName,
    email: candidateEmail,
    phone: candidatePhone,
    linkedin: identity.linkedin || '',
    resumeIdentitySource: identity.source,
    jobApplied: job.roleName,
    status: status,
    score: score,
    registeredOn: dateStr
    // Partial candidate: sourcing sets identity fields only; pipeline/interview
    // fields hydrate later (mirrors the pre-TS runtime shape).
  } as any);

  if (resumeText && !isGarbageText(resumeText)) {
    resumeTextCache[candId] = resumeText;
    resumeIdentityCache[candId] = identity;
  }

  return candId;
}

// In api mode an imported candidate starts as a local "CAN-…" row; persist each to
// the backend so it survives hydrateBackendApplicants (which replaces the in-memory
// list with the backend's copy on the next job-detail render). Without this the row
// only shows after a manual page refresh. Re-keys the resume caches CAN-… → backend
// UUID and sets cand.jobId so hydrate dedups; returns the surviving id list for
// downstream use (e.g. bulk analysis).
// A create can fail (duplicate/blank email, backend down). In api mode a local-only
// row CANNOT be shown for a backend job — the job-detail filter requires
// jobId === job.id, which the next hydrate then wipes — so rather than leave an
// invisible ghost (silent loss), we drop the failed rows and tell the recruiter
// exactly who failed and why, so they can fix and re-import.
async function persistImportedCandidates(localIds, job) {
  if (!isApiMode() || !job || !job._backend) return localIds;
  const ids = [];
  const failed = [];
  for (const localId of localIds) {
    const cand = AppState.candidates.find((c) => c.id === localId);
    if (!cand) continue;
    try {
      // Schedule-mode candidates (local status 'Screening') persist with
      // source='scheduled' so the backend sets screening_status=pending and they
      // appear in Recruiter Screening too; analyse-mode (status 'Resume') sends no
      // source and stays Resume-only. Still one applicant row either way.
      const source = cand.status === 'Screening' ? 'scheduled' : null;
      const created = await apiAddApplicant(job.id, { name: cand.name, email: cand.email, phone: cand.phone, source });
      if (!created || !created.id) throw new Error('no id returned');
      const uuid = created.id;
      if (resumeTextCache[localId] != null) { resumeTextCache[uuid] = resumeTextCache[localId]; delete resumeTextCache[localId]; }
      if (resumeIdentityCache[localId] != null) { resumeIdentityCache[uuid] = resumeIdentityCache[localId]; delete resumeIdentityCache[localId]; }
      cand.id = uuid; cand.jobId = job.id; cand._backend = true;
      ids.push(uuid);
    } catch (e) {
      failed.push(cand);
    }
  }
  if (failed.length) {
    const failedIds = new Set(failed.map((c) => c.id));
    AppState.candidates = AppState.candidates.filter((c) => !failedIds.has(c.id));
    failed.forEach((c) => { delete resumeTextCache[c.id]; delete resumeIdentityCache[c.id]; });
    const names = failed.map((c) => c.name).slice(0, 3).join(', ') + (failed.length > 3 ? ` +${failed.length - 3} more` : '');
    showPremiumToast(`Couldn't save ${failed.length} candidate(s) to the backend (${names}) — check for duplicate or blank emails and re-import.`, 'error');
  }
  return ids;
}

function showPremiumToast(message, type = 'success', action = null) {
  const existing = document.querySelector('.toast-notification');
  if (existing) {
    existing.remove();
  }

  const toast = document.createElement('div');
  toast.className = `toast-notification ${type}`;

  let iconSvg = '';
  if (type === 'success') {
    iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
  } else {
    iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
  }

  toast.innerHTML = `
    <span class="toast-icon">${iconSvg}</span>
    <span class="toast-message">${escapeHTML(message)}</span>
  `;

  const dismiss = () => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 450);
  };

  if (action && action.label && typeof action.onClick === 'function') {
    const btn = document.createElement('button');
    btn.className = 'toast-action';
    btn.textContent = action.label;
    btn.addEventListener('click', () => { action.onClick(); dismiss(); });
    toast.appendChild(btn);
  }

  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add('show');
  });

  setTimeout(dismiss, action ? 6000 : 2800);
}


export { addCandidateToAppState, addCandidateToManualQueue, checkAllResumesDone, cleanNameLine, createPlaceholderEmail, csvParsedCandidates, currentSourcingMode, currentSourcingTab, currentTargetStage, downloadCsvTemplate, extractCandidateNameFromFilename, extractExplicitResumeName, extractHeaderResumeName, extractResumeEmail, extractResumeIdentity, extractResumeLinkedIn, extractResumePhone, extractTextFromResumeFile, handleCsvFileSelect, handleResumesFileSelect, importCsvCandidates, importManualQueue, importResumesCandidates, initSourcing, isLikelyPersonName, nameFromEmail, navigateToSourcing, normalizeCandidateName, normalizeResumeText, parseCsvFile, processCsvText, removeCandidateFromQueue, renderCsvPreview, renderManualQueue, showPremiumToast, simulateResumesParsing, sourcingQueue, switchSourcingMode, switchSourcingTab, uploadedFiles };
