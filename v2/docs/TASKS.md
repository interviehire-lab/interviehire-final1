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

## DOING — Recruiter Deep Analysis and board actions

RED: Core resolves explicit application/session mappings, exposes tenant-scoped Deep
Analysis, and records hire/reject decisions without changing the three-stage board.

## TODO

- Recruiter Web, Deep Analysis, deterministic demo seed, and Playwright golden path
- Notification/automation slices and compatibility proxies
