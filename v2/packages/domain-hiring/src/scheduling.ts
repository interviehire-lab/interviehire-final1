import type { ApplicationDecision, ApplicationStage } from "@interviehire/contracts";

export type InterviewStage = Exclude<ApplicationStage, "resume_analysis">;

export interface SchedulingApplication {
  readonly id: string;
  readonly tenantId: string;
  readonly stage: ApplicationStage;
  readonly decision: ApplicationDecision;
  readonly resumeAnalysisComplete: boolean;
  readonly screeningComplete: boolean;
}

export interface ScheduledInterview {
  readonly applicationId: string;
  readonly tenantId: string;
  readonly interviewSessionId: string;
  readonly interviewStage: InterviewStage;
  readonly scheduledAt: string;
  readonly timeZone: string;
  readonly deliveryMethods: readonly ("email" | "whatsapp" | "robocall")[];
  readonly fromStage: ApplicationStage;
  readonly toStage: InterviewStage;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly actorId: string;
  readonly createdAt: string;
}

export interface ScheduleRepository {
  findApplication(tenantId: string, applicationId: string): Promise<SchedulingApplication | undefined>;
  findByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<ScheduledInterview | undefined>;
  commitSchedule(schedule: ScheduledInterview): Promise<void>;
}

export interface InterviewProvisioner {
  provision(input: {
    readonly applicationId: string;
    readonly tenantId: string;
    readonly interviewStage: InterviewStage;
    readonly scheduledAt: string;
    readonly timeZone: string;
    readonly correlationId: string;
  }): Promise<{ readonly interviewSessionId: string }>;
}

export interface ScheduleCommand {
  readonly applicationId: string;
  readonly tenantId: string;
  readonly interviewStage: InterviewStage;
  readonly scheduledAt: string;
  readonly timeZone: string;
  readonly deliveryMethods: readonly ("email" | "whatsapp" | "robocall")[];
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly actorId: string;
}

export type ScheduleResult =
  | {
      readonly ok: true;
      readonly applicationId: string;
      readonly interviewSessionId: string;
      readonly interviewStage: InterviewStage;
      readonly scheduledAt: string;
      readonly replayed: boolean;
    }
  | { readonly ok: false; readonly code: "NOT_FOUND" | "ILLEGAL_TRANSITION" | "APPLICATION_INACTIVE"; readonly message: string };

export interface SchedulingService { schedule(command: ScheduleCommand): Promise<ScheduleResult> }

export function createSchedulingService(
  repository: ScheduleRepository,
  interview: InterviewProvisioner,
  now: () => string,
): SchedulingService {
  return {
    async schedule(command) {
      const existing = await repository.findByIdempotencyKey(command.tenantId, command.idempotencyKey);
      if (existing) return success(existing, true);
      const application = await repository.findApplication(command.tenantId, command.applicationId);
      if (!application) return { ok: false, code: "NOT_FOUND", message: "Application not found." };
      if (application.decision !== "active") {
        return { ok: false, code: "APPLICATION_INACTIVE", message: "Only active applications can be scheduled." };
      }
      if (!canSchedule(application, command.interviewStage)) {
        return { ok: false, code: "ILLEGAL_TRANSITION", message: `Application is not ready for ${command.interviewStage}.` };
      }
      const provisioned = await interview.provision({
        applicationId: application.id,
        tenantId: application.tenantId,
        interviewStage: command.interviewStage,
        scheduledAt: command.scheduledAt,
        timeZone: command.timeZone,
        correlationId: command.correlationId,
      });
      const schedule: ScheduledInterview = {
        ...command,
        interviewSessionId: provisioned.interviewSessionId,
        fromStage: application.stage,
        toStage: command.interviewStage,
        createdAt: now(),
      };
      await repository.commitSchedule(schedule);
      return success(schedule, false);
    },
  };
}

function canSchedule(application: SchedulingApplication, interviewStage: InterviewStage): boolean {
  if (interviewStage === "recruiter_screening") {
    return application.resumeAnalysisComplete
      && (application.stage === "resume_analysis" || application.stage === "recruiter_screening");
  }
  return application.stage === "recruiter_screening" && application.screeningComplete;
}

function success(schedule: ScheduledInterview, replayed: boolean): ScheduleResult {
  return {
    ok: true,
    applicationId: schedule.applicationId,
    interviewSessionId: schedule.interviewSessionId,
    interviewStage: schedule.interviewStage,
    scheduledAt: schedule.scheduledAt,
    replayed,
  };
}
