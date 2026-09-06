import type { InterviewStage } from "./scheduling";
export interface AnalysisRef { readonly applicationId: string; readonly interviewSessionId: string; readonly interviewStage: InterviewStage }
export interface AnalysisRefRepository { findLatest(tenantId: string, applicationId: string): Promise<AnalysisRef | undefined> }
export interface InterviewEvaluationClient { getEvaluation(tenantId: string, sessionId: string, correlationId: string): Promise<{ readonly sessionId: string; readonly status: string; readonly evaluation: Readonly<Record<string, unknown>> | null } | undefined> }
export interface DeepAnalysisService { get(tenantId: string, applicationId: string, correlationId?: string): Promise<{ readonly ok: true; readonly applicationId: string; readonly interviewSessionId: string; readonly interviewStage: InterviewStage; readonly status: string; readonly evaluation: Readonly<Record<string, unknown>> | null } | { readonly ok: false; readonly code: "NOT_FOUND"; readonly message: string }> }
export function createDeepAnalysisService(refs: AnalysisRefRepository, interview: InterviewEvaluationClient): DeepAnalysisService {
  return { async get(tenantId: string, applicationId: string, correlationId = "internal") {
    const ref = await refs.findLatest(tenantId, applicationId); if (!ref) return { ok: false as const, code: "NOT_FOUND" as const, message: "Interview analysis not found." };
    const result = await interview.getEvaluation(tenantId, ref.interviewSessionId, correlationId); if (!result) return { ok: false as const, code: "NOT_FOUND" as const, message: "Interview analysis not found." };
    return { ok: true as const, applicationId, interviewSessionId: ref.interviewSessionId, interviewStage: ref.interviewStage, status: result.status, evaluation: result.evaluation };
  } };
}
