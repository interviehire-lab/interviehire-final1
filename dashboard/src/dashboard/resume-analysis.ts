import { document, setTimeout } from './runtime';
import { escapeHTML, sourceLabel } from './escape';
import { callDeepSeekAPI, parseAIJson, saveStateToLocalStorage } from './ai-api';
import { renderJobDetailPanes } from './job-detail-panes';
import { appendTerminalLog } from './kanban-swarm';
import { openReportDrawerForCandidate } from './report';
import { computeWeightedScore, getScoringConfig, recommendationFromScore } from './scoring-config';
import { soundEngine } from './sound';
import { addCandidateToAppState, extractResumeIdentity, showPremiumToast } from './sourcing';
import { AppState } from './state';
import { getDataSource, apiUpdateApplicant, apiGetResumeText, apiAddApplicant } from './api';

// ==========================================
// RESUME ANALYSIS (AI-powered, Lina)
// ==========================================

const resumeTextCache = {};
const resumeIdentityCache = {};
const resumeAnalysisCache = {};
const reportChatCache = {};

// Resume text forwarded to the model. Was 5000 per MoE pass; one comprehensive
// call can take far more — DeepSeek's context is large and the proxy caps total
// prompt at 50k chars, so 12k of resume + JD + system stays well under.
const RESUME_TEXT_LIMIT = 12000;

// One comprehensive "Lina" reasoning prompt (restored from the pre-MoE design):
// the model reasons over facts + scoring + narrative together in a single pass so
// it can cross-check them. Emits exactly the shape normalizeDeepResult reads.
const LINA_SYSTEM_PROMPT = `You are Lina, an expert recruiting analyst for IntervieHire. You perform rigorous, evidence-first resume screening FOR RECRUITERS — they need to understand exactly how this candidate's real work history maps to THEIR role.

THINK DEEPLY, THEN REPORT:
- For every project in the resume, reason about what it actually proves: scale, the candidate's own contribution, and how directly it transfers to this specific role.
- Quote or paraphrase concrete resume evidence — never generic praise.
- Score each dimension 0-100 INDEPENDENTLY. Do NOT compute an overall score; the platform combines dimensions using the recruiter's own weights.
- Be honest. Thin or auto-generated resumes get low dimension scores and a note in the summary. Missing evidence = low score, not benefit of the doubt.

TRANSFERABILITY & RELEVANCE (the core of the job):
- Judge every project and role by how directly it maps to THIS role's day-to-day work — not by keyword overlap with the criteria text.
- For each MUST HAVE the candidate doesn't satisfy literally, look for adjacent/transferable evidence (a neighbouring tool, a harder version of the same skill, the same problem in another domain). If a credible bridge exists, mark the verdict "partial", name the bridge in the evidence, and lift the relevant dimension. If no honest bridge exists, mark it false.
- Reward genuinely transferable experience. Penalise generic or unrelated filler (buzzword lists, unrelated coursework, padding) — it does not raise a score.
- The "projects" dimension scores RELEVANCE to this role's work, not volume or polish.

DIMENSIONS (score each 0-100 with 1-line evidence):
- mustHave: coverage of the MUST HAVE list (100 = all clearly evidenced)
- niceToHave: coverage of GOOD TO HAVE list
- projects: how relevant the candidate's actual projects are to this role's day-to-day work
- experience: depth/seniority vs the required experience band
- education: degrees and certifications relevant to the role
- custom: performance against the RECRUITER CUSTOM CRITERIA only (ignore if none listed)

STRICT RULES:
- criteriaVerdicts must contain ONE entry per must-have, good-to-have and custom criterion with met true/false/"partial" and short evidence.
- "missing" lists ONLY criteria from the configured lists that lack evidence. Never invent skills.
- redFlagsDetected: ONLY configured RED FLAGS that are genuinely present AND fundamentally disqualifying. The mere ABSENCE of a must-have is NEVER a red flag (the platform gates that separately) — do not restate or negate a must-have here. Prefer an empty list over a weak flag.
- competencies: 4-6 role-specific competencies you derive from the job description, each with score and 2-4 evidence bullets.

Respond ONLY with valid JSON, no markdown fences:
{
  "summary": "2-3 sentences with specific evidence",
  "experienceYears": "e.g. 4 years",
  "dimensions": {
    "mustHave": {"score": 0, "evidence": ""}, "niceToHave": {"score": 0, "evidence": ""},
    "projects": {"score": 0, "evidence": ""}, "experience": {"score": 0, "evidence": ""},
    "education": {"score": 0, "evidence": ""}, "custom": {"score": 0, "evidence": ""}
  },
  "criteriaVerdicts": [{"criterion": "", "group": "mustHave|goodToHave|custom", "met": true, "evidence": ""}],
  "projects": [{"name": "", "summary": "1 line", "relevance": 0, "whyItMatters": "what this proves for OUR role", "skills": [""]}],
  "skills": {"detected": ["all other relevant skills present in the resume"], "matched": ["criteria with evidence"], "missing": ["criteria lacking evidence"]},
  "redFlagsDetected": [],
  "competencies": [{"name": "", "score": 0, "bullets": [""]}],
  "strengths": ["3-5 evidence-backed strengths"],
  "improvements": ["2-4 specific gaps"],
  "interviewProbes": ["3-4 questions to verify weak evidence in the next round"],
  "recommendationBullets": ["3-4 executive-summary bullets for the hiring panel"],
  "recommendationReason": "1 sentence"
}`;

function cacheResumeTextAndIdentity(cid, text, filename = '') {
  if (!text || isGarbageText(text)) return null;

  resumeTextCache[cid] = text;
  const candidate = AppState.candidates.find(c => c.id === cid);
  const identity = extractResumeIdentity(text, candidate?.name || '', filename);
  resumeIdentityCache[cid] = identity;

  if (candidate) {
    if (identity.name && identity.source !== 'filename') candidate.name = identity.name;
    if (identity.email) candidate.email = identity.email;
    if (identity.phone) candidate.phone = identity.phone;
    if (identity.linkedin) candidate.linkedin = identity.linkedin;
    candidate.resumeIdentitySource = identity.source;
    saveStateToLocalStorage();
    refreshResumeCandidateRowIdentity(cid);
  }

  return identity;
}

function refreshResumeCandidateRowIdentity(cid) {
  const candidate = AppState.candidates.find(c => c.id === cid);
  const row = document.querySelector(`tr[data-cid="${cid}"]`);
  if (!candidate || !row) return;

  const nameEl = row.querySelector('.cand-name-link');
  const emailEl = row.querySelector('.cand-email-sub');
  if (nameEl) nameEl.textContent = candidate.name;
  if (emailEl) emailEl.textContent = candidate.email || 'No email found';
}

// removed generateAutoResumeAnalysis — it fabricated random match scores. Analysis
// runs only on real resume text now.

