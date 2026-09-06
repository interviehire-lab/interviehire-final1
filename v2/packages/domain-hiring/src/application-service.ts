import type {
  ApplicationDecision,
  ApplicationStageChangedV1,
  ApplicationStage,
  TransitionApplicationResult,
} from "@interviehire/contracts";
import { transitionApplication } from "./pipeline";

export interface ApplicationRecord {
  readonly id: string;
  readonly tenantId: string;
  stage: ApplicationStage;
  readonly decision: ApplicationDecision;
  readonly resumeAnalysisComplete: boolean;
  readonly screeningComplete: boolean;
}

export interface StageHistoryRecord {
  readonly applicationId: string;
  readonly tenantId: string;
  readonly from: ApplicationStage;
  readonly to: ApplicationStage;
  readonly actorId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly occurredAt: string;
}

export interface ApplicationRepository {
  transaction<T>(work: (repository: ApplicationRepository) => Promise<T>): Promise<T>;
  find(applicationId: string): Promise<ApplicationRecord | undefined>;
  updateStage(applicationId: string, stage: ApplicationStage): Promise<void>;
  appendHistory(history: StageHistoryRecord): Promise<void>;
  appendOutbox(event: ApplicationStageChangedV1): Promise<void>;
  hasCommand(idempotencyKey: string): Promise<boolean>;
  recordCommand(idempotencyKey: string): Promise<void>;
}

export interface TransitionCommand {
  readonly applicationId: string;
  readonly tenantId: string;
  readonly to: ApplicationStage;
  readonly actorId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly occurredAt: string;
}

export function createApplicationService(repository: ApplicationRepository) {
  return {
    transition(command: TransitionCommand): Promise<TransitionApplicationResult> {
      return repository.transaction(async (tx) => {
        const application = await tx.find(command.applicationId);
        if (!application || application.tenantId !== command.tenantId) {
          return { ok: false, code: "NOT_FOUND", message: "Application not found." };
        }
        if (await tx.hasCommand(command.idempotencyKey)) {
          return {
            ok: true,
            applicationId: application.id,
            from: application.stage,
            to: application.stage,
            replayed: true,
          };
        }
        const result = transitionApplication(application, command.to, application);
        if (!result.ok) return result;
        await tx.updateStage(application.id, result.to);
        await tx.appendOutbox({
          eventId: `evt_${command.tenantId}_${command.idempotencyKey}`,
          eventType: "application.stage_changed.v1",
          aggregateId: application.id,
          tenantId: application.tenantId,
          correlationId: command.correlationId,
          occurredAt: command.occurredAt,
          payload: {
            resourceType: "application",
            resourceId: application.id,
            from: result.from,
            to: result.to,
          },
        });
        await tx.appendHistory({
          applicationId: application.id,
          tenantId: application.tenantId,
          from: result.from,
          to: result.to,
          actorId: command.actorId,
          correlationId: command.correlationId,
          idempotencyKey: command.idempotencyKey,
          occurredAt: command.occurredAt,
        });
        await tx.recordCommand(command.idempotencyKey);
        return result;
      });
    },
  };
}
