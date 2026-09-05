import { prisma } from '../lib/prisma.js';
import { callDeepSeekJson } from './deepseek.service.js';
import { callOpenAIJson, isOpenAIConfigured } from './openai.service.js';
import { getEffectiveQuestions } from './effective-questions.js';
import { pairAnsweredEvalQuestions } from '@interviehire/shared';
import {
  aggregateCandidateReport,
  applyProctoringToReport,
  buildAnswerEvaluationPrompt,
  buildProctoringSummary,
  enrichEvaluationScores,
  validateResponseEvaluation,
  type CandidateResponseInput,
  type DimensionScore,
  type EvaluationConfidence,
  type EvaluationPoint,
  type ExpectedRedFlag,
  type InterviewContext,
  type ModelAnswerRubric,
  type QuestionType,
  type RedFlagSeverity,
  type ResponseEvaluation,
} from '../aviral-eval/index.js';
import { buildExitTranscriptReport, isExitInterviewSettings } from './exit-report.service.js';

type TranscriptEntry = {
  speaker?: string;
  text?: string | null;
  questionIndex?: number | null;
};

type QuestionWithGuidance = {
  id: string;
  text: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  topicCategories: string[];
  aiEvaluationGuidance: string;
};

type ParsedGuidance = {
  questionType?: QuestionType;
  modelAnswer?: string;
  rubric?: ModelAnswerRubric;
};

const EVALUATION_CONCURRENCY = 3;

// Grading defaults to a single deterministic judge: cheapest (one call per answer)
// and reproducible (temperature 0), so the same interview scores the same every run
// — the whole point of a grader. Opt back into multi-judge self-consistency (median
// of N warm samples, damps one-off LLM noise) with DEEPSEEK_JUDGE_COUNT=3 plus a warm
// DEEPSEEK_JUDGE_TEMPERATURE, at N× the token cost.
const JUDGE_COUNT = Math.max(1, Math.min(5, Math.round(Number(process.env.DEEPSEEK_JUDGE_COUNT || 1))));
const JUDGE_TEMPERATURE = Number(process.env.DEEPSEEK_JUDGE_TEMPERATURE || 0.35);
const SINGLE_JUDGE_TEMPERATURE = 0;
// Inter-judge overallScore spread (max-min) above this means the judges disagree
// materially, so we downgrade the answer's confidence one notch.
const JUDGE_DISAGREEMENT_SPREAD = 20;

const VALID_QUESTION_TYPES = new Set<QuestionType>([
  'technical_theory',
  'coding',
  'system_design',
  'behavioral',
  'case_study',
  'sales_roleplay',
  'hr_screening',
  'general',
  'followup',
  'custom',
  'exit_theme',
]);

const VALID_DIFFICULTIES = new Set(['easy', 'medium', 'hard', 'custom']);

export async function evaluateInterviewWithAviral(sessionId: string): Promise<any> {
  const session = await prisma.interviewSession.findUnique({
    where: { id: sessionId },
    include: {
      company: true,
      candidate: true,
      jobRole: { include: { questions: { where: { isActive: true }, orderBy: { createdAt: 'asc' } } } },
      proctoringLogs: true,
    },
  });

  if (!session) throw new Error('Session not found');

  // Exit interviews are recorded, not scored — hand off to the no-LLM verbatim
  // structuring pass and never run the hire grader.
  if (isExitInterviewSettings(session.settings)) {
    return buildExitTranscriptReport(session.id);
  }

  const transcript = normalizeTranscript(session.transcript);
  const questions = getEffectiveQuestions(session) as unknown as QuestionWithGuidance[];

  const context: InterviewContext = {
    interviewId: session.id,
    candidateId: session.candidateId,
    companyId: session.companyId,
    roleTitle: session.jobRole.title,
    roleLevel: 'junior',
    interviewType: 'technical',
    mustHaveSkills: session.jobRole.primaryCriteria,
    niceToHaveSkills: session.jobRole.secondaryCriteria,
  };

  // Candidate audio can be transcribed server-side even when interviewer/tab
  // audio was unavailable. In that valid case there is no surviving `ai` turn,
  // but pairAnsweredEvalQuestions can still associate explicit/fallback indexes.
  // Requiring a separate ai turn here caused a successful primary report to be
  // paired with an empty, zero-score Aviral report.
  const answeredQuestions = pairAnsweredEvalQuestions(transcript, questions);

  const inputs: CandidateResponseInput[] = answeredQuestions.map(({ question, answer }, index) =>
    buildResponseInput(session.id, question, answer, index),
  );

  if (inputs.length === 0) {
    throw new Error(
      'Structured evaluation has no candidate answers to grade. Refusing to persist an empty zero-score report.',
    );
  }

  const rawEvaluations = await evaluateInputsWithDeepSeek(context, inputs);

  // Apply the deterministic scoring formula to every answer:
  // finalAnswerScore = 45% rubric coverage + 55% weighted dimensions − red-flag penalty.
  const evaluations = rawEvaluations.map((evaluation, index) => ({
    ...enrichEvaluationScores(evaluation, context, inputs[index].question),
    questionText: inputs[index].question.questionText,
  }));

  const report = aggregateCandidateReport(context, evaluations);

  // Proctoring (integrity): list every violation, penalise the overall score, and
  // expose the full score analysis. eventType/severity/metadata come from ProctoringLog.
  const proctoring = buildProctoringSummary(
    session.proctoringLogs.map((log) => ({
      eventType: log.eventType,
      severity: log.severity,
      occurredAt: log.occurredAt,
      metadata: log.metadata,
    })),
  );

  const finalReport = {
    ...applyProctoringToReport(report, evaluations, proctoring),
    evaluationEngine: isOpenAIConfigured() ? 'aviral_openai' : 'aviral_openrouter',
  };

  await prisma.interviewSession.update({
    where: { id: sessionId },
    data: { evaluation: finalReport as any, status: 'EVALUATED', completedAt: new Date() },
  });

  return finalReport;
}

