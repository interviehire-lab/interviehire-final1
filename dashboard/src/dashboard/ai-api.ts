import { document, signal, setTimeout, clearTimeout } from './runtime';
import { reviewJdRewrite } from './jd-rewrite';
import { generateQuestionsLocally, isVoiceQuestionLength } from './questions';
import { soundEngine } from './sound';
import { showPremiumToast } from './sourcing';
import { AppState, generateJobId } from './state';

// ============================================================
// DEEPSEEK QUESTIONS GENERATOR & LOCAL STORAGE PERSISTENCE
// ============================================================


function saveStateToLocalStorage() {
  localStorage.setItem('IntervieHire_jobs_state', JSON.stringify(AppState.jobs));
  localStorage.setItem('IntervieHire_candidates_state', JSON.stringify(AppState.candidates));
  localStorage.setItem('IntervieHire_team_state', JSON.stringify(AppState.team));
}

function loadStateFromLocalStorage() {
  const saved = localStorage.getItem('IntervieHire_jobs_state');
  if (!saved) {
    saveStateToLocalStorage();
    return;
  }
  
  try {
    const parsedJobs = JSON.parse(saved);
    if (!Array.isArray(parsedJobs) || parsedJobs.length === 0) {
      saveStateToLocalStorage();
      return;
    }
    
    // Replace AppState.jobs with parsed jobs from localStorage, ensuring all properties are defined with fallbacks
    AppState.jobs = parsedJobs.map(pj => {
      // Preserve only persisted job data. Missing fields stay neutral instead
      // of being backfilled from role-specific demo blueprints.
      const fallbackPipeline = { total: 0, resume: 0, screening: 0, functional: 0 };
      const fallbackDesc = "No job description provided.";
      const fallbackQuestions = [];
      
      return {
        ...pj, // keep every saved field (resumeCriteria, scoringConfig, pipelineConfig, …)
        id: pj.id || generateJobId(),
        roleName: pj.roleName || 'Untitled Role',
        cardName: pj.cardName || pj.roleName || 'Untitled Job',
        created: pj.created || 'Recently',
        status: pj.status || 'published',
        customJobId: pj.customJobId || '-',
        experienceBand: pj.experienceBand || '',
        createdBy: pj.createdBy || globalThis.IH_USER_NAME || 'You',
        description: pj.description || fallbackDesc,
        questions: pj.questions || fallbackQuestions,
        pipeline: pj.pipeline || fallbackPipeline
      };
    });
  } catch (e) {
    console.error("Error loading jobs from localStorage", e);
    // If corrupt, keep the in-memory seed state rather than inventing job data.
    saveStateToLocalStorage();
  }

  try {
    const savedCandidates = localStorage.getItem('IntervieHire_candidates_state');
    if (savedCandidates) {
      const parsed = JSON.parse(savedCandidates);
      if (Array.isArray(parsed) && parsed.length > 0) AppState.candidates = parsed;
    }
  } catch (e) {
    console.error("Error loading candidates from localStorage", e);
  }

  // Restore team members from the last session. In API mode hydrateTeam() later
  // overwrites this with the authoritative backend list; this restore keeps the
  // team visible on refresh while that fetch is in flight (and in local mode).
  try {
    const savedTeam = localStorage.getItem('IntervieHire_team_state');
    if (savedTeam) {
      const parsed = JSON.parse(savedTeam);
      if (Array.isArray(parsed) && parsed.length > 0) AppState.team = parsed;
    }
  } catch (e) {
    console.error("Error loading team from localStorage", e);
  }
}

// Mixture-of-experts routing: each task maps to the model best suited to it.
// This single map IS the routing "infra" — callers pass a task, nothing else
// changes. v4-pro = stronger judgement, v4-flash = fast/light. Flip a task's
// model here in one line; the proxy allowlist (route.js) must include it.
const MODEL_BY_TASK = {
  default: 'deepseek-v4-flash',
  // Resume scoring uses flash, NOT pro: pro is a REASONING model whose thinking pass
  // consumes the max_tokens budget, so the big analysis JSON came back truncated/empty
  // and every call fell to the local keyword engine. Flash is non-reasoning + reliable.
  resumeDeep: 'deepseek-v4-flash',
};
const SLOW_MODELS = new Set(['deepseek-v4-pro']); // reasoning tier may take longer (currently unused)

