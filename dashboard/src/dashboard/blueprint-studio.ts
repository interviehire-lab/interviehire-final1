// Interview Blueprint Studio — the redesigned Question Generator surface.
// Renders the laptop-first studio (mode toggle, topic-grouped canvas with
// per-question rubric authoring, one collapsible inspector) into
// #jd-pane-questions and wires it to the contract-aligned blueprint-engine.
// Replaces the old renderQuestionsPane / flat job.questions surface.

import { document, setTimeout, clearTimeout } from './runtime';
import { escapeHTML } from './escape';
import { saveStateToLocalStorage } from './ai-api';
import { soundEngine } from './sound';
import { showPremiumToast } from './sourcing';
import { isApiMode, apiPatchJobParameters } from './api';
import {
  MODE_FUNCTIONAL, MODE_SCREENING, CONTRACT_DIFFICULTY, TOPIC_TYPES, QUESTION_TYPES, SEVERITY_LEVELS,
  migrateLegacyQuestions, emptyScreeningBlueprint, createTopic, createQuestionBlueprint, createRubricPoint, createRedFlag,
  generateFunctionalOutline, enrichQuestionRubric, generateScreeningQuestions, generateGapQuestion, generateScenarioVariant, generateDifficultyVariant,
  computeGenerationPlan, analyzeRequirements, pinBlueprintToRequirements, mergeBlueprintPreservingEdits,
  localFunctionalBlueprint, localScreeningQuestions, localGapQuestion, localScenarioVariant, localDifficultyVariant,
  tightenGeneratedVoicePrompts,
  computeCoverage, computeCalibration, computeBandFit, rubricStrength, critiqueRubric, critiqueBlueprint, leakageRisk,
  createTopicSuggestion, suggestTopics, localTopicSuggestions,
  autofillOutlineNotes, runSheetMarkdown, normalizeInterviewStructure, topicMinutes,
} from './blueprint-engine';

// Third top-level mode: the read-first Run-of-Show document. The engine owns
// 'functional'/'screening'; 'outline' is a studio-only view of the same data.
const MODE_OUTLINE = 'outline';

// Shared mutable UI state — imported bindings are read-only, so studio view
// state lives on a plain object (same pattern as questionStaging/spotlightUi).
const studioUi = {
  mode: MODE_FUNCTIONAL,
  inspectorOpen: false,
  inspectorTab: 'coverage',
  expandedTopicId: null,
  expandedQuestionId: null,
  generating: false,
  genLabel: null,   // transient button label while generating (null → default text)
  draftingReq: null,
  scenarioQid: null,
  // One Edit toggle reveals inline rename + add/remove controls on topics/questions.
  editMode: false,
  // Collapsible "Recommended topics" dialogue.
  suggestCollapsed: false,
  // Suggested-topics curation gate (transient until Generate runs).
  topicSuggestions: null,   // [{id,name,type,difficulty,rationale,accepted}] | null
  suggestingTopics: false,
  // Suggested recruiter-screening questions (transient click-to-add pop-up).
  screeningSuggestions: null,  // string[] | null
  suggestingScreening: false,
  editingSuggId: null,
};

let dragState = null;

// The job currently rendered in the studio — so persist() can target the right
// backend record without threading `job` through every call site.
let activeJob = null;

// Debounced autosave to the live backend (api mode only). Latest-wins: rapid
// edits and the generation batch coalesce into one PATCH; an edit landing
// mid-flight queues exactly one follow-up save. 'local' mode is untouched.
const backendSave = { timer: null, inflight: false, again: false, status: 'idle', toasted: false };

const TYPE_TINT = {
  technical_theory: '#38bdf8', coding: '#38bdf8', system_design: '#38bdf8',
  behavioral: '#a855f7', case_study: '#34d399', hr_screening: '#fbbf24',
  sales_roleplay: '#f472b6', general: '#9a9a9a', custom: '#9a9a9a',
};
const DIFF_TINT = { Easy: '#34d399', Medium: '#fbbf24', Hard: '#f87171' };
const SEV_TINT = { low: '#9a9a9a', medium: '#fbbf24', high: '#fb923c', critical: '#f87171' };
const tint = (map, key) => map[key] || '#9a9a9a';
// Local trim helper — the engine's `clean` is module-private; the studio only
// needs the trim-or-empty behaviour for run-sheet prose checks.
const txt = (v) => (typeof v === 'string' ? v.trim() : '');

// ── Data accessors (own the canonical objects on the job so edits persist) ───
function functionalOf(job) {
  if (!job.functionalParameters || !Array.isArray(job.functionalParameters.topics)) {
    job.functionalParameters = migrateLegacyQuestions(job.questions);
  }
  return tightenGeneratedVoicePrompts(job.functionalParameters);
}
function screeningOf(job) {
  if (!job.screeningBlueprint || !Array.isArray(job.screeningBlueprint.questions)) {
    job.screeningBlueprint = emptyScreeningBlueprint();
  }
  return job.screeningBlueprint;
}
// Ensure the interview-level run-sheet bookends exist + are coerced. Owns the
// canonical object on the blueprint so inline edits in Outline mode persist.
function structureOf(fb) {
  fb.interviewStructure = normalizeInterviewStructure(fb.interviewStructure);
  return fb.interviewStructure;
}
function allQuestions(fb) {
  return (fb.topics || []).flatMap((t) => t.questions.map((q) => ({ q, topic: t })));
}
function findQuestion(job, qid) {
  for (const t of functionalOf(job).topics) {
    const q = t.questions.find((x) => x.id === qid);
    if (q) return { q, topic: t };
  }
  const sq = screeningOf(job).questions.find((x) => x.id === qid);
  return sq ? { q: sq, topic: null } : { q: null, topic: null };
}
// The rubric point array for an editor "kind" (required | secondary | excellent).
function pointsOf(q, kind) {
  if (!q || !q.rubric) return null;
  if (kind === 'secondary') return q.rubric.secondaryPoints;
  if (kind === 'excellent') return q.rubric.excellentAnswerSignals;
  return q.rubric.requiredPoints;
}
// Every mutation flows through persist(): localStorage always (the local cache
// + 'local' mode source of truth), plus a debounced backend PATCH in api mode.
const persist = () => { saveStateToLocalStorage(); scheduleBackendSave(); };

// ── Backend autosave ─────────────────────────────────────────────────────────
const SAVE_UI = {
  idle:   ['#6b7280', 'Synced'],
  saving: ['#fbbf24', 'Saving…'],
  saved:  ['#34d399', 'Saved'],
  error:  ['#f87171', 'Save failed'],
};
function saveStatusInner(status) {
  const [color, label] = SAVE_UI[status] || SAVE_UI.idle;
  return `<span class="bs-save-dot ${status === 'saving' ? 'spin' : ''}" style="--c:${color};"></span>${label}`;
}
function saveStatusMarkup() {
  if (!(isApiMode() && activeJob && activeJob._backend)) return '';
  return `<span class="bs-save" id="bs-save-status" data-state="${backendSave.status}" title="Authored blueprint syncs to the live backend">${saveStatusInner(backendSave.status)}</span>`;
}
function setSaveStatus(status, detail?) {
  backendSave.status = status;
  const el = document.getElementById('bs-save-status');
  if (el) { el.dataset.state = status; el.innerHTML = saveStatusInner(status); }
  if (status === 'error' && !backendSave.toasted) {
    backendSave.toasted = true;
    showPremiumToast(`Couldn't save to the backend: ${detail || 'unknown error'}`, 'error');
  }
  if (status === 'saved' || status === 'saving') backendSave.toasted = false;
}
function scheduleBackendSave() {
  if (!activeJob || !isApiMode() || !activeJob._backend || !activeJob.id) return;
  // During generation many partial saves would fire — batch into the single
  // save that finish() schedules once `generating` clears.
  if (studioUi.generating) return;
  setSaveStatus('saving');
  if (backendSave.timer) clearTimeout(backendSave.timer);
  backendSave.timer = setTimeout(flushBackendSave, 1000);
}
async function flushBackendSave() {
  const job = activeJob;
  if (!job || !job.id) return;
  if (backendSave.inflight) { backendSave.again = true; return; }
  backendSave.inflight = true;
  backendSave.again = false;
  setSaveStatus('saving');
  try {
    await apiPatchJobParameters(job.id, job);
    if (!backendSave.again) setSaveStatus('saved');
  } catch (e) {
    setSaveStatus('error', (e && e.message) || '');
  } finally {
    backendSave.inflight = false;
    if (backendSave.again) { backendSave.again = false; flushBackendSave(); }
  }
}

// ── Entry ────────────────────────────────────────────────────────────────
export function renderBlueprintStudio(job) {
  const pane = document.getElementById('jd-pane-questions');
  if (!pane) return;
  activeJob = job;
  functionalOf(job);
  screeningOf(job);
  pane.innerHTML = shellMarkup(job);
  bindStudio(pane, job);
  if (studioUi.mode === MODE_OUTLINE) autosizeOutlineFields(pane);
}

// Grow the document-styled run-sheet textareas to fit their content (a fallback
// for browsers without CSS field-sizing; harmless where it's supported).
function autosizeOutlineFields(pane) {
  pane.querySelectorAll('.bs-rs-field').forEach((el) => {
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  });
}

