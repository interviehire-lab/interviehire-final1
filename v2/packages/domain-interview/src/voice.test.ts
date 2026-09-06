import { describe, expect, test } from "bun:test";
import { createVoiceService, type Director, type VoiceRepository, type VoiceSession, type VoiceTurn } from "./voice";

function fixture(overrides: Partial<VoiceSession> = {}): VoiceSession {
  return { id: "session_001", tenantId: "org_001", applicationId: "app_001", interviewStage: "recruiter_screening", status: "scheduled", scheduledAt: "2026-09-07T08:00:00.000Z", hardLimitSeconds: 300, candidateName: "Asha", roleTitle: "Engineer", initialQuestion: "Tell me about yourself.", resumePresent: true, settings: {}, transcript: [], ...overrides };
}
function memoryRepository(session = fixture()): VoiceRepository {
  const turns = new Map<string, VoiceTurn>();
  return {
    findSession: async (id) => id === session.id ? session : undefined,
    start: async (_id, startedAt, transcript) => { session.status = "in_progress"; session.startedAt = startedAt; session.transcript = transcript; },
    findTurn: async (_id, turnId) => turns.get(turnId),
    commitTurn: async (turn) => { turns.set(turn.turnId, turn); session.transcript = [...session.transcript, { speaker: "candidate", text: turn.candidateText, timestamp: turn.createdAt }, { speaker: "ai", text: turn.ai.text, timestamp: turn.createdAt, livekitTurnId: turn.turnId }]; },
    complete: async (_id, completedAt, reason) => { session.status = "completed"; session.completedAt = completedAt; session.transcript = [...session.transcript, { type: "interview_completion", completionReason: reason, timestamp: completedAt }]; },
  };
}
const director: Director = { respond: async () => ({ text: "What did you learn?", interviewPhase: "follow_up", emotionState: "curious", shouldEnd: false }) };

describe("synchronous voice service", () => {
  test("start returns the legacy server-issued timing shape and replays safely", async () => {
    const service = createVoiceService(memoryRepository(), director, () => "2026-09-07T08:01:00.000Z");
    const first = await service.start("session_001", {});
    const replay = await service.start("session_001", {});
    expect(first).toEqual({ ok: true, sessionId: "session_001", candidateName: "Asha", roleTitle: "Engineer", initialQuestion: "Tell me about yourself.", startedAt: "2026-09-07T08:01:00.000Z", deadlineAt: "2026-09-07T08:06:00.000Z", hardLimitSeconds: 300, replayed: false });
    expect(replay).toMatchObject({ ok: true, startedAt: "2026-09-07T08:01:00.000Z", replayed: true });
  });

  test("enforces early-entry, late, CV, and no-reattempt gates", async () => {
    const early = createVoiceService(memoryRepository(fixture({ scheduledAt: "2026-09-07T09:00:01.000Z" })), director, () => "2026-09-07T08:50:00.000Z");
    expect(await early.start("session_001", {})).toMatchObject({ ok: false, code: "TOO_EARLY" });
    const late = createVoiceService(memoryRepository(fixture({ scheduledAt: "2026-09-07T08:00:00.000Z", settings: { allowLate: false } })), director, () => "2026-09-07T08:05:01.000Z");
    expect(await late.start("session_001", {})).toMatchObject({ ok: false, code: "LATE_ATTEMPT" });
    const cv = createVoiceService(memoryRepository(fixture({ resumePresent: false, settings: { requireCv: true } })), director, () => "2026-09-07T08:01:00.000Z");
    expect(await cv.start("session_001", {})).toMatchObject({ ok: false, code: "CV_REQUIRED" });
    const completed = createVoiceService(memoryRepository(fixture({ status: "completed", settings: { allowReattempt: false } })), director, () => "2026-09-07T08:01:00.000Z");
    expect(await completed.start("session_001", {})).toMatchObject({ ok: false, code: "NO_REATTEMPT" });
  });

  test("answers live turns synchronously and replays the stored AI response", async () => {
    let calls = 0;
    const service = createVoiceService(memoryRepository(fixture({ status: "in_progress", startedAt: "2026-09-07T08:00:00.000Z" })), { respond: async (input) => { calls++; return { ...(await director.respond(input)), text: `Reply ${calls}` }; } }, () => "2026-09-07T08:01:00.000Z");
    const first = await service.turn("session_001", { text: "My answer", turnId: "turn_1", metrics: {} });
    const replay = await service.turn("session_001", { text: "My answer", turnId: "turn_1", metrics: {} });
    expect(first).toMatchObject({ ok: true, replayed: false, ai: { text: "Reply 1" } });
    expect(replay).toMatchObject({ ok: true, replayed: true, ai: { text: "Reply 1" } });
    expect(calls).toBe(1);
  });

  test("completion is idempotent", async () => {
    const session = fixture({ status: "in_progress", startedAt: "2026-09-07T08:00:00.000Z" });
    const service = createVoiceService(memoryRepository(session), director, () => "2026-09-07T08:02:00.000Z");
    expect(await service.complete("session_001", "candidate_ended")).toMatchObject({ ok: true, replayed: false });
    expect(await service.complete("session_001", "candidate_ended")).toMatchObject({ ok: true, replayed: true });
  });
});