async function callDeepSeekAPI(messages: any, jsonMode = false, task = 'default', temperature?: number) {
  const model = MODEL_BY_TASK[task] || MODEL_BY_TASK.default;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SLOW_MODELS.has(model) ? 90000 : 60000);
  // temperature is forwarded only when a caller passes one; otherwise the proxy
  // applies its default (0.7). Resume scoring passes a low value for stability.
  const reqBody: any = { messages, jsonMode, model };
  if (typeof temperature === 'number') reqBody.temperature = temperature;
  const body = JSON.stringify(reqBody);
  const send = () => fetch('/api/deepseek', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: controller.signal,
  });

  // Up to 2 retries with exponential backoff + jitter, on rate-limit (429) and
  // network errors — but never on our own AbortController timeout, so a genuinely
  // hung call fails fast to the local engine instead of stacking 90s waits.
  const MAX_RETRIES = 2;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  try {
    for (let attempt = 0; ; attempt++) {
      let response;
      try {
        response = await send();
      } catch (error) {
        if (attempt < MAX_RETRIES && error.name !== 'AbortError') {
          await sleep(800 * 2 ** attempt + Math.random() * 250);
          continue;
        }
        throw error;
      }
      if (response.status === 429 && attempt < MAX_RETRIES) {
        await sleep(800 * 2 ** attempt + Math.random() * 250);
        continue;
      }
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`API response error (${response.status}): ${errText}`);
      }
      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content;
      // Empty/truncated content (e.g. JSON mode occasionally returns nothing) — retry
      // before giving up, so a transient blank doesn't silently drop to the local engine.
      if ((!content || !content.trim()) && attempt < MAX_RETRIES) {
        await sleep(800 * 2 ** attempt + Math.random() * 250);
        continue;
      }
      if (!content || !content.trim()) throw new Error('Empty AI response after retries');
      return content;
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

function sanitizeJSONResponse(text) {
  let cleaned = String(text || '').trim();
  // Strip a leading/trailing markdown code fence (```json … ``` or ``` … ```).
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  // If the model wrapped the JSON in prose, slice to the outermost object/array.
  const starts = [cleaned.indexOf('{'), cleaned.indexOf('[')].filter(i => i !== -1);
  if (starts.length) {
    const start = Math.min(...starts);
    const end = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
    if (end > start) cleaned = cleaned.slice(start, end + 1);
  }
  return cleaned.trim();
}

