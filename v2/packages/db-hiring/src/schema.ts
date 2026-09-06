import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { ApplicationStageChangedV1 } from "@interviehire/contracts";

export const applicationStage = pgEnum("v2_application_stage", [
  "resume_analysis", "recruiter_screening", "functional_interview",
]);
export const applicationDecision = pgEnum("v2_application_decision", [
  "active", "hired", "rejected", "withdrawn",
]);
export const interviewStage = pgEnum("v2_interview_stage", [
  "recruiter_screening", "functional_interview",
]);
export const resumeAnalysisStatus = pgEnum("v2_resume_analysis_status", [
  "not_requested", "queued", "running", "ready", "failed",
]);

export const applications = pgTable("v2_applications", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  jobId: text("job_id"),
  candidateName: text("candidate_name"),
  source: text("source"),
  asyncStatus: resumeAnalysisStatus("resume_analysis_status").notNull().default("not_requested"),
  stage: applicationStage("stage").notNull().default("resume_analysis"),
  decision: applicationDecision("decision").notNull().default("active"),
  resumeAnalysisComplete: boolean("resume_analysis_complete").notNull().default(false),
  screeningComplete: boolean("screening_complete").notNull().default(false),
}, (table) => [
  index("v2_applications_tenant_stage_idx").on(table.tenantId, table.stage),
  index("v2_applications_tenant_job_idx").on(table.tenantId, table.jobId),
]);

export const applicationStageHistory = pgTable("v2_application_stage_history", {
  id: text("id").primaryKey(),
  applicationId: text("application_id").notNull().references(() => applications.id),
  tenantId: text("tenant_id").notNull(),
  fromStage: applicationStage("from_stage").notNull(),
  toStage: applicationStage("to_stage").notNull(),
  actorId: text("actor_id").notNull(),
  correlationId: text("correlation_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("v2_application_history_idempotency_idx").on(table.tenantId, table.idempotencyKey),
  index("v2_application_history_application_idx").on(table.applicationId, table.occurredAt),
]);

export const applicationInterviewRefs = pgTable("v2_application_interview_refs", {
  applicationId: text("application_id").notNull().references(() => applications.id),
  interviewSessionId: text("interview_session_id").notNull(),
  stage: interviewStage("interview_stage").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("v2_application_interview_stage_idx").on(table.applicationId, table.stage),
  uniqueIndex("v2_interview_session_ref_idx").on(table.interviewSessionId),
]);

export const hiringOutbox = pgTable("v2_hiring_outbox", {
  eventId: text("event_id").primaryKey(),
  eventType: text("event_type").notNull(),
  aggregateId: text("aggregate_id").notNull(),
  tenantId: text("tenant_id").notNull(),
  correlationId: text("correlation_id").notNull(),
  payload: jsonb("payload").$type<ApplicationStageChangedV1["payload"]>().notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true, mode: "string" }),
  publishAttempts: integer("publish_attempts").notNull().default(0),
}, (table) => [index("v2_hiring_outbox_pending_idx").on(table.publishedAt, table.occurredAt)]);
