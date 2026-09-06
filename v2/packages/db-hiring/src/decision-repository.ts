import { and, eq } from "drizzle-orm";
import type { DecisionRecord, DecisionRepository } from "@interviehire/domain-hiring";
import type { HiringDatabase } from "./database";
import { applicationDecisionHistory, applications, hiringOutbox } from "./schema";
export class DrizzleDecisionRepository implements DecisionRepository {
  constructor(private readonly db: HiringDatabase) {}
  async find(tenantId: string, applicationId: string) { const [row] = await this.db.select({ id: applications.id, tenantId: applications.tenantId, stage: applications.stage, decision: applications.decision }).from(applications).where(and(eq(applications.tenantId, tenantId), eq(applications.id, applicationId))).limit(1); return row; }
  async findCommand(tenantId: string, idempotencyKey: string): Promise<DecisionRecord | undefined> { const [row] = await this.db.select().from(applicationDecisionHistory).where(and(eq(applicationDecisionHistory.tenantId, tenantId), eq(applicationDecisionHistory.idempotencyKey, idempotencyKey))).limit(1); return row ? { applicationId: row.applicationId, tenantId: row.tenantId, stage: row.stage, from: row.fromDecision, to: row.toDecision as "hired" | "rejected", actorId: row.actorId, correlationId: row.correlationId, idempotencyKey: row.idempotencyKey, occurredAt: row.occurredAt } : undefined; }
  async commit(record: DecisionRecord) { await this.db.transaction(async (tx) => {
    await tx.update(applications).set({ decision: record.to }).where(and(eq(applications.id, record.applicationId), eq(applications.tenantId, record.tenantId), eq(applications.decision, record.from)));
    await tx.insert(applicationDecisionHistory).values({ id: `decision:${record.tenantId}:${record.idempotencyKey}`, applicationId: record.applicationId, tenantId: record.tenantId, stage: record.stage, fromDecision: record.from, toDecision: record.to, actorId: record.actorId, correlationId: record.correlationId, idempotencyKey: record.idempotencyKey, occurredAt: record.occurredAt });
    await tx.insert(hiringOutbox).values({ eventId: `decision:${record.tenantId}:${record.idempotencyKey}`, eventType: "application.decision-recorded.v1", aggregateId: record.applicationId, tenantId: record.tenantId, correlationId: record.correlationId, payload: { resourceType: "application", resourceId: record.applicationId, decision: record.to, stage: record.stage }, occurredAt: record.occurredAt });
    await tx.insert(hiringOutbox).values({ eventId: `notification:${record.tenantId}:${record.idempotencyKey}:email:decision`, eventType: "notification.requested.v1", aggregateId: record.applicationId, tenantId: record.tenantId, correlationId: record.correlationId, payload: { resourceType: "application", resourceId: record.applicationId, channel: "email", template: "application_decision" }, occurredAt: record.occurredAt });
  }); }
}
