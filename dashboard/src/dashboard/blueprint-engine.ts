// Interview Blueprint engine — the authoring brain behind the redesigned
// Question Generator. Pure logic: no DOM, no localStorage. It owns the
// contract-aligned data model, AI generation of rubric-grade questions,
// normalization/validation, migration off the legacy flat `job.questions`,
// and serialization to the backend contract (aiEvaluationGuidance +
// functional_parameters) so authored blueprints port to the FastAPI/Node
// backend (see memory: interviehire-backend-contract) with zero rework.

import { callDeepSeekAPI, parseAIJson, sanitizeJSONResponse } from './ai-api';

// ── Vocabularies (must match the backend's enums exactly) ──────────────────
// The eval engine keys scoring weights off questionType; an unknown type
// silently degrades scoring, so generation is constrained to this set.
export const QUESTION_TYPES = [
  'technical_theory', 'coding', 'system_design', 'behavioral',
  'case_study', 'sales_roleplay', 'hr_screening', 'general', 'custom',
];
export const TOPIC_TYPES = ['Theoretical', 'Experiential'];
export const CONTRACT_DIFFICULTY = ['Easy', 'Medium', 'Hard'];
export const SEVERITY_LEVELS = ['low', 'medium', 'high', 'critical'];
// What KIND of assertion a rubric point grades — lets the evaluator calibrate
// what a good answer to that point looks like (a 'tradeoff' point needs two
// competing considerations named; a 'definition' point just needs the concept).
export const POINT_TYPES = ['definition', 'comparison', 'example', 'tradeoff', 'constraint', 'procedure', 'application', 'general'];
export const MODE_SCREENING = 'screening';
export const MODE_FUNCTIONAL = 'functional';

// The dashboard's legacy question vocab is beginner|intermediate|advanced
// (constants.js). The blueprint is contract-native (Easy|Medium|Hard); we map
// only at the legacy migration boundary so neither vocab drifts.
const LEGACY_TO_CONTRACT_DIFFICULTY = { beginner: 'Easy', intermediate: 'Medium', advanced: 'Hard' };
const LEGACY_TYPE_TO_QUESTION_TYPE = {
  technical: 'technical_theory', behavioral: 'behavioral',
  situational: 'case_study', coding: 'coding',
};

const MINUTES_BY_DIFFICULTY = { Easy: 3, Medium: 4, Hard: 5 };

