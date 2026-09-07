import { and, asc, eq } from "drizzle-orm";
import type {
  ApplicationQueryRepository,
  ApplicationRepository,
  ApplicationRecord,
  ApplicationView,
  StageHistoryRecord,
} from "@interviehire/domain-hiring";
import type { ApplicationStage } from "@interviehire/contracts";
import type { HiringOutboxEvent } from "@interviehire/contracts";
import type { HiringDatabase } from "./database";
import { applicationStageHistory, applications, hiringOutbox } from "./schema";

export class DrizzleApplicationRepository implements ApplicationRepository, ApplicationQueryRepository {
  constructor(private readonly db: HiringDatabase) {}

  transaction<T>(work: (repository: ApplicationRepository) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => work(new DrizzleApplicationRepository(tx as unknown as HiringDatabase)));
  }

  async find(applicationId: string): Promise<ApplicationRecord | undefined> {
    const [row] = await this.db.select().from(applications).where(eq(applications.id, applicationId)).limit(1);
    return row;
  }

  async findForTenant(tenantId: string, applicationId: string): Promise<ApplicationView | undefined> {
    const [row] = await this.db.select().from(applications).where(and(
      eq(applications.tenantId, tenantId),
      eq(applications.id, applicationId),
    )).limit(1);
    return row ? toApplicationView(row) : undefined;
  }

  async listForJob(tenantId: string, jobId: string): Promise<readonly ApplicationView[]> {
    const rows = await this.db.select().from(applications).where(and(
      eq(applications.tenantId, tenantId),
      eq(applications.jobId, jobId),
    )).orderBy(asc(applications.candidateName), asc(applications.id));
    return rows.map(toApplicationView);
  }

  async updateStage(applicationId: string, stage: ApplicationStage): Promise<void> {
    await this.db.update(applications).set({ stage }).where(eq(applications.id, applicationId));
  }

  async appendHistory(history: StageHistoryRecord): Promise<void> {
    await this.db.insert(applicationStageHistory).values({
      id: `history:${history.tenantId}:${history.idempotencyKey}`,
      applicationId: history.applicationId,
      tenantId: history.tenantId,
      fromStage: history.from,
      toStage: history.to,
      actorId: history.actorId,
      correlationId: history.correlationId,
      idempotencyKey: history.idempotencyKey,
      occurredAt: history.occurredAt,
    });
  }

  async appendOutbox(event: HiringOutboxEvent): Promise<void> {
    await this.db.insert(hiringOutbox).values(event);
  }

  async hasCommand(idempotencyKey: string): Promise<boolean> {
    const [row] = await this.db.select({ id: applicationStageHistory.id })
      .from(applicationStageHistory)
      .where(eq(applicationStageHistory.idempotencyKey, idempotencyKey)).limit(1);
    return row !== undefined;
  }

  async recordCommand(_idempotencyKey: string): Promise<void> {}
}

type ApplicationRow = typeof applications.$inferSelect;

function toApplicationView(row: ApplicationRow): ApplicationView {
  return {
    id: row.id,
    jobId: row.jobId ?? "",
    tenantId: row.tenantId,
    candidateName: row.candidateName ?? "",
    stage: row.stage,
    decision: row.decision,
    source: row.source,
    asyncStatus: row.asyncStatus,
    resumeAnalysisComplete: row.resumeAnalysisComplete,
    screeningComplete: row.screeningComplete,
  };
}
