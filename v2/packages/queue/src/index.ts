import { Queue, type ConnectionOptions } from "bullmq";
import type { JobEnvelopeV1 } from "@interviehire/contracts";

export const QUEUE_NAMES = [
  "ai.resume", "ai.interview", "ai.content", "notifications", "automations", "media", "talent",
] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

export function redisConnection(url: string): ConnectionOptions {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    ...(parsed.password ? { password: parsed.password } : {}),
  };
}

export function createQueue(name: QueueName, redisUrl: string): Queue<JobEnvelopeV1> {
  return new Queue<JobEnvelopeV1>(name, { connection: redisConnection(redisUrl) });
}
