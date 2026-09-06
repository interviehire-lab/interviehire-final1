# Legacy reconnaissance

This is the behavioral map used before V2 implementation. The target PRD remains the
architecture authority; these files remain the current-product authority.

| Capability | Primary legacy evidence | Migration observation |
|---|---|---|
| Pipeline derivation | `dashboard/src/dashboard/api.ts`, `interview-status.ts`, `backend/app/routers/jobs.py` | UI derives stage from `decision`, `screening_status`, and `functional_status`; V2 stores stage explicitly. |
| Resume analysis | `dashboard/src/dashboard/resume-analysis.ts`, `backend/app/routers/jobs.py`, `backend/app/utils/ai_sync.py` | Current persistence includes resume text/report/flags; V2 queue must carry only a resource reference. |
| Scheduling and invites | `dashboard/src/dashboard/api.ts`, `backend/app/routers/invites.py`, `backend/app/models/interview_invite.py` | Screening and functional status/scheduled fields are separate; preserve invite semantics before native scheduling. |
| Shared-ID coupling | `backend/app/utils/ai_sync.py` | Legacy synchronisation relies on identity equality; V2 mapping table deliberately accepts unequal IDs. |
| LiveKit contract | `interview-engine/apps/voice-agent/src/engine-client.ts`, `apps/api/src/routes/internal.routes.ts` | Start/turn/complete are synchronous; keys are `livekit-start:{session}`, `livekit-turn:{session}:{turn}`, and `livekit-complete:{session}`. |
| Timing/access | `interview-engine/apps/api/src/services/interview-policy.ts`, its tests, and `voice-agent/src/timing-policy.ts` | Screening is fixed at 5 minutes, functional at 25 minutes, general hard cap 30 minutes; CV/access gates require characterization before migration. |
| Transcript | `apps/api/src/services/transcript.service.ts`, `transcript.format.ts`, `routes/transcript.routes.ts` | Transcript append/format/finalise behavior remains interview-owned. |
| Consent/proctoring | Prisma schema and interview routes/services | Evidence must remain independently visible and must not silently become scoring input. |
| Evaluation | `apps/api/src/jobs/evaluation-poller.ts`, `evaluation.service.ts`, `aviral-evaluation.service.ts`, `aviral-eval/` | Poller atomically claims COMPLETED as EVALUATING but has unbounded retry/no backoff; V2 replaces this only after outbox/worker tests. |
| Media | `apps/api/src/services/transcription.service.ts`, `recording-upload.service.ts` | Durable media work is a later `media` queue slice. |
| Notifications/automation | `backend/app/jobs/reminders.py`, `retention.py`, email/Twilio helpers | Reminder attempt is once per application/stage and provider side effects are best effort; preserve before queue migration. |
| Talent Finder | `backend/app/talent_finder/`, `backend/tests/test_talent_finder.py` | Secondary demo capability; keep reachable through one compatibility gateway. |
| Auth/tenant/privacy | `backend/app/utils/auth.py`, organisation-scoped routers, privacy/data-rights tests | V2 commands must not reveal cross-tenant records; auth itself remains compatibility-preserved initially. |

## Documented discrepancy

Legacy does not have the target's explicit three-stage field: the dashboard derives a
bucket and the legacy decision includes `shortlisted`. V2 preserves observable movement
rules while intentionally introducing separate stage and outcome concepts; compatibility
mapping must translate `shortlisted` to active recruiter-screening rather than expose it
as a V2 decision. The old evaluation poller also retries by reverting to `COMPLETED`
without bounded attempts, which is behavior to preserve for legacy access but not a
reliability contract to copy into V2 BullMQ workers.