function renderResumeStagePaneForJob(candidates, job, container) {
  // Hydrate the in-memory cache from analyses persisted on candidates
  candidates.forEach(c => {
    if (!resumeAnalysisCache[c.id] && c.resumeAnalysis) resumeAnalysisCache[c.id] = c.resumeAnalysis;
    if (!resumeTextCache[c.id] && c.resumeText) resumeTextCache[c.id] = c.resumeText;
  });

  const getMatchClass = (score) => {
    if (score >= 75) return 'high';
    if (score >= 50) return 'medium';
    if (score > 0) return 'low';
    return 'pending';
  };

  const getRecBadge = (rec) => {
    if (!rec) return '';
    const cls = rec === 'Advance' ? 'high' : rec === 'Hold' ? 'medium' : 'low';
    return `<span class="ra-rec-badge ${cls}">${escapeHTML(rec)}</span>`;
  };

  const pendingCount = candidates.filter(c => !resumeAnalysisCache[c.id]).length;
  const analysedCount = candidates.length - pendingCount;

  const viewLabels = { all: 'All', advanced: 'Advanced', rejected: 'Rejected' };
  const curView = AppState.resumeStageView || 'all';
  const emptyMsg = curView === 'advanced' ? 'No candidates have been advanced yet'
    : curView === 'rejected' ? 'No candidates have been rejected'
    : 'No candidates in resume analysis stage yet';

  container.innerHTML = `
    <div class="stage-table-container">
      <div class="stage-table-filters" style="margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; border-bottom: none; background: none; padding: 12px 16px;">
        <div class="ra-toolbar-stats" style="display: flex; gap: 10px; align-items: center;">
          <span class="ra-toolbar-stat" style="font-size: 0.76rem; background: rgba(255,255,255,0.04); border: 1px solid var(--glass-border); padding: 3px 10px; border-radius: 12px; color: var(--color-text-muted);">${analysedCount} analysed</span>
          <span class="ra-toolbar-stat pending" style="font-size: 0.76rem; background: rgba(255,255,255,0.04); border: 1px solid var(--glass-border); padding: 3px 10px; border-radius: 12px; color: var(--color-text-muted);">${pendingCount} pending</span>
        </div>
        <div class="stage-table-actions-bar ra-actions-bar" style="margin: 0; display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
          <button class="btn-ra-view-filter ra-tb-btn" id="btn-ra-view-filter" title="Filter which candidates are shown">
            View: ${viewLabels[curView]}
            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </button>
          <button class="btn-bulk-actions ra-tb-btn">Bulk Actions <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg></button>
          <button class="btn-ra-import ra-tb-btn" id="btn-ra-import" title="Import a CSV/Excel of candidates with public Google-Doc/Drive resume links">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Import CSV/Excel
          </button>
          <input type="file" id="ra-import-file" accept=".csv,.xlsx,.xls" hidden />
          ${analysedCount > 0 ? `<button class="btn-ra-reanalyse-all ra-tb-btn" id="btn-ra-reanalyse-all" title="Re-run analysis on all analysed resumes using the current parameters">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            Reanalyse all (${analysedCount})
          </button>` : ''}
          ${pendingCount > 0 ? `<button class="btn-ra-analyse-all ra-tb-btn ra-tb-primary" id="btn-ra-analyse-all">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            Analyse All (${pendingCount})
          </button>` : ''}
        </div>
      </div>
      <div class="ra-table-wrapper">
        <table class="ra-data-table">
          <thead>
            <tr>
              <th style="width:36px;"><input type="checkbox" class="table-checkbox-all" /></th>
              <th>Candidate</th>
              <th>Match</th>
              <th>Recommendation</th>
              <th>Resume Input</th>
              <th>Source</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${candidates.length === 0 ? `<tr><td colspan="7" class="ra-empty-row">${emptyMsg}</td></tr>` : candidates.map(c => {
              const cached = resumeAnalysisCache[c.id];
              const score = cached ? cached.matchScore : 0;
              const matchClass = getMatchClass(score);
              const isAnalysed = !!cached;
              const hasText = !!resumeTextCache[c.id];
              return `
                <tr data-candidate-id="${c.id}" data-cid="${c.id}" class="${isAnalysed ? 'ra-row-done' : ''}">
                  <td><input type="checkbox" class="table-checkbox-row" /></td>
                  <td>
                    <div class="table-candidate-cell">
                      <span class="cand-name-link">${escapeHTML(c.name)}</span>
                      <span class="cand-email-sub">${escapeHTML(c.email)}</span>
                      ${isAnalysed && cached.summary ? `<span class="ra-summary-preview">${escapeHTML(cached.summary.slice(0, 90))}${cached.summary.length > 90 ? '…' : ''}</span>` : ''}
                    </div>
                  </td>
                  <td>
                    <span class="ra-match-pill ${matchClass}">${isAnalysed ? score + '%' : '—'}</span>
                  </td>
                  <td>
                    ${isAnalysed ? getRecBadge(cached.recommendation) : '<span class="ra-status-badge pending">Pending</span>'}
                  </td>
                  <td>
                    <div class="ra-input-cell">
                      <input type="file" id="ra-file-${c.id}" accept=".pdf,.doc,.docx,.txt" hidden>
                      ${isAnalysed
                        ? `<button class="btn-ra-view-resume" data-cid="${c.id}">
                            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                            View Report
                          </button>`
                        : `<div class="ra-input-group">
                            <button class="btn-ra-upload" data-cid="${c.id}" title="Upload resume file">
                              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                              ${hasText ? 'Replace' : 'Upload'}
                            </button>
                            <span class="ra-file-status ${hasText ? 'has-file' : ''}">${hasText ? 'Text loaded' : 'No file'}</span>
                            <button class="btn-ra-analyse" data-cid="${c.id}" id="ra-btn-${c.id}">
                              <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                              Analyse
                            </button>
                          </div>`
                      }
                      ${!isAnalysed ? `<textarea id="ra-paste-${c.id}" class="ra-paste-area" placeholder="Or paste resume text here..." rows="2"></textarea>` : ''}
                    </div>
                  </td>
                  <td><span class="source-badge">${sourceLabel(c.entryMethod)}</span></td>
                  <td>
                    <div class="ra-action-btns">
                      ${c.status === 'Rejected'
                        ? `<span class="ra-stage-tag rejected">Rejected</span>`
                        : c.status === 'Resume'
                          ? `<button class="btn-stage-advance" data-candidate-id="${c.id}" data-next-stage="Screening">Advance</button>
                             <button class="btn-stage-reject" data-candidate-id="${c.id}">Reject</button>`
                          : `<span class="ra-stage-tag advanced">Advanced</span>`}
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
      <div class="stage-table-footer">
        <span class="table-selection-info">${candidates.length} candidate${candidates.length !== 1 ? 's' : ''} in resume analysis</span>
        <div class="table-pagination">
          <span>Page 1 of 1</span>
        </div>
      </div>
    </div>
  `;

  bindResumeAnalysisEvents(job);
}

function bindResumeAnalysisEvents(job) {
  document.querySelectorAll('.ra-data-table tr[data-cid]').forEach(row => {
    const cid = row.dataset.cid;
    const fileInput = document.getElementById(`ra-file-${cid}`);
    const analyseBtn = row.querySelector('.btn-ra-analyse');
    const viewBtn = row.querySelector('.btn-ra-view-resume');
    const uploadBtn = row.querySelector('.btn-ra-upload');
    const pasteArea = document.getElementById(`ra-paste-${cid}`);

    uploadBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      fileInput?.click();
    });

    fileInput?.addEventListener('change', async () => {
      if (fileInput.files[0]) {
        await handleResumeFile(cid, fileInput.files[0]);
        const badge = row.querySelector('.ra-file-status');
        if (badge) {
          badge.textContent = fileInput.files[0].name;
          badge.classList.add('has-file');
        }
      }
    });

    analyseBtn?.addEventListener('click', async () => {
      const hasPaste = pasteArea && pasteArea.value.trim().length > 20;
      const hasFile = resumeTextCache[cid];

      if (!hasPaste && !hasFile) {
        runResumeAnalysis(cid, job);
        return;
      }

      if (pasteArea && pasteArea.value.trim()) {
        const existing = resumeTextCache[cid] || '';
        cacheResumeTextAndIdentity(cid, (existing + '\n' + pasteArea.value.trim()).trim(), 'pasted resume');
      }
      runResumeAnalysis(cid, job);
    });

    viewBtn?.addEventListener('click', () => {
      if (resumeAnalysisCache[cid]) {
        openReportDrawerForCandidate(cid);
      }
    });
  });

  const analyseAllBtn = document.getElementById('btn-ra-analyse-all');
  analyseAllBtn?.addEventListener('click', () => {
    const pendingCids = [];
    document.querySelectorAll('.ra-data-table tr[data-cid]').forEach(row => {
      if (!resumeAnalysisCache[row.dataset.cid]) {
        pendingCids.push(row.dataset.cid);
      }
    });
    if (pendingCids.length === 0) {
      showPremiumToast('All candidates already analysed.', 'info');
      return;
    }
    runBulkResumeAnalysis(pendingCids, job);
  });

  const importBtn = document.getElementById('btn-ra-import');
  const importInput = document.getElementById('ra-import-file');
  importBtn?.addEventListener('click', () => importInput?.click());
  importInput?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleResumeImportFile(file, job);
    e.target.value = '';
  });

  const reanalyseAllBtn = document.getElementById('btn-ra-reanalyse-all');
  reanalyseAllBtn?.addEventListener('click', () => {
    const analysedCids = [];
    document.querySelectorAll('.ra-data-table tr[data-cid]').forEach(row => {
      if (resumeAnalysisCache[row.dataset.cid]) analysedCids.push(row.dataset.cid);
    });
    if (analysedCids.length === 0) {
      showPremiumToast('No analysed resumes to reanalyse yet.', 'info');
      return;
    }
    runBulkResumeAnalysis(analysedCids, job, { force: true });
  });

  const viewFilterBtn = document.getElementById('btn-ra-view-filter');
  viewFilterBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = viewFilterBtn.querySelector('.ra-view-dropdown');
    if (open) { open.remove(); return; }
    document.querySelectorAll('.bulk-actions-dropdown').forEach(d => d.remove());
    const cur = AppState.resumeStageView || 'all';
    const opts = [['all', 'All'], ['advanced', 'Advanced'], ['rejected', 'Rejected']];
    const dd = document.createElement('div');
    dd.className = 'bulk-actions-dropdown ra-view-dropdown';
    dd.innerHTML = opts.map(([val, label]) =>
      `<button class="bulk-dd-item${val === cur ? ' active' : ''}" data-view="${val}">${label}</button>`
    ).join('');
    dd.addEventListener('click', (ev) => {
      const item = ev.target.closest('.bulk-dd-item');
      if (!item) return;
      AppState.resumeStageView = item.dataset.view;
      dd.remove();
      renderJobDetailPanes(job);
    });
    viewFilterBtn.style.position = 'relative';
    viewFilterBtn.appendChild(dd);
    const closeDD = (ev) => { if (!dd.contains(ev.target) && ev.target !== viewFilterBtn) { dd.remove(); document.removeEventListener('click', closeDD); } };
    setTimeout(() => document.addEventListener('click', closeDD), 0);
  });
}


function extractNameFromResumeText(text) {
  return extractResumeIdentity(text).name || null;
}
async function handleResumeFile(cid, file) {
  const isPdfOrDocx = /\.(pdf|docx?)$/i.test(file.name);

  if (isPdfOrDocx) {
    try {
      const formData = new FormData();
      formData.append('file', file);
      const resp = await fetch('/api/parse-file', { method: 'POST', body: formData });
      if (!resp.ok) throw new Error('Parse failed');
      const data = await resp.json();
      if (data.text && !isGarbageText(data.text)) {
        const identity = cacheResumeTextAndIdentity(cid, data.text, file.name);
        showPremiumToast(`${file.name} parsed — ${data.text.split('\\n').length} lines extracted.`, 'success');
      } else {
        resumeTextCache[cid] = null;
        showPremiumToast(`${file.name} — could not extract text, will generate profile.`, 'info');
      }
    } catch {
      resumeTextCache[cid] = null;
      showPremiumToast(`Could not parse ${file.name} — will generate candidate profile.`, 'info');
    }
    return;
  }

  return new Promise<void>((resolve) => {
    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target.result as string;
      if (isGarbageText(text)) {
        resumeTextCache[cid] = null;
        showPremiumToast(`${file.name} loaded — binary content, will generate candidate profile.`, 'info');
      } else {
        cacheResumeTextAndIdentity(cid, text, file.name);
        showPremiumToast(`${file.name} loaded — ${text.split('\\n').length} lines extracted.`, 'success');
      }
      resolve();
    };
    reader.onerror = () => {
      resumeTextCache[cid] = null;
      showPremiumToast(`Could not read ${file.name} — will generate candidate profile.`, 'info');
      resolve();
    };
    reader.readAsText(file);
  });
}

// removed generateSyntheticResume — it invented fake resumes (Swiggy/Flipkart/
// fake CGPA/certs) that were scored as if real. Analysis now requires the real
// resume text (server-fetched or uploaded) and fails loudly when there is none.

function isGarbageText(text) {
  if (!text || text.length < 20) return true;
  const printable = text.replace(/[^\x20-\x7E\n\r\t]/g, '');
  return printable.length / text.length < 0.7;
}

function extractExperienceYearsFromText(text) {
  const matches = [...String(text || '').matchAll(/(\d+(?:\.\d+)?)\+?\s*(?:years?|yrs?)\s+(?:of\s+)?experience/gi)];
  if (!matches.length) return 'Not stated';
  const years = Math.max(...matches.map(match => Number(match[1])).filter(Number.isFinite));
  return `${years} year${years === 1 ? '' : 's'}`;
}

function clampScore(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;
}

function asStringArray(v, max = 12) {
  if (!Array.isArray(v)) return [];
  return v.filter(Boolean).map(x => String(x).trim()).filter(Boolean).slice(0, max);
}

function buildCriteriaBlock(criteria, config) {
  const lines = [];
  if (criteria.mustHave.length) lines.push(`MUST HAVE (gate criteria): ${criteria.mustHave.join('; ')}`);
  if (criteria.goodToHave.length) lines.push(`GOOD TO HAVE (bonus): ${criteria.goodToHave.join('; ')}`);
  if (criteria.redFlags.length) lines.push(`RED FLAGS (disqualify if present): ${criteria.redFlags.join('; ')}`);
  if (config.customCriteria.length) {
    lines.push('RECRUITER CUSTOM CRITERIA (score each individually):');
    config.customCriteria.forEach((c, i) => {
      lines.push(`  ${i + 1}. ${c.label} (importance ${c.weight}/10)${c.description ? ` — ${c.description}` : ''}`);
    });
  }
  return lines.length ? `\nSCREENING CRITERIA (interpret every criterion by MEANING — satisfied through equivalent or transferable evidence, not only exact wording):\n${lines.join('\n')}` : '';
}

function deriveLegacyScorecard(dims) {
  return {
    technical: Math.round((dims.mustHave.score || 0) / 10 * 10) / 10,
    experience: Math.round((dims.experience.score || 0) / 10 * 10) / 10,
    communication: Math.round(((dims.projects.score + dims.education.score) / 2 || 0) / 10 * 10) / 10,
    cultureFit: Math.round((dims.niceToHave.score || 0) / 10 * 10) / 10,
  };
}

function applyGatesAndScore(result, config, criteria) {
  const dims = result.dimensions;
  const { matchScore, breakdown } = computeWeightedScore(dims, config, criteria);
  result.matchScore = matchScore;
  result.weightedBreakdown = breakdown;
  result.gateNotes = [];

  const missingMust = (result.criteriaVerdicts || [])
    .filter(v => v.group === 'mustHave' && v.met !== true && v.met !== 'true' && v.met !== 'partial')
    .map(v => v.criterion);
  if (config.mustHaveGate && missingMust.length > 0 && result.matchScore > config.mustHaveCap) {
    result.matchScore = config.mustHaveCap;
    result.gateNotes.push(`Score capped at ${config.mustHaveCap}: missing must-have — ${missingMust.slice(0, 3).join(', ')}`);
  }

  result.recommendation = recommendationFromScore(result.matchScore, config);
  if (config.mustHaveGate && missingMust.length > 0) result.recommendation = 'Reject';

  if (result.redFlagsDetected.length > 0) {
    result.matchScore = Math.min(30, result.matchScore);
    result.recommendation = 'Reject';
    result.gateNotes.push(`Red flag found: ${result.redFlagsDetected.join(', ')} — score capped at 30`);
  }

  if (!result.recommendationReason) {
    result.recommendationReason = `Weighted score of ${result.matchScore} against your configured criteria yields ${result.recommendation}.`;
  }
  result.scorecard = deriveLegacyScorecard(dims);
  result.analysedAt = new Date().toISOString();
}

function normalizeDeepResult(result, config, criteria) {
  const dims = result.dimensions && typeof result.dimensions === 'object' ? result.dimensions : {};
  ['mustHave', 'niceToHave', 'projects', 'experience', 'education', 'custom'].forEach(k => {
    if (!dims[k] || typeof dims[k] !== 'object') dims[k] = { score: 0, evidence: '' };
    dims[k].score = clampScore(dims[k].score);
    dims[k].evidence = dims[k].evidence ? String(dims[k].evidence) : '';
  });
  result.dimensions = dims;

  if (!result.skills || typeof result.skills !== 'object') result.skills = {};
  result.skills.detected = asStringArray(result.skills.detected, 8);
  result.skills.matched = asStringArray(result.skills.matched, 16);
  result.skills.missing = asStringArray(result.skills.missing, 16);
  result.redFlagsDetected = asStringArray(result.redFlagsDetected, 8);
  result.strengths = asStringArray(result.strengths, 6);
  result.improvements = asStringArray(result.improvements, 5);
  result.interviewProbes = asStringArray(result.interviewProbes, 5);
  result.recommendationBullets = asStringArray(result.recommendationBullets, 5);
  result.summary = result.summary ? String(result.summary) : 'Resume analysed against the configured job criteria.';
  result.experienceYears = result.experienceYears ? String(result.experienceYears) : 'Not stated';

  result.projects = (Array.isArray(result.projects) ? result.projects : []).slice(0, 6).map(p => ({
    name: String(p?.name || 'Untitled project'),
    summary: String(p?.summary || ''),
    relevance: clampScore(p?.relevance),
    whyItMatters: String(p?.whyItMatters || ''),
    skills: asStringArray(p?.skills, 8),
  }));

  result.competencies = (Array.isArray(result.competencies) ? result.competencies : []).slice(0, 8).map(c => ({
    name: String(c?.name || 'Competency'),
    score: clampScore(c?.score),
    bullets: asStringArray(c?.bullets, 5),
  }));

  result.criteriaVerdicts = (Array.isArray(result.criteriaVerdicts) ? result.criteriaVerdicts : []).slice(0, 30).map(v => ({
    criterion: String(v?.criterion || ''),
    group: ['mustHave', 'goodToHave', 'custom', 'redFlag'].includes(v?.group) ? v.group : 'custom',
    met: v?.met === true || v?.met === 'true' ? true : v?.met === 'partial' ? 'partial' : false,
    evidence: String(v?.evidence || ''),
  })).filter(v => v.criterion);

  applyGatesAndScore(result, config, criteria);
  return result;
}

function tokenize(text) {
  return new Set(String(text).toLowerCase().match(/[a-z][a-z0-9+#.]{2,}/g) || []);
}

const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'has', 'are', 'was', 'were', 'will', 'can', 'their', 'our', 'your', 'into', 'using', 'used', 'use', 'work', 'worked', 'working', 'role', 'team', 'years', 'year', 'experience', 'skills', 'strong', 'ability', 'including', 'developed', 'managed']);

function relevanceOverlap(textTokens, jdTokens) {
  let hits = 0, total = 0;
  jdTokens.forEach(t => {
    if (STOPWORDS.has(t)) return;
    total++;
    if (textTokens.has(t)) hits++;
  });
  return total ? Math.round((hits / total) * 100) : 0;
}

function extractProjectsLocally(resumeText, job, criteria) {
  const jdTokens = tokenize(`${job.roleName} ${job.description || ''} ${criteria.mustHave.join(' ')} ${criteria.goodToHave.join(' ')}`);
  const lines = resumeText.split('\n');
  const projects = [];
  let current = null;
  const headingRe = /^([A-Z][\w .,&()+/-]{4,70})(?:\s*[—–|:]\s*|\s*\()/;
  let inSection = false;
  lines.forEach(line => {
    const trimmed = line.trim();
    const upper = trimmed.toUpperCase();
    if (/^(PROJECTS?|WORK EXPERIENCE|EXPERIENCE|PROFESSIONAL EXPERIENCE|INTERNSHIPS?)\b/.test(upper)) { inSection = true; return; }
    if (/^(EDUCATION|CERTIFICATIONS?|SKILLS|ACHIEVEMENTS|AWARDS|HOBBIES|LANGUAGES)\b/.test(upper)) {
      if (current) projects.push(current);
      inSection = false; current = null; return;
    }
    if (!inSection) return;
    if (/^[-•*]/.test(trimmed)) {
      if (current) current.body += ' ' + trimmed;
      return;
    }
    const m = trimmed.match(headingRe);
    if (m && trimmed.length < 90) {
      if (current) projects.push(current);
      current = { name: m[1].trim(), body: '' };
    } else if (current) {
      current.body += ' ' + trimmed;
    }
  });
  if (current) projects.push(current);

  const seen = new Set();
  const unique = projects.filter(p => {
    const key = p.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return unique.slice(0, 5).map(p => {
    const relevance = Math.min(95, relevanceOverlap(tokenize(p.name + ' ' + p.body), jdTokens) + 25);
    const skillHits = [...criteria.mustHave, ...criteria.goodToHave].filter(s =>
      (p.name + ' ' + p.body).toLowerCase().includes(s.toLowerCase().split(/\s+/)[0] || '')
    ).slice(0, 5);
    return {
      name: p.name,
      summary: p.body.trim().slice(0, 160) || 'Listed in resume without further detail.',
      relevance,
      whyItMatters: relevance >= 50
        ? `Overlaps directly with the ${job.roleName} requirements${skillHits.length ? ` (touches: ${skillHits.slice(0, 3).join(', ')})` : ''}.`
        : 'Limited direct overlap with this role — treat as transferable experience and probe in interview.',
      skills: skillHits,
    };
  });
}

function matchCriterion(resumeLower, criterion) {
  const clean = criterion.replace(/[^\w\s+#.]/g, '').toLowerCase().trim();
  if (!clean) return false;
  if (resumeLower.includes(clean)) return true;
  const words = clean.split(/\s+/).filter(w => w.length > 3 && !STOPWORDS.has(w));
  if (!words.length) return false;
  const hits = words.filter(w => resumeLower.includes(w)).length;
  return hits === words.length ? true : hits / words.length >= 0.5 ? 'partial' : false;
}

function buildLocalDeepAnalysis(resumeText, job, config, criteria) {
  const resumeLower = resumeText.toLowerCase();
  const verdicts = [];
  const matched = [], missing = [];

  criteria.mustHave.forEach(c => {
    const met = matchCriterion(resumeLower, c);
    verdicts.push({ criterion: c, group: 'mustHave', met, evidence: met ? 'Keyword evidence found in resume text.' : 'No mention found in resume text.' });
    (met === true || met === 'partial' ? matched : missing).push(c);
  });
  criteria.goodToHave.forEach(c => {
    const met = matchCriterion(resumeLower, c);
    verdicts.push({ criterion: c, group: 'goodToHave', met, evidence: met ? 'Keyword evidence found in resume text.' : 'Not found in resume text.' });
    (met === true || met === 'partial' ? matched : missing).push(c);
  });

  const customScores = config.customCriteria.map(c => {
    // Match against the label first; the description only dilutes keyword overlap
    const met = matchCriterion(resumeLower, c.label) || matchCriterion(resumeLower, c.description || '');
    verdicts.push({ criterion: c.label, group: 'custom', met, evidence: met ? 'Related keywords present in resume.' : 'No supporting evidence found.' });
    return { weight: c.weight || 5, score: met === true ? 75 : met === 'partial' ? 50 : 20 };
  });
  const customWeightSum = customScores.reduce((s, c) => s + c.weight, 0);
  const customScore = customWeightSum ? Math.round(customScores.reduce((s, c) => s + c.score * c.weight, 0) / customWeightSum) : 0;

  const redFlagsFound = criteria.redFlags.filter(f => matchCriterion(resumeLower, f) === true);

  const detected = ['JavaScript', 'TypeScript', 'React', 'Node.js', 'Python', 'SQL', 'AWS', 'Docker', 'Excel', 'Project Management', 'Agile', 'Communication', 'Proposal Writing', 'Compliance', 'Tender Management']
    .filter(s => resumeLower.includes(s.toLowerCase())).slice(0, 8);

  const projects = extractProjectsLocally(resumeText, job, criteria);
  const projectsScore = projects.length ? Math.round(projects.reduce((s, p) => s + p.relevance, 0) / projects.length) : 30;

  const expText = extractExperienceYearsFromText(resumeText);
  const expYears = parseFloat(expText) || 0;
  const bandMin = parseFloat(String(job.experienceBand || '').match(/\d+/)?.[0] || '0');
  const experienceScore = expText === 'Not stated' ? 35 : Math.min(95, 50 + Math.min(expYears, bandMin + 4) * 10);

  const eduScore = /ph\.?d|doctorate/.test(resumeLower) ? 90
    : /master|m\.?tech|mba|m\.?sc/.test(resumeLower) ? 80
    : /b\.?tech|bachelor|b\.?e\b|b\.?sc|undergraduate/.test(resumeLower) ? 70
    : /diploma|certificat/.test(resumeLower) ? 55 : 35;

  const mustRatio = criteria.mustHave.length ? criteria.mustHave.filter(c => matched.includes(c)).length / criteria.mustHave.length : 0;
  const niceRatio = criteria.goodToHave.length ? criteria.goodToHave.filter(c => matched.includes(c)).length / criteria.goodToHave.length : 0;

  const dims = {
    mustHave: { score: Math.round(mustRatio * 100), evidence: `${criteria.mustHave.filter(c => matched.includes(c)).length}/${criteria.mustHave.length} must-have criteria evidenced in the text.` },
    niceToHave: { score: Math.round(niceRatio * 100), evidence: `${criteria.goodToHave.filter(c => matched.includes(c)).length}/${criteria.goodToHave.length} nice-to-have criteria evidenced.` },
    projects: { score: projectsScore, evidence: projects.length ? `${projects.length} project(s) parsed, avg relevance ${projectsScore}%.` : 'No distinct project sections found.' },
    experience: { score: experienceScore, evidence: `Stated experience: ${expText}; band requires ${job.experienceBand || 'unspecified'}.` },
    education: { score: eduScore, evidence: 'Education level inferred from degree keywords.' },
    custom: { score: customScore, evidence: config.customCriteria.length ? 'Custom criteria keyword-matched individually.' : '' },
  };

  const missingMustList = criteria.mustHave.filter(c => missing.includes(c));
  const result = {
    engine: 'local',
    summary: `Local rules engine: ${matched.length ? `evidenced ${matched.slice(0, 3).join(', ')}` : 'no configured criteria matched'}${missingMustList.length ? `; missing must-haves: ${missingMustList.slice(0, 2).join(', ')}` : ''}. ${projects.length ? `${projects.length} project(s) assessed for role relevance.` : ''}`,
    experienceYears: expText,
    skills: { detected, matched, missing },
    redFlagsDetected: redFlagsFound,
    dimensions: dims,
    criteriaVerdicts: verdicts,
    projects,
    competencies: [
      { name: 'Criteria Coverage', score: Math.round(mustRatio * 100), bullets: matched.length ? matched.slice(0, 4).map(m => `Evidence found for: ${m}`) : ['No configured criteria matched in the resume text.'] },
      { name: 'Project Relevance', score: projectsScore, bullets: projects.slice(0, 3).map(p => `${p.name}: ${p.relevance}% relevant`) },
      { name: 'Experience Depth', score: dims.experience.score, bullets: [dims.experience.evidence] },
      { name: 'Education & Certifications', score: eduScore, bullets: [dims.education.evidence] },
    ],
    strengths: matched.slice(0, 3).map(m => `Demonstrates ${m} with direct resume evidence.`),
    improvements: missing.slice(0, 3).map(m => `No evidence found for ${m} — verify in screening.`),
    interviewProbes: missing.slice(0, 3).map(m => `Ask the candidate to walk through hands-on experience with ${m}.`),
    recommendationBullets: [],
    recommendationReason: '',
  };
  normalizeDeepResult(result, config, criteria);
  return result;
}

// One comprehensive DeepSeek call: the model reasons over facts + scoring +
// narrative together (so it can cross-check them) and returns the exact shape
// normalizeDeepResult expects. Restored from the pre-MoE design — the 3-pass
// extract→score→critique split lost that holistic reasoning, scored against a
// truncated fact view, and tripled the failure surface. Throws bubble up; the
// caller degrades to the local engine.
async function runResumeDeepAnalysis(resumeText, job, criteria, criteriaBlock) {
  const resume = resumeText.slice(0, RESUME_TEXT_LIMIT);
  const userMsg = `JOB: ${job.cardName} (${job.roleName})
Experience Required: ${job.experienceBand}
Description: ${job.description || '(Not provided)'}${criteriaBlock}

--- CANDIDATE RESUME ---
${resume}`;
  const raw = await callDeepSeekAPI(
    [{ role: 'system', content: LINA_SYSTEM_PROMPT }, { role: 'user', content: userMsg }],
    true,          // jsonMode
    'resumeDeep',  // → deepseek-v4-pro (strong tier)
    0.1,           // near-deterministic scoring; a hair of temperature avoids degenerate loops
  );
  return parseAIJson(raw);
}

// Resolve a candidate's resume text from the fastest source available: cached
// upload/paste, else a fetched public link, else the backend's stored copy.
// Returns '' when nothing usable is found. Pure I/O — no LLM.
async function ensureResumeText(cid, candidate) {
  let text = ((resumeTextCache[cid] || '') + '\n' + (document.getElementById(`ra-paste-${cid}`)?.value || '')).trim();
  if ((!text || isGarbageText(text)) && candidate?.resumeLink) {
    try {
      const res = await fetch('/api/fetch-doc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: candidate.resumeLink }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.text) { resumeTextCache[cid] = data.text; text = data.text.trim(); }
    } catch { /* fall through to the no-text path */ }
  }
  if ((!text || isGarbageText(text)) && candidate && candidate._backend && getDataSource() === 'api') {
    try {
      const serverText = await apiGetResumeText(cid);
      if (serverText && !isGarbageText(serverText)) { resumeTextCache[cid] = serverText; text = serverText.trim(); }
    } catch (e) { console.warn('resume-text fetch failed', e); }
  }
  return (!text || isGarbageText(text)) ? '' : text;
}

// Fast first pass for bulk analyse: fetch each resume and parse ONLY name + id
// into the list, so the recruiter sees WHO is being processed before the slow
// scoring starts. No LLM — just identity extraction (bounded concurrency).
async function prefetchIdentities(cids) {
  let cursor = 0;
  const worker = async () => {
    while (cursor < cids.length) {
      const cid = cids[cursor++];
      const candidate = AppState.candidates.find(c => c.id === cid);
      if (!candidate) continue;
      try {
        const text = await ensureResumeText(cid, candidate);
        if (text) cacheResumeTextAndIdentity(cid, text); // sets name/email + refreshes the row
      } catch { /* one failed identity shouldn't block the rest */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(RESUME_ANALYSIS_CONCURRENCY, cids.length) }, () => worker()));
}

async function runResumeAnalysis(cid, job, opts: any = {}) {
  const quiet = opts.quiet === true;
  const btn = document.getElementById(`ra-btn-${cid}`);
  const origHTML = btn ? btn.innerHTML : '';
  const candidate = AppState.candidates.find(c => c.id === cid);
  if (btn) { btn.disabled = true; btn.innerHTML = `<span class="ra-spinner"></span> Fetching…`; }

  const resumeText = await ensureResumeText(cid, candidate);
  // Parse name/id from the resume up front so the row shows the real candidate
  // before scoring (no-op if the bulk prefetch already did it).
  if (resumeText) cacheResumeTextAndIdentity(cid, resumeText);

  if (!resumeText) {
    if (!quiet) showPremiumToast('Upload a resume, paste text, or add a valid public resume link.', 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = origHTML; }
    return false;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="ra-spinner"></span> Analysing…`;
  }

  const criteria = job.resumeCriteria || { mustHave: [], redFlags: [], goodToHave: [] };
  const config = getScoringConfig(job);
  const criteriaBlock = buildCriteriaBlock(criteria, config);

  appendTerminalLog(`<code>[${new Date().toLocaleTimeString()}] Lina:</code> Initiated deep resume analysis for <strong>${candidate ? escapeHTML(candidate.name) : cid}</strong>...`);
  appendTerminalLog(`<code>[${new Date().toLocaleTimeString()}] Lina:</code> Scoring ${criteria.mustHave.length + criteria.goodToHave.length + config.customCriteria.length} criteria across 6 weighted dimensions for <strong>${escapeHTML(job.roleName)}</strong>...`);

  let result;
  try {
    result = await runResumeDeepAnalysis(resumeText, job, criteria, criteriaBlock);
    result.engine = 'deepseek';
    normalizeDeepResult(result, config, criteria);
  } catch (err) {
    console.warn('AI analysis failed, using local deep-scan engine:', err);
    appendTerminalLog(`<code>[${new Date().toLocaleTimeString()}] Lina:</code> <span style="color: #f59e0b;">DeepSeek API offline. Engaging local deep-scan engine...</span>`);
    try {
      result = buildLocalDeepAnalysis(resumeText, job, config, criteria);
    } catch (fallbackErr) {
      console.error('Fallback analysis failed:', fallbackErr);
      if (!quiet) showPremiumToast('Analysis failed — please try again.', 'error');
      if (btn) { btn.disabled = false; btn.innerHTML = origHTML; }
      return false;
    }
  }

  resumeAnalysisCache[cid] = result;
  const cand = AppState.candidates.find(c => c.id === cid);
  if (cand) {
    cand.score = `${result.matchScore}%`;
    cand.resumeAnalysis = result;
    cand.resumeText = resumeText; // persist so "Reanalyse" works after reloads
    saveStateToLocalStorage();

    // Persist server-side so the score/report survive a device or browser change
    // and reach the rest of the pipeline — localStorage alone is per-browser.
    // Only resume-stage fields, so this never triggers interview-session sync.
    if (cand._backend && getDataSource() === 'api') {
      apiUpdateApplicant(cid, {
        match_score: result.matchScore,
        resume_analysis_report: JSON.stringify(result),
        resume_text: resumeText,
        resume_analysed: true,
        resume_shortlisted: result.recommendation === 'Advance',
      }).catch((err) => {
        console.warn('Resume analysis saved locally but backend sync failed:', err);
        if (!quiet) showPremiumToast('Saved locally — backend sync failed. Reanalyse to retry.', 'info');
      });
    } else if (getDataSource() === 'api' && !cand._backend) {
      // Register the candidate on the backend so the analysis persists — but keep
      // its on-screen "CAN-" id STABLE. Mutating it mid-flow broke the row's click
      // handlers (they closure over the old id) and forced a manual refresh. Tag
      // jobId + backendId so the next hydrate adopts the backend copy cleanly
      // instead of duplicating. Backend requires an email to register.
      if (!cand.email) {
        if (!quiet) showPremiumToast('Analysis saved locally — add an email to sync this candidate to the backend.', 'info');
      } else {
        const registered = cand.backendId
          ? Promise.resolve(cand.backendId)
          : apiAddApplicant(job.id, { name: cand.name, email: cand.email, phone: cand.phone, entryMethod: 'direct_link' }).then((created) => {
              if (!created || !created.id) throw new Error('Could not register the candidate in the backend.');
              cand.backendId = created.id;
              cand.jobId = job.id;
              saveStateToLocalStorage();
              return created.id;
            });
        registered.then((backendId) => apiUpdateApplicant(backendId, {
          match_score: result.matchScore,
          resume_analysis_report: JSON.stringify(result),
          resume_text: resumeText,
          resume_analysed: true,
          resume_shortlisted: result.recommendation === 'Advance',
        })).catch((err) => {
          console.warn('Could not sync candidate to backend:', err);
          if (!quiet) showPremiumToast(`Analysis saved locally — couldn't sync: ${err.message || err}`, 'info');
        });
      }
    }
  }
  renderAnalysisResult(cid, result);
  if (!quiet) showPremiumToast(result.engine === 'local' ? 'Resume analysed (local engine).' : 'Deep resume analysis complete.', 'success');
  appendTerminalLog(`<code>[${new Date().toLocaleTimeString()}] Lina:</code> <strong>${candidate ? escapeHTML(candidate.name) : cid}</strong> scored <strong style="color: #10b981;">${result.matchScore}/100</strong> (weighted) → <strong>${escapeHTML(result.recommendation)}</strong>.`, result.recommendation === 'Advance' ? 'font-gold' : '');
  return true;
}

