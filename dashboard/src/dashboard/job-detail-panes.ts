import { document, requestAnimationFrame, setTimeout, signal } from "./runtime";
import { escapeHTML, sourceLabel } from "./escape";
import { saveStateToLocalStorage } from "./ai-api";
import { isApiMode, apiUploadResumes } from "./api";
import { renderDeepAnalysisPane } from "./deep-analysis";
import { drawFunnelSVG, drawScoreDistributionSVG } from "./funnel-charts";
import {
	openJobFlowView,
	renderFunnelInsights,
	renderFunnelStages,
} from "./job-flow";
import { stopActiveCardPlayer, toggleCardPlayer } from "./kanban-dnd";
import { recalculateJobPipelines, renderKanbanBoard } from "./kanban-swarm";
import { triggerExcelExport } from "./navigation";
import { renderBlueprintStudio } from "./blueprint-studio";
import { renderInterviewAnalysisStage } from "./interview-analysis";
import { renderTestInterviewPane } from "./test-interview";
import {
	filterCandidatesByDateRange,
	renderAnalyticsTable,
	renderJobCards,
	updateSummaryMetrics,
} from "./render-views";
import { openReportDrawerForCandidate } from "./report";
import { openCandidateReportPage } from "./report-page";
import {
	applyStageFilters,
	buildFilterDropdown,
	hasActiveFilters,
	openScheduleModal,
	renderResumeStagePaneForJob,
	toggleResumeCriteriaEdit,
	runBulkResumeAnalysis,
	formatSlot,
} from "./resume-analysis";
import { getCandidateSubtab } from "./interview-status";
import { renderScoringEditor } from "./scoring-config";
import { soundEngine } from "./sound";
import { showPremiumToast } from "./sourcing";
import { AppState } from "./state";
import { activeCandidateSubTabs } from "./vetting-data";
import {
	getDataSource,
	apiScheduleCandidate,
	apiUpdateApplicant,
	apiMoveApplicantStage,
	ensureBackendApplicantId,
	apiCreateInterviewInvite,
	apiSendInterviewInvite,
	apiListInterviewInvites,
	apiBulkInterviewInvites,
	apiDeleteApplicant,
	apiRestoreApplicant,
} from "./api";

// Stage-table row action menus (⋮) — same pattern as kanban-swarm.ts's
// closeAllKanbanKebabs/bindKanbanKebabOutsideClick for the Kanban board's
// per-card kebab, applied here to the Screening/Functional table rows.
function closeAllRowKebabs() {
	document.querySelectorAll(".row-kebab-dropdown.open").forEach((d) => d.classList.remove("open"));
	document.querySelectorAll(".stage-data-table tbody tr.kebab-open").forEach((row) => row.classList.remove("kebab-open"));
}

// Same signal-scoped one-time-bind pattern as kanban-swarm.ts's outside-click
// listener — survives re-renders (renderJobDetailPanes runs on every state
// change) without stacking a new document listener each time.
let rowKebabDocListenerSignal = null;
function bindRowKebabOutsideClick() {
	if (rowKebabDocListenerSignal === signal) return;
	rowKebabDocListenerSignal = signal;
	document.addEventListener("click", closeAllRowKebabs);
}

