# V2 test strategy

## Workflow

Every migrated behaviour starts from legacy evidence, then a failing V2 test, the
smallest passing implementation, green refactoring, an affected integration test, and a
feature-parity update. Required expectations are never skipped, disabled, or weakened.

## Layers and commands

| Layer | Purpose | Command / infrastructure |
|---|---|---|
| Domain | Stage, decision, timing, evaluation rules | `bun run test:unit` |
| Contract | API, event, queue, voice shapes | `bun test packages/contracts tests/contracts` |
| Database | Drizzle, constraints, transactions, outbox, mappings | `bun run infra:up && bun run test:integration` with real PostgreSQL |
| Queue/worker | Retry, duplicates, replay, restart, persistence | `bun run infra:up && bun run test:integration` with real Redis/PostgreSQL |
| UI interaction | Board, Sheets, async and errors | recruiter-web test suite |
| Golden E2E | Seeded recruiter workflow | Playwright against the full V2 stack |
| Provider smoke | One real LiveKit and notification path | explicit demo-environment command |

The test stack uses `TEST_DATABASE_URL` and `TEST_REDIS_URL`; copy `.env.test.example`
or export equivalent values. `compose.test.yml` provides disposable, health-checked
PostgreSQL and Redis instances. Infrastructure semantics must not be replaced with fakes.

## Determinism and fixtures

Domain code receives a clock and ID source. `@interviehire/testing` owns `FixedClock`,
provider fakes, factories, database reset/seed helpers, queue polling helpers, and frozen
resume/transcript/report fixtures. Automated tests never call a live LLM, SMTP, Twilio,
Google, or arbitrary wall-clock sleeps. Poll helpers use bounded deadlines.

## Release gates

Before the demo: typecheck/build; critical domain and PostgreSQL tests; outbox and real
BullMQ retry/idempotency/restart tests; voice contracts; resume and dual-evaluation
workers; board interactions; deterministic golden Playwright path; and one real LiveKit
smoke. Post-demo load/browser/chaos breadth does not replace these correctness gates.
