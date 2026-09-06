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
