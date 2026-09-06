import type { JobEnvelopeV1 } from "@interviehire/contracts";
import { UnrecoverableError, type Processor } from "bullmq";

export class TransientProviderError extends Error {
  readonly failureClass = "TRANSIENT";
}

export class PermanentResumeAnalysisError extends Error {
  readonly failureClass = "PERMANENT";
}

export type ResumeClaim =
  | { readonly kind: "claimed"; readonly applicationId: string }
  | { readonly kind: "ready" }
  | { readonly kind: "busy" }
  | { readonly kind: "missing" };

export interface ResumeAnalysisWorkerStore {
  claim(runId: string, tenantId: string, startedAt: string): Promise<ResumeClaim>;
  loadResumeText(applicationId: string, tenantId: string): Promise<string | undefined>;
  complete(runId: string, result: Readonly<Record<string, unknown>>, completedAt: string): Promise<void>;
  fail(runId: string, errorCode: string, failedAt: string): Promise<void>;
}

export interface ResumeAnalysisProvider {
  analyseResume(input: {
    readonly applicationId: string;
    readonly resumeText: string;
    readonly correlationId: string;
  }): Promise<Readonly<Record<string, unknown>>>;
}

export function createResumeAnalysisProcessor(
  store: ResumeAnalysisWorkerStore,
  provider: ResumeAnalysisProvider,
  now: () => string,
) {
  return async (envelope: JobEnvelopeV1): Promise<{ replayed: boolean; runId: string }> => {
    const runId = envelope.payload?.runId;
    if (envelope.resourceRef.type !== "application" || typeof runId !== "string") {
      throw new PermanentResumeAnalysisError("Resume job has an invalid resource reference");
    }
    const claim = await store.claim(runId, envelope.tenantId, now());
    if (claim.kind === "ready" || claim.kind === "busy") return { replayed: true, runId };
    if (claim.kind === "missing") throw new PermanentResumeAnalysisError("Resume-analysis run not found");

    try {
      const resumeText = await store.loadResumeText(claim.applicationId, envelope.tenantId);
      if (!resumeText?.trim()) throw new PermanentResumeAnalysisError("Application has no resume text");
      const result = await provider.analyseResume({
        applicationId: claim.applicationId,
        resumeText,
        correlationId: envelope.correlationId,
      });
      await store.complete(runId, result, now());
      return { replayed: false, runId };
    } catch (error) {
      const code = error instanceof PermanentResumeAnalysisError ? "PERMANENT" : "TRANSIENT";
      await store.fail(runId, code, now());
      throw error;
    }
  };
}

export function createBullMqResumeProcessor(
  processor: (envelope: JobEnvelopeV1) => Promise<{ replayed: boolean; runId: string }>,
): Processor<JobEnvelopeV1, { replayed: boolean; runId: string }> {
  return async (job) => {
    try { return await processor(job.data); }
    catch (error) {
      if (error instanceof PermanentResumeAnalysisError) throw new UnrecoverableError(error.message);
      throw error;
    }
  };
}
