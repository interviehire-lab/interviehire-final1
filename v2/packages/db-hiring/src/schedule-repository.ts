import { and, eq } from "drizzle-orm";
import type {
  ScheduleRepository,
  ScheduledInterview,
  SchedulingApplication,
} from "@interviehire/domain-hiring";
import type { HiringDatabase } from "./database";
import {
  applicationInterviewRefs,
  applications,
  applicationStageHistory,
  hiringOutbox,
} from "./schema";

export class DrizzleScheduleRepository implements ScheduleRepository {
  constructor(private readonly db: HiringDatabase) {}

  async findApplication(tenantId: string, applicationId: string): Promise<SchedulingApplication | undefined> {
    const [row] = await this.db.select().from(applications).where(and(
      eq(applications.tenantId, tenantId), eq(applications.id, applicationId),
    )).limit(1);
    return row;
  }

  async findByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<ScheduledInterview | undefined> {
    const [row] = await this.db.select().from(applicationInterviewRefs).where(and(
      eq(applicationInterviewRefs.tenantId, tenantId),
      eq(applicationInterviewRefs.idempotencyKey, idempotencyKey),
    )).limit(1);
    if (!row?.tenantId || !row.scheduledAt || !row.timeZone || !row.deliveryMethods
      || !row.correlationId || !row.idempotencyKey || !row.actorId) return undefined;
    return {
      applicationId: row.applicationId,
      tenantId: row.tenantId,
      interviewSessionId: row.interviewSessionId,
      interviewStage: row.stage,
      scheduledAt: row.scheduledAt,
      timeZone: row.timeZone,
      deliveryMethods: row.deliveryMethods,
      fromStage: row.stage,
      toStage: row.stage,
      correlationId: row.correlationId,
      idempotencyKey: row.idempotencyKey,
      actorId: row.actorId,
      createdAt: row.createdAt,
    };
  }

  async commitSchedule(schedule: ScheduledInterview): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.insert(applicationInterviewRefs).values({
        applicationId: schedule.applicationId,
        tenantId: schedule.tenantId,
        interviewSessionId: schedule.interviewSessionId,
        stage: schedule.interviewStage,
        scheduledAt: schedule.scheduledAt,
        timeZone: schedule.timeZone,
        deliveryMethods: schedule.deliveryMethods,
        correlationId: schedule.correlationId,
        idempotencyKey: schedule.idempotencyKey,
        actorId: schedule.actorId,
        createdAt: schedule.createdAt,
      });
      await tx.update(applications).set({ stage: schedule.toStage }).where(and(
        eq(applications.id, schedule.applicationId), eq(applications.tenantId, schedule.tenantId),
      ));
      await tx.insert(hiringOutbox).values({
        eventId: `evt_${schedule.tenantId}_${schedule.idempotencyKey}`,
        eventType: "application.stage_changed.v1",
        aggregateId: schedule.applicationId,
        tenantId: schedule.tenantId,
        correlationId: schedule.correlationId,
        occurredAt: schedule.createdAt,
        payload: {
          resourceType: "application", resourceId: schedule.applicationId,
          from: schedule.fromStage, to: schedule.toStage,
        },
      });
      const reminderAt = new Date(Date.parse(schedule.scheduledAt) - 30 * 60 * 1000).toISOString();
      for (const channel of schedule.deliveryMethods) {
        await tx.insert(hiringOutbox).values([
          { eventId: `notification:${schedule.tenantId}:${schedule.idempotencyKey}:${channel}:confirmation`, eventType: "notification.requested.v1", aggregateId: schedule.applicationId, tenantId: schedule.tenantId, correlationId: schedule.correlationId, occurredAt: schedule.createdAt, payload: { resourceType: "application", resourceId: schedule.applicationId, channel, template: "interview_scheduled" } },
          { eventId: `notification:${schedule.tenantId}:${schedule.idempotencyKey}:${channel}:reminder`, eventType: "notification.requested.v1", aggregateId: schedule.applicationId, tenantId: schedule.tenantId, correlationId: schedule.correlationId, occurredAt: schedule.createdAt, payload: { resourceType: "application", resourceId: schedule.applicationId, channel, template: "interview_reminder", deliverAt: reminderAt } },
        ]);
      }
      await tx.insert(applicationStageHistory).values({
        id: `schedule-history:${schedule.tenantId}:${schedule.idempotencyKey}`,
        applicationId: schedule.applicationId,
        tenantId: schedule.tenantId,
        fromStage: schedule.fromStage,
        toStage: schedule.toStage,
        actorId: schedule.actorId,
        correlationId: schedule.correlationId,
        idempotencyKey: schedule.idempotencyKey,
        occurredAt: schedule.createdAt,
      });
    });
  }
}
