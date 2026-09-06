export type InterviewStage = "recruiter_screening" | "functional_interview";
export type InterviewSessionStatus = "scheduled" | "in_progress" | "completed" | "evaluating" | "evaluated";

export interface InterviewSession {
  readonly id: string;
  readonly tenantId: string;
  readonly applicationId: string;
  readonly interviewStage: InterviewStage;
  readonly status: InterviewSessionStatus;
  readonly scheduledAt: string;
  readonly timeZone: string;
  readonly hardLimitSeconds: number;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly createdAt: string;
}

export interface SessionRepository {
  findByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<InterviewSession | undefined>;
  create(session: InterviewSession): Promise<void>;
}

export interface ProvisionSessionCommand {
  readonly tenantId: string;
  readonly applicationId: string;
  readonly interviewStage: InterviewStage;
  readonly scheduledAt: string;
  readonly timeZone: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
}

export type ProvisionSessionResult =
  | { readonly ok: true; readonly interviewSessionId: string; readonly hardLimitSeconds: number; readonly replayed: boolean }
  | { readonly ok: false; readonly code: "INVALID_SCHEDULE" | "INVALID_TIME_ZONE"; readonly message: string };

export interface SessionProvisioningService { provision(command: ProvisionSessionCommand): Promise<ProvisionSessionResult> }

export function hardLimitForStage(stage: InterviewStage): number {
  return stage === "recruiter_screening" ? 5 * 60 : 25 * 60;
}

export function createSessionProvisioningService(repository: SessionRepository, newId: () => string, now: () => string): SessionProvisioningService {
  return {
    async provision(command) {
      const existing = await repository.findByIdempotencyKey(command.tenantId, command.idempotencyKey);
      if (existing) return success(existing, true);
      if (!Number.isFinite(Date.parse(command.scheduledAt))) {
        return { ok: false, code: "INVALID_SCHEDULE", message: "scheduledAt must be an ISO date-time." };
      }
      try { new Intl.DateTimeFormat("en", { timeZone: command.timeZone }).format(); }
      catch { return { ok: false, code: "INVALID_TIME_ZONE", message: "timeZone must be a valid IANA time zone." }; }
      const id = newId();
      if (id === command.applicationId) throw new Error("Interview session IDs must be distinct from application IDs.");
      const session: InterviewSession = { id, ...command, status: "scheduled", hardLimitSeconds: hardLimitForStage(command.interviewStage), createdAt: now() };
      await repository.create(session);
      return success(session, false);
    },
  };
}

function success(session: InterviewSession, replayed: boolean): ProvisionSessionResult {
  return { ok: true, interviewSessionId: session.id, hardLimitSeconds: session.hardLimitSeconds, replayed };
}
