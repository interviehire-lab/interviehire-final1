import { afterAll, beforeAll, expect, test } from "bun:test";
import { Queue, QueueEvents, Worker } from "bullmq";
import { eq } from "drizzle-orm";
import { createBullMqInterviewProcessor, createInterviewEvaluationProcessor } from "@interviehire/worker";
import { connectInterviewDatabase, DrizzleEvaluationStore, interviewEvaluations, interviewOutbox, interviewSessions, interviewTurns, migrateInterviewDatabase } from "@interviehire/db-interview";
import { redisConnection } from "@interviehire/queue";

const databaseUrl = process.env.TEST_DATABASE_URL; const redisUrl = process.env.TEST_REDIS_URL;
if (!databaseUrl || !redisUrl) throw new Error("TEST_DATABASE_URL and TEST_REDIS_URL are required");
const connection = connectInterviewDatabase(databaseUrl); const queueName = "v2-interview-evaluation-test"; const queue = new Queue(queueName, { connection: redisConnection(redisUrl) }); const events = new QueueEvents(queueName, { connection: redisConnection(redisUrl) });
beforeAll(async () => {
  await migrateInterviewDatabase(databaseUrl); await connection.db.delete(interviewEvaluations); await connection.db.delete(interviewOutbox); await connection.db.delete(interviewTurns); await connection.db.delete(interviewSessions); await queue.obliterate({ force: true }); await events.waitUntilReady();
  await connection.db.insert(interviewSessions).values({ id: "session_eval", tenantId: "org_001", applicationId: "app_eval", interviewStage: "recruiter_screening", status: "completed", scheduledAt: "2026-09-07T08:00:00.000Z", timeZone: "UTC", hardLimitSeconds: 300, correlationId: "corr_eval", idempotencyKey: "schedule_eval", createdAt: "2026-09-07T07:00:00.000Z", completedAt: "2026-09-07T08:05:00.000Z", transcript: [{ speaker: "candidate", text: "I use TypeScript." }] });
});
afterAll(async () => { await Promise.all([connection.client.end(), events.close(), queue.close()]); });

test("BullMQ retry preserves the first evaluator and merges both after restart-safe retry", async () => {
  let holisticCalls = 0; let structuredCalls = 0;
  const processor = createInterviewEvaluationProcessor(new DrizzleEvaluationStore(connection.db), { evaluate: async () => { holisticCalls++; return { overallScore: 84, summary: "Strong evidence" }; } }, { evaluate: async () => { structuredCalls++; if (structuredCalls === 1) throw new Error("temporary provider failure"); return { rubricScore: 81, recommendation: "advance" }; } }, () => "2026-09-07T08:06:00.000Z");
  const worker = new Worker(queueName, createBullMqInterviewProcessor(processor), { connection: redisConnection(redisUrl) });
  try {
    const job = await queue.add("interview.completed.v1", { jobId: "evt_eval", tenantId: "org_001", correlationId: "corr_eval", idempotencyKey: "evt_eval", resourceRef: { type: "interview_session", id: "session_eval" }, requestedAt: "2026-09-07T08:05:00.000Z", version: 1 }, { attempts: 2, backoff: { type: "fixed", delay: 10 } });
    await job.waitUntilFinished(events, 5000);
  } finally { await worker.close(); }
  const [session] = await connection.db.select().from(interviewSessions).where(eq(interviewSessions.id, "session_eval"));
  const runs = await connection.db.select().from(interviewEvaluations);
  expect(session?.status).toBe("evaluated"); expect(session?.evaluation).toMatchObject({ holistic: { overallScore: 84 }, structured: { rubricScore: 81 } });
  expect(runs.map((row) => [row.evaluator, row.status, row.attempt]).sort()).toEqual([["holistic", "ready", 1], ["structured", "ready", 2]]);
  expect({ holisticCalls, structuredCalls }).toEqual({ holisticCalls: 1, structuredCalls: 2 });
});