function renderAnalysisResult(cid, result) {
  const row = document.querySelector(`tr[data-cid="${cid}"]`);
  if (!row) return;

  row.classList.add('ra-row-done');
  const tds = row.querySelectorAll('td');

  const matchClass = result.matchScore >= 75 ? 'high' : result.matchScore >= 50 ? 'medium' : 'low';
  if (tds[1]) {
    const cell = tds[1].querySelector('.table-candidate-cell');
    if (cell && result.summary) {
      const existing = cell.querySelector('.ra-summary-preview');
      if (existing) existing.remove();
      const span = document.createElement('span');
      span.className = 'ra-summary-preview';
      span.textContent = result.summary.slice(0, 90) + (result.summary.length > 90 ? '…' : '');
      cell.appendChild(span);
    }
  }
  if (tds[2]) {
    const localTag = result.engine === 'local'
      ? `<span class="ra-engine-tag" title="Scored offline by the local keyword engine — reanalyse for a full AI score">local</span>`
      : '';
    tds[2].innerHTML = `<span class="ra-match-pill ${matchClass}">${result.matchScore}%</span>${localTag}`;
  }
  if (tds[3]) {
    const recCls = result.recommendation === 'Advance' ? 'high' : result.recommendation === 'Hold' ? 'medium' : 'low';
    tds[3].innerHTML = `<span class="ra-rec-badge ${recCls}">${escapeHTML(result.recommendation)}</span>`;
  }
  if (tds[4]) {
    tds[4].innerHTML = `<div class="ra-input-cell">
      <button class="btn-ra-view-resume" data-cid="${cid}">
        <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        View Report
      </button>
    </div>`;
    tds[4].querySelector('.btn-ra-view-resume')?.addEventListener('click', () => {
      openReportDrawerForCandidate(cid);
    });
  }

  const pendingBtns = document.querySelectorAll('.btn-ra-analyse-all, .ra-toolbar-stat.pending');
  const remaining = document.querySelectorAll('tr[data-cid]:not(.ra-row-done)').length;
  pendingBtns.forEach(el => {
    if (el.classList.contains('ra-toolbar-stat')) {
      el.textContent = `${remaining} pending`;
    } else if (remaining === 0) {
      el.style.display = 'none';
    } else {
      el.innerHTML = el.innerHTML.replace(/\(\d+\)/, `(${remaining})`);
    }
  });
  const analysedStat = document.querySelector('.ra-toolbar-stat:not(.pending)');
  if (analysedStat) {
    const done = document.querySelectorAll('tr.ra-row-done').length;
    analysedStat.textContent = `${done} analysed`;
  }
}

