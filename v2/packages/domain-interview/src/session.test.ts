import { describe, expect, test } from "bun:test";
import { createSessionProvisioningService, hardLimitForStage, type SessionRepository } from "./session";

function memoryRepository(): SessionRepository & { rows: Map<string, any> } {
  const rows = new Map<string, any>();
  return {
    rows,
    findByIdempotencyKey: async (tenantId, key) => [...rows.values()].find((row) => row.tenantId === tenantId && row.idempotencyKey === key),
    create: async (session) => { rows.set(session.id, session); },
  };
}

describe("interview session provisioning", () => {
  test("uses fixed stage limits and creates an ID distinct from the application", async () => {
    const repository = memoryRepository();
    const service = createSessionProvisioningService(repository, () => "session_001", () => "2026-09-07T08:00:00.000Z");
    const result = await service.provision({
      applicationId: "app_001", tenantId: "org_001", interviewStage: "recruiter_screening",
      scheduledAt: "2026-09-08T09:00:00.000Z", timeZone: "Asia/Kolkata",
      correlationId: "corr_001", idempotencyKey: "schedule_001",
    });
    expect(result).toEqual({ ok: true, interviewSessionId: "session_001", hardLimitSeconds: 300, replayed: false });
    expect(repository.rows.get("session_001")).toMatchObject({ applicationId: "app_001", status: "scheduled", hardLimitSeconds: 300 });
    expect(hardLimitForStage("functional_interview")).toBe(1500);
  });

  test("replays within a tenant but does not leak an idempotency key across tenants", async () => {
    let sequence = 0;
    const repository = memoryRepository();
    const service = createSessionProvisioningService(repository, () => `session_${++sequence}`, () => "2026-09-07T08:00:00.000Z");
    const base = { applicationId: "app_001", interviewStage: "functional_interview" as const, scheduledAt: "2026-09-08T09:00:00.000Z", timeZone: "UTC", correlationId: "corr_001", idempotencyKey: "same" };
    const first = await service.provision({ ...base, tenantId: "org_a" });
    const replay = await service.provision({ ...base, tenantId: "org_a" });
    const other = await service.provision({ ...base, tenantId: "org_b" });
    expect(replay).toEqual(first.ok ? { ...first, replayed: true } : first);
    expect(other.ok && first.ok && other.interviewSessionId).not.toBe(first.ok && first.interviewSessionId);
  });

  test("rejects malformed times and unknown time zones", async () => {
    const service = createSessionProvisioningService(memoryRepository(), () => "session_001", () => "2026-09-07T08:00:00.000Z");
    const base = { applicationId: "app_001", tenantId: "org_001", interviewStage: "recruiter_screening" as const, correlationId: "corr", idempotencyKey: "key" };
    expect(await service.provision({ ...base, scheduledAt: "tomorrow", timeZone: "UTC" })).toMatchObject({ ok: false, code: "INVALID_SCHEDULE" });
    expect(await service.provision({ ...base, scheduledAt: "2026-09-08T09:00:00.000Z", timeZone: "Moon/Base" })).toMatchObject({ ok: false, code: "INVALID_TIME_ZONE" });
  });
});
