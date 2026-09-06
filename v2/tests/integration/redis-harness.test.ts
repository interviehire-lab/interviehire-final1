import { afterAll, beforeAll, expect, test } from "bun:test";
import { Queue, QueueEvents } from "bullmq";
import { drainQueues, redisConnection, waitForJob, workerHarness } from "@interviehire/testing";

const url = process.env.TEST_REDIS_URL;
if (!url) throw new Error("TEST_REDIS_URL is required for Redis integration tests");
const name = "v2-foundation-real-redis";
const connection = redisConnection(url);
const queue = new Queue(name, { connection });
const events = new QueueEvents(name, { connection });
const worker = workerHarness(name, url, async (job) => ({ processedId: job.data.resourceId }));

beforeAll(async () => {
  await Promise.all([queue.waitUntilReady(), events.waitUntilReady(), worker.waitUntilReady()]);
  await drainQueues(queue);
});
afterAll(async () => { await Promise.all([worker.close(), events.close(), queue.close()]); });

test("the worker harness processes through real Redis", async () => {
  const job = await queue.add("foundation.smoke", { resourceId: "app_001" }, { removeOnComplete: true });
  expect(await waitForJob(job, events)).toEqual({ processedId: "app_001" });
});
