-- AlterEnum
-- Transient claim marker so the evaluation poller (app/jobs/evaluation-poller.ts)
-- can atomically flip COMPLETED -> EVALUATING before starting the slow LLM work,
-- so two poll ticks (or instances) can't double-process the same session.
ALTER TYPE "SessionStatus" ADD VALUE IF NOT EXISTS 'EVALUATING' AFTER 'COMPLETED';
