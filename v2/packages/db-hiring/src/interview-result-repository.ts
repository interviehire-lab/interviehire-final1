import { and, eq } from "drizzle-orm";
import type { InterviewResultRepository, InterviewStage } from "@interviehire/domain-hiring";
import type { HiringDatabase } from "./database";
import { applicationInterviewRefs, applications } from "./schema";

export class DrizzleInterviewResultRepository implements InterviewResultRepository {
  constructor(private readonly db: HiringDatabase) {}
  async hasMapping(tenantId: string, applicationId: string, interviewSessionId: string, stage: InterviewStage) {
    const [row] = await this.db.select({ applicationId: applicationInterviewRefs.applicationId })
      .from(applicationInterviewRefs)
      .where(and(
        eq(applicationInterviewRefs.tenantId, tenantId),
        eq(applicationInterviewRefs.applicationId, applicationId),
        eq(applicationInterviewRefs.interviewSessionId, interviewSessionId),
        eq(applicationInterviewRefs.stage, stage),
      )).limit(1);
    return Boolean(row);
  }
  async markScreeningComplete(tenantId: string, applicationId: string) {
    await this.db.update(applications).set({ screeningComplete: true }).where(and(
      eq(applications.tenantId, tenantId), eq(applications.id, applicationId),
    ));
  }
}
