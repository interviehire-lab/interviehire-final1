import { and, eq } from "drizzle-orm";
import type { InterviewSession, SessionRepository } from "@interviehire/domain-interview";
import type { InterviewDatabase } from "./database";
import { interviewSessions } from "./schema";
export class DrizzleSessionRepository implements SessionRepository {
  constructor(private readonly db: InterviewDatabase) {}
  async findByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<InterviewSession | undefined> {
    const [row] = await this.db.select().from(interviewSessions).where(and(eq(interviewSessions.tenantId, tenantId), eq(interviewSessions.idempotencyKey, idempotencyKey))).limit(1);
    return row;
  }
  async create(session: InterviewSession): Promise<void> { await this.db.insert(interviewSessions).values(session); }
}
