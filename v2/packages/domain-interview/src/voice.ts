import type { InterviewSessionStatus, InterviewStage } from "./session";

export type CompletionReason = "director_completed" | "all_questions_asked" | "time_limit" | "candidate_ended";
export interface VoiceSettings { readonly interviewEnabled?: boolean; readonly allowReattempt?: boolean; readonly allowLate?: boolean; readonly requireCv?: boolean; readonly accessControl?: "link" | "scheduled" | "invited"; readonly inviteToken?: string }
export type TranscriptEntry = Readonly<Record<string, unknown>>;
export interface VoiceSession {
  readonly id: string; readonly tenantId: string; readonly applicationId: string; readonly interviewStage: InterviewStage;
  status: InterviewSessionStatus; readonly scheduledAt: string | null; readonly hardLimitSeconds: number;
  readonly candidateName: string; readonly roleTitle: string; readonly initialQuestion: string; readonly resumePresent: boolean;
  readonly settings: VoiceSettings; transcript: readonly TranscriptEntry[]; startedAt?: string | null; completedAt?: string | null;
}
export interface DirectorResponse { readonly text: string; readonly interviewPhase: "questioning" | "follow_up" | "closing"; readonly emotionState: "neutral" | "encouraging" | "curious" | "serious"; readonly shouldEnd: boolean; readonly completionReason?: CompletionReason | null }
export interface Director { respond(input: { session: VoiceSession; text: string; metrics: Readonly<Record<string, unknown>> }): Promise<DirectorResponse> }
export interface VoiceTurn { readonly sessionId: string; readonly turnId: string; readonly candidateText: string; readonly ai: DirectorResponse; readonly createdAt: string }
export interface VoiceRepository {
  findSession(id: string): Promise<VoiceSession | undefined>;
  start(id: string, startedAt: string, transcript: readonly TranscriptEntry[]): Promise<void>;
  findTurn(sessionId: string, turnId: string): Promise<VoiceTurn | undefined>;
  commitTurn(turn: VoiceTurn): Promise<void>;
  complete(id: string, completedAt: string, reason: CompletionReason): Promise<void>;
}
type VoiceErrorCode = "SESSION_NOT_FOUND" | "INTERVIEW_DISABLED" | "NO_REATTEMPT" | "LATE_ATTEMPT" | "TOO_EARLY" | "CV_REQUIRED" | "INVALID_TOKEN" | "SESSION_NOT_STARTED" | "EMPTY_TRANSCRIPT";
type VoiceFailure = { readonly ok: false; readonly code: VoiceErrorCode; readonly message: string };
export interface VoiceService {
  start(id: string, details: { token?: string }): Promise<VoiceFailure | ({ readonly ok: true; readonly sessionId: string; readonly candidateName: string; readonly roleTitle: string; readonly initialQuestion: string; readonly startedAt: string; readonly deadlineAt: string; readonly hardLimitSeconds: number; readonly replayed: boolean })>;
  turn(id: string, input: { text: string; turnId: string; metrics: Readonly<Record<string, unknown>> }): Promise<VoiceFailure | { readonly ok: true; readonly answer: { readonly text: string }; readonly ai: DirectorResponse; readonly replayed: boolean }>;
  complete(id: string, reason: CompletionReason): Promise<VoiceFailure | { readonly ok: true; readonly sessionId: string; readonly completionReason: CompletionReason; readonly replayed: boolean }>;
}
const EARLY_ENTRY_MS = 10 * 60 * 1000;
const LATE_GRACE_MS = 5 * 60 * 1000;
export function createVoiceService(repository: VoiceRepository, director: Director, now: () => string): VoiceService {
  return {
    async start(id, details) {
      const session = await repository.findSession(id);
      if (!session) return failure("SESSION_NOT_FOUND", "Interview session not found.");
      if (session.settings.inviteToken && details.token !== session.settings.inviteToken) return failure("INVALID_TOKEN", "This interview link is invalid or has expired.");
      if (session.settings.interviewEnabled === false) return failure("INTERVIEW_DISABLED", "This interview is currently disabled.");
      if ((session.status === "completed" || session.status === "evaluated") && session.settings.allowReattempt === false) return failure("NO_REATTEMPT", "This interview has already been completed.");
      if (session.settings.requireCv && !session.resumePresent) return failure("CV_REQUIRED", "A CV/resume is required before starting this interview.");
      const timestamp = now(); const nowMs = Date.parse(timestamp); const scheduledMs = session.scheduledAt ? Date.parse(session.scheduledAt) : null;
      if (scheduledMs !== null && nowMs < scheduledMs - EARLY_ENTRY_MS) return failure("TOO_EARLY", "This interview has not opened yet. Please return at your scheduled time.");
      if (session.settings.allowLate === false && scheduledMs !== null && nowMs > scheduledMs + LATE_GRACE_MS) return failure("LATE_ATTEMPT", "The scheduled interview window has passed.");
      const replayed = session.status === "in_progress" && Boolean(session.startedAt);
      const startedAt = session.startedAt ?? timestamp;
      const hasAi = session.transcript.some((entry) => entry.speaker === "ai");
      const transcript = hasAi ? session.transcript : [...session.transcript, { speaker: "ai", text: session.initialQuestion, timestamp: startedAt, questionIndex: 0, kind: "question" }];
      if (!replayed) await repository.start(id, startedAt, transcript);
      return { ok: true, sessionId: id, candidateName: session.candidateName, roleTitle: session.roleTitle, initialQuestion: session.initialQuestion, startedAt, deadlineAt: new Date(Date.parse(startedAt) + session.hardLimitSeconds * 1000).toISOString(), hardLimitSeconds: session.hardLimitSeconds, replayed };
    },
    async turn(id, input) {
      const text = input.text.trim(); if (!text) return failure("EMPTY_TRANSCRIPT", "Candidate transcript text is required.");
      const prior = await repository.findTurn(id, input.turnId); if (prior) return { ok: true, answer: { text }, ai: prior.ai, replayed: true };
      const session = await repository.findSession(id); if (!session) return failure("SESSION_NOT_FOUND", "Interview session not found.");
      if (session.status !== "in_progress") return failure("SESSION_NOT_STARTED", "Start the interview session before sending a turn.");
      const ai = await director.respond({ session, text, metrics: input.metrics });
      await repository.commitTurn({ sessionId: id, turnId: input.turnId, candidateText: text, ai, createdAt: now() });
      return { ok: true, answer: { text }, ai, replayed: false };
    },
    async complete(id, reason) {
      const session = await repository.findSession(id); if (!session) return failure("SESSION_NOT_FOUND", "Interview session not found.");
      if (session.status === "completed" || session.status === "evaluating" || session.status === "evaluated") return { ok: true, sessionId: id, completionReason: reason, replayed: true };
      await repository.complete(id, now(), reason);
      return { ok: true, sessionId: id, completionReason: reason, replayed: false };
    },
  };
}
function failure(code: VoiceErrorCode, message: string): VoiceFailure { return { ok: false, code, message }; }
