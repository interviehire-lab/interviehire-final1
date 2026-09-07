import { expect, test } from "bun:test";
import type { JobEnvelopeV1 } from "@interviehire/contracts";
import { createBullMqNotificationProcessor, createNotificationProcessor, PermanentNotificationError, type NotificationDeliveryStore } from "./processor";
const envelope: JobEnvelopeV1 = { jobId: "notify:email:schedule_1", tenantId: "org_1", correlationId: "corr", idempotencyKey: "notify:email:schedule_1", resourceRef: { type: "application", id: "app_1" }, requestedAt: "2026-09-07T10:00:00.000Z", version: 1, payload: { eventType: "notification.requested.v1", channel: "email", template: "interview_scheduled" } };
test("notification loads PII after dequeue and delivers once", async () => {
  let state = "pending"; let sends = 0;
  const store: NotificationDeliveryStore = { claim: async () => state === "sent" ? { kind: "sent" } : { kind: "claimed" }, complete: async () => { state = "sent"; }, fail: async () => { state = "failed"; } };
  const processor = createNotificationProcessor(store, { load: async () => ({ name: "Asha", email: "asha@example.test", phone: "+910000000000" }) }, { send: async (message) => { sends++; expect(message.recipient.email).toBe("asha@example.test"); return { providerMessageId: "provider_1" }; } }, () => "2026-09-07T10:01:00.000Z");
  expect(await processor(envelope)).toEqual({ replayed: false, deliveryId: envelope.jobId });
  expect(await processor(envelope)).toEqual({ replayed: true, deliveryId: envelope.jobId }); expect(sends).toBe(1);
});
test("notification queue envelope contains no recipient PII", () => { expect(JSON.stringify(envelope)).not.toContain("asha@"); expect(JSON.stringify(envelope)).not.toContain("+91"); });

test("invalid recipient is permanent and never calls the provider", async () => {
  let sends = 0;
  const store: NotificationDeliveryStore = { claim: async () => ({ kind: "claimed" }), complete: async () => undefined, fail: async () => undefined };
  const processor = createNotificationProcessor(store, { load: async () => ({ name: "Asha", email: null, phone: null }) }, { send: async () => { sends++; return { providerMessageId: "unused" }; } }, () => "2026-09-07T10:01:00.000Z");
  await expect(processor(envelope)).rejects.toBeInstanceOf(PermanentNotificationError);
  expect(sends).toBe(0);
});

test("provider receives a stable idempotency key so retry after acknowledgement loss is safe", async () => {
  let effects = 0; let completions = 0; const accepted = new Set<string>();
  const store: NotificationDeliveryStore = {
    claim: async () => ({ kind: "claimed" }),
    complete: async () => { completions++; if (completions === 1) throw new Error("database unavailable after provider acknowledgement"); },
    fail: async () => undefined,
  };
  const processor = createNotificationProcessor(store, { load: async () => ({ name: "Asha", email: "asha@example.test", phone: null }) }, {
    send: async (message) => { if (!accepted.has(message.idempotencyKey)) { accepted.add(message.idempotencyKey); effects++; } return { providerMessageId: "provider_1" }; },
  }, () => "2026-09-07T10:01:00.000Z");
  await expect(processor(envelope)).rejects.toThrow("database unavailable");
  await expect(processor(envelope)).resolves.toMatchObject({ replayed: false });
  expect(effects).toBe(1);
});

test("BullMQ adapter stops retries for permanent notification failures", async () => {
  const adapter = createBullMqNotificationProcessor(async () => { throw new PermanentNotificationError("invalid email"); });
  await expect(adapter({ data: envelope } as never)).rejects.toMatchObject({ name: "UnrecoverableError" });
});
