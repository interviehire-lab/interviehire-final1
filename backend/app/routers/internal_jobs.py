"""Internal-only ops endpoints for backend cron-style jobs that don't have a home in
a recruiter/candidate-facing router. Same shared-secret auth pattern as
`app/routers/privacy.py`'s `POST /api/privacy/internal/run-retention`.
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db

router = APIRouter()


def _require_internal_secret(request: Request) -> None:
    secret = request.headers.get("x-internal-secret")
    if not settings.INTERNAL_SERVICE_SECRET or secret != settings.INTERNAL_SERVICE_SECRET:
        raise HTTPException(status_code=401, detail="unauthorized")


@router.post("/run-reminders")
def run_reminders_endpoint(request: Request, db: Session = Depends(get_db)):
    """Run the pre-interview reminder batch (email + WhatsApp + robocall,
    ~REMINDER_MINUTES_BEFORE the scheduled start). Internal-only (shared secret).
    Defaults to DRY-RUN; pass ?dry_run=false to actually send. Trigger from a host
    cron or an external pinger (e.g. every 5 minutes)."""
    _require_internal_secret(request)
    dry = request.query_params.get("dry_run", "true").lower() != "false"
    from app.jobs.reminders import run_reminders
    return run_reminders(db, dry_run=dry)


@router.get("/integrations/status")
def integrations_status(request: Request):
    """Secret-free readiness diagnostics for deployment setup."""
    _require_internal_secret(request)
    has_api_key = bool(settings.TWILIO_API_KEY_SID and settings.TWILIO_API_KEY_SECRET)
    has_auth_token = bool(settings.TWILIO_AUTH_TOKEN)
    return {
        "twilio": {
            "account_configured": bool(settings.TWILIO_ACCOUNT_SID),
            "authentication_configured": has_api_key or has_auth_token,
            "authentication_mode": "api_key" if has_api_key else "auth_token" if has_auth_token else None,
            "whatsapp_sender_configured": bool(settings.TWILIO_WHATSAPP_FROM),
            "voice_sender_configured": bool(settings.TWILIO_VOICE_FROM),
            "confirmation_template_configured": bool(settings.TWILIO_WHATSAPP_CONFIRMATION_CONTENT_SID),
            "reminder_template_configured": bool(settings.TWILIO_WHATSAPP_REMINDER_CONTENT_SID),
            "confirmation_variable_order": settings.TWILIO_WHATSAPP_CONFIRMATION_VARIABLE_ORDER,
            "reminder_variable_order": settings.TWILIO_WHATSAPP_REMINDER_VARIABLE_ORDER,
        },
        "reminders": {
            "minutes_before": settings.REMINDER_MINUTES_BEFORE,
            "max_per_run": settings.REMINDER_MAX_PER_RUN,
        },
    }