// ── Markup ─────────────────────────────────────────────────────────────────
function shellMarkup(job) {
  const fb = functionalOf(job);
  const cal = computeCalibration(fb);
  const cov = computeCoverage(job, fb);
  const covOk = cov.filter((c) => c.status === 'ok').length;
  const isFn = studioUi.mode === MODE_FUNCTIONAL;
  const isOutline = studioUi.mode === MODE_OUTLINE;
  const screeningCount = screeningOf(job).questions.length;

  return `
  <div class="bs-studio ${studioUi.inspectorOpen && !isOutline ? 'inspector-open' : ''} ${isOutline ? 'outline-mode' : ''}">
    <div class="bs-topbar">
      <div class="bs-tb-heading">
        <span class="bs-tb-crumb">${escapeHTML(job.roleName || job.cardName || 'Role')}</span>
        <h2 class="bs-tb-title"><span class="bs-dot"></span> Interview Blueprint Studio</h2>
      </div>
      <div class="bs-mode-toggle" role="tablist">
        <button class="bs-mode-btn ${studioUi.mode === MODE_SCREENING ? 'active alt' : ''}" data-action="mode" data-mode="${MODE_SCREENING}"><span class="bs-md"></span> Screening</button>
        <button class="bs-mode-btn ${isFn ? 'active' : ''}" data-action="mode" data-mode="${MODE_FUNCTIONAL}"><span class="bs-md"></span> Functional</button>
        <button class="bs-mode-btn ${isOutline ? 'active out' : ''}" data-action="mode" data-mode="${MODE_OUTLINE}"><span class="bs-md"></span> Outline</button>
      </div>
      ${isOutline ? '' : `<button class="bs-btn-generate ${studioUi.generating ? 'generating' : ''}" data-action="generate" ${studioUi.generating ? 'disabled' : ''}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
        <span class="bs-btn-text">${studioUi.generating ? (studioUi.genLabel || 'Generating…') : (isFn ? 'Generate blueprint' : 'Generate questions')}</span>
      </button>`}
    </div>

    <div class="bs-strip">
      ${isOutline ? `
        <span class="bs-stat"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> <b>${cal.totalMinutes}</b> min run</span>
        <span class="bs-sep"></span>
        <span class="bs-stat"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/></svg> <b>${cal.topicCount}</b> topic${cal.topicCount !== 1 ? 's' : ''} · <b>${cal.questionCount}</b> question${cal.questionCount !== 1 ? 's' : ''}</span>
        <span class="bs-sep"></span>
        <span class="bs-stat bs-stat-muted">The interviewer's run of show — opening, topics, what to listen for, closing</span>
      ` : isFn ? `
        <span class="bs-stat"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> <b>${cal.totalMinutes}</b> min</span>
        <span class="bs-sep"></span>
        <span class="bs-stat"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/></svg> <b>${cal.questionCount}</b> question${cal.questionCount !== 1 ? 's' : ''}</span>
        <span class="bs-sep"></span>
        <span class="bs-stat"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="2"/></svg> coverage <b>${covOk}/${cov.length || 0}</b></span>
        <span class="bs-sep"></span>
        <span class="bs-stat"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12l2 2 4-4"/><path d="M21 12c0 5-3.5 7.5-8.5 9C7.5 19.5 4 17 4 12V5l8.5-3L21 5z"/></svg> rubric <b>${cal.rubricCoverage}%</b></span>
      ` : `
        <span class="bs-stat"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/></svg> <b>${screeningCount}</b> question${screeningCount !== 1 ? 's' : ''}</span>
        <span class="bs-sep"></span>
        <span class="bs-stat bs-stat-muted">Recruiter gate · keep it short, ~3 min each</span>
      `}
      <span class="bs-spacer"></span>
      ${saveStatusMarkup()}
      ${isOutline ? '' : `<button class="bs-insp-toggle" data-action="toggle-inspector">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="15" y1="3" x2="15" y2="21"/></svg>
        ${studioUi.inspectorOpen ? 'Hide' : 'Inspector'}
      </button>`}
    </div>

    <div class="bs-work">
      <div class="bs-canvas">
        <div class="bs-panel">
          ${isOutline ? outlineCanvas(job, fb) : isFn ? functionalCanvas(job, fb) : screeningCanvas(job)}
        </div>
      </div>
      ${studioUi.inspectorOpen && !isOutline ? `<div class="bs-inspector">${inspectorMarkup(job, fb, cov, cal)}</div>` : ''}
    </div>
  </div>`;
}

function functionalCanvas(job, fb) {
  const gate = (studioUi.suggestingTopics || studioUi.topicSuggestions) ? suggestedTopicsPanel() : '';
  if (!fb.topics.length) {
    // Empty: lead with the suggestion gate if it's active, else offer "Suggest
    // topics" as the primary, curated path into generation.
    return gate || `<div class="bs-empty">
      <div class="bs-empty-icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2z"/></svg></div>
      <p class="bs-empty-title">No blueprint yet</p>
      <p class="bs-empty-desc">Start from recommended topics for this role, or generate a full blueprint straight away.</p>
      <div class="bs-empty-actions">
        <button class="bs-mini-btn primary" data-action="suggest-topics"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2z"/></svg> Suggest topics</button>
        <button class="bs-mini-btn ghost" data-action="generate">Generate blueprint</button>
      </div>
    </div>`;
  }
  return `
    ${gate}
    <div class="bs-fn ${studioUi.editMode ? 'bs-editing' : ''}">
    <div class="bs-canvas-head">
      <div><div class="bs-canvas-title">Functional blueprint</div><div class="bs-canvas-sub">${fb.topics.length} topic${fb.topics.length !== 1 ? 's' : ''} · drag to reorder · every question carries a graded rubric</div></div>
      <div class="bs-head-actions">
        <button class="bs-mini-btn ${studioUi.editMode ? 'primary' : 'ghost'} bs-edit-toggle" data-action="toggle-edit">${studioUi.editMode ? 'Done' : 'Edit'}</button>
        <button class="bs-mini-btn ghost" data-action="suggest-topics" ${studioUi.generating ? 'disabled' : ''}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2z"/></svg> Topics</button>
        <button class="bs-mini-btn" data-action="add-topic"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Topic</button>
      </div>
    </div>
    ${fb.topics.map((t) => topicMarkup(t)).join('')}
    </div>`;
}

// ── Suggested-topics gate (curation before generation) ───────────────────────
function suggestedTopicsPanel() {
  if (studioUi.suggestingTopics) {
    return `<div class="bs-suggest bs-reveal">
      <div class="bs-suggest-head"><div>
        <div class="bs-suggest-title">Reading the role…</div>
        <div class="bs-suggest-sub">Finding the topic areas worth probing for this position.</div>
      </div></div>
      ${[0, 1, 2, 3].map(() => '<div class="bs-sugg-skel"><span class="bs-shimmer"></span></div>').join('')}
    </div>`;
  }
  const list = studioUi.topicSuggestions || [];
  if (!list.length) return '';
  // Count only generatable topics (accepted AND named) so the Generate button's
  // enabled state + label match the seed the handler actually uses.
  const kept = list.filter((s) => s.accepted && (s.name || '').trim()).length;
  const collapsed = studioUi.suggestCollapsed;
  return `<div class="bs-suggest bs-reveal ${collapsed ? 'collapsed' : ''}">
    <div class="bs-suggest-head">
      <div class="bs-suggest-head-main">
        <div class="bs-suggest-title">Recommended topics for this role</div>
        ${collapsed ? '' : '<div class="bs-suggest-sub">Keep the areas worth probing — Generate builds rubric-graded questions for the ones you keep.</div>'}
      </div>
      <div class="bs-suggest-head-r">
        <span class="bs-suggest-count"><b>${kept}</b> / ${list.length} kept</span>
        <button class="bs-suggest-collapse" data-action="toggle-suggest" title="${collapsed ? 'Expand recommended topics' : 'Collapse recommended topics'}"><svg class="bs-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></button>
      </div>
    </div>
    ${collapsed ? '' : `${list.map((s) => suggItemMarkup(s)).join('')}
    <button class="bs-mini-btn ghost bs-sugg-add" data-action="add-topic-suggestion"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add a topic of your own</button>
    <div class="bs-suggest-foot">
      <button class="bs-mini-btn ghost" data-action="suggest-topics" ${studioUi.generating ? 'disabled' : ''}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Re-suggest</button>
      <button class="bs-btn-generate bs-sugg-gen ${studioUi.generating ? 'generating' : ''}" data-action="generate-from-topics" ${studioUi.generating || !kept ? 'disabled' : ''}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
        <span class="bs-btn-text">${studioUi.generating ? (studioUi.genLabel || 'Generating…') : `Generate from ${kept} topic${kept !== 1 ? 's' : ''}`}</span>
      </button>
    </div>`}
  </div>`;
}