function renderJobDetailPanes(job) {
	const searchVal = document
		.getElementById("jd-candidate-search")
		.value.trim()
		.toLowerCase();

	const jobCandidates = filterCandidatesByDateRange(AppState.candidates).filter(
		(c) => {
			const matchesJob =
				getDataSource() === "api" && job._backend
					? c.jobId === job.id
					: c.jobApplied === job.roleName || c.jobApplied === job.cardName;
			if (!matchesJob) return false;
			if (searchVal) {
				return (
					c.name.toLowerCase().includes(searchVal) ||
					c.email.toLowerCase().includes(searchVal)
				);
			}
			return true;
		},
	);

	// 1. Resume pane — criteria config + candidates table
	const resumeList = document.getElementById("list-stage-resume");
	if (resumeList) {
		// Keep the full pipeline history visible here. The table's All / Advanced /
		// Rejected selector decides which rows to display; removing rejected rows at
		// this point made the Rejected view permanently empty. The per-row Advance
		// button is gated separately (rendered only when status === 'Resume').
		const resumeCands = jobCandidates;
		const criteria = job.resumeCriteria || {
			mustHave: [],
			redFlags: [],
			goodToHave: [],
			goodToHaveMinMatch: 1,
		};
		const addApplicantsHTML = buildAddApplicantsPanel(
			"resume",
			resumeCands.length,
		);

		const criteriaHTML = `
      <div class="ra-config-section">
        <div class="ra-config-header">
          <div class="ra-config-header-left">
            <h3 class="ra-config-title">Resume Analysis</h3>
            <p class="ra-config-subtitle">Parameters created based on your requirements — feel free to edit them</p>
          </div>
          <button class="btn-ra-edit-criteria" id="btn-ra-edit-criteria">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Edit
          </button>
        </div>

        <div class="ra-criteria-group must-have">
          <div class="ra-criteria-group-header">
            <span class="ra-criteria-icon must-have">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            </span>
            <div>
              <h4 class="ra-criteria-group-title must-have">Must Have</h4>
              <p class="ra-criteria-group-desc">Candidates meeting these criteria will be shortlisted; others waitlisted for review</p>
            </div>
          </div>
          <div class="ra-criteria-items">
            ${criteria.mustHave
							.map(
								(item, i) => `
              <div class="ra-criteria-item must-have">
                <span class="ra-criteria-num must-have">${i + 1}</span>
                <span class="ra-criteria-text">${item}</span>
              </div>
            `,
							)
							.join("")}
          </div>
        </div>

        <div class="ra-criteria-divider">
          <span class="ra-criteria-divider-text">AND</span>
        </div>

        <div class="ra-criteria-group red-flags">
          <div class="ra-criteria-group-header">
            <span class="ra-criteria-icon red-flags">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            </span>
            <div>
              <h4 class="ra-criteria-group-title red-flags">Should Not Have (Red Flags)</h4>
              <p class="ra-criteria-group-desc">Candidates with no red flags will be shortlisted; others waitlisted for review</p>
            </div>
          </div>
          <div class="ra-criteria-items">
            ${criteria.redFlags
							.map(
								(item, i) => `
              <div class="ra-criteria-item red-flags">
                <span class="ra-criteria-num red-flags">${i + 1}</span>
                <span class="ra-criteria-text">${item}</span>
              </div>
            `,
							)
							.join("")}
          </div>
        </div>

        <div class="ra-criteria-divider">
          <span class="ra-criteria-divider-text">AND</span>
        </div>

        <div class="ra-criteria-group good-to-have">
          <div class="ra-criteria-group-header">
            <span class="ra-criteria-icon good-to-have">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            </span>
            <div>
              <h4 class="ra-criteria-group-title good-to-have">Good To Have</h4>
              <p class="ra-criteria-group-desc">Candidates meeting the threshold will be shortlisted; others waitlisted for review.</p>
            </div>
          </div>
          <div class="ra-criteria-min-match">Minimum match: ${criteria.goodToHaveMinMatch} out of ${criteria.goodToHave.length} criteria</div>
          <div class="ra-criteria-items">
            ${criteria.goodToHave
							.map(
								(item, i) => `
              <div class="ra-criteria-item good-to-have">
                <span class="ra-criteria-num good-to-have">${i + 1}</span>
                <span class="ra-criteria-text">${item}</span>
              </div>
            `,
							)
							.join("")}
          </div>
        </div>
      </div>

      ${addApplicantsHTML}
      <div class="jd-stage-candidates-list" id="list-stage-resume-candidates" style="margin-top: -8px;"></div>
    `;

		resumeList.innerHTML = criteriaHTML;
		resumeList.querySelector(".ra-config-section")?.remove();
		resumeList.insertAdjacentHTML(
			"afterbegin",
			`
      <div class="ra-flow-redirect">
        <div>
          <h3 class="ra-candidates-title">Resume Analysis Candidates</h3>
          <p class="ra-flow-redirect-copy">Shortlist rules live in Job Flow so setup and evaluation stay separated.</p>
        </div>
        <button class="btn-jd-ghost" id="btn-resume-edit-flow">Edit Rules in Job Flow</button>
      </div>
      <div id="ra-scoring-editor-root"></div>
    `,
		);
		document
			.getElementById("btn-resume-edit-flow")
			?.addEventListener("click", () => {
				openJobFlowView(job.id);
				requestAnimationFrame(() => {
					document
						.querySelector('.jf-stage-card[data-stage="resumeAnalysis"]')
						?.click();
				});
			});

		const scoringRoot = document.getElementById("ra-scoring-editor-root");
		if (scoringRoot) renderScoringEditor(job, scoringRoot);

		const resumeCandContainer = document.getElementById(
			"list-stage-resume-candidates",
		);
		if (resumeCandContainer) {
			if (resumeCands.length === 0) {
				resumeCandContainer.innerHTML = `
          <div class="jd-empty-pane">
            <svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-faint)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
            <p>No candidates in resume analysis stage yet</p>
          </div>
        `;
			} else {
				renderResumeStagePaneForJob(resumeCands, job, resumeCandContainer);
			}
		}

		// Edit criteria button
		const editBtn = document.getElementById("btn-ra-edit-criteria");
		if (editBtn) {
			editBtn.addEventListener("click", () => {
				toggleResumeCriteriaEdit(job);
			});
		}
	}

	// 2. Screening pane
	const screeningList = document.getElementById("list-stage-screening");
	if (screeningList) {
		const screeningCands = jobCandidates.filter(
			(c) => c.status === "Screening",
		);
		const addApplicantsHTML = buildAddApplicantsPanel(
			"screening",
			screeningCands.length,
		);

		const counts = {
			"awaiting-schedule": 0,
			"window-missed": 0,
			scheduled: 0,
			"partially-completed": 0,
			completed: 0,
		};
		screeningCands.forEach((c) => {
			counts[getCandidateSubtab(c, "screening")]++;
		});

		const activeSubtab = getOrInitActiveSubtab("screening", screeningCands);
		const subtabsHTML = buildSubtabsBarHTML("screening", counts, activeSubtab);

		if (screeningCands.length === 0) {
			screeningList.innerHTML = `
        ${addApplicantsHTML}
        ${subtabsHTML}
        <div class="jd-empty-pane">
          <svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-faint)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>
          <p>Recruiter Screening — No candidates in this stage</p>
        </div>
      `;
		} else {
			const allScreeningCands = screeningCands;
			const subtabFilteredCands = screeningCands.filter(
				(c) => getCandidateSubtab(c, "screening") === activeSubtab,
			);
			const displayScreeningCands = applyStageFilters(
				subtabFilteredCands,
				"screening",
			);
			const sf = AppState.stageFilters.screening;
			screeningList.innerHTML = `
        ${addApplicantsHTML}
        ${subtabsHTML}
        <div class="stage-table-container">
          <div class="stage-table-filters">
            <span class="filter-chip" data-filter="interviewStatus" data-stage="screening">${sf.interviewStatus.length ? "⊗" : "⊕"} Interview Status ${sf.interviewStatus.length ? `<span class="filter-chip-val">${sf.interviewStatus.join(", ")}</span>` : ""}</span>
            <span class="filter-chip" data-filter="cheatProb" data-stage="screening">${sf.cheatProb.length ? "⊗" : "⊕"} Cheat Probability ${sf.cheatProb.length ? `<span class="filter-chip-val">${sf.cheatProb.join(", ")}</span>` : ""}</span>
            <span class="filter-chip" data-filter="recruiterScreening" data-stage="screening">⊕ Recruiter Screening ${sf.recruiterScreening.length ? `<span class="filter-chip-val">${sf.recruiterScreening.join(", ")}</span>` : ""}</span>
            <span class="filter-chip" data-filter="interviewScore" data-stage="screening">⊕ Interview Score</span>
            ${hasActiveFilters("screening") ? '<button class="btn-filter-reset" data-stage="screening">✕ Reset</button>' : ""}
            <div class="stage-table-actions-bar">
              <button class="btn-bulk-actions">Bulk Actions <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg></button>
              <button class="btn-columns-toggle"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line><line x1="15" y1="3" x2="15" y2="21"></line></svg> Columns</button>
              <button class="btn-export-table"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> Export</button>
            </div>
          </div>
          <table class="stage-data-table">
            <thead>
              <tr>
                <th><input type="checkbox" class="table-checkbox-all" /></th>
                <th>Candidate</th>
                <th>Phone</th>
                <th>Status</th>
                <th>Screening</th>
                <th>Score <span class="sort-arrows">⇅</span></th>
                <th>Report</th>
                <th>Source</th>
                <th>Attempted <span class="sort-arrows">⇅</span></th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${displayScreeningCands.length === 0 ? '<tr><td colspan="10" style="text-align:center;padding:24px;color:var(--color-text-faint);">No candidates match the current filters. Try resetting or adjusting them.</td></tr>' : ""}
              ${displayScreeningCands
								.map((c) => {
									const initials = c.name
										.split(" ")
										.map((n) => n[0])
										.join("");
									// Screening-pane row: every field below must read screeningStatus,
									// not interviewStatus (which is the functional-stage status — always
									// null while a candidate is still in Screening, which is exactly the
									// bug that made every screening candidate look identical here).
									const hasReport =
										c.screeningStatus === "Incomplete" ||
										c.screeningStatus === "Completed";
									const sourceIcon =
										c.source === "Direct Link"
											? '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>'
											: '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line></svg>';
									const actionLabel =
										c.screeningStatus === "Slot Missed"
											? "Reschedule"
											: "Schedule";
									const actionClass =
										c.screeningStatus === "Slot Missed"
											? "btn-reschedule"
											: "btn-schedule";
									return `
                  <tr data-candidate-id="${c.id}">
                    <td><input type="checkbox" class="table-checkbox-row" /></td>
                    <td>
                      <div class="table-candidate-cell">
                        <span class="cand-name-link">${escapeHTML(c.name)} <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg></span>
                        <button class="btn-remarks" data-cand-id="${c.id}">Remarks</button>
                        <span class="cand-email-sub">${escapeHTML(c.email)}</span>
                      </div>
                    </td>
                    <td>${c.phone ? escapeHTML(c.phone) : "—"}</td>
                    <td>${interviewStatusChip(c.screeningStatus)}</td>
                    <td>${c.recruiterScreening ? escapeHTML(c.recruiterScreening) : "—"}</td>
                    <td>${(c.recruiterScreeningScore ?? c.screeningScore) != null ? escapeHTML(String(c.recruiterScreeningScore ?? c.screeningScore)) : "—"}</td>
                    <td>${hasReport ? `<a href="#" class="report-link" data-cand-id="${c.id}">Report <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg></a>` : "—"}</td>
                    <td><span class="source-badge">${sourceIcon} ${c.source || "—"}</span></td>
                    <td>${formatSlot(c.attemptedAt) || "—"}</td>
                    <td>
                      <div class="stage-row-actions">
                        <button class="${actionClass}" data-candidate-id="${c.id}">${c.screeningStatus === "Slot Missed" ? '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg> ' : '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line></svg> '}${actionLabel}</button>
                        ${c.decision === 'rejected'
                          ? `<span class="ra-stage-tag rejected">Rejected</span>`
                          : c.decision === 'on_hold'
                            ? `<span class="ra-stage-tag on-hold">On Hold</span>`
                            : ''}
                        <div class="row-kebab-wrap">
                          <button class="btn-row-kebab" data-candidate-id="${c.id}" title="More actions" aria-label="More actions">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
                          </button>
                          <div class="job-kebab-dropdown row-kebab-dropdown">
                            ${c.decision === 'rejected'
                              ? `<button class="kebab-item btn-stage-unreject" data-candidate-id="${c.id}">Restore to pipeline</button>
                                 <div class="kebab-divider"></div>
                                 <button class="kebab-item kebab-item-danger btn-stage-delete" data-candidate-id="${c.id}">Delete</button>`
                              : c.decision === 'on_hold'
                                ? `<button class="kebab-item btn-stage-unhold" data-candidate-id="${c.id}">Resume review</button>
                                   <div class="kebab-divider"></div>
                                   <button class="kebab-item kebab-item-danger btn-stage-delete" data-candidate-id="${c.id}">Delete</button>`
                                : `<button class="kebab-item btn-stage-advance" data-candidate-id="${c.id}" data-next-stage="Functional">Advance</button>
                                   <button class="kebab-item btn-stage-hold" data-candidate-id="${c.id}">Hold</button>
                                   <button class="kebab-item btn-stage-reject" data-candidate-id="${c.id}">Reject</button>
                                   <div class="kebab-divider"></div>
                                   <button class="kebab-item kebab-item-danger btn-stage-delete" data-candidate-id="${c.id}">Delete</button>`}
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                `;
								})
								.join("")}
            </tbody>
          </table>
          <div class="stage-table-footer">
            <span class="table-selection-info">0 of ${displayScreeningCands.length} row(s) selected.</span>
            <div class="table-pagination">
              <span>Rows per page</span>
              <select class="rows-per-page"><option value="10">10</option><option value="25" selected>25</option><option value="50">50</option><option value="100">100</option></select>
              <span>Page 1 of 1</span>
              <div class="pagination-btns">
                <button disabled>«</button><button disabled>‹</button><button disabled>›</button><button disabled>»</button>
              </div>
            </div>
          </div>
        </div>
      `;
		}
	}

	// 3. Functional pane
	const functionalList = document.getElementById("list-stage-functional");
	if (functionalList) {
		const functionalCands = jobCandidates.filter(
			(c) => c.status === "Functional",
		);
		const addApplicantsFnHTML = buildAddApplicantsPanel(
			"functional",
			functionalCands.length,
		);

		const countsFn = {
			"awaiting-schedule": 0,
			"window-missed": 0,
			scheduled: 0,
			"partially-completed": 0,
			completed: 0,
		};
		functionalCands.forEach((c) => {
			countsFn[getCandidateSubtab(c, "functional")]++;
		});

		const activeSubtabFn = getOrInitActiveSubtab("functional", functionalCands);
		const subtabsFnHTML = buildSubtabsBarHTML(
			"functional",
			countsFn,
			activeSubtabFn,
		);

		if (functionalCands.length === 0) {
			functionalList.innerHTML = `
        ${addApplicantsFnHTML}
        ${subtabsFnHTML}
        <div class="jd-empty-pane">
          <svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-faint)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line><line x1="15" y1="3" x2="15" y2="21"></line></svg>
          <p>Functional Interview — No candidates in this stage</p>
        </div>
      `;
		} else {
			const cheatColor = (prob) => {
				if (prob === "Low") return "cheat-low";
				if (prob === "Medium") return "cheat-medium";
				if (prob === "High") return "cheat-high";
				return "";
			};
			const scoreColor = (score) => {
				if (score == null) return "";
				if (score >= 80) return "score-green";
				if (score >= 60) return "score-yellow";
				return "score-red";
			};
			const screeningBadge = (val) => {
				if (!val) return "—";
				const cls =
					val === "Good fit"
						? "fit-good"
						: val === "Moderate fit"
							? "fit-moderate"
							: "fit-poor";
				return `<span class="screening-fit-badge ${cls}">${val}</span>`;
			};

			const allFunctionalCands = functionalCands;
			const subtabFilteredFnCands = functionalCands.filter(
				(c) => getCandidateSubtab(c, "functional") === activeSubtabFn,
			);
			const displayFunctionalCands = applyStageFilters(
				subtabFilteredFnCands,
				"functional",
			);
			const ff = AppState.stageFilters.functional;
			functionalList.innerHTML = `
        ${addApplicantsFnHTML}
        ${subtabsFnHTML}
        <div class="stage-table-container">
          <div class="stage-table-filters">
            <span class="filter-chip" data-filter="interviewStatus" data-stage="functional">${ff.interviewStatus.length ? "⊗" : "⊕"} Interview Status ${ff.interviewStatus.length ? `<span class="filter-chip-val">${ff.interviewStatus.join(", ")}</span>` : ""}</span>
            <span class="filter-chip" data-filter="cheatProb" data-stage="functional">${ff.cheatProb.length ? "⊗" : "⊕"} Cheat Probability ${ff.cheatProb.length ? `<span class="filter-chip-val">${ff.cheatProb.join(", ")}</span>` : ""}</span>
            <span class="filter-chip" data-filter="interviewScore" data-stage="functional">⊕ Interview Score</span>
            <span class="filter-chip" data-filter="recruiterScreening" data-stage="functional">⊕ Recruiter Screening ${ff.recruiterScreening.length ? `<span class="filter-chip-val">${ff.recruiterScreening.join(", ")}</span>` : ""}</span>
            <span class="filter-chip" data-filter="actions" data-stage="functional">⊕ Actions</span>
            ${hasActiveFilters("functional") ? '<button class="btn-filter-reset" data-stage="functional">✕ Reset</button>' : ""}
            <div class="stage-table-actions-bar">
              <button class="btn-bulk-actions">Bulk Reschedule <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg></button>
              <button class="btn-columns-toggle"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line><line x1="15" y1="3" x2="15" y2="21"></line></svg> Columns</button>
              <button class="btn-export-table"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> Export</button>
            </div>
          </div>
          <table class="stage-data-table">
            <thead>
              <tr>
                <th><input type="checkbox" class="table-checkbox-all" /></th>
                <th>Candidate</th>
                <th>Phone</th>
                <th>Status</th>
                <th>Report</th>
                <th>Score <span class="sort-arrows">⇅</span></th>
                <th>Cheat <span class="sort-arrows">⇅</span></th>
                <th>Source</th>
                <th>Screening</th>
                <th>Attempted <span class="sort-arrows">⇅</span></th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${displayFunctionalCands.length === 0 ? '<tr><td colspan="11" style="text-align:center;padding:24px;color:var(--color-text-faint);">No candidates match the current filters. Try resetting or adjusting them.</td></tr>' : ""}
              ${displayFunctionalCands
								.map((c) => {
									const initials = c.name
										.split(" ")
										.map((n) => n[0])
										.join("");
									const sourceIcon =
										c.source === "Direct Link"
											? '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>'
											: '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line></svg>';
									const actionLabel =
										c.interviewStatus === "Slot Missed"
											? "Reschedule"
											: "Schedule";
									const actionClass =
										c.interviewStatus === "Slot Missed"
											? "btn-reschedule"
											: "btn-schedule";
									return `
                  <tr data-candidate-id="${c.id}">
                    <td><input type="checkbox" class="table-checkbox-row" /></td>
                    <td>
                      <div class="table-candidate-cell">
                        <span class="cand-name-link">${escapeHTML(c.name)} <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg></span>
                        <button class="btn-remarks" data-cand-id="${c.id}">Remarks</button>
                        <span class="cand-email-sub">${escapeHTML(c.email)}</span>
                      </div>
                    </td>
                    <td>${c.phone ? escapeHTML(c.phone) : "—"}</td>
                    <td>${interviewStatusChip(c.interviewStatus)}</td>
                    <td><a href="#" class="report-link report-new" data-cand-id="${c.id}">Report <span class="new-badge">New</span> <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg></a></td>
                    <td><span class="interview-score-dot ${scoreColor(c.interviewScore)}"></span> ${c.interviewScore != null ? c.interviewScore : "—"}</td>
                    <td><span class="cheat-prob-badge ${cheatColor(c.cheatProbability)}">${c.cheatProbability ? '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg> ' + c.cheatProbability : "—"}</span></td>
                    <td><span class="source-badge">${sourceIcon} ${c.source || "—"}</span></td>
                    <td>${screeningBadge(c.recruiterScreening)}</td>
                    <td>${c.interviewStatus ? escapeHTML(c.interviewStatus) : "—"}</td>
                    <td>
                      <div class="stage-row-actions">
                        <button class="${actionClass}" data-candidate-id="${c.id}">${c.interviewStatus === "Slot Missed" ? '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg> ' : '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line></svg> '}${actionLabel}</button>
                        ${c.decision === 'rejected'
                          ? `<span class="ra-stage-tag rejected">Rejected</span>`
                          : c.decision === 'on_hold'
                            ? `<span class="ra-stage-tag on-hold">On Hold</span>`
                            : ''}
                        <div class="row-kebab-wrap">
                          <button class="btn-row-kebab" data-candidate-id="${c.id}" title="More actions" aria-label="More actions">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
                          </button>
                          <div class="job-kebab-dropdown row-kebab-dropdown">
                            ${c.decision === 'rejected'
                              ? `<button class="kebab-item btn-stage-unreject" data-candidate-id="${c.id}">Restore to pipeline</button>
                                 <div class="kebab-divider"></div>
                                 <button class="kebab-item kebab-item-danger btn-stage-delete" data-candidate-id="${c.id}">Delete</button>`
                              : c.decision === 'on_hold'
                                ? `<button class="kebab-item btn-stage-unhold" data-candidate-id="${c.id}">Resume review</button>
                                   <div class="kebab-divider"></div>
                                   <button class="kebab-item kebab-item-danger btn-stage-delete" data-candidate-id="${c.id}">Delete</button>`
                                : `<button class="kebab-item btn-stage-advance" data-candidate-id="${c.id}" data-next-stage="Hired">Advance</button>
                                   <button class="kebab-item btn-stage-hold" data-candidate-id="${c.id}">Hold</button>
                                   <button class="kebab-item btn-stage-reject" data-candidate-id="${c.id}">Reject</button>
                                   <div class="kebab-divider"></div>
                                   <button class="kebab-item kebab-item-danger btn-stage-delete" data-candidate-id="${c.id}">Delete</button>`}
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                `;
								})
								.join("")}
            </tbody>
          </table>
          <div class="stage-table-footer">
            <span class="table-selection-info">0 of ${displayFunctionalCands.length} row(s) selected.</span>
            <div class="table-pagination">
              <span>Rows per page</span>
              <select class="rows-per-page"><option value="10">10</option><option value="25" selected>25</option><option value="50">50</option><option value="100">100</option></select>
              <span>Page 1 of 1</span>
              <div class="pagination-btns">
                <button disabled>«</button><button disabled>‹</button><button disabled>›</button><button disabled>»</button>
              </div>
            </div>
          </div>
        </div>
      `;
		}
	}

	// 4. Deep Analysis pane
	const analysisList = document.getElementById("list-stage-analysis");
	if (analysisList) {
		renderDeepAnalysisPane(job, analysisList);
	}

	// 4b. Interview Analysis pane — job-level listing of saved AI interview reports.
	const interviewAnalysisList = document.getElementById(
		"list-stage-interviewanalysis",
	);
	if (interviewAnalysisList) {
		renderInterviewAnalysisStage(job, interviewAnalysisList);
	}

	// Bind actions
	const pane = document.getElementById("view-job-detail");
	if (pane) {
		pane.querySelectorAll(".stage-subtab-btn").forEach((btn) => {
			btn.addEventListener("click", () => {
				soundEngine.playClick();
				const stage = btn.getAttribute("data-stage");
				const subtab = btn.getAttribute("data-subtab");
				const stateKey =
					stage === "screening"
						? "activeScreeningSubtab"
						: "activeFunctionalSubtab";
				AppState[stateKey] = subtab;
				renderJobDetailPanes(job);
			});
		});

		pane.querySelectorAll(".subtab-btn").forEach((btn) => {
			btn.addEventListener("click", () => {
				const candId = btn.parentElement.getAttribute("data-cand-id");
				const tabName = btn.getAttribute("data-tab");

				// Stop audio playing if swapping tabs
				stopActiveCardPlayer();

				activeCandidateSubTabs[candId] = tabName;
				soundEngine.playClick();
				renderJobDetailPanes(job);
			});
		});

		pane.querySelectorAll(".btn-stage-reject").forEach((btn) => {
			btn.addEventListener("click", () => {
				const candId = btn.getAttribute("data-candidate-id");
				updateCandidateStatus(candId, "Rejected");
			});
		});

		pane.querySelectorAll(".btn-stage-delete").forEach((btn) => {
			btn.addEventListener("click", () => {
				const candId = btn.getAttribute("data-candidate-id");
				deleteCandidate(candId);
			});
		});

		pane.querySelectorAll(".btn-stage-advance").forEach((btn) => {
			btn.addEventListener("click", () => {
				const candId = btn.getAttribute("data-candidate-id");
				const nextStage = btn.getAttribute("data-next-stage");
				updateCandidateStatus(candId, nextStage);
			});
		});

		// Hold/Resume-review only ever touch `decision` (matching report-page.ts's
		// rp-decision select), never `status` — a held candidate stays "Resume"
		// stage-wise, just parked, so it doesn't need a new status value threaded
		// through every place that already switches on candidate.status.
		pane.querySelectorAll(".btn-stage-hold").forEach((btn) => {
			btn.addEventListener("click", () => setCandidateHold(btn.getAttribute("data-candidate-id"), true));
		});
		pane.querySelectorAll(".btn-stage-unhold").forEach((btn) => {
			btn.addEventListener("click", () => setCandidateHold(btn.getAttribute("data-candidate-id"), false));
		});
		pane.querySelectorAll(".btn-stage-unreject").forEach((btn) => {
			btn.addEventListener("click", () => restoreCandidateFromRejection(btn.getAttribute("data-candidate-id")));
		});

		// Stage-table row actions (⋮) — Advance/Hold/Reject/Delete/Restore/Resume
		// review live behind this menu now (see .stage-row-actions in
		// 19-stage-table.css); same open/close-on-outside-click behavior as the
		// Kanban board's per-card kebab (kanban-swarm.ts).
		pane.querySelectorAll(".btn-row-kebab").forEach((btn) => {
			btn.addEventListener("click", (e) => {
				e.stopPropagation();
				const dropdown = btn.nextElementSibling;
				const wasOpen = dropdown.classList.contains("open");
				closeAllRowKebabs();
				if (!wasOpen) {
					dropdown.classList.add("open");
					btn.closest("tr")?.classList.add("kebab-open");
				}
			});
		});
		pane.querySelectorAll(".row-kebab-dropdown").forEach((dropdown) => {
			// Runs after the individual .btn-stage-* handler above (target phase
			// fires first, then this ancestor's bubble-phase listener) — closes the
			// menu once whatever action was clicked has already been dispatched.
			dropdown.addEventListener("click", () => closeAllRowKebabs());
		});
		bindRowKebabOutsideClick();

		pane.querySelectorAll(".btn-player-play").forEach((btn) => {
			btn.addEventListener("click", () => {
				const candId = btn.getAttribute("data-play-id");
				toggleCardPlayer(candId);
			});
		});

		pane.querySelectorAll(".report-link").forEach((link) => {
			link.addEventListener("click", (e) => {
				e.preventDefault();
				const candId = link.getAttribute("data-cand-id");
				openReportDrawerForCandidate(candId);
			});
		});

		pane.querySelectorAll(".btn-remarks").forEach((btn) => {
			btn.addEventListener("click", () => {
				const candId =
					btn.getAttribute("data-cand-id") ||
					btn.closest("tr")?.dataset.candidateId;
				if (candId) openCandidateReportPage(candId, "remarks");
			});
		});

		pane.querySelectorAll(".table-checkbox-all").forEach((cb) => {
			cb.addEventListener("change", () => {
				const table = cb.closest("table");
				const rows = table.querySelectorAll(".table-checkbox-row");
				rows.forEach((r) => {
					r.checked = cb.checked;
				});
				const info = cb
					.closest(".stage-table-container")
					.querySelector(".table-selection-info");
				if (info)
					info.textContent = `${cb.checked ? rows.length : 0} of ${rows.length} row(s) selected.`;
				soundEngine.playClick();
			});
		});

		pane.querySelectorAll(".table-checkbox-row").forEach((cb) => {
			cb.addEventListener("change", () => {
				const table = cb.closest("table");
				const rows = table.querySelectorAll(".table-checkbox-row");
				const checked = table.querySelectorAll(
					".table-checkbox-row:checked",
				).length;
				const info = cb
					.closest(".stage-table-container")
					.querySelector(".table-selection-info");
				if (info)
					info.textContent = `${checked} of ${rows.length} row(s) selected.`;
			});
		});

		const jobCands = AppState.candidates.filter((c) => {
			if (getDataSource() === "api" && job._backend) {
				return c.jobId === job.id;
			}
			return c.jobApplied === job.roleName || c.jobApplied === job.cardName;
		});
		const stageStatusMap = { screening: "Screening", functional: "Functional" };
		pane.querySelectorAll(".filter-chip[data-filter]").forEach((chip) => {
			chip.addEventListener("click", (e) => {
				e.stopPropagation();
				soundEngine.playClick();
				const filterType = chip.getAttribute("data-filter");
				const stageKey = chip.getAttribute("data-stage");
				const stageStatus = stageStatusMap[stageKey];
				const stageCands = stageStatus
					? jobCands.filter((c) => c.status === stageStatus)
					: jobCands;
				buildFilterDropdown(chip, filterType, stageCands, stageKey);
			});
		});

		pane.querySelectorAll(".btn-filter-reset").forEach((btn) => {
			btn.addEventListener("click", () => {
				soundEngine.playClick();
				const stageKey = btn.getAttribute("data-stage");
				if (stageKey && AppState.stageFilters[stageKey]) {
					AppState.stageFilters[stageKey] = {
						interviewStatus: [],
						cheatProb: [],
						recruiterScreening: [],
						scoreMin: null,
						scoreMax: null,
						actions: [],
					};
					renderJobDetailPanes(job);
				}
			});
		});

		pane.querySelectorAll(".btn-bulk-actions").forEach((btn) => {
			btn.addEventListener("click", (e) => {
				e.stopPropagation();
				soundEngine.playClick();
				const existing = btn.parentElement.querySelector(
					".bulk-actions-dropdown",
				);
				if (existing) {
					existing.remove();
					return;
				}
				document
					.querySelectorAll(".bulk-actions-dropdown")
					.forEach((d) => d.remove());

				const container = btn.closest(".stage-table-container");
				const checked =
					container?.querySelectorAll(".table-checkbox-row:checked") || [];

				const getSelected = () => {
					const ids = [],
						names = [];
					checked.forEach((cb) => {
						const row = cb.closest("tr");
						const cid = row?.getAttribute("data-candidate-id");
						const name = row
							?.querySelector(".cand-name-link")
							?.textContent?.trim();
						if (cid) ids.push(cid);
						if (name) names.push(name);
					});
					return { ids, names };
				};

				const dd = document.createElement("div");
				dd.className = "bulk-actions-dropdown";
				const isResumeStage =
					container && !!container.querySelector(".ra-data-table");
				if (isResumeStage) {
					dd.innerHTML = `
            <button class="bulk-dd-item" data-action="analyse"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg> Analyse</button>
            <button class="bulk-dd-item" data-action="reanalyse"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg> Reanalyse</button>
            <button class="bulk-dd-item" data-action="advance"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg> Advance</button>
            <button class="bulk-dd-item" data-action="reject"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg> Reject</button>
            <button class="bulk-dd-item" data-action="restore"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg> Restore</button>
            <button class="bulk-dd-item" data-action="export"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> Export</button>`;
				} else {
					dd.innerHTML = `
            <button class="bulk-dd-item" data-action="advance"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg> Advance</button>
            <button class="bulk-dd-item" data-action="reject"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg> Reject</button>
            <button class="bulk-dd-item" data-action="restore"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg> Restore</button>
            <button class="bulk-dd-item" data-action="schedule"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line></svg> Schedule</button>
            <button class="bulk-dd-item" data-action="reschedule"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg> Reschedule</button>
            <button class="bulk-dd-item" data-action="export"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> Export</button>`;
				}
				dd.addEventListener("click", async (ev) => {
					ev.stopPropagation();
					const item = ev.target.closest(".bulk-dd-item");
					if (!item) return;
					const action = item.getAttribute("data-action");
					const { ids, names } = getSelected();
					if (ids.length === 0 && action !== "export") {
						showPremiumToast(
							"Select candidates using checkboxes first.",
							"info",
						);
						dd.remove();
						return;
					}
					const label =
						names.length <= 3
							? names.join(", ")
							: `${names.slice(0, 2).join(", ")} +${names.length - 2} more`;
					if (action === "analyse") {
						dd.remove();
						showPremiumToast(`Analysing ${ids.length} candidate(s)...`, "info");
						runBulkResumeAnalysis(ids, job);
						return;
					}
					if (action === "reanalyse") {
						dd.remove();
						showPremiumToast(
							`Reanalysing ${ids.length} candidate(s)...`,
							"info",
						);
						runBulkResumeAnalysis(ids, job, { force: true });
						return;
					}
					if (action === "advance") {
						const stages = ["Resume", "Screening", "Functional", "Hired"];
						const syncs = [];
						// On the Resume Analysis table only genuine Resume-stage rows may be
						// advanced. Candidates already in Screening/Functional/Hired now also
						// render here (table shows all-except-Rejected), so bulk-advance must
						// skip them rather than over-advance. Other panes keep generic progression.
						let advanceIds = ids;
						if (isResumeStage) {
							advanceIds = ids.filter((cid) => {
								const c = AppState.candidates.find((x) => x.id === cid);
								return c && c.status === "Resume";
							});
							const skipped = ids.length - advanceIds.length;
							if (skipped > 0) {
								showPremiumToast(
									`${skipped} candidate(s) already past Resume Analysis were skipped.`,
									"info",
								);
							}
							if (advanceIds.length === 0) {
								dd.remove();
								return;
							}
						}
						advanceIds.forEach((cid) => {
							const cand = AppState.candidates.find((c) => c.id === cid);
							if (cand) {
								const idx = stages.indexOf(cand.status);
								if (idx < stages.length - 1) {
									const next = stages[idx + 1];
									const keep = {
										jobApplied: cand.jobApplied,
										jobId: cand.jobId,
										registeredOn: cand.registeredOn,
									};
									cand.status = next as any;
									if (
										(next === "Screening" || next === "Functional") &&
										cand.interviewStatus == null
									) {
										cand.interviewStatus = "Not Started";
									}
									if (cand._backend && getDataSource() === "api") {
										syncs.push(
											apiMoveApplicantStage(cand.backendId || cid, next).then(
												(updated) => {
													if (updated) {
														Object.assign(cand, updated);
														if (keep.jobApplied)
															cand.jobApplied = keep.jobApplied;
														if (keep.jobId) cand.jobId = keep.jobId;
														if (keep.registeredOn)
															cand.registeredOn = keep.registeredOn;
													}
												},
											),
										);
									}
								}
							}
						});
						if (syncs.length) {
							try {
								await Promise.all(syncs);
							} catch (err) {
								console.warn("Stage change sync failed:", err);
								showPremiumToast(
									"Some stage changes did not sync to the backend.",
									"error",
								);
							}
						}
						saveStateToLocalStorage();
						refreshAfterStageChange();
						showPremiumToast(
							`Advanced ${advanceIds.length} candidate(s) to next stage.`,
							"success",
						);
					} else if (action === "reject") {
						ids.forEach((cid) => {
							const cand = AppState.candidates.find((c) => c.id === cid);
							if (cand) {
								cand.status = "Rejected";
								if (cand._backend && getDataSource() === "api") {
									apiUpdateApplicant(cid, { decision: "rejected" }).catch(
										(err) => {
											console.warn("Reject sync failed:", err);
										},
									);
								}
							}
						});
						saveStateToLocalStorage();
						refreshAfterStageChange();
						showPremiumToast(`Rejected ${ids.length} candidate(s).`, "success");
					} else if (action === "restore") {
						ids.forEach((cid) => restoreCandidateFromRejection(cid));
						dd.remove();
						showPremiumToast(`Restored ${ids.length} candidate(s).`, "success");
					} else if (action === "schedule" || action === "reschedule") {
						openScheduleModal(
							{ mode: action, name: label, count: ids.length },
							async ({ start, end, timezone, slot }) => {
								if (getDataSource() === "api") {
									showPremiumToast(
										`Scheduling ${ids.length} candidate(s) and sending email invites...`,
										"info",
									);
									try {
										const utcIso = new Date(start).toISOString();
										await Promise.all(
											ids.map(async (cid) => {
												const c2 = AppState.candidates.find(
													(c) => c.id === cid,
												);
												if (!c2) return;
												const stage =
													c2.status?.toLowerCase() === "screening"
														? "screening"
														: "functional";
												const scheduleId = await ensureBackendApplicantId(
													c2,
													job.id,
												);
												const updated = await apiScheduleCandidate(
													scheduleId,
													utcIso,
													stage,
												);
												if (updated) {
													Object.assign(c2, updated);
												} else {
													c2.attemptedAt = slot;
													c2.scheduledWindow = { start, end, timezone };
													c2.interviewStatus =
														action === "reschedule"
															? "Incomplete"
															: "Not Started";
												}
											}),
										);
										saveStateToLocalStorage();
										renderJobDetailPanes(job);
										showPremiumToast(
											`${action === "schedule" ? "Scheduled" : "Rescheduled"} ${ids.length} candidate(s) for ${slot} and email invites sent.`,
											"success",
										);
									} catch (err) {
										showPremiumToast(
											`Failed to schedule candidates: ${err.message || err}`,
											"error",
										);
									}
								} else {
									ids.forEach((cid) => {
										const cand = AppState.candidates.find((c) => c.id === cid);
										if (cand) {
											cand.attemptedAt = slot;
											cand.scheduledWindow = { start, end, timezone };
											cand.interviewStatus =
												action === "reschedule" ? "Incomplete" : "Not Started";
										}
									});
									saveStateToLocalStorage();
									renderJobDetailPanes(job);
									showPremiumToast(
										`${action === "schedule" ? "Scheduled" : "Rescheduled"} ${ids.length} candidate(s) for ${slot}.`,
										"success",
									);
								}
							},
						);
					} else if (action === "export") {
						triggerExcelExport("candidates");
					}
					dd.remove();
				});
				btn.style.position = "relative";
				btn.appendChild(dd);
				const closeDD = (ev) => {
					if (!dd.contains(ev.target) && ev.target !== btn) {
						dd.remove();
						document.removeEventListener("click", closeDD);
					}
				};
				setTimeout(() => document.addEventListener("click", closeDD), 0);
			});
		});

		pane.querySelectorAll(".btn-export-table").forEach((btn) => {
			btn.addEventListener("click", () => {
				soundEngine.playClick();
				triggerExcelExport("candidates");
			});
		});

		pane.querySelectorAll(".btn-reschedule, .btn-schedule").forEach((btn) => {
			btn.addEventListener("click", (e) => {
				e.stopPropagation();
				soundEngine.playClick();
				const mode = btn.classList.contains("btn-reschedule")
					? "reschedule"
					: "schedule";
				const candId = btn.getAttribute("data-candidate-id");
				const cand = AppState.candidates.find((c) => c.id === candId);
				const name =
					cand?.name ||
					btn
						.closest("tr")
						?.querySelector(".cand-name-link")
						?.textContent?.trim() ||
					"Candidate";
				openScheduleModal(
					{
						mode,
						name,
						email: cand?.email || "",
						slotTime: cand?.attemptedAt || "",
					},
					async ({ start, end, timezone, slot }) => {
						const c2 = AppState.candidates.find((c) => c.id === candId);
						if (!c2) return;

						if (getDataSource() === "api") {
							showPremiumToast(
								`Scheduling ${c2.name} and sending email invite...`,
								"info",
							);
							try {
								const stage =
									c2.status?.toLowerCase() === "screening"
										? "screening"
										: "functional";
								const utcIso = new Date(start).toISOString();
								const scheduleId = await ensureBackendApplicantId(c2, job.id);
								const updated = await apiScheduleCandidate(
									scheduleId,
									utcIso,
									stage,
								);

								if (updated) {
									Object.assign(c2, updated);
								} else {
									c2.interviewStatus =
										mode === "reschedule" ? "Incomplete" : "Not Started";
									c2.attemptedAt = slot;
									c2.scheduledWindow = { start, end, timezone };
								}
								saveStateToLocalStorage();
								renderJobDetailPanes(job);
								showPremiumToast(
									`${mode === "reschedule" ? "Rescheduled" : "Scheduled"} ${c2.name} for ${slot} and email invite sent.`,
									"success",
								);
							} catch (err) {
								showPremiumToast(
									`Failed to schedule candidate: ${err.message || err}`,
									"error",
								);
							}
						} else {
							c2.interviewStatus =
								mode === "reschedule" ? "Incomplete" : "Not Started";
							c2.attemptedAt = slot;
							c2.scheduledWindow = { start, end, timezone };
							saveStateToLocalStorage();
							renderJobDetailPanes(job);
							showPremiumToast(
								`${mode === "reschedule" ? "Rescheduled" : "Scheduled"} ${c2.name} for ${slot}.`,
								"success",
							);
						}
					},
				);
			});
		});

		pane.querySelectorAll(".btn-gen-invite").forEach((btn) => {
			btn.addEventListener("click", async (e) => {
				e.stopPropagation();
				soundEngine.playClick();
				const candId = btn.getAttribute("data-candidate-id");
				const cand = AppState.candidates.find((c) => c.id === candId);
				if (!cand) return;

				if (getDataSource() !== "api") {
					showPremiumToast(
						"Connect the live backend to generate interview links.",
						"info",
					);
					return;
				}

				const stage =
					cand.status?.toLowerCase() === "screening"
						? "screening"
						: "functional";
				btn.disabled = true;
				showPremiumToast(`Generating interview link for ${cand.name}…`, "info");
				try {
					const scheduleId = await ensureBackendApplicantId(cand, job.id);
					const data = await apiCreateInterviewInvite(scheduleId, {
						stage,
						send: false,
					});
					const link = data?.link;
					if (!link) throw new Error("No link returned by the server");

					let copied = false;
					try {
						await navigator.clipboard.writeText(link);
						copied = true;
					} catch {
						/* clipboard blocked */
					}

					showPremiumToast(
						copied
							? `Unique link copied for ${cand.name}.`
							: `Link ready for ${cand.name}.`,
						"success",
						{
							label: `Email it to ${cand.email || "candidate"}`,
							onClick: async () => {
								showPremiumToast(`Sending invite to ${cand.email}…`, "info");
								try {
									await apiSendInterviewInvite(data.token);
									showPremiumToast(
										`Invite emailed to ${cand.email}.`,
										"success",
									);
								} catch (err) {
									showPremiumToast(
										`Failed to send invite: ${err.message || err}`,
										"error",
									);
								}
							},
						},
					);
				} catch (err) {
					showPremiumToast(
						`Failed to generate link: ${err.message || err}`,
						"error",
					);
				} finally {
					btn.disabled = false;
				}
			});
		});

		// Populate per-candidate invite status pills with one job-level fetch.
		(async () => {
			if (getDataSource() !== "api" || !job?._backend) return;
			let data;
			try {
				data = await apiListInterviewInvites({ jobId: job.id });
			} catch {
				return;
			}
			const latest = new Map();
			for (const inv of data?.invites || []) {
				if (inv.applicant_id && !latest.has(inv.applicant_id))
					latest.set(inv.applicant_id, inv.status);
			}
			const STYLES = {
				pending: ["Invite sent", "rgba(99,102,241,0.12)", "#6366f1"],
				started: ["In progress", "rgba(245,158,11,0.16)", "#b45309"],
				completed: ["Completed", "rgba(16,185,129,0.16)", "#059669"],
				expired: ["Expired", "rgba(148,163,184,0.20)", "#64748b"],
			};
			pane.querySelectorAll(".invite-status-pill").forEach((el) => {
				const st = latest.get(el.getAttribute("data-candidate-id"));
				const s = st && STYLES[st];
				if (!s) {
					el.textContent = "";
					el.removeAttribute("style");
					return;
				}
				el.textContent = s[0];
				el.title = `Interview invite: ${st}`;
				el.style.cssText = `display:inline-block;margin-left:6px;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;background:${s[1]};color:${s[2]};vertical-align:middle;`;
			});
		})();

		// Click the Invite column header to sort rows by interview-link status.
		pane.querySelectorAll(".invite-sort").forEach((arrow) => {
			arrow.addEventListener("click", (e) => {
				e.stopPropagation();
				const tbody = arrow.closest("table")?.querySelector("tbody");
				if (!tbody) return;
				const rank = {
					Completed: 4,
					"In progress": 3,
					"Invite sent": 2,
					Expired: 1,
				};
				const dir = arrow.getAttribute("data-dir") === "asc" ? -1 : 1;
				arrow.setAttribute("data-dir", dir === 1 ? "asc" : "desc");
				Array.from(tbody.querySelectorAll("tr"))
					.filter((r: any) => r.querySelector(".invite-status-pill"))
					.sort((a: any, b: any) => {
						const av =
							rank[
								a.querySelector(".invite-status-pill")?.textContent?.trim()
							] || 0;
						const bv =
							rank[
								b.querySelector(".invite-status-pill")?.textContent?.trim()
							] || 0;
						return (av - bv) * dir;
					})
					.forEach((r) => tbody.appendChild(r));
			});
		});

		// Functional-stage candidate actions now use the same button row as every
		// other stage table (see the .btn-stage-* delegation above) instead of a
		// <select> — replaces the old .action-select-status change-listener.

		pane.querySelectorAll(".stage-table-container").forEach((container) => {
			const tbody = container.querySelector("tbody");
			const rppSelect = container.querySelector(".rows-per-page");
			const pageInfo = container.querySelector(
				".table-pagination span:nth-child(3)",
			);
			const selInfo = container.querySelector(".table-selection-info");
			const pagBtns = container.querySelectorAll(".pagination-btns button");
			if (!tbody || !rppSelect) return;
			let currentPage = 1;
			const allRows = Array.from(tbody.querySelectorAll("tr"));
			function paginate() {
				const perPage = parseInt(rppSelect.value) || 25;
				const totalRows = allRows.length;
				const totalPages = Math.max(1, Math.ceil(totalRows / perPage));
				if (currentPage > totalPages) currentPage = totalPages;
				const start = (currentPage - 1) * perPage;
				const end = start + perPage;
				allRows.forEach((row: any, i) => {
					row.style.display = i >= start && i < end ? "" : "none";
				});
				if (pageInfo)
					pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
				if (selInfo)
					selInfo.textContent = `0 of ${Math.min(perPage, totalRows - start)} row(s) selected.`;
				if (pagBtns.length === 4) {
					pagBtns[0].disabled = currentPage <= 1;
					pagBtns[1].disabled = currentPage <= 1;
					pagBtns[2].disabled = currentPage >= totalPages;
					pagBtns[3].disabled = currentPage >= totalPages;
				}
			}
			paginate();
			rppSelect.addEventListener("change", () => {
				currentPage = 1;
				paginate();
			});
			if (pagBtns.length === 4) {
				pagBtns[0].addEventListener("click", () => {
					currentPage = 1;
					paginate();
				});
				pagBtns[1].addEventListener("click", () => {
					currentPage = Math.max(1, currentPage - 1);
					paginate();
				});
				pagBtns[2].addEventListener("click", () => {
					const tp = Math.max(
						1,
						Math.ceil(allRows.length / (parseInt(rppSelect.value) || 25)),
					);
					currentPage = Math.min(tp, currentPage + 1);
					paginate();
				});
				pagBtns[3].addEventListener("click", () => {
					currentPage = Math.max(
						1,
						Math.ceil(allRows.length / (parseInt(rppSelect.value) || 25)),
					);
					paginate();
				});
			}
		});
	}
	// Wire the Add-Applicants upload panels rendered into the Screening/Functional
	// stage lists. buildAddApplicantsPanel injects the markup; without these bind
	// calls the button, dropzone, file picker, and Import are inert. A resume upload
	// always enters Resume Analysis; only an explicit recruiter action advances it.
	if (document.getElementById("list-stage-resume")) {
		bindAddApplicantsPanel(job, "resume");
	}
	if (document.getElementById("list-stage-screening")) {
		bindAddApplicantsPanel(job, "screening");
	}
	if (document.getElementById("list-stage-functional")) {
		bindAddApplicantsPanel(job, "functional");
	}

	renderBlueprintStudio(job);

	// Test Interview pane — dev launcher for a full run of this job's blueprint.
	const testInterviewList = document.getElementById("list-stage-testinterview");
	if (testInterviewList) {
		renderTestInterviewPane(job, testInterviewList);
	}
}

