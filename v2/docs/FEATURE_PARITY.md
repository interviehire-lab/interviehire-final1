# Feature parity ledger

| Domain | Feature | Legacy evidence | V2 surface | Status | Test/evidence |
|---|---|---|---|---|---|
| Pipeline | Three operational stages | `dashboard/src/dashboard/api.ts`, `interview-status.ts` | `domain-hiring` + transition API | MIGRATED | `pipeline.test.ts`, `app.test.ts` |
| Pipeline | Hire/reject outcome separation | `dashboard/src/dashboard/api.ts`, `deep-analysis.ts` | separate `decision` contract | MIGRATED | `pipeline.test.ts`, contract test |
| Pipeline | Tenant-scoped authoritative transition | `backend/app/routers/jobs.py` | `POST /v2/applications/:id/transitions` | MIGRATED | API + PostgreSQL integration tests |
| Pipeline | Atomic stage history and command replay | Legacy has no equivalent history table | `v2_application_stage_history` | MIGRATED | PostgreSQL commit/rollback/replay tests |
| Async foundation | Hiring transactional outbox | Legacy performs direct/fire-and-forget side effects | `v2_hiring_outbox` + dispatcher | MIGRATED | PostgreSQL/BullMQ commit, rollback, publish, crash-replay tests |
| Pipeline | Three-column job board read | `dashboard/src/dashboard/job-detail-panes.ts` | `GET /v2/jobs/:id/board` | MIGRATED | domain/API/PostgreSQL tenant tests |
| Applications | Tenant-scoped application detail | `backend/app/routers/jobs.py` | `GET /v2/applications/:id` | MIGRATED | API/PostgreSQL tenant tests |
| Interview bridge | Explicit application/session reference | legacy `backend/app/utils/ai_sync.py` relies on equal IDs | `v2_application_interview_refs` | MIGRATED | unequal-ID PostgreSQL test |
| Voice | LiveKit/Deepgram/Silero/Cartesia runtime | `interview-engine/apps/voice-agent` | preserved legacy runtime | PRESERVED | Contract suite pending |
| Voice | Turn idempotency | `voice-agent/src/engine-client.ts` idempotency key | Interview API compatibility | PENDING MIGRATION | Characterisation located |
| Privacy | DSAR/export/retention | `backend/tests/test_data_rights.py`, `test_retention.py` | compatibility gateway | PENDING MIGRATION | Proxy smoke pending |
| Talent | Search/dedupe/ranking/compliance | `backend/tests/test_talent_finder.py` | compatibility gateway | PENDING MIGRATION | Proxy smoke pending |
| Evaluation | Structured/Aviral evaluator | `interview-engine/apps/api/src/aviral-eval` | `ai.interview` worker | PENDING MIGRATION | Legacy tests located |
| Evaluation | Deterministic fallback | `interview-engine/apps/api/src/lib/openrouter.ts` | provider adapter | PENDING MIGRATION | Characterisation pending |
| Automation | Reminders and retention | `backend/app/jobs/reminders.py`, `retention.py` | `automations` queue | PENDING MIGRATION | Legacy tests located |