let _seq = 0;
function uid(prefix) {
  _seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${_seq}`;
}

const clean = (v, fallback = '') => (typeof v === 'string' ? v.trim() : fallback);
const oneOf = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);
const arr = (v) => (Array.isArray(v) ? v : []);
const clampWeight = (w) => Math.max(1, Math.min(3, Math.round(Number(w) || 2)));
const snakeId = (s, fallback) =>
  (clean(s) || fallback).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || fallback;
const dedupeReqs = (list) => {
  const seen = new Set(); const out = [];
  arr(list).forEach((r) => { const c = clean(r); const k = c.toLowerCase(); if (c && !seen.has(k)) { seen.add(k); out.push(c); } });
  return out;
};

const VOICE_QUESTION_MAX_WORDS = 26;
const wordCount = (value) => clean(value).split(/\s+/).filter(Boolean).length;

// Turn a long JD responsibility into one speakable focus without inventing a
// different competency. Comma-delimited lists are kept only while the spoken
// focus stays short; the full source remains in targetRequirement and rubrics.
function conciseRequirement(requirement, maxWords = 12) {
  const source = clean(requirement)
    .replace(/^(?:responsibilities|requirements|qualifications|skills)\s*:?\s*/i, '')
    .replace(/\ball aspects of\b/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/[.;:]+$/, '')
    .trim();
  if (!source) return 'this requirement';

  const parts = source.split(/,\s*/).filter(Boolean);
  const selected = [];
  for (const part of parts) {
    const candidate = [...selected, part].join(', ');
    if (selected.length && wordCount(candidate) > maxWords) break;
    selected.push(part);
  }
  let focus = (selected.join(', ') || source).split(/\s+/).slice(0, maxWords).join(' ');
  focus = focus.replace(/\b(?:and|or|with|while|to|for|of|in|the)\s*$/i, '').replace(/[,.]+$/, '').trim();
  return focus || 'this requirement';
}

function voiceQuestionForRequirement(requirement) {
  const focus = conciseRequirement(requirement);
  const startsWithAction = /^(?:manage|oversee|ensure|lead|coordinate|develop|design|maintain|prepare|conduct|perform|deliver|implement|support|assess|plan|create|build|review|monitor|supervise)\b/i.test(focus);
  const subject = startsWithAction
    ? `a time you had to ${focus[0].toLowerCase()}${focus.slice(1)}`
    : `your experience with ${focus}`;
  return `Tell me about ${subject}. What was the outcome?`;
}

function voiceSafeGeneratedQuestion(question, source) {
  if (!question.edited && wordCount(question.prompt) > VOICE_QUESTION_MAX_WORDS) {
    question.prompt = voiceQuestionForRequirement(source || question.competency || question.targetRequirement);
  }
  return question;
}

export function tightenGeneratedVoicePrompts(functionalBlueprint) {
  arr(functionalBlueprint?.topics).forEach((topic) => {
    arr(topic.questions).forEach((question) => {
      if (question.edited || wordCount(question.prompt) <= VOICE_QUESTION_MAX_WORDS) return;
      const source = clean(question.targetRequirement) || clean(question.competency);
      if (!source) return;
      // Only rewrite the known generated-template failure mode: a long source
      // requirement was pasted directly into an otherwise unedited question.
      const normalizedPrompt = normReq(question.prompt);
      const normalizedSource = normReq(source);
      if (normalizedSource && normalizedPrompt.includes(normalizedSource)) {
        question.prompt = voiceQuestionForRequirement(source);
      }
    });
  });
  return functionalBlueprint;
}

// ── Factories ──────────────────────────────────────────────────────────────
export function createRubricPoint(description = '', weight = 2, keywords = [], opts: any = {}) {
  const point: any = { id: snakeId(description, uid('pt')), description: clean(description), keywords: arr(keywords).map((k) => clean(k)).filter(Boolean), weight: clampWeight(weight) };
  // Richer, optional grading metadata (v2 rubric) — only set when present so the
  // wire stays lean and legacy points are untouched.
  const pointType = oneOf(opts.pointType, POINT_TYPES, '');
  if (pointType) point.pointType = pointType;
  const partialCredit = clean(opts.partialCredit);
  if (partialCredit) point.partialCredit = partialCredit;
  const antiPatterns = arr(opts.antiPatterns).map((a) => clean(a)).filter(Boolean);
  if (antiPatterns.length) point.antiPatterns = antiPatterns;
  return point;
}

export function createRedFlag(description = '', severity = 'medium') {
  return { id: snakeId(description, uid('rf')), description: clean(description), severity: oneOf(severity, SEVERITY_LEVELS, 'medium') };
}

export function createQuestionBlueprint(overrides: any = {}) {
  const difficulty = oneOf(overrides.difficulty, CONTRACT_DIFFICULTY, 'Medium');
  return {
    id: overrides.id || uid('q'),
    prompt: clean(overrides.prompt),
    questionType: oneOf(overrides.questionType, QUESTION_TYPES, 'general'),
    difficulty,
    estimatedMinutes: Number(overrides.estimatedMinutes) || MINUTES_BY_DIFFICULTY[difficulty],
    competency: clean(overrides.competency),
    targetRequirement: clean(overrides.targetRequirement),
    modelAnswer: clean(overrides.modelAnswer),
    rubric: {
      requiredPoints: arr(overrides.rubric?.requiredPoints).filter((p) => p && typeof p === 'object').map((p) => createRubricPoint(p.description, p.weight, p.keywords, p)),
      secondaryPoints: arr(overrides.rubric?.secondaryPoints).filter((p) => p && typeof p === 'object').map((p) => createRubricPoint(p.description, p.weight ?? 1, p.keywords, p)),
      // First-class rubric points (was a string[] — which both evaluators silently
      // dropped). Accept legacy strings and rich objects; ignore null/garbage so a
      // malformed/truncated LLM element can't throw on s.description.
      // Drop only null/garbage (keep empty-description points so a just-added,
      // not-yet-typed excellence signal survives a round-trip — same as required/
      // secondary points). Empty points are ignored at eval time anyway.
      excellentAnswerSignals: arr(overrides.rubric?.excellentAnswerSignals)
        .map((s) => (typeof s === 'string' ? createRubricPoint(s, 1, []) : (s && typeof s === 'object' ? createRubricPoint(s.description, s.weight ?? 1, s.keywords, s) : null)))
        .filter(Boolean),
      redFlags: arr(overrides.rubric?.redFlags).map((f) => createRedFlag(f.description, f.severity)),
    },
    followUpIntent: clean(overrides.followUpIntent),
    // Interviewer-facing run-sheet note: short signals of what a strong answer
    // sounds like. Distinct from rubric points (which the evaluator grades) —
    // this is what the human/avatar listens for live. Optional, defaults [].
    listenFor: arr(overrides.listenFor).map((s) => clean(s)).filter(Boolean),
    // Set once the recruiter hand-edits/authors this question, so a later
    // "Generate" preserves it instead of clobbering manual work (survives reload
    // via the v2 guidance envelope).
    edited: !!overrides.edited,
  };
}

export function createTopic(overrides: any = {}) {
  return {
    id: overrides.id || uid('topic'),
    name: clean(overrides.name, 'Untitled topic'),
    type: oneOf(overrides.type, TOPIC_TYPES, 'Experiential'),
    difficulty: oneOf(overrides.difficulty, CONTRACT_DIFFICULTY, 'Medium'),
    // Run-sheet structure (the interview-outline layer). Optional, default ''.
    // whyItMatters: the section's rationale; segue: the line spoken when moving
    // ON to the NEXT topic. Both author/edit in the studio's Outline mode.
    whyItMatters: clean(overrides.whyItMatters),
    segue: clean(overrides.segue),
    questions: arr(overrides.questions).map((q) => createQuestionBlueprint(q)),
  };
}

// A recommended topic area the recruiter curates BEFORE generation. Accepted
// suggestions seed the outline call (their names become topics, their rationale
// becomes the topic's whyItMatters). Curation-only — no questions yet.
export function createTopicSuggestion(overrides: any = {}) {
  return {
    id: overrides.id || uid('ts'),
    name: clean(overrides.name, 'Untitled topic'),
    type: oneOf(overrides.type, TOPIC_TYPES, 'Experiential'),
    difficulty: oneOf(overrides.difficulty, CONTRACT_DIFFICULTY, 'Medium'),
    rationale: clean(overrides.rationale),
    accepted: overrides.accepted !== false,
  };
}

// Interview-level run-sheet bookends (what the avatar says before Q1 / after the
// last answer). Recruiter-facing prose, not the engine's substring-matched
// CLOSING_LINE constant. Coerced so a partial/legacy payload is always safe.
export const emptyInterviewStructure = () => ({ openingLine: '', closingLine: '' });
export function normalizeInterviewStructure(s) {
  return { openingLine: clean(s?.openingLine), closingLine: clean(s?.closingLine) };
}

export const emptyFunctionalBlueprint = () => ({ topics: [] });
export const emptyScreeningBlueprint = () => ({ questions: [] });

// ── Rubric completeness (drives the "rubric ready / light / missing" badge) ──
export function rubricStrength(qb) {
  const r = qb.rubric || {};
  const hasModel = !!clean(qb.modelAnswer);
  const reqs = arr(r.requiredPoints).length;
  const flags = arr(r.redFlags).length;
  if (hasModel && reqs >= 2 && flags >= 1) return 'ready';
  if (hasModel || reqs >= 1) return 'light';
  return 'missing';
}

// ── Rubric quality critic ────────────────────────────────────────────────────
// A second pass over an authored question that flags rubric problems an LLM
// evaluator can't grade well: unmeasurable required points, unrealistic or
// over-eager red flags, and model answers mismatched to the question's
// difficulty. Pure heuristics (no AI) so it runs live as the recruiter edits.
const VAGUE_TERMS = ['good', 'great', 'nice', 'strong', 'solid', 'well', 'properly', 'appropriate',
  'appropriately', 'correctly', 'understands', 'understanding', 'familiar', 'familiarity', 'aware',
  'reasonable', 'clearly', 'effective', 'effectively', 'quality', 'as expected'];
const ATTITUDE_TERMS = ['attitude', 'passion', 'passionate', 'enthusiasm', 'enthusiastic', 'culture fit',
  'team player', 'positive', 'energy', 'likeable', 'likable', 'friendly'];

function pointIssue(p) {
  const desc = clean(p.description);
  const lower = desc.toLowerCase();
  const words = lower.split(/\s+/).filter(Boolean);
  const hasKeywords = arr(p.keywords).filter(Boolean).length > 0;
  if (!desc) return 'Empty required point — nothing for the evaluator to grade.';
  if (ATTITUDE_TERMS.some((t) => lower.includes(t))) return `“${desc}” is attitudinal — not measurable from a transcript.`;
  if (words.length < 3 && !hasKeywords) return `“${desc}” is too vague to grade — add specifics or keywords.`;
  const vagueHits = VAGUE_TERMS.filter((t) => lower.includes(t)).length;
  if (words.length <= 5 && vagueHits >= 1 && !hasKeywords) return `“${desc}” reads vague — name a concrete thing the answer must contain.`;
  return null;
}

function flagIssue(f, qb) {
  const desc = clean(f.description);
  const lower = desc.toLowerCase();
  if (!desc) return 'Empty red flag.';
  if (lower.split(/\s+/).filter(Boolean).length < 3) return `Red flag “${desc}” is too vague to detect reliably.`;
  // critical severity should be reserved for integrity/safety signals, not a
  // routine weak answer — implausible on an easy or soft-skill question.
  if (f.severity === 'critical' && (qb.difficulty === 'Easy' || qb.questionType === 'behavioral' || qb.questionType === 'hr_screening')) {
    return `“${desc}” marked critical on an ${qb.difficulty}/${qb.questionType} question — likely over-severe.`;
  }
  return null;
}

function modelAnswerIssues(qb) {
  const issues = [];
  const model = clean(qb.modelAnswer);
  const words = model ? model.split(/\s+/).filter(Boolean).length : 0;
  const reqCount = arr(qb.rubric?.requiredPoints).filter((p) => clean(p.description)).length;
  if (qb.difficulty === 'Hard') {
    if (!model) issues.push('Hard question has no model answer to grade against.');
    else if (words < 20) issues.push('Model answer looks thin for a Hard question — expand what a strong answer covers.');
    if (reqCount < 2) issues.push('Hard question has fewer than 2 required points — under-specified rubric.');
  } else if (qb.difficulty === 'Easy') {
    if (words > 80) issues.push('Model answer is long for an Easy question — it may over-expect.');
    if (reqCount > 4) issues.push('Easy question has 5+ required points — likely over-graded.');
  } else if (!model && reqCount < 1) {
    issues.push('No model answer and no required points — nothing to grade against.');
  }
  return issues;
}

// Returns the rubric issues for one question: [{ level:'warn'|'info', kind, message }].
export function critiqueRubric(qb) {
  const issues = [];
  const r = qb.rubric || {};
  arr(r.requiredPoints).forEach((p) => { const m = pointIssue(p); if (m) issues.push({ level: 'warn', kind: 'point', message: m }); });
  // Measurability: a required point with no keywords can't be matched locally,
  // and two points sharing most keywords always co-fire (weights become moot).
  const reqPts = arr(r.requiredPoints).filter((p) => clean(p.description));
  reqPts.forEach((p) => { if (!arr(p.keywords).filter(Boolean).length) issues.push({ level: 'info', kind: 'point', message: `“${clean(p.description)}” has no keywords — add a few so the evaluator can match it.` }); });
  for (let i = 0; i < reqPts.length; i += 1) {
    for (let j = i + 1; j < reqPts.length; j += 1) {
      const a = new Set(arr(reqPts[i].keywords).map((k) => k.toLowerCase()).filter(Boolean));
      const b = [...new Set(arr(reqPts[j].keywords).map((k) => k.toLowerCase()).filter(Boolean))];
      if (a.size && b.length && b.filter((k) => a.has(k)).length / Math.max(a.size, b.length) > 0.5) {
        issues.push({ level: 'info', kind: 'point', message: 'Two required points share most keywords — they will always score together; differentiate them.' });
        i = reqPts.length; break;
      }
    }
  }
  const flags = arr(r.redFlags);
  flags.forEach((f) => { const m = flagIssue(f, qb); if (m) issues.push({ level: 'warn', kind: 'flag', message: m }); });
  if (flags.length > 3) issues.push({ level: 'info', kind: 'flag', message: `${flags.length} red flags — keep only the few that truly disqualify.` });
  modelAnswerIssues(qb).forEach((m) => issues.push({ level: 'warn', kind: 'model', message: m }));
  return issues;
}

// Blueprint-wide critic: one entry per question that has issues. Also runs a
// cross-question pass for non-discriminating keywords (a keyword reused across
// many required points can't separate a strong answer from a weak one).
export function critiqueBlueprint(functionalBlueprint) {
  const entries = (functionalBlueprint.topics || []).flatMap((t) =>
    t.questions.map((q) => ({ q, questionId: q.id, prompt: q.prompt, topicName: t.name, issues: critiqueRubric(q) })));
  const kwCount = new Map();
  let pointTotal = 0;
  entries.forEach(({ q }) => arr(q.rubric?.requiredPoints).forEach((p) => {
    pointTotal += 1;
    new Set(arr(p.keywords).map((k) => k.toLowerCase()).filter(Boolean)).forEach((k) => kwCount.set(k, (kwCount.get(k) || 0) + 1));
  }));
  const overUsed = new Set(pointTotal >= 4 ? [...kwCount.entries()].filter(([, c]) => c / pointTotal > 0.5).map(([k]) => k) : []);
  if (overUsed.size) {
    entries.forEach((entry) => {
      const generic = new Set();
      arr(entry.q.rubric?.requiredPoints).forEach((p) => arr(p.keywords).forEach((k) => { if (overUsed.has(k.toLowerCase())) generic.add(k.toLowerCase()); }));
      if (generic.size) entry.issues.push({ level: 'info', kind: 'point', message: `Keyword(s) “${[...generic].join(', ')}” recur across many questions — too generic to discriminate; add a more specific term.` });
    });
  }
  return entries.map(({ questionId, prompt, topicName, issues }) => ({ questionId, prompt, topicName, issues })).filter((e) => e.issues.length);
}

// ── Anti-leakage: flag "too googleable" recall/definition questions ──────────
// A question whose answer is a canonical, memorisable definition lets a prepared
// candidate score full marks without demonstrating real ability. Scenario/
// experience questions force application, so they're inherently low-risk.
const SCENARIO_TYPES = ['behavioral', 'case_study', 'system_design', 'sales_roleplay'];
const SCENARIO_CUE = /\b(how would you|walk me through|tell me about a time|describe a (time|situation|project)|give me an example|given that|suppose|imagine|you (are|have|notice|find|inherit)|a (customer|user|teammate|stakeholder)|in production|real situation|step me through|how do you decide|trade-?off)\b/;
const DEFINITION_LEAD = /^\s*(what is|what are|what's|whats|define|explain (what|the difference|the differences)|name the|list( the)?|what does|state the|mention the|when do you use)\b/;
const DEFINITION_PHRASE = /\b(difference between|differences between|types of|kinds of|advantages of|disadvantages of|benefits of|features of|pros and cons|what do you mean by|stand for|definition of)\b/;

export function leakageRisk(qb) {
  const p = clean(qb.prompt).toLowerCase();
  if (!p) return { risk: 'low', reason: '' };
  if (SCENARIO_TYPES.includes(qb.questionType) || SCENARIO_CUE.test(p)) return { risk: 'low', reason: '' };
  if (DEFINITION_LEAD.test(p) || DEFINITION_PHRASE.test(p)) {
    return { risk: 'high', reason: 'Definition-style question — a memorised or searched answer scores full marks. Recast it as a scenario the candidate must reason through.' };
  }
  if (qb.questionType === 'technical_theory') {
    return { risk: 'medium', reason: 'Recall-leaning — ground it in a concrete situation so memorised theory alone is not enough.' };
  }
  return { risk: 'low', reason: '' };
}

// ── Migration off the legacy flat `job.questions` ───────────────────────────
// Groups legacy questions by type into topics, lifting the freeform `rubric`
// sentence into a single required point and `follow_ups` into followUpIntent,
// so nothing authored under the old model is lost.
export function migrateLegacyQuestions(legacyQuestions) {
  const groups = new Map();
  arr(legacyQuestions).forEach((q) => {
    const qType = LEGACY_TYPE_TO_QUESTION_TYPE[q.type] || 'general';
    const difficulty = LEGACY_TO_CONTRACT_DIFFICULTY[q.difficulty] || 'Medium';
    const topicName = q.type ? `${q.type[0].toUpperCase()}${q.type.slice(1)}` : 'General';
    if (!groups.has(topicName)) groups.set(topicName, []);
    groups.get(topicName).push(createQuestionBlueprint({
      prompt: q.question || q.text,
      questionType: qType,
      difficulty,
      modelAnswer: clean(q.rubric),
      rubric: { requiredPoints: q.rubric ? [{ description: q.rubric, weight: 3 }] : [] },
      followUpIntent: arr(q.follow_ups).filter(Boolean).join(' · '),
    }));
  });
  const topics = [];
  groups.forEach((questions, name) => {
    topics.push(createTopic({
      name,
      type: name === 'Behavioral' ? 'Experiential' : 'Theoretical',
      difficulty: questions[0]?.difficulty || 'Medium',
      questions,
    }));
  });
  return { topics };
}

// Returns the functional blueprint for a job, migrating legacy data on first
// read. Does not persist — the caller owns saveStateToLocalStorage.
export function ensureFunctionalBlueprint(job) {
  if (job.functionalParameters && Array.isArray(job.functionalParameters.topics)) {
    return tightenGeneratedVoicePrompts(job.functionalParameters);
  }
  return migrateLegacyQuestions(job.questions);
}

// ── Generation prompts ──────────────────────────────────────────────────────
function jdContext(job) {
  const must = arr(job.resumeCriteria?.mustHave);
  const good = arr(job.resumeCriteria?.goodToHave);
  return [
    `Role: ${clean(job.roleName) || clean(job.cardName) || 'the role'}`,
    job.experienceBand ? `Seniority: ${job.experienceBand}` : '',
    clean(job.description) ? `Job description:\n${job.description}` : '',
    must.length ? `Must-have requirements:\n- ${must.join('\n- ')}` : '',
    good.length ? `Good-to-have:\n- ${good.join('\n- ')}` : '',
  ].filter(Boolean).join('\n\n');
}

const RUBRIC_SHAPE = `"rubric":{"requiredPoints":[{"description":"...","keywords":["lowercase terms the evaluator matches"],"weight":1-3,"pointType":"${POINT_TYPES.join('|')}","partialCredit":"what earns partial (not full) credit","antiPatterns":["a confused/incorrect claim that must NOT score"]}],"secondaryPoints":[{"description":"...","keywords":["..."],"weight":1}],"excellentAnswerSignals":[{"description":"an above-bar signal separating great from good","keywords":["..."],"weight":1}],"redFlags":[{"description":"...","severity":"low|medium|high|critical"}]}`;

// Difficulty shapes what a rubric should demand — an Easy question shouldn't get
// a Hard-question rubric, and a Hard question shouldn't get a thin one.
const ENRICH_BY_DIFFICULTY = {
  Easy: 'EASY: 1-2 requiredPoints, a concrete/closed expected answer, a 1-2 sentence model answer. Do NOT demand trade-off or edge-case reasoning.',
  Medium: 'MEDIUM: 2-3 requiredPoints; a 3-4 sentence model answer referencing one concrete example or mechanism; at least one point should reward reasoning (pointType "example" or "procedure").',
  Hard: 'HARD: 3-4 requiredPoints; a multi-sentence model answer; REQUIRE one point with pointType "tradeoff" (names competing considerations) and one with pointType "constraint" (failure modes / edge cases); weight the reasoning points highest.',
};

// Generation is TWO-PHASE: the DeepSeek proxy caps output at 3000 tokens, and a
// full blueprint with rubrics overflows and truncates mid-JSON (verified). So
// phase 1 authors a lightweight OUTLINE (prompts only — fits easily) and phase 2
// enriches each question's rubric in its own small call. The studio fills
// rubrics in progressively.
function buildOutlineMessages(job: any, opts: any = {}) {
  const seed = arr(opts.topicSeed).map((t) => clean(t.name)).filter(Boolean);
  const topicCount = seed.length || opts.topicCount || 4;
  // ponytail: 30-min interview budget baked in. The AI sizes the outline to fit
  // it dynamically (via each question's estimatedMinutes). Pass opts.targetMinutes
  // from a recruiter input if rounds ever need a different length.
  const targetMinutes = Math.max(5, Math.round(opts.targetMinutes || 30));
  const requirements = dedupeReqs(opts.requirements);
  const reqBlock = requirements.length
    ? `\n\nRequired competencies — cover EVERY one with at least one question and set that question's "targetRequirement" to the competency text VERBATIM:\n${requirements.map((r, i) => `${i + 1}. ${r}`).join('\n')}`
    : '';
  // When the recruiter curated a topic menu, honour it: one topic per accepted
  // area, keeping the chosen names so the studio can stamp each topic's rationale
  // back onto it as whyItMatters.
  const seedBlock = seed.length
    ? `\n\nUSE THESE TOPIC AREAS (the recruiter selected them) — one topic each, keep these names:\n${seed.map((n, i) => `${i + 1}. ${n}`).join('\n')}`
    : '';
  const system = `You are a domain-neutral senior interviewer and assessment designer. Author the OUTLINE of a FUNCTIONAL (deep, role-specific) interview an AI avatar will conduct by VOICE.

Return ONLY JSON (no markdown), shape:
{"topics":[{"name":"...","type":"Theoretical|Experiential","difficulty":"Easy|Medium|Hard","questions":[{"prompt":"...","questionType":"${QUESTION_TYPES.join('|')}","difficulty":"Easy|Medium|Hard","estimatedMinutes":3-6,"competency":"which capability this tests","targetRequirement":"the exact required competency this maps to, or empty"}]}]}

Rules:
- Ground every topic, competency, scenario, and question in the supplied JD or recruiter-selected requirements. Never infer software engineering from the word "engineer"; introduce coding, system design, APIs, or software quality only when explicitly supported by the source.
- Size the whole interview to ~${targetMinutes} minutes: choose how many topics${seed.length ? ' (one per area below)' : ` (around ${topicCount})`} and how many questions each so the SUM of every question's estimatedMinutes is close to but does NOT exceed ${targetMinutes}. Every required competency listed below MUST be tested within that budget; add depth questions only if minutes remain.
- targetRequirement: copy the matching competency VERBATIM from the numbered list; use "" only for an extra depth question that maps to none.
- prompt: ONE idea, conversational, speakable aloud, and at most ${VOICE_QUESTION_MAX_WORDS} words. Never paste a full responsibility or requirement into the question. Ask one main question; the voice agent can probe details as follow-ups.
- OUTLINE ONLY — do NOT include model answers or rubrics here.
- No preamble, no trailing commentary.${seedBlock}${reqBlock}`;
  return [{ role: 'system', content: system }, { role: 'user', content: `Outline the functional interview for:\n\n${jdContext(job)}` }];
}

