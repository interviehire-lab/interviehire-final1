import { Queue, type ConnectionOptions } from "bullmq";
import { RESOURCE_TYPES, type JobEnvelopeV1, type ResourceType } from "@interviehire/contracts";

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

export interface OutboxRecord {
  readonly eventId: string;
  readonly eventType: string;
  readonly aggregateId: string;
  readonly tenantId: string;
  readonly correlationId: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly occurredAt: string;
  readonly publishedAt: string | null;
  readonly publishAttempts: number;
}

export interface OutboxStore {
  listPending(limit: number): Promise<readonly OutboxRecord[]>;
  markPublished(eventId: string, publishedAt: string): Promise<void>;
}

export interface OutboxPublisher {
  publish(event: OutboxRecord): Promise<void>;
}

export function createBullMqPublisher(queue: Queue<JobEnvelopeV1>): OutboxPublisher {
  return {
    async publish(event) {
      const resourceType = event.payload.resourceType;
      const resourceId = event.payload.resourceId;
      if (!RESOURCE_TYPES.includes(resourceType as ResourceType) || typeof resourceId !== "string") {
        throw new Error(`Outbox event ${event.eventId} has an invalid resource reference`);
      }
      await queue.add(event.eventType, {
        jobId: event.eventId,
        tenantId: event.tenantId,
        correlationId: event.correlationId,
        idempotencyKey: event.eventId,
        resourceRef: { type: resourceType as ResourceType, id: resourceId },
        requestedAt: event.occurredAt,
        version: 1,
        payload: {
          eventType: event.eventType,
          ...Object.fromEntries(Object.entries(event.payload).filter(([key, value]) =>
            key !== "resourceType" && key !== "resourceId" && ["string", "number", "boolean"].includes(typeof value),
          )),
        },
      }, { jobId: event.eventId });
    },
  };
}

export async function dispatchOutbox(
  store: OutboxStore,
  publisher: OutboxPublisher,
  now: () => string,
  limit = 50,
): Promise<{ published: number }> {
  let published = 0;
  for (const event of await store.listPending(limit)) {
    await publisher.publish(event);
    await store.markPublished(event.eventId, now());
    published += 1;
  }
  return { published };
}
