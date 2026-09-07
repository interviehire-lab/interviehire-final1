import { APPLICATION_STAGES, type ApplicationDecision, type ApplicationStage, type AsyncStatus } from "@interviehire/contracts";

export interface ApplicationView {
  readonly id: string;
  readonly jobId: string;
  readonly tenantId: string;
  readonly candidateName: string;
  readonly stage: ApplicationStage;
  readonly decision: ApplicationDecision;
  readonly source: string | null;
  readonly asyncStatus: AsyncStatus;
  readonly resumeAnalysisComplete?: boolean;
  readonly screeningComplete?: boolean;
}

export interface ApplicationQueryRepository {
  findForTenant(tenantId: string, applicationId: string): Promise<ApplicationView | undefined>;
  listForJob(tenantId: string, jobId: string): Promise<readonly ApplicationView[]>;
}

const STAGE_LABELS: Record<ApplicationStage, string> = {
  resume_analysis: "Resume Analysis",
  recruiter_screening: "Recruiter Screening",
  functional_interview: "Functional Interview",
};

export function buildCandidateBoard(jobId: string, applications: readonly ApplicationView[]) {
  return {
    jobId,
    columns: APPLICATION_STAGES.map((stage) => ({
      stage,
      label: STAGE_LABELS[stage],
      applications: applications.filter((application) => application.stage === stage),
    })),
  };
}
