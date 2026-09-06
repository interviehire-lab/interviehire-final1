import { afterAll, beforeAll, expect, test } from "bun:test";
import { count, eq } from "drizzle-orm";
import { createVoiceService } from "@interviehire/domain-interview";
import { connectInterviewDatabase, DrizzleVoiceRepository, interviewOutbox, interviewSessions, interviewTurns, migrateInterviewDatabase } from "@interviehire/db-interview";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL is required");
const connection = connectInterviewDatabase(url);
beforeAll(async () => {
  await migrateInterviewDatabase(url);
  await connection.db.delete(interviewOutbox); await connection.db.delete(interviewTurns); await connection.db.delete(interviewSessions);
  await connection.db.insert(interviewSessions).values({ id: "session_voice", tenantId: "org_001", applicationId: "app_voice", interviewStage: "functional_interview", status: "scheduled", scheduledAt: "2026-09-07T08:00:00.000Z", timeZone: "UTC", hardLimitSeconds: 1500, correlationId: "corr_voice", idempotencyKey: "schedule_voice", createdAt: "2026-09-07T07:00:00.000Z", candidateName: "Asha", roleTitle: "Engineer", initialQuestion: "Introduce yourself.", resumePresent: true });
});
afterAll(() => connection.client.end());

test("start, duplicate turn, and completion survive service recreation with one event", async () => {
  let calls = 0;
  const director = { respond: async () => { calls++; return { text: "Tell me more.", interviewPhase: "follow_up" as const, emotionState: "curious" as const, shouldEnd: false }; } };
  const first = createVoiceService(new DrizzleVoiceRepository(connection.db), director, () => "2026-09-07T08:01:00.000Z");
  expect(await first.start("session_voice", {})).toMatchObject({ ok: true, hardLimitSeconds: 1500 });
  expect(await first.turn("session_voice", { text: "Answer", turnId: "turn_1", metrics: {} })).toMatchObject({ ok: true, replayed: false });
  const restarted = createVoiceService(new DrizzleVoiceRepository(connection.db), director, () => "2026-09-07T08:02:00.000Z");
  expect(await restarted.turn("session_voice", { text: "Answer", turnId: "turn_1", metrics: {} })).toMatchObject({ ok: true, replayed: true });
  expect(calls).toBe(1);
  expect(await restarted.complete("session_voice", "candidate_ended")).toMatchObject({ ok: true, replayed: false });
  expect(await restarted.complete("session_voice", "candidate_ended")).toMatchObject({ ok: true, replayed: true });
  const [session] = await connection.db.select().from(interviewSessions).where(eq(interviewSessions.id, "session_voice"));
  const [events] = await connection.db.select({ value: count() }).from(interviewOutbox);
  expect(session?.status).toBe("completed"); expect(events?.value).toBe(1);
});
