import { afterAll, beforeAll, expect, test } from "bun:test";
import { Queue, QueueEvents, Worker } from "bullmq";
import { eq } from "drizzle-orm";
import type { JobEnvelopeV1 } from "@interviehire/contracts";
import { createResumeAnalysisService } from "@interviehire/domain-hiring";
import {
  applications,
  applicationDecisionHistory,
  applicationInterviewRefs,
  applicationStageHistory,
  connectHiringDatabase,
  DrizzleHiringOutboxStore,
  DrizzleResumeAnalysisRepository,
  DrizzleResumeAnalysisWorkerStore,
  hiringOutbox,
  migrateHiringDatabase,
  resumeAnalysisRuns,
} from "@interviehire/db-hiring";
import { createBullMqPublisher, dispatchOutbox, redisConnection } from "@interviehire/queue";
import { createBullMqResumeProcessor, createResumeAnalysisProcessor, TransientProviderError } from "@interviehire/worker";

const databaseUrl = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;
if (!databaseUrl || !redisUrl) throw new Error("TEST_DATABASE_URL and TEST_REDIS_URL are required");
const connection = connectHiringDatabase(databaseUrl);
const redis = redisConnection(redisUrl);
const queueName = "ai.resume.v2-integration";
const queue = new Queue<JobEnvelopeV1>(queueName, { connection: redis });
const events = new QueueEvents(queueName, { connection: redis });

beforeAll(async () => {
  await migrateHiringDatabase(databaseUrl);
  await connection.db.delete(resumeAnalysisRuns);
  await connection.db.delete(applicationDecisionHistory);
  await connection.db.delete(applicationInterviewRefs);
  await connection.db.delete(applicationStageHistory);
  await connection.db.delete(hiringOutbox);
  await connection.db.delete(applications);
  await queue.obliterate({ force: true });
  await events.waitUntilReady();
});
afterAll(async () => { await Promise.all([connection.client.end(), events.close(), queue.close()]); });

test("real BullMQ worker persists READY once and replays duplicate delivery", async () => {
  await connection.db.insert(applications).values({
    id: "app_worker", tenantId: "org_001", resumeText: "Senior TypeScript engineer with Postgres experience.",
  });
  const resumeRepository = new DrizzleResumeAnalysisRepository(connection.db);
  await createResumeAnalysisService(resumeRepository, {
    newId: () => "resume_run_worker", now: () => "2026-09-07T07:00:00.000Z",
  }).request({
    applicationId: "app_worker", tenantId: "org_001", correlationId: "corr_worker",
    idempotencyKey: "resume_worker_1", resumeRevision: 1,
  });
  await dispatchOutbox(new DrizzleHiringOutboxStore(connection.db), createBullMqPublisher(queue), () => "2026-09-07T07:00:01.000Z");

  let providerCalls = 0;
  const processor = createResumeAnalysisProcessor(new DrizzleResumeAnalysisWorkerStore(connection.db), {
    analyseResume: async () => { providerCalls += 1; return { score: 91, recommendation: "advance" }; },
  }, () => "2026-09-07T07:01:00.000Z");
  const worker = new Worker<JobEnvelopeV1>(queueName, createBullMqResumeProcessor(processor), { connection: redis });
  await worker.waitUntilReady();
  const first = await queue.getJob("evt_org_001_resume_worker_1");
  expect(first).not.toBeUndefined();
  expect(first?.data.payload).toMatchObject({ runId: "resume_run_worker" });
  await first?.waitUntilFinished(events, 5_000);

  const duplicate = await queue.add("resume-analysis.requested.v1", {
    ...first!.data, jobId: "duplicate_delivery_1",
  }, { jobId: "duplicate_delivery_1" });
  expect(await duplicate.waitUntilFinished(events, 5_000)).toMatchObject({ replayed: true });
  await worker.close();

  const [run] = await connection.db.select().from(resumeAnalysisRuns).where(eq(resumeAnalysisRuns.id, "resume_run_worker"));
  const [application] = await connection.db.select().from(applications).where(eq(applications.id, "app_worker"));
  expect(run).toMatchObject({ status: "ready", attempt: 1, result: { score: 91, recommendation: "advance" } });
  expect(application?.asyncStatus).toBe("ready");
  expect(application?.resumeAnalysisComplete).toBe(true);
  expect(providerCalls).toBe(1);
  const afterRestart = await createResumeAnalysisService(
    new DrizzleResumeAnalysisRepository(connection.db),
    { newId: () => "unused", now: () => "2026-09-07T07:02:00.000Z" },
  ).findJob("org_001", "resume_run_worker");
  expect(afterRestart).toMatchObject({ status: "ready", result: { score: 91 } });
});

test("transient provider failure retries and then succeeds", async () => {
  await connection.db.insert(applications).values({
    id: "app_retry", tenantId: "org_001", resumeText: "Backend engineer.",
  });
  await createResumeAnalysisService(new DrizzleResumeAnalysisRepository(connection.db), {
    newId: () => "resume_run_retry", now: () => "2026-09-07T07:10:00.000Z",
  }).request({
    applicationId: "app_retry", tenantId: "org_001", correlationId: "corr_retry",
    idempotencyKey: "resume_retry_1", resumeRevision: 1,
  });
  const envelope: JobEnvelopeV1 = {
    jobId: "retry_job_1", tenantId: "org_001", correlationId: "corr_retry",
    idempotencyKey: "resume_retry_1", resourceRef: { type: "application", id: "app_retry" },
    requestedAt: "2026-09-07T07:10:00.000Z", version: 1,
    payload: { eventType: "resume-analysis.requested.v1", runId: "resume_run_retry" },
  };
  let calls = 0;
  const processor = createResumeAnalysisProcessor(new DrizzleResumeAnalysisWorkerStore(connection.db), {
    analyseResume: async () => {
      calls += 1;
      if (calls === 1) throw new TransientProviderError("temporary rate limit");
      return { score: 78 };
    },
  }, () => "2026-09-07T07:11:00.000Z");
  const worker = new Worker<JobEnvelopeV1>(queueName, createBullMqResumeProcessor(processor), { connection: redis });
  await worker.waitUntilReady();
  const job = await queue.add("resume-analysis.requested.v1", envelope, {
    jobId: "retry_job_1", attempts: 2, backoff: { type: "fixed", delay: 10 },
  });
  await job.waitUntilFinished(events, 5_000);
  await worker.close();
  const [run] = await connection.db.select().from(resumeAnalysisRuns).where(eq(resumeAnalysisRuns.id, "resume_run_retry"));
  expect(run).toMatchObject({ status: "ready", attempt: 2, result: { score: 78 } });
  expect(calls).toBe(2);
});