// Recompute pipelines + refresh the job-detail tab counts, funnels and panes.
// Shared by the single-candidate path (updateCandidateStatus) and the bulk
// advance/reject path so stage counts never go stale after a stage change.
// Single source of truth for the interview-status chip across stage panes.
// A candidate with no recorded status reads as "Not Started" — never "Completed".
function interviewStatusChip(status) {
	const ic = (inner) =>
		`<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">${inner}</svg>`;
	const chip = (cls, svg, label) =>
		`<span class="status-chip ${cls}">${svg} ${label}</span>`;
	switch (status) {
		case "Completed":
			return chip(
				"completed",
				ic('<polyline points="20 6 9 17 4 12"></polyline>'),
				"Completed",
			);
		case "Incomplete":
			return chip(
				"incomplete",
				ic('<line x1="5" y1="12" x2="19" y2="12"></line>'),
				"Incomplete",
			);
		case "Evaluating":
			return chip(
				"evaluating",
				ic('<path d="M21 12a9 9 0 1 1-6.219-8.56"></path>'),
				"Evaluating",
			);
		case "Attempting":
			return chip(
				"attempting",
				ic(
					'<circle cx="12" cy="12" r="9"></circle><polyline points="12 7 12 12 15 14"></polyline>',
				),
				"Attempting",
			);
		case "Slot Missed":
			return chip(
				"slot-missed",
				ic(
					'<rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line>',
				),
				"Slot Missed",
			);
		case "Scheduled":
			return chip(
				"scheduled",
				ic(
					'<rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><polyline points="9 15 11 17 15 13"></polyline>',
				),
				"Scheduled",
			);
		case "Awaiting Schedule":
			return chip(
				"awaiting-schedule",
				ic(
					'<circle cx="12" cy="12" r="9"></circle><line x1="8" y1="12" x2="16" y2="12"></line>',
				),
				"Awaiting Schedule",
			);
		default:
			return chip(
				"not-started",
				ic(
					'<circle cx="12" cy="12" r="9"></circle><line x1="8" y1="12" x2="16" y2="12"></line>',
				),
				"Not Started",
			);
	}
}

