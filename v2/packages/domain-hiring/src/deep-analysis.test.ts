import { expect, test } from "bun:test";
import { createDeepAnalysisService } from "./deep-analysis";
test("Deep Analysis resolves an explicit unequal session reference", async () => {
  let requested = "";
  const service = createDeepAnalysisService({ findLatest: async () => ({ applicationId: "app_1", interviewSessionId: "session_9", interviewStage: "functional_interview" }) }, { getEvaluation: async (_tenant, sessionId) => { requested = sessionId; return { sessionId, status: "evaluated", evaluation: { holistic: { overallScore: 84 }, structured: { rubricScore: 81 } } }; } });
  expect(await service.get("org_1", "app_1")).toMatchObject({ ok: true, applicationId: "app_1", interviewSessionId: "session_9", status: "evaluated" }); expect(requested).toBe("session_9");
});
