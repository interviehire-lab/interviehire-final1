# V2 tasks

## DONE — TDD foundation and first pipeline vertical slice

RED: stage legality; atomic stage/history; tenant scope; duplicate command; unequal IDs.

GREEN: contracts, deterministic harness, pipeline policy, application command service,
explicit application/interview mapping, and real PostgreSQL repository integration.

Completed with focused tests, real PostgreSQL/Redis integration, typecheck/build, diff
review, and parity updates green.

## DOING — Core board/application contracts

RED: board exposes exactly three columns and remains tenant scoped; application detail
uses separate stage/decision fields.

## TODO

- Core API board/application contracts and routes
- Hiring outbox and real BullMQ dispatcher/idempotency tests
- Async resume analysis worker
- Scheduling and Interview API mapping
- Voice compatibility contracts
- Completion and dual evaluation workers
- Recruiter Web, Deep Analysis, deterministic demo seed, and Playwright golden path
- Notification/automation slices and compatibility proxies
