import { afterAll, beforeAll, expect, test } from "bun:test";
import { count, eq } from "drizzle-orm";
import { createDecisionService } from "@interviehire/domain-hiring";
import { applicationDecisionHistory, applicationInterviewRefs, applicationStageHistory, applications, connectHiringDatabase, DrizzleDecisionRepository, hiringOutbox, migrateHiringDatabase, resumeAnalysisRuns } from "@interviehire/db-hiring";
const url = process.env.TEST_DATABASE_URL; if (!url) throw new Error("TEST_DATABASE_URL is required"); const connection = connectHiringDatabase(url);
beforeAll(async () => { await migrateHiringDatabase(url); await connection.db.delete(resumeAnalysisRuns); await connection.db.delete(applicationInterviewRefs); await connection.db.delete(applicationDecisionHistory); await connection.db.delete(applicationStageHistory); await connection.db.delete(hiringOutbox); await connection.db.delete(applications); await connection.db.insert(applications).values({ id: "app_decide", tenantId: "org_1", stage: "functional_interview" }); });
afterAll(() => connection.client.end());
test("decision, audit, and outbox commit once without moving stage", async () => {
  const service = createDecisionService(new DrizzleDecisionRepository(connection.db), () => "2026-09-07T10:00:00.000Z"); const command = { tenantId: "org_1", applicationId: "app_decide", decision: "hired" as const, actorId: "recruiter_1", correlationId: "corr", idempotencyKey: "hire_1" };
  expect(await service.decide(command)).toMatchObject({ ok: true, replayed: false }); expect(await service.decide(command)).toMatchObject({ ok: true, replayed: true });
  const [application] = await connection.db.select().from(applications).where(eq(applications.id, "app_decide")); const [audits] = await connection.db.select({ value: count() }).from(applicationDecisionHistory); const [events] = await connection.db.select({ value: count() }).from(hiringOutbox);
  expect(application).toMatchObject({ stage: "functional_interview", decision: "hired" }); expect(audits?.value).toBe(1); expect(events?.value).toBe(1);
});