// Best-effort repair for the JSON errors DeepSeek most commonly emits:
// trailing commas, a missing comma between one-element-per-line array/object
// entries ("Expected ',' or ']' after array element"), and an unbalanced
// number of closing braces/brackets.
function repairJSONString(text) {
  let s = text.replace(/,(\s*[}\]])/g, '$1');
  // Insert a comma where the model dropped one between two values on
  // separate lines, e.g. `"first"\n  "second"` or `}\n  {` — matched only
  // across a newline (never mid-line) and only when no comma is already
  // there, so already-valid JSON is left untouched.
  s = s.replace(/("|\}|\]|true|false|null|-?\d+(?:\.\d+)?)([ \t]*\n[ \t]*)("|\{|\[)/g, '$1,$2$3');
  const balance = (open, close) => {
    const o = (s.match(new RegExp('\\' + open, 'g')) || []).length;
    const c = (s.match(new RegExp('\\' + close, 'g')) || []).length;
    if (o > c) s += close.repeat(o - c);
  };
  balance('{', '}');
  balance('[', ']');
  return s;
}

// Parse an AI JSON response with extraction + a single repair retry, instead of
// the old brace-slice + one JSON.parse that collapsed any fenced or
// trailing-comma response into a silent generic fallback. Throws only if the
// text is genuinely unparseable (callers still catch and degrade).
function parseAIJson(text) {
  const cleaned = sanitizeJSONResponse(text);
  try {
    return JSON.parse(cleaned);
  } catch {
    return JSON.parse(repairJSONString(cleaned));
  }
}

async function enrichJobWithAI(job, jdText) {
  const descriptionText = jdText || job.description || '';
  if (!descriptionText.trim()) return;

  const criteriaPrompt = `You are an expert HR analyst. Given a job description, extract structured resume screening criteria, recruiter screening parameters, and audit the job description for clarity, expectations, bias, and optimization.

Return ONLY valid JSON with this exact structure:
{
  "resumeCriteria": {
    "mustHave": ["3-5 strings: essential skills/experience the candidate MUST demonstrate"],
    "redFlags": ["0-3 strings: ONLY absolute deal-breakers that disqualify regardless of everything else. Each must be fundamentally disqualifying. NEVER restate or negate a mustHave item. Return [] if none truly apply."],
    "goodToHave": ["3-5 strings: bonus qualifications that strengthen a candidate"],
    "goodToHaveMinMatch": 1
  },
  "screeningParams": [
    { "category": "A screening category explicitly stated in the JD", "params": [
      { "name": "The stated requirement", "required": true, "flexibility": "Any flexibility stated in the JD or empty", "preferredResponse": "The value stated in the JD" }
    ]}
  ],
  "jdAnalysis": {
    "overallScore": "integer 0-100, overall job-description quality",
    "subScores": { "clarity": "0-100 integer", "inclusivity": "0-100 integer (free of biased/exclusionary/ageist language)", "structure": "0-100 integer (clear sections, scannable)", "marketFit": "0-100 integer (realistic asks for the talent market)" },
    "grade": "Letter grade (A, B+, B, C, D) representing job description quality",
    "readability": "Readability evaluation (e.g. Clear, Complex, Dense)",
    "warnings": {
      "unrealisticExpectations": ["List specific unrealistic expectations, conflicting requirements, or none"],
      "biasFluff": ["List flagged corporate jargon, clichés, or biased phrasing, or none"]
    },
    "marketContext": "Summary of talent supply for the required skills (1-2 sentences)",
    "recommendedOptimizations": ["Actionable improvements to the JD, list 2-3 items"]
  }
}

Tailor every field specifically to the role and use only evidence in the supplied description. Do not infer software or technology work from the word "engineer". If a screening category is not stated, omit it instead of inventing a preferred response. Do not use generic placeholders.
Red flags are rare; most roles have 0-1. Never produce a red flag that is just the inverse of a must-have.`;

  const questionsPrompt = `You are a senior role-specific assessment designer. Given a job description, generate 5 high-quality interview questions for exactly that role.

Return ONLY valid JSON with this exact structure:
{
  "questions": [
    {
      "id": "q-gen-1",
      "type": "technical OR behavioral OR situational",
      "question": "the interview question text",
      "difficulty": "beginner OR intermediate OR advanced",
      "rubric": "what a strong answer should demonstrate",
      "follow_ups": ["follow-up question 1", "follow-up question 2"]
    }
  ]
}

Rules:
- Generate exactly 5 questions with a mix appropriate to the work described. "technical" means role/domain expertise; it does not imply software engineering or coding.
- Keep each main question focused on one idea and at most 26 words. Put extra probes in the follow_ups array; never paste a full responsibility sentence into the question field.
- Vary difficulty: 1 beginner, 3 intermediate, 1 advanced
- Each question must have exactly 2 follow-ups
- Tailor every question specifically to the role described
- Derive every competency, scenario, tool, standard, and rubric expectation from the supplied job description. Never assume software development, system design, coding, product management, or any other occupation unless the description explicitly requires it.
- Use ids: q-gen-1 through q-gen-5`;

  const JD_ANALYSIS_LIMIT = 6000;
  const truncatedJD = descriptionText.slice(0, JD_ANALYSIS_LIMIT);
  if (descriptionText.length > JD_ANALYSIS_LIMIT) {
    showPremiumToast(`Long job description — analysing the first ${JD_ANALYSIS_LIMIT.toLocaleString()} characters.`, 'info');
  }

  const [criteriaResult, questionsResult] = await Promise.allSettled([
    callDeepSeekAPI([
      { role: 'system', content: criteriaPrompt },
      { role: 'user', content: `Job Description:\n\n${truncatedJD}` }
    ], true),
    callDeepSeekAPI([
      { role: 'system', content: questionsPrompt },
      { role: 'user', content: `Job Description:\n\n${truncatedJD}` }
    ], true)
  ]);

  if (criteriaResult.status === 'fulfilled') {
    try {
      const parsed = parseAIJson(criteriaResult.value);
      if (parsed.resumeCriteria) {
        job.resumeCriteria = {
          mustHave: parsed.resumeCriteria.mustHave || [],
          redFlags: parsed.resumeCriteria.redFlags || [],
          goodToHave: parsed.resumeCriteria.goodToHave || [],
          goodToHaveMinMatch: parsed.resumeCriteria.goodToHaveMinMatch || 1,
          source: 'ai'
        };
      }
      if (parsed.screeningParams && Array.isArray(parsed.screeningParams)) {
        job.screeningParams = parsed.screeningParams;
      }
      if (parsed.jdAnalysis) {
        job.jdAnalysis = parsed.jdAnalysis;
        job.jdAnalysis.source = 'ai';
      } else {
        job.jdAnalysis = auditJobDescriptionLocally(descriptionText);
      }
    } catch (e) {
      console.error('Failed to parse criteria response:', e);
      job.jdAnalysis = auditJobDescriptionLocally(descriptionText);
    }
  } else {
    job.jdAnalysis = auditJobDescriptionLocally(descriptionText);
    if (!job.resumeCriteria) {
      const sourceCriteria = descriptionText.split(/\n+|[.;]\s+/)
        .map((line) => line.replace(/^\s*[-*\d.)]+\s*/, '').trim())
        .filter((line) => line.length >= 12 && line.length <= 180);
      job.resumeCriteria = {
        mustHave: sourceCriteria.slice(0, 3),
        redFlags: [],
        goodToHave: sourceCriteria.slice(3, 6),
        goodToHaveMinMatch: 1,
        source: 'offline'
      };
    }
    if (!job.screeningParams) {
      job.screeningParams = [];
    }
  }

  if (questionsResult.status === 'fulfilled') {
    try {
      const parsed = parseAIJson(questionsResult.value);
      if (parsed.questions && Array.isArray(parsed.questions) && parsed.questions.every((q) => isVoiceQuestionLength(q?.question))) {
        job.questions = parsed.questions;
        job.questionsSource = 'ai';
      } else {
        job.questions = generateQuestionsLocally(job);
        job.questionsSource = 'offline';
      }
    } catch (e) {
      console.error('Failed to parse questions response:', e);
      job.questions = generateQuestionsLocally(job);
      job.questionsSource = 'offline';
    }
  } else {
    job.questions = generateQuestionsLocally(job);
    job.questionsSource = 'offline';
  }

  if (!job.pipelineConfig) {
    job.pipelineConfig = {
      careerPage: { enabled: true, listed: true },
      resumeAnalysis: { enabled: true },
      recruiterScreening: { enabled: true },
      functionalInterview: { enabled: true }
    };
  } else {
    if (job.resumeCriteria) job.pipelineConfig.resumeAnalysis = { enabled: true };
    if (job.screeningParams) job.pipelineConfig.recruiterScreening = { enabled: true };
    if (job.questions?.length) job.pipelineConfig.functionalInterview = { enabled: true };
  }

  job.applicationFields = job.applicationFields || ['Current Location', 'Expected CTC', 'Notice Period'];

  saveStateToLocalStorage();
}

