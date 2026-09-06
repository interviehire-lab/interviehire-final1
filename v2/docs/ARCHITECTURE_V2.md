# IntervieHire V2 architecture

V2 is a strangler migration under `/v2`: Recruiter Web calls the Core API; the existing
Candidate Room and preserved Node LiveKit agent call the Interview API; durable work is
published from source-domain transactional outboxes to Redis/BullMQ and processed by one
deployable worker with logical groups. One PostgreSQL cluster is used for the demo, with
separate Drizzle ownership packages for Hiring, Interview, and Ops.

Live voice turns are synchronous and never queued. The board owns exactly three stages;
hiring outcomes are a separate decision field. Cross-context relationships use explicit
references, and compatibility gateways keep secondary legacy capabilities reachable.

Cut-over flags: `V2_RECRUITER_WEB_ENABLED`, `V2_CORE_API_ENABLED`,
`V2_INTERVIEW_API_ENABLED`, and `V2_ASYNC_EVALUATION_ENABLED`.