function suggItemMarkup(s) {
  if (studioUi.editingSuggId === s.id) {
    return `<div class="bs-sugg-item on editing" data-sugg-id="${s.id}">
      <div class="bs-sugg-body">
        <input class="bs-input bs-sugg-name-input" data-action="edit-suggestion" data-sugg-id="${s.id}" data-field="name" value="${escapeHTML(s.name)}" placeholder="Topic name" />
        <input class="bs-input bs-sugg-why-input" data-action="edit-suggestion" data-sugg-id="${s.id}" data-field="rationale" value="${escapeHTML(s.rationale)}" placeholder="Why this area matters for the role…" />
      </div>
      <button class="bs-icon-btn" data-action="done-suggestion" data-sugg-id="${s.id}" title="Done"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg></button>
    </div>`;
  }
  return `<div class="bs-sugg-item ${s.accepted ? 'on' : 'off'}" data-sugg-id="${s.id}">
    <button class="bs-sugg-check" data-action="toggle-topic-suggestion" data-sugg-id="${s.id}" title="${s.accepted ? 'Keep this topic' : 'Skip this topic'}">
      ${s.accepted
        ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>'
        : '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>'}
    </button>
    <div class="bs-sugg-body">
      <div class="bs-sugg-name">${escapeHTML(s.name)} <span class="bs-sugg-meta">${escapeHTML(s.type)} · ${escapeHTML(s.difficulty)}</span></div>
      ${txt(s.rationale) ? `<div class="bs-sugg-why"><span class="bs-why-tag">why</span> ${escapeHTML(s.rationale)}</div>` : ''}
    </div>
    <button class="bs-sugg-edit" data-action="edit-topic-suggestion" data-sugg-id="${s.id}" title="Edit"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
  </div>`;
}

// ── Outline mode: the interviewer's Run of Show ──────────────────────────────
function outlineCanvas(job, fb) {
  if (!fb.topics.length) {
    return `<div class="bs-empty">
      <div class="bs-empty-icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg></div>
      <p class="bs-empty-title">No interview to outline yet</p>
      <p class="bs-empty-desc">Generate a functional blueprint first — this becomes the interviewer's run of show: opening, topics, what to listen for, and closing.</p>
      <div class="bs-empty-actions"><button class="bs-mini-btn primary" data-action="mode" data-mode="${MODE_FUNCTIONAL}">Go to Functional</button></div>
    </div>`;
  }
  const struct = structureOf(fb);
  const cal = computeCalibration(fb);
  const topics = fb.topics;
  return `<div class="bs-runsheet">
    ${runSheetMast(job, cal)}
    <div class="bs-rs-doc">
      <div class="bs-rs-row bs-rs-bookend" style="--i:0">
        <span class="bs-rs-node open"></span>
        <div class="bs-rs-content">
          <div class="bs-rs-kicker">Opening <span class="bs-rs-time">~1 min</span></div>
          ${outlineField('opening', null, null, struct.openingLine, 'Add an opening line the interviewer reads to set the tone…')}
        </div>
      </div>
      ${topics.map((t, i) => runSheetMovement(t, i, topics.length)).join('')}
      <div class="bs-rs-row bs-rs-bookend" style="--i:${topics.length + 1}">
        <span class="bs-rs-node close"></span>
        <div class="bs-rs-content">
          <div class="bs-rs-kicker">Closing <span class="bs-rs-time">~2 min</span></div>
          ${outlineField('closing', null, null, struct.closingLine, 'Add a closing line to wrap up and invite questions…')}
        </div>
      </div>
    </div>
  </div>`;
}

function runSheetMast(job, cal) {
  return `<div class="bs-rs-mast">
    <div class="bs-rs-mast-l">
      <div class="bs-rs-kicker mast">Run of show</div>
      <div class="bs-rs-role">${escapeHTML(job.roleName || job.cardName || 'Interview')}</div>
      <div class="bs-rs-mast-sub">${cal.questionCount} question${cal.questionCount !== 1 ? 's' : ''} · ${cal.topicCount} topic${cal.topicCount !== 1 ? 's' : ''}</div>
    </div>
    <div class="bs-rs-mast-r">
      <div class="bs-rs-clock"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> <b>${cal.totalMinutes}</b> min</div>
      <div class="bs-rs-actions">
        <button class="bs-mini-btn ghost" data-action="autofill-outline" title="Fill empty notes from the rubric — instant, offline"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg> Auto-fill notes</button>
        <button class="bs-mini-btn ghost" data-action="copy-runsheet"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy run sheet</button>
        <button class="bs-mini-btn ghost" data-action="print-runsheet"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg> Print</button>
      </div>
    </div>
  </div>`;
}

function runSheetMovement(topic, idx, total) {
  const mins = topicMinutes(topic);
  const isLast = idx === total - 1;
  return `<div class="bs-rs-row bs-rs-move" style="--i:${idx + 1}" data-topic-id="${topic.id}">
    <span class="bs-rs-node"></span>
    <div class="bs-rs-content">
      <div class="bs-rs-move-head">
        <span class="bs-rs-numeral">${String(idx + 1).padStart(2, '0')}</span>
        <div class="bs-rs-move-titles">
          <div class="bs-rs-topic-name">${escapeHTML(topic.name)}</div>
          <div class="bs-rs-move-meta">
            <span class="bs-chip ${topic.type === 'Experiential' ? 'exp' : 'theo'}">${escapeHTML(topic.type)}</span>
            <span class="bs-chip ${topic.difficulty.toLowerCase()}">${escapeHTML(topic.difficulty)}</span>
            <span class="bs-rs-time">~${mins} min</span>
          </div>
        </div>
      </div>
      <div class="bs-rs-note-row why">
        <span class="bs-rs-label">Why this matters</span>
        ${outlineField('why', topic.id, null, topic.whyItMatters, '+ add why this section matters')}
      </div>
      <ol class="bs-rs-qlist">
        ${topic.questions.map((q) => runSheetQuestion(q, topic.id)).join('')}
      </ol>
      ${!isLast ? `<div class="bs-rs-segue">
        <span class="bs-rs-segue-arrow"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 10 4 15 9 20"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/></svg></span>
        ${outlineField('segue', topic.id, null, topic.segue, '+ add a segue into the next topic')}
      </div>` : ''}
    </div>
  </div>`;
}

