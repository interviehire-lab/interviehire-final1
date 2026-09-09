import { prisma } from '../lib/prisma.js';
import { callDeepSeekJson } from './deepseek.service.js';

// ─────────────────────────────────────────────────────────────────────────────
// Holistic transcript → LLM → report.
//
// The Convai avatar asks its OWN dynamic questions, so the blueprint-rubric
// evaluators (which pair answers to prepared questions by index) don't fit. This
// builds Q&A pairs straight from the captured transcript and asks the LLM to
// grade the interview as a whole, emitting the existing CandidateReport shape so
// Deep Analysis renders it unchanged. Throws when no LLM key / no transcript so
// the caller can fall back to the deterministic evaluator.
// ─────────────────────────────────────────────────────────────────────────────

const hasLlmKey = () => !!process.env.DEEPSEEK_API_KEY && process.env.DEEPSEEK_API_KEY !== 'replace-me';

const RECOMMENDATIONS = ['strong_proceed', 'proceed', 'hold', 'reject', 'needs_human_review'] as const;
const CONFIDENCES = ['high', 'medium', 'low'] as const;

type QaPair = { questionText: string; answerText: string };

function buildPairs(transcript: any[]): QaPair[] {
  const pairs: QaPair[] = [];
  let current: QaPair | null = null;
  for (const turn of transcript) {
    const text = typeof turn?.text === 'string' ? turn.text.trim() : '';
    if (!text) continue;
    const isInterviewer = turn?.speaker === 'ai' || turn?.speaker === 'interviewer';
    if (isInterviewer) {
      if (current) pairs.push(current);
      current = { questionText: text, answerText: '' };
    } else if (current) {
      current.answerText = `${current.answerText} ${text}`.trim();
    } else {
      // candidate spoke before any question — attach to an "opening" bucket
      current = { questionText: '(opening remarks)', answerText: text };
    }
  }
  if (current) pairs.push(current);
  return pairs.filter((p) => p.answerText.length > 0);
}

function clampScore(n: unknown, fallback = 0): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function pickEnum<T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number]): T[number] {
  const v = String(value ?? '').toLowerCase().replace(/[\s-]+/g, '_');
  const synonyms: Record<string, string> = {
    strong_hire: 'strong_proceed', hire: 'proceed', lean_hire: 'proceed', advance: 'proceed',
    no_hire: 'reject', fail: 'reject', pass: 'proceed', maybe: 'hold', review: 'needs_human_review',
  };
  const mapped = synonyms[v] ?? v;
  return (allowed as readonly string[]).includes(mapped) ? (mapped as T[number]) : fallback;
}

function toStringArray(v: unknown, max = 8): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, max);
}

type LlmReport = {
  overallScore: number;
  recommendation: string;
  recommendationConfidence: string;
  confidenceScore: number;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  redFlags: Array<{ label: string; severity: string; reason: string }>;
  skillScores: Array<{ skill: string; score: number }>;
  questionBreakdown: Array<{ questionText: string; score: number; summary: string; strengths: string[]; weaknesses: string[] }>;
  suggestedNextSteps: string[];
};

