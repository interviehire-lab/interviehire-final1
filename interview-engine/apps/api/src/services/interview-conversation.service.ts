import { prisma } from '../lib/prisma.js';
import { callDeepSeekJson } from './deepseek.service.js';
import { getEffectiveQuestions } from './effective-questions.js';
import { recordEventSafe } from './transcript.service.js';

// Adaptive interviewer: after each answer an LLM "director" decides whether to
// probe the same question once more or advance to the next prepared question.
// Guardrails keep evaluation intact: a follow-up reuses the parent questionIndex
// (so pairing merges the follow-up answer), prepared questions are always asked
// verbatim (their rubric is keyed to the exact text), and the closing line is
// stable (the candidate UI substring-matches it to end automatically). No key / any error → the
// original scripted advance.

const MAX_FOLLOWUPS_PER_QUESTION = 2;
const CLOSING_LINE =
  "Thanks. That completes our interview. I'll end the session now, and your report will be prepared automatically.";

const hasDeepSeekKey = () =>
  !!process.env.DEEPSEEK_API_KEY && process.env.DEEPSEEK_API_KEY !== 'replace-me';

type DirectorAction = 'followup' | 'next' | 'complete';
type DirectorDecision = { action: DirectorAction; utterance?: string; reason?: string; targetPointId?: string };
type DirectorPoint = { id?: string; description: string; weight: number };
type ParsedGuidance = {
  modelAnswer?: string;
  requiredPoints: DirectorPoint[];
  redFlags: string[];
  followUpIntent?: string;
};

// Give the director the FULL rubric (weights to prioritise the heaviest gap,
// red flags to challenge dangerous claims, and the designer's authored
// followUpIntent) — not just bare point descriptions.
function parseGuidance(raw: unknown): ParsedGuidance {
  if (typeof raw !== 'string' || !raw.trim()) return { requiredPoints: [], redFlags: [] };
  try {
    const parsed = JSON.parse(raw);
    const requiredPoints: DirectorPoint[] = (parsed?.rubric?.requiredPoints ?? [])
      .map((p: any) => ({
        id: typeof p?.id === 'string' && p.id.trim() ? p.id.trim() : undefined,
        description: typeof p?.description === 'string' ? p.description.trim() : '',
        weight: Number.isFinite(p?.weight) && Number(p.weight) > 0 ? Number(p.weight) : 1,
      }))
      .filter((p: DirectorPoint) => p.description)
      .sort((a: DirectorPoint, b: DirectorPoint) => b.weight - a.weight);
    const redFlags: string[] = (parsed?.rubric?.redFlags ?? [])
      .map((f: any) => (typeof f?.description === 'string' ? f.description.trim() : ''))
      .filter(Boolean);
    return {
      modelAnswer: typeof parsed?.modelAnswer === 'string' ? parsed.modelAnswer : undefined,
      requiredPoints,
      redFlags,
      followUpIntent:
        typeof parsed?.followUpIntent === 'string' && parsed.followUpIntent.trim()
          ? parsed.followUpIntent.trim()
          : undefined,
    };
  } catch {
    return { modelAnswer: raw.trim(), requiredPoints: [], redFlags: [] };
  }
}

function recentHistory(transcript: any[], limit = 6): string {
  return transcript
    .filter((e) => (e?.speaker === 'ai' || e?.speaker === 'candidate') && typeof e?.text === 'string')
    .slice(-limit)
    .map((e) => `${e.speaker === 'ai' ? 'Interviewer' : 'Candidate'}: ${e.text}`)
    .join('\n');
}

async function decideNextTurn(params: {
  questionText: string;
  requiredPoints: DirectorPoint[];
  redFlags: string[];
  modelAnswer?: string;
  followUpIntent?: string;
  difficulty?: string;
  topicCategories?: string[];
  answer: string;
  history: string;
  followUpsUsed: number;
  followUpsRemaining: number;
  hasNextQuestion: boolean;
}): Promise<DirectorDecision | null> {
  if (!hasDeepSeekKey()) return null;
  try {
    const decision = await callDeepSeekJson<DirectorDecision>({
      systemInstruction: [
        'You are an adaptive interviewer running a structured interview.',
        'After each candidate answer you choose ONE next move:',
        '"followup" = ask a single short probe, ONLY when a required point is missing, vague, or contradictory and a probe could fairly recover it — prioritise the HIGHEST-WEIGHT missing point.',
        '"next" = the answer reasonably covers the required points (or more probing would not help) — move on.',
        '"complete" = nothing useful remains.',
        'Default to "next". Probe sparingly; never repeat a probe the candidate already addressed. If the candidate asserts one of the listed red-flag claims, a probe to challenge it is warranted.',
        'For a followup, "utterance" must be ONE warm, conversational sentence ending in a question that targets the specific gap — do not restate the whole question — and set "targetPointId" to the id of the required point being probed (omit if none).',
        'Return strict JSON: {"action","utterance","reason","targetPointId"}.',
      ].join(' '),
      prompt: [
        `Prepared question (${params.difficulty ?? 'unspecified'} difficulty${params.topicCategories?.length ? `, topic: ${params.topicCategories.join(', ')}` : ''}): ${params.questionText}`,
        params.requiredPoints.length
          ? `Required points (highest weight first — probe the heaviest gap):\n${params.requiredPoints.map((p) => `- [${p.id ?? 'n/a'}] (weight ${p.weight}) ${p.description}`).join('\n')}`
          : 'No structured rubric for this question; judge against the model answer / general completeness.',
        params.redFlags.length ? `Red-flag claims to challenge if asserted:\n- ${params.redFlags.join('\n- ')}` : '',
        params.followUpIntent ? `The interview designer's intended follow-up for this question: ${params.followUpIntent}` : '',
        params.modelAnswer ? `Reference model answer: ${params.modelAnswer}` : '',
        `\nConversation so far:\n${params.history}`,
        `\nCandidate's latest answer: ${params.answer}`,
        `\nFollow-ups already used on this question: ${params.followUpsUsed} (remaining allowed: ${params.followUpsRemaining}).`,
        `More prepared questions remain after this one: ${params.hasNextQuestion ? 'yes' : 'no'}.`,
        'Decide the next move and return JSON.',
      ]
        .filter(Boolean)
        .join('\n'),
      maxOutputTokens: 600,
      temperature: 0.3,
    });
    if (decision && ['followup', 'next', 'complete'].includes(decision.action)) return decision;
    return null;
  } catch {
    return null;
  }
}

