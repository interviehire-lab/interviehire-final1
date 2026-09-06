import { describe, expect, test } from "bun:test";
import type { ApplicationQueryRepository, ApplicationRecord, ApplicationRepository } from "@interviehire/domain-hiring";
import { createCoreApp } from "./app";

function dependencies() {
  const application: ApplicationRecord = {
    id: "app_001", jobId: "job_001", tenantId: "org_001", candidateName: "Aditi Sharma",
    stage: "functional_interview", decision: "hired", source: "referral", asyncStatus: "ready",
    resumeAnalysisComplete: true, screeningComplete: true,
  };
  const repository: ApplicationRepository = {
    transaction: (work) => work(repository),
    find: async () => ({ ...application }),
    updateStage: async () => undefined,
    appendHistory: async () => undefined,
    appendOutbox: async () => undefined,
    hasCommand: async () => false,
    recordCommand: async () => undefined,
  };
  const queries: ApplicationQueryRepository = {
    findForTenant: async (tenantId, id) => tenantId === application.tenantId && id === application.id ? { ...application } : undefined,
    listForJob: async (tenantId, jobId) => tenantId === application.tenantId && jobId === application.jobId ? [{ ...application }] : [],
  };
  return { applicationRepository: repository, applicationQueries: queries };
}

describe("Core API read routes", () => {
  test("GET board returns exactly the three stage columns", async () => {
    const response = await createCoreApp(dependencies()).handle(new Request(
      "http://localhost/v2/jobs/job_001/board",
      { headers: { "x-tenant-id": "org_001", "x-correlation-id": "corr_board" } },
    ));
    expect(response.status).toBe(200);
    const body = await response.json() as { columns: Array<{ stage: string }> };
    expect(body.columns.map((column) => column.stage)).toEqual([
      "resume_analysis", "recruiter_screening", "functional_interview",
    ]);
  });

  test("GET application exposes stage and decision as separate fields", async () => {
    const response = await createCoreApp(dependencies()).handle(new Request(
      "http://localhost/v2/applications/app_001",
      { headers: { "x-tenant-id": "org_001", "x-correlation-id": "corr_detail" } },
    ));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: "app_001", stage: "functional_interview", decision: "hired", correlationId: "corr_detail",
    });
  });

  test("GET application returns 404 across tenant boundaries", async () => {
    const response = await createCoreApp(dependencies()).handle(new Request(
      "http://localhost/v2/applications/app_001",
      { headers: { "x-tenant-id": "org_other", "x-correlation-id": "corr_hidden" } },
    ));
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "NOT_FOUND" });
  });
});
