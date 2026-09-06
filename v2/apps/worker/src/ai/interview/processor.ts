import type { JobEnvelopeV1 } from "@interviehire/contracts";
import type { InterviewStage, TranscriptEntry } from "@interviehire/domain-interview";
import type { Processor } from "bullmq";

export type EvaluatorName = "holistic" | "structured";
type EvaluationClaim = { readonly kind: "ready" | "busy" | "missing" } | { readonly kind: "claimed"; readonly transcript: readonly TranscriptEntry[]; readonly interviewStage: InterviewStage };
export interface EvaluationStore {
  claim(sessionId: string, tenantId: string, evaluator: EvaluatorName, startedAt: string): Promise<EvaluationClaim>;
  complete(sessionId: string, evaluator: EvaluatorName, result: Readonly<Record<string, unknown>>, completedAt: string): Promise<void>;
  fail(sessionId: string, evaluator: EvaluatorName, errorCode: string, failedAt: string): Promise<void>;
  finalize(sessionId: string, completedAt: string): Promise<{ readonly kind: "evaluated"; readonly report: Readonly<Record<string, unknown>> } | { readonly kind: "pending" }>;
}
export interface InterviewEvaluator { evaluate(input: { readonly sessionId: string; readonly interviewStage: InterviewStage; readonly transcript: readonly TranscriptEntry[] }): Promise<Readonly<Record<string, unknown>>> }
export function createResilientEvaluator(primary: InterviewEvaluator, fallback: InterviewEvaluator): InterviewEvaluator {
  return { async evaluate(input) { try { return await primary.evaluate(input); } catch { return { ...(await fallback.evaluate(input)), degraded: true }; } } };
}
export function createInterviewEvaluationProcessor(store: EvaluationStore, holistic: InterviewEvaluator, structured: InterviewEvaluator, now: () => string) {
  return async (envelope: JobEnvelopeV1): Promise<{ replayed: boolean; sessionId: string; evaluated: boolean }> => {
    if (envelope.resourceRef.type !== "interview_session") throw new Error("Evaluation job has an invalid resource reference");
    const sessionId = envelope.resourceRef.id; let processed = false; let firstError: unknown;
    for (const [name, evaluator] of [["holistic", holistic], ["structured", structured]] as const) {
      const claim = await store.claim(sessionId, envelope.tenantId, name, now());
      if (claim.kind === "missing") throw new Error("Interview session not found");
      if (claim.kind !== "claimed") continue;
      try { const result = await evaluator.evaluate({ sessionId, interviewStage: claim.interviewStage, transcript: claim.transcript }); await store.complete(sessionId, name, result, now()); processed = true; }
      catch (error) { await store.fail(sessionId, name, "TRANSIENT", now()); firstError ??= error; }
    }
    if (firstError) throw firstError;
    const final = await store.finalize(sessionId, now());
    return { replayed: !processed, sessionId, evaluated: final.kind === "evaluated" };
  };
}
export function createBullMqInterviewProcessor(processor: ReturnType<typeof createInterviewEvaluationProcessor>): Processor<JobEnvelopeV1> { return (job) => processor(job.data); }
