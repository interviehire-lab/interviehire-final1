import { expect, test } from "bun:test";
import { createHttpInterviewEvaluationClient, createHttpInterviewProvisioner } from "./interview-client";

test("Core adapter forwards reference-only provisioning data and idempotency", async () => {
  let captured: Request | undefined;
  const provisioner = createHttpInterviewProvisioner({ baseUrl: "http://interview", internalSecret: "secret", fetch: async (request) => { captured = request; return Response.json({ ok: true, interviewSessionId: "session_001", hardLimitSeconds: 300, replayed: false }, { status: 201 }); } });
  expect(await provisioner.provision({ applicationId: "app_001", tenantId: "org_001", interviewStage: "recruiter_screening", scheduledAt: "2026-09-08T09:00:00.000Z", timeZone: "UTC", correlationId: "corr", idempotencyKey: "schedule_001" })).toEqual({ interviewSessionId: "session_001" });
  expect(captured?.headers.get("idempotency-key")).toBe("schedule_001");
  expect(await captured?.json()).toEqual({ applicationId: "app_001", interviewStage: "recruiter_screening", scheduledAt: "2026-09-08T09:00:00.000Z", timeZone: "UTC" });
});

test("Deep Analysis adapter requests the mapped session with tenant context", async () => {
  let captured: Request | undefined;
  const client = createHttpInterviewEvaluationClient({ baseUrl: "http://interview", internalSecret: "secret", fetch: async (request) => { captured = request; return Response.json({ sessionId: "session_9", status: "evaluated", evaluation: { score: 84 } }); } });
  expect(await client.getEvaluation("org_1", "session_9", "corr_1")).toMatchObject({ sessionId: "session_9", status: "evaluated" });
  expect(captured?.url).toBe("http://interview/internal/v2/sessions/session_9/evaluation"); expect(captured?.headers.get("x-tenant-id")).toBe("org_1");
});
