import type { AsyncStatus, ResumeAnalysisRequestedV1 } from "@interviehire/contracts";

export interface ResumeAnalysisRun {
  readonly id: string;
  readonly applicationId: string;
  readonly tenantId: string;
  readonly status: AsyncStatus;
  readonly attempt: number;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly resumeRevision: number;
  readonly result: Readonly<Record<string, unknown>> | null;
  readonly errorCode: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ResumeAnalysisRepository {
  transaction<T>(work: (repository: ResumeAnalysisRepository) => Promise<T>): Promise<T>;
  applicationExists(tenantId: string, applicationId: string): Promise<boolean>;
  findByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<ResumeAnalysisRun | undefined>;
  createRun(run: ResumeAnalysisRun): Promise<void>;
  setApplicationAsyncStatus(applicationId: string, status: AsyncStatus): Promise<void>;
  appendOutbox(event: ResumeAnalysisRequestedV1): Promise<void>;
  findRunForTenant(tenantId: string, runId: string): Promise<ResumeAnalysisRun | undefined>;
  findLatestForApplication(tenantId: string, applicationId: string): Promise<ResumeAnalysisRun | undefined>;
}

export interface ResumeAnalysisCommand {
  readonly applicationId: string;
  readonly tenantId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly resumeRevision: number;
}

export type ResumeAnalysisRequestResult =
  | { readonly ok: true; readonly asyncJobId: string; readonly status: "queued"; readonly replayed: boolean }
  | { readonly ok: false; readonly code: "NOT_FOUND"; readonly message: string };

export interface ResumeAnalysisService {
  request(command: ResumeAnalysisCommand): Promise<ResumeAnalysisRequestResult>;
  findJob(tenantId: string, runId: string): Promise<ResumeAnalysisRun | undefined>;
  findLatest(tenantId: string, applicationId: string): Promise<ResumeAnalysisRun | undefined>;
}

export function createResumeAnalysisService(
  repository: ResumeAnalysisRepository,
  deterministic: { readonly newId: () => string; readonly now: () => string },
): ResumeAnalysisService {
  return {
    request(command) {
      return repository.transaction(async (tx) => {
        if (!await tx.applicationExists(command.tenantId, command.applicationId)) {
          return { ok: false, code: "NOT_FOUND", message: "Application not found." };
        }
        const existing = await tx.findByIdempotencyKey(command.tenantId, command.idempotencyKey);
        if (existing) return { ok: true, asyncJobId: existing.id, status: "queued", replayed: true };

        const id = deterministic.newId();
        const now = deterministic.now();
        await tx.createRun({
          id,
          applicationId: command.applicationId,
          tenantId: command.tenantId,
          status: "queued",
          attempt: 0,
          idempotencyKey: command.idempotencyKey,
          correlationId: command.correlationId,
          resumeRevision: command.resumeRevision,
          result: null,
          errorCode: null,
          createdAt: now,
          updatedAt: now,
        });
        await tx.setApplicationAsyncStatus(command.applicationId, "queued");
        await tx.appendOutbox({
          eventId: `evt_${command.tenantId}_${command.idempotencyKey}`,
          eventType: "resume-analysis.requested.v1",
          aggregateId: command.applicationId,
          tenantId: command.tenantId,
          correlationId: command.correlationId,
          occurredAt: now,
          payload: {
            resourceType: "application",
            resourceId: command.applicationId,
            runId: id,
            resumeRevision: command.resumeRevision,
          },
        });
        return { ok: true, asyncJobId: id, status: "queued", replayed: false };
      });
    },
    findJob: (tenantId, runId) => repository.findRunForTenant(tenantId, runId),
    findLatest: (tenantId, applicationId) => repository.findLatestForApplication(tenantId, applicationId),
  };
}
