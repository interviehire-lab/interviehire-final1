import { describe, expect, test } from "bun:test";
import type { ApplicationRepository, ResumeAnalysisService } from "@interviehire/domain-hiring";
import { createCoreApp } from "./app";

const applicationRepository: ApplicationRepository = {
  transaction: (work) => work(applicationRepository), find: async () => undefined,
  updateStage: async () => undefined, appendHistory: async () => undefined,
  appendOutbox: async () => undefined, hasCommand: async () => false,
  recordCommand: async () => undefined,
};

function service(): ResumeAnalysisService {
  return {
    request: async () => ({ ok: true, asyncJobId: "resume_run_001", status: "queued", replayed: false }),
    findJob: async (tenantId, id) => tenantId === "org_001" && id === "resume_run_001" ? {
      id, applicationId: "app_001", tenantId, status: "queued", attempt: 0,
      idempotencyKey: "resume_1", correlationId: "corr_resume", resumeRevision: 1,
      result: null, errorCode: null, createdAt: "2026-09-07T06:00:00.000Z",
      updatedAt: "2026-09-07T06:00:00.000Z",
    } : undefined,
    findLatest: async (tenantId, applicationId) => tenantId === "org_001" && applicationId === "app_001" ? {
      id: "resume_run_001", applicationId, tenantId, status: "ready", attempt: 1,
      idempotencyKey: "resume_1", correlationId: "corr_resume", resumeRevision: 1,
      result: { score: 91, recommendation: "advance" }, errorCode: null,
      createdAt: "2026-09-07T06:00:00.000Z", updatedAt: "2026-09-07T06:01:00.000Z",
    } : undefined,
  };
}

describe("resume analysis routes", () => {
  test("request responds 202 immediately with a durable async-job reference", async () => {
    const response = await createCoreApp({ applicationRepository, resumeAnalysis: service() }).handle(new Request(
      "http://localhost/v2/applications/app_001/resume-analysis",
      {
        method: "POST",
        headers: {
          "content-type": "application/json", "x-tenant-id": "org_001",
          "x-correlation-id": "corr_resume", "idempotency-key": "resume_1",
        },
        body: JSON.stringify({ resumeRevision: 1 }),
      },
    ));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      ok: true, asyncJobId: "resume_run_001", status: "queued", replayed: false,
      correlationId: "corr_resume",
    });
  });

  test("async-job read is tenant scoped", async () => {
    const app = createCoreApp({ applicationRepository, resumeAnalysis: service() });
    const visible = await app.handle(new Request("http://localhost/v2/async-jobs/resume_run_001", {
      headers: { "x-tenant-id": "org_001", "x-correlation-id": "corr_read" },
    }));
    expect(visible.status).toBe(200);
    expect(await visible.json()).toMatchObject({ id: "resume_run_001", status: "queued" });
    const hidden = await app.handle(new Request("http://localhost/v2/async-jobs/resume_run_001", {
      headers: { "x-tenant-id": "org_other", "x-correlation-id": "corr_hidden" },
    }));
    expect(hidden.status).toBe(404);
  });

  test("latest application analysis exposes durable result evidence", async () => {
    const response = await createCoreApp({ applicationRepository, resumeAnalysis: service() }).handle(new Request(
      "http://localhost/v2/applications/app_001/resume-analysis",
      { headers: { "x-tenant-id": "org_001", "x-correlation-id": "corr_latest" } },
    ));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ready", result: { score: 91, recommendation: "advance" } });
  });
});
