import { expect, test } from "bun:test";
import type { OutboxPublisher, OutboxRecord } from "./index";
import { createRoutedOutboxPublisher, queueForEvent, queueJobIdForEvent } from "./index";

const event: OutboxRecord = {
  eventId: "evt_1",
  eventType: "resume-analysis.requested.v1",
  aggregateId: "app_1",
  tenantId: "tenant_1",
  correlationId: "corr_1",
  payload: { resourceType: "application", resourceId: "app_1" },
  occurredAt: "2026-09-07T00:00:00.000Z",
  publishedAt: null,
  publishAttempts: 0,
};

test("routes source-domain events to their owning worker queues", () => {
  expect(queueForEvent("resume-analysis.requested.v1")).toBe("ai.resume");
  expect(queueForEvent("interview.completed.v1")).toBe("ai.interview");
  expect(queueForEvent("interview.evaluated.v1")).toBe("automations");
  expect(queueForEvent("notification.requested.v1")).toBe("notifications");
  expect(queueForEvent("application.stage_changed.v1")).toBe("automations");
  expect(queueForEvent("application.decision-recorded.v1")).toBe("automations");
});

test("routed publisher delegates once to the selected queue", async () => {
  const published: string[] = [];
  const publisher = (name: string): OutboxPublisher => ({
    publish: async (value) => { published.push(`${name}:${value.eventId}`); },
  });
  const routed = createRoutedOutboxPublisher({
    "ai.resume": publisher("resume"),
    "ai.interview": publisher("interview"),
    notifications: publisher("notifications"),
    automations: publisher("automations"),
  });
  await routed.publish(event);
  expect(published).toEqual(["resume:evt_1"]);
});

test("unknown event types stay pending by failing publication", async () => {
  const routed = createRoutedOutboxPublisher({});
  await expect(routed.publish({ ...event, eventType: "unknown.v1" })).rejects.toThrow("No queue route");
});

test("encodes source event IDs into stable BullMQ-safe IDs", () => {
  expect(queueJobIdForEvent("interview.completed:session_1")).toBe("interview.completed%3Asession_1");
  expect(queueJobIdForEvent("literal%3Avalue:1")).toBe("literal%253Avalue%3A1");
});
