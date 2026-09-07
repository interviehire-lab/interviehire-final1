import type { JobEnvelopeV1 } from "@interviehire/contracts";
import { UnrecoverableError, type Processor } from "bullmq";
export class PermanentNotificationError extends Error { readonly failureClass = "PERMANENT" }
export type NotificationChannel = "email" | "whatsapp" | "robocall";
export interface NotificationRecipient { readonly name: string; readonly email: string | null; readonly phone: string | null }
export interface NotificationDirectory { load(tenantId: string, resourceId: string): Promise<NotificationRecipient | undefined> }
export interface NotificationDeliveryStore { claim(deliveryId: string, tenantId: string, channel: NotificationChannel, startedAt: string): Promise<{ readonly kind: "claimed" | "sent" | "busy" }>; complete(deliveryId: string, providerMessageId: string, completedAt: string): Promise<void>; fail(deliveryId: string, errorCode: string, failedAt: string): Promise<void> }
export interface NotificationProvider { send(message: { readonly channel: NotificationChannel; readonly template: string; readonly recipient: NotificationRecipient; readonly resourceId: string; readonly idempotencyKey: string }): Promise<{ readonly providerMessageId: string }> }
export function createNotificationProcessor(store: NotificationDeliveryStore, directory: NotificationDirectory, provider: NotificationProvider, now: () => string) {
  return async (envelope: JobEnvelopeV1): Promise<{ replayed: boolean; deliveryId: string }> => {
    const channel = envelope.payload?.channel; const template = envelope.payload?.template;
    if (envelope.resourceRef.type !== "application" || !["email", "whatsapp", "robocall"].includes(String(channel)) || typeof template !== "string") throw new Error("Notification job is invalid");
    const deliveryId = envelope.jobId; const claim = await store.claim(deliveryId, envelope.tenantId, channel as NotificationChannel, now());
    if (claim.kind !== "claimed") return { replayed: true, deliveryId };
    try { const recipient = await directory.load(envelope.tenantId, envelope.resourceRef.id); if (!recipient) throw new PermanentNotificationError("Notification recipient not found"); if (channel === "email" && !recipient.email) throw new PermanentNotificationError("Email recipient is missing"); if (channel !== "email" && !recipient.phone) throw new PermanentNotificationError("Phone recipient is missing"); const sent = await provider.send({ channel: channel as NotificationChannel, template, recipient, resourceId: envelope.resourceRef.id, idempotencyKey: deliveryId }); await store.complete(deliveryId, sent.providerMessageId, now()); return { replayed: false, deliveryId }; }
    catch (error) { await store.fail(deliveryId, error instanceof PermanentNotificationError ? "PERMANENT" : "TRANSIENT", now()); throw error; }
  };
}
export function createBullMqNotificationProcessor(processor: ReturnType<typeof createNotificationProcessor>): Processor<JobEnvelopeV1> { return async (job) => { try { return await processor(job.data); } catch (error) { if (error instanceof PermanentNotificationError) throw new UnrecoverableError(error.message); throw error; } }; }
