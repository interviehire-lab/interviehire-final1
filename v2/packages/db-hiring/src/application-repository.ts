import { eq } from "drizzle-orm";
import type { ApplicationRepository, ApplicationRecord, StageHistoryRecord } from "@interviehire/domain-hiring";
import type { ApplicationStage } from "@interviehire/contracts";
import type { HiringDatabase } from "./database";
import { applicationStageHistory, applications } from "./schema";

export class DrizzleApplicationRepository implements ApplicationRepository {
  constructor(private readonly db: HiringDatabase) {}

  transaction<T>(work: (repository: ApplicationRepository) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => work(new DrizzleApplicationRepository(tx as unknown as HiringDatabase)));
  }

  async find(applicationId: string): Promise<ApplicationRecord | undefined> {
    const [row] = await this.db.select().from(applications).where(eq(applications.id, applicationId)).limit(1);
    return row;
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

  async hasCommand(idempotencyKey: string): Promise<boolean> {
    const [row] = await this.db.select({ id: applicationStageHistory.id })
      .from(applicationStageHistory)
      .where(eq(applicationStageHistory.idempotencyKey, idempotencyKey)).limit(1);
    return row !== undefined;
  }

  async recordCommand(_idempotencyKey: string): Promise<void> {}
}
