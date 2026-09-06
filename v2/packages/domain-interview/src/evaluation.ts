import type { InterviewSessionStatus, InterviewStage } from "./session";
export interface InterviewEvaluationView {
  readonly sessionId: string; readonly tenantId: string; readonly applicationId: string; readonly interviewStage: InterviewStage;
  readonly status: InterviewSessionStatus; readonly evaluation: Readonly<Record<string, unknown>> | null;
}
export interface InterviewEvaluationQueries { find(tenantId: string, sessionId: string): Promise<InterviewEvaluationView | undefined> }
