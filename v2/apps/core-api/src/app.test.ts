import { describe, expect, test } from "bun:test";
import type { ApplicationRecord, ApplicationRepository } from "@interviehire/domain-hiring";
import { createCoreApp } from "./app";

function repository(): ApplicationRepository {
  const application: ApplicationRecord = {
    id: "app_001", tenantId: "org_001", stage: "resume_analysis", decision: "active",
    resumeAnalysisComplete: true, screeningComplete: false,
  };
  const commands = new Set<string>();
  const repo: ApplicationRepository = {
    transaction: (work) => work(repo),
    find: async () => ({ ...application }),
    updateStage: async (_id, stage) => { application.stage = stage; },
    appendHistory: async () => undefined,
    hasCommand: async (key) => commands.has(key),
    recordCommand: async (key) => { commands.add(key); },
  };
  return repo;
}

describe("POST /v2/applications/:id/transitions", () => {
  test("moves through the authoritative domain command and returns correlation context", async () => {
    const response = await createCoreApp({ applicationRepository: repository() }).handle(new Request(
      "http://localhost/v2/applications/app_001/transitions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-tenant-id": "org_001",
          "x-actor-id": "recruiter_001",
          "x-correlation-id": "corr_001",
          "idempotency-key": "transition_001",
        },
        body: JSON.stringify({ to: "recruiter_screening", occurredAt: "2026-09-07T04:00:00.000Z" }),
      },
    ));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true, applicationId: "app_001", from: "resume_analysis",
      to: "recruiter_screening", correlationId: "corr_001",
    });
  });

  test("does not reveal a cross-tenant application", async () => {
    const response = await createCoreApp({ applicationRepository: repository() }).handle(new Request(
      "http://localhost/v2/applications/app_001/transitions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json", "x-tenant-id": "org_other",
          "x-actor-id": "recruiter_001", "x-correlation-id": "corr_002",
          "idempotency-key": "transition_002",
        },
        body: JSON.stringify({ to: "recruiter_screening", occurredAt: "2026-09-07T04:00:00.000Z" }),
      },
    ));
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  test("rejects a pipeline decision disguised as a stage", async () => {
    const response = await createCoreApp({ applicationRepository: repository() }).handle(new Request(
      "http://localhost/v2/applications/app_001/transitions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json", "x-tenant-id": "org_001",
          "x-actor-id": "recruiter_001", "x-correlation-id": "corr_003",
          "idempotency-key": "transition_003",
        },
        body: JSON.stringify({ to: "hired", occurredAt: "2026-09-07T04:00:00.000Z" }),
      },
    ));
    expect(response.status).toBe(422);
  });
});
