"""Pre-interview reminder job — email + WhatsApp + robocall, fired shortly before a
candidate's scheduled interview slot.

Modeled directly on ``app/jobs/retention.py``'s shape: a plain importable function
taking ``(db, dry_run, limit)`` and returning a summary dict, a CLI entrypoint, and
an internal-secret-gated endpoint (``app/routers/internal_jobs.py``) that calls it.

Unlike retention, this job has **no global disable switch** — the reminder EMAIL is
always attempted (it doesn't depend on any Twilio config). Only the Twilio-backed
channels (WhatsApp / robocall) individually no-op when Twilio isn't configured or the
applicant has no usable phone number (see ``app/utils/twilio_client.py`` /
``app/utils/phone.py``) — a failure or no-op on one channel never blocks the others,
and never blocks marking the reminder as sent.

Timing precision: this job fires the reminder exactly once per applicant per stage,
the first time it observes that applicant inside the reminder window (i.e. the run
whose ``{stage}_scheduled_at`` first falls at or before
``now() + REMINDER_MINUTES_BEFORE`` while still after `now()`). Actual lead time
therefore depends on how often this job is invoked — e.g. run every 5 minutes, an
applicant scheduled to enter the window between two runs gets anywhere from
``REMINDER_MINUTES_BEFORE`` minutes down to (``REMINDER_MINUTES_BEFORE`` - <cron
interval>) minutes of actual notice. This is NOT exact-30-minute precision; don't
mistake it for one.

Trigger it however your host allows — both share this one function:
- CLI:      ``python -m app.jobs.reminders [--dry-run] [--limit N]``
- Endpoint: ``POST /api/internal/run-reminders`` (x-internal-secret; ``?dry_run=false`` to arm)
"""
from datetime import datetime, timezone, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal
from app.models.applicant import Applicant, InterviewStatus
from app.models.job import Job
from app.utils.email_sender import send_interview_reminder_email
from app.utils.twilio_client import build_content_variables, send_whatsapp_message, place_reminder_call

# stage key -> (scheduled_at column, status column, reminder_sent_at column, display name)
STAGES = {
    "screening": ("screening_scheduled_at", "screening_status", "screening_reminder_sent_at", "Recruiter Screening"),
    "functional": ("functional_scheduled_at", "functional_status", "functional_reminder_sent_at", "Functional Interview"),
}


def select_due(db: Session, stage_key: str, minutes_before: int, limit: int):
    """Applicants due a reminder for one stage: scheduled, still in the future, due
    within the reminder window, status still 'scheduled', and not yet reminded."""
    scheduled_col, status_col, sent_col, _ = STAGES[stage_key]
    scheduled_at = getattr(Applicant, scheduled_col)
    status = getattr(Applicant, status_col)
    reminder_sent_at = getattr(Applicant, sent_col)

    now = datetime.now(timezone.utc)
    window_end = now + timedelta(minutes=minutes_before)

    return (
        db.query(Applicant)
        .filter(scheduled_at.isnot(None))
        .filter(scheduled_at > now)
        .filter(scheduled_at <= window_end)
        .filter(reminder_sent_at.is_(None))
        .filter(status == InterviewStatus.scheduled)
        .order_by(scheduled_at.asc())
        .limit(limit)
        .all()
    )


def _build_interview_link(applicant: Applicant) -> str:
    """Identical construction to the schedule/reschedule routes in jobs.py/public.py."""
    job_qs = f"&jobId={applicant.job_id}" if applicant.job_id else ""
    return f"{settings.INTERVIEW_ROOM_URL.rstrip('/')}/interviewcandidateroom?sessionId={applicant.id}{job_qs}"


