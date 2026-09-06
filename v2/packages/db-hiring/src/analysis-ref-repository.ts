import { and, desc, eq } from "drizzle-orm";
import type { AnalysisRefRepository } from "@interviehire/domain-hiring";
import type { HiringDatabase } from "./database";
import { applicationInterviewRefs } from "./schema";
export class DrizzleAnalysisRefRepository implements AnalysisRefRepository {
  constructor(private readonly db: HiringDatabase) {}
  async findLatest(tenantId: string, applicationId: string) { const [row] = await this.db.select().from(applicationInterviewRefs).where(and(eq(applicationInterviewRefs.tenantId, tenantId), eq(applicationInterviewRefs.applicationId, applicationId))).orderBy(desc(applicationInterviewRefs.createdAt)).limit(1); return row ? { applicationId: row.applicationId, interviewSessionId: row.interviewSessionId, interviewStage: row.stage } : undefined; }
}
