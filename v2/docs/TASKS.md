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

## DOING — Asynchronous resume analysis

RED: request returns queued immediately and atomically publishes a reference-only event;
worker moves queued -> running -> ready; duplicate delivery stores one result; transient
provider failures remain retryable.

## TODO

- Async resume analysis worker
- Scheduling and Interview API mapping
- Voice compatibility contracts
- Completion and dual evaluation workers
- Recruiter Web, Deep Analysis, deterministic demo seed, and Playwright golden path
- Notification/automation slices and compatibility proxies