export async function handleCandidateTranscript(
  sessionId: string,
  text: string,
  metrics: Record<string, unknown> = {},
) {
  const session = await prisma.interviewSession.findUnique({
    where: { id: sessionId },
    include: {
      company: true,
      jobRole: { include: { questions: { where: { isActive: true }, orderBy: { createdAt: 'asc' } } } },
      candidate: true,
    },
  });

  if (!session) throw new Error('Interview session not found');

  const questions = getEffectiveQuestions(session);
  const transcript = Array.isArray(session.transcript) ? (session.transcript as any[]) : [];
  const activeQuestionIndex = [...transcript]
    .reverse()
    .find((entry) => entry?.speaker === 'ai' && Number.isInteger(entry?.questionIndex))?.questionIndex;
  const answeredCount = transcript.filter((entry) => entry?.speaker === 'candidate').length;
  const questionIndex = Number.isInteger(activeQuestionIndex) ? activeQuestionIndex : answeredCount;

  transcript.push({
    speaker: 'candidate',
    text,
    timestamp: new Date().toISOString(),
    metrics,
    questionIndex,
  });

  // Follow-ups already asked for THIS question = AI entries sharing its index, minus the original ask.
  const aiEntriesForThisQuestion = transcript.filter(
    (e) => e?.speaker === 'ai' && e?.questionIndex === questionIndex,
  ).length;
  const followUpsUsed = Math.max(0, aiEntriesForThisQuestion - 1);
  const followUpsRemaining = MAX_FOLLOWUPS_PER_QUESTION - followUpsUsed;
  const hasNextQuestion = !!questions[questionIndex + 1];
  const currentQuestion = questions[questionIndex];
  const guidance = parseGuidance(currentQuestion?.aiEvaluationGuidance);

  let decision: DirectorDecision | null = null;
  if (currentQuestion) {
    decision = await decideNextTurn({
      questionText: currentQuestion.text,
      requiredPoints: guidance.requiredPoints,
      redFlags: guidance.redFlags,
      modelAnswer: guidance.modelAnswer,
      followUpIntent: guidance.followUpIntent,
      difficulty: (currentQuestion as any).difficulty,
      topicCategories: (currentQuestion as any).topicCategories,
      answer: text,
      history: recentHistory(transcript),
      followUpsUsed,
      followUpsRemaining,
      hasNextQuestion,
    });
  }

  const followUpText = (decision?.utterance ?? '').trim();
  const wantsFollowUp =
    decision?.action === 'followup' && followUpsRemaining > 0 && followUpText.length > 0;

  let aiText: string;
  let aiQuestionIndex: number | null;
  let interviewPhase: 'questioning' | 'follow_up' | 'closing';
  let emotionState: 'curious' | 'encouraging';

  if (wantsFollowUp) {
    aiText = followUpText;
    aiQuestionIndex = questionIndex; // same index → evaluation merges this probe's answer into the question's bucket
    interviewPhase = 'follow_up';
    emotionState = 'curious';
  } else if (decision?.action === 'complete') {
    // The interviewer may conclude early when the director determines that no
    // useful questions remain. The spoken closing line makes Vapi and the room
    // end the call without requiring the candidate to click anything.
    aiText = CLOSING_LINE;
    aiQuestionIndex = null;
    interviewPhase = 'closing';
    emotionState = 'encouraging';
  } else if (hasNextQuestion) {
    aiText = questions[questionIndex + 1].text; // prepared question, verbatim
    aiQuestionIndex = questionIndex + 1;
    interviewPhase = 'questioning';
    emotionState = 'curious';
  } else {
    aiText = CLOSING_LINE;
    aiQuestionIndex = null;
    interviewPhase = 'closing';
    emotionState = 'encouraging';
  }

  transcript.push({
    speaker: 'ai',
    text: aiText,
    timestamp: new Date().toISOString(),
    questionIndex: aiQuestionIndex,
    kind: interviewPhase === 'follow_up' ? 'followup' : 'question',
    // Traceability: which rubric point this probe targets + why the director probed.
    ...(interviewPhase === 'follow_up'
      ? { targetPointId: decision?.targetPointId ?? null, directorReason: decision?.reason ?? null }
      : {}),
  });

  await prisma.interviewSession.update({
    where: { id: sessionId },
    data: { transcript, status: 'IN_PROGRESS' },
  });

  // Server-side auto-capture into the transcript event log. This is the safety
  // net: the transcript is complete even if every frontend STT event fails.
  // Overlap with frontend-captured events is removed by the finalizer's dedupe.
  await recordEventSafe(sessionId, 'candidate', text, 'manual');
  await recordEventSafe(sessionId, 'interviewer', aiText, 'manual');

  return { text: aiText, interviewPhase, emotionState };
}
