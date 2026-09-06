import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { HiringOutboxEvent } from "@interviehire/contracts";

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
  resumeText: text("resume_text"),
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

export const applicationDecisionHistory = pgTable("v2_application_decision_history", {
  id: text("id").primaryKey(), applicationId: text("application_id").notNull().references(() => applications.id), tenantId: text("tenant_id").notNull(),
  stage: applicationStage("stage").notNull(), fromDecision: applicationDecision("from_decision").notNull(), toDecision: applicationDecision("to_decision").notNull(),
  actorId: text("actor_id").notNull(), correlationId: text("correlation_id").notNull(), idempotencyKey: text("idempotency_key").notNull(), occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [uniqueIndex("v2_application_decision_idempotency_idx").on(table.tenantId, table.idempotencyKey)]);

export const applicationInterviewRefs = pgTable("v2_application_interview_refs", {
  applicationId: text("application_id").notNull().references(() => applications.id),
  tenantId: text("tenant_id"),
  interviewSessionId: text("interview_session_id").notNull(),
  stage: interviewStage("interview_stage").notNull(),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true, mode: "string" }),
  timeZone: text("time_zone"),
  deliveryMethods: jsonb("delivery_methods").$type<readonly ("email" | "whatsapp" | "robocall")[]>(),
  correlationId: text("correlation_id"),
  idempotencyKey: text("idempotency_key"),
  actorId: text("actor_id"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("v2_application_interview_stage_idx").on(table.applicationId, table.stage),
  uniqueIndex("v2_interview_session_ref_idx").on(table.interviewSessionId),
  uniqueIndex("v2_schedule_idempotency_idx").on(table.tenantId, table.idempotencyKey),
]);

export const hiringOutbox = pgTable("v2_hiring_outbox", {
  eventId: text("event_id").primaryKey(),
  eventType: text("event_type").notNull(),
  aggregateId: text("aggregate_id").notNull(),
  tenantId: text("tenant_id").notNull(),
  correlationId: text("correlation_id").notNull(),
  payload: jsonb("payload").$type<HiringOutboxEvent["payload"]>().notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true, mode: "string" }),
  publishAttempts: integer("publish_attempts").notNull().default(0),
}, (table) => [index("v2_hiring_outbox_pending_idx").on(table.publishedAt, table.occurredAt)]);

export const resumeAnalysisRuns = pgTable("v2_resume_analysis_runs", {
  id: text("id").primaryKey(),
  applicationId: text("application_id").notNull().references(() => applications.id),
  tenantId: text("tenant_id").notNull(),
  status: resumeAnalysisStatus("status").notNull(),
  attempt: integer("attempt").notNull().default(0),
  idempotencyKey: text("idempotency_key").notNull(),
  correlationId: text("correlation_id").notNull(),
  resumeRevision: integer("resume_revision").notNull(),
  result: jsonb("result").$type<Readonly<Record<string, unknown>>>(),
  errorCode: text("error_code"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("v2_resume_runs_idempotency_idx").on(table.tenantId, table.idempotencyKey),
  index("v2_resume_runs_application_idx").on(table.applicationId, table.createdAt),
]);
