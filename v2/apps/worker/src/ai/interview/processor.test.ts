import { describe, expect, test } from "bun:test";
import type { JobEnvelopeV1 } from "@interviehire/contracts";
import { createInterviewEvaluationProcessor, createResilientEvaluator, type EvaluationStore, type EvaluatorName } from "./processor";
const envelope: JobEnvelopeV1 = { jobId: "interview.completed:session_1", tenantId: "org_1", correlationId: "corr_1", idempotencyKey: "interview.completed:session_1", resourceRef: { type: "interview_session", id: "session_1" }, requestedAt: "2026-09-07T09:00:00.000Z", version: 1, payload: { eventType: "interview.completed.v1" } };
function memoryStore(): EvaluationStore & { states: Record<EvaluatorName, string> } {
  const states = { holistic: "pending", structured: "pending" }; const results: Partial<Record<EvaluatorName, Readonly<Record<string, unknown>>>> = {};
  return { states, claim: async (_id, _tenant, evaluator) => states[evaluator] === "ready" ? { kind: "ready" } : { kind: "claimed", transcript: [{ speaker: "candidate", text: "I built it." }], interviewStage: "recruiter_screening" }, complete: async (_id, evaluator, result) => { states[evaluator] = "ready"; results[evaluator] = result; }, fail: async (_id, evaluator) => { states[evaluator] = "failed"; }, finalize: async () => states.holistic === "ready" && states.structured === "ready" ? { kind: "evaluated", report: { holistic: results.holistic, structured: results.structured } } : { kind: "pending" } };
}
describe("dual interview evaluation processor", () => {
  test("persists both evaluators independently and merges the final report", async () => {
    const store = memoryStore(); const processor = createInterviewEvaluationProcessor(store, { evaluate: async () => ({ overallScore: 82 }) }, { evaluate: async () => ({ rubricScore: 79 }) }, () => "2026-09-07T09:01:00.000Z");
    expect(await processor(envelope)).toEqual({ replayed: false, sessionId: "session_1", evaluated: true }); expect(store.states).toEqual({ holistic: "ready", structured: "ready" });
  });
  test("retry skips the completed evaluator and only reruns the failed one", async () => {
    const store = memoryStore(); let holisticCalls = 0; let structuredCalls = 0;
    const processor = createInterviewEvaluationProcessor(store, { evaluate: async () => { holisticCalls++; return { score: 80 }; } }, { evaluate: async () => { structuredCalls++; if (structuredCalls === 1) throw new Error("rate limited"); return { score: 75 }; } }, () => "2026-09-07T09:01:00.000Z");
    await expect(processor(envelope)).rejects.toThrow("rate limited"); expect(store.states).toEqual({ holistic: "ready", structured: "failed" }); expect(await processor(envelope)).toMatchObject({ evaluated: true }); expect({ holisticCalls, structuredCalls }).toEqual({ holisticCalls: 1, structuredCalls: 2 });
  });
  test("deterministic fallback retains an evaluable result when the primary fails", async () => {
    const evaluator = createResilientEvaluator({ evaluate: async () => { throw new Error("provider down"); } }, { evaluate: async () => ({ overallScore: 60, source: "deterministic" }) });
    expect(await evaluator.evaluate({ sessionId: "session_1", interviewStage: "functional_interview", transcript: [] })).toEqual({ overallScore: 60, source: "deterministic", degraded: true });
  });
});
