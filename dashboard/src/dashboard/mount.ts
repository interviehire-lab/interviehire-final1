import { document, window, requestAnimationFrame, setTimeout } from './runtime';
import { EXPERIENCE_BANDS_PROMPT } from './constants';
import { escapeHTML } from './escape';
import { callDeepSeekAPI, enrichJobWithAI, loadStateFromLocalStorage, parseAIJson, saveStateToLocalStorage } from './ai-api';
import { bootstrapApiData } from './api-bootstrap';
import { reviewJdRewrite } from './jd-rewrite';
import { initCrystalAnimations } from './animations';
import { drawFunnelSVG, drawScoreDistributionSVG } from './funnel-charts';
import { navigateToJobDetail } from './job-detail';
import { renderJobDetailPanes } from './job-detail-panes';
import { pushUrl } from './url-sync';
import { jobStageUrl } from './job-stages';
import { openJobFlowView } from './job-flow';
import { initKanbanDragAndDrop, renderColumnsSelectorDropdowns, stopActiveCardPlayer } from './kanban-dnd';
import { recalculateJobPipelines, renderKanbanBoard, toggleWaveformAudio } from './kanban-swarm';
import { closeDrawers, createJobUpload, navigateToAriaChat, navigateToCreateJob, navigateToSubtab, navigateToTab, openDrawer, sendAriaMessage, triggerExcelExport } from './navigation';
import { initSlidingPills } from './pills';
import { filterCandidatesByDateRange, renderAnalyticsTable, renderJobCards, renderJobListView, renderTeamTable, updateJobsCounters, updateSummaryMetrics } from './render-views';
import { soundEngine } from './sound';
import { initSourcing, navigateToSourcing, showPremiumToast } from './sourcing';
import { renderSpotlightResults, SpotlightCommands, spotlightUi, toggleSpotlightModal } from './spotlight';
import { AppState, generateJobId } from './state';
import { apiCreateJob, apiPatchJobParameters, apiDeleteJob, apiUpdateJobStatus, apiSetJobListed, apiDuplicateJob, apiPatchJobSettings, apiGetOrganisation, apiUpdateOrganisation, apiInviteMember, isApiMode, getDataSource } from './api';
import { initOrgSwitcher } from './org-switcher';
import { initSettingsPage, syncSettingsControls } from './settings-page';
import { renderCareerJobs } from './career-panel';
import { renderOrgApplicationQuestions } from './application-questions-editor';