function buildResponseInput(
  sessionId: string,
  question: QuestionWithGuidance,
  answer: string,
  index: number,
): CandidateResponseInput {
  const guidance = parseEvaluationGuidance(question.aiEvaluationGuidance);
  const questionType = normalizeQuestionType(guidance.questionType);
  const difficulty = normalizeDifficulty(question.difficulty);

  return {
    answerId: `${sessionId}-q${index + 1}`,
    question: {
      questionId: question.id,
      questionText: question.text,
      questionType,
      questionOrigin: 'predetermined',
      difficulty,
      skillTags: question.topicCategories,
      modelAnswer: guidance.modelAnswer,
      modelAnswerRubric: guidance.rubric,
    },
    response: {
      source: 'transcript',
      transcript: answer,
    },
  };
}

async function evaluateInputsWithDeepSeek(
  context: InterviewContext,
  inputs: CandidateResponseInput[],
): Promise<ResponseEvaluation[]> {
  if (inputs.length === 0) {
    return [];
  }

  // Flatten every (answer × judge) grading into a single task queue so total
  // in-flight DeepSeek calls stay bounded by EVALUATION_CONCURRENCY no matter how
  // many judges are configured. Judgments are collected per answer, then merged.
  const tasks: number[] = [];
  inputs.forEach((_, inputIndex) => {
    for (let judge = 0; judge < JUDGE_COUNT; judge += 1) tasks.push(inputIndex);
  });
  const temperature = JUDGE_COUNT > 1 ? JUDGE_TEMPERATURE : SINGLE_JUDGE_TEMPERATURE;

  const judgments: ResponseEvaluation[][] = inputs.map(() => []);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (cursor < tasks.length) {
      const inputIndex = tasks[cursor];
      cursor += 1;
      const evaluation = await evaluateSingleInput(context, inputs[inputIndex], temperature);

      if (evaluation) {
        judgments[inputIndex].push(evaluation);
      }
    }
  };

  const workerCount = Math.min(EVALUATION_CONCURRENCY, tasks.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  // Every answer must be scored the same way on every run. If an answer's judges all
  // failed (after retries), fail loudly instead of silently dropping it — a candidate
  // overall score aggregated over a shrinking subset of answers is the root cause of
  // "irregular" reports. A retryable error beats a wrong hire/no-hire decision.
  const ungraded = inputs.filter((_, i) => judgments[i].length === 0);
  if (ungraded.length > 0) {
    throw new Error(
      `Evaluation incomplete: ${ungraded.length}/${inputs.length} answers could not be graded ` +
        `(${ungraded.map((input) => input.answerId).join(', ')}). Refusing to persist a partial report.`,
    );
  }

  // Preserve original answer order.
  return judgments.map((judges) => (judges.length === 1 ? judges[0] : mergeEvaluationsByMedian(judges)));
}

