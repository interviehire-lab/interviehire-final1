# V2 tasks

## DONE — TDD foundation and first pipeline vertical slice

RED: stage legality; atomic stage/history; tenant scope; duplicate command; unequal IDs.

GREEN: contracts, deterministic harness, pipeline policy, application command service,
explicit application/interview mapping, and real PostgreSQL repository integration.

Completed with focused tests, real PostgreSQL/Redis integration, typecheck/build, diff
review, and parity updates green.

## DONE — Core board/application contracts

RED: board exposes exactly three columns and remains tenant scoped; application detail
uses separate stage/decision fields.

Completed with pure-domain, in-process Elysia, and real PostgreSQL tests.

## DONE — Hiring transactional outbox

RED: business mutation and event commit together; both roll back together; dispatcher
replay can publish twice while a consumer effect remains idempotent.

Completed with real PostgreSQL/BullMQ commit, rollback-after-outbox-insert, publication,
and crash/replay tests. Persistent consumer idempotency belongs to the worker slice.

## DONE — Asynchronous resume analysis

RED: request returns queued immediately and atomically publishes a reference-only event;
worker moves queued -> running -> ready; duplicate delivery stores one result; transient
provider failures remain retryable.

Completed through domain, API, PostgreSQL atomicity, real BullMQ success/retry/duplicate,
reference-only payload, and durable read-after-worker-restart tests.

## DONE — Core scheduling orchestration

RED: scheduling provisions an independently generated session ID, persists an explicit
application/session mapping, and does not move stage when provisioning fails.

Completed with domain/API/PostgreSQL tests. Core sees only an `InterviewProvisioner`
port; its transaction stores mapping, stage history, and outbox without importing
Interview-owned storage.

## DONE — Interview API session provisioning

RED: provision endpoint creates a distinct session ID, validates stage/timing inputs,
is tenant/idempotency scoped, and can be called through the Core adapter.

Completed with fixed 5/25-minute stage caps, an Interview-owned PostgreSQL table,
service-secret Elysia endpoint, and reference-only Core HTTP adapter.

## DONE — Voice compatibility contracts

RED: start enforces timing/access gates and returns the legacy LiveKit timing shape;
turns are synchronous and idempotent; completion is durable and emits one outbox event.

Completed through domain/API/PostgreSQL tests. The preserved Node LiveKit agent can use
the same three internal paths and payloads; no live turn enters BullMQ.

## DONE — Completion and dual evaluation workers

RED: the completion event fans out to holistic/report and structured/Aviral evaluation;
both retry safely, persist independently, merge deterministically, and survive restart.

Completed with independent PostgreSQL evaluation runs, a BullMQ processor, deterministic
fallback adapter, tenant-scoped report read, and real Redis retry test.

## DONE — Recruiter Deep Analysis and board actions

RED: Core resolves explicit application/session mappings, exposes tenant-scoped Deep
Analysis, and records hire/reject decisions without changing the three-stage board.

Completed with explicit mapping resolution, tenant-scoped Interview adapter, and an
audited/idempotent decision transaction with its source-domain outbox event.

## DONE — Durable notifications and reminders

RED: schedule and decision events create reference-only notification work; channel
delivery and reminder scheduling are persistently idempotent with isolated failures.

Completed with reference-only confirmation/reminder events, delayed-delivery metadata,
tenant-scoped contact lookup, provider ports, and an Ops-owned attempt ledger.

## DONE — Retention automation and compatibility proxies

RED: a scheduled retention scan is safe under retries and secondary legacy surfaces are
reachable through an explicit compatibility boundary without shared-schema writes.

Completed with a daily BullMQ Job Scheduler, durable Ops run claims, a shared-secret
retention client, and a method/body/query-preserving Core compatibility gateway.

## DONE — Runnable worker topology and evaluation handoff

RED: source-domain events route to the correct BullMQ group; unsafe event IDs are
escaped deterministically; one worker process pumps both outboxes; a merged screening
evaluation reaches Core without the Interview worker writing Hiring storage.

Completed with a `WORKER_GROUP` bootstrap, bounded outbox pump, structured logs,
retry/backoff defaults, deterministic demo providers, graceful shutdown, an
`interview.evaluated.v1` event, and a service-authenticated Core policy command. A live
rehearsal completed resume analysis and both interview evaluators, then successfully
unlocked functional scheduling.

## DONE — Recruiter Web and deterministic demo

RED: three-column accessible board, application sheet, schedule/decision actions, async
status, Deep Analysis, deterministic seed, and golden-path browser coverage.

Completed with a responsive shadcn-based workspace, pointer and keyboard stage actions,
candidate/schedule sheets, recruiter-visible durable resume evidence, separate holistic,
structured, and proctoring sections, deterministic eight-candidate seed data, a
four-process demo supervisor, and a no-retry Playwright path that takes a new candidate
through both interviews to a persisted hire decision.

## TODO

- None for the V2 demo acceptance scope. The real LiveKit provider smoke passed on
  2026-09-07; it remains a per-environment release gate because deployment credentials
  are intentionally excluded from the repository and deterministic CI.