function runSheetQuestion(q, topicId) {
  return `<li class="bs-rs-q" data-q-id="${q.id}">
    <div class="bs-rs-q-prompt">${escapeHTML(q.prompt) || '<span class="bs-faint">Untitled question</span>'}</div>
    <div class="bs-rs-note-row listen">
      <span class="bs-rs-label listen">Listen for</span>
      ${outlineField('listen', topicId, q.id, (q.listenFor || []).join('\n'), '+ what a strong answer sounds like (one per line)')}
    </div>
    ${txt(q.followUpIntent) ? `<div class="bs-rs-followup"><span class="bs-rs-fu-arrow"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 10 20 15 15 20"/><path d="M4 4v7a4 4 0 0 0 4 4h12"/></svg></span> ${escapeHTML(q.followUpIntent)}</div>` : ''}
  </li>`;
}

// Always-editable, document-styled prose field (Notion-like). oninput mutates +
// persists without a re-render, so focus is never lost while typing.
function outlineField(target, topicId, qid, value, placeholder) {
  const v = txt(value);
  const rows = Math.min(6, Math.max(1, (v.match(/\n/g) || []).length + 1, Math.ceil(v.length / 64) || 1));
  const attrs = `data-action="input-outline" data-target="${target}"${topicId ? ` data-topic-id="${topicId}"` : ''}${qid ? ` data-q-id="${qid}"` : ''}`;
  return `<textarea class="bs-rs-field ${target} ${v ? '' : 'empty'}" ${attrs} rows="${rows}" placeholder="${escapeHTML(placeholder)}">${escapeHTML(v)}</textarea>`;
}

function topicMarkup(topic) {
  const open = studioUi.expandedTopicId === topic.id;
  const typeClass = topic.type === 'Experiential' ? 'exp' : 'theo';
  const diffClass = topic.difficulty.toLowerCase();
  const nameMarkup = studioUi.editMode
    ? `<input class="bs-topic-name-input" data-action="edit-topic-name" data-topic-id="${topic.id}" value="${escapeHTML(topic.name)}" placeholder="Topic name" draggable="false" />`
    : `<span class="bs-topic-name">${escapeHTML(topic.name)}</span>`;
  return `
  <div class="bs-topic ${open ? 'open' : ''}" data-topic-id="${topic.id}">
    <div class="bs-topic-bar" draggable="true" data-action="toggle-topic" data-topic-id="${topic.id}">
      <svg class="bs-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
      ${nameMarkup}
      <span class="bs-tspacer"></span>
      <span class="bs-chip ${typeClass}">${escapeHTML(topic.type)}</span>
      <span class="bs-chip ${diffClass}">${escapeHTML(topic.difficulty)}</span>
      <span class="bs-chip cnt">${topic.questions.length}</span>
      <button class="bs-icon-btn danger bs-topic-del" data-action="delete-topic" data-topic-id="${topic.id}" title="Remove topic"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg></button>
    </div>
    ${open ? `
      <div class="bs-topic-body">
        ${topic.questions.map((q) => questionMarkup(q)).join('')}
        <button class="bs-mini-btn bs-add-q" data-action="add-question" data-topic-id="${topic.id}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add question</button>
      </div>` : ''}
  </div>`;
}

function strengthBadge(q) {
  const s = rubricStrength(q);
  const map = { ready: ['#34d399', 'rubric ready'], light: ['#fbbf24', 'rubric · light'], missing: ['#f87171', 'no rubric'] };
  const [c, label] = map[s];
  return `<span class="bs-qchip" style="color:${c};border-color:${c}40;background:${c}14;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12l2 2 4-4"/><path d="M21 12c0 5-3.5 7.5-8.5 9C7.5 19.5 4 17 4 12V5l8.5-3L21 5z"/></svg> ${label}</span>`;
}

function reviewBadge(q) {
  const n = critiqueRubric(q).length;
  if (!n) return '';
  const c = '#fb923c';
  return `<span class="bs-qchip" style="color:${c};border-color:${c}40;background:${c}14;" title="${n} rubric issue${n !== 1 ? 's' : ''} — open the Review tab"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> ${n}</span>`;
}

function leakageBadge(q) {
  const { risk } = leakageRisk(q);
  if (risk === 'low') return '';
  const c = risk === 'high' ? '#f87171' : '#fbbf24';
  return `<span class="bs-qchip" style="color:${c};border-color:${c}40;background:${c}14;" title="Googleable — a memorised answer could game it. Open to rewrite as a scenario."><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> googleable</span>`;
}

function questionMarkup(q) {
  const open = studioUi.expandedQuestionId === q.id;
  const tt = tint(TYPE_TINT, q.questionType);
  return `
  <div class="bs-qcard ${open ? 'open' : ''}" draggable="${open ? 'false' : 'true'}" data-q-id="${q.id}">
    <div class="bs-q-top" data-action="toggle-question" data-q-id="${q.id}">
      <span class="bs-q-num">Q</span>
      <div class="bs-q-head">
        <div class="bs-q-prompt">${escapeHTML(q.prompt) || '<span class="bs-faint">Untitled question</span>'}</div>
        <div class="bs-q-chips">
          <span class="bs-qchip type" style="color:${tt};border-color:${tt}40;background:${tt}14;">${escapeHTML(q.questionType)}</span>
          <span class="bs-qchip"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ${q.estimatedMinutes} min</span>
          ${strengthBadge(q)}
          ${reviewBadge(q)}
          ${leakageBadge(q)}
        </div>
      </div>
      <button class="bs-icon-btn danger bs-q-del" data-action="delete-question" data-q-id="${q.id}" title="Remove question"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg></button>
    </div>
    ${open ? `<div class="bs-q-edit">${questionEditor(q)}</div>` : ''}
  </div>`;
}

function questionEditor(q) {
  const r = q.rubric;
  return `
    <label class="bs-fld-label">Question prompt <span class="bs-faint">· spoken aloud by the avatar</span></label>
    <textarea class="bs-input bs-prompt" data-action="edit" data-q-id="${q.id}" data-field="prompt" rows="2" placeholder="One clear idea, conversational…">${escapeHTML(q.prompt)}</textarea>
    ${(() => { const lk = leakageRisk(q); return lk.risk !== 'low' ? `<div class="bs-leak"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><span class="bs-leak-txt">${escapeHTML(lk.reason)}</span><button class="bs-mini-btn" data-action="make-scenario" data-q-id="${q.id}" ${studioUi.generating ? 'disabled' : ''}>${studioUi.scenarioQid === q.id ? 'Rewriting…' : 'Make it a scenario'}</button></div>` : ''; })()}

    <div class="bs-meta-row">
      <select class="bs-input bs-select" data-action="edit" data-q-id="${q.id}" data-field="questionType">
        ${QUESTION_TYPES.map((t) => `<option value="${t}" ${q.questionType === t ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
      <select class="bs-input bs-select" data-action="edit" data-q-id="${q.id}" data-field="difficulty">
        ${CONTRACT_DIFFICULTY.map((d) => `<option value="${d}" ${q.difficulty === d ? 'selected' : ''}>${d}</option>`).join('')}
      </select>
      <div class="bs-min"><input class="bs-input" type="number" min="1" max="15" value="${q.estimatedMinutes}" data-action="edit" data-q-id="${q.id}" data-field="estimatedMinutes" /> min</div>
      <button class="bs-icon-btn danger" data-action="delete-question" data-q-id="${q.id}" title="Delete question"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg></button>
    </div>

    <div class="bs-rubric">
      <div class="bs-model">
        <div class="bs-model-label">Model answer <span class="bs-faint">· what strong looks like</span></div>
        <textarea class="bs-input" data-action="edit" data-q-id="${q.id}" data-field="modelAnswer" rows="2" placeholder="2–3 sentences the evaluator grades against…">${escapeHTML(q.modelAnswer)}</textarea>
      </div>

      <div class="bs-rg-label"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Required points <span class="bs-faint">· weighted 1–3</span></div>
      ${r.requiredPoints.map((p, i) => pointRow(q.id, 'required', i, p)).join('')}
      <button class="bs-mini-btn ghost" data-action="add-point" data-q-id="${q.id}" data-kind="required">+ point</button>

      <div class="bs-rg-label"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Secondary points <span class="bs-faint">· nice-to-have, lower weight</span></div>
      ${r.secondaryPoints.map((p, i) => pointRow(q.id, 'secondary', i, p)).join('')}
      <button class="bs-mini-btn ghost" data-action="add-point" data-q-id="${q.id}" data-kind="secondary">+ point</button>

      <div class="bs-rg-label"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2"><polygon points="12 2 15 9 22 9 17 14 19 21 12 17 5 21 7 14 2 9 9 9"/></svg> Excellence signals <span class="bs-faint">· separates great from good</span></div>
      ${r.excellentAnswerSignals.map((p, i) => pointRow(q.id, 'excellent', i, p)).join('')}
      <button class="bs-mini-btn ghost" data-action="add-point" data-q-id="${q.id}" data-kind="excellent">+ signal</button>

      <div class="bs-rg-label"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg> Red flags</div>
      ${r.redFlags.map((f, i) => flagRow(q.id, i, f)).join('')}
      <button class="bs-mini-btn ghost" data-action="add-flag" data-q-id="${q.id}">+ red flag</button>

      <label class="bs-fld-label" style="margin-top:12px;">Follow-up intent <span class="bs-faint">· when the avatar should probe</span></label>
      <textarea class="bs-input" data-action="edit" data-q-id="${q.id}" data-field="followUpIntent" rows="1" placeholder="e.g. if vague on numbers, press for a concrete estimate">${escapeHTML(q.followUpIntent)}</textarea>
    </div>`;
}

function pointRow(qid, kind, idx, p) {
  const showWeight = kind !== 'excellent';
  return `
  <div class="bs-point-wrap">
    <div class="bs-point">
      <input class="bs-input bs-point-text" data-action="edit-point" data-q-id="${qid}" data-kind="${kind}" data-idx="${idx}" data-field="description" value="${escapeHTML(p.description)}" placeholder="What a correct answer covers…" />
      ${showWeight ? `<div class="bs-weight" data-action="set-weight" data-q-id="${qid}" data-kind="${kind}" data-idx="${idx}">
        ${[1, 2, 3].map((w) => `<span class="bs-wdot ${p.weight >= w ? 'on' : ''}" data-w="${w}" title="weight ${w}"></span>`).join('')}
      </div>` : ''}
      <button class="bs-icon-btn" data-action="remove-point" data-q-id="${qid}" data-kind="${kind}" data-idx="${idx}" title="Remove"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>
    <input class="bs-input bs-point-kw" data-action="edit-point" data-q-id="${qid}" data-kind="${kind}" data-idx="${idx}" data-field="keywords" value="${escapeHTML((p.keywords || []).join(', '))}" placeholder="keywords the evaluator matches · comma-separated" />
  </div>`;
}

function flagRow(qid, idx, f) {
  const c = tint(SEV_TINT, f.severity);
  return `
  <div class="bs-point">
    <input class="bs-input bs-point-text" data-action="edit-flag" data-q-id="${qid}" data-idx="${idx}" data-field="description" value="${escapeHTML(f.description)}" placeholder="A realistic failure signal…" />
    <select class="bs-input bs-sev-select" style="color:${c};border-color:${c}40;" data-action="edit-flag" data-q-id="${qid}" data-idx="${idx}" data-field="severity">
      ${SEVERITY_LEVELS.map((s) => `<option value="${s}" ${f.severity === s ? 'selected' : ''}>${s}</option>`).join('')}
    </select>
    <button class="bs-icon-btn" data-action="remove-flag" data-q-id="${qid}" data-idx="${idx}" title="Remove"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
  </div>`;
}

function screeningCanvas(job) {
  const sb = screeningOf(job);
  const panel = (studioUi.suggestingScreening || studioUi.screeningSuggestions) ? screeningSuggestPanel() : '';
  const head = `
    <div class="bs-canvas-head">
      <div><div class="bs-canvas-title">Recruiter screening</div><div class="bs-canvas-sub">${sb.questions.length ? `${sb.questions.length} questions · short, warm, voice-friendly` : 'A short recruiter gate — background, motivation, and logistics.'}</div></div>
      <div class="bs-canvas-actions">
        <button class="bs-mini-btn primary" data-action="suggest-screening" ${studioUi.suggestingScreening ? 'disabled' : ''}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2z"/></svg> Suggest</button>
        <button class="bs-mini-btn" data-action="add-screening"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Question</button>
      </div>
    </div>`;
  const rows = sb.questions.length
    ? sb.questions.map((q, i) => `
      <div class="bs-screen-row">
        <span class="bs-q-num">${i + 1}</span>
        <textarea class="bs-input" data-action="edit" data-q-id="${q.id}" data-field="prompt" rows="1" placeholder="Ask something short…">${escapeHTML(q.prompt)}</textarea>
        <button class="bs-icon-btn danger" data-action="delete-question" data-q-id="${q.id}" title="Delete"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg></button>
      </div>`).join('')
    : emptyState('No screening questions yet', 'Hit Suggest for a few role-tuned questions, or add your own.');
  return `${head}${panel}${rows}`;
}

// Pop-up of suggested recruiter-screening questions — click one to add it.
function screeningSuggestPanel() {
  if (studioUi.suggestingScreening) {
    return `<div class="bs-suggest bs-reveal">
      <div class="bs-suggest-head"><div>
        <div class="bs-suggest-title">Thinking of good screening questions…</div>
        <div class="bs-suggest-sub">Short, warm, voice-friendly questions tuned to this role.</div>
      </div></div>
      <div class="bs-sugg-skel"><div class="bs-shimmer"></div></div>
      <div class="bs-sugg-skel"><div class="bs-shimmer"></div></div>
    </div>`;
  }
  const list = studioUi.screeningSuggestions || [];
  if (!list.length) return '';
  return `<div class="bs-suggest bs-reveal">
    <div class="bs-suggest-head">
      <div>
        <div class="bs-suggest-title">Suggested screening questions</div>
        <div class="bs-suggest-sub">Click one to add it — tweak the wording after.</div>
      </div>
      <button class="bs-icon-btn" data-action="dismiss-screening-suggest" title="Dismiss"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>
    ${list.map((p, i) => `
      <button class="bs-sugg-item on bs-sugg-pick" data-action="add-screening-suggestion" data-idx="${i}">
        <span class="bs-sugg-plus"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></span>
        <span class="bs-sugg-body"><span class="bs-sugg-name">${escapeHTML(p)}</span></span>
      </button>`).join('')}
    <div class="bs-suggest-foot">
      <span class="bs-suggest-count"><b>${list.length}</b> suggestion${list.length !== 1 ? 's' : ''}</span>
      <button class="bs-mini-btn ghost" data-action="suggest-screening"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Re-suggest</button>
    </div>
  </div>`;
}

function emptyState(title, desc) {
  return `<div class="bs-empty"><div class="bs-empty-icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div><p class="bs-empty-title">${escapeHTML(title)}</p><p class="bs-empty-desc">${escapeHTML(desc)}</p></div>`;
}

// ── Inspector (one section at a time) ────────────────────────────────────────
function inspectorMarkup(job, fb, cov, cal) {
  const issueCount = critiqueBlueprint(fb).reduce((a, x) => a + x.issues.length, 0);
  const tabs = [['coverage', 'Coverage'], ['review', issueCount ? `Review · ${issueCount}` : 'Review'], ['preview', 'Preview'], ['calibrate', 'Calibrate']];
  return `
    <div class="bs-panel">
      <div class="bs-seg">
        ${tabs.map(([k, label]) => `<button class="bs-seg-btn ${studioUi.inspectorTab === k ? 'active' : ''}" data-action="inspector-tab" data-tab="${k}">${label}</button>`).join('')}
      </div>
      ${studioUi.inspectorTab === 'coverage' ? coveragePanel(cov)
        : studioUi.inspectorTab === 'review' ? reviewPanel(fb)
        : studioUi.inspectorTab === 'preview' ? previewPanel(job, fb)
        : calibratePanel(cal, computeBandFit(job, fb))}
    </div>`;
}

// Rubric critic surfaced as a punch-list: jump straight to a flagged question.
function reviewPanel(fb) {
  const flagged = critiqueBlueprint(fb);
  if (!flagged.length) {
    return `<div class="bs-insp-h">Rubric review</div><p class="bs-faint" style="font-size:12px;line-height:1.5;">No rubric issues found. Required points look measurable, red flags realistic, and model answers fit their difficulty.</p>`;
  }
  const total = flagged.reduce((a, x) => a + x.issues.length, 0);
  return `
    <div class="bs-insp-h">Rubric review · ${total} issue${total !== 1 ? 's' : ''} · ${flagged.length} question${flagged.length !== 1 ? 's' : ''}</div>
    ${flagged.map((x) => `
      <div class="bs-rev-item">
        <button class="bs-rev-q" data-action="jump-question" data-q-id="${x.questionId}">${escapeHTML(x.prompt) || 'Untitled question'}</button>
        ${x.issues.map((i) => `<div class="bs-rev-issue ${i.level}"><span class="bs-rev-dot"></span><span>${escapeHTML(i.message)}</span></div>`).join('')}
      </div>`).join('')}`;
}

function coveragePanel(cov) {
  if (!cov.length) return `<p class="bs-faint" style="font-size:12px;">No must-have requirements on this job yet. Add them in the Resume stage to see coverage.</p>`;
  const ico = { ok: ['#34d399', 'M20 6 9 17l-5-5'], thin: ['#fbbf24', 'M12 9v4M12 17h.01'], gap: ['#f87171', 'M18 6 6 18M6 6l12 12'] };
  return `
    <div class="bs-insp-h">JD coverage · ${cov.length} must-have${cov.length !== 1 ? 's' : ''}</div>
    ${cov.map((c) => {
      const [color, path] = ico[c.status];
      const drafting = studioUi.draftingReq === c.requirement;
      return `<div class="bs-cov-item">
        <span class="bs-cov-ico" style="background:${color}22;color:${color};"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="${path}"/></svg></span>
        <span class="bs-cov-name">${escapeHTML(c.requirement)}</span>
        <span class="bs-cov-tag">${c.status === 'gap' ? 'gap' : c.status === 'thin' ? 'thin' : `${c.count} Qs`}</span>
        ${c.status !== 'ok' ? `<button class="bs-cov-draft" data-action="draft-gap" data-req="${escapeHTML(c.requirement)}" ${studioUi.generating ? 'disabled' : ''} title="Draft a question that tests this requirement">${drafting ? '…' : '+ Q'}</button>` : ''}
      </div>`;
    }).join('')}`;
}

function previewPanel(job, fb) {
  const first = allQuestions(fb)[0];
  const prompt = first ? first.q.prompt : 'Generate a blueprint to preview how Lina will ask it.';
  return `
    <div class="bs-insp-h">Preview as avatar</div>
    <div class="bs-preview">
      <div class="bs-av-row"><div class="bs-avatar">L</div><div><div class="bs-av-name">Lina</div><div class="bs-av-status"><span class="bs-pulse"></span> ${first ? 'asking Q1 · voice' : 'idle'}</div></div></div>
      <div class="bs-bubble">${escapeHTML(prompt)}</div>
      <div class="bs-wave">${[40, 70, 100, 55, 85, 35, 65, 95, 45, 75, 30, 60, 88, 50, 72].map((h) => `<i style="height:${h}%"></i>`).join('')}</div>
    </div>
    <p class="bs-faint" style="font-size:11px;margin-top:10px;">Scripted read now — becomes a live VAPI test call once wired to the backend.</p>`;
}

function calibratePanel(cal, fit) {
  const dims = [['Questions', cal.questionCount], ['Topics', cal.topicCount], ['Minutes', cal.totalMinutes], ['Rubric ready', `${cal.rubricCoverage}%`]];
  const mix = CONTRACT_DIFFICULTY.map((d) => [d, cal.difficultyMix[d] || 0]);
  const hasBand = !!fit.band;
  const maxMix = Math.max(1, ...mix.map(([, n]) => n), ...CONTRACT_DIFFICULTY.map((d) => fit.targetCount[d] || 0));
  return `
    <div class="bs-insp-h">Calibration${hasBand ? ` · ${escapeHTML(fit.tierLabel)} band` : ''}</div>
    <div class="bs-metric-grid">${dims.map(([l, v]) => `<div class="bs-metric"><div class="bs-m-label">${l}</div><div class="bs-m-val">${v}</div></div>`).join('')}</div>
    <div class="bs-rg-label" style="margin-top:14px;">Difficulty curve${hasBand ? ` <span class="bs-faint">· tick = ${escapeHTML(fit.tierLabel)} target</span>` : ''}</div>
    ${mix.map(([d, n]) => {
      const target = fit.targetCount[d] || 0;
      return `<div class="bs-dim-row"><span class="bs-dim-name">${d}</span><span class="bs-dim-track">
        <span class="bs-dim-fill" style="width:${Math.round((n / maxMix) * 100)}%;background:${tint(DIFF_TINT, d)};"></span>
        ${hasBand ? `<span class="bs-dim-target" style="left:${Math.min(100, Math.round((target / maxMix) * 100))}%;" title="target ${target}"></span>` : ''}
      </span><span class="bs-dim-pct">${n}${hasBand ? `<span class="bs-faint"> / ${target}</span>` : ''}</span></div>`;
    }).join('')}
    ${fit.recommendations.length ? `
      <div class="bs-rg-label" style="margin-top:14px;">Band fit</div>
      ${fit.recommendations.map((r) => `<div class="bs-rev-issue ${r.level === 'info' ? 'info' : ''}"><span class="bs-rev-dot"></span><span>${escapeHTML(r.message)}</span></div>`).join('')}`
      : hasBand && cal.questionCount ? `<p class="bs-faint" style="font-size:11px;margin-top:12px;">Difficulty mix fits the ${escapeHTML(fit.tierLabel)} band.</p>` : ''}`;
}

// ── Interactions (event delegation on the pane) ──────────────────────────────
function bindStudio(pane, job) {
  const reRender = () => renderBlueprintStudio(job);

  pane.onclick = async (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    const qid = el.dataset.qid || el.dataset.qId || el.getAttribute('data-q-id');

    switch (action) {
      case 'mode':
        studioUi.mode = el.dataset.mode;
        studioUi.expandedQuestionId = null;
        studioUi.editingSuggId = null;
        soundEngine.playClick(); reRender(); break;
      case 'toggle-inspector':
        studioUi.inspectorOpen = !studioUi.inspectorOpen; soundEngine.playClick(); reRender(); break;
      case 'toggle-edit':
        studioUi.editMode = !studioUi.editMode; soundEngine.playClick(); reRender(); break;
      case 'toggle-suggest':
        studioUi.suggestCollapsed = !studioUi.suggestCollapsed; soundEngine.playClick(); reRender(); break;
      case 'inspector-tab':
        studioUi.inspectorTab = el.dataset.tab; reRender(); break;
      case 'draft-gap':
        await handleDraftGap(job, el.dataset.req, reRender); break;
      case 'make-scenario':
        await handleScenarioVariant(job, qid, reRender); break;
      case 'jump-question': {
        const fb = functionalOf(job);
        const topic = (fb.topics || []).find((t) => t.questions.some((q) => q.id === qid));
        if (topic) studioUi.expandedTopicId = topic.id;
        studioUi.expandedQuestionId = qid;
        soundEngine.playClick();
        reRender();
        const node = document.querySelector(`[data-q-id="${qid}"]`);
        if (node && node.scrollIntoView) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
        break;
      }
      case 'toggle-topic': {
        const tid = el.dataset.topicId;
        studioUi.expandedTopicId = studioUi.expandedTopicId === tid ? null : tid;
        soundEngine.playClick(); reRender(); break;
      }
      case 'toggle-question':
        studioUi.expandedQuestionId = studioUi.expandedQuestionId === qid ? null : qid;
        soundEngine.playClick(); reRender(); break;
      case 'generate':
        await handleGenerate(job, reRender); break;
      case 'suggest-topics':
        await handleSuggestTopics(job, reRender); break;
      case 'generate-from-topics': {
        const seed = (studioUi.topicSuggestions || []).filter((s) => s.accepted && (s.name || '').trim());
        if (!seed.length) { showPremiumToast('Keep at least one topic to generate from.', 'error'); break; }
        await handleGenerate(job, reRender, { seed }); break;
      }
      case 'toggle-topic-suggestion': {
        const s = (studioUi.topicSuggestions || []).find((x) => x.id === el.dataset.suggId);
        if (s) { s.accepted = !s.accepted; soundEngine.playClick(); reRender(); } break;
      }
      case 'edit-topic-suggestion': {
        studioUi.editingSuggId = el.dataset.suggId; reRender();
        const node = document.querySelector(`.bs-sugg-item[data-sugg-id="${el.dataset.suggId}"] .bs-sugg-name-input`);
        if (node && node.focus) node.focus();
        break;
      }
      case 'done-suggestion':
        studioUi.editingSuggId = null; soundEngine.playClick(); reRender(); break;
      case 'add-topic-suggestion': {
        if (!studioUi.topicSuggestions) studioUi.topicSuggestions = [];
        const ns = createTopicSuggestion({ name: '', accepted: true });
        studioUi.topicSuggestions.push(ns);
        studioUi.editingSuggId = ns.id;
        reRender();
        const node = document.querySelector(`.bs-sugg-item[data-sugg-id="${ns.id}"] .bs-sugg-name-input`);
        if (node && node.focus) node.focus();
        break;
      }
      case 'autofill-outline': {
        autofillOutlineNotes(functionalOf(job), job);
        persist(); reRender();
        showPremiumToast('Filled empty run-sheet notes from the rubric.', 'success');
        soundEngine.playChime([523.25, 659.25], 0.12, 0.08);
        break;
      }
      case 'copy-runsheet':
        copyToClipboard(runSheetMarkdown(job, functionalOf(job))); break;
      case 'print-runsheet':
        if (typeof window !== 'undefined' && window.print) window.print(); break;
      case 'add-topic': {
        functionalOf(job).topics.push(createTopic({ name: 'New topic' }));
        persist(); reRender(); break;
      }
      case 'add-question': {
        const topic = functionalOf(job).topics.find((t) => t.id === el.dataset.topicId);
        if (topic) { const nq = createQuestionBlueprint({ difficulty: topic.difficulty, edited: true }); topic.questions.push(nq); studioUi.expandedQuestionId = nq.id; persist(); reRender(); }
        break;
      }
      case 'add-screening': {
        const nq = createQuestionBlueprint({ questionType: 'hr_screening', difficulty: 'Easy' });
        screeningOf(job).questions.push(nq); persist(); reRender(); break;
      }
      case 'suggest-screening':
        await handleSuggestScreening(job, reRender); break;
      case 'add-screening-suggestion': {
        const list = studioUi.screeningSuggestions || [];
        const idx = Number(el.dataset.idx);
        const prompt = list[idx];
        if (prompt) {
          const sb = screeningOf(job);
          // Fill the first empty question if there is one, else append a new one.
          const empty = sb.questions.find((q) => !String(q.prompt || '').trim());
          if (empty) empty.prompt = prompt;
          else sb.questions.push(createQuestionBlueprint({ questionType: 'hr_screening', difficulty: 'Easy', prompt }));
          studioUi.screeningSuggestions = list.filter((_, i) => i !== idx);
          persist(); reRender(); soundEngine.playClick();
        }
        break;
      }
      case 'dismiss-screening-suggest':
        studioUi.screeningSuggestions = null; studioUi.suggestingScreening = false; reRender(); break;
      case 'delete-question': deleteQuestion(job, qid); persist(); reRender(); break;
      case 'delete-topic': deleteTopic(job, el.dataset.topicId); persist(); reRender(); break;
      case 'add-point': { const { q } = findQuestion(job, qid); const pts = pointsOf(q, el.dataset.kind); if (pts) { q.edited = true; pts.push(createRubricPoint('', el.dataset.kind === 'required' ? 2 : 1)); persist(); reRender(); } break; }
      case 'remove-point': { const { q } = findQuestion(job, qid); const pts = pointsOf(q, el.dataset.kind); if (pts) { q.edited = true; pts.splice(Number(el.dataset.idx), 1); persist(); reRender(); } break; }
      case 'add-flag': { const { q } = findQuestion(job, qid); if (q) { q.edited = true; q.rubric.redFlags.push(createRedFlag('', 'medium')); persist(); reRender(); } break; }
      case 'remove-flag': { const { q } = findQuestion(job, qid); if (q) { q.edited = true; q.rubric.redFlags.splice(Number(el.dataset.idx), 1); persist(); reRender(); } break; }
      case 'set-weight': {
        const dot = e.target.closest('.bs-wdot'); if (!dot) break;
        const { q } = findQuestion(job, qid); if (!q) break;
        const w = Number(dot.dataset.w);
        const pts = pointsOf(q, el.dataset.kind);
        const pt = pts && pts[Number(el.dataset.idx)];
        if (pt) { pt.weight = w; q.edited = true; }
        // update dots in place so the editor doesn't re-render and lose focus/flicker
        el.querySelectorAll('.bs-wdot').forEach((d) => d.classList.toggle('on', Number(d.dataset.w) <= w));
        persist(); break;
      }
      default: break;
    }
  };

  // Live edits — update model + save without a full re-render (keeps focus).
  pane.oninput = (e) => {
    // Suggested-topic curation edits — transient UI state, no persist/re-render.
    const sg = e.target.closest('[data-action="edit-suggestion"]');
    if (sg) {
      const s = (studioUi.topicSuggestions || []).find((x) => x.id === sg.dataset.suggId);
      if (s) s[sg.dataset.field] = sg.value;
      return;
    }
    // Run-sheet prose edits (Outline mode) — persist, no re-render (keeps focus).
    const ol = e.target.closest('[data-action="input-outline"]');
    if (ol) { applyOutlineEdit(job, ol); return; }

    // Inline topic rename (edit mode) — persist, no re-render (keeps focus).
    const tn = e.target.closest('[data-action="edit-topic-name"]');
    if (tn) {
      const topic = (functionalOf(job).topics || []).find((t) => t.id === tn.dataset.topicId);
      if (topic) { topic.name = tn.value; persist(); }
      return;
    }

    const el = e.target.closest('[data-action="edit"], [data-action="edit-point"], [data-action="edit-flag"]');
    if (!el) return;
    const { q } = findQuestion(job, el.getAttribute('data-q-id'));
    if (!q) return;
    const field = el.dataset.field;
    if (el.dataset.action === 'edit' && field === 'difficulty') return;
    if (el.dataset.action === 'edit') {
      q[field] = field === 'estimatedMinutes' ? Number(el.value) : el.value;
    } else if (el.dataset.action === 'edit-point') {
      const pts = pointsOf(q, el.dataset.kind);
      const p = pts && pts[Number(el.dataset.idx)];
      if (p) p[field] = field === 'keywords' ? el.value.split(',').map((k) => k.trim()).filter(Boolean) : el.value;
    } else if (el.dataset.action === 'edit-flag') {
      const f = q.rubric.redFlags[Number(el.dataset.idx)];
      if (f) f[field] = el.value;
    }
    q.edited = true;
    persist();
  };

  // Changing difficulty regenerates the question to that level (same competency);
  // questionType/severity just re-render so chips/tints update.
  pane.onchange = (e) => {
    const diff = e.target.closest('[data-action="edit"][data-field="difficulty"]');
    if (diff) { handleDifficultyRegen(job, diff.dataset.qId, reRender, diff.value); return; }
    const el = e.target.closest('.bs-select, .bs-sev-select');
    if (el) reRender();
  };

  // Drag-to-reorder: topics anywhere, questions within their topic.
  pane.ondragstart = (e) => {
    // Let the inline topic-name input select text instead of dragging its bar.
    if (e.target.closest('.bs-topic-name-input')) { e.preventDefault(); return; }
    const tBar = e.target.closest('.bs-topic-bar');
    const qCard = e.target.closest('.bs-qcard');
    if (tBar) {
      const topic = tBar.closest('.bs-topic');
      dragState = { kind: 'topic', id: topic.dataset.topicId };
      topic.classList.add('bs-dragging');
    } else if (qCard && qCard.getAttribute('draggable') === 'true') {
      dragState = { kind: 'q', id: qCard.dataset.qId };
      qCard.classList.add('bs-dragging');
    } else {
      return;
    }
    e.dataTransfer.effectAllowed = 'move';
  };
  pane.ondragover = (e) => { if (dragState) e.preventDefault(); };
  pane.ondrop = (e) => {
    if (!dragState) return;
    e.preventDefault();
    if (dragState.kind === 'topic') {
      const t = e.target.closest('.bs-topic');
      if (t && t.dataset.topicId !== dragState.id) reorderTopics(job, dragState.id, t.dataset.topicId, e);
    } else {
      const c = e.target.closest('.bs-qcard');
      if (c && c.dataset.qId !== dragState.id) reorderQuestion(job, dragState.id, c.dataset.qId, e);
    }
    dragState = null;
    persist(); reRender();
  };
  pane.ondragend = () => {
    dragState = null;
    pane.querySelectorAll('.bs-dragging').forEach((el) => el.classList.remove('bs-dragging'));
  };
}

function dropsAfter(targetEl, e) {
  if (!targetEl) return false;
  const r = targetEl.getBoundingClientRect();
  return e.clientY > r.top + r.height / 2;
}

function reorderTopics(job, fromId, toId, e) {
  const topics = functionalOf(job).topics;
  const moved = topics.find((t) => t.id === fromId);
  if (!moved) return;
  topics.splice(topics.indexOf(moved), 1);
  const idx = topics.findIndex((t) => t.id === toId);
  if (idx < 0) { topics.push(moved); return; }
  const after = dropsAfter(document.querySelector(`.bs-topic[data-topic-id="${toId}"]`), e);
  topics.splice(after ? idx + 1 : idx, 0, moved);
}

function reorderQuestion(job, fromId, toId, e) {
  for (const t of functionalOf(job).topics) {
    const fi = t.questions.findIndex((q) => q.id === fromId);
    const ti = t.questions.findIndex((q) => q.id === toId);
    if (fi >= 0 && ti >= 0) {
      const [moved] = t.questions.splice(fi, 1);
      const idx = t.questions.findIndex((q) => q.id === toId);
      const after = dropsAfter(document.querySelector(`.bs-qcard[data-q-id="${toId}"]`), e);
      t.questions.splice(after ? idx + 1 : idx, 0, moved);
      return;
    }
  }
}

function deleteQuestion(job, qid) {
  for (const t of functionalOf(job).topics) {
    const i = t.questions.findIndex((q) => q.id === qid);
    if (i >= 0) { t.questions.splice(i, 1); return; }
  }
  const sb = screeningOf(job);
  const j = sb.questions.findIndex((q) => q.id === qid);
  if (j >= 0) sb.questions.splice(j, 1);
}

function deleteTopic(job, topicId) {
  const topics = functionalOf(job).topics;
  const i = topics.findIndex((t) => t.id === topicId);
  if (i >= 0) topics.splice(i, 1);
  if (studioUi.expandedTopicId === topicId) studioUi.expandedTopicId = null;
}

// Rewrite a googleable question in place as an applied scenario (keeps its id +
// position so the canvas doesn't jump). AI-first, local fallback.
async function handleScenarioVariant(job, qid, reRender) {
  const { q } = findQuestion(job, qid);
  if (!q || studioUi.generating) return;
  studioUi.generating = true;
  studioUi.scenarioQid = qid;
  studioUi.genLabel = 'Rewriting as scenario…';
  reRender();
  soundEngine.playChime([392, 440], 0.1, 0.1);

  let v;
  let offline = false;
  try { v = await generateScenarioVariant(job, q); }
  catch { v = localScenarioVariant(q); offline = true; }

  q.prompt = v.prompt;
  q.questionType = v.questionType;
  q.difficulty = v.difficulty;
  q.estimatedMinutes = v.estimatedMinutes;
  q.competency = v.competency;
  q.modelAnswer = v.modelAnswer;
  q.rubric = v.rubric;
  q.followUpIntent = v.followUpIntent;
  q.edited = true; // recruiter-initiated rewrite → preserve on regenerate

  studioUi.generating = false;
  studioUi.scenarioQid = null;
  studioUi.genLabel = null;
  studioUi.expandedQuestionId = q.id;
  persist();
  reRender();
  showPremiumToast(offline ? 'Rewritten as a scenario offline.' : 'Rewritten as an applied scenario.', 'success');
  soundEngine.playChime([523.25, 659.25, 783.99], 0.18, 0.07);
}

// Regenerate a question to match a newly picked difficulty — same competency,
// recalibrated prompt + rubric. Fires when the difficulty <select> changes.
// AI-first, local fallback. Keeps the question's id + position.
async function handleDifficultyRegen(job, qid, reRender, target) {
  const { q } = findQuestion(job, qid);
  if (!q || studioUi.generating) return;
  studioUi.generating = true;
  studioUi.scenarioQid = qid;
  studioUi.genLabel = `Retuning to ${target}…`;
  studioUi.expandedQuestionId = qid;
  reRender();
  soundEngine.playChime([392, 440], 0.1, 0.1);

  let v;
  let offline = false;
  try { v = await generateDifficultyVariant(job, q, target); }
  catch { v = localDifficultyVariant(q, target); offline = true; }

  q.prompt = v.prompt;
  q.questionType = v.questionType;
  q.difficulty = v.difficulty;
  q.estimatedMinutes = v.estimatedMinutes;
  q.competency = v.competency;
  q.modelAnswer = v.modelAnswer;
  q.rubric = v.rubric;
  q.followUpIntent = v.followUpIntent;
  q.edited = true;

  studioUi.generating = false;
  studioUi.scenarioQid = null;
  studioUi.genLabel = null;
  studioUi.expandedQuestionId = q.id;
  persist();
  reRender();
  showPremiumToast(offline ? `Retuned to ${q.difficulty} offline.` : `Retuned the question to ${q.difficulty}.`, 'success');
  soundEngine.playChime([523.25, 659.25, 783.99], 0.18, 0.07);
}

// Draft a single question that closes one uncovered/thin must-have and place it
// under that requirement's own role-specific topic. AI-first, local fallback.
async function handleDraftGap(job, requirement, reRender) {
  if (!requirement || studioUi.generating) return;
  studioUi.generating = true;
  studioUi.draftingReq = requirement;
  studioUi.genLabel = 'Drafting question…';
  reRender();
  soundEngine.playChime([392, 440], 0.1, 0.1);

  let q;
  let offline = false;
  try { q = await generateGapQuestion(job, requirement); }
  catch { q = localGapQuestion(job, requirement); offline = true; }
  // Pin it so the coverage panel registers this requirement as covered (and the
  // "+ Q" button stops offering to draft a duplicate for the same requirement).
  q.targetRequirement = requirement;
  q.edited = true; // recruiter-initiated → preserve on regenerate

  const fb = functionalOf(job);
  const normalizedRequirement = String(requirement).trim().toLowerCase();
  let topic = fb.topics.find((t) => String(t.name || '').trim().toLowerCase() === normalizedRequirement);
  if (!topic) { topic = createTopic({ name: requirement, type: 'Experiential' }); fb.topics.push(topic); }
  topic.questions.push(q);

  studioUi.expandedTopicId = topic.id;
  studioUi.expandedQuestionId = q.id;
  studioUi.generating = false;
  studioUi.draftingReq = null;
  studioUi.genLabel = null;
  persist();
  reRender();
  showPremiumToast(offline ? `Drafted a question for “${requirement}” offline.` : `Drafted a question for “${requirement}”.`, 'success');
  soundEngine.playChime([523.25, 659.25, 783.99], 0.18, 0.07);
  const node = document.querySelector(`[data-q-id="${q.id}"]`);
  if (node && node.scrollIntoView) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// Recommend the topic areas worth probing for this role, with rationale, into a
// curation gate the recruiter edits before generating. AI-first, local fallback.
async function handleSuggestTopics(job, reRender) {
  if (studioUi.generating || studioUi.suggestingTopics) return;
  if (!(job.description || '').trim() && !(job.resumeCriteria?.mustHave || []).length) {
    showPremiumToast('Add a job description so the AI can recommend topics.', 'error');
    return;
  }
  studioUi.suggestingTopics = true;
  studioUi.topicSuggestions = null;
  studioUi.editingSuggId = null;
  reRender();
  soundEngine.playChime([392, 440], 0.1, 0.1);

  const plan = computeGenerationPlan(job);
  let requirements = plan.requirements;
  try { requirements = await analyzeRequirements(job); } catch { requirements = plan.requirements; }

  let list, offline = false;
  try { list = await suggestTopics(job, requirements); }
  catch { list = localTopicSuggestions(job, requirements); offline = true; }

  studioUi.suggestingTopics = false;
  studioUi.topicSuggestions = list;
  reRender();
  showPremiumToast(offline ? 'Suggested topics offline — keep the ones worth probing.' : 'Topics suggested — keep the ones worth probing.', 'success');
  soundEngine.playChime([523.25, 659.25, 783.99], 0.18, 0.07);
}

// Suggest a fresh set of recruiter-screening questions (AI-first, local fallback),
// minus any already on the list, into a click-to-add pop-up.
async function handleSuggestScreening(job, reRender) {
  if (studioUi.suggestingScreening) return;
  studioUi.suggestingScreening = true;
  studioUi.screeningSuggestions = null;
  reRender();
  soundEngine.playChime([392, 440], 0.1, 0.1);

  let sb, offline = false;
  try { sb = await generateScreeningQuestions(job); if (!sb.questions.length) throw new Error('empty'); }
  catch { sb = localScreeningQuestions(job); offline = true; }

  const norm = (s) => String(s || '').trim().toLowerCase();
  const have = new Set(screeningOf(job).questions.map((q) => norm(q.prompt)));
  const list = sb.questions.map((q) => String(q.prompt || '').trim()).filter((p) => p && !have.has(norm(p)));

  studioUi.suggestingScreening = false;
  studioUi.screeningSuggestions = list;
  reRender();
  if (!list.length) { showPremiumToast('No new suggestions — you already cover the basics.', 'success'); return; }
  showPremiumToast(offline ? 'Suggested screening questions offline — click to add.' : 'Suggested screening questions — click to add.', 'success');
  soundEngine.playChime([523.25, 659.25, 783.99], 0.18, 0.07);
}

// Stamp each generated topic's "why it matters" from the matching accepted
// suggestion's rationale (only when the topic has none yet).
function stampSeedRationale(fb, seed) {
  if (!seed.length) return;
  const byName = new Map<string, any>(seed.map((s) => [String(s.name || '').trim().toLowerCase(), s]));
  (fb.topics || []).forEach((t) => {
    if (txt(t.whyItMatters)) return;
    const s = byName.get(String(t.name || '').trim().toLowerCase());
    if (s && txt(s.rationale)) t.whyItMatters = s.rationale;
  });
}

async function handleGenerate(job, reRender, opts: any = {}) {
  if (studioUi.generating) return;
  if (!(job.description || '').trim() && !(job.resumeCriteria?.mustHave || []).length) {
    showPremiumToast('Add a job description so the AI can target questions.', 'error');
    return;
  }
  // Seeded generation (from the curation gate): the accepted suggestions shape
  // the topics, which are appended to any existing blueprint.
  const seed = Array.isArray(opts.seed) ? opts.seed : [];

  studioUi.generating = true;
  studioUi.genLabel = studioUi.mode === MODE_FUNCTIONAL ? 'Outlining…' : 'Generating…';
  reRender();
  soundEngine.playChime([392, 440], 0.1, 0.1);

  const finish = (msg) => {
    studioUi.generating = false; studioUi.genLabel = null; studioUi.topicSuggestions = null; studioUi.editingSuggId = null;
    persist(); reRender();
    showPremiumToast(msg, 'success');
    soundEngine.playChime([523.25, 659.25, 783.99], 0.18, 0.07);
  };

  if (studioUi.mode === MODE_SCREENING) {
    let sb, offline = false;
    try { sb = await generateScreeningQuestions(job); if (!sb.questions.length) throw new Error('empty'); }
    catch { sb = localScreeningQuestions(job); offline = true; }
    job.screeningBlueprint = sb;
    finish(offline ? 'Screening questions drafted offline.' : 'Screening questions generated.');
    return;
  }

  // Functional — phase 1: outline (small, fits the token cap), scaled to the
  // role's complexity and pinned to its required competencies.
  const existing = job.functionalParameters; // preserve hand-edited questions across regenerate
  const plan = computeGenerationPlan(job);
  let requirements = plan.requirements;
  // Isolate the (non-throwing) pre-pass so an LLM-expanded list never leaks into
  // the offline path's pinning, then size topicCount to the RESOLVED requirement
  // count so the outline prompt's "~N topics" hint can fit "cover every one".
  try { requirements = await analyzeRequirements(job); } catch { requirements = plan.requirements; }
  const topicCount = seed.length || Math.min(6, Math.max(plan.topicCount, Math.ceil(requirements.length / plan.questionsPerTopic) || plan.topicCount));

  let fb, aiOk = true;
  try {
    fb = await generateFunctionalOutline(job, { topicCount, questionsPerTopic: plan.questionsPerTopic, requirements, topicSeed: seed });
    if (!fb.topics.length) throw new Error('empty');
  } catch {
    fb = localFunctionalBlueprint(job);
    aiOk = false;
    requirements = plan.requirements; // offline template → pin to must-haves only, not the LLM-expanded list
  }
  // Pin every question to a required competency + fill any uncovered requirement
  // with a targeted gap question, so coverage is complete on both paths.
  fb = pinBlueprintToRequirements(job, fb, requirements);
  if (seed.length) {
    // Append path (Generate from N kept topics): add the freshly generated topics
    // to the existing blueprint, de-duped by name, instead of replacing it. Mutate
    // the live topics array in place and do NOT reassign job.functionalParameters,
    // so interviewStructure + suggestedTopics survive.
    stampSeedRationale(fb, seed);
    const existingTopics = existing.topics || (existing.topics = []);
    const seen = new Set(existingTopics.map((t) => String(t.name || '').trim().toLowerCase()));
    const newOnes = [];
    for (const t of fb.topics) {
      const key = String(t.name || '').trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key); newOnes.push(t);
    }
    existingTopics.push(...newOnes);
    if (newOnes[0]) studioUi.expandedTopicId = newOnes[0].id;
    // Phase 2 enriches only the newly added topics — they share object refs with
    // the live array, so their rubrics land on job.functionalParameters.topics.
    fb = { ...fb, topics: newOnes };
  } else {
    fb = mergeBlueprintPreservingEdits(existing, fb); // carry over hand-edited questions
    job.functionalParameters = fb;
    studioUi.expandedTopicId = fb.topics[0] ? fb.topics[0].id : null;
  }

  if (!aiOk) { autofillOutlineNotes(fb, job); finish('Blueprint drafted offline (template rubrics).'); return; }

  // Phase 2: enrich each question's rubric in its own small call, bounded
  // concurrency, re-rendering as each lands so badges fill in progressively.
  persist(); reRender();
  const queue = fb.topics.flatMap((t) => t.questions.map((q) => ({ q, topicName: t.name })));
  const total = queue.length;
  let done = 0;
  const worker = async () => {
    while (queue.length) {
      const { q, topicName } = queue.shift();
      if (q.edited) { done += 1; continue; } // never clobber a recruiter-edited question's rubric
      try {
        const r = await enrichQuestionRubric(job, q, topicName);
        // Re-check after the await: if the recruiter edited this question while
        // its enrich call was in flight, keep their work and drop the AI result.
        if (!q.edited) {
          q.modelAnswer = r.modelAnswer; q.rubric = r.rubric;
          if (r.followUpIntent) q.followUpIntent = r.followUpIntent;
        }
      } catch { /* keep the outline-only question; rubric badge stays 'missing' */ }
      done += 1;
      studioUi.genLabel = `Authoring rubrics ${done}/${total}`;
      persist(); reRender();
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, total) }, worker));
  // Now that rubrics exist, derive the run-sheet prose (only fills blanks).
  autofillOutlineNotes(fb, job);
  finish('Blueprint ready — outline populated.');
}