async function evaluateSingleInput(
  context: InterviewContext,
  input: CandidateResponseInput,
  temperature: number = SINGLE_JUDGE_TEMPERATURE,
): Promise<ResponseEvaluation | null> {
  const prompt = buildAnswerEvaluationPrompt(context, input);

  // One retry absorbs a transient timeout or a single bad-JSON blip so it doesn't
  // shrink the judge panel — or, at JUDGE_COUNT=1, silently drop the whole answer.
  // Prefer OpenAI (gpt-4o) for the analysis when OPENAI_API_KEY is set; otherwise
  // fall back to the configured OpenRouter/DeepSeek client so grading still works.
  const judge = isOpenAIConfigured() ? callOpenAIJson : callDeepSeekJson;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const raw = await judge<ResponseEvaluation>({
        systemInstruction:
          'You are a rigorous, fair technical interview evaluator. Return strict JSON exactly matching the requested ResponseEvaluation schema.',
        prompt,
        maxOutputTokens: Number(process.env.DEEPSEEK_EVALUATION_MAX_TOKENS || 12000),
        temperature,
      });

      const result = validateResponseEvaluation({
        ...raw,
        answerId: raw.answerId || input.answerId,
        questionId: raw.questionId || input.question.questionId,
        questionOrigin: input.question.questionOrigin,
      });

      if (result.normalized) return result.normalized;
      console.error(`Aviral evaluation attempt ${attempt}/2 for answer ${input.answerId} returned invalid JSON.`);
    } catch (error) {
      console.error(`Aviral evaluation attempt ${attempt}/2 failed for answer ${input.answerId}.`, error);
    }
  }
  return null;
}

// ── Multi-judge consensus merge ────────────────────────────────────────────────

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

// Returns the item whose numeric key is nearest the target (ties keep the first).
function pickClosest<T>(items: T[], key: (item: T) => number, target: number): T {
  return items.reduce((best, item) =>
    Math.abs(key(item) - target) < Math.abs(key(best) - target) ? item : best,
  );
}

function uniqueStrings(values: string[], cap: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = (value || '').trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= cap) break;
  }
  return out;
}

function downgradeConfidence(confidence: EvaluationConfidence): EvaluationConfidence {
  return confidence === 'high' ? 'medium' : 'low';
}

function severityRank(severity: RedFlagSeverity): number {
  return severity === 'critical' ? 3 : severity === 'high' ? 2 : severity === 'medium' ? 1 : 0;
}

// Combine N independent judgments of one answer into a consensus evaluation:
// median per-dimension and overall scores, evidence drawn from the judge nearest
// each median, red flags kept only on majority agreement, and confidence reduced
// when the judges disagree widely. Narrative fields come from the median judge.
function mergeEvaluationsByMedian(judges: ResponseEvaluation[]): ResponseEvaluation {
  const overallScores = judges.map((judge) => judge.overallScore);
  const overallScore = median(overallScores);
  const base = pickClosest(judges, (judge) => judge.overallScore, overallScore);

  const dimensionKeys = new Set<string>();
  judges.forEach((judge) => Object.keys(judge.dimensionScores ?? {}).forEach((key) => dimensionKeys.add(key)));

  const dimensionScores: Record<string, DimensionScore> = {};
  for (const key of dimensionKeys) {
    const present = judges.filter((judge) => judge.dimensionScores?.[key]);
    if (present.length === 0) continue;
    const medianScore = median(present.map((judge) => judge.dimensionScores[key].score));
    const source = pickClosest(present, (judge) => judge.dimensionScores[key].score, medianScore)
      .dimensionScores[key];
    dimensionScores[key] = { ...source, score: medianScore };
  }

  // A red flag survives only if a majority of judges raised it (kills one-off
  // hallucinated flags). Severity = the highest any judge assigned.
  const majority = Math.floor(judges.length / 2) + 1;
  const flagByLabel = new Map<string, { flag: ResponseEvaluation['redFlags'][number]; count: number }>();
  judges.forEach((judge) =>
    (judge.redFlags ?? []).forEach((flag) => {
      const key = (flag.label || '').trim().toLowerCase();
      if (!key) return;
      const existing = flagByLabel.get(key);
      if (existing) {
        existing.count += 1;
        if (severityRank(flag.severity) > severityRank(existing.flag.severity)) existing.flag = flag;
      } else {
        flagByLabel.set(key, { flag, count: 1 });
      }
    }),
  );
  const redFlags = [...flagByLabel.values()]
    .filter((entry) => entry.count >= majority)
    .map((entry) => entry.flag);

  const spread = Math.max(...overallScores) - Math.min(...overallScores);
  const evaluationConfidence =
    spread > JUDGE_DISAGREEMENT_SPREAD ? downgradeConfidence(base.evaluationConfidence) : base.evaluationConfidence;

  return {
    ...base,
    overallScore,
    dimensionScores,
    redFlags,
    strengths: uniqueStrings(judges.flatMap((judge) => judge.strengths ?? []), 6),
    weaknesses: uniqueStrings(judges.flatMap((judge) => judge.weaknesses ?? []), 6),
    followUpRecommendations: uniqueStrings(judges.flatMap((judge) => judge.followUpRecommendations ?? []), 5),
    evaluationConfidence,
  };
}

