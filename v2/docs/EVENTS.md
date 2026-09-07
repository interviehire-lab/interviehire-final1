# V2 events

All events and queue jobs are versioned, tenant-scoped, correlation-aware, and contain
resource references rather than candidate PII. Initial events are
`resume-analysis.requested.v1`, `interview.completed.v1`, `interview.evaluated.v1`, and
`application.decision-recorded.v1`. Delivery is at least once; consumers persist business
idempotency independently of BullMQ retention.

`application.stage_changed.v1` is the first implemented source-domain event. The Core
transaction writes stage, history, and `v2_hiring_outbox` together. The dispatcher uses
an escaped form of the event ID as the stable BullMQ ID; a crash after enqueue leaves the outbox pending for
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

The Interview outbox dispatcher targets `ai.interview`. Its processor runs the
`holistic` and `structured` evaluators as separately claimed durable records. A retry
skips any evaluator already marked ready, so a transient failure in one provider does
not repeat or erase the other's result. The session becomes `evaluated` only after both
records are ready and their results have been merged.

That merge atomically writes `interview.evaluated.v1` beside the Interview session. The
automation consumer sends the explicit application/session/stage references to Core's
service-authenticated command. Core verifies its mapping and updates screening
completion; the Interview worker never writes Hiring tables directly.

`notification.requested.v1` is emitted in the same Hiring transaction as scheduling or
decision state. Jobs include only an application reference, channel, template, and
optional `deliverAt`; recipient email/phone is loaded from the tenant-scoped Hiring
directory after dequeue. Scheduling emits one immediate confirmation and one reminder
30 minutes before the slot for every selected channel. Ops persists delivery claims,
attempts, provider IDs, and terminal sent state so duplicate queue delivery is harmless.