// How many resumes to analyse concurrently. Each resume is one comprehensive
// DeepSeek call (deepseek-v4-pro), so 4 concurrent ≈ 4 in-flight — well under the
// proxy (RATE_LIMIT 120/min), with the exponential-backoff retry in
// callDeepSeekAPI absorbing bursts. ponytail: DeepSeek's account rate is the real
// ceiling; raise both this and RATE_LIMIT together if you push higher.
const RESUME_ANALYSIS_CONCURRENCY = 4;

async function runBulkResumeAnalysis(candidateIds, job, opts: any = {}) {
  const force = opts.force === true;
  // Normal bulk skips already-analysed; reanalyse (force) re-runs them against the new params.
  const pending = force ? candidateIds.slice() : candidateIds.filter(id => !resumeAnalysisCache[id]);
  if (pending.length === 0) {
    showPremiumToast('All candidates already analysed.', 'info');
    return;
  }
  const total = pending.length;

  // Phase 1 — names first: parse every candidate's name + id into the list right
  // away so the recruiter sees who's being processed; the scoring follows.
  showPremiumToast(`Listing ${total} candidate name${total > 1 ? 's' : ''}…`, 'info');
  await prefetchIdentities(pending);

  // Phase 2 — the slow per-candidate scoring.
  showPremiumToast(`${force ? 'Reanalysing' : 'Analysing'} ${total} candidate${total > 1 ? 's' : ''} (${Math.min(RESUME_ANALYSIS_CONCURRENCY, total)} at a time)…`, 'info');

  // Bounded-concurrency worker pool: each worker pulls the next candidate off a
  // shared cursor, so at most RESUME_ANALYSIS_CONCURRENCY calls are ever in
  // flight. Each runResumeAnalysis writes only its own candidate, so concurrent
  // runs don't race. quiet:true suppresses the per-candidate toasts.
  let done = 0;
  let failed = 0;
  let cursor = 0;
  const worker = async () => {
    while (cursor < pending.length) {
      const cid = pending[cursor];
      cursor += 1;
      try {
        const ok = await runResumeAnalysis(cid, job, { quiet: true, force });
        if (ok === true) done += 1; else failed += 1;
      } catch {
        failed += 1;
      }
    }
  };

  const workerCount = Math.min(RESUME_ANALYSIS_CONCURRENCY, pending.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const verb = force ? 'Reanalysis' : 'Bulk analysis';
  showPremiumToast(
    failed
      ? `${verb} complete: ${done}/${total} succeeded, ${failed} failed.`
      : `${verb} complete: all ${total} succeeded.`,
    failed ? 'info' : 'success',
  );
}

function toggleResumeCriteriaEdit(job) {
  const section = document.querySelector('.ra-config-section');
  if (!section) return;

  const isEditing = section.classList.contains('editing');
  if (isEditing) {
    // Save mode
    section.classList.remove('editing');
    const criteria = { mustHave: [], redFlags: [], goodToHave: [], goodToHaveMinMatch: 1 };
    section.querySelectorAll('.ra-criteria-group.must-have .ra-criteria-edit-input').forEach(input => {
      if (input.value.trim()) criteria.mustHave.push(input.value.trim());
    });
    section.querySelectorAll('.ra-criteria-group.red-flags .ra-criteria-edit-input').forEach(input => {
      if (input.value.trim()) criteria.redFlags.push(input.value.trim());
    });
    section.querySelectorAll('.ra-criteria-group.good-to-have .ra-criteria-edit-input').forEach(input => {
      if (input.value.trim()) criteria.goodToHave.push(input.value.trim());
    });
    const minMatch = section.querySelector('.ra-min-match-input');
    if (minMatch) criteria.goodToHaveMinMatch = parseInt(minMatch.value) || 1;

    job.resumeCriteria = criteria;
    saveStateToLocalStorage();
    showPremiumToast('Resume criteria saved.', 'success');

    // Re-render by triggering the pane render
    const resumeList = document.getElementById('list-stage-resume');
    if (resumeList) {
      const jobCandidates = AppState.candidates.filter(c => {
        if (getDataSource() === 'api' && job._backend) {
          return c.jobId === job.id;
        }
        const jTitle = c.jobApplied;
        return jTitle === job.roleName || jTitle === job.cardName;
      });
      const resumeCands = jobCandidates.filter(c => c.status === 'Resume');
      // trigger full re-render by calling renderJobDetailPanes
      if (typeof renderJobDetailPanes === 'function') renderJobDetailPanes(job);
    }
    return;
  }

  // Enter edit mode
  section.classList.add('editing');
  const criteria = job.resumeCriteria || { mustHave: [], redFlags: [], goodToHave: [], goodToHaveMinMatch: 1 };

  const editBtn = document.getElementById('btn-ra-edit-criteria');
  if (editBtn) {
    editBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Save';
  }

  // Transform criteria items into editable inputs
  section.querySelectorAll('.ra-criteria-items').forEach(itemsContainer => {
    const group = itemsContainer.closest('.ra-criteria-group');
    const groupType = group.classList.contains('must-have') ? 'mustHave' : group.classList.contains('red-flags') ? 'redFlags' : 'goodToHave';
    const items = criteria[groupType] || [];

    itemsContainer.innerHTML = items.map((item, i) => `
      <div class="ra-criteria-item-edit">
        <span class="ra-criteria-num ${group.classList[1]}">${i + 1}</span>
        <input type="text" class="ra-criteria-edit-input" value="${item}" />
        <button class="btn-ra-remove-criteria" data-group="${groupType}" data-idx="${i}">
          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    `).join('') + `
      <button class="btn-ra-add-criteria" data-group="${groupType}">+ Add Criterion</button>
    `;

    // Add button handlers
    itemsContainer.querySelectorAll('.btn-ra-remove-criteria').forEach(btn => {
      btn.addEventListener('click', () => {
        btn.closest('.ra-criteria-item-edit').remove();
        // Re-number
        itemsContainer.querySelectorAll('.ra-criteria-num').forEach((num, idx) => {
          num.textContent = idx + 1;
        });
      });
    });

    itemsContainer.querySelector('.btn-ra-add-criteria')?.addEventListener('click', () => {
      const addBtn = itemsContainer.querySelector('.btn-ra-add-criteria');
      const newItem = document.createElement('div');
      newItem.className = 'ra-criteria-item-edit';
      const count = itemsContainer.querySelectorAll('.ra-criteria-item-edit').length + 1;
      newItem.innerHTML = `
        <span class="ra-criteria-num ${group.classList[1]}">${count}</span>
        <input type="text" class="ra-criteria-edit-input" value="" placeholder="Enter criterion..." />
        <button class="btn-ra-remove-criteria">
          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      `;
      itemsContainer.insertBefore(newItem, addBtn);
      newItem.querySelector('.btn-ra-remove-criteria').addEventListener('click', () => {
        newItem.remove();
        itemsContainer.querySelectorAll('.ra-criteria-num').forEach((num, idx) => { num.textContent = idx + 1; });
      });
      newItem.querySelector('input').focus();
    });
  });

  // Make min match editable
  const minMatchEl = section.querySelector('.ra-criteria-min-match');
  if (minMatchEl) {
    const currentMin = criteria.goodToHaveMinMatch || 1;
    const totalGood = criteria.goodToHave.length;
    minMatchEl.innerHTML = `Minimum match: <input type="number" class="ra-min-match-input" value="${currentMin}" min="1" max="${totalGood}" style="width:40px;background:rgba(0,0,0,0.2);border:1px solid var(--glass-border);border-radius:4px;color:var(--color-text-primary);text-align:center;padding:2px;font-size:0.78rem;" /> out of ${totalGood} criteria`;
  }
}

// --- CSV / Excel resume-link import (Resume Analysis) ---

// Parse delimited text into a matrix of trimmed cells, respecting "quoted, fields".
function parseDelimited(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const cells = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
        else cur += ch;
      } else if (ch === '"') { inQ = true; }
      else if (ch === ',') { cells.push(cur); cur = ''; }
      else cur += ch;
    }
    cells.push(cur);
    rows.push(cells.map(c => c.trim()));
  }
  return rows;
}

