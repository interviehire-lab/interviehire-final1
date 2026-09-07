import type { InterviewStage } from "./scheduling";

export interface InterviewResultRepository {
  hasMapping(tenantId: string, applicationId: string, interviewSessionId: string, stage: InterviewStage): Promise<boolean>;
  markScreeningComplete(tenantId: string, applicationId: string): Promise<void>;
}

export interface InterviewResultService {
  record(input: { readonly tenantId: string; readonly applicationId: string; readonly interviewSessionId: string; readonly interviewStage: InterviewStage }): Promise<
    { readonly ok: true; readonly screeningComplete: boolean }
    | { readonly ok: false; readonly code: "MAPPING_NOT_FOUND"; readonly message: string }
  >;
}

export function createInterviewResultService(repository: InterviewResultRepository): InterviewResultService {
  return {
    async record(input) {
      if (!await repository.hasMapping(input.tenantId, input.applicationId, input.interviewSessionId, input.interviewStage)) {
        return { ok: false, code: "MAPPING_NOT_FOUND", message: "Interview mapping not found." };
      }
      if (input.interviewStage === "recruiter_screening") {
        await repository.markScreeningComplete(input.tenantId, input.applicationId);
      }
      return { ok: true, screeningComplete: input.interviewStage === "recruiter_screening" };
    },
  };
}
