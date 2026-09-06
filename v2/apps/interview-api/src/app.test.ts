import { expect, test } from "bun:test";
import type { SessionProvisioningService } from "@interviehire/domain-interview";
import { createInterviewApp } from "./app";

const provisioning: SessionProvisioningService = { provision: async () => ({ ok: true, interviewSessionId: "session_001", hardLimitSeconds: 300, replayed: false }) };

test("internal provision route requires the service secret", async () => {
  const app = createInterviewApp({ provisioning, internalSecret: "shared-secret" });
  const denied = await app.handle(new Request("http://localhost/internal/v2/sessions", { method: "POST", headers: { "content-type": "application/json", "x-tenant-id": "org_001", "x-correlation-id": "corr", "idempotency-key": "key" }, body: JSON.stringify({ applicationId: "app_001", interviewStage: "recruiter_screening", scheduledAt: "2026-09-08T09:00:00.000Z", timeZone: "UTC" }) }));
  expect(denied.status).toBe(401);
});

test("internal provision route returns a distinct session reference", async () => {
  const app = createInterviewApp({ provisioning, internalSecret: "shared-secret" });
  const response = await app.handle(new Request("http://localhost/internal/v2/sessions", { method: "POST", headers: { "content-type": "application/json", "x-internal-secret": "shared-secret", "x-tenant-id": "org_001", "x-correlation-id": "corr", "idempotency-key": "key" }, body: JSON.stringify({ applicationId: "app_001", interviewStage: "recruiter_screening", scheduledAt: "2026-09-08T09:00:00.000Z", timeZone: "UTC" }) }));
  expect(response.status).toBe(201);
  expect(await response.json()).toEqual({ ok: true, interviewSessionId: "session_001", hardLimitSeconds: 300, replayed: false, correlationId: "corr" });
});
