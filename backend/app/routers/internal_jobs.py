"""Internal-only ops endpoints for backend cron-style jobs that don't have a home in
a recruiter/candidate-facing router. Same shared-secret auth pattern as
`app/routers/privacy.py`'s `POST /api/privacy/internal/run-retention`.
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db

router = APIRouter()


@router.post("/run-reminders")
def run_reminders_endpoint(request: Request, db: Session = Depends(get_db)):
    """Run the pre-interview reminder batch (email + WhatsApp + robocall,
    ~REMINDER_MINUTES_BEFORE the scheduled start). Internal-only (shared secret).
    Defaults to DRY-RUN; pass ?dry_run=false to actually send. Trigger from a host
    cron or an external pinger (e.g. every 5 minutes)."""
    secret = request.headers.get("x-internal-secret")
    if not settings.INTERNAL_SERVICE_SECRET or secret != settings.INTERNAL_SERVICE_SECRET:
        raise HTTPException(status_code=401, detail="unauthorized")
    dry = request.query_params.get("dry_run", "true").lower() != "false"
    from app.jobs.reminders import run_reminders
    return run_reminders(db, dry_run=dry)
