import { expect, test } from "bun:test";
import type { OutboxPublisher, OutboxStore } from "@interviehire/queue";
import { createOutboxPump } from "./bootstrap";

test("outbox pump publishes both source-domain stores and reports counts", async () => {
  const marked: string[] = [];
  const store = (eventId: string): OutboxStore => ({
    listPending: async () => [{
      eventId,
      eventType: "resume-analysis.requested.v1",
      aggregateId: "app_1",
      tenantId: "tenant_1",
      correlationId: "corr_1",
      payload: { resourceType: "application", resourceId: "app_1" },
      occurredAt: "2026-09-07T00:00:00.000Z",
      publishedAt: null,
      publishAttempts: 0,
    }],
    markPublished: async (id) => { marked.push(id); },
  });
  const published: string[] = [];
  const publisher: OutboxPublisher = { publish: async (event) => { published.push(event.eventId); } };
  const logs: Record<string, unknown>[] = [];
  const pump = createOutboxPump({
    stores: [store("hiring_1"), store("interview_1")],
    publisher,
    now: () => "2026-09-07T00:01:00.000Z",
    log: (entry) => { logs.push(entry); },
  });

  expect(await pump.tick()).toEqual({ published: 2 });
  expect(published).toEqual(["hiring_1", "interview_1"]);
  expect(marked).toEqual(["hiring_1", "interview_1"]);
  expect(logs.at(-1)).toMatchObject({ event: "outbox.dispatched", published: 2 });
});