function refreshAfterStageChange() {
	recalculateJobPipelines();
	updateSummaryMetrics();
	renderAnalyticsTable();

	const activeJob = AppState.jobs.find((j) => j.id === AppState.activeJobId);
	if (activeJob) {
		const elScreening = document.getElementById("jd-count-screening");
		if (elScreening) elScreening.textContent = activeJob.pipeline.screening;
		const elFunctional = document.getElementById("jd-count-functional");
		if (elFunctional) elFunctional.textContent = activeJob.pipeline.functional;

		renderFunnelStages(activeJob);
		renderFunnelInsights(activeJob);

		const jobCandidates = filterCandidatesByDateRange(
			AppState.candidates,
		).filter((c) => {
			if (getDataSource() === "api" && activeJob._backend) {
				return c.jobId === activeJob.id;
			}
			return (
				c.jobApplied === activeJob.roleName ||
				c.jobApplied === activeJob.cardName
			);
		});
		drawFunnelSVG(activeJob, jobCandidates);
		drawScoreDistributionSVG(activeJob, jobCandidates);

		renderJobDetailPanes(activeJob);
	}

	if (
		document.getElementById("jobs-board-container") &&
		document.getElementById("jobs-board-container").style.display !== "none"
	) {
		renderKanbanBoard();
	} else {
		renderJobCards();
	}
}