def run_reminders(db: Session, *, dry_run: bool = True, limit: Optional[int] = None) -> dict:
    """Run one reminder batch across both stages. Returns a summary dict.

    No global disable switch — email is attempted unconditionally; WhatsApp/call are
    independently best-effort per applicant+stage and never block each other, the
    email, or (outside dry-run) marking the reminder sent.
    """
    batch = limit or settings.REMINDER_MAX_PER_RUN
    minutes_before = settings.REMINDER_MINUTES_BEFORE

    result = {
        "dry_run": dry_run,
        "minutes_before": minutes_before,
        "candidates_found": 0,
        "emails_sent": 0,
        "whatsapp_sent": 0,
        "calls_placed": 0,
        "errors": 0,
    }
    dry_run_sample = []

    remaining = batch
    for stage_key, (scheduled_col, status_col, sent_col, stage_name) in STAGES.items():
        if remaining <= 0:
            break
        due = select_due(db, stage_key, minutes_before, remaining)
        remaining -= len(due)
        result["candidates_found"] += len(due)

        for applicant in due:
            if dry_run:
                dry_run_sample.append({"applicant_id": str(applicant.id), "stage": stage_key})
                continue

            scheduled_at = getattr(applicant, scheduled_col)
            job = db.query(Job).filter(Job.id == applicant.job_id).first()
            job_title = (job.role_name or job.title) if job else "General Position"
            interview_link = _build_interview_link(applicant)
            first_name = (applicant.name or "").strip().split(" ")[0] or "there"

            # Email — always attempted, independent of Twilio config.
            try:
                send_interview_reminder_email(
                    candidate_name=applicant.name,
                    candidate_email=applicant.email,
                    job_title=job_title,
                    stage_name=stage_name,
                    start_time=scheduled_at,
                    interview_link=interview_link,
                )
                result["emails_sent"] += 1
            except Exception:
                result["errors"] += 1

            # WhatsApp — best-effort, independent of the email/call outcome. No-ops
            # internally (returns False) when Twilio isn't configured or the phone
            # number isn't real; never raises.
            try:
                reminder_content_sid = settings.TWILIO_WHATSAPP_REMINDER_CONTENT_SID
                if reminder_content_sid:
                    wa_sent = send_whatsapp_message(
                        applicant.phone,
                        content_sid=reminder_content_sid,
                        content_variables=build_content_variables(
                            settings.TWILIO_WHATSAPP_REMINDER_VARIABLE_ORDER,
                            {
                                "first_name": first_name,
                                "stage_name": stage_name,
                                "job_title": job_title,
                                "minutes_before": str(minutes_before),
                                "interview_link": interview_link,
                            },
                        ),
                    )
                else:
                    wa_body = (
                        f"Hi {first_name}, your {stage_name} interview for {job_title} "
                        f"starts in {minutes_before} minutes.\n"
                        f"Join here: {interview_link}"
                    )
                    wa_sent = send_whatsapp_message(applicant.phone, body=wa_body)
                if wa_sent:
                    result["whatsapp_sent"] += 1
            except Exception:
                result["errors"] += 1

            # Robocall — best-effort, independent of the email/WhatsApp outcome.
            try:
                say_message = (
                    f"Hi {first_name}, this is a reminder that your {stage_name} interview "
                    f"for {job_title} starts in {minutes_before} minutes. "
                    f"Please check your email for the join link."
                )
                if place_reminder_call(applicant.phone, say_message):
                    result["calls_placed"] += 1
            except Exception:
                result["errors"] += 1

            # Mark sent regardless of individual channel outcomes above — the
            # reminder attempt happened; we don't retry on next run.
            setattr(applicant, sent_col, datetime.now(timezone.utc))
            db.add(applicant)
            db.commit()

    if dry_run:
        result["sample"] = dry_run_sample[:20]

    return result


def main(argv=None) -> None:
    import argparse
    parser = argparse.ArgumentParser(description="Run the pre-interview reminder job (email + WhatsApp + robocall).")
    parser.add_argument("--dry-run", action="store_true", help="report only; send nothing")
    parser.add_argument("--limit", type=int, default=None, help="max applicants this run")
    args = parser.parse_args(argv)

    db = SessionLocal()
    try:
        print(run_reminders(db, dry_run=args.dry_run, limit=args.limit))
    finally:
        db.close()


if __name__ == "__main__":
    main()