function auditJobDescriptionLocally(jdText) {
  const text = jdText || '';
  const warnings = {
    unrealisticExpectations: [],
    biasFluff: []
  };
  const recommendedOptimizations = [];
  
  const charCount = text.length;
  let lengthRating = 'Good';
  if (charCount < 300) {
    lengthRating = 'Too Short';
    warnings.unrealisticExpectations.push("The description is extremely brief, which might not attract quality candidates.");
    recommendedOptimizations.push("Expand the job description to detail daily responsibilities and company culture.");
  } else if (charCount > 3000) {
    lengthRating = 'Too Long';
    warnings.unrealisticExpectations.push("The description is very dense, which might reduce candidate completion rates.");
    recommendedOptimizations.push("Simplify the layout and bullet points to focus on the core requirements.");
  }

  const lines = text.split('\n');
  const bulletCount = lines.filter(l => /^[*-•]|\d+\./.test(l.trim())).length;
  if (bulletCount < 3) {
    warnings.unrealisticExpectations.push("Lack of structured lists or bullet points for key requirements.");
    recommendedOptimizations.push("Use structured bullet points for 'Must-Have' and 'Nice-to-Have' skills to improve readability.");
  }

  const fluffKeywords = [
    { word: 'fast-paced', label: '"fast-paced" (can imply high burnout / chaotic environment)' },
    { word: 'rockstar', label: '"rockstar" (cliché, can discourage diverse candidates)' },
    { word: 'ninja', label: '"ninja" (unprofessional cliché)' },
    { word: 'guru', label: '"guru" (unprofessional cliché)' },
    { word: 'wear many hats', label: '"wear many hats" (often signals poor role definition)' },
    { word: 'dynamic', label: '"dynamic" (overused filler word)' },
    { word: 'self-starter', label: '"self-starter" (cliché, implies lack of onboarding)' },
    { word: 'synergy', label: '"synergy" (corporate jargon)' },
    { word: 'paradigm', label: '"paradigm" (corporate jargon)' }
  ];
  fluffKeywords.forEach(k => {
    if (new RegExp(`\\b${k.word}\\b`, 'i').test(text)) {
      warnings.biasFluff.push(`Flagged cliché: ${k.label}`);
    }
  });

  const expMatches = text.match(/(\d+)\s*\+?\s*(?:-\s*\d+)?\s*(?:years?|yrs?)/gi);
  if (expMatches) {
    expMatches.forEach(match => {
      const years = parseInt(match);
      if (years > 8) {
        warnings.unrealisticExpectations.push(`High experience requirement: "${match}". This might severely restrict the talent pool.`);
      }
    });
  }

  if (/next\.js|nextjs/i.test(text) && /1[0-9]\s*\+?\s*years?/i.test(text)) {
    warnings.unrealisticExpectations.push("Contradictory requirement: Requesting 10+ years of Next.js experience is unrealistic as the framework's mainstream adoption is more recent.");
  }
  if (/tailwind/i.test(text) && /1[0-9]\s*\+?\s*years?/i.test(text)) {
    warnings.unrealisticExpectations.push("Contradictory requirement: Requesting 10+ years of Tailwind CSS experience is unrealistic.");
  }

  let score = 90;
  score -= warnings.unrealisticExpectations.length * 10;
  score -= warnings.biasFluff.length * 5;
  if (charCount < 400 || charCount > 4000) score -= 10;
  if (bulletCount < 3) score -= 10;

  let grade = 'A';
  if (score >= 90) grade = 'A';
  else if (score >= 80) grade = 'B+';
  else if (score >= 70) grade = 'B';
  else if (score >= 60) grade = 'C+';
  else if (score >= 50) grade = 'C';
  else grade = 'D';

  let readability = 'Clear';
  if (charCount > 2500 || warnings.unrealisticExpectations.length > 2) {
    readability = 'Complex';
  } else if (charCount < 400) {
    readability = 'Sparse';
  }

  const clampPct = (n) => Math.max(0, Math.min(100, Math.round(n)));
  const subScores = {
    clarity: clampPct(95 - (readability === 'Complex' ? 22 : readability === 'Sparse' ? 16 : 0) - warnings.unrealisticExpectations.length * 4),
    inclusivity: clampPct(100 - warnings.biasFluff.length * 18),
    structure: clampPct(92 - (bulletCount < 3 ? 24 : 0) - (charCount < 400 ? 16 : charCount > 4000 ? 12 : 0)),
    marketFit: clampPct(78 - warnings.unrealisticExpectations.length * 6)
  };

  if (recommendedOptimizations.length === 0) {
    recommendedOptimizations.push("Maintain current clear structure and precise criteria.");
    recommendedOptimizations.push("Ensure compensation brackets are discussed early in screening.");
  }

  return {
    grade,
    readability,
    overallScore: clampPct(score),
    subScores,
    warnings,
    marketContext: "Talent-supply context requires current market data and is not estimated in offline mode.",
    recommendedOptimizations,
    source: 'offline'
  };
}

