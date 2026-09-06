import { and, eq, sql } from "drizzle-orm";
import type { CompletionReason, TranscriptEntry, VoiceRepository, VoiceSession, VoiceTurn } from "@interviehire/domain-interview";
import type { InterviewDatabase } from "./database";
import { interviewOutbox, interviewSessions, interviewTurns } from "./schema";

export class DrizzleVoiceRepository implements VoiceRepository {
  constructor(private readonly db: InterviewDatabase) {}
  async findSession(id: string): Promise<VoiceSession | undefined> {
    const [row] = await this.db.select().from(interviewSessions).where(eq(interviewSessions.id, id)).limit(1);
    return row ?? undefined;
  }
  async start(id: string, startedAt: string, transcript: readonly TranscriptEntry[]): Promise<void> {
    await this.db.update(interviewSessions).set({ status: "in_progress", startedAt, transcript }).where(eq(interviewSessions.id, id));
  }
  async findTurn(sessionId: string, turnId: string): Promise<VoiceTurn | undefined> {
    const [row] = await this.db.select().from(interviewTurns).where(and(eq(interviewTurns.sessionId, sessionId), eq(interviewTurns.turnId, turnId))).limit(1);
    return row;
  }
  async commitTurn(turn: VoiceTurn): Promise<void> {
    await this.db.transaction(async (tx) => {
      const inserted = await tx.insert(interviewTurns).values(turn).onConflictDoNothing().returning({ turnId: interviewTurns.turnId });
      if (inserted.length === 0) return;
      await tx.update(interviewSessions).set({ transcript: sql`${interviewSessions.transcript} || ${JSON.stringify([{ speaker: "candidate", text: turn.candidateText, timestamp: turn.createdAt }, { speaker: "ai", text: turn.ai.text, timestamp: turn.createdAt, livekitTurnId: turn.turnId, kind: turn.ai.interviewPhase === "follow_up" ? "followup" : "question" }])}::jsonb` }).where(eq(interviewSessions.id, turn.sessionId));
    });
  }
  async complete(id: string, completedAt: string, reason: CompletionReason): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [session] = await tx.select().from(interviewSessions).where(eq(interviewSessions.id, id)).for("update");
      if (!session || ["completed", "evaluating", "evaluated"].includes(session.status)) return;
      await tx.update(interviewSessions).set({ status: "completed", completedAt, transcript: sql`${interviewSessions.transcript} || ${JSON.stringify([{ type: "interview_completion", completionReason: reason, timestamp: completedAt }])}::jsonb` }).where(eq(interviewSessions.id, id));
      await tx.insert(interviewOutbox).values({ eventId: `interview.completed:${id}`, eventType: "interview.completed.v1", aggregateId: id, tenantId: session.tenantId, correlationId: session.correlationId, payload: { interviewSessionId: id, applicationId: session.applicationId, interviewStage: session.interviewStage }, occurredAt: completedAt }).onConflictDoNothing();
    });
  }
}