// Map a header+rows matrix to { name, email, phone, link }, keeping only rows
// that carry an http(s) resume link.
function matrixToCandidates(matrix) {
  if (!matrix.length) return [];
  const headers = matrix[0].map(h => String(h).toLowerCase().trim());
  const exact = (...keys) => headers.findIndex(h => keys.includes(h));
  const contains = (...subs) => headers.findIndex(h => subs.some(s => h.includes(s)));
  const nameIdx = exact('name', 'candidate', 'candidate name');
  const emailIdx = exact('email', 'e-mail', 'email address');
  const phoneIdx = exact('phone', 'mobile', 'contact');
  let linkIdx = exact('resume link', 'resume url', 'resume', 'link', 'url', 'google doc', 'document', 'doc');
  if (linkIdx === -1) linkIdx = contains('link', 'url', 'doc');

  const out = [];
  for (let i = 1; i < matrix.length; i++) {
    const cols = matrix[i] || [];
    const link = linkIdx !== -1 ? String(cols[linkIdx] || '').trim() : '';
    if (!/^https?:\/\//i.test(link)) continue;
    out.push({
      name: nameIdx !== -1 ? String(cols[nameIdx] || '').trim() : '',
      email: emailIdx !== -1 ? String(cols[emailIdx] || '').trim() : '',
      phone: phoneIdx !== -1 ? String(cols[phoneIdx] || '').trim() : '',
      link,
    });
  }
  return out;
}

async function handleResumeImportFile(file, job) {
  let matrix = [];
  const fname = (file.name || '').toLowerCase();
  try {
    if (fname.endsWith('.xlsx') || fname.endsWith('.xls')) {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: '' })
        .map((r: any) => r.map((c: any) => String(c)));
    } else {
      matrix = parseDelimited(await file.text());
    }
  } catch {
    showPremiumToast('Could not read the file. Use a .csv or .xlsx with a resume link column.', 'error');
    return;
  }

  const rows = matrixToCandidates(matrix);
  if (!rows.length) {
    showPremiumToast('No rows with a resume link found. Add a "Resume Link" column of public Google-Doc/Drive URLs.', 'error');
    return;
  }

  let ok = 0;
  for (const r of rows) {
    try {
      const cid = await addCandidateToAppState(r.name || r.email || 'Imported Candidate', r.email, r.phone, job);
      const cand = AppState.candidates.find(c => c.id === cid);
      if (cand) { cand.status = 'Resume'; cand.resumeLink = r.link; }
      ok++;
    } catch (e) { /* skip rows that fail to persist */ }
  }
  saveStateToLocalStorage();
  renderJobDetailPanes(job);
  if (!ok) { showPremiumToast('Could not import candidates (backend error).', 'error'); return; }
  showPremiumToast(`Imported ${ok} candidate${ok > 1 ? 's' : ''}${ok < rows.length ? ` · ${rows.length - ok} failed` : ''}. Click "Analyse All" to fetch & score their resumes.`, 'success');
}

