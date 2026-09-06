import { and, eq, sql } from "drizzle-orm";
import type { InterviewEvaluationQueries, InterviewEvaluationView } from "@interviehire/domain-interview";
import type { EvaluationStore, EvaluatorName } from "@interviehire/worker";
import type { InterviewDatabase } from "./database";
import { interviewEvaluations, interviewSessions } from "./schema";

export class DrizzleEvaluationStore implements EvaluationStore, InterviewEvaluationQueries {
  constructor(private readonly db: InterviewDatabase) {}
  async find(tenantId: string, sessionId: string): Promise<InterviewEvaluationView | undefined> {
    const [row] = await this.db.select({ sessionId: interviewSessions.id, tenantId: interviewSessions.tenantId, applicationId: interviewSessions.applicationId, interviewStage: interviewSessions.interviewStage, status: interviewSessions.status, evaluation: interviewSessions.evaluation }).from(interviewSessions).where(and(eq(interviewSessions.id, sessionId), eq(interviewSessions.tenantId, tenantId))).limit(1);
    return row ?? undefined;
  }
  async claim(sessionId: string, tenantId: string, evaluator: EvaluatorName, startedAt: string) {
    return this.db.transaction(async (tx) => {
      const [session] = await tx.select().from(interviewSessions).where(and(eq(interviewSessions.id, sessionId), eq(interviewSessions.tenantId, tenantId))).for("update");
      if (!session) return { kind: "missing" as const };
      const [run] = await tx.select().from(interviewEvaluations).where(and(eq(interviewEvaluations.sessionId, sessionId), eq(interviewEvaluations.evaluator, evaluator))).for("update");
      if (run?.status === "ready") return { kind: "ready" as const };
      if (run?.status === "running") return { kind: "busy" as const };
      await tx.insert(interviewEvaluations).values({ sessionId, evaluator, status: "running", attempt: 1, startedAt }).onConflictDoUpdate({ target: [interviewEvaluations.sessionId, interviewEvaluations.evaluator], set: { status: "running", attempt: sql`${interviewEvaluations.attempt} + 1`, errorCode: null, startedAt } });
      if (session.status !== "evaluated") await tx.update(interviewSessions).set({ status: "evaluating" }).where(eq(interviewSessions.id, sessionId));
      return { kind: "claimed" as const, transcript: session.transcript, interviewStage: session.interviewStage };
    });
  }
  async complete(sessionId: string, evaluator: EvaluatorName, result: Readonly<Record<string, unknown>>, completedAt: string) { await this.db.update(interviewEvaluations).set({ status: "ready", result, errorCode: null, completedAt }).where(and(eq(interviewEvaluations.sessionId, sessionId), eq(interviewEvaluations.evaluator, evaluator))); }
  async fail(sessionId: string, evaluator: EvaluatorName, errorCode: string, failedAt: string) { await this.db.update(interviewEvaluations).set({ status: "failed", errorCode, completedAt: failedAt }).where(and(eq(interviewEvaluations.sessionId, sessionId), eq(interviewEvaluations.evaluator, evaluator))); }
  async finalize(sessionId: string, completedAt: string) {
    return this.db.transaction(async (tx) => {
      const rows = await tx.select().from(interviewEvaluations).where(eq(interviewEvaluations.sessionId, sessionId));
      const holistic = rows.find((row) => row.evaluator === "holistic" && row.status === "ready")?.result;
      const structured = rows.find((row) => row.evaluator === "structured" && row.status === "ready")?.result;
      if (!holistic || !structured) return { kind: "pending" as const };
      const report = { holistic, structured, evaluatedAt: completedAt };
      await tx.update(interviewSessions).set({ status: "evaluated", evaluation: report }).where(eq(interviewSessions.id, sessionId));
      return { kind: "evaluated" as const, report };
    });
  }
}
