import { describe, expect, test } from "bun:test";
import { APPLICATION_DECISIONS, APPLICATION_STAGES, isJobEnvelopeV1 } from "./index";

describe("shared contracts", () => {
  test("keeps pipeline stages separate from hiring decisions", () => {
    expect(APPLICATION_STAGES).toEqual([
      "resume_analysis",
      "recruiter_screening",
      "functional_interview",
    ]);
    expect(APPLICATION_DECISIONS).toEqual(["active", "hired", "rejected", "withdrawn"]);
    expect(APPLICATION_STAGES).not.toContain("hired" as never);
  });

  test("accepts a reference-only versioned queue envelope", () => {
    expect(isJobEnvelopeV1({
      jobId: "job_1",
      tenantId: "org_1",
      correlationId: "corr_1",
      idempotencyKey: "resume:app_1:1",
      resourceRef: { type: "application", id: "app_1" },
      requestedAt: "2026-09-07T04:00:00.000Z",
      version: 1,
      payload: { resumeRevision: 1 },
    })).toBe(true);
  });

  test("rejects unversioned or PII-shaped queue envelopes", () => {
    expect(isJobEnvelopeV1({
      jobId: "job_1",
      tenantId: "org_1",
      correlationId: "corr_1",
      idempotencyKey: "resume:app_1:1",
      resourceRef: { type: "application", id: "app_1" },
      requestedAt: "2026-09-07T04:00:00.000Z",
      payload: { resumeText: "candidate private data" },
    })).toBe(false);
  });
});
