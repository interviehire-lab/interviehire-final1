# Demo runbook

The deterministic demo path will use one seeded organisation, recruiter, configured job,
and candidates covering queued/ready/scheduled/completed/evaluating/evaluated/failed
states. Until a V2 feature is green and marked migrated, keep the corresponding legacy
surface reachable. Roll back by disabling the four coarse V2 cut-over flags; pause the
outbox dispatcher rather than deleting pending rows; point the voice agent back to the
legacy Engine base URL if needed.
