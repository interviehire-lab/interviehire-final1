# V2 events

All events and queue jobs are versioned, tenant-scoped, correlation-aware, and contain
resource references rather than candidate PII. Initial events are
`resume-analysis.requested.v1`, `interview.completed.v1`, and
`application.decision-recorded.v1`. Delivery is at least once; consumers persist business
idempotency independently of BullMQ retention.
