# Service ownership

| Boundary | Owns | Forbidden direct dependency |
|---|---|---|
| Hiring/Core | organisations, jobs, applications, stages, decisions, history, invites, resume business state, application/interview refs | interview tables / `db-interview` |
| Interview | sessions, question snapshots, access/timing, director, transcripts, consent, proctoring, recording metadata, evaluations | hiring tables / `db-hiring` |
| Ops | job runs, idempotency, notification delivery, automation/dead-letter metadata | source-domain business mutation |

Outboxes live beside the data whose transaction they protect. Workers receive only the
single database capability required by their group.