function buildEnrichMessages(job, q, topicName) {
  const tier = ENRICH_BY_DIFFICULTY[q.difficulty] || ENRICH_BY_DIFFICULTY.Medium;
  const system = `You write the grading rubric an AI evaluator uses to score ONE spoken interview answer. Be concrete and discriminating — the keywords and partialCredit must let an evaluator tell a real answer from a bluffed one. Use only the supplied role, topic, question, and JD context; do not import expectations from another profession.

Return ONLY JSON (no markdown), shape:
{"modelAnswer":"what a strong answer covers",${RUBRIC_SHAPE},"followUpIntent":"when/how the avatar should probe deeper"}

Rules:
- Calibrate to difficulty — ${tier}
- Each requiredPoint: 2-5 lowercase keywords, weight 1-3, a pointType, and a partialCredit note; add antiPatterns when a plausible-sounding wrong answer exists.
- redFlags: 1-2 realistic failure signals. excellentAnswerSignals: 1-2 above-bar signals as objects (not bare strings).
- No preamble.`;
  const user = `Role: ${clean(job.roleName) || clean(job.cardName) || 'the role'}${job.experienceBand ? ` (${job.experienceBand})` : ''}
Topic: ${topicName}
Question (${q.questionType}, ${q.difficulty}): ${q.prompt}
Write the model answer and rubric.`;
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

function buildScreeningMessages(job: any, opts: any = {}) {
  const count = opts.count || 4;
  const categories = arr(job.screeningParams).map((c) => c.category).filter(Boolean);
  const system = `You are a recruiter running a short SCREENING call an AI avatar conducts by VOICE. Goal: gate fit, not deep evaluation — background, motivation, logistics (compensation, notice, location), and one role-relevant probe.

Return ONLY JSON (no markdown), shape:
{"questions":[{"prompt":"...","questionType":"hr_screening","difficulty":"Easy","competency":"what this confirms","modelAnswer":"what an acceptable answer sounds like","rubric":{"requiredPoints":[{"description":"what an acceptable answer must convey","keywords":["..."],"weight":2}],"redFlags":[{"description":"a disqualifying answer","severity":"medium"}]},"followUpIntent":"what to clarify if the answer is vague"}]}

Rules:
- Exactly ${count} questions, short and warm, speakable aloud, and at most ${VOICE_QUESTION_MAX_WORDS} words each.
- Cover background/motivation and the logistics the role cares about${categories.length ? `: ${categories.join(', ')}` : ''}.
- Each question carries a LIGHT rubric: 1-2 requiredPoints (what an acceptable answer conveys, with lowercase keywords) + 0-1 redFlag, so screening answers are scored, not pass/fail.
- No technical depth — that is the functional round's job.`;
  const user = `Author the screening questions for:\n\n${jdContext(job)}`;
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

async function callJson(messages) {
  const raw = await callDeepSeekAPI(messages, true);
  return parseAIJson(sanitizeJSONResponse(raw));
}

export async function generateFunctionalOutline(job, opts = {}) {
  const parsed = await callJson(buildOutlineMessages(job, opts));
  return normalizeFunctionalBlueprint(parsed);
}

// Authors one question's model answer + rubric. Returns the normalized fields
// the caller merges onto the question object. Throws on AI/parse failure so the
// studio can keep the existing (or local) rubric.
export async function enrichQuestionRubric(job, q, topicName) {
  const parsed = await callJson(buildEnrichMessages(job, q, topicName));
  return normalizeRubricPayload(parsed);
}

export function normalizeRubricPayload(parsed) {
  const b = createQuestionBlueprint({ modelAnswer: parsed?.modelAnswer, rubric: parsed?.rubric, followUpIntent: parsed?.followUpIntent });
  return { modelAnswer: b.modelAnswer, rubric: b.rubric, followUpIntent: b.followUpIntent };
}

export async function generateScreeningQuestions(job, opts = {}) {
  const parsed = await callJson(buildScreeningMessages(job, opts));
  return normalizeScreeningBlueprint(parsed);
}

// ── Suggested topics (the curation step before generation) ───────────────────
// Recommends the topic AREAS worth probing for this role, each with a short
// interviewer-facing rationale. The recruiter accepts/rejects/edits them, and the
// accepted set seeds generation (see buildOutlineMessages opts.topicSeed).
function buildTopicSuggestionMessages(job, requirements = []) {
  const reqs = dedupeReqs(requirements);
  const reqBlock = reqs.length
    ? `\n\nWeave these required competencies across the topics:\n${reqs.map((r, i) => `${i + 1}. ${r}`).join('\n')}`
    : '';
  const system = `You are a domain-neutral senior interviewer planning a FUNCTIONAL interview. Propose the TOPIC AREAS worth probing for this role, each with one short interviewer-facing rationale.

Return ONLY JSON (no markdown), shape:
{"suggestedTopics":[{"name":"short topic name","type":"Theoretical|Experiential","difficulty":"Easy|Medium|Hard","rationale":"1 sentence: what a strong vs weak answer in this area reveals about the candidate"}]}

Rules:
- Every topic must be traceable to the supplied JD or required competencies. Never infer software engineering from the word "engineer" or add coding/system-design topics unless explicitly required.
- 4-6 distinct, non-overlapping topics, ordered foundational → advanced; each name is a concise capability label, not a pasted responsibility sentence.
- rationale is for the RECRUITER, not the candidate — why this area separates real ability from someone who only memorised theory.
- No preamble, no trailing commentary.${reqBlock}`;
  return [{ role: 'system', content: system }, { role: 'user', content: `Suggest interview topics for:\n\n${jdContext(job)}` }];
}

export async function suggestTopics(job, requirements = []) {
  const parsed = await callJson(buildTopicSuggestionMessages(job, requirements));
  const out = arr(parsed?.suggestedTopics)
    .map((t) => createTopicSuggestion(t))
    .filter((t) => t.name && t.name !== 'Untitled topic');
  if (!out.length) throw new Error('empty topic suggestions');
  return out;
}

// Keyless fallback so "Suggest topics" always yields a real, role-aware menu
// even with the AI proxy down — derived from the controlled requirement list.
export function localTopicSuggestions(job, requirements = []) {
  const reqs = dedupeReqs(requirements.length ? requirements : localRequirements(job));
  return reqs.slice(0, 6).map((r, i, all) => createTopicSuggestion({
    name: conciseRequirement(r, 8),
    type: i % 2 === 0 ? 'Experiential' : 'Theoretical',
    difficulty: i === 0 ? 'Easy' : i >= all.length - 1 ? 'Hard' : 'Medium',
    rationale: `Probes ${r.toLowerCase()} through applied scenarios — a prepared candidate can recite theory, but only real experience holds up when they have to reason about a concrete situation.`,
  }));
}

// ── Requirement analysis (the controlled vocabulary questions pin to) ─────────
// The recruiter's must-haves ARE the requirements when present; when they are
// thin we decompose the JD with the LLM, falling back to good-to-haves / role
// archetype so the controlled list is never empty.
function buildRequirementMessages(job) {
  const system = `You are a hiring analyst. From the job description, extract the concrete, assessable competencies a FUNCTIONAL interview must test.

Return ONLY JSON (no markdown): {"requirements":["short competency phrase", ...]}
Rules:
- 5-7 items, each a short noun phrase copied or faithfully condensed from the source — NOT a sentence.
- Specific and testable; skip soft fluff unless the role genuinely hinges on it.
- Use only the supplied role/JD. The word "engineer" alone does not mean software; never add coding or system design unless the JD says so.
- No preamble.`;
  return [{ role: 'system', content: system }, { role: 'user', content: jdContext(job) }];
}

function localRequirements(job) {
  const must = dedupeReqs(arr(job.resumeCriteria?.mustHave));
  const good = dedupeReqs(arr(job.resumeCriteria?.goodToHave));
  const configured = dedupeReqs([...must, ...good]);
  if (configured.length) return configured;

  // The offline path must remain role-specific without guessing an archetype
  // from words such as "engineer" (which previously made a Civil Engineer get
  // software-system-design questions). Use assessable clauses from the actual JD.
  const description = clean(job.description);
  const fromDescription = dedupeReqs(description
    .split(/\n+|[.;]\s+/)
    .map((line) => line.replace(/^\s*[-*\d.)]+\s*/, '').replace(/^(responsibilities|requirements|qualifications|skills)\s*:?\s*/i, '').trim())
    .filter((line) => line.length >= 12 && line.length <= 180));
  if (fromDescription.length) return fromDescription.slice(0, 7);

  const role = clean(job.roleName) || clean(job.cardName) || 'this role';
  return [`Practical experience performing the responsibilities of ${role}`];
}

export async function analyzeRequirements(job) {
  const must = dedupeReqs(arr(job.resumeCriteria?.mustHave));
  if (must.length >= 3) return must.slice(0, 10);
  try {
    const parsed = await callJson(buildRequirementMessages(job));
    const llm = arr(parsed?.requirements).map((r) => clean(r)).filter(Boolean);
    if (llm.length) return dedupeReqs([...must, ...llm]).slice(0, 10);
  } catch { /* fall through to local */ }
  return dedupeReqs([...must, ...localRequirements(job)]).slice(0, 10);
}

// ── Gap → question: author one rubric-bearing question for an untested must-have
function buildGapMessages(job, requirement) {
  const system = `You are a senior interviewer. Author EXACTLY ONE functional interview question, with its grading rubric, that directly tests whether a candidate genuinely has a specific required skill. An AI avatar asks it aloud.

Return ONLY JSON (no markdown), shape:
{"prompt":"...","questionType":"${QUESTION_TYPES.join('|')}","difficulty":"Easy|Medium|Hard","estimatedMinutes":3-6,"competency":"the requirement it tests","modelAnswer":"what a strong answer covers, 2-3 sentences",${RUBRIC_SHAPE},"followUpIntent":"when/how to probe deeper"}

Rules:
- The question must concretely probe this requirement: "${requirement}".
- prompt: ONE idea, conversational, speakable aloud, and at most ${VOICE_QUESTION_MAX_WORDS} words — no compound multi-part questions.
- requiredPoints: 2-4, each with 2-5 lowercase keywords the evaluator matches on, weight 1-3.
- redFlags: 1-2 realistic failure signals.
- No preamble.`;
  const user = `Role: ${clean(job.roleName) || clean(job.cardName) || 'the role'}${job.experienceBand ? ` (${job.experienceBand})` : ''}
Required skill this question must test: ${requirement}

${jdContext(job)}`;
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

export async function generateGapQuestion(job, requirement) {
  const parsed = await callJson(buildGapMessages(job, requirement));
  const qb = voiceSafeGeneratedQuestion(
    createQuestionBlueprint({ ...parsed, competency: clean(parsed?.competency) || requirement }),
    requirement,
  );
  if (!qb.prompt) throw new Error('empty gap question');
  return qb;
}

// ── Scenario rewrite: turn a googleable question into an applied one ──────────
function buildScenarioMessages(job, qb) {
  const competency = clean(qb.competency) || clean(qb.prompt);
  const system = `You rewrite an interview question so a memorised or googled textbook answer no longer scores. Turn it into a concrete SCENARIO that forces the candidate to APPLY the concept — same competency and difficulty, but they must reason about a specific situation, make a decision, and justify trade-offs.

Return ONLY JSON (no markdown), shape:
{"prompt":"...","questionType":"${QUESTION_TYPES.join('|')}","difficulty":"Easy|Medium|Hard","estimatedMinutes":3-6,"competency":"...","modelAnswer":"what a strong applied answer covers, 2-3 sentences",${RUBRIC_SHAPE},"followUpIntent":"when/how to probe deeper"}

Rules:
- Keep the SAME underlying competency: "${competency}".
- prompt: a specific, realistic scenario, conversational, speakable aloud, and at most ${VOICE_QUESTION_MAX_WORDS} words — applied, not definitional.
- requiredPoints reward reasoning and judgment, not recall of a definition.
- No preamble.`;
  const user = `Role: ${clean(job.roleName) || clean(job.cardName) || 'the role'}${job.experienceBand ? ` (${job.experienceBand})` : ''}
Original (too googleable) question: ${clean(qb.prompt)}
Competency to keep testing: ${competency}
Rewrite it as an applied scenario.`;
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

export async function generateScenarioVariant(job, qb) {
  const competency = clean(qb.competency) || clean(qb.prompt);
  const parsed = await callJson(buildScenarioMessages(job, qb));
  const nb = voiceSafeGeneratedQuestion(createQuestionBlueprint({
    ...parsed,
    difficulty: oneOf(parsed?.difficulty, CONTRACT_DIFFICULTY, qb.difficulty),
    competency: clean(parsed?.competency) || qb.competency,
  }), competency);
  if (!nb.prompt) throw new Error('empty scenario variant');
  return nb;
}

// ── Difficulty retune: rewrite a question to fit a newly chosen difficulty ────
// Same competency, recalibrated so an Easy↔Hard swap yields a genuinely easier/
// harder question with a matching model answer + rubric. An AI avatar asks it.
function buildDifficultyMessages(job, qb, target) {
  const competency = clean(qb.competency) || clean(qb.prompt);
  const system = `You rewrite an interview question to hit a TARGET difficulty while testing the SAME competency. Easier = foundational, single-step recall; harder = deeper reasoning, edge cases, trade-offs, multi-step judgment. An AI avatar asks it aloud.

Return ONLY JSON (no markdown), shape:
{"prompt":"...","questionType":"${QUESTION_TYPES.join('|')}","difficulty":"${target}","estimatedMinutes":3-6,"competency":"...","modelAnswer":"what a strong answer covers at this difficulty, 2-3 sentences",${RUBRIC_SHAPE},"followUpIntent":"when/how to probe deeper"}

Rules:
- Keep the SAME underlying competency: "${competency}".
- Calibrate the question, model answer, and rubric to "${target}" difficulty.
- difficulty MUST be "${target}".
- prompt: ONE idea, conversational, speakable aloud, and at most ${VOICE_QUESTION_MAX_WORDS} words — no compound multi-part questions.
- No preamble.`;
  const user = `Role: ${clean(job.roleName) || clean(job.cardName) || 'the role'}${job.experienceBand ? ` (${job.experienceBand})` : ''}
Current question: ${clean(qb.prompt)}
Competency to keep testing: ${competency}
Rewrite it to be ${target} difficulty.`;
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

export async function generateDifficultyVariant(job, qb, target) {
  const competency = clean(qb.competency) || clean(qb.prompt);
  const difficulty = oneOf(target, CONTRACT_DIFFICULTY, qb.difficulty);
  const parsed = await callJson(buildDifficultyMessages(job, qb, difficulty));
  const nb = voiceSafeGeneratedQuestion(createQuestionBlueprint({
    ...parsed,
    difficulty,
    competency: clean(parsed?.competency) || qb.competency,
  }), competency);
  if (!nb.prompt) throw new Error('empty difficulty variant');
  return nb;
}

// ponytail: keyless fallback can't truly rewrite — keeps the prompt, just retargets
// difficulty + time. Upgrade path: a local templated rewrite per level if needed.
export function localDifficultyVariant(qb, target) {
  const difficulty = oneOf(target, CONTRACT_DIFFICULTY, 'Medium');
  const estimatedMinutes = difficulty === 'Easy' ? 3 : difficulty === 'Hard' ? 6 : 4;
  return createQuestionBlueprint({ ...qb, difficulty, estimatedMinutes });
}

// ── Normalization (coerce any AI/legacy payload into the contract shape) ─────
export function normalizeFunctionalBlueprint(parsed) {
  const topics = arr(parsed?.topics).length ? parsed.topics : arr(parsed);
  const out: any = { topics: topics.map((t) => createTopic({
    name: t.name || t.topic,
    type: t.type,
    difficulty: t.difficulty,
    whyItMatters: t.whyItMatters,
    segue: t.segue,
    questions: arr(t.questions).map((q) => {
      const question = createQuestionBlueprint(q);
      const source = clean(question.targetRequirement) || clean(question.competency);
      if (source && wordCount(question.prompt) > VOICE_QUESTION_MAX_WORDS) {
        question.prompt = voiceQuestionForRequirement(source);
      }
      return question;
    }),
  })).filter((t) => t.questions.length) };
  if (parsed?.interviewStructure) out.interviewStructure = normalizeInterviewStructure(parsed.interviewStructure);
  if (arr(parsed?.suggestedTopics).length) out.suggestedTopics = parsed.suggestedTopics.map((s) => createTopicSuggestion(s));
  return out;
}

export function normalizeScreeningBlueprint(parsed) {
  const list = arr(parsed?.questions).length ? parsed.questions : arr(parsed);
  return { questions: list.map((q) => createQuestionBlueprint({
    ...q,
    questionType: 'hr_screening',
    difficulty: 'Easy',
  })).filter((q) => q.prompt) };
}

// ── Coverage map: which JD requirements the blueprint actually tests ─────────
// v2: prefer the EXPLICIT targetRequirement pin (set at generation/pin time) so
// coverage is a real link, not a lexical guess. Word-overlap stays only as a
// fallback for legacy/un-pinned blueprints.
// Normalize a requirement string for matching: lowercase, strip punctuation,
// collapse whitespace — so an LLM "verbatim" copy with a stray period/space
// ("Strong SQL skills." ) still matches the controlled requirement.
const normReq = (s) => clean(s).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
export function computeCoverage(job, functionalBlueprint) {
  const questions = (functionalBlueprint.topics || []).flatMap((t) => t.questions);
  // Cover against the recruiter's must-haves when present; otherwise against the
  // distinct requirements generation pinned to (these live on each question's
  // targetRequirement, so they survive a reload) — so the coverage panel isn't
  // blank for JD-only / good-to-have-only jobs.
  const mustHave = arr(job.resumeCriteria?.mustHave);
  let must = mustHave;
  if (!must.length) {
    const seen = new Map();
    questions.forEach((q) => { const t = clean(q.targetRequirement); if (t) seen.set(normReq(t), t); });
    must = [...seen.values()];
  }
  const hayOf = (q) => `${q.competency} ${q.prompt} ${q.rubric.requiredPoints.map((p) => `${p.description} ${p.keywords.join(' ')}`).join(' ')}`.toLowerCase();
  return must.map((req) => {
    const pinned = questions.filter((q) => normReq(q.targetRequirement) === normReq(req)).length;
    if (pinned > 0) return { requirement: req, count: pinned, status: 'ok', pinned: true };
    const words = req.toLowerCase().split(/\s+/).filter((w) => w.length > 4 &&
      !['experience', 'knowledge', 'proficiency', 'familiarity', 'equivalent', 'similar'].includes(w));
    const hits = questions.filter((q) => words.some((w) => hayOf(q).includes(w))).length;
    return { requirement: req, count: hits, status: hits >= 2 ? 'ok' : hits === 1 ? 'thin' : 'gap', pinned: false };
  });
}

// Best-effort requirement match for a question, by keyword overlap of the
// requirement against the question's competency + prompt. Returns '' if none.
function matchRequirement(haystack, requirements) {
  const h = clean(haystack).toLowerCase();
  let best = '', bestScore = 0;
  for (const req of requirements) {
    const kws = requirementKeywords(req);
    if (!kws.length) continue;
    const score = kws.filter((w) => h.includes(w)).length;
    if (score > bestScore) { bestScore = score; best = req; }
  }
  return bestScore >= 1 ? best : '';
}

// Pin every question to one of the controlled requirements (keep an exact match,
// else best keyword match), then guarantee coverage by appending a local gap
// question for any requirement no question pins. Mutates + returns the blueprint.
export function pinBlueprintToRequirements(job, functionalBlueprint, requirements) {
  const reqs = dedupeReqs(requirements);
  if (!reqs.length || !functionalBlueprint || !Array.isArray(functionalBlueprint.topics)) return functionalBlueprint;
  const byNorm = new Map(reqs.map((r) => [normReq(r), r]));
  functionalBlueprint.topics.forEach((t) => {
    t.questions.forEach((q) => {
      const exact = byNorm.get(normReq(q.targetRequirement));
      if (exact) { q.targetRequirement = exact; return; }
      const match = matchRequirement(`${q.competency} ${q.prompt}`, reqs);
      if (match) q.targetRequirement = match;
    });
  });
  const pinned = new Set();
  functionalBlueprint.topics.forEach((t) => t.questions.forEach((q) => { if (q.targetRequirement) pinned.add(normReq(q.targetRequirement)); }));
  const uncovered = reqs.filter((r) => !pinned.has(normReq(r)));
  if (uncovered.length) {
    uncovered.forEach((req) => {
      // A missing requirement is a real role topic, not a generic "Coverage
      // gaps" interview section. Reuse a matching topic or create one named
      // after the requirement itself.
      let topic = functionalBlueprint.topics.find((t) => normReq(t.name) === normReq(req));
      if (!topic) {
        topic = createTopic({ name: conciseRequirement(req), type: 'Experiential', difficulty: 'Medium', questions: [] });
        functionalBlueprint.topics.push(topic);
      }
      const q = localGapQuestion(job, req);
      q.targetRequirement = req;
      topic.questions.push(q);
    });
  }
  return functionalBlueprint;
}

// Non-destructive regenerate: carry the recruiter's hand-edited questions over
// into a freshly generated blueprint instead of discarding them. Edited
// questions land back in their original topic (by name), or a "Kept questions"
// topic if that topic no longer exists. Non-edited questions are fully refreshed.
// NOTE: mutates freshFb in place (extends its topics) and carries LIVE question
// references from existingFb — treat both args as consumed and use only the
// return value (the call site reassigns + stores it, discarding the old one).
export function mergeBlueprintPreservingEdits(existingFb, freshFb) {
  const merged = freshFb && Array.isArray(freshFb.topics) ? freshFb : { topics: [] };
  // Interview-level structure + the topic curation are NOT regenerated by the
  // outline call, so carry them forward — a regenerate must not wipe the
  // recruiter's opening/closing lines or their accepted topic menu.
  if (existingFb?.interviewStructure && !merged.interviewStructure) merged.interviewStructure = existingFb.interviewStructure;
  if (arr(existingFb?.suggestedTopics).length && !arr(merged.suggestedTopics).length) merged.suggestedTopics = existingFb.suggestedTopics;
  const edited = [];
  (existingFb?.topics || []).forEach((t) => t.questions.forEach((q) => { if (q.edited) edited.push({ q, topicName: t.name }); }));
  if (!edited.length) return merged;
  const presentIds = new Set(merged.topics.flatMap((t) => t.questions.map((q) => q.id)));
  let keptTopic = null;
  edited.forEach(({ q, topicName }) => {
    if (presentIds.has(q.id)) return;
    let topic = merged.topics.find((t) => t.name === topicName);
    if (!topic) {
      if (!keptTopic) { keptTopic = createTopic({ name: 'Kept questions', type: 'Experiential' }); merged.topics.push(keptTopic); }
      topic = keptTopic;
    }
    topic.questions.push(q);
    presentIds.add(q.id);
  });
  return merged;
}

// Scale the blueprint's size to the role's complexity (must-have count + JD
// length) instead of a fixed 4×2, and surface the controlled requirement list.
export function computeGenerationPlan(job) {
  const requirements = dedupeReqs(arr(job.resumeCriteria?.mustHave));
  const words = clean(job.description).split(/\s+/).filter(Boolean).length;
  const score = requirements.length + (words > 600 ? 2 : words > 250 ? 1 : 0);
  let complexity = 'low', topicCount = 3;
  const questionsPerTopic = 2;
  if (score >= 8) { complexity = 'high'; topicCount = 5; }
  else if (score >= 4) { complexity = 'medium'; topicCount = 4; }
  if (requirements.length) topicCount = Math.min(6, Math.max(topicCount, Math.ceil(requirements.length / questionsPerTopic)));
  return { requirements, topicCount, questionsPerTopic, complexity };
}

// ── Calibration: glanceable stats for the top strip + inspector ──────────────
export function computeCalibration(functionalBlueprint) {
  const questions = (functionalBlueprint.topics || []).flatMap((t) => t.questions);
  const totalMinutes = questions.reduce((a, q) => a + (q.estimatedMinutes || MINUTES_BY_DIFFICULTY[q.difficulty] || 4), 0);
  const difficultyMix = CONTRACT_DIFFICULTY.reduce((m, d) => { m[d] = questions.filter((q) => q.difficulty === d).length; return m; }, {});
  const rubricReady = questions.filter((q) => rubricStrength(q) === 'ready').length;
  return {
    questionCount: questions.length,
    topicCount: (functionalBlueprint.topics || []).length,
    totalMinutes,
    difficultyMix,
    rubricReady,
    rubricCoverage: questions.length ? Math.round((rubricReady / questions.length) * 100) : 0,
  };
}

// ── Run-sheet derivation (the interview-outline layer) ───────────────────────
// Minutes a topic budgets = sum of its questions' estimates (no separate stored
// field — derived so it never goes stale against edits).
export function topicMinutes(topic) {
  return arr(topic?.questions).reduce((a, q) => a + (q.estimatedMinutes || MINUTES_BY_DIFFICULTY[q.difficulty] || 4), 0);
}

// Populate the interviewer-facing run-sheet prose from data the blueprint already
// has — opening/closing bookends, each topic's "why it matters" + segue, and each
// question's "listen for" signals (lifted from its required points). ONLY fills
// blanks: never clobbers a recruiter's authored note or an AI-supplied rationale.
// Pure + local (no AI), so it runs instantly and offline. Mutates + returns fb.
export function autofillOutlineNotes(functionalBlueprint: any, job: any = {}) {
  const fb = functionalBlueprint;
  if (!fb || !Array.isArray(fb.topics)) return fb;
  fb.interviewStructure = normalizeInterviewStructure(fb.interviewStructure);
  const topics = fb.topics;
  const roleLabel = clean(job.roleName) || clean(job.cardName) || 'this role';
  const totalQ = topics.reduce((s, t) => s + t.questions.length, 0);
  if (!fb.interviewStructure.openingLine) {
    fb.interviewStructure.openingLine = `Hi, thanks for making the time today — I'm Lina, and I'll be running your interview for ${roleLabel}. We'll move through ${topics.length} area${topics.length !== 1 ? 's' : ''}, around ${totalQ} question${totalQ !== 1 ? 's' : ''} in total, and I may ask a quick follow-up here and there. There are no trick questions, so take your time and think out loud. Ready when you are.`;
  }
  if (!fb.interviewStructure.closingLine) {
    fb.interviewStructure.closingLine = `That's everything from my side — thank you for walking me through all of that. We'll review your answers and be in touch about next steps. Before we wrap up, is there anything you'd like to ask me?`;
  }
  topics.forEach((t, ti) => {
    if (!clean(t.whyItMatters)) {
      const req = t.questions.map((q) => clean(q.targetRequirement)).find(Boolean);
      t.whyItMatters = req
        ? `Tests ${req} — separates candidates who have genuinely done this from those who only know the theory.`
        : `Explores ${t.name.toLowerCase()} in depth to see how the candidate reasons through it, not just what they can recall.`;
    }
    if (!clean(t.segue) && ti < topics.length - 1) {
      t.segue = `Great, thanks for that. Let's shift gears and talk about ${topics[ti + 1].name.toLowerCase()}.`;
    }
    t.questions.forEach((q) => {
      if (!arr(q.listenFor).length) {
        const pts = arr(q.rubric?.requiredPoints).map((p) => clean(p.description)).filter(Boolean).slice(0, 3);
        if (pts.length) q.listenFor = pts;
      }
    });
  });
  return fb;
}

// Serialize the whole run-of-show as clean Markdown — the interviewer's
// leave-behind (copied to clipboard from the Outline view).
export function runSheetMarkdown(job, functionalBlueprint) {
  const fb = functionalBlueprint || { topics: [] };
  const struct = normalizeInterviewStructure(fb.interviewStructure);
  const topics = fb.topics || [];
  const cal = computeCalibration(fb);
  const roleLabel = clean(job.roleName) || clean(job.cardName) || 'Role';
  const lines = [`# Run of Show — ${roleLabel}`, '', `_${cal.questionCount} question${cal.questionCount !== 1 ? 's' : ''} · ${topics.length} topic${topics.length !== 1 ? 's' : ''} · ~${cal.totalMinutes} min_`, ''];
  if (struct.openingLine) lines.push('## Opening', `> ${struct.openingLine}`, '');
  topics.forEach((t, i) => {
    lines.push(`## ${String(i + 1).padStart(2, '0')} · ${t.name}  (${t.difficulty} · ~${topicMinutes(t)} min)`);
    if (clean(t.whyItMatters)) lines.push(`**Why this matters:** ${t.whyItMatters}`);
    lines.push('');
    t.questions.forEach((q, qi) => {
      lines.push(`${qi + 1}. ${clean(q.prompt) || '_(untitled question)_'}`);
      const lf = arr(q.listenFor).filter(Boolean);
      if (lf.length) lines.push(`   - _Listen for:_ ${lf.join('; ')}`);
      if (clean(q.followUpIntent)) lines.push(`   - _Follow up:_ ${q.followUpIntent}`);
    });
    lines.push('');
    if (clean(t.segue)) lines.push(`_Segue → ${t.segue}_`, '');
  });
  if (struct.closingLine) lines.push('## Closing', `> ${struct.closingLine}`, '');
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ── Difficulty calibration to the experience band ───────────────────────────
// Seniority should shape the difficulty curve and question mix: a junior round
// leans on fundamentals, a senior round on depth, architecture and trade-offs.
// We bucket the free-text band into a tier, define a target profile per tier,
// and report how the authored blueprint deviates from it.
const TIER_PROFILE = {
  junior: { label: 'Junior', difficulty: { Easy: 0.45, Medium: 0.45, Hard: 0.10 }, note: 'foundational knowledge and guided application' },
  mid: { label: 'Mid-level', difficulty: { Easy: 0.20, Medium: 0.50, Hard: 0.30 }, note: 'independent, practical judgment' },
  senior: { label: 'Senior', difficulty: { Easy: 0.10, Medium: 0.40, Hard: 0.50 }, note: 'complex decisions, constraints, and trade-offs' },
};

export function bandTier(experienceBand) {
  const nums = String(experienceBand || '').match(/\d+/g);
  const maxYears = nums ? Math.max(...nums.map(Number)) : 0;
  if (maxYears <= 2) return 'junior';
  if (maxYears <= 6) return 'mid';
  return 'senior';
}

export function computeBandFit(job, functionalBlueprint) {
  const tier = bandTier(job.experienceBand);
  const profile = TIER_PROFILE[tier];
  const questions = (functionalBlueprint.topics || []).flatMap((t) => t.questions);
  const n = questions.length;
  const actualCount: any = CONTRACT_DIFFICULTY.reduce((m: any, d) => { m[d] = questions.filter((q) => q.difficulty === d).length; return m; }, {});
  const targetCount: any = CONTRACT_DIFFICULTY.reduce((m: any, d) => { m[d] = Math.round((profile.difficulty[d] || 0) * n); return m; }, {});

  const recommendations = [];
  if (!clean(job.experienceBand)) {
    recommendations.push({ level: 'info', message: 'Set an experience band on this job to calibrate difficulty to seniority.' });
  } else if (n) {
    const hardShare = actualCount.Hard / n;
    const targetHard = profile.difficulty.Hard;
    if (hardShare < targetHard - 0.15) {
      recommendations.push({ level: 'warn', message: `${profile.label} role skews easy — aim for ~${Math.round(targetHard * 100)}% Hard (now ${Math.round(hardShare * 100)}%). Raise a few Medium questions or add depth.` });
    } else if (hardShare > targetHard + 0.2) {
      recommendations.push({ level: 'warn', message: `This may be too hard for a ${profile.label.toLowerCase()} band — ease some questions toward fundamentals.` });
    }
  }

  return { band: clean(job.experienceBand), tier, tierLabel: profile.label, note: profile.note, count: n, actualCount, targetCount, recommendations };
}

// ── Contract serialization (the portability layer to Krishna's backend) ──────
// The JSON string the Prisma Question.aiEvaluationGuidance field + evaluation
// service consume. v2 envelope: a stable blueprintQuestionId (the upsert key
// that lets a question be edited without orphaning its DB row + history), plus
// the previously-dropped competency / targetRequirement (JD traceability) and
// followUpIntent (avatar/director probe). The eval parser destructures only
// the keys it knows, so extra keys are backward-compatible.
export const GUIDANCE_SCHEMA_VERSION = 'v2';
function serializeRubricPoint(p) {
  const out: any = { id: p.id, description: p.description, keywords: p.keywords, weight: p.weight };
  if (p.pointType) out.pointType = p.pointType;
  if (p.partialCredit) out.partialCredit = p.partialCredit;
  if (arr(p.antiPatterns).length) out.antiPatterns = p.antiPatterns;
  return out;
}
export function toAiEvaluationGuidance(qb) {
  return JSON.stringify({
    schemaVersion: GUIDANCE_SCHEMA_VERSION,
    blueprintQuestionId: qb.id,
    questionType: qb.questionType,
    competency: qb.competency,
    targetRequirement: qb.targetRequirement || '',
    followUpIntent: qb.followUpIntent,
    edited: !!qb.edited,
    modelAnswer: qb.modelAnswer,
    rubric: {
      requiredPoints: qb.rubric.requiredPoints.map(serializeRubricPoint),
      secondaryPoints: qb.rubric.secondaryPoints.map(serializeRubricPoint),
      excellentAnswerSignals: qb.rubric.excellentAnswerSignals.map(serializeRubricPoint),
      redFlags: qb.rubric.redFlags.map((f) => ({ id: f.id, description: f.description, severity: f.severity })),
    },
  });
}

// Backend `functional_parameters`. `questions` stays a plain string[] for
// drop-in compatibility with the current sync; `questionsDetailed` carries the
// authored rubric so an extended sync can populate aiEvaluationGuidance per
// question instead of regenerating it generically.
export function toFunctionalParameters(functionalBlueprint) {
  const struct = functionalBlueprint.interviewStructure;
  const out: any = {
    topics: (functionalBlueprint.topics || []).map((t) => {
      const topic: any = {
        name: t.name,
        type: t.type,
        difficulty: t.difficulty,
        questions: t.questions.map((q) => q.prompt),
        questionsDetailed: t.questions.map((q) => {
          const detail: any = {
            id: q.id,
            text: q.prompt,
            questionType: q.questionType,
            difficulty: q.difficulty,
            estimatedMinutes: q.estimatedMinutes,
            aiEvaluationGuidance: toAiEvaluationGuidance(q),
          };
          if (arr(q.listenFor).length) detail.listenFor = q.listenFor;
          return detail;
        }),
      };
      // Run-sheet fields ride along on the topic; ai_sync.py ignores unknown keys
      // so this stays drop-in compatible with the current backend sync.
      if (clean(t.whyItMatters)) topic.whyItMatters = t.whyItMatters;
      if (clean(t.segue)) topic.segue = t.segue;
      return topic;
    }),
  };
  if (struct && (clean(struct.openingLine) || clean(struct.closingLine))) {
    out.interviewStructure = { openingLine: clean(struct.openingLine), closingLine: clean(struct.closingLine) };
  }
  if (arr(functionalBlueprint.suggestedTopics).length) {
    out.suggestedTopics = functionalBlueprint.suggestedTopics.map((s) => ({
      id: s.id, name: s.name, type: s.type, difficulty: s.difficulty, rationale: s.rationale, accepted: s.accepted !== false,
    }));
  }
  return out;
}

// Backend `screening_questions` is a plain string[]; we keep the rich drafts
// separately so the studio can still edit guidance without breaking the wire.
export function toScreeningQuestions(screeningBlueprint) {
  return (screeningBlueprint.questions || []).map((q) => q.prompt);
}

// ── Keyless local fallback generators ───────────────────────────────────────
// Used when the AI proxy is unavailable so Generate always yields a real,
// rubric-bearing blueprint. Content comes only from the job's configured
// requirements/JD; it never guesses a role family from the title.
function lq(prompt, questionType, difficulty, competency, modelAnswer, required, redFlags) {
  return createQuestionBlueprint({
    prompt, questionType, difficulty, competency, modelAnswer,
    rubric: {
      requiredPoints: (required || []).map(([description, keywords, weight]) => ({ description, keywords, weight })),
      redFlags: (redFlags || []).map(([description, severity]) => ({ description, severity })),
    },
  });
}

export function localFunctionalBlueprint(job) {
  const role = clean(job.roleName) || clean(job.cardName) || 'this role';
  const requirements = localRequirements(job).slice(0, 6);
  const tier = bandTier(job.experienceBand);
  const difficulty = tier === 'junior' ? 'Easy' : tier === 'senior' ? 'Hard' : 'Medium';
  const topics = requirements.map((requirement) => {
    const keywords = requirementKeywords(requirement);
    const q = lq(
      voiceQuestionForRequirement(requirement),
      'case_study', difficulty, requirement,
      `Provides a concrete first-hand example of ${requirement}, explains the candidate's own decisions and responsibilities, and gives a verifiable outcome relevant to the ${role} role.`,
      [[`Demonstrates ${requirement} in a concrete example`, keywords.length ? keywords : ['example'], 3], ['Explains personal responsibility and outcome', ['responsibility', 'outcome', 'result'], 2]],
      [['Gives only a generic or hypothetical answer with no relevant experience', 'medium']],
    );
    q.targetRequirement = requirement;
    return createTopic({ name: conciseRequirement(requirement, 8), type: 'Experiential', difficulty, questions: [q] });
  });
  return { topics };
}

export function localScreeningQuestions(job) {
  const role = clean(job.roleName) || clean(job.cardName) || 'this role';
  const configured = arr(job.screeningParams).flatMap((category) =>
    arr(category.params).map((param) => ({
      category: clean(category.category) || clean(param.name) || 'Screening',
      name: clean(param.name),
      preferred: clean(param.preferredResponse),
    })),
  ).filter((item) => item.name);

  const questions = configured.slice(0, 5).map((item) => lq(
    `For the ${role} role, could you tell me about ${conciseRequirement(item.name, 8).toLowerCase()}?`,
    'hr_screening', 'Easy', item.category,
    item.preferred
      ? `The candidate gives a clear answer that can be compared with the job's stated preference: ${item.preferred}.`
      : `The candidate gives a clear, specific answer about ${item.name} for the ${role} role.`,
    [[`Clearly addresses ${item.name}`, requirementKeywords(item.name), 2]],
    [],
  ));

  if (!questions.length) {
    const requirement = localRequirements(job)[0];
    questions.push(lq(
      `Please summarize the experience you have that is most relevant to ${requirement} for this ${role} role.`,
      'hr_screening', 'Easy', requirement,
      `The candidate gives specific evidence of experience relevant to ${requirement} and connects it to the ${role} role.`,
      [[`Relevant evidence of ${requirement}`, requirementKeywords(requirement), 2]],
      [],
    ));
  }
  return { questions };
}

// Keyless fallback for gap → question: a valid, requirement-targeted question
// used when the AI proxy is unavailable so "Draft Q" always yields something.
const REQ_STOPWORDS = ['experience', 'knowledge', 'proficiency', 'familiarity', 'equivalent', 'similar',
  'strong', 'good', 'excellent', 'with', 'and', 'the', 'using', 'ability', 'years', 'plus'];
function requirementKeywords(requirement) {
  return clean(requirement).toLowerCase().split(/[^a-z0-9+#.]+/).filter((w) => w.length > 3 && !REQ_STOPWORDS.includes(w)).slice(0, 4);
}

export function localGapQuestion(job, requirement) {
  const req = clean(requirement) || 'this skill';
  const kw = requirementKeywords(req);
  return lq(
    voiceQuestionForRequirement(req),
    'behavioral', 'Medium', req,
    `Gives a specific, first-hand example demonstrating ${req}, including the candidate's actual role, the decisions they made, and the outcome.`,
    [[`Concrete first-hand example of ${req}`, kw.length ? kw : ['example'], 3], ['Specific role and a measurable outcome', ['my role', 'result'], 2]],
    [['Speaks only in generalities, gives no real example', 'medium']],
  );
}

// Keyless fallback for the scenario rewrite — recasts a googleable question as an
// applied case study while preserving its competency and difficulty.
export function localScenarioVariant(qb) {
  const topic = clean(qb.competency) || 'the concept';
  const spokenTopic = conciseRequirement(topic, 10);
  const kw = requirementKeywords(topic);
  return createQuestionBlueprint({
    prompt: `Describe a real situation where you applied ${spokenTopic}. What decision did you make?`,
    questionType: 'case_study',
    difficulty: oneOf(qb.difficulty, CONTRACT_DIFFICULTY, 'Medium'),
    competency: clean(qb.competency),
    modelAnswer: `Describes a concrete situation, applies ${topic} to make a decision, and justifies the trade-offs — not a textbook definition.`,
    rubric: {
      requiredPoints: [
        { description: `Applies ${topic} to a concrete situation`, keywords: kw.length ? kw : ['situation'], weight: 3 },
        { description: 'Justifies the decision and trade-offs', keywords: ['because', 'trade-off', 'instead'], weight: 2 },
      ],
      redFlags: [{ description: 'Recites a definition without applying it', severity: 'medium' }],
    },
  });
}
