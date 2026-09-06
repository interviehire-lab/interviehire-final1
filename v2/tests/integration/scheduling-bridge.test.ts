import { afterAll, beforeAll, expect, test } from "bun:test";
import { count, eq } from "drizzle-orm";
import { createSchedulingService } from "@interviehire/domain-hiring";
import {
  applications,
  applicationDecisionHistory,
  applicationInterviewRefs,
  applicationStageHistory,
  connectHiringDatabase,
  DrizzleScheduleRepository,
  hiringOutbox,
  migrateHiringDatabase,
  resumeAnalysisRuns,
} from "@interviehire/db-hiring";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL is required");
const connection = connectHiringDatabase(url);

beforeAll(async () => {
  await migrateHiringDatabase(url);
  await connection.db.delete(resumeAnalysisRuns);
  await connection.db.delete(applicationDecisionHistory);
  await connection.db.delete(applicationInterviewRefs);
  await connection.db.delete(applicationStageHistory);
  await connection.db.delete(hiringOutbox);
  await connection.db.delete(applications);
  await connection.db.insert(applications).values({
    id: "app_schedule", tenantId: "org_001", stage: "resume_analysis",
    resumeAnalysisComplete: true,
  });
});
afterAll(() => connection.client.end());

test("Core-owned schedule transaction stores mapping/history without writing Interview tables", async () => {
  const service = createSchedulingService(new DrizzleScheduleRepository(connection.db), {
    provision: async () => ({ interviewSessionId: "session_9f8d" }),
  }, () => "2026-09-07T08:00:00.000Z");
  const command = {
    applicationId: "app_schedule", tenantId: "org_001", interviewStage: "recruiter_screening" as const,
    scheduledAt: "2026-09-08T09:00:00.000Z", timeZone: "Asia/Kolkata",
    deliveryMethods: ["email"] as const, correlationId: "corr_schedule",
    idempotencyKey: "schedule_001", actorId: "recruiter_001",
  };
  expect(await service.schedule(command)).toMatchObject({ interviewSessionId: "session_9f8d", replayed: false });
  expect(await service.schedule(command)).toMatchObject({ interviewSessionId: "session_9f8d", replayed: true });
  const [application] = await connection.db.select().from(applications).where(eq(applications.id, "app_schedule"));
  const [mapping] = await connection.db.select().from(applicationInterviewRefs);
  const [historyCount] = await connection.db.select({ value: count() }).from(applicationStageHistory);
  expect(application?.stage).toBe("recruiter_screening");
  expect(mapping).toMatchObject({
    applicationId: "app_schedule", interviewSessionId: "session_9f8d",
    stage: "recruiter_screening", timeZone: "Asia/Kolkata",
  });
  expect(mapping?.applicationId).not.toBe(mapping?.interviewSessionId);
  expect(historyCount?.value).toBe(1);
  const notifications = (await connection.db.select().from(hiringOutbox)).filter((row) => row.eventType === "notification.requested.v1");
  expect(notifications).toHaveLength(2);
  expect(notifications.find((row) => row.payload.template === "interview_reminder")?.payload.deliverAt).toBe("2026-09-08T08:30:00.000Z");
});