// Copy text to the clipboard with a user-visible toast either way.
function copyToClipboard(text) {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => showPremiumToast('Run sheet copied as Markdown.', 'success'),
        () => showPremiumToast('Couldn’t copy — try again or select manually.', 'error'),
      );
      return;
    }
  } catch { /* fall through */ }
  showPremiumToast('Clipboard unavailable in this browser.', 'error');
}

// Write one Outline-mode prose edit back to its canonical object. No re-render
// (focus-preserving); persist() handles localStorage + the debounced backend save.
function applyOutlineEdit(job, el) {
  const fb = functionalOf(job);
  const target = el.dataset.target;
  const val = el.value;
  if (target === 'opening' || target === 'closing') {
    const struct = structureOf(fb);
    struct[target === 'opening' ? 'openingLine' : 'closingLine'] = val;
  } else if (target === 'why' || target === 'segue') {
    const topic = (fb.topics || []).find((t) => t.id === el.dataset.topicId);
    if (topic) topic[target === 'why' ? 'whyItMatters' : 'segue'] = val;
  } else if (target === 'listen') {
    const { q } = findQuestion(job, el.getAttribute('data-q-id'));
    if (q) { q.listenFor = val.split('\n').map((s) => s.trim()).filter(Boolean); q.edited = true; }
  }
  // Grow the field with its content (no re-render → focus preserved).
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
  persist();
}
