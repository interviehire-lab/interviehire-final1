import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { count, eq } from "drizzle-orm";
import { createApplicationService } from "@interviehire/domain-hiring";
import {
  applicationInterviewRefs,
  applications,
  applicationStageHistory,
  connectHiringDatabase,
  DrizzleApplicationRepository,
  migrateHiringDatabase,
} from "@interviehire/db-hiring";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL is required for PostgreSQL integration tests");
const connection = connectHiringDatabase(url);

beforeAll(async () => {
  await migrateHiringDatabase(url);
  await connection.db.delete(applicationInterviewRefs);
  await connection.db.delete(applicationStageHistory);
  await connection.db.delete(applications);
});
afterAll(() => connection.client.end());

async function seed() {
  await connection.db.insert(applications).values({
    id: "app_001", tenantId: "org_001", stage: "resume_analysis", decision: "active",
    resumeAnalysisComplete: true, screeningComplete: false,
  }).onConflictDoNothing();
}

describe("hiring PostgreSQL semantics", () => {
  test("stage and history commit atomically and duplicate commands replay", async () => {
    await seed();
    const service = createApplicationService(new DrizzleApplicationRepository(connection.db));
    const command = {
      applicationId: "app_001", tenantId: "org_001", to: "recruiter_screening" as const,
      actorId: "recruiter_1", correlationId: "corr_1", idempotencyKey: "cmd_1",
      occurredAt: "2026-09-07T04:00:00.000Z",
    };
    expect(await service.transition(command)).toMatchObject({ ok: true });
    expect(await service.transition(command)).toMatchObject({ ok: true, replayed: true });
    const [application] = await connection.db.select().from(applications).where(eq(applications.id, "app_001"));
    const [historyCount] = await connection.db.select({ value: count() }).from(applicationStageHistory);
    expect(application?.stage).toBe("recruiter_screening");
    expect(historyCount?.value).toBe(1);
  });

  test("a rejected history insert rolls back the stage update", async () => {
    await connection.db.delete(applicationStageHistory);
    await connection.db.update(applications).set({ stage: "resume_analysis" }).where(eq(applications.id, "app_001"));
    await connection.client.unsafe(`
      CREATE OR REPLACE FUNCTION v2_reject_history() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'test history failure'; END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER v2_reject_history_trigger BEFORE INSERT ON v2_application_stage_history
      FOR EACH ROW EXECUTE FUNCTION v2_reject_history();
    `);
    try {
      const service = createApplicationService(new DrizzleApplicationRepository(connection.db));
      await expect(service.transition({
        applicationId: "app_001", tenantId: "org_001", to: "recruiter_screening",
        actorId: "recruiter_1", correlationId: "corr_2", idempotencyKey: "cmd_rollback",
        occurredAt: "2026-09-07T04:01:00.000Z",
      })).rejects.toThrow("Failed query");
    } finally {
      await connection.client.unsafe("DROP TRIGGER IF EXISTS v2_reject_history_trigger ON v2_application_stage_history; DROP FUNCTION IF EXISTS v2_reject_history();");
    }
    const [application] = await connection.db.select().from(applications).where(eq(applications.id, "app_001"));
    expect(application?.stage).toBe("resume_analysis");
  });

  test("persists deliberately unequal application and interview IDs", async () => {
    await connection.db.insert(applicationInterviewRefs).values({
      applicationId: "app_001", interviewSessionId: "session_9f8d",
      stage: "recruiter_screening", createdAt: "2026-09-07T04:02:00.000Z",
    });
    const [ref] = await connection.db.select().from(applicationInterviewRefs);
    expect(ref?.applicationId).toBe("app_001");
    expect(ref?.interviewSessionId).toBe("session_9f8d");
    expect(ref?.applicationId).not.toBe(ref?.interviewSessionId);
  });
});
