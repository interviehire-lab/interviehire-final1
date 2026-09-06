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
| Applications | Deep Analysis through explicit session mapping | legacy functional report and `deep-analysis.ts` | `GET /v2/applications/:id/deep-analysis` | MIGRATED | domain/Core/Interview adapter tests |
| Applications | Hire/reject audited decision | legacy applicant PATCH/decision UI | `POST /v2/applications/:id/decisions` | MIGRATED | domain/API/PostgreSQL atomicity and replay tests |
| Resume analysis | Durable asynchronous request/read | `dashboard/src/dashboard/resume-analysis.ts`, `backend/app/routers/jobs.py` | `POST /v2/applications/:id/resume-analysis`, `GET /v2/async-jobs/:id` | MIGRATED | domain/API/PostgreSQL atomicity tests |
| Resume analysis | BullMQ processing and persisted result | legacy request/poller behavior | `ai.resume` worker | MIGRATED | real Redis/PostgreSQL success, retry, duplicate, durable-read tests |
| Interview bridge | Explicit application/session reference | legacy `backend/app/utils/ai_sync.py` relies on equal IDs | `v2_application_interview_refs` | MIGRATED | unequal-ID PostgreSQL test |
| Scheduling | Core orchestration and atomic mapping/stage history | `backend/app/routers/jobs.py`, `backend/app/routers/invites.py` | `POST /v2/applications/:id/schedule` | MIGRATED | domain/API/PostgreSQL tests with unequal session ID |
| Scheduling | Interview-owned session provisioning | legacy `backend/app/utils/ai_sync.py` and Engine session tables | `POST /internal/v2/sessions` + Core HTTP adapter | MIGRATED | domain/API/PostgreSQL/adapter tests |
| Voice | LiveKit/Deepgram/Silero/Cartesia runtime | `interview-engine/apps/voice-agent` | preserved legacy runtime using unchanged internal paths | PRESERVED | V2 API contract test; real provider smoke remains |
| Voice | Start/timing/access policy | `interview-policy.ts`, public and internal start routes | V2 synchronous Interview service | MIGRATED | domain/API tests for 5/25-minute timing and access gates |
| Voice | Turn idempotency | `voice-agent/src/engine-client.ts` idempotency key | V2 synchronous Interview service | MIGRATED | unit/API/PostgreSQL restart replay tests |
| Voice | Durable completion | legacy complete routes and evaluation poller | Interview transaction + outbox | MIGRATED | PostgreSQL state/event/replay test |
| Privacy | DSAR/export | `backend/tests/test_data_rights.py` | `/compat/*` anti-corruption gateway | PROXIED | method/path/query proxy test |
| Privacy | Retention | `test_retention.py`, internal retention endpoint | daily `automations` scheduler -> compatibility client | PROXIED | retry/idempotency test |
| Talent | Search/dedupe/ranking/compliance | `backend/tests/test_talent_finder.py` | `/compat/*` anti-corruption gateway | PROXIED | in-process proxy contract test |
| Evaluation | Holistic/report + structured/Aviral evaluators | poller, transcript routes, `aviral-eval` | `ai.interview` worker with independent durable results | MIGRATED | unit + real PostgreSQL/Redis retry/merge test |
| Evaluation | Deterministic fallback | `interview-engine/apps/api/src/lib/openrouter.ts` | resilient evaluator adapter | MIGRATED | primary-failure fallback test |
| Evaluation | Tenant-scoped durable report read | legacy report routes | `GET /internal/v2/sessions/:id/evaluation` | MIGRATED | in-process API contract test |
| Notifications | Schedule confirmations and reminders | legacy email/Twilio scheduling paths, `reminders.py` | reference-only `notifications` jobs + Ops ledger | MIGRATED | unit/PostgreSQL idempotency and scheduling event tests |
| Notifications | Application decision email | legacy recruiter/candidate mail paths | `notification.requested.v1` | MIGRATED | decision transaction test |
| Automation | Retention scheduling | `backend/app/jobs/retention.py` | BullMQ Job Scheduler + Ops ledger + legacy engine | PROXIED | processor replay test |
