import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { OutboxRecord, OutboxStore } from "@interviehire/queue";
import type { InterviewDatabase } from "./database";
import { interviewOutbox } from "./schema";
export class DrizzleInterviewOutboxStore implements OutboxStore {
  constructor(private readonly db: InterviewDatabase) {}
  listPending(limit: number): Promise<readonly OutboxRecord[]> { return this.db.select().from(interviewOutbox).where(isNull(interviewOutbox.publishedAt)).orderBy(asc(interviewOutbox.occurredAt)).limit(limit); }
  async markPublished(eventId: string, publishedAt: string): Promise<void> { await this.db.update(interviewOutbox).set({ publishedAt, publishAttempts: sql`${interviewOutbox.publishAttempts} + 1` }).where(and(eq(interviewOutbox.eventId, eventId), isNull(interviewOutbox.publishedAt))); }
}
