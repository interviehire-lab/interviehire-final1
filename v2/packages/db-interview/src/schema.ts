import { index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
export const interviewSessionStatus = pgEnum("v2_interview_session_status", ["scheduled", "in_progress", "completed", "evaluating", "evaluated"]);
export const interviewSessionStage = pgEnum("v2_interview_session_stage", ["recruiter_screening", "functional_interview"]);
export const interviewSessions = pgTable("v2_interview_sessions", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), applicationId: text("application_id").notNull(),
  interviewStage: interviewSessionStage("interview_stage").notNull(), status: interviewSessionStatus("status").notNull().default("scheduled"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true, mode: "string" }).notNull(), timeZone: text("time_zone").notNull(),
  hardLimitSeconds: integer("hard_limit_seconds").notNull(), correlationId: text("correlation_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(), createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [uniqueIndex("v2_interview_session_idempotency_idx").on(table.tenantId, table.idempotencyKey), index("v2_interview_session_application_idx").on(table.tenantId, table.applicationId)]);
