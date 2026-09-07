# IntervieHire V2 demo runbook

## Prerequisites

- Bun 1.3+
- Docker with Compose
- Chromium available to Playwright for the automated golden path

All commands run from `interviehire-final1/v2`. The disposable demo uses PostgreSQL on
`127.0.0.1:55432`, Redis on `127.0.0.1:56379`, Core API on `4100`, Interview API on
`4200`, and Recruiter Web on `3000`.

## Start the deterministic demo

```bash
bun install --frozen-lockfile
bun run demo
```

`demo` starts the health-checked containers, runs every idempotent migration, clears
stale queue data, loads the fixed eight-candidate dataset, and supervises Core,
Interview, Worker, and Recruiter Web. Open `http://127.0.0.1:3000`.

The local demo provider is deliberately deterministic. It exercises real PostgreSQL,
outboxes, Redis, BullMQ retries, synchronous voice contracts, both evaluator stores,
notifications, and Core policy without calling a metered LLM or messaging provider.
Set `RESUME_ANALYSIS_PROVIDER_URL`, `HOLISTIC_EVALUATOR_URL`, and
`STRUCTURED_EVALUATOR_URL` (plus `AI_PROVIDER_API_KEY` when required) to use real HTTP
provider adapters; each evaluator retains the deterministic fallback.

## Acceptance gate

```bash
bun run test:e2e
```

This command brings up infrastructure, reseeds the database, starts the four-process
stack, and runs one Playwright worker with retries disabled. The scenario verifies:

1. the populated board has exactly three operational columns;
2. a new candidate starts in Resume Analysis;
3. analysis visibly queues, completes through BullMQ, and exposes durable evidence;
4. recruiter screening is scheduled with a distinct Interview session ID;
5. synchronous start/turn/complete produces both evaluator results;
6. Core receives the evaluated screening event and unlocks functional scheduling;
7. the functional interview evaluates and Deep Analysis shows holistic and structured evidence;
8. Hire persists after a full browser reload.

For the complete release gate, also run:

```bash
TEST_DATABASE_URL=postgres://interviehire:interviehire_test@127.0.0.1:55432/interviehire_v2_test \
TEST_REDIS_URL=redis://127.0.0.1:56379 \
bun test --max-concurrency 1 packages/*/src apps/*/src tests
bun run build
```

## Real provider smoke

The production LiveKit/Deepgram/Silero/Cartesia voice runtime remains in the preserved
legacy tree and calls the same V2 synchronous start/turn/complete paths. The release
smoke was executed on 2026-09-07 against LiveKit Cloud: a named-agent job was dispatched,
a candidate joined and sent the readiness signal, the agent joined, and the candidate
subscribed to the agent's remote audio track (`TrackKind.KIND_AUDIO`). The agent also
called the V2 start and completion contracts. No credential values are stored in this
repository or printed by the smoke harness.

Before each environment cut-over, repeat that interview using the environment's own
deployment credentials and send one delivery through every configured notification
provider. Deterministic CI intentionally does not require those secrets.

## Rollback and shutdown

Stop the supervisor with Ctrl-C. Stop disposable infrastructure with:

```bash
bun run infra:down
```

During deployment, independently disable `V2_RECRUITER_WEB_ENABLED`,
`V2_CORE_API_ENABLED`, `V2_INTERVIEW_API_ENABLED`, or
`V2_ASYNC_EVALUATION_ENABLED`. Pause dispatchers instead of deleting pending outbox rows,
and point the preserved voice agent back to the legacy Interview Engine base URL.
