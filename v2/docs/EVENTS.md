# V2 events

All events and queue jobs are versioned, tenant-scoped, correlation-aware, and contain
resource references rather than candidate PII. Initial events are
`resume-analysis.requested.v1`, `interview.completed.v1`, and
`application.decision-recorded.v1`. Delivery is at least once; consumers persist business
idempotency independently of BullMQ retention.

`application.stage_changed.v1` is the first implemented source-domain event. The Core
transaction writes stage, history, and `v2_hiring_outbox` together. The dispatcher uses
the event ID as the stable BullMQ ID; a crash after enqueue leaves the outbox pending for
safe replay. This is at-least-once publication, not an exactly-once claim.

`resume-analysis.requested.v1` is also implemented. Its queue envelope contains the
application reference, run ID, revision, tenant, and correlation identifiers; resume text
stays in PostgreSQL and is loaded by the authorised worker. The run and candidate-facing
async status persist `queued`, `running`, `ready`, or `failed` independently of Redis.

`interview.completed.v1` is implemented at the Interview boundary. Completion status,
completion transcript marker, and outbox record commit in one PostgreSQL transaction.
Its payload contains only `interviewSessionId`, `applicationId`, and `interviewStage`;
transcript content remains in Interview-owned storage. Duplicate completion calls do not
create additional events.