function downloadResumeImportTemplate() {
  const csv = 'Name,Email,Phone,Resume Link\nJohn Doe,john@example.com,+15550192834,https://docs.google.com/document/d/EXAMPLE_ID/edit\nJane Smith,jane@example.com,,https://drive.google.com/file/d/EXAMPLE_ID/view';
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'IntervieHire_resume_links_template.csv';
  a.style.visibility = 'hidden';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// All interview scheduling is IST (Asia/Kolkata, UTC+05:30) — a fixed product
// decision, not a per-recruiter preference. The picker below never touches the
// recruiter's actual OS/browser timezone: its calendar+time UI just accumulates
// wall-clock digits (day/hour/minute), and we treat those digits as IST directly
// when converting to the UTC instant the backend stores.
const IST_OFFSET_MS = (5 * 60 + 30) * 60000;

function pad2(n) { return String(n).padStart(2, '0'); }
// Treat a Date's local getter digits (y/mo/da/h/mi — whatever the picker's UI set
// them to) as IST wall-clock, and return the real UTC instant as an ISO string.
function istPartsToUtcIso(d) {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), 0) - IST_OFFSET_MS).toISOString();
}
function formatSlot(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }) + ' IST';
}

// opts: { mode: 'schedule' | 'reschedule', name, email, slotTime, count }
// callback receives { start, end, timezone, slot } (slot is a friendly formatted start).
// Compact custom date+time picker: a month calendar (click a day) + a time input.
// Returns { el, getValue } where getValue() -> Date. Used in the schedule modal.
function createDateTimePicker(initial) {
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  const sel = new Date(initial.getTime());
  const view = new Date(initial.getFullYear(), initial.getMonth(), 1);

  const el = document.createElement('div');
  el.className = 'sdt';
  const field = document.createElement('button');
  field.type = 'button';
  field.className = 'sdt-field';
  const pop = document.createElement('div');
  pop.className = 'sdt-pop';
  pop.hidden = true;
  el.appendChild(field);
  el.appendChild(pop);

  const fmtField = () => {
    // `sel`'s digits (set via local getters/setters below, purely for this widget's
    // own calendar/time UI bookkeeping) ARE the IST wall-clock by convention — echo
    // them back with no timeZone override (that would re-interpret the object's
    // actual epoch through a different offset and show the wrong digits).
    field.textContent = sel.toLocaleString('en-US', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }) + ' IST';
  };
  const renderCal = () => {
    const y = view.getFullYear(), m = view.getMonth();
    const firstDow = new Date(y, m, 1).getDay();
    const days = new Date(y, m + 1, 0).getDate();
    let cells = '';
    for (let i = 0; i < firstDow; i++) cells += '<span class="sdt-day empty"></span>';
    for (let d = 1; d <= days; d++) {
      const on = sel.getFullYear() === y && sel.getMonth() === m && sel.getDate() === d;
      cells += `<button type="button" class="sdt-day${on ? ' sel' : ''}" data-d="${d}">${d}</button>`;
    }
    pop.innerHTML = `
      <div class="sdt-head">
        <button type="button" class="sdt-nav" data-nav="-1" aria-label="Previous month">‹</button>
        <span class="sdt-title">${MONTHS[m]} ${y}</span>
        <button type="button" class="sdt-nav" data-nav="1" aria-label="Next month">›</button>
      </div>
      <div class="sdt-dow">${DOW.map(d => `<span>${d}</span>`).join('')}</div>
      <div class="sdt-grid">${cells}</div>
      <div class="sdt-time-row">
        <label>Time</label>
        <input type="time" class="sdt-time" value="${pad2(sel.getHours())}:${pad2(sel.getMinutes())}" />
      </div>`;
  };

  field.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = !pop.hidden;
    el.closest('.schedule-modal')?.querySelectorAll('.sdt-pop').forEach(p => { p.hidden = true; });
    if (!open) { renderCal(); pop.hidden = false; }
  });
  pop.addEventListener('click', (e) => {
    e.stopPropagation();
    const nav = e.target.closest('.sdt-nav');
    if (nav) { view.setMonth(view.getMonth() + Number(nav.dataset.nav)); renderCal(); return; }
    const day = e.target.closest('.sdt-day');
    if (day && day.dataset.d) {
      sel.setFullYear(view.getFullYear(), view.getMonth(), Number(day.dataset.d));
      fmtField(); renderCal();
    }
  });
  pop.addEventListener('change', (e) => {
    if (e.target.classList.contains('sdt-time')) {
      const [h, mi] = e.target.value.split(':').map(Number);
      sel.setHours(h || 0, mi || 0, 0, 0);
      fmtField();
    }
  });

  fmtField();
  return { el, getValue: () => new Date(sel.getTime()) };
}