async function optimizeJobDescriptionWithAI(job, container) {
  const btn = container.querySelector('.btn-jd-optimize-ai');
  if (!btn) return;
  const originalLabel = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="ra-spinner"></span> Optimizing...`;
  
  soundEngine.playChime([392, 440], 0.08, 0.1);

  const systemPrompt = `You are a senior talent acquisition specialist. Optimize this job description to make it professional, clear, and realistic. 
Specifically:
- Remove corporate fluff/clichés like "rockstar", "ninja", "ninja developer", "dynamic self-starter", "wear many hats".
- Ensure the requirements (must-have skills) are realistic and consolidated to 3-5 clear points.
- Structure it clearly with sections for Role Overview, Key Responsibilities, and Qualifications.
- Return ONLY the optimized job description text — no commentary, no JSON, no markdown headers, no introductory or concluding chat remarks.`;

  try {
    const improved = await callDeepSeekAPI([
      { role: "system", content: systemPrompt },
      { role: "user", content: `Optimize this job description:\n\n${job.description}` }
    ]);

    // Restore the button before review so it isn't stuck spinning behind the modal.
    btn.disabled = false;
    btn.innerHTML = originalLabel;

    // AI suggests, the recruiter disposes — never overwrite their prose silently.
    const accepted = await reviewJdRewrite({
      title: 'Optimized Job Description',
      original: job.description,
      suggested: improved.trim()
    });
    if (accepted === null) {
      showPremiumToast('Kept your original job description.', 'info');
      return;
    }

    job.description = accepted;
    showPremiumToast("Job description optimized with AI.", "success");

    await enrichJobWithAI(job, job.description);

    const rawDesc = document.getElementById('jd-raw-description');
    if (rawDesc) rawDesc.value = job.description;

    soundEngine.playChime([523.25, 659.25], 0.12, 0.08);
  } catch (err) {
    console.error("JD optimization failed:", err);
    let cleanText = job.description;
    cleanText = cleanText.replace(/\b(?:rockstar|ninja|guru|ninja developer|wear many hats)\b/gi, 'professional');
    job.description = cleanText;
    await enrichJobWithAI(job, job.description);
    showPremiumToast("Local optimization applied (API unavailable).", "info");
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalLabel;
  }
}

// Suggest ADDITIONAL resume-screening criteria (not already listed) for a role.
// Returns {mustHave, redFlags, goodToHave} arrays. Throws on AI failure so the
// caller can fall back. Reuses the same DeepSeek proxy as enrichJobWithAI.
async function generateResumeCriteriaSuggestions(job) {
  const jd = (job.description || '').slice(0, 6000);
  const c = job.resumeCriteria || {};
  const list = (a) => (Array.isArray(a) && a.length ? a.join('; ') : '(none)');
  const system = `You are an expert HR analyst. Suggest ADDITIONAL resume-screening criteria for this role that are NOT already listed. Return ONLY valid JSON:
{"mustHave":["..."],"redFlags":["..."],"goodToHave":["..."]}
Rules:
- 3-5 items per group, each a short specific phrase tailored to the role.
- Use only requirements supported by the supplied job description. Never infer software engineering from the word "engineer"; return empty arrays when the source is too thin.
- Do NOT repeat or paraphrase anything already listed.
- Red flags: at most 1-2, and ONLY true deal-breakers; never restate or negate a must-have; prefer none.
- No preamble, no commentary.`;
  const user = `Role: ${job.roleName || job.cardName || 'the role'}${job.experienceBand ? ` (${job.experienceBand})` : ''}
Already listed —
Must have: ${list(c.mustHave)}
Red flags: ${list(c.redFlags)}
Good to have: ${list(c.goodToHave)}
${jd ? `\nJob description:\n${jd}` : ''}`;
  const raw = await callDeepSeekAPI([{ role: 'system', content: system }, { role: 'user', content: user }], true);
  const parsed = parseAIJson(raw);
  const arr = (x) => (Array.isArray(x) ? x.map((s) => String(s).trim()).filter(Boolean) : []);
  return { mustHave: arr(parsed?.mustHave), redFlags: arr(parsed?.redFlags), goodToHave: arr(parsed?.goodToHave) };
}


export { auditJobDescriptionLocally, callDeepSeekAPI, enrichJobWithAI, generateResumeCriteriaSuggestions, loadStateFromLocalStorage, optimizeJobDescriptionWithAI, parseAIJson, sanitizeJSONResponse, saveStateToLocalStorage };