function parseEvaluationGuidance(raw: string): ParsedGuidance {
  const rawText = typeof raw === 'string' ? raw.trim() : '';

  try {
    const parsed = JSON.parse(rawText) as Record<string, unknown>;
    const modelAnswer =
      typeof parsed?.modelAnswer === 'string' && parsed.modelAnswer.trim()
        ? parsed.modelAnswer.trim()
        : rawText || undefined;

    return {
      questionType: typeof parsed?.questionType === 'string' ? (parsed.questionType as QuestionType) : undefined,
      modelAnswer,
      rubric: mapStoredRubric(parsed?.rubric),
    };
  } catch {
    return {
      questionType: undefined,
      modelAnswer: rawText || undefined,
      rubric: undefined,
    };
  }
}

function mapStoredRubric(rawRubric: unknown): ModelAnswerRubric | undefined {
  if (!rawRubric || typeof rawRubric !== 'object') {
    return undefined;
  }

  const rubric = rawRubric as {
    requiredPoints?: unknown;
    secondaryPoints?: unknown;
    excellentAnswerSignals?: unknown;
    redFlags?: unknown;
    notes?: unknown;
  };

  const requiredPoints = mapPoints(rubric.requiredPoints);

  if (requiredPoints.length === 0) {
    return undefined;
  }

  const bonusPoints = [...mapPoints(rubric.secondaryPoints), ...mapPoints(rubric.excellentAnswerSignals)];
  const redFlags = mapRedFlags(rubric.redFlags);

  return {
    requiredPoints,
    bonusPoints,
    redFlags,
    notes: typeof rubric.notes === 'string' && rubric.notes.trim() ? rubric.notes.trim() : undefined,
  };
}

function mapPoints(points: unknown): EvaluationPoint[] {
  if (!Array.isArray(points)) {
    return [];
  }

  return points
    .map((point, index) => {
      // Tolerate legacy string[] rubric points (pre-v2 excellentAnswerSignals).
      const value = (typeof point === 'string' ? { description: point } : (point ?? {})) as { id?: unknown; description?: unknown; weight?: unknown };
      const description = typeof value.description === 'string' ? value.description.trim() : '';
      const weight = Number.isFinite(Number(value.weight)) && Number(value.weight) > 0 ? Number(value.weight) : 1;

      return {
        id: typeof value.id === 'string' && value.id.trim() ? value.id.trim() : `point_${index + 1}`,
        description,
        weight,
      };
    })
    .filter((point) => point.description);
}

function mapRedFlags(redFlags: unknown): ExpectedRedFlag[] {
  if (!Array.isArray(redFlags)) {
    return [];
  }

  return redFlags
    .map((flag, index) => {
      const value = (flag ?? {}) as { id?: unknown; description?: unknown; severity?: unknown };
      const description = typeof value.description === 'string' ? value.description.trim() : '';

      return {
        id: typeof value.id === 'string' && value.id.trim() ? value.id.trim() : `red_flag_${index + 1}`,
        description,
        severity: normalizeSeverity(value.severity),
      };
    })
    .filter((flag) => flag.description);
}

function normalizeSeverity(severity: unknown): RedFlagSeverity {
  return severity === 'low' || severity === 'medium' || severity === 'high' || severity === 'critical'
    ? severity
    : 'medium';
}

function normalizeQuestionType(questionType: QuestionType | undefined): QuestionType {
  if (questionType && VALID_QUESTION_TYPES.has(questionType)) {
    return questionType;
  }

  return questionType === undefined ? 'technical_theory' : 'general';
}

function normalizeDifficulty(
  difficulty: QuestionWithGuidance['difficulty'],
): 'easy' | 'medium' | 'hard' | 'custom' {
  const lowered = difficulty.toLowerCase();

  return (VALID_DIFFICULTIES.has(lowered) ? lowered : 'custom') as 'easy' | 'medium' | 'hard' | 'custom';
}

function normalizeTranscript(raw: unknown): TranscriptEntry[] {
  if (Array.isArray(raw)) return raw as TranscriptEntry[];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}
