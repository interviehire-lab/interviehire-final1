import { afterAll, beforeAll, expect, test } from "bun:test";
import { count, eq } from "drizzle-orm";
import { createSessionProvisioningService } from "@interviehire/domain-interview";
import { connectInterviewDatabase, DrizzleSessionRepository, interviewSessions, migrateInterviewDatabase } from "@interviehire/db-interview";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL is required");
const connection = connectInterviewDatabase(url);

beforeAll(async () => { await migrateInterviewDatabase(url); await connection.db.delete(interviewSessions); });
afterAll(() => connection.client.end());

test("session provisioning is durable, tenant-scoped, and idempotent", async () => {
  let sequence = 0;
  const service = createSessionProvisioningService(new DrizzleSessionRepository(connection.db), () => `session_${++sequence}`, () => "2026-09-07T08:00:00.000Z");
  const command = { applicationId: "app_001", tenantId: "org_001", interviewStage: "recruiter_screening" as const, scheduledAt: "2026-09-08T09:00:00.000Z", timeZone: "Asia/Kolkata", correlationId: "corr_001", idempotencyKey: "schedule_001" };
  expect(await service.provision(command)).toMatchObject({ interviewSessionId: "session_1", replayed: false });
  expect(await service.provision(command)).toMatchObject({ interviewSessionId: "session_1", replayed: true });
  const [stored] = await connection.db.select().from(interviewSessions).where(eq(interviewSessions.id, "session_1"));
  const [total] = await connection.db.select({ value: count() }).from(interviewSessions);
  expect(stored).toMatchObject({ tenantId: "org_001", applicationId: "app_001", hardLimitSeconds: 300 });
  expect(total?.value).toBe(1);
});
