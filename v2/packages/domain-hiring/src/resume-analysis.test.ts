import { describe, expect, test } from "bun:test";
import {
  createResumeAnalysisService,
  type ResumeAnalysisRepository,
  type ResumeAnalysisRun,
} from "./resume-analysis";

function repository(options: { failOutbox?: boolean } = {}) {
  const runs: ResumeAnalysisRun[] = [];
  const events: unknown[] = [];
  let asyncStatus = "not_requested";
  const repo: ResumeAnalysisRepository & { runs: ResumeAnalysisRun[]; events: unknown[]; status(): string } = {
    runs,
    events,
    status: () => asyncStatus,
    transaction: async (work) => {
      const runLength = runs.length;
      const eventLength = events.length;
      const previousStatus = asyncStatus;
      try { return await work(repo); }
      catch (error) {
        runs.length = runLength;
        events.length = eventLength;
        asyncStatus = previousStatus;
        throw error;
      }
    },
    applicationExists: async (tenantId, id) => tenantId === "org_001" && id === "app_001",
    findByIdempotencyKey: async (tenantId, key) => runs.find((run) => run.tenantId === tenantId && run.idempotencyKey === key),
    createRun: async (run) => { runs.push(run); },
    setApplicationAsyncStatus: async (_id, status) => { asyncStatus = status; },
    appendOutbox: async (event) => {
      events.push(event);
      if (options.failOutbox) throw new Error("outbox insert failed");
    },
    findRunForTenant: async (tenantId, id) => runs.find((run) => run.tenantId === tenantId && run.id === id),
  };
  return repo;
}

const command = {
  applicationId: "app_001", tenantId: "org_001", correlationId: "corr_resume",
  idempotencyKey: "resume_app_001_rev_1", resumeRevision: 1,
};

describe("resume-analysis request", () => {
  test("atomically creates QUEUED state and a reference-only outbox event", async () => {
    const repo = repository();
    const service = createResumeAnalysisService(repo, {
      newId: () => "resume_run_001",
      now: () => "2026-09-07T06:00:00.000Z",
    });
    expect(await service.request(command)).toEqual({
      ok: true, asyncJobId: "resume_run_001", status: "queued", replayed: false,
    });
    expect(repo.status()).toBe("queued");
    expect(repo.events).toEqual([expect.objectContaining({
      eventType: "resume-analysis.requested.v1",
      payload: { resourceType: "application", resourceId: "app_001", runId: "resume_run_001", resumeRevision: 1 },
    })]);
    expect(JSON.stringify(repo.events)).not.toContain("resumeText");
  });

  test("replays an idempotent request without creating a second run", async () => {
    const repo = repository();
    const service = createResumeAnalysisService(repo, { newId: () => "resume_run_001", now: () => "2026-09-07T06:00:00.000Z" });
    await service.request(command);
    expect(await service.request(command)).toMatchObject({ asyncJobId: "resume_run_001", replayed: true });
    expect(repo.runs).toHaveLength(1);
    expect(repo.events).toHaveLength(1);
  });

  test("rolls back QUEUED state when the outbox insert fails", async () => {
    const repo = repository({ failOutbox: true });
    const service = createResumeAnalysisService(repo, { newId: () => "resume_run_001", now: () => "2026-09-07T06:00:00.000Z" });
    await expect(service.request(command)).rejects.toThrow("outbox insert failed");
    expect(repo.runs).toHaveLength(0);
    expect(repo.status()).toBe("not_requested");
  });
});