function openScheduleModal(opts, callback) {
  if (typeof opts === 'string') opts = { name: opts, mode: arguments[1] }, callback = arguments[2];
  const { mode = 'schedule', name = 'Candidate', email = '', slotTime = '', count = 1 } = opts || {};
  const isBulk = count > 1;
  const title = mode === 'reschedule' ? 'Reschedule Interview' : "Schedule Candidate's Window";

  const existing = document.getElementById('schedule-modal-overlay');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.id = 'schedule-modal-overlay';
  overlay.className = 'schedule-modal-overlay';

  const start = new Date(); start.setDate(start.getDate() + 1); start.setHours(10, 0, 0, 0);
  const end = new Date(start.getTime() + 30 * 60000);

  const ro = (label, value) => `<div class="sched-readonly-row"><span class="sched-ro-label">${label}</span><span class="sched-ro-value">${value}</span></div>`;
  const contextRows = isBulk
    ? ro('Candidates:', `${count} selected`)
    : ro('Candidate Name:', escapeHTML(name)) +
      (email ? ro('Candidate Email:', escapeHTML(email)) : '') +
      ro('Candidate Slot Time:', slotTime ? escapeHTML(slotTime) : '—');

  overlay.innerHTML = `
    <div class="schedule-modal">
      <button class="sched-close" id="sched-cancel" aria-label="Close">✕</button>
      <h3>${title}</h3>
      ${contextRows}
      <div class="schedule-form-group">
        <label>Time Zone</label>
        <div class="sched-tz-fixed">Asia/Kolkata (UTC+05:30) — all interview times are IST</div>
      </div>
      <div class="schedule-form-group">
        <label>Enter Date &amp; Time (IST)</label>
        <div class="sched-range-row">
          <div id="sched-start-mount" class="sdt-mount"></div>
          <span class="sched-range-sep">to</span>
          <div id="sched-end-mount" class="sdt-mount"></div>
        </div>
      </div>
      <button class="btn-schedule-continue" id="sched-confirm">Continue</button>
    </div>`;
  document.body.appendChild(overlay);

  const startPicker = createDateTimePicker(start);
  const endPicker = createDateTimePicker(end);
  overlay.querySelector('#sched-start-mount').appendChild(startPicker.el);
  overlay.querySelector('#sched-end-mount').appendChild(endPicker.el);
  const modalEl = overlay.querySelector('.schedule-modal');
  modalEl.addEventListener('click', (e) => {
    if (!e.target.closest('.sdt')) modalEl.querySelectorAll('.sdt-pop').forEach(p => { p.hidden = true; });
  });

  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.getElementById('sched-cancel').addEventListener('click', () => overlay.remove());
  document.getElementById('sched-confirm').addEventListener('click', () => {
    const startDate = startPicker.getValue();
    const endDate = endPicker.getValue();
    const timezone = 'Asia/Kolkata';
    if (endDate < startDate) { showPremiumToast('End time must be after the start time.', 'error'); return; }
    // Convert the picker's IST-intended digits into a real UTC instant now, so every
    // downstream consumer (backend API, cached fallback display) gets an unambiguous
    // absolute time rather than a naive string someone else has to guess a timezone for.
    const startV = istPartsToUtcIso(startDate);
    const endV = istPartsToUtcIso(endDate);
    overlay.remove();
    if (callback) callback({ start: startV, end: endV, timezone, slot: formatSlot(startV) });
    soundEngine.playChime([523.25, 659.25], 0.15, 0.08);
  });
}

const SFD_ICONS = {
  // Interview status
  'Completed': '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  'Incomplete': '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
  'Evaluating': '<line x1="12" x2="12" y1="2" y2="6"/><line x1="12" x2="12" y1="18" y2="22"/><line x1="4.93" x2="7.76" y1="4.93" y2="7.76"/><line x1="16.24" x2="19.07" y1="16.24" y2="19.07"/><line x1="2" x2="6" y1="12" y2="12"/><line x1="18" x2="22" y1="12" y2="12"/><line x1="4.93" x2="7.76" y1="19.07" y2="16.24"/><line x1="16.24" x2="19.07" y1="7.76" y2="4.93"/>',
  'Attempting': '<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/>',
  'Not Started': '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  'Slot Missed': '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
  // Cheat probability
  'High': '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/>',
  'Medium': '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
  'Low': '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  // Recruiter screening
  'Good fit': '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  'Moderate fit': '<circle cx="12" cy="12" r="10"/><line x1="8" x2="16" y1="12" y2="12"/>',
  'Poor fit': '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  // Actions
  'Shortlisted': '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  'Rejected': '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  'Waitlisted': '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  'Panel Shortlisted': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/>',
  'Panel Rejected': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="17" x2="22" y1="8" y2="13"/><line x1="22" x2="17" y1="8" y2="13"/>',
  'Panel Waitlisted': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><circle cx="18" cy="12" r="3"/><path d="M18 10.5v1.5l1 1"/>',
  'Pending Action': '<circle cx="12" cy="12" r="10"/><path d="M7 12h.01"/><path d="M12 12h.01"/><path d="M17 12h.01"/>',
};

