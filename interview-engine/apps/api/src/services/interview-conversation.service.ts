import { prisma } from '../lib/prisma.js';
import { callDeepSeekJson } from './deepseek.service.js';
import { getEffectiveQuestions } from './effective-questions.js';
import {
  INTERVIEW_TARGET_SECONDS,
  deadlineFor,
  hardLimitSeconds,
  secondsRemaining,
  shouldForceClose,
} from './interview-policy.js';
import { recordEventSafe } from './transcript.service.js';

// Adaptive interviewer: after each answer an LLM "director" decides whether to
// probe the same question once more or advance to the next prepared question.
// Guardrails keep evaluation intact: a follow-up reuses the parent questionIndex
// (so pairing merges the follow-up answer), prepared questions are always asked
// verbatim (their rubric is keyed to the exact text), and the closing line is
// stable (the candidate UI substring-matches it to end automatically). No key / any error → the
// original scripted advance.

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
  followUpsTotal: number;
  hasNextQuestion: boolean;
  remainingMainQuestions: number;
  remainingSeconds: number | null;
}): Promise<DirectorDecision | null> {
  if (!hasDeepSeekKey()) return null;
  try {
    const decision = await callDeepSeekJson<DirectorDecision>({
      systemInstruction: [
        'You are an adaptive interviewer running a structured interview.',
        'After each candidate answer you choose ONE next move:',
        '"followup" = respond and stay on the SAME question. Two distinct cases fall under this: (1) the candidate genuinely attempted an answer but a required point is missing, vague, or contradictory and a probe could fairly recover it — prioritise the HIGHEST-WEIGHT missing point; (2) the candidate did NOT actually answer — they asked you to repeat or clarify the question, said something unrelated or off-topic, or the transcript is empty, silent, or unintelligible.',
        '"next" = the candidate made a real attempt at answering AND it reasonably covers the required points (or more probing would not help) — move on.',
        '"complete" = nothing useful remains.',
        'There is no fixed cap on follow-ups — you decide, using your judgement together with the time and topic-count context given each turn. Ask as many follow-ups as are genuinely useful for assessing this candidate; a valuable follow-up is worth taking when time and remaining topics allow it, but as time runs low or few prepared topics remain, weigh that against covering the rest of the interview and prefer moving on when a follow-up would not be worth the cost. You are trusted to pace this yourself — there is no separate mechanism enforcing it.',
        'Default to "next" ONLY when the candidate genuinely attempted the question — never default to "next" just because the transcript is short, unclear, or a request to repeat; that is always case (2) of "followup". Never repeat a probe the candidate already addressed. If the candidate asserts one of the listed red-flag claims, a probe to challenge it is warranted.',
        'For case (1) (probing a gap in a real answer), "utterance" must be ONE warm, conversational sentence ending in a question that targets the specific gap — do not restate the whole question — and set "targetPointId" to the id of the required point being probed.',
        'For case (2) (the candidate did not answer, or asked you to repeat/clarify), "utterance" must warmly re-ask the prepared question, restated in your own words rather than a robotic re-read — this is the one case where re-asking the question IS the correct move — and omit "targetPointId".',
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
        `\nFollow-ups already asked on this question: ${params.followUpsUsed}. Follow-ups asked across the whole interview so far: ${params.followUpsTotal}.`,
        `${params.remainingMainQuestions} more prepared question(s) remain after this one${params.hasNextQuestion ? '' : ' (this is the last one)'}.`,
        params.remainingSeconds != null
          ? `Time remaining before this interview is force-ended: ~${Math.max(0, Math.round(params.remainingSeconds / 60))} minute(s) (interview targets roughly ${Math.round(INTERVIEW_TARGET_SECONDS / 60)} minutes total). Pace yourself against this — plenty of time left means a good follow-up is worth it; running low means prefer moving on so every prepared question gets a chance.`
          : '',
        'Decide the next move and return JSON.',
      ]
        .filter(Boolean)
        .join('\n'),
      // Kept tight (director JSON is {action, utterance, reason, targetPointId} —
      // a one-sentence utterance never needs more) so a slow/verbose completion
      // can't add latency to a voice call waiting on this turn.
      maxOutputTokens: 250,
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
  const livekitTurnId = typeof metrics.livekitTurnId === 'string' && metrics.livekitTurnId.trim()
    ? metrics.livekitTurnId.trim()
    : null;
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
    ...(livekitTurnId ? { livekitTurnId } : {}),
    questionIndex,
  });

  // Follow-ups already asked for THIS question = AI entries sharing its index, minus the original ask.
  const aiEntriesForThisQuestion = transcript.filter(
    (e) => e?.speaker === 'ai' && e?.questionIndex === questionIndex,
  ).length;
  const followUpsUsed = Math.max(0, aiEntriesForThisQuestion - 1);
  const followUpsTotal = transcript.filter(
    (entry) => entry?.speaker === 'ai' && entry?.kind === 'followup',
  ).length;
  const hasNextQuestion = !!questions[questionIndex + 1];
  const remainingMainQuestions = Math.max(0, questions.length - questionIndex - 1);
  const currentQuestion = questions[questionIndex];
  const guidance = parseGuidance(currentQuestion?.aiEvaluationGuidance);
  const settings = (session.settings && typeof session.settings === 'object')
    ? session.settings as Record<string, unknown>
    : {};
  const deadlineReached = !!session.startedAt && shouldForceClose(session.startedAt, settings);
  const remainingSecondsForPrompt = session.startedAt ? secondsRemaining(session.startedAt, settings) : null;

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
      followUpsTotal,
      hasNextQuestion,
      remainingMainQuestions,
      remainingSeconds: remainingSecondsForPrompt,
    });
  }

  const followUpText = (decision?.utterance ?? '').trim();
  const wantsFollowUp =
    !deadlineReached && decision?.action === 'followup' && followUpText.length > 0;

  let aiText: string;
  let aiQuestionIndex: number | null;
  let interviewPhase: 'questioning' | 'follow_up' | 'closing';
  let emotionState: 'curious' | 'encouraging';

  if (deadlineReached) {
    aiText = CLOSING_LINE;
    aiQuestionIndex = null;
    interviewPhase = 'closing';
    emotionState = 'encouraging';
  } else if (wantsFollowUp) {
    aiText = followUpText;
    aiQuestionIndex = questionIndex; // same index → evaluation merges this probe's answer into the question's bucket
    interviewPhase = 'follow_up';
    emotionState = 'curious';
  } else if (decision?.action === 'complete' && !hasNextQuestion) {
    // Completion is accepted only after every prepared main question has been
    // reached. The hard deadline remains the sole exception to full coverage.
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
    ...(livekitTurnId ? { livekitTurnId } : {}),
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

  return {
    text: aiText,
    interviewPhase,
    emotionState,
    shouldEnd: interviewPhase === 'closing',
    completionReason: deadlineReached ? 'time_limit' : interviewPhase === 'closing' ? 'all_questions_asked' : null,
    ...(session.startedAt
      ? {
          deadlineAt: deadlineFor(session.startedAt, settings).toISOString(),
          hardLimitSeconds: hardLimitSeconds(settings),
        }
      : {}),
  };
}
