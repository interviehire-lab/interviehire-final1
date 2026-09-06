import { afterAll, beforeAll, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createNotificationProcessor } from "@interviehire/worker";
import { applications, connectHiringDatabase, DrizzleNotificationDirectory, migrateHiringDatabase } from "@interviehire/db-hiring";
import { connectOpsDatabase, DrizzleNotificationDeliveryStore, migrateOpsDatabase, notificationDeliveries } from "@interviehire/db-ops";
const url = process.env.TEST_DATABASE_URL; if (!url) throw new Error("TEST_DATABASE_URL is required"); const hiring = connectHiringDatabase(url); const ops = connectOpsDatabase(url);
beforeAll(async () => { await migrateHiringDatabase(url); await migrateOpsDatabase(url); await ops.db.delete(notificationDeliveries); await hiring.db.insert(applications).values({ id: "app_notify", tenantId: "org_notify", candidateName: "Asha", candidateEmail: "asha@example.test", candidatePhone: "+910000000000" }).onConflictDoNothing(); });
afterAll(async () => { await Promise.all([hiring.client.end(), ops.client.end()]); });
test("delivery ledger survives processor recreation and recipient PII never enters the job", async () => {
  let sends = 0; const provider = { send: async ({ recipient }: any) => { sends++; expect(recipient.email).toBe("asha@example.test"); return { providerMessageId: "message_1" }; } };
  const envelope = { jobId: "notify_1", tenantId: "org_notify", correlationId: "corr", idempotencyKey: "notify_1", resourceRef: { type: "application" as const, id: "app_notify" }, requestedAt: "2026-09-07T10:00:00.000Z", version: 1 as const, payload: { eventType: "notification.requested.v1", channel: "email", template: "interview_scheduled" } };
  expect(JSON.stringify(envelope)).not.toContain("asha@example.test");
  expect(await createNotificationProcessor(new DrizzleNotificationDeliveryStore(ops.db), new DrizzleNotificationDirectory(hiring.db), provider, () => "2026-09-07T10:01:00.000Z")(envelope)).toMatchObject({ replayed: false });
  expect(await createNotificationProcessor(new DrizzleNotificationDeliveryStore(ops.db), new DrizzleNotificationDirectory(hiring.db), provider, () => "2026-09-07T10:02:00.000Z")(envelope)).toMatchObject({ replayed: true });
  const [delivery] = await ops.db.select().from(notificationDeliveries).where(eq(notificationDeliveries.id, "notify_1")); expect(delivery).toMatchObject({ status: "sent", attempt: 1, providerMessageId: "message_1" }); expect(sends).toBe(1);
});
