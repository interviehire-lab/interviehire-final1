import type {
  ApplicationDecision,
  ApplicationStage,
  TransitionApplicationResult,
} from "@interviehire/contracts";

export interface PipelineApplication {
  readonly id: string;
  readonly tenantId: string;
  readonly stage: ApplicationStage;
  readonly decision: ApplicationDecision;
}

export interface TransitionEvidence {
  readonly resumeAnalysisComplete: boolean;
  readonly screeningComplete: boolean;
}

export function transitionApplication(
  application: PipelineApplication,
  to: ApplicationStage,
  evidence: TransitionEvidence,
): TransitionApplicationResult {
  if (application.decision !== "active") {
    return { ok: false, code: "APPLICATION_INACTIVE", message: "Only active applications can move stage." };
  }
  if (application.stage === to) {
    return { ok: true, applicationId: application.id, from: application.stage, to };
  }
  if (application.stage === "resume_analysis" && to === "functional_interview") {
    return {
      ok: false,
      code: "ILLEGAL_TRANSITION",
      message: "Recruiter screening must be completed before the functional interview.",
    };
  }
  if (application.stage === "resume_analysis" && to === "recruiter_screening") {
    return evidence.resumeAnalysisComplete
      ? { ok: true, applicationId: application.id, from: application.stage, to }
      : { ok: false, code: "RESUME_ANALYSIS_INCOMPLETE", message: "Resume analysis must be complete." };
  }
  if (application.stage === "recruiter_screening" && to === "functional_interview") {
    return evidence.screeningComplete
      ? { ok: true, applicationId: application.id, from: application.stage, to }
      : { ok: false, code: "INTERVIEW_INCOMPLETE", message: "Recruiter screening must be complete." };
  }
  return { ok: false, code: "ILLEGAL_TRANSITION", message: `Cannot move from ${application.stage} to ${to}.` };
}