export async function generateTranscriptReport(sessionId: string) {
  if (!hasLlmKey()) throw new Error('LLM not configured for transcript report');

  const session = await prisma.interviewSession.findUnique({
    where: { id: sessionId },
    include: { candidate: true, jobRole: true, proctoringLogs: true },
  });
  if (!session) throw new Error('Interview session not found');

  const transcript = Array.isArray(session.transcript) ? (session.transcript as any[]) : [];
  const pairs = buildPairs(transcript);
  if (!pairs.length) throw new Error('No transcript Q&A pairs to evaluate');

  const roleTitle = session.jobRole?.title ?? 'the role';
  const conversation = pairs
    .map((p, i) => `Q${i + 1} (Interviewer): ${p.questionText}\nA${i + 1} (Candidate): ${p.answerText}`)
    .join('\n\n');

  const llm = await callDeepSeekJson<LlmReport>({
    systemInstruction: [
      'You are a rigorous but fair job interview evaluator. Apply standards appropriate to the advertised role rather than assuming a software or technical role.',
      `You are scoring a candidate for: ${roleTitle}.`,
      'You are given the FULL interview transcript (the interviewer is an AI avatar; the candidate is the human).',
      'Judge ONLY on the transcript. Score the substance of the answers: correctness, depth, reasoning, relevant examples, and communication.',
      'Return STRICT JSON with this exact shape:',
      '{',
      '  "overallScore": number (0-100),',
      '  "recommendation": one of ["strong_proceed","proceed","hold","reject","needs_human_review"],',
      '  "recommendationConfidence": one of ["high","medium","low"],',
      '  "confidenceScore": number (0-100, the candidate\'s communication confidence),',
      '  "summary": string (3-5 sentences),',
      '  "strengths": string[], "weaknesses": string[],',
      '  "redFlags": [{"label": string, "severity": "low"|"medium"|"high"|"critical", "reason": string}],',
      '  "skillScores": [{"skill": string, "score": number (0-100)}],',
      '  "questionBreakdown": [{"questionText": string, "score": number (0-100), "summary": string, "strengths": string[], "weaknesses": string[]}],',
      '  "suggestedNextSteps": string[]',
      '}',
      'questionBreakdown must have one entry per interviewer question, in order. Do not invent answers the candidate did not give.',
    ].join('\n'),
    prompt: `Interview transcript for ${roleTitle}:\n\n${conversation}\n\nEvaluate and return the JSON report.`,
    maxOutputTokens: 4000,
    temperature: 0.2,
  });

  // Normalize into the EvalCandidateReport shape Deep Analysis expects.
  const breakdown = Array.isArray(llm.questionBreakdown) ? llm.questionBreakdown : [];
  const questionBreakdown = breakdown.map((q, i) => {
    const score = clampScore(q?.score);
    return {
      answerId: `${sessionId}-q${i + 1}`,
      questionId: `transcript-q${i + 1}`,
      questionText: String(q?.questionText ?? pairs[i]?.questionText ?? `Question ${i + 1}`),
      questionOrigin: 'predetermined',
      evaluationMode: 'model_answer_based',
      overallScore: score,
      modelAnswerComparison: { score, alignment: score >= 60 ? 'partial' : 'missing', matchedPoints: [], missedPoints: [], notes: String(q?.summary ?? '') },
      dimensionScores: {},
      strengths: toStringArray(q?.strengths),
      weaknesses: toStringArray(q?.weaknesses),
      redFlags: [],
      followUpRecommendations: [],
      evaluationConfidence: 'medium',
      summary: String(q?.summary ?? ''),
      transcriptOnly: true,
    };
  });

  const overallScore = clampScore(
    llm.overallScore,
    questionBreakdown.length
      ? Math.round(questionBreakdown.reduce((s, q) => s + q.overallScore, 0) / questionBreakdown.length)
      : 0,
  );
  const confidenceScore = clampScore(llm.confidenceScore, 60);
  const confidenceLevel: (typeof CONFIDENCES)[number] = confidenceScore >= 70 ? 'high' : confidenceScore >= 45 ? 'medium' : 'low';

  const report = {
    interviewId: sessionId,
    candidateId: session.candidateId,
    roleTitle,
    interviewType: 'mixed',
    overallScore,
    recommendation: pickEnum(llm.recommendation, RECOMMENDATIONS, overallScore >= 65 ? 'proceed' : overallScore >= 45 ? 'hold' : 'reject'),
    recommendationConfidence: pickEnum(llm.recommendationConfidence, CONFIDENCES, 'medium'),
    candidateConfidence: {
      score: confidenceScore,
      level: confidenceLevel,
      reliability: 'medium',
      summary: 'Confidence estimated from the interview transcript.',
    },
    summary: String(llm.summary ?? '').trim() || `Candidate scored ${overallScore}/100 across ${questionBreakdown.length} questions.`,
    strengths: toStringArray(llm.strengths),
    weaknesses: toStringArray(llm.weaknesses),
    redFlags: (Array.isArray(llm.redFlags) ? llm.redFlags : []).map((f) => ({
      label: String(f?.label ?? 'Concern'),
      severity: pickEnum(f?.severity, ['low', 'medium', 'high', 'critical'] as const, 'medium'),
      reason: String(f?.reason ?? ''),
    })),
    skillScores: (Array.isArray(llm.skillScores) ? llm.skillScores : []).map((s) => ({
      skill: String(s?.skill ?? 'Skill'),
      score: clampScore(s?.score),
      evidenceAnswerIds: [],
    })),
    questionBreakdown,
    suggestedNextSteps: toStringArray(llm.suggestedNextSteps),
    transcriptOnly: true,
    futureSignalPlaceholders: { audioAnalysisEnabled: false, videoAnalysisEnabled: false },
    proctoringSummary: {
      eventCount: session.proctoringLogs.length,
      criticalOrHighCount: session.proctoringLogs.filter((log: any) => ['CRITICAL', 'HIGH'].includes(log.severity)).length,
    },
    reportEngine: 'transcript_llm',
  };

  await prisma.interviewSession.update({
    where: { id: sessionId },
    data: { evaluation: report as any, status: 'EVALUATED', completedAt: session.completedAt ?? new Date() },
  });

  return report;
}
