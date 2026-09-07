import { expect, test } from "bun:test";
import type { JobEnvelopeV1 } from "@interviehire/contracts";
import { createInterviewResultProcessor } from "./interview-result";

const envelope: JobEnvelopeV1 = {
  jobId: "interview.evaluated:session_1", tenantId: "tenant_1", correlationId: "corr_1",
  idempotencyKey: "interview.evaluated:session_1", resourceRef: { type: "interview_session", id: "session_1" },
  requestedAt: "2026-09-07T00:00:00.000Z", version: 1,
  payload: { eventType: "interview.evaluated.v1", applicationId: "app_1", interviewStage: "recruiter_screening" },
};

test("evaluation event asks Core to apply hiring policy using explicit IDs", async () => {
  let received: unknown;
  const processor = createInterviewResultProcessor({ notify: async (input) => { received = input; } });
  expect(await processor(envelope)).toEqual({ applicationId: "app_1", interviewSessionId: "session_1" });
  expect(received).toEqual({ tenantId: "tenant_1", applicationId: "app_1", interviewSessionId: "session_1", interviewStage: "recruiter_screening", correlationId: "corr_1" });
});

test("evaluation event rejects missing application references", async () => {
  const processor = createInterviewResultProcessor({ notify: async () => undefined });
  await expect(processor({ ...envelope, payload: { eventType: "interview.evaluated.v1" } })).rejects.toThrow("invalid");
});