// Puts a Resume-stage candidate on hold (or reverses it) without touching
// `status` — mirrors report-page.ts's `rp-decision` select, the one place in
// this codebase that already persists `decision: 'on_hold'` correctly.
function setCandidateHold(candId, onHold) {
	const candidate = AppState.candidates.find((c) => c.id === candId);
	if (!candidate) return;
	const decision = onHold ? "on_hold" : null;
	candidate.decision = decision;
	saveStateToLocalStorage();
	renderJobDetailPanes(AppState.jobs.find((j) => j.id === AppState.activeJobId));
	showPremiumToast(
		onHold ? `${candidate.name} placed on hold.` : `${candidate.name} back under review.`,
		"info",
	);
	if (candidate._backend && getDataSource() === "api") {
		apiUpdateApplicant(candidate.backendId || candId, { decision }).catch((err) => {
			console.warn("Hold status saved locally but backend sync failed:", err);
			showPremiumToast(`Could not sync ${candidate.name}'s hold status to the backend.`, "error");
		});
	}
}

function updateCandidateStatus(candId, newStatus) {
	const candidate = AppState.candidates.find((c) => c.id === candId);
	if (!candidate) return;

	const oldStatus = candidate.status;
	candidate.status = newStatus;

	if (
		(newStatus === "Screening" || newStatus === "Functional") &&
		candidate.interviewStatus == null
	) {
		candidate.interviewStatus = "Not Started";
	}

	if (newStatus === "Rejected") {
		showPremiumToast(
			`${candidate.name} has been rejected from the pipeline.`,
			"success",
		);
		soundEngine.playChime([392, 293.66], 0.2, 0.1);
	} else if (newStatus === "Hired") {
		showPremiumToast(
			`Congratulations! ${candidate.name} has been marked as Hired.`,
			"success",
		);
		soundEngine.playChime([523.25, 659.25, 783.99, 1046.5], 0.25, 0.08);
	} else {
		showPremiumToast(`${candidate.name} advanced to ${newStatus}.`, "success");
		soundEngine.playChime([329.63, 440.0, 523.25], 0.2, 0.08);
	}

	saveStateToLocalStorage();

	// Persist the real stage transition; the backend creates fresh sessions from
	// the applicant's screening_status / functional_status changes.
	if (candidate._backend && getDataSource() === "api") {
		const keep = {
			jobApplied: candidate.jobApplied,
			jobId: candidate.jobId,
			registeredOn: candidate.registeredOn,
		};
		apiMoveApplicantStage(candidate.backendId || candId, newStatus)
			.then((updated) => {
				if (updated) {
					Object.assign(candidate, updated);
					if (keep.jobApplied) candidate.jobApplied = keep.jobApplied;
					if (keep.jobId) candidate.jobId = keep.jobId;
					if (keep.registeredOn) candidate.registeredOn = keep.registeredOn;
					saveStateToLocalStorage();
					refreshAfterStageChange();
				}
			})
			.catch((err) => {
				console.warn(
					"Stage change saved locally but backend sync failed:",
					err,
				);
				candidate.status = oldStatus;
				saveStateToLocalStorage();
				refreshAfterStageChange();
				showPremiumToast(
					`Could not sync ${candidate.name}'s stage to the backend.`,
					"error",
				);
			});
	}

	refreshAfterStageChange();
}