// ==========================================
// COMPONENT MOUNT BINDINGS
// ==========================================
function initMountBindings() {
  // Load state from localStorage on startup
  loadStateFromLocalStorage();

  // In api mode, hydrate jobs from the live backend (re-renders when ready).
  bootstrapApiData();

  // Super-admin org switcher: expose a re-init hook so DashboardShell can rebuild
  // it once /me has set the role globals, and try once now (no-op until known).
  window.__ihInitOrgSwitcher = initOrgSwitcher;
  initOrgSwitcher();
  // Lets DashboardShell refresh the settings email/toggles once /me sets the globals,
  // even when the settings view is already open on initial load.
  window.__ihSyncSettings = syncSettingsControls;

  // Sidebar Collapse Toggle
  const toggleSidebarBtn = document.getElementById('btn-toggle-sidebar');
  if (toggleSidebarBtn) {
    toggleSidebarBtn.addEventListener('click', () => {
      const appContainer = document.querySelector('.dashboard-app');
      if (appContainer) {
        appContainer.classList.toggle('sidebar-collapsed');
        soundEngine.playClick();
      }
    });
  }

  // Breadcrumbs: Client Portal Click
  const portalLink = document.getElementById('bc-portal-link');
  if (portalLink) {
    portalLink.addEventListener('click', () => {
      navigateToTab('jobs');
    });
  }

  // Recalculate job pipelines based on initial state
  recalculateJobPipelines();

  // A. Navigation Event Listeners
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      const tabId = item.getAttribute('data-tab');
      
      // If clicking settings, toggle subnav but don't navigate directly unless subnav is clicked
      if (tabId === 'settings') {
        e.stopPropagation();
        item.classList.toggle('open');
        soundEngine.playClick();
        return;
      }
      
      navigateToTab(tabId);
    });
  });

  // Settings subnav clicks
  document.querySelectorAll('.sub-nav li').forEach(subItem => {
    subItem.addEventListener('click', (e) => {
      e.stopPropagation();
      const subtabId = subItem.getAttribute('data-subtab');
      navigateToSubtab(subtabId);
    });
  });

  // B. Contextual Action Button (Header)
  const headerActionBtn = document.getElementById('header-action-btn');
  if (headerActionBtn) {
    headerActionBtn.addEventListener('click', () => {
      if (AppState.activeTab === 'team') {
        openDrawer('member');
      } else {
        navigateToCreateJob();
      }
    });
  }

  // C. Drawer Close actions
  const drawerBackdrop = document.getElementById('drawer-backdrop');
  if (drawerBackdrop) drawerBackdrop.addEventListener('click', closeDrawers);
  
  const btnCloseDrawerJob = document.getElementById('btn-close-drawer-job');
  if (btnCloseDrawerJob) btnCloseDrawerJob.addEventListener('click', closeDrawers);
  
  const btnCloseDrawerMember = document.getElementById('btn-close-drawer-member');
  if (btnCloseDrawerMember) btnCloseDrawerMember.addEventListener('click', closeDrawers);
  
  const btnCloseDrawerViewJd = document.getElementById('btn-close-drawer-view-jd');
  if (btnCloseDrawerViewJd) btnCloseDrawerViewJd.addEventListener('click', closeDrawers);
  
  const btnSaveDrawerJd = document.getElementById('btn-save-drawer-jd');
  if (btnSaveDrawerJd) {
    btnSaveDrawerJd.addEventListener('click', () => {
    const drawer = document.getElementById('drawer-view-jd');
    const jobId = drawer.getAttribute('data-current-job-id');
    const descriptionText = document.getElementById('drawer-jd-text').value.trim();
    if (jobId) {
      const job = AppState.jobs.find(j => j.id === jobId);
      if (job) {
        job.description = descriptionText;
        showPremiumToast("Job description updated successfully.", "success");
        saveStateToLocalStorage();
        if (AppState.activeJobId === jobId) {
          const jdRawDescTextarea = document.getElementById('jd-raw-description');
          if (jdRawDescTextarea) {
            jdRawDescTextarea.value = descriptionText;
          }
        }
      }
    }
    closeDrawers();
    });
  }

  // JD Drawer: Enhance description with DeepSeek
  const btnEnhanceDrawerJd = document.getElementById('btn-enhance-drawer-jd');
  if (btnEnhanceDrawerJd) {
    btnEnhanceDrawerJd.addEventListener('click', async () => {
      const drawer = document.getElementById('drawer-view-jd');
      const textarea = document.getElementById('drawer-jd-text');
      const currentText = textarea ? textarea.value.trim() : '';
      if (!currentText) {
        showPremiumToast("Please enter a job description first.", "error");
        return;
      }

      const originalLabel = btnEnhanceDrawerJd.textContent;
      btnEnhanceDrawerJd.disabled = true;
      btnEnhanceDrawerJd.innerHTML = `<span style="display:inline-block;width:10px;height:10px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin-mini 0.6s linear infinite;margin-right:5px;vertical-align:middle;"></span> Enhancing...`;

      soundEngine.playChime([392, 440], 0.08, 0.1);

      const systemPrompt = `You are a senior talent acquisition specialist. Rewrite the given job description to be clearer, more compelling, and professional. Keep all the original requirements but improve the structure, language, and readability. Return ONLY the improved job description text — no commentary, no JSON, no markdown headers.`;

      try {
        const improved = await callDeepSeekAPI([
          { role: "system", content: systemPrompt },
          { role: "user", content: `Improve this job description:\n\n${currentText}` }
        ]);
        // Restore the button before review so it isn't stuck spinning behind the modal.
        btnEnhanceDrawerJd.disabled = false;
        btnEnhanceDrawerJd.textContent = originalLabel;

        const accepted = await reviewJdRewrite({
          title: 'Enhanced Job Description',
          original: currentText,
          suggested: improved.trim()
        });
        if (accepted !== null && textarea) {
          textarea.value = accepted;
          soundEngine.playChime([523.25, 659.25], 0.12, 0.08);
          showPremiumToast("Job description enhanced successfully.", "success");
        }
      } catch (err) {
        console.error("JD enhancement failed:", err);
        showPremiumToast("Enhancement failed. Check API status.", "error");
      } finally {
        btnEnhanceDrawerJd.disabled = false;
        btnEnhanceDrawerJd.textContent = originalLabel;
      }
    });
  }

  // JD Drawer: Save + navigate to Questions tab and trigger generation
  const btnGenerateFromDrawer = document.getElementById('btn-generate-from-drawer-jd');
  if (btnGenerateFromDrawer) {
    btnGenerateFromDrawer.addEventListener('click', () => {
      const drawer = document.getElementById('drawer-view-jd');
      const jobId = drawer.getAttribute('data-current-job-id');
      const descriptionText = document.getElementById('drawer-jd-text').value.trim();
      if (!jobId || !descriptionText) {
        showPremiumToast("Add a job description before generating questions.", "error");
        return;
      }
      const job = AppState.jobs.find(j => j.id === jobId);
      if (job) {
        job.description = descriptionText;
        saveStateToLocalStorage();
      }
      closeDrawers();
      navigateToJobDetail(jobId);
      // Switch to Questions tab after navigation paint
      requestAnimationFrame(() => {
        const questionsTab = document.querySelector('.jd-tab[data-jd-tab="questions"]');
        if (questionsTab) questionsTab.click();
        // Pre-fill the description textarea in the Questions pane
        const rawDesc = document.getElementById('jd-raw-description');
        if (rawDesc) rawDesc.value = descriptionText;
        soundEngine.playChime([329.63, 392, 523.25], 0.12, 0.1);
      });
    });
  }

  window.openJobDescriptionDrawer = (jobId) => openDrawer('view-jd', jobId);

  const closeAllJobKebabs = () => {
    document.querySelectorAll('.job-kebab-dropdown.open').forEach(d => d.classList.remove('open'));
    document.querySelectorAll('.job-card.kebab-open').forEach(c => c.classList.remove('kebab-open'));
  };

  window.toggleJobKebab = function(btn) {
    const dropdown = btn.nextElementSibling;
    const isOpen = dropdown.classList.contains('open');
    closeAllJobKebabs();
    if (!isOpen) {
      dropdown.classList.add('open');
      btn.closest('.job-card')?.classList.add('kebab-open');
    }
  };

  document.addEventListener('click', closeAllJobKebabs);

  window.handleJobKebab = async function(jobId, action) {
    closeAllJobKebabs();
    const job = AppState.jobs.find(j => j.id === jobId);
    if (!job) return;
    switch (action) {
      case 'edit-name':
        openEditJobModal(jobId);
        break;
      case 'view-flow':
        openJobFlowView(jobId);
        break;
      case 'add-candidates':
        navigateToSourcing(jobId);
        break;
      case 'career-page': {
        const nextListed = !job.listedOnCareer;
        // Persist FIRST, then claim success — the public career query requires BOTH
        // is_job_listed AND status='published' (backend public.py), so listing a job
        // also publishes it. Only toast after the backend confirms so we never report
        // a silently-skipped no-op.
        if (getDataSource() === 'api' && job._backend) {
          try {
            await apiPatchJobSettings(job.id, nextListed ? { is_job_listed: true, status: 'published' } : { is_job_listed: false });
          } catch (e) { showPremiumToast('Could not update career page', 'error'); break; }
        }
        job.listedOnCareer = nextListed;
        if (nextListed) job.status = 'published';
        renderJobCards();
        renderCareerJobs(); // keep the Career-view record panel in sync (both directions)
        const label = nextListed ? 'listed on' : 'removed from';
        showPremiumToast(`"${job.cardName || job.roleName}" ${label} career page.`, 'success');
        break;
      }
      case 'duplicate': {
        if (getDataSource() === 'api' && job._backend) {
          // Real server-side deep copy: full config + a snapshot of all applicants.
          // The returned job is _backend=true, so it persists and can be published.
          try {
            const dup = await apiDuplicateJob(job.id);
            AppState.jobs.push(dup);
            renderJobCards();
            updateJobsCounters();
            showPremiumToast(`Job duplicated as "${dup.cardName || dup.roleName}".`, 'success');
          } catch (e) {
            const m = (e && e.message) === 'Not Found' ? 'server is updating, please try again in a moment' : (e && e.message) || 'backend error';
            showPremiumToast(`Couldn't duplicate "${job.cardName || job.roleName}": ${m}`, 'error');
          }
          break;
        }
        // Local / demo mode: client-side clone (no backend, applicants are local-only).
        const dup = JSON.parse(JSON.stringify(job));
        dup.id = 'JOB-' + Math.random().toString(36).substr(2, 8).toUpperCase();
        dup.cardName = (job.cardName || job.roleName) + ' (Copy)';
        dup.status = 'draft';
        dup.listedOnCareer = false;
        dup.created = new Date().toLocaleString('en-US', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
        dup.pipeline = { total: 0, resume: 0, screening: 0, functional: 0 };
        AppState.jobs.push(dup);
        renderJobCards();
        updateJobsCounters();
        showPremiumToast(`Job duplicated as "${dup.cardName}".`, 'success');
        break;
      }
      case 'settings':
        navigateToJobDetail(jobId);
        setTimeout(() => {
          const qTab = document.querySelector('.jd-tab[data-jd-tab="questions"]');
          if (qTab) qTab.click();
        }, 100);
        break;
      case 'archive':
      case 'unarchive': {
        const prev = job.status;
        const next = action === 'archive' ? 'archived' : 'published';
        const label = action === 'archive' ? 'archived' : 'restored';
        job.status = next;
        saveStateToLocalStorage();
        renderJobCards();
        updateJobsCounters();
        if (getDataSource() === 'api' && job._backend) {
          // Persist the status change; roll back if the backend rejects it.
          apiUpdateJobStatus(job.id, next).catch((e) => {
            job.status = prev;
            saveStateToLocalStorage();
            renderJobCards();
            updateJobsCounters();
            showPremiumToast(`Couldn't ${action} "${job.cardName || job.roleName}": ${(e && e.message) || 'backend error'}`, 'error');
          });
        }
        showPremiumToast(`"${job.cardName || job.roleName}" has been ${label}.`, 'success');
        break;
      }
      case 'delete': {
        const name = job.cardName || job.roleName;
        const idx = AppState.jobs.findIndex(j => j.id === jobId);
        if (idx === -1) break;
        const isBackend = getDataSource() === 'api' && job._backend;
        const removedJob = AppState.jobs[idx];
        const removedCandidates = AppState.candidates.filter(c => isBackend
          ? c.jobId === job.id
          : (c.jobApplied === job.roleName || c.jobApplied === job.cardName));
        AppState.jobs.splice(idx, 1);
        AppState.candidates = AppState.candidates.filter(c => isBackend
          ? c.jobId !== job.id
          : (c.jobApplied !== job.roleName && c.jobApplied !== job.cardName));
        saveStateToLocalStorage();
        const restoreJob = () => {
          AppState.jobs.splice(Math.min(idx, AppState.jobs.length), 0, removedJob);
          AppState.candidates.push(...removedCandidates);
          saveStateToLocalStorage();
          renderJobCards();
          updateJobsCounters();
          updateSummaryMetrics();
          showPremiumToast(`"${name}" restored.`, 'success');
        };
        if (isBackend) {
          // Persist immediately so the job stays gone after a refetch. Roll the
          // optimistic removal back if the backend rejects the delete. No Undo
          // here: the backend hard-deletes (cascading applicants), so a local
          // re-insert couldn't truly restore it.
          apiDeleteJob(job.id).catch((e) => {
            restoreJob();
            showPremiumToast(`Couldn't delete "${name}": ${(e && e.message) || 'backend error'}`, 'error');
          });
          setTimeout(() => {
            renderJobCards();
            updateJobsCounters();
            updateSummaryMetrics();
            showPremiumToast(`"${name}" deleted.`, 'success');
          }, 0);
        } else {
          setTimeout(() => {
            renderJobCards();
            updateJobsCounters();
            updateSummaryMetrics();
            showPremiumToast(`"${name}" deleted.`, 'success', { label: 'Undo', onClick: restoreJob });
          }, 0);
        }
        break;
      }
    }
  };

  // Edit Job Modal logic
  let editJobModalTags = [];
  let editJobModalJobId = null;

  function openEditJobModal(jobId) {
    const job = AppState.jobs.find(j => j.id === jobId);
    if (!job) return;
    editJobModalJobId = jobId;
    editJobModalTags = Array.isArray(job.tags) ? [...job.tags] : [];

    const modal = document.getElementById('modal-edit-job');
    document.getElementById('modal-edit-job-name').value = job.cardName || job.roleName || '';
    document.getElementById('modal-edit-job-id').value = job.customJobId && job.customJobId !== '-' ? job.customJobId : '';
    renderEditJobTags();
    modal.style.display = '';
    setTimeout(() => document.getElementById('modal-edit-job-name').focus(), 50);
    soundEngine.playChime([392.00, 523.25], 0.12, 0.1);
  }

  function closeEditJobModal() {
    document.getElementById('modal-edit-job').style.display = 'none';
    editJobModalJobId = null;
    editJobModalTags = [];
    soundEngine.playClick();
  }

  function renderEditJobTags() {
    const list = document.getElementById('modal-edit-tags-list');
    list.innerHTML = editJobModalTags.map((tag, i) =>
      `<span class="modal-tag">${escapeHTML(tag)}<button class="modal-tag-remove" data-idx="${i}">×</button></span>`
    ).join('');
    list.querySelectorAll('.modal-tag-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        editJobModalTags.splice(parseInt(btn.dataset.idx), 1);
        renderEditJobTags();
      });
    });
  }

  const modalEditJobClose = document.getElementById('modal-edit-job-close');
  if (modalEditJobClose) modalEditJobClose.addEventListener('click', closeEditJobModal);
  
  const modalEditJob = document.getElementById('modal-edit-job');
  if (modalEditJob) {
    modalEditJob.addEventListener('click', (e) => {
      if (e.target.id === 'modal-edit-job') closeEditJobModal();
    });
  }

  const modalEditTagsInput = document.getElementById('modal-edit-tags-input');
  if (modalEditTagsInput) {
    modalEditTagsInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const val = e.target.value.replace(/,/g, '').trim();
        if (val && !editJobModalTags.includes(val)) {
          editJobModalTags.push(val);
          renderEditJobTags();
        }
        e.target.value = '';
      }
    });
  }

  const modalEditJobSave = document.getElementById('modal-edit-job-save');
  if (modalEditJobSave) {
    modalEditJobSave.addEventListener('click', () => {
    const job = AppState.jobs.find(j => j.id === editJobModalJobId);
    if (!job) return;
    const nameVal = document.getElementById('modal-edit-job-name').value.trim();
    if (!nameVal) {
      showPremiumToast('Job name is required.', 'error');
      return;
    }
    const prev = { cardName: job.cardName, customJobId: job.customJobId, tags: job.tags };
    job.cardName = nameVal;
    const idVal = document.getElementById('modal-edit-job-id').value.trim();
    if (idVal) job.customJobId = idVal;
    job.tags = [...editJobModalTags];
    saveStateToLocalStorage();
    closeEditJobModal();
    renderJobCards();
    updateJobsCounters();
    showPremiumToast(`Job updated to "${nameVal}".`, 'success');
    if (getDataSource() === 'api' && job._backend) {
      // Persist the edit so it survives a refetch; roll back if the backend rejects it.
      apiPatchJobSettings(job.id, { title: nameVal, custom_job_id: idVal || null, tags: [...editJobModalTags] })
        .catch((e) => {
          job.cardName = prev.cardName;
          job.customJobId = prev.customJobId;
          job.tags = prev.tags;
          saveStateToLocalStorage();
          renderJobCards();
          updateJobsCounters();
          const m = (e && e.message) === 'Not Found' ? 'server is updating, please try again in a moment' : (e && e.message) || 'backend error';
          showPremiumToast(`Couldn't save changes: ${m}`, 'error');
        });
    }
    });
  }

  const closeReportBtn = document.getElementById('btn-close-drawer-report');
  if (closeReportBtn) {
    closeReportBtn.addEventListener('click', closeDrawers);
  }

  // Report Vetting Drawer tab switching
  document.querySelectorAll('.report-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabName = btn.getAttribute('data-report-tab');
      
      document.querySelectorAll('.report-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      document.querySelectorAll('.report-tab-content').forEach(c => c.classList.remove('active'));
      const activeContent = document.getElementById(`rep-tab-${tabName}`);
      if (activeContent) activeContent.classList.add('active');
      
      soundEngine.playClick();
    });
  });

  // Interview Waveform playback control
  const btnPlayWave = document.getElementById('btn-play-wave');
  if (btnPlayWave) {
    btnPlayWave.addEventListener('click', () => {
      toggleWaveformAudio();
    });
  }

  // D. Job Filter Buttons (Jobs list header)
  document.querySelectorAll('.filter-options button[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-options button[data-filter]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      AppState.jobsFilter = btn.getAttribute('data-filter');
      soundEngine.playClick();
      
      const isBoard = document.getElementById('btn-view-board').classList.contains('active');
      if (isBoard) {
        renderKanbanBoard();
      } else {
        renderJobCards();
      }
    });
  });

  // E. Team Filter Buttons (Team list header)
  document.querySelectorAll('#team-status-tabs button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#team-status-tabs button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      AppState.teamFilter = btn.getAttribute('data-team-filter');
      soundEngine.playClick();
      renderTeamTable();
    });
  });

  // F. Table Switcher Subtabs (Analytics View)
  document.querySelectorAll('.table-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.table-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      AppState.analyticsSubtab = btn.getAttribute('data-table');
      soundEngine.playClick();
      renderAnalyticsTable();
    });
  });

  // G. Dynamic searching filters
  const globalSearchInput = document.getElementById('global-search');
  globalSearchInput.addEventListener('input', (e) => {
    AppState.globalSearch = e.target.value;
    if (AppState.activeTab === 'jobs') {
      const isBoard = document.getElementById('btn-view-board').classList.contains('active');
      if (isBoard) {
        renderKanbanBoard();
      } else {
        renderJobCards();
      }
    } else if (AppState.activeTab === 'analytics') {
      AppState.tableSearch = e.target.value;
      renderAnalyticsTable();
    } else if (AppState.activeTab === 'team') {
      renderTeamTable();
    }
  });

  const tableSearchInput = document.getElementById('table-search');
  tableSearchInput.addEventListener('input', (e) => {
    AppState.tableSearch = e.target.value;
    renderAnalyticsTable();
  });

  const analyticsFilterBtn = document.querySelector('.btn-ctrl-filter');
  if (analyticsFilterBtn) {
    analyticsFilterBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      soundEngine.playClick();
      const existing = analyticsFilterBtn.parentElement.querySelector('.analytics-filter-dropdown');
      if (existing) { existing.remove(); return; }
      document.querySelectorAll('.analytics-filter-dropdown').forEach(d => d.remove());

      const dd = document.createElement('div');
      dd.className = 'analytics-filter-dropdown';
      dd.addEventListener('click', ev => ev.stopPropagation());

      if (AppState.analyticsSubtab === 'jobs-data') {
        const statuses = ['Published', 'Draft', 'Archived'];
        dd.innerHTML = `
          <div class="afd-title">Filter by Status</div>
          <div class="afd-items">${statuses.map(s => `<label class="afd-item"><input type="checkbox" value="${s}" ${AppState.analyticsJobStatusFilter?.includes(s) ? 'checked' : ''} /><span>${s}</span></label>`).join('')}</div>
          <div class="afd-footer"><button class="afd-clear">Clear</button><button class="afd-apply">Apply</button></div>`;
        dd.querySelector('.afd-apply').addEventListener('click', () => {
          AppState.analyticsJobStatusFilter = [...dd.querySelectorAll('input:checked')].map(c => c.value);
          renderAnalyticsTable();
          dd.remove();
        });
        dd.querySelector('.afd-clear').addEventListener('click', () => {
          AppState.analyticsJobStatusFilter = [];
          renderAnalyticsTable();
          dd.remove();
        });
      } else {
        const stages = ['Resume', 'Screening', 'Functional', 'Hired', 'Rejected'];
        dd.innerHTML = `
          <div class="afd-title">Filter by Stage</div>
          <div class="afd-items">${stages.map(s => `<label class="afd-item"><input type="checkbox" value="${s}" ${AppState.analyticsCandStageFilter?.includes(s) ? 'checked' : ''} /><span>${s}</span></label>`).join('')}</div>
          <div class="afd-footer"><button class="afd-clear">Clear</button><button class="afd-apply">Apply</button></div>`;
        dd.querySelector('.afd-apply').addEventListener('click', () => {
          AppState.analyticsCandStageFilter = [...dd.querySelectorAll('input:checked')].map(c => c.value);
          renderAnalyticsTable();
          dd.remove();
        });
        dd.querySelector('.afd-clear').addEventListener('click', () => {
          AppState.analyticsCandStageFilter = [];
          renderAnalyticsTable();
          dd.remove();
        });
      }
      analyticsFilterBtn.parentElement.style.position = 'relative';
      analyticsFilterBtn.parentElement.appendChild(dd);
      const close = (ev) => { if (!dd.contains(ev.target) && ev.target !== analyticsFilterBtn) { dd.remove(); document.removeEventListener('click', close); } };
      setTimeout(() => document.addEventListener('click', close), 0);
    });
  }

  const teamSearchInput = document.getElementById('team-search');
  teamSearchInput.addEventListener('input', () => {
    renderTeamTable();
  });

  const teamRoleFilter = document.getElementById('team-role-filter');
  teamRoleFilter.addEventListener('change', () => {
    soundEngine.playClick();
    renderTeamTable();
  });

  // H. Forms submit action handlers
  // 1. Create Job Card Submission
  const createJobForm = document.getElementById('form-create-job');
  if (createJobForm) {
    createJobForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const cardName = document.getElementById('job-title-input').value;
      const roleName = document.getElementById('job-role-input').value;
      const expBand = document.getElementById('job-experience-input').value;
      let customId = document.getElementById('job-custom-id').value;
      const description = document.getElementById('job-description-input').value.trim();
      
      if (!customId || customId.trim() === '') {
        customId = '-';
      }

      // Pipeline stages counts
      const addResume = document.getElementById('chk-resume').checked;
      const addScreening = document.getElementById('chk-screening').checked;
      const addFunctional = document.getElementById('chk-functional').checked;

      // API mode: persist the job to the backend so it survives refetches
      // (the local-only path below would vanish on the next GET /api/jobs).
      if (isApiMode()) {
        const submitBtn = createJobForm.querySelector('button[type="submit"]') || e.submitter;
        const origBtnHTML = submitBtn ? submitBtn.innerHTML : '';
        if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = 'Creating job…'; }
        let created;
        try {
          created = await apiCreateJob({
            cardName, roleName, experienceBand: expBand, customJobId: customId,
            status: 'draft', description: description || 'No job description provided.',
            pipelineConfig: {
              resumeAnalysis: { enabled: addResume },
              recruiterScreening: { enabled: addScreening },
              functionalInterview: { enabled: addFunctional },
            },
          });
        } catch (err) {
          console.error('Backend job create failed:', err);
          if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = origBtnHTML; }
          showPremiumToast(`Could not create job: ${err.message}`, 'error');
          return;
        }
        AppState.jobs.push(created);
        saveStateToLocalStorage();
        // Enrich with AI and persist the blueprint so the draft is reviewable.
        if (description) {
          if (submitBtn) submitBtn.innerHTML = 'Generating interview pipeline…';
          try {
            await enrichJobWithAI(created, description);
            await apiPatchJobParameters(created.id, created);
          } catch (err) {
            console.error('Job enrichment/persist failed:', err);
          }
        }
        if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = origBtnHTML; }
        closeDrawers();
        createJobForm.reset();
        showPremiumToast(`Created job card "${roleName}" as Draft.`, 'success');
        soundEngine.playChime([261.63, 329.63, 392.00, 523.25], 0.2, 0.08);
        openJobFlowView(created.id, true);
        return;
      }

      let totalApplicants = 0;
      let resumeVal = 0;
      let screeningVal = 0;
      let functionalVal = 0;

      // Simulate mock applicant distribution and push records
      const firstNames = ['Lucas', 'Sofia', 'Marcus', 'Chloe', 'Daniel', 'Amina'];
      const lastNames = ['Chen', 'Silva', 'Taylor', 'Nakamura', 'Oki', 'Ali'];
      
      const createMockCandidate = (status) => {
        const name = `${firstNames[Math.floor(Math.random() * firstNames.length)]} ${lastNames[Math.floor(Math.random() * lastNames.length)]}`;
        const email = `${name.toLowerCase().replace(' ', '.')}@recruit.io`;
        const id = `CAN-${Math.floor(Math.random() * 8999 + 1000)}-${customId !== '-' ? customId.slice(-3) : generateJobId().slice(-3)}`;
        const scoreVal = Math.floor(Math.random() * 15 + 80) + '%';
        
        AppState.candidates.push({
          id,
          name,
          email,
          jobApplied: roleName,
          status,
          score: scoreVal,
          registeredOn: new Date().toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }) + ', 10:00 AM'
        } as any);
      };

      if (addResume) {
        createMockCandidate('Resume');
        resumeVal++;
        totalApplicants++;
      }
      if (addScreening) {
        createMockCandidate('Screening');
        createMockCandidate('Screening');
        screeningVal += 2;
        totalApplicants += 2;
      }
      if (addFunctional) {
        createMockCandidate('Functional');
        functionalVal++;
        totalApplicants++;
      }

      const newJob: any = {
        id: generateJobId(),
        roleName: roleName,
        cardName: cardName,
        created: new Date().toLocaleString('en-US', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }),
        status: 'draft',
        customJobId: customId,
        experienceBand: expBand,
        createdBy: globalThis.IH_USER_NAME || 'You',
        description: description || "No job description provided.",
        questions: [],
        pipeline: {
          total: totalApplicants,
          resume: resumeVal,
          screening: screeningVal,
          functional: functionalVal
        }
      };

      AppState.jobs.push(newJob);
      saveStateToLocalStorage();

      // Enrich with AI so the manual path yields the same reviewable draft
      // (criteria, questions, JD grade) as the upload and Lina paths.
      const submitBtn = createJobForm.querySelector('button[type="submit"]') || e.submitter;
      const origBtnHTML = submitBtn ? submitBtn.innerHTML : '';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.setAttribute('aria-live', 'polite');
        submitBtn.innerHTML = 'Generating interview pipeline…';
      }

      if (description) {
        try {
          await enrichJobWithAI(newJob, description);
        } catch (err) {
          console.error('Manual job enrichment failed:', err);
        }
      }

      if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = origBtnHTML; }

      // Close Drawer panel and reset form
      closeDrawers();
      createJobForm.reset();
      showPremiumToast(`Created job card "${roleName}" as Draft.`, "success");
      soundEngine.playChime([261.63, 329.63, 392.00, 523.25], 0.2, 0.08); // Melodic confirmation chime

      // Open Job Flow config view for the new draft job
      openJobFlowView(newJob.id, true);
    });
  }

  // 2. Invite Team Member Submission
  const inviteMemberForm = document.getElementById('form-invite-member');
  inviteMemberForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = document.getElementById('member-name-input').value;
    const email = document.getElementById('member-email-input').value;
    const designation = document.getElementById('member-designation-input').value;
    const usertype = document.getElementById('member-role-input').value;

    let newMember = {
      name: name,
      email: email,
      designation: designation,
      usertype: usertype,
      registeredOn: new Date().toLocaleString('en-US', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }),
      status: 'Invited'
    };

    // In api mode persist to the shared DB so the invite survives a refresh and
    // the invitee gets a real account; abort with a clear error if it fails.
    if (isApiMode()) {
      try {
        newMember = await apiInviteMember({ name, email, designation, usertype });
      } catch (err) {
        showPremiumToast(`Could not invite ${name}: ${(err && err.message) || 'backend error'}`, 'error');
        return;
      }
    }

    AppState.team.push(newMember);
    saveStateToLocalStorage();

    // Refresh display
    renderTeamTable();

    // Close Drawer panel
    closeDrawers();
    inviteMemberForm.reset();
    soundEngine.playChime([261.63, 392.00, 523.25], 0.2, 0.08); // Confirmation chime
  });

  // 3. Settings Forms — Career Page config. The recruiter edits only the hero
  //    intro (persisted to the org profile in API mode); the subdomain is
  //    system-assigned and shown read-only in the live status panel.
  const applyCareerDomain = (sub) => {
    const root = document.getElementById('view-career');
    const statusLink = root && root.querySelector('.status-link');
    const statusTitle = root && root.querySelector('.status-title');
    const statusDot = root && root.querySelector('.pulsing-dot');
    const clean = (sub || '').trim();
    // Share the authoritative subdomain with the Career-view jobs panel so its
    // "View live" links resolve to the right public career URL.
    AppState.careerSubdomain = clean;
    if (clean) {
      if (statusLink) {
        statusLink.textContent = `interviehire.com/careers/${clean} ↗`;
        statusLink.href = `https://interviehire.com/careers/${clean}`;
        statusLink.style.pointerEvents = '';
      }
      if (statusTitle) statusTitle.textContent = 'Live & Active';
      if (statusDot) { statusDot.classList.add('green'); statusDot.style.background = ''; }
    } else {
      // No subdomain yet — make the publish gap explicit instead of showing the
      // stale demo default as if the page were live.
      if (statusLink) {
        statusLink.textContent = 'Set your career page URL to publish jobs';
        statusLink.removeAttribute('href');
        statusLink.style.pointerEvents = 'none';
      }
      if (statusTitle) statusTitle.textContent = 'Not published yet';
      if (statusDot) { statusDot.classList.remove('green'); statusDot.style.background = '#f59e0b'; }
    }
    // First-paint (and refresh) the Career-view jobs panel from the same
    // server-provided subdomain the status box already uses.
    renderCareerJobs();
  };

  // HYDRATE on mount: local restore first (instant), then the authoritative org
  // record overrides it in API mode. Guard against not being on the Career view.
  (async () => {
    const introField = document.getElementById('career-intro');
    if (!introField) return; // not on the Career Page view — nothing to wire
    try {
      const savedSub = localStorage.getItem('IntervieHire_career_subdomain');
      if (savedSub) applyCareerDomain(savedSub);
    } catch { /* ignore corrupt/blocked storage */ }
    if (getDataSource() === 'api') {
      try {
        const org = await apiGetOrganisation();
        if (org) {
          // The subdomain is system-assigned and read-only — just reflect it in the
          // live status panel. The recruiter can only edit the hero intro.
          applyCareerDomain(org.career_subdomain || '');
          if (org.career_intro != null) introField.value = org.career_intro;
          renderOrgApplicationQuestions(org);  // company-default apply questions editor
        }
      } catch { /* keep the local fallback already applied */ }
    }
  })();

  // EDIT ⇄ SAVE state machine driven by the single toggle button. State is tracked
  // via the button's data-editing attribute.
  const careerToggle = document.getElementById('career-edit-toggle');
  if (careerToggle) {
    careerToggle.addEventListener('click', async () => {
      const introField = document.getElementById('career-intro');
      if (!introField) return;

      // → ENTER EDIT MODE: unlock the hero intro (the only editable field now —
      //   the subdomain is system-assigned).
      if (careerToggle.dataset.editing !== '1') {
        introField.disabled = false;
        careerToggle.dataset.editing = '1';
        careerToggle.textContent = 'Save Configurations';
        introField.focus();
        soundEngine.playClick();
        return;
      }

      // → SAVE: persist the hero intro, then relock + 2s green-flash confirmation.
      const intro = introField.value;
      if (getDataSource() === 'api') {
        try {
          await apiUpdateOrganisation({ career_intro: intro });
        } catch (e) {
          showPremiumToast(`Could not save career page: ${(e && e.message) || 'backend error'}`, 'error');
          return; // keep inputs editable so the recruiter can retry
        }
      }
      soundEngine.playChime([523.25], 0.15);
      introField.disabled = true;
      careerToggle.dataset.editing = '';
      careerToggle.textContent = '✓ Saved';
      careerToggle.style.background = 'var(--color-success)';
      careerToggle.style.color = '#fff';
      setTimeout(() => {
        careerToggle.textContent = 'Edit Configurations';
        careerToggle.style.background = '';
        careerToggle.style.color = '';
      }, 2000);
    });
  }

  // General Settings page — wire every control to a real action (modals → backend,
  // sound/theme/preference toggles, client-side data export). See settings-page.js.
  initSettingsPage();

  // I. Exports Buttons Bindings
  document.getElementById('btn-export-jobs')?.addEventListener('click', () => {
    if (AppState.analyticsSubtab === 'jobs-data') {
      triggerExcelExport('jobs');
    } else {
      triggerExcelExport('candidates');
    }
  });

  document.getElementById('btn-export-team')?.addEventListener('click', () => {
    triggerExcelExport('team');
  });

  // Columns toggles buttons actions
  document.getElementById('btn-columns-toggle')?.addEventListener('click', (e) => {
    e.stopPropagation();
    soundEngine.playClick();
    const pop = document.getElementById('pop-columns-toggle');
    const isShowing = pop.style.display !== 'none';
    
    // Close other
    const popTeam = document.getElementById('pop-columns-team');
    if (popTeam) popTeam.style.display = 'none';
    
    if (isShowing) {
      pop.style.display = 'none';
    } else {
      renderColumnsSelectorDropdowns();
      pop.style.display = 'flex';
    }
  });
  document.getElementById('btn-columns-team')?.addEventListener('click', (e) => {
    e.stopPropagation();
    soundEngine.playClick();
    const pop = document.getElementById('pop-columns-team');
    const isShowing = pop.style.display !== 'none';
    
    // Close other
    const popToggle = document.getElementById('pop-columns-toggle');
    if (popToggle) popToggle.style.display = 'none';
    
    if (isShowing) {
      pop.style.display = 'none';
    } else {
      renderColumnsSelectorDropdowns();
      pop.style.display = 'flex';
    }
  });

  document.addEventListener('click', () => {
    const popToggle = document.getElementById('pop-columns-toggle');
    const popTeam = document.getElementById('pop-columns-team');
    if (popToggle) popToggle.style.display = 'none';
    if (popTeam) popTeam.style.display = 'none';
    document.querySelectorAll('.stage-filter-dropdown').forEach(d => d.remove());
    document.querySelectorAll('.filter-chip.active-filter').forEach(c => { c.classList.remove('active-filter'); c._filterDropdown = null; });
  });

  // Kanban view switching setup
  const btnViewCards = document.getElementById('btn-view-cards');
  const btnViewBoard = document.getElementById('btn-view-board');
  const jobsListContainer = document.getElementById('jobs-list-container');
  const jobsBoardContainer = document.getElementById('jobs-board-container');

  if (btnViewCards && btnViewBoard) {
    btnViewCards.addEventListener('click', () => {
      btnViewCards.classList.add('active');
      btnViewBoard.classList.remove('active');
      jobsListContainer.style.display = 'grid';
      jobsBoardContainer.style.display = 'none';
      soundEngine.playClick();
      renderJobCards();
    });

    btnViewBoard.addEventListener('click', () => {
      btnViewBoard.classList.add('active');
      btnViewCards.classList.remove('active');
      jobsListContainer.style.display = 'none';
      jobsBoardContainer.style.display = 'block';
      soundEngine.playClick();
      renderJobListView();
    });
  }

  // Spotlight input key bindings
  const spotlightInput = document.getElementById('spotlight-input');
  if (spotlightInput) {
    spotlightInput.addEventListener('keydown', (e) => {
      const query = spotlightInput.value.toLowerCase().trim();
      const filtered = SpotlightCommands.filter(cmd => {
        return cmd.name.toLowerCase().includes(query) || cmd.desc.toLowerCase().includes(query);
      });

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (filtered.length > 0) {
          spotlightUi.selectedIndex = (spotlightUi.selectedIndex + 1) % filtered.length;
          renderSpotlightResults();
          soundEngine.playClick();
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (filtered.length > 0) {
          spotlightUi.selectedIndex = (spotlightUi.selectedIndex - 1 + filtered.length) % filtered.length;
          renderSpotlightResults();
          soundEngine.playClick();
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filtered.length > 0 && spotlightUi.selectedIndex < filtered.length) {
          const targetCmd = filtered[spotlightUi.selectedIndex];
          toggleSpotlightModal(false);
          targetCmd.action();
        }
      }
    });

    spotlightInput.addEventListener('input', () => {
      spotlightUi.selectedIndex = 0;
      renderSpotlightResults();
    });
  }

  const spotlightModal = document.getElementById('spotlight-modal');
  if (spotlightModal) {
    spotlightModal.addEventListener('click', (e) => {
      if (e.target === spotlightModal) {
        toggleSpotlightModal(false);
      }
    });
  }

  // Theme Toggle Logic
  const btnThemeToggle = document.getElementById('btn-theme-toggle');
  const careerThemeSelect = document.getElementById('career-theme');

  function triggerChartThemeRedraw() {
    if (AppState.activeTab === 'job-detail' && AppState.activeJobId) {
      const activeJob = AppState.jobs.find(j => j.id === AppState.activeJobId);
      if (activeJob) {
        const jobCandidates = filterCandidatesByDateRange(AppState.candidates).filter(c => {
          if (getDataSource() === 'api' && activeJob._backend) {
            return c.jobId === activeJob.id;
          }
          return c.jobApplied === activeJob.roleName || c.jobApplied === activeJob.cardName;
        });
        drawFunnelSVG(activeJob, jobCandidates);
        drawScoreDistributionSVG(activeJob, jobCandidates);
      }
    }
  }
  
  if (btnThemeToggle) {
    const savedTheme = localStorage.getItem('IntervieHire-theme');
    const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    
    if (savedTheme === 'light' || (!savedTheme && prefersLight)) {
      document.body.classList.add('light-theme');
      if (careerThemeSelect) careerThemeSelect.value = 'light';
    } else {
      if (careerThemeSelect) careerThemeSelect.value = 'dark';
    }

    btnThemeToggle.addEventListener('click', () => {
      const isLight = document.body.classList.toggle('light-theme');
      const themeVal = isLight ? 'light' : 'dark';
      localStorage.setItem('IntervieHire-theme', themeVal);
      if (careerThemeSelect) {
        careerThemeSelect.value = themeVal;
      }
      triggerChartThemeRedraw();
      if (isLight) {
        soundEngine.playChime([329.63, 392.00, 523.25], 0.12, 0.1);
      } else {
        soundEngine.playChime([523.25, 392.00, 261.63], 0.12, 0.1);
      }
    });
  }

  if (careerThemeSelect) {
    careerThemeSelect.addEventListener('change', (e) => {
      const shouldBeLight = e.target.value === 'light';
      const isCurrentLight = document.body.classList.contains('light-theme');
      if (shouldBeLight !== isCurrentLight) {
        document.body.classList.toggle('light-theme', shouldBeLight);
        localStorage.setItem('IntervieHire-theme', shouldBeLight ? 'light' : 'dark');
        triggerChartThemeRedraw();
        if (shouldBeLight) {
          soundEngine.playChime([329.63, 392.00, 523.25], 0.12, 0.1);
        } else {
          soundEngine.playChime([523.25, 392.00, 261.63], 0.12, 0.1);
        }
      }
    });
  }

  // JD sub-tab switching
  document.querySelectorAll('.jd-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const tabId = tab.getAttribute('data-jd-tab');
      document.querySelectorAll('.jd-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.jd-pane').forEach(p => p.classList.remove('active'));
      const pane = document.getElementById(`jd-pane-${tabId}`);
      if (pane) pane.classList.add('active');
      // Reflect the stage in the URL so each tab is a deep-linkable route
      // (back/forward works). navigateToPath sees the same active tab and no-ops.
      if (AppState.activeJobId) pushUrl(jobStageUrl(AppState.activeJobId, tabId));
      soundEngine.playClick();
      
      // Stop any active card audio playing
      stopActiveCardPlayer();
      
      // Render detail panes if there is an active job
      if (AppState.activeJobId) {
        const job = AppState.jobs.find(j => j.id === AppState.activeJobId);
        if (job) {
          renderJobDetailPanes(job);
        }
      }
    });
  });

  // JD score type dropdown re-renders chart
  const jdScoreType = document.getElementById('jd-score-type');
  if (jdScoreType) {
    jdScoreType.addEventListener('change', () => {
      if (AppState.activeJobId) {
        const job = AppState.jobs.find(j => j.id === AppState.activeJobId);
        if (job) {
          const jobCandidates = AppState.candidates.filter(c => {
            if (getDataSource() === 'api' && job._backend) {
              return c.jobId === job.id;
            }
            return c.jobApplied === job.roleName || c.jobApplied === job.cardName;
          });
          drawScoreDistributionSVG(job, jobCandidates);
        }
      }
      soundEngine.playClick();
    });
  }

  // ==========================================
  // CREATE JOB PAGE BINDINGS
  // ==========================================

  // Lina "Start Creation" button
  const btnStartAria = document.getElementById('btn-start-aria-creation');
  if (btnStartAria) {
    btnStartAria.addEventListener('click', () => {
      soundEngine.playChime([392, 523.25, 659.25], 0.12, 0.1);
      navigateToAriaChat();
    });
  }

  // "No file? click here" toggles paste textarea
  const btnNoFile = document.getElementById('btn-no-file-click');
  if (btnNoFile) {
    btnNoFile.addEventListener('click', (e) => {
      e.preventDefault();
      const pasteArea = document.getElementById('create-jd-paste');
      const dropzone = document.getElementById('jd-dropzone');
      if (!pasteArea) return;
      const isShowing = pasteArea.style.display !== 'none';
      pasteArea.style.display = isShowing ? 'none' : 'block';
      if (dropzone) dropzone.style.display = isShowing ? 'flex' : 'none';
      btnNoFile.textContent = isShowing ? 'No file? click here' : 'Use file upload instead';
      if (!isShowing) { pasteArea.focus(); }
    });
  }

  // Dropzone file select
  const jdDropzone = document.getElementById('jd-dropzone');
  const jdFileInput = document.getElementById('jd-file-input');

  function handleCreateJobFile(file) {
    if (!file) return;
    createJobUpload.fileName = file.name;
    const preview = document.getElementById('dropzone-file-preview');
    if (preview) {
      preview.style.display = 'flex';
      preview.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
        <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${file.name}</span>
        <button class="dropzone-remove-btn" id="btn-dropzone-remove">×</button>
      `;
      document.getElementById('btn-dropzone-remove')?.addEventListener('click', (e) => {
        e.stopPropagation();
        createJobUpload.fileName = null;
        createJobUpload.text = null;
        createJobUpload.file = null;
        preview.style.display = 'none';
        preview.innerHTML = '';
        if (jdDropzone) jdDropzone.classList.remove('has-file');
        if (jdFileInput) jdFileInput.value = '';
        soundEngine.playClick();
      });
    }
    if (jdDropzone) jdDropzone.classList.add('has-file');
    createJobUpload.file = file;
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'txt') {
      const reader = new FileReader();
      reader.onload = (ev) => { createJobUpload.text = ev.target.result; };
      reader.onerror = () => { createJobUpload.text = null; };
      reader.readAsText(file);
    } else {
      createJobUpload.text = null;
    }
    soundEngine.playChime([523.25], 0.1, 0.08);
  }

  if (jdDropzone) {
    jdDropzone.addEventListener('click', () => jdFileInput?.click());
    jdDropzone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jdFileInput?.click(); }
    });
    jdDropzone.addEventListener('dragover', (e) => { e.preventDefault(); jdDropzone.classList.add('drag-over'); });
    jdDropzone.addEventListener('dragleave', () => jdDropzone.classList.remove('drag-over'));
    jdDropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      jdDropzone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) handleCreateJobFile(file);
    });
  }
  if (jdFileInput) {
    jdFileInput.addEventListener('change', () => {
      if (jdFileInput.files[0]) handleCreateJobFile(jdFileInput.files[0]);
    });
  }

  // Continue button — process file or pasted text with DeepSeek
  const btnContinue = document.getElementById('btn-create-job-continue');
  if (btnContinue) {
    btnContinue.addEventListener('click', async () => {
      const pasteArea = document.getElementById('create-jd-paste');
      const pastedText = (pasteArea && pasteArea.style.display !== 'none') ? pasteArea.value.trim() : '';
      let textToProcess = pastedText || createJobUpload.text;
      const sourceName = createJobUpload.fileName || 'pasted text';

      if (!textToProcess && !createJobUpload.file) {
        showPremiumToast("Upload a file or paste a job description first.", "error");
        return;
      }

      const originalHTML = btnContinue.innerHTML;
      btnContinue.disabled = true;

      if (!textToProcess && createJobUpload.file) {
        btnContinue.innerHTML = `<div class="spinner-mini" style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin-mini 0.6s linear infinite;margin-right:6px;vertical-align:middle;"></div> Reading file...`;
        try {
          const formData = new FormData();
          formData.append('file', createJobUpload.file);
          const parseResp = await fetch('/api/parse-file', { method: 'POST', body: formData });
          if (!parseResp.ok) throw new Error('Parse failed');
          const parseData = await parseResp.json();
          textToProcess = parseData.text;
          createJobUpload.text = parseData.text;
        } catch (e) {
          showPremiumToast("Failed to read file. Try pasting the text instead.", "error");
          btnContinue.disabled = false;
          btnContinue.innerHTML = originalHTML;
          return;
        }
      }

      if (!textToProcess) {
        showPremiumToast("Could not extract text from file. Try pasting it instead.", "error");
        btnContinue.disabled = false;
        btnContinue.innerHTML = originalHTML;
        return;
      }

      btnContinue.innerHTML = `<div class="spinner-mini" style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin-mini 0.6s linear infinite;margin-right:6px;vertical-align:middle;"></div> Processing...`;

      soundEngine.playChime([392, 440], 0.1, 0.1);

      const systemPrompt = `You are a job description parser. Extract structured job info from the provided text.
Return ONLY valid JSON:
{"roleName":"exact job title","cardName":"job title + brief context","experienceBand":"one of: ${EXPERIENCE_BANDS_PROMPT}","description":"clean 2-3 sentence professional job description"}`;

      try {
        const response = await callDeepSeekAPI([
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Parse this job description:\n\n${textToProcess.slice(0, 2500)}` }
        ], true);

        const parsed = parseAIJson(response);
        const jobDraft = {
          roleName: parsed.roleName,
          cardName: parsed.cardName || parsed.roleName,
          created: new Date().toLocaleString('en-US', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }),
          status: 'draft',
          customJobId: '-',
          experienceBand: parsed.experienceBand || 'Upto 2 Years',
          createdBy: globalThis.IH_USER_NAME || 'You',
          description: parsed.description || textToProcess.slice(0, 500),
          questions: [],
          pipeline: { total: 0, resume: 0, screening: 0, functional: 0 },
          pipelineConfig: { resumeAnalysis: { enabled: true }, recruiterScreening: { enabled: true }, functionalInterview: { enabled: true } },
        };
        // api mode: create on the backend first so the job (and the AI blueprint
        // generated below) persists; local mode keeps a local id.
        const newJob: any = isApiMode() ? await apiCreateJob(jobDraft) : { ...jobDraft, id: generateJobId() };
        AppState.jobs.unshift(newJob);
        saveStateToLocalStorage();

        btnContinue.innerHTML = `<div class="spinner-mini" style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin-mini 0.6s linear infinite;margin-right:6px;vertical-align:middle;"></div> Generating interview pipeline...`;

        await enrichJobWithAI(newJob, textToProcess);
        if (newJob._backend) {
          try { await apiPatchJobParameters(newJob.id, newJob); }
          catch (e) { console.warn('Job created but blueprint sync failed:', e); }
        }

        showPremiumToast(`Job "${parsed.roleName}" created with AI-generated pipeline.`, "success");
        soundEngine.playChime([329.63, 392, 523.25, 659.25], 0.2, 0.08);
        openJobFlowView(newJob.id, true);
      } catch (err) {
        console.error("Job creation from JD failed:", err);
        showPremiumToast("Failed to process job description. Check API status.", "error");
      } finally {
        // Always restore the button — on success we navigate away via
        // openJobFlowView but the (reused) button node must not stay stuck on
        // "Generating interview pipeline…" for the next job upload.
        btnContinue.disabled = false;
        btnContinue.innerHTML = originalHTML;
      }
    });
  }

  // Lina chat send button + Enter key
  const ariaChatInput = document.getElementById('aria-chat-input');
  const ariaSendBtn = document.getElementById('btn-aria-send');

  if (ariaSendBtn && ariaChatInput) {
    ariaSendBtn.addEventListener('click', () => sendAriaMessage(ariaChatInput.value));
    ariaChatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendAriaMessage(ariaChatInput.value);
      }
    });
  }

  // Initial Load Actions
  renderJobCards();

  // Initialize Crystal Glass Sliding Tab Pills
  initSlidingPills();

  // Initialize Sourcing and Mass Applicant Addition
  initSourcing();

  // Initialize Kanban Drag & Drop
  initKanbanDragAndDrop();

  // Candidates Search Filter on job details sub-panes
  const jdSearchInput = document.getElementById('jd-candidate-search');
  if (jdSearchInput) {
    jdSearchInput.addEventListener('input', () => {
      if (AppState.activeJobId) {
        const job = AppState.jobs.find(j => j.id === AppState.activeJobId);
        if (job) {
          renderJobDetailPanes(job);
        }
      }
    });
  }

  // Initialize Crystal Dashboard Animations
  if (document.querySelector('.scene')) {
    initCrystalAnimations();
  }
}


export { initMountBindings };
