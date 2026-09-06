import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { OutboxRecord, OutboxStore } from "@interviehire/queue";
import type { HiringDatabase } from "./database";
import { hiringOutbox } from "./schema";

export class DrizzleHiringOutboxStore implements OutboxStore {
  constructor(private readonly db: HiringDatabase) {}

  async listPending(limit: number): Promise<readonly OutboxRecord[]> {
    return this.db.select().from(hiringOutbox)
      .where(isNull(hiringOutbox.publishedAt))
      .orderBy(asc(hiringOutbox.occurredAt))
      .limit(limit);
  }

  async markPublished(eventId: string, publishedAt: string): Promise<void> {
    await this.db.update(hiringOutbox).set({
      publishedAt,
      publishAttempts: sql`${hiringOutbox.publishAttempts} + 1`,
    }).where(and(eq(hiringOutbox.eventId, eventId), isNull(hiringOutbox.publishedAt)));
  }
}
