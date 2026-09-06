import { afterAll, beforeAll, expect, test } from "bun:test";
import { Queue } from "bullmq";
import {
  connectHiringDatabase,
  DrizzleHiringOutboxStore,
  hiringOutbox,
  migrateHiringDatabase,
} from "@interviehire/db-hiring";
import { createBullMqPublisher, dispatchOutbox, redisConnection } from "@interviehire/queue";

const databaseUrl = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;
if (!databaseUrl || !redisUrl) throw new Error("TEST_DATABASE_URL and TEST_REDIS_URL are required");
const connection = connectHiringDatabase(databaseUrl);
const queue = new Queue("v2-outbox-real-redis", { connection: redisConnection(redisUrl) });

beforeAll(async () => {
  await migrateHiringDatabase(databaseUrl);
  await connection.db.delete(hiringOutbox);
  await queue.obliterate({ force: true });
});
afterAll(async () => { await Promise.all([connection.client.end(), queue.close()]); });

test("dispatcher publishes then marks the source-domain event", async () => {
  await connection.db.insert(hiringOutbox).values({
    eventId: "evt_dispatch_001", eventType: "application.stage_changed.v1",
    aggregateId: "app_001", tenantId: "org_001", correlationId: "corr_dispatch",
    payload: { resourceType: "application", resourceId: "app_001" },
    occurredAt: "2026-09-07T05:00:00.000Z",
  });
  const result = await dispatchOutbox(
    new DrizzleHiringOutboxStore(connection.db),
    createBullMqPublisher(queue),
    () => "2026-09-07T05:01:00.000Z",
  );
  expect(result).toEqual({ published: 1 });
  expect(await queue.getJob("evt_dispatch_001")).not.toBeUndefined();
  const [row] = await connection.db.select().from(hiringOutbox);
  expect(new Date(row?.publishedAt ?? "").toISOString()).toBe("2026-09-07T05:01:00.000Z");
});

test("crash after enqueue leaves replay pending and stable BullMQ ID prevents a second job", async () => {
  await connection.db.delete(hiringOutbox);
  await queue.obliterate({ force: true });
  await connection.db.insert(hiringOutbox).values({
    eventId: "evt_replay_001", eventType: "application.stage_changed.v1",
    aggregateId: "app_001", tenantId: "org_001", correlationId: "corr_replay",
    payload: { resourceType: "application", resourceId: "app_001" },
    occurredAt: "2026-09-07T05:02:00.000Z",
  });
  const store = new DrizzleHiringOutboxStore(connection.db);
  await expect(dispatchOutbox({
    listPending: (limit) => store.listPending(limit),
    markPublished: async () => { throw new Error("simulated dispatcher crash"); },
  }, createBullMqPublisher(queue), () => "2026-09-07T05:03:00.000Z")).rejects.toThrow("simulated dispatcher crash");
  expect((await queue.getJobs()).map((job) => job.id)).toEqual(["evt_replay_001"]);
  expect((await connection.db.select().from(hiringOutbox))[0]?.publishedAt).toBeNull();

  expect(await dispatchOutbox(store, createBullMqPublisher(queue), () => "2026-09-07T05:04:00.000Z"))
    .toEqual({ published: 1 });
  expect((await queue.getJobs()).map((job) => job.id)).toEqual(["evt_replay_001"]);
});
