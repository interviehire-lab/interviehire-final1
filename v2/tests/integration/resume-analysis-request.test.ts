import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { count, eq } from "drizzle-orm";
import { createResumeAnalysisService } from "@interviehire/domain-hiring";
import {
  applications,
  applicationInterviewRefs,
  applicationStageHistory,
  connectHiringDatabase,
  DrizzleResumeAnalysisRepository,
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
  await connection.db.delete(applicationInterviewRefs);
  await connection.db.delete(applicationStageHistory);
  await connection.db.delete(hiringOutbox);
  await connection.db.delete(applications);
  await connection.db.insert(applications).values({ id: "app_resume", tenantId: "org_001" });
});
afterAll(() => connection.client.end());

function service(id = "resume_run_001") {
  return createResumeAnalysisService(new DrizzleResumeAnalysisRepository(connection.db), {
    newId: () => id,
    now: () => "2026-09-07T06:00:00.000Z",
  });
}

describe("resume-analysis PostgreSQL request", () => {
  test("run, application status, and outbox commit together and replay once", async () => {
    const command = {
      applicationId: "app_resume", tenantId: "org_001", correlationId: "corr_resume",
      idempotencyKey: "resume_app_revision_1", resumeRevision: 1,
    };
    expect(await service().request(command)).toMatchObject({ status: "queued", replayed: false });
    expect(await service("should_not_be_used").request(command)).toMatchObject({ asyncJobId: "resume_run_001", replayed: true });
    const [runCount] = await connection.db.select({ value: count() }).from(resumeAnalysisRuns);
    const [eventCount] = await connection.db.select({ value: count() }).from(hiringOutbox);
    const [application] = await connection.db.select().from(applications).where(eq(applications.id, "app_resume"));
    expect(runCount?.value).toBe(1);
    expect(eventCount?.value).toBe(1);
    expect(application?.asyncStatus).toBe("queued");
  });

  test("outbox failure rolls back the already-created run and application status", async () => {
    await connection.db.delete(resumeAnalysisRuns);
    await connection.db.delete(hiringOutbox);
    await connection.db.update(applications).set({ asyncStatus: "not_requested" }).where(eq(applications.id, "app_resume"));
    await connection.client.unsafe(`
      CREATE OR REPLACE FUNCTION v2_reject_outbox() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'test outbox failure'; END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER v2_reject_outbox_trigger BEFORE INSERT ON v2_hiring_outbox
      FOR EACH ROW EXECUTE FUNCTION v2_reject_outbox();
    `);
    try {
      await expect(service("resume_run_rollback").request({
        applicationId: "app_resume", tenantId: "org_001", correlationId: "corr_rollback",
        idempotencyKey: "resume_rollback", resumeRevision: 2,
      })).rejects.toThrow("Failed query");
    } finally {
      await connection.client.unsafe("DROP TRIGGER IF EXISTS v2_reject_outbox_trigger ON v2_hiring_outbox; DROP FUNCTION IF EXISTS v2_reject_outbox();");
    }
    expect((await connection.db.select().from(resumeAnalysisRuns))).toHaveLength(0);
    const [application] = await connection.db.select().from(applications).where(eq(applications.id, "app_resume"));
    expect(application?.asyncStatus).toBe("not_requested");
  });
});