// Soft delete — reversible on the backend (see apiDeleteApplicant/apiRestoreApplicant),
// so this mirrors the job-delete pattern in mount.ts: optimistic removal + an Undo
// toast, rather than a confirm dialog. Nothing is scrubbed server-side; the row is
// just hidden until restored.
function deleteCandidate(candId) {
	const idx = AppState.candidates.findIndex((c) => c.id === candId);
	if (idx === -1) return;
	const candidate = AppState.candidates[idx];
	const name = candidate.name;
	const isBackend = candidate._backend && getDataSource() === "api";
	const backendId = candidate.backendId || candId;

	AppState.candidates.splice(idx, 1);
	saveStateToLocalStorage();
	refreshAfterStageChange();

	const reinsert = () => {
		AppState.candidates.splice(
			Math.min(idx, AppState.candidates.length),
			0,
			candidate,
		);
		saveStateToLocalStorage();
		refreshAfterStageChange();
	};

	if (isBackend) {
		apiDeleteApplicant(backendId)
			.then(() => {
				showPremiumToast(`${name} deleted.`, "success", {
					label: "Undo",
					onClick: () => {
						apiRestoreApplicant(backendId)
							.then(() => {
								reinsert();
								showPremiumToast(`${name} restored.`, "success");
							})
							.catch((err) => {
								showPremiumToast(
									`Could not restore ${name}: ${(err && err.message) || "backend error"}`,
									"error",
								);
							});
					},
				});
			})
			.catch((err) => {
				reinsert();
				showPremiumToast(
					`Could not delete ${name}: ${(err && err.message) || "backend error"}`,
					"error",
				);
			});
	} else {
		showPremiumToast(`${name} deleted.`, "success", {
			label: "Undo",
			onClick: reinsert,
		});
	}
}