function sfdIcon(value) {
  const paths = SFD_ICONS[value];
  return paths ? `<svg class="sfd-item-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>` : '';
}

function buildFilterDropdown(chip, type, candidates, stageKey) {
  if (chip._filterDropdown) { chip._filterDropdown.remove(); chip._filterDropdown = null; chip.classList.remove('active-filter'); return; }
  document.querySelectorAll('.stage-filter-dropdown').forEach(d => d.remove());
  document.querySelectorAll('.filter-chip.active-filter').forEach(c => { c.classList.remove('active-filter'); c._filterDropdown = null; });

  const dd = document.createElement('div');
  dd.className = 'stage-filter-dropdown';
  dd.addEventListener('click', e => e.stopPropagation());

  const filters = AppState.stageFilters[stageKey];

  if (type === 'interviewStatus') {
    const statuses = ['Completed', 'Incomplete', 'Evaluating', 'Attempting', 'Not Started', 'Slot Missed'];
    const counts = {};
    statuses.forEach(s => { counts[s] = candidates.filter(c => c.interviewStatus === s).length; });
    dd.innerHTML = `
      <div class="sfd-search"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><input type="text" placeholder="Interview Status" /></div>
      <div class="sfd-items">${statuses.map(s => `<label class="sfd-item"><input type="checkbox" value="${s}" ${filters.interviewStatus.includes(s) ? 'checked' : ''} />${sfdIcon(s)}<span class="sfd-item-label">${s}</span><span class="sfd-item-count">${counts[s]}</span></label>`).join('')}</div>
      <div class="sfd-footer"><button class="sfd-clear-btn">Clear filters</button></div>`;
    dd.querySelectorAll('input[type=checkbox]').forEach(cb => cb.addEventListener('change', () => {
      filters.interviewStatus = [...dd.querySelectorAll('input[type=checkbox]:checked')].map(c => c.value);
      const activeJob = AppState.jobs.find(j => j.id === AppState.activeJobId);
      if (activeJob) renderJobDetailPanes(activeJob);
    }));
    dd.querySelector('.sfd-clear-btn').addEventListener('click', () => { filters.interviewStatus = []; const activeJob = AppState.jobs.find(j => j.id === AppState.activeJobId); if (activeJob) renderJobDetailPanes(activeJob); });
  } else if (type === 'cheatProb') {
    const levels = ['High', 'Medium', 'Low'];
    const counts = {};
    levels.forEach(l => { counts[l] = candidates.filter(c => c.cheatProbability === l).length; });
    dd.innerHTML = `
      <div class="sfd-search"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><input type="text" placeholder="Cheat Probability" /></div>
      <div class="sfd-items">${levels.map(l => `<label class="sfd-item"><input type="checkbox" value="${l}" ${filters.cheatProb.includes(l) ? 'checked' : ''} />${sfdIcon(l)}<span class="sfd-item-label">${l}</span><span class="sfd-item-count">${counts[l]}</span></label>`).join('')}</div>
      <div class="sfd-footer"><button class="sfd-clear-btn">Clear filters</button></div>`;
    dd.querySelectorAll('input[type=checkbox]').forEach(cb => cb.addEventListener('change', () => {
      filters.cheatProb = [...dd.querySelectorAll('input[type=checkbox]:checked')].map(c => c.value);
      const activeJob = AppState.jobs.find(j => j.id === AppState.activeJobId); if (activeJob) renderJobDetailPanes(activeJob);
    }));
    dd.querySelector('.sfd-clear-btn').addEventListener('click', () => { filters.cheatProb = []; const activeJob = AppState.jobs.find(j => j.id === AppState.activeJobId); if (activeJob) renderJobDetailPanes(activeJob); });
  } else if (type === 'recruiterScreening') {
    const vals = ['Good fit', 'Moderate fit', 'Poor fit'];
    const counts = {};
    vals.forEach(v => { counts[v] = candidates.filter(c => c.recruiterScreening === v).length; });
    dd.innerHTML = `
      <div class="sfd-search"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><input type="text" placeholder="Recruiter Screening" /></div>
      <div class="sfd-items">${vals.map(v => `<label class="sfd-item"><input type="checkbox" value="${v}" ${filters.recruiterScreening.includes(v) ? 'checked' : ''} />${sfdIcon(v)}<span class="sfd-item-label">${v}</span><span class="sfd-item-count">${counts[v]}</span></label>`).join('')}</div>
      <div class="sfd-footer"><button class="sfd-clear-btn">Clear filters</button></div>`;
    dd.querySelectorAll('input[type=checkbox]').forEach(cb => cb.addEventListener('change', () => {
      filters.recruiterScreening = [...dd.querySelectorAll('input[type=checkbox]:checked')].map(c => c.value);
      const activeJob = AppState.jobs.find(j => j.id === AppState.activeJobId); if (activeJob) renderJobDetailPanes(activeJob);
    }));
    dd.querySelector('.sfd-clear-btn').addEventListener('click', () => { filters.recruiterScreening = []; const activeJob = AppState.jobs.find(j => j.id === AppState.activeJobId); if (activeJob) renderJobDetailPanes(activeJob); });
  } else if (type === 'interviewScore') {
    dd.innerHTML = `
      <div class="sfd-range-row">
        <label>Interview score</label>
        <input type="number" class="sfd-range-input" id="sfd-score-min" value="${filters.scoreMin ?? 0}" min="0" max="100" />
        <span class="sfd-range-sep">to</span>
        <input type="number" class="sfd-range-input" id="sfd-score-max" value="${filters.scoreMax ?? 100}" min="0" max="100" />
      </div>
      <div class="sfd-actions-row">
        <button class="sfd-btn-clear">Clear</button>
        <button class="sfd-btn-apply">Apply</button>
      </div>`;
    dd.querySelector('.sfd-btn-apply').addEventListener('click', () => {
      filters.scoreMin = parseInt(dd.querySelector('#sfd-score-min').value) || 0;
      filters.scoreMax = parseInt(dd.querySelector('#sfd-score-max').value) || 100;
      const activeJob = AppState.jobs.find(j => j.id === AppState.activeJobId); if (activeJob) renderJobDetailPanes(activeJob);
    });
    dd.querySelector('.sfd-btn-clear').addEventListener('click', () => { filters.scoreMin = null; filters.scoreMax = null; const activeJob = AppState.jobs.find(j => j.id === AppState.activeJobId); if (activeJob) renderJobDetailPanes(activeJob); });
  } else if (type === 'actions') {
    const acts = ['Shortlisted', 'Rejected', 'Waitlisted', 'Panel Shortlisted', 'Panel Rejected', 'Panel Waitlisted', 'Pending Action'];
    dd.innerHTML = `
      <div class="sfd-search"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><input type="text" placeholder="Actions" /></div>
      <div class="sfd-items">${acts.map(a => `<label class="sfd-item"><input type="checkbox" value="${a}" />${sfdIcon(a)}<span class="sfd-item-label">${a}</span><span class="sfd-item-count">0</span></label>`).join('')}</div>`;
  }

  const rect = chip.getBoundingClientRect();
  dd.style.left = rect.left + 'px';
  dd.style.top = (rect.bottom + 4) + 'px';
  document.body.appendChild(dd);
  chip.classList.add('active-filter');
  chip._filterDropdown = dd;

  const closeOnScroll = () => { dd.remove(); chip.classList.remove('active-filter'); chip._filterDropdown = null; };
  const mainContent = chip.closest('.main-content');
  if (mainContent) mainContent.addEventListener('scroll', closeOnScroll, { once: true });
}

function applyStageFilters(candidates, stageKey) {
  const f = AppState.stageFilters[stageKey];
  if (!f) return candidates;
  let filtered = candidates;
  if (f.interviewStatus.length > 0) filtered = filtered.filter(c => f.interviewStatus.includes(c.interviewStatus));
  if (f.cheatProb.length > 0) filtered = filtered.filter(c => f.cheatProb.includes(c.cheatProbability));
  if (f.recruiterScreening.length > 0) filtered = filtered.filter(c => f.recruiterScreening.includes(c.recruiterScreening));
  if (f.scoreMin != null) filtered = filtered.filter(c => c.interviewScore != null && c.interviewScore >= f.scoreMin);
  if (f.scoreMax != null) filtered = filtered.filter(c => c.interviewScore != null && c.interviewScore <= f.scoreMax);
  return filtered;
}

function hasActiveFilters(stageKey) {
  const f = AppState.stageFilters[stageKey];
  return f && (f.interviewStatus.length > 0 || f.cheatProb.length > 0 || f.recruiterScreening.length > 0 || f.scoreMin != null || f.scoreMax != null);
}


export { applyStageFilters, bindResumeAnalysisEvents, buildFilterDropdown, cacheResumeTextAndIdentity, extractExperienceYearsFromText, extractNameFromResumeText, handleResumeFile, hasActiveFilters, isGarbageText, openScheduleModal, refreshResumeCandidateRowIdentity, renderAnalysisResult, renderResumeStagePaneForJob, reportChatCache, resumeAnalysisCache, resumeIdentityCache, resumeTextCache, runBulkResumeAnalysis, runResumeAnalysis, toggleResumeCriteriaEdit };
