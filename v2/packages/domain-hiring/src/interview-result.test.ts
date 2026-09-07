import { expect, test } from "bun:test";
import { createInterviewResultService, type InterviewResultRepository } from "./interview-result";

test("screening evaluation marks only the mapped application screening complete", async () => {
  let completed = false;
  const repository: InterviewResultRepository = {
    hasMapping: async (tenantId, applicationId, sessionId, stage) =>
      tenantId === "tenant_1" && applicationId === "app_1" && sessionId === "session_9" && stage === "recruiter_screening",
    markScreeningComplete: async () => { completed = true; },
  };
  const service = createInterviewResultService(repository);
  expect(await service.record({ tenantId: "tenant_1", applicationId: "app_1", interviewSessionId: "session_9", interviewStage: "recruiter_screening" })).toEqual({ ok: true, screeningComplete: true });
  expect(completed).toBe(true);
});

test("rejects an evaluation whose explicit session mapping does not match", async () => {
  const repository: InterviewResultRepository = { hasMapping: async () => false, markScreeningComplete: async () => { throw new Error("not called"); } };
  expect(await createInterviewResultService(repository).record({ tenantId: "tenant_1", applicationId: "app_1", interviewSessionId: "wrong", interviewStage: "recruiter_screening" })).toEqual({ ok: false, code: "MAPPING_NOT_FOUND", message: "Interview mapping not found." });
});
