import { expect, test } from "bun:test";
import type { SessionProvisioningService, VoiceService } from "@interviehire/domain-interview";
import { createInterviewApp } from "./app";

const provisioning: SessionProvisioningService = { provision: async () => ({ ok: true, interviewSessionId: "session_001", hardLimitSeconds: 300, replayed: false }) };
const voice: VoiceService = {
  start: async (id) => ({ ok: true, sessionId: id, candidateName: "Asha", roleTitle: "Engineer", initialQuestion: "Tell me about yourself.", startedAt: "2026-09-07T08:00:00.000Z", deadlineAt: "2026-09-07T08:05:00.000Z", hardLimitSeconds: 300, replayed: false }),
  turn: async (_id, input) => ({ ok: true, answer: { text: input.text }, ai: { text: "Why?", interviewPhase: "follow_up", emotionState: "curious", shouldEnd: false }, replayed: false }),
  complete: async (id, reason) => ({ ok: true, sessionId: id, completionReason: reason, replayed: false }),
};

test("internal provision route requires the service secret", async () => {
  const app = createInterviewApp({ provisioning, internalSecret: "shared-secret" });
  const denied = await app.handle(new Request("http://localhost/internal/v2/sessions", { method: "POST", headers: { "content-type": "application/json", "x-tenant-id": "org_001", "x-correlation-id": "corr", "idempotency-key": "key" }, body: JSON.stringify({ applicationId: "app_001", interviewStage: "recruiter_screening", scheduledAt: "2026-09-08T09:00:00.000Z", timeZone: "UTC" }) }));
  expect(denied.status).toBe(401);
});

test("LiveKit compatibility routes retain synchronous start, turn, and complete shapes", async () => {
  const app = createInterviewApp({ provisioning, voice, internalSecret: "shared-secret" });
  const headers = { "content-type": "application/json", "x-internal-secret": "shared-secret", "idempotency-key": "voice-command" };
  const start = await app.handle(new Request("http://localhost/internal/livekit/sessions/session_001/start", { method: "POST", headers, body: "{}" }));
  expect(start.status).toBe(200);
  expect(await start.json()).toMatchObject({ sessionId: "session_001", initialQuestion: "Tell me about yourself.", hardLimitSeconds: 300 });
  const turn = await app.handle(new Request("http://localhost/internal/livekit/sessions/session_001/turn", { method: "POST", headers, body: JSON.stringify({ text: "I built a queue", turnId: "turn_1", metrics: { wpm: 120 } }) }));
  expect(await turn.json()).toMatchObject({ answer: { text: "I built a queue" }, ai: { text: "Why?", interviewPhase: "follow_up" } });
  const complete = await app.handle(new Request("http://localhost/internal/livekit/sessions/session_001/complete", { method: "POST", headers, body: JSON.stringify({ reason: "candidate_ended" }) }));
  expect(await complete.json()).toMatchObject({ sessionId: "session_001", completionReason: "candidate_ended" });
});

test("internal provision route returns a distinct session reference", async () => {
  const app = createInterviewApp({ provisioning, internalSecret: "shared-secret" });
  const response = await app.handle(new Request("http://localhost/internal/v2/sessions", { method: "POST", headers: { "content-type": "application/json", "x-internal-secret": "shared-secret", "x-tenant-id": "org_001", "x-correlation-id": "corr", "idempotency-key": "key" }, body: JSON.stringify({ applicationId: "app_001", interviewStage: "recruiter_screening", scheduledAt: "2026-09-08T09:00:00.000Z", timeZone: "UTC" }) }));
  expect(response.status).toBe(201);
  expect(await response.json()).toEqual({ ok: true, interviewSessionId: "session_001", hardLimitSeconds: 300, replayed: false, correlationId: "corr" });
});
