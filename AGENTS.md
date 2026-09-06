# IntervieHire V2 engineering instructions

## Mission and repository boundaries

Build V2 under `/v2`. The target architecture documents describe the destination;
the legacy `backend`, `dashboard`, and `interview-engine` directories describe current
behaviour and remain read-only references unless a compatibility change is explicitly
required. Never mass-format, rename, relocate, or broadly refactor legacy code.

## Mandatory TDD workflow

For every V2 behaviour: locate the legacy implementation and tests, record its data and
provider effects, write a failing V2 acceptance test, confirm RED, implement the smallest
coherent change, confirm GREEN, refactor while green, run the nearest integration test,
update `docs/FEATURE_PARITY.md`, and inspect the diff. Never skip, disable, weaken, or
mock away a required acceptance test.

Prefer pure domain tests, then contracts, database/API integration, real Redis/BullMQ
integration, and finally Playwright. Use real PostgreSQL for transaction, constraint,
locking, Drizzle, outbox, history, and ID-mapping semantics. Use real Redis for BullMQ
retry, delayed, duplicate, restart, stalled-job, and dispatcher semantics. Provider
boundaries use deterministic fakes. Inject clocks and IDs; do not scatter current time or
randomness through domain code.

## Domain and service invariants

- The board has exactly `resume_analysis`, `recruiter_screening`, and
  `functional_interview` stages.
- `active`, `hired`, `rejected`, and `withdrawn` are decisions, never stages.
- Core/Hiring owns hiring data; Interview owns interview data; Ops owns processing state.
- `core-api` must not import `db-interview`; `interview-api` must not import `db-hiring`.
- Cross-context work uses contracts, commands, events, and explicit mapping records.
- Never depend on equality between Job/JobRole, Application/Candidate, or
  Application/InterviewSession IDs. Tests deliberately use unequal IDs.
- Use expand-only migrations during the demo sprint. No drops, destructive renames, or
  global ID rewrites.

## Async and voice invariants

Critical async work is: source-domain transaction -> outbox -> dispatcher -> BullMQ ->
idempotent worker. Jobs carry IDs and small routing metadata, never resume text,
transcripts, contact details, credentials, or full reports. Workers persist idempotency,
classify failures, use bounded retries, and propagate correlation IDs.

Preserve the Node LiveKit voice agent, Deepgram, Silero, Cartesia, director behaviour,
and turn-idempotency semantics. Live turns stay synchronous through the Interview API;
never route a live turn through BullMQ.

## Completion and parity

Every discovered capability belongs in `docs/FEATURE_PARITY.md` as `MIGRATED`,
`PRESERVED`, `PROXIED`, `PENDING MIGRATION`, or `BROKEN LEGACY`. `MIGRATED` needs a
passing test, `PROXIED` needs a smoke test, and broken legacy behaviour needs evidence.
Before declaring a task complete: focused tests, affected integration tests, typecheck,
and build are green; no relevant tests are skipped; parity is updated; the diff has no
unrelated legacy edits.