// Un-reject. screening_status/functional_status are never cleared on reject
// (see _build_job_out/_build_funnel in jobs.py — they just skip rejected/hired
// candidates when bucketing into stages), so restoring is just: clear
// `decision` and recompute the visible stage from those preserved fields.
// The raw booleans aren't kept on the client Candidate (see
// mapApplicantOutToCandidate in api.ts, which derives `status` once at fetch
// time), so use their already-mapped label fields as a stand-in — non-null
// `interviewStatus` means functional_status was set, same for `screeningStatus`
// — same precedence api.ts itself uses. The backend response (below) then
// overwrites this with the authoritative value once it arrives.
function restoreCandidateFromRejection(candId) {
	const candidate = AppState.candidates.find((c) => c.id === candId);
	if (!candidate) return;

	const status = candidate.interviewStatus
		? "Functional"
		: candidate.screeningStatus
			? "Screening"
			: "Resume";
	candidate.decision = null;
	candidate.status = status;
	saveStateToLocalStorage();
	showPremiumToast(`${candidate.name} restored to the pipeline.`, "success");

	if (candidate._backend && getDataSource() === "api") {
		apiUpdateApplicant(candidate.backendId || candId, { decision: null })
			.then((updated) => {
				if (updated) Object.assign(candidate, updated);
				refreshAfterStageChange();
			})
			.catch((err) => {
				showPremiumToast(
					`Could not sync restore: ${(err && err.message) || "backend error"}`,
					"error",
				);
			});
	}

	refreshAfterStageChange();
}

export {
	renderJobDetailPanes,
	updateCandidateStatus,
	setCandidateHold,
	deleteCandidate,
	restoreCandidateFromRejection,
};

