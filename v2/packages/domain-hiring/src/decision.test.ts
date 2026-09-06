import { expect, test } from "bun:test";
import { createDecisionService, type DecisionRepository } from "./decision";
function repository(stage: "resume_analysis" | "recruiter_screening" | "functional_interview" = "functional_interview"): DecisionRepository & { value: string; writes: number } {
  const state = { value: "active", writes: 0 };
  return { get value() { return state.value; }, get writes() { return state.writes; }, find: async () => ({ id: "app_1", tenantId: "org_1", stage, decision: state.value as any }), findCommand: async () => undefined, commit: async (record) => { state.value = record.to; state.writes++; } };
}
test("hire is a decision and leaves the functional stage intact", async () => {
  const repo = repository(); const service = createDecisionService(repo, () => "2026-09-07T10:00:00.000Z");
  expect(await service.decide({ tenantId: "org_1", applicationId: "app_1", decision: "hired", actorId: "recruiter_1", correlationId: "corr", idempotencyKey: "hire_1" })).toMatchObject({ ok: true, stage: "functional_interview", decision: "hired" });
  expect(repo.value).toBe("hired");
});
test("cannot hire before functional interview but can reject without moving stage", async () => {
  expect(await createDecisionService(repository("recruiter_screening"), () => "now").decide({ tenantId: "org_1", applicationId: "app_1", decision: "hired", actorId: "r", correlationId: "c", idempotencyKey: "k" })).toMatchObject({ ok: false, code: "HIRING_NOT_READY" });
  expect(await createDecisionService(repository("resume_analysis"), () => "now").decide({ tenantId: "org_1", applicationId: "app_1", decision: "rejected", actorId: "r", correlationId: "c", idempotencyKey: "k" })).toMatchObject({ ok: true, stage: "resume_analysis", decision: "rejected" });
});
