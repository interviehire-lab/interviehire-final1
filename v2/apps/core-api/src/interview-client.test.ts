import { expect, test } from "bun:test";
import { createHttpInterviewProvisioner } from "./interview-client";

test("Core adapter forwards reference-only provisioning data and idempotency", async () => {
  let captured: Request | undefined;
  const provisioner = createHttpInterviewProvisioner({ baseUrl: "http://interview", internalSecret: "secret", fetch: async (request) => { captured = request; return Response.json({ ok: true, interviewSessionId: "session_001", hardLimitSeconds: 300, replayed: false }, { status: 201 }); } });
  expect(await provisioner.provision({ applicationId: "app_001", tenantId: "org_001", interviewStage: "recruiter_screening", scheduledAt: "2026-09-08T09:00:00.000Z", timeZone: "UTC", correlationId: "corr", idempotencyKey: "schedule_001" })).toEqual({ interviewSessionId: "session_001" });
  expect(captured?.headers.get("idempotency-key")).toBe("schedule_001");
  expect(await captured?.json()).toEqual({ applicationId: "app_001", interviewStage: "recruiter_screening", scheduledAt: "2026-09-08T09:00:00.000Z", timeZone: "UTC" });
});
