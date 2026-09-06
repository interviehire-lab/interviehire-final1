import { describe, expect, test } from "bun:test";
import {
  createApplicationService,
  type ApplicationRecord,
  type ApplicationRepository,
} from "./application-service";

function repository(options: { failHistory?: boolean } = {}): ApplicationRepository & { histories: unknown[] } {
  const application: ApplicationRecord = {
    id: "app_001",
    tenantId: "org_001",
    stage: "resume_analysis" as const,
    decision: "active" as const,
    resumeAnalysisComplete: true,
    screeningComplete: false,
  };
  const histories: unknown[] = [];
  const repo: ApplicationRepository & { histories: unknown[] } = {
    histories,
    transaction: async (work) => {
      const before = { ...application };
      const historyLength = histories.length;
      try { return await work(repo); }
      catch (error) { Object.assign(application, before); histories.length = historyLength; throw error; }
    },
    find: async () => ({ ...application }),
    updateStage: async (_id, stage) => { application.stage = stage; },
    appendHistory: async (history) => {
      if (options.failHistory) throw new Error("history insert failed");
      histories.push(history);
    },
    hasCommand: async (key) => key === "already_done",
    recordCommand: async () => undefined,
  };
  return repo;
}

describe("transition command", () => {
  test("rejects a cross-tenant move", async () => {
    const result = await createApplicationService(repository()).transition({
      applicationId: "app_001", tenantId: "org_other", to: "recruiter_screening",
      actorId: "recruiter_1", correlationId: "corr_1", idempotencyKey: "cmd_1",
      occurredAt: "2026-09-07T04:00:00.000Z",
    });
    expect(result).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  test("writes stage and history in one transaction", async () => {
    const repo = repository();
    const result = await createApplicationService(repo).transition({
      applicationId: "app_001", tenantId: "org_001", to: "recruiter_screening",
      actorId: "recruiter_1", correlationId: "corr_1", idempotencyKey: "cmd_1",
      occurredAt: "2026-09-07T04:00:00.000Z",
    });
    expect(result).toMatchObject({ ok: true });
    expect((await repo.find("app_001"))?.stage).toBe("recruiter_screening");
    expect(repo.histories).toHaveLength(1);
  });

  test("duplicate transition commands do not append history", async () => {
    const repo = repository();
    const result = await createApplicationService(repo).transition({
      applicationId: "app_001", tenantId: "org_001", to: "recruiter_screening",
      actorId: "recruiter_1", correlationId: "corr_1", idempotencyKey: "already_done",
      occurredAt: "2026-09-07T04:00:00.000Z",
    });
    expect(result).toMatchObject({ ok: true, replayed: true });
    expect(repo.histories).toHaveLength(0);
  });

  test("rolls back the stage when history persistence fails", async () => {
    const repo = repository({ failHistory: true });
    await expect(createApplicationService(repo).transition({
      applicationId: "app_001", tenantId: "org_001", to: "recruiter_screening",
      actorId: "recruiter_1", correlationId: "corr_1", idempotencyKey: "cmd_1",
      occurredAt: "2026-09-07T04:00:00.000Z",
    })).rejects.toThrow("history insert failed");
    expect((await repo.find("app_001"))?.stage).toBe("resume_analysis");
    expect(repo.histories).toHaveLength(0);
  });
});