// ── Add Applicants panel: shared HTML builder ────────────────────────────────
// Builds an inline upload panel header + collapsible dropzone for any stage.
// `paneKey` is 'screening' or 'functional' (used as HTML id prefix).
function buildAddApplicantsPanel(paneKey, count) {
	const label =
		paneKey === "screening"
			? "Recruiter Screening"
			: paneKey === "functional"
				? "Functional Interview"
				: "Resume Analysis";
	return `
    <div class="ra-candidates-section" style="margin-bottom:16px;">
      <div class="ra-candidates-header">
        <h3 class="ra-candidates-title">Candidates in ${label}</h3>
        <div style="display:flex;align-items:center;gap:10px;">
          <span class="ra-candidates-count">${count} candidate${count !== 1 ? "s" : ""}</span>
        </div>
      </div>
      <div id="add-applicants-panel-${paneKey}" style="display:none;background:var(--glass-bg);border:1px solid var(--glass-border);border-radius:12px;padding:20px;margin-bottom:16px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
          <div>
            <h4 style="margin:0;font-size:0.9rem;font-weight:700;color:var(--color-text-primary);font-family:var(--font-display);">Upload Applicant Resumes</h4>
			<p style="margin:4px 0 0;font-size:0.75rem;color:var(--color-text-muted);">Upload PDF, DOCX, or ZIP files — candidates enter Resume Analysis for review</p>
          </div>
          <button id="btn-add-panel-close-${paneKey}" style="background:none;border:none;color:var(--color-text-faint);cursor:pointer;padding:4px;border-radius:6px;display:flex;align-items:center;">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
        <div id="dropzone-${paneKey}" style="border:2px dashed var(--glass-border);border-radius:10px;padding:36px;text-align:center;cursor:pointer;transition:all 0.2s ease;background:rgba(255,255,255,0.02);">
          <input type="file" id="file-input-${paneKey}" multiple accept=".pdf,.doc,.docx,.txt,.zip" hidden>
          <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-faint)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin:0 auto 10px;display:block;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
          <p style="margin:0;font-size:0.88rem;font-weight:600;color:var(--color-text-primary);">Drop resumes here</p>
          <p style="margin:6px 0 0;font-size:0.75rem;color:var(--color-text-muted);">or <span id="browse-link-${paneKey}" style="color:var(--color-gold);cursor:pointer;text-decoration:underline;">browse files</span> — PDF, DOCX, ZIP</p>
        </div>
        <div id="files-preview-${paneKey}" style="display:none;margin-top:12px;">
          <div style="font-size:0.78rem;color:var(--color-text-muted);margin-bottom:8px;"><span id="files-count-${paneKey}">0</span> file(s) selected</div>
          <div id="files-list-${paneKey}" style="display:flex;flex-direction:column;gap:6px;max-height:180px;overflow-y:auto;"></div>
          <div style="display:flex;gap:10px;margin-top:14px;">
			<button id="btn-import-${paneKey}" disabled style="flex:1;padding:9px 16px;border-radius:9px;border:1px solid rgba(var(--color-gold-rgb),0.3);background:rgba(var(--color-gold-rgb),0.1);color:var(--color-gold);font-size:0.82rem;font-weight:600;cursor:pointer;font-family:var(--font-body);transition:all 0.2s ease;">Import to Resume Analysis</button>
            <button id="btn-cancel-${paneKey}" style="padding:9px 16px;border-radius:9px;border:1px solid var(--glass-border);background:rgba(255,255,255,0.04);color:var(--color-text-muted);font-size:0.82rem;cursor:pointer;font-family:var(--font-body);transition:all 0.2s ease;">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ── Add Applicants panel: event wiring ──────────────────────────────────────
function bindAddApplicantsPanel(job, paneKey) {
	let uploadedFiles = [];
	let isImporting = false;

	const addBtn = document.getElementById(`btn-add-applicants-${paneKey}`);
	const panel = document.getElementById(`add-applicants-panel-${paneKey}`);
	const closeBtn = document.getElementById(`btn-add-panel-close-${paneKey}`);
	const dropzone = document.getElementById(`dropzone-${paneKey}`);
	const fileInput = document.getElementById(`file-input-${paneKey}`);
	const browseLink = document.getElementById(`browse-link-${paneKey}`);
	const previewBox = document.getElementById(`files-preview-${paneKey}`);
	const filesList = document.getElementById(`files-list-${paneKey}`);
	const countSpan = document.getElementById(`files-count-${paneKey}`);
	const importBtn = document.getElementById(`btn-import-${paneKey}`);
	const cancelBtn = document.getElementById(`btn-cancel-${paneKey}`);

	if (!addBtn || !panel) return;

	const closePanel = () => {
		panel.style.display = "none";
	};
	const openPanel = () => {
		panel.style.display = "block";
	};

	addBtn.addEventListener("click", () => {
		panel.style.display = panel.style.display === "none" ? "block" : "none";
		soundEngine.playClick();
	});
	closeBtn?.addEventListener("click", () => {
		closePanel();
		soundEngine.playClick();
	});

	const openPicker = () => fileInput?.click();
	browseLink?.addEventListener("click", (e) => {
		e.stopPropagation();
		openPicker();
	});
	dropzone?.addEventListener("click", (e) => {
		if (e.target !== browseLink) openPicker();
	});

	dropzone?.addEventListener("dragover", (e) => {
		e.preventDefault();
		dropzone.style.borderColor = "var(--color-gold)";
		dropzone.style.background = "rgba(var(--color-gold-rgb),0.04)";
	});
	dropzone?.addEventListener("dragleave", () => {
		dropzone.style.borderColor = "var(--glass-border)";
		dropzone.style.background = "rgba(255,255,255,0.02)";
	});
	dropzone?.addEventListener("drop", (e) => {
		e.preventDefault();
		dropzone.style.borderColor = "var(--glass-border)";
		dropzone.style.background = "rgba(255,255,255,0.02)";
		const files = Array.from(e.dataTransfer.files).filter((f: File) =>
			/\.(pdf|docx?|txt|zip)$/i.test(f.name),
		);
		if (files.length > 0) enqueueFiles(files);
	});

	fileInput?.addEventListener("change", (e) => {
		if (!e.target.files.length) return;
		enqueueFiles(Array.from(e.target.files));
		e.target.value = "";
	});

	cancelBtn?.addEventListener("click", () => {
		uploadedFiles = [];
		if (filesList) filesList.innerHTML = "";
		if (previewBox) previewBox.style.display = "none";
		if (importBtn) importBtn.disabled = true;
		soundEngine.playClick();
	});

	importBtn?.addEventListener("click", async () => {
		if (isImporting || uploadedFiles.length === 0) return;
		if (!isApiMode()) {
			showPremiumToast("Switch to API mode to import resumes.", "info");
			return;
		}
		isImporting = true;
		importBtn.disabled = true;
		importBtn.textContent = "Importing…";

		try {
			const newCands = await apiUploadResumes(
				job.id,
				uploadedFiles.map((f) => f.file),
				null,
			);
			// Merge new candidates into AppState without losing others
			const others = (AppState.candidates || []).filter(
				(c) => c.jobId !== job.id,
			);
			const existing = (AppState.candidates || []).filter(
				(c) => c.jobId === job.id,
			);
			const existingIds = new Set(existing.map((c) => c.id));
			const returnedById = new Map(newCands.map((c) => [c.id, c]));
			const merged = existing.map((candidate) => {
				const refreshed = returnedById.get(candidate.id);
				if (!refreshed) return candidate;
				refreshed.jobApplied = job.roleName;
				refreshed.jobId = job.id;
				return refreshed;
			});
			newCands.forEach((nc) => {
				nc.jobApplied = job.roleName;
				nc.jobId = job.id;
				if (!existingIds.has(nc.id)) merged.push(nc);
			});
			AppState.candidates = [...others, ...merged];
			soundEngine.playChime([392.0, 523.25, 659.25], 0.2, 0.08);
			const addedCount = newCands.filter((candidate) => !existingIds.has(candidate.id)).length;
			const updatedCount = newCands.length - addedCount;
			const summary = [
				addedCount ? `${addedCount} new` : "",
				updatedCount ? `${updatedCount} existing resume${updatedCount === 1 ? "" : "s"} updated` : "",
			].filter(Boolean).join(", ");
			showPremiumToast(
				`Resume import complete: ${summary || "no candidates changed"}.`,
				"success",
			);
			uploadedFiles = [];
			closePanel();
			refreshAfterStageChange();
		} catch (err) {
			console.error("Upload failed:", err);
			showPremiumToast(`Upload failed: ${err.message}`, "error");
		} finally {
			isImporting = false;
			if (importBtn) {
				importBtn.disabled = false;
				importBtn.textContent = "Import to Resume Analysis";
			}
		}
	});

	function enqueueFiles(files) {
		if (!previewBox || !filesList || !countSpan || !importBtn) return;
		previewBox.style.display = "block";
		importBtn.disabled = true;

		const startIdx = uploadedFiles.length;
		files.forEach((file, i) => {
			const idx = startIdx + i;
			const item = { file, status: "parsing" };
			uploadedFiles.push(item);

			const row = document.createElement("div");
			row.style.cssText =
				"display:flex;align-items:center;gap:10px;padding:8px 12px;background:rgba(255,255,255,0.03);border:1px solid var(--glass-border);border-radius:8px;";
			row.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
        <span style="flex:1;font-size:0.8rem;color:var(--color-text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHTML(file.name)}</span>
        <span style="font-size:0.72rem;color:var(--color-text-muted);">${(file.size / 1024).toFixed(1)} KB</span>
        <span id="status-${paneKey}-${idx}" style="font-size:0.7rem;padding:2px 8px;border-radius:10px;background:rgba(var(--color-gold-rgb),0.1);color:var(--color-gold);white-space:nowrap;">Queued</span>
      `;
			filesList.appendChild(row);

			// Simulate a progress animation while the real upload happens on click
			let ticks = 0;
			const iv = setInterval(
				() => {
					ticks++;
					const badge = document.getElementById(`status-${paneKey}-${idx}`);
					if (!badge) {
						clearInterval(iv);
						return;
					}
					if (ticks > 8) {
						clearInterval(iv);
						badge.textContent = "Ready";
						badge.style.background = "rgba(34,197,94,0.12)";
						badge.style.color = "#22c55e";
						item.status = "done";
						if (uploadedFiles.every((f) => f.status === "done")) {
							if (importBtn) importBtn.disabled = false;
							soundEngine.playChime([523.25, 659.25], 0.12, 0.08);
						}
					} else {
						badge.textContent = "Parsing…";
					}
				},
				180 + Math.random() * 120,
			);
		});

		countSpan.textContent = uploadedFiles.length;
	}
}

// ── Subtabs helpers ───────────────────────────────────────────────────────────
// getCandidateSubtab lives in interview-status.ts (stage-aware — reads
// screeningStatus for the Screening pane, interviewStatus for the Functional
// pane; used to always read interviewStatus for both, which is always null
// for a screening-stage candidate, so every one of them fell into the same
// default 'scheduled' bucket regardless of their real status).

const SUBTAB_KEYS = ['awaiting-schedule', 'scheduled', 'partially-completed', 'window-missed', 'completed'];

function getOrInitActiveSubtab(stage, candidates) {
	const appStateKey = stage === 'screening' ? 'activeScreeningSubtab' : 'activeFunctionalSubtab';
	const fromAppState = AppState[appStateKey];
	if (fromAppState && SUBTAB_KEYS.includes(fromAppState)) {
		return fromAppState;
	}
	const key = `ih-subtab-${stage}`;
	const saved = localStorage.getItem(key);
	if (saved && SUBTAB_KEYS.includes(saved)) {
		return saved;
	}
	const order = ['awaiting-schedule', 'scheduled', 'completed', 'partially-completed', 'window-missed'];
	for (const tab of order) {
		if (candidates.some((c) => getCandidateSubtab(c, stage) === tab)) return tab;
	}
	return 'awaiting-schedule';
}

function buildSubtabsBarHTML(stage, counts, activeSubtab) {
	const labels = {
		'awaiting-schedule': 'Awaiting Schedule',
		'window-missed': 'Window Missed',
		scheduled: 'Scheduled',
		'partially-completed': 'Partially Completed',
		completed: 'Completed',
	};
	const keys = ['awaiting-schedule', 'scheduled', 'window-missed', 'partially-completed', 'completed'];
	return `
    <div class="stage-subtabs" data-stage="${stage}">
      ${keys.map((k) => `
        <button class="stage-subtab-btn ${activeSubtab === k ? 'active' : ''}" data-stage="${stage}" data-subtab="${k}">
          ${labels[k]}
          <span class="stage-subtab-count">${counts[k] || 0}</span>
        </button>
      `).join('')}
    </div>
  `;
}
