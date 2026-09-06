import { boolean, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { DirectorResponse, TranscriptEntry, VoiceSettings } from "@interviehire/domain-interview";
export const interviewSessionStatus = pgEnum("v2_interview_session_status", ["scheduled", "in_progress", "completed", "evaluating", "evaluated"]);
export const interviewSessionStage = pgEnum("v2_interview_session_stage", ["recruiter_screening", "functional_interview"]);
export const interviewSessions = pgTable("v2_interview_sessions", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(), applicationId: text("application_id").notNull(),
  interviewStage: interviewSessionStage("interview_stage").notNull(), status: interviewSessionStatus("status").notNull().default("scheduled"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true, mode: "string" }).notNull(), timeZone: text("time_zone").notNull(),
  hardLimitSeconds: integer("hard_limit_seconds").notNull(), correlationId: text("correlation_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(), createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  candidateName: text("candidate_name").notNull().default("Candidate"), roleTitle: text("role_title").notNull().default("Interview"),
  initialQuestion: text("initial_question").notNull().default("Tell me about your professional background."),
  resumePresent: boolean("resume_present").notNull().default(false), settings: jsonb("settings").$type<VoiceSettings>().notNull().default({}),
  transcript: jsonb("transcript").$type<readonly TranscriptEntry[]>().notNull().default([]),
  startedAt: timestamp("started_at", { withTimezone: true, mode: "string" }), completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
}, (table) => [uniqueIndex("v2_interview_session_idempotency_idx").on(table.tenantId, table.idempotencyKey), index("v2_interview_session_application_idx").on(table.tenantId, table.applicationId)]);

export const interviewTurns = pgTable("v2_interview_turns", {
  sessionId: text("session_id").notNull().references(() => interviewSessions.id), turnId: text("turn_id").notNull(),
  candidateText: text("candidate_text").notNull(), ai: jsonb("ai").$type<DirectorResponse>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [primaryKey({ columns: [table.sessionId, table.turnId] })]);

export const interviewOutbox = pgTable("v2_interview_outbox", {
  eventId: text("event_id").primaryKey(), eventType: text("event_type").notNull(), aggregateId: text("aggregate_id").notNull(),
  tenantId: text("tenant_id").notNull(), correlationId: text("correlation_id").notNull(), payload: jsonb("payload").$type<Readonly<Record<string, unknown>>>().notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull(), publishedAt: timestamp("published_at", { withTimezone: true, mode: "string" }), publishAttempts: integer("publish_attempts").notNull().default(0),
}, (table) => [index("v2_interview_outbox_pending_idx").on(table.publishedAt, table.occurredAt)]);
