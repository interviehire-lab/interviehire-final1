import type { ApplicationDecision, ApplicationStage } from "@interviehire/contracts";
export interface DecisionApplication { readonly id: string; readonly tenantId: string; readonly stage: ApplicationStage; readonly decision: ApplicationDecision }
export interface DecisionRecord { readonly applicationId: string; readonly tenantId: string; readonly stage: ApplicationStage; readonly from: ApplicationDecision; readonly to: "hired" | "rejected"; readonly actorId: string; readonly correlationId: string; readonly idempotencyKey: string; readonly occurredAt: string }
export interface DecisionRepository { find(tenantId: string, applicationId: string): Promise<DecisionApplication | undefined>; findCommand(tenantId: string, idempotencyKey: string): Promise<DecisionRecord | undefined>; commit(record: DecisionRecord): Promise<void> }
export interface DecisionCommand { readonly tenantId: string; readonly applicationId: string; readonly decision: "hired" | "rejected"; readonly actorId: string; readonly correlationId: string; readonly idempotencyKey: string }
export interface DecisionService { decide(command: DecisionCommand): Promise<{ readonly ok: true; readonly applicationId: string; readonly stage: ApplicationStage; readonly decision: "hired" | "rejected"; readonly replayed: boolean } | { readonly ok: false; readonly code: "NOT_FOUND" | "APPLICATION_INACTIVE" | "HIRING_NOT_READY"; readonly message: string }> }
export function createDecisionService(repository: DecisionRepository, now: () => string): DecisionService {
  return { async decide(command: DecisionCommand) {
    const replay = await repository.findCommand(command.tenantId, command.idempotencyKey); if (replay) return { ok: true as const, applicationId: replay.applicationId, stage: replay.stage, decision: replay.to, replayed: true };
    const application = await repository.find(command.tenantId, command.applicationId); if (!application) return { ok: false as const, code: "NOT_FOUND" as const, message: "Application not found." };
    if (application.decision !== "active") return { ok: false as const, code: "APPLICATION_INACTIVE" as const, message: "Application already has a terminal decision." };
    if (command.decision === "hired" && application.stage !== "functional_interview") return { ok: false as const, code: "HIRING_NOT_READY" as const, message: "Only candidates in functional interview can be hired." };
    const record: DecisionRecord = { ...command, stage: application.stage, from: application.decision, to: command.decision, occurredAt: now() };
    await repository.commit(record); return { ok: true as const, applicationId: application.id, stage: application.stage, decision: command.decision, replayed: false };
  } };
}
