export const APPLICATION_STAGES = [
  "resume_analysis",
  "recruiter_screening",
  "functional_interview",
] as const;

export type ApplicationStage = (typeof APPLICATION_STAGES)[number];

export const APPLICATION_DECISIONS = ["active", "hired", "rejected", "withdrawn"] as const;
export type ApplicationDecision = (typeof APPLICATION_DECISIONS)[number];

export const ASYNC_STATUSES = ["not_requested", "queued", "running", "ready", "failed"] as const;
export type AsyncStatus = (typeof ASYNC_STATUSES)[number];

export const RESOURCE_TYPES = [
  "application",
  "interview_session",
  "job",
  "notification",
  "talent_search",
  "recording",
] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export interface ResourceRef {
  readonly type: ResourceType;
  readonly id: string;
}

export interface JobEnvelopeV1 {
  readonly jobId: string;
  readonly tenantId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly resourceRef: ResourceRef;
  readonly requestedAt: string;
  readonly version: 1;
  readonly causationId?: string;
  readonly traceparent?: string;
  readonly payload?: Readonly<Record<string, string | number | boolean>>;
}

const PII_PAYLOAD_KEYS = new Set([
  "resumeText", "transcript", "candidateEmail", "candidatePhone", "coverLetter",
  "applicationAnswers", "report", "credentials",
]);

export function isJobEnvelopeV1(value: unknown): value is JobEnvelopeV1 {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  if (item.version !== 1) return false;
  for (const key of ["jobId", "tenantId", "correlationId", "idempotencyKey", "requestedAt"] as const) {
    if (typeof item[key] !== "string" || item[key].length === 0) return false;
  }
  const ref = item.resourceRef;
  if (!ref || typeof ref !== "object") return false;
  const resource = ref as Record<string, unknown>;
  if (!RESOURCE_TYPES.includes(resource.type as ResourceType) || typeof resource.id !== "string") return false;
  if (item.payload !== undefined) {
    if (!item.payload || typeof item.payload !== "object" || Array.isArray(item.payload)) return false;
    for (const [key, field] of Object.entries(item.payload)) {
      if (PII_PAYLOAD_KEYS.has(key) || !["string", "number", "boolean"].includes(typeof field)) return false;
    }
  }
  return true;
}

export interface ApplicationInterviewRef {
  readonly applicationId: string;
  readonly interviewSessionId: string;
  readonly interviewStage: Exclude<ApplicationStage, "resume_analysis">;
  readonly createdAt: string;
}

export type TransitionErrorCode =
  | "ILLEGAL_TRANSITION"
  | "RESUME_ANALYSIS_INCOMPLETE"
  | "INTERVIEW_INCOMPLETE"
  | "APPLICATION_INACTIVE"
  | "NOT_FOUND";

export type TransitionApplicationResult =
  | {
      readonly ok: true;
      readonly applicationId: string;
      readonly from: ApplicationStage;
      readonly to: ApplicationStage;
      readonly replayed?: boolean;
    }
  | { readonly ok: false; readonly code: TransitionErrorCode; readonly message: string };

export interface ApplicationStageChangedV1 {
  readonly eventId: string;
  readonly eventType: "application.stage_changed.v1";
  readonly aggregateId: string;
  readonly tenantId: string;
  readonly correlationId: string;
  readonly occurredAt: string;
  readonly payload: {
    readonly resourceType: "application";
    readonly resourceId: string;
    readonly from: ApplicationStage;
    readonly to: ApplicationStage;
  };
}

export interface ResumeAnalysisRequestedV1 {
  readonly eventId: string;
  readonly eventType: "resume-analysis.requested.v1";
  readonly aggregateId: string;
  readonly tenantId: string;
  readonly correlationId: string;
  readonly occurredAt: string;
  readonly payload: {
    readonly resourceType: "application";
    readonly resourceId: string;
    readonly runId: string;
    readonly resumeRevision: number;
  };
}

export type HiringOutboxEvent = ApplicationStageChangedV1 | ResumeAnalysisRequestedV1;

export interface InterviewCompletedV1 {
  readonly eventId: string; readonly eventType: "interview.completed.v1"; readonly aggregateId: string;
  readonly tenantId: string; readonly correlationId: string; readonly occurredAt: string;
  readonly payload: { readonly resourceType: "interview_session"; readonly resourceId: string; readonly interviewSessionId: string; readonly applicationId: string; readonly interviewStage: "recruiter_screening" | "functional_interview" };
}
