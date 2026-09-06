import { expect, test } from "bun:test";
import { createApplicationInterviewRef } from "./interview-ref";

test("application and interview session IDs are explicit and may differ", () => {
  const ref = createApplicationInterviewRef({
    applicationId: "app_001",
    interviewSessionId: "session_9f8d",
    interviewStage: "recruiter_screening",
    createdAt: "2026-09-07T04:00:00.000Z",
  });
  expect(ref.applicationId).not.toBe(ref.interviewSessionId);
  expect(ref).toMatchObject({ applicationId: "app_001", interviewSessionId: "session_9f8d" });
});
