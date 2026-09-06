import { type Job, Queue, QueueEvents, Worker, type Processor } from "bullmq";

export function redisConnection(url: string) {
  const parsed = new URL(url);
  return { host: parsed.hostname, port: Number(parsed.port || 6379) };
}

export async function drainQueues(...queues: Queue[]): Promise<void> {
  await Promise.all(queues.map((queue) => queue.drain(true)));
}

export async function waitForJob<T>(job: Job<T>, events: QueueEvents, timeoutMs = 5_000) {
  return job.waitUntilFinished(events, timeoutMs);
}

export function workerHarness<T, R>(queueName: string, redisUrl: string, processor: Processor<T, R>) {
  return new Worker<T, R>(queueName, processor, { connection: redisConnection(redisUrl) });
}
