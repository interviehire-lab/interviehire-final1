import { expect, test } from "bun:test";
import type { ApplicationRepository, DecisionService, DeepAnalysisService } from "@interviehire/domain-hiring";
import { createCoreApp } from "./app";
const applicationRepository: ApplicationRepository = { transaction: (work) => work(applicationRepository), find: async () => undefined, updateStage: async () => undefined, appendHistory: async () => undefined, appendOutbox: async () => undefined, hasCommand: async () => false, recordCommand: async () => undefined };
const deepAnalysis: DeepAnalysisService = { get: async (_tenant, applicationId) => ({ ok: true, applicationId, interviewSessionId: "session_9", interviewStage: "functional_interview", status: "evaluated", evaluation: { holistic: { overallScore: 84 }, structured: { rubricScore: 81 } } }) };
const decisions: DecisionService = { decide: async (command) => ({ ok: true, applicationId: command.applicationId, stage: "functional_interview", decision: command.decision, replayed: false }) };
test("Deep Analysis returns the mapped Interview report", async () => {
  const response = await createCoreApp({ applicationRepository, deepAnalysis }).handle(new Request("http://localhost/v2/applications/app_1/deep-analysis", { headers: { "x-tenant-id": "org_1", "x-correlation-id": "corr_1" } }));
  expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ applicationId: "app_1", interviewSessionId: "session_9", status: "evaluated", evaluation: { holistic: { overallScore: 84 } } });
});
test("decision command returns the unchanged stage", async () => {
  const response = await createCoreApp({ applicationRepository, decisions }).handle(new Request("http://localhost/v2/applications/app_1/decisions", { method: "POST", headers: { "content-type": "application/json", "x-tenant-id": "org_1", "x-actor-id": "recruiter_1", "x-correlation-id": "corr_1", "idempotency-key": "hire_1" }, body: JSON.stringify({ decision: "hired" }) }));
  expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ applicationId: "app_1", stage: "functional_interview", decision: "hired" });
});
