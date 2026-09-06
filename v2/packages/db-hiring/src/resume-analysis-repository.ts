import { and, eq } from "drizzle-orm";
import type {
  ResumeAnalysisRepository,
  ResumeAnalysisRun,
} from "@interviehire/domain-hiring";
import type { AsyncStatus, ResumeAnalysisRequestedV1 } from "@interviehire/contracts";
import type { HiringDatabase } from "./database";
import { applications, hiringOutbox, resumeAnalysisRuns } from "./schema";

export class DrizzleResumeAnalysisRepository implements ResumeAnalysisRepository {
  constructor(private readonly db: HiringDatabase) {}

  transaction<T>(work: (repository: ResumeAnalysisRepository) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => work(new DrizzleResumeAnalysisRepository(tx as unknown as HiringDatabase)));
  }

  async applicationExists(tenantId: string, applicationId: string): Promise<boolean> {
    const [row] = await this.db.select({ id: applications.id }).from(applications).where(and(
      eq(applications.tenantId, tenantId), eq(applications.id, applicationId),
    )).limit(1);
    return row !== undefined;
  }

  async findByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<ResumeAnalysisRun | undefined> {
    const [row] = await this.db.select().from(resumeAnalysisRuns).where(and(
      eq(resumeAnalysisRuns.tenantId, tenantId), eq(resumeAnalysisRuns.idempotencyKey, idempotencyKey),
    )).limit(1);
    return row;
  }

  async createRun(run: ResumeAnalysisRun): Promise<void> {
    await this.db.insert(resumeAnalysisRuns).values(run);
  }

  async setApplicationAsyncStatus(applicationId: string, status: AsyncStatus): Promise<void> {
    await this.db.update(applications).set({ asyncStatus: status }).where(eq(applications.id, applicationId));
  }

  async appendOutbox(event: ResumeAnalysisRequestedV1): Promise<void> {
    await this.db.insert(hiringOutbox).values(event);
  }

  async findRunForTenant(tenantId: string, runId: string): Promise<ResumeAnalysisRun | undefined> {
    const [row] = await this.db.select().from(resumeAnalysisRuns).where(and(
      eq(resumeAnalysisRuns.tenantId, tenantId), eq(resumeAnalysisRuns.id, runId),
    )).limit(1);
    return row;
  }
}
