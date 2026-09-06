import { and, eq, inArray, sql } from "drizzle-orm";
import type { HiringDatabase } from "./database";
import { applications, resumeAnalysisRuns } from "./schema";

export class DrizzleResumeAnalysisWorkerStore {
  constructor(private readonly db: HiringDatabase) {}

  async claim(runId: string, tenantId: string, startedAt: string) {
    return this.db.transaction(async (tx) => {
      const [existing] = await tx.select().from(resumeAnalysisRuns).where(and(
        eq(resumeAnalysisRuns.id, runId), eq(resumeAnalysisRuns.tenantId, tenantId),
      )).limit(1);
      if (!existing) return { kind: "missing" as const };
      if (existing.status === "ready") return { kind: "ready" as const };
      const [claimed] = await tx.update(resumeAnalysisRuns).set({
        status: "running",
        attempt: sql`${resumeAnalysisRuns.attempt} + 1`,
        errorCode: null,
        updatedAt: startedAt,
      }).where(and(
        eq(resumeAnalysisRuns.id, runId),
        eq(resumeAnalysisRuns.tenantId, tenantId),
        inArray(resumeAnalysisRuns.status, ["queued", "failed"]),
      )).returning({ applicationId: resumeAnalysisRuns.applicationId });
      return claimed
        ? { kind: "claimed" as const, applicationId: claimed.applicationId }
        : { kind: "busy" as const };
    });
  }

  async loadResumeText(applicationId: string, tenantId: string): Promise<string | undefined> {
    const [row] = await this.db.select({ resumeText: applications.resumeText }).from(applications).where(and(
      eq(applications.id, applicationId), eq(applications.tenantId, tenantId),
    )).limit(1);
    return row?.resumeText ?? undefined;
  }

  async complete(runId: string, result: Readonly<Record<string, unknown>>, completedAt: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [run] = await tx.update(resumeAnalysisRuns).set({
        status: "ready", result, errorCode: null, updatedAt: completedAt,
      }).where(eq(resumeAnalysisRuns.id, runId)).returning({ applicationId: resumeAnalysisRuns.applicationId });
      if (run) await tx.update(applications).set({ asyncStatus: "ready" }).where(eq(applications.id, run.applicationId));
    });
  }

  async fail(runId: string, errorCode: string, failedAt: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [run] = await tx.update(resumeAnalysisRuns).set({
        status: "failed", errorCode, updatedAt: failedAt,
      }).where(eq(resumeAnalysisRuns.id, runId)).returning({ applicationId: resumeAnalysisRuns.applicationId });
      if (run) await tx.update(applications).set({ asyncStatus: "failed" }).where(eq(applications.id, run.applicationId));
    });
  }
}
