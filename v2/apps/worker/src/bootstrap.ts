import { Worker, type Processor } from "bullmq";
import type { JobEnvelopeV1 } from "@interviehire/contracts";
import {
  dispatchOutbox,
  redisConnection,
  type OutboxPublisher,
  type OutboxStore,
  type QueueName,
} from "@interviehire/queue";

export type WorkerGroup = "all" | "ai" | "notifications" | "automations";
export type StructuredLog = Readonly<Record<string, unknown>>;

export interface OutboxPumpOptions {
  readonly stores: readonly OutboxStore[];
  readonly publisher: OutboxPublisher;
  readonly now?: () => string;
  readonly log?: (entry: StructuredLog) => void;
}

export function createOutboxPump(options: OutboxPumpOptions) {
  const now = options.now ?? (() => new Date().toISOString());
  const log = options.log ?? ((entry) => console.log(JSON.stringify(entry)));
  let active = false;
  return {
    async tick(): Promise<{ published: number }> {
      if (active) return { published: 0 };
      active = true;
      try {
        let published = 0;
        for (const store of options.stores) {
          published += (await dispatchOutbox(store, options.publisher, now)).published;
        }
        if (published > 0) log({ service: "v2-worker", event: "outbox.dispatched", published });
        return { published };
      } finally {
        active = false;
      }
    },
  };
}

export interface WorkerRuntimeOptions extends OutboxPumpOptions {
  readonly redisUrl: string;
  readonly group?: WorkerGroup;
  readonly pollIntervalMs?: number;
  readonly processors: Partial<Record<QueueName, Processor<JobEnvelopeV1>>>;
}

export async function startWorkerRuntime(options: WorkerRuntimeOptions) {
  const group = options.group ?? "all";
  const log = options.log ?? ((entry) => console.log(JSON.stringify(entry)));
  const connection = redisConnection(options.redisUrl);
  const enabled = (queue: QueueName) => group === "all"
    || (group === "ai" && queue.startsWith("ai."))
    || group === queue;
  const workers = Object.entries(options.processors)
    .filter(([queue, processor]) => Boolean(processor) && enabled(queue as QueueName))
    .map(([queue, processor]) => {
      const worker = new Worker<JobEnvelopeV1>(queue, processor!, { connection, concurrency: 4 });
      worker.on("completed", (job) => log({
        service: "v2-worker", event: "job.completed", status: "completed", queue,
        jobName: job.name, jobId: job.id, attempt: job.attemptsMade,
        tenantId: job.data.tenantId, correlationId: job.data.correlationId,
        resourceType: job.data.resourceRef.type, resourceId: job.data.resourceRef.id,
        durationMs: job.finishedOn && job.processedOn ? job.finishedOn - job.processedOn : undefined,
      }));
      worker.on("failed", (job, error) => log({
        service: "v2-worker", event: "job.failed", status: "failed", queue,
        jobName: job?.name, jobId: job?.id, attempt: job?.attemptsMade,
        tenantId: job?.data.tenantId, correlationId: job?.data.correlationId,
        resourceType: job?.data.resourceRef.type, resourceId: job?.data.resourceRef.id,
        durationMs: job?.processedOn ? Date.now() - job.processedOn : undefined,
        errorClass: error.name,
      }));
      return worker;
    });
  const pump = createOutboxPump(options);
  await pump.tick();
  const timer = setInterval(() => {
    void pump.tick().catch((error) => log({
      service: "v2-worker", event: "outbox.failed",
      errorClass: error instanceof Error ? error.name : "UnknownError",
    }));
  }, options.pollIntervalMs ?? 500);
  log({ service: "v2-worker", event: "runtime.started", group, workerCount: workers.length });
  return {
    tick: pump.tick,
    async close() {
      clearInterval(timer);
      await Promise.all(workers.map((worker) => worker.close()));
      log({ service: "v2-worker", event: "runtime.stopped", group });
    },
  };
}
