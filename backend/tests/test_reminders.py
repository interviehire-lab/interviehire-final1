"""Edge-case coverage for the pre-interview reminder job (app/jobs/reminders.py) and
the reminder-flag reset on reschedule (app/routers/public.py, app/routers/jobs.py).

test_full_flow.py already covers the happy path end-to-end (schedule -> reminder
fires -> idempotent on a second run). This file fills in the edge cases around it:
reschedule-must-re-arm-the-reminder (a real bug fixed in this codebase), the
reminder window boundary, exclusion filters (status/removed/already-passed), each
channel's independent failure handling, the Twilio-not-configured / no-phone no-op
paths, and dry-run safety.

Requires TEST_DATABASE_URL — see conftest.py's module docstring for setup.
"""
import io
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.database import Base
from app.jobs.reminders import run_reminders
from app.models.applicant import Applicant, InterviewStatus

from tests.conftest import signup_and_onboard


def _unique_email(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}@example.com"


@pytest.fixture(scope="module")
def authed_client(db_engine):
    """One signed-up recruiter shared by every test in this file. Signup is
    per-IP rate-limited (10 / 5 min, shared across every rate-limited endpoint —
    see app/routers/invites.py::_rate_limit) and TestClient requests all share
    one synthetic IP, so signing up fresh per test exhausts that budget well
    before this file finishes. Jobs/resumes/schedules aren't rate-limited, so
    one recruiter is plenty — each test still gets its own fresh job/applicant."""
    from main import app
    # Self-healing: test_privacy_api.py / test_data_rights.py / test_retention.py
    # each drop the backend-owned tables at the end of every test of theirs and
    # rely on their OWN local fixtures to recreate them before their next test —
    # they never re-create it for whoever runs after them. conftest.py's db_engine
    # only runs create_all once per session, so this file can start with those
    # tables missing purely because of which other test files ran earlier in the
    # same `pytest tests/` invocation. create_all is idempotent (only creates
    # what's missing), so re-asserting it here costs nothing and makes this file's
    # pass/fail independent of test-file ordering.
    Base.metadata.create_all(bind=db_engine)
    c = TestClient(app)
    signup_and_onboard(c, _unique_email("reminder-recruiter"), "S3curePass!", f"Acme Reminder Co {uuid.uuid4().hex[:8]}")
    return c


def _schedule_applicant(authed_client, minutes_from_now: float, stage: str = "screening", phone: str = "+14155550123"):
    """Fresh job -> resume upload -> schedule, through the actual HTTP endpoints
    (same as test_full_flow.py) under the shared `authed_client` recruiter, so
    the applicant row looks exactly like one created by the real recruiter flow.
    Returns the applicant id (str)."""
    r = authed_client.post("/api/jobs", json={"title": "QA Engineer", "role_name": "QA Engineer"})
    assert r.status_code == 200, r.text
    job_id = r.json()["id"]

    candidate_email = _unique_email("candidate")
    resume_text = f"Test Candidate\nEmail: {candidate_email}\nPhone: {phone}\n\nQA engineer."
    files = {"files": ("resume.txt", io.BytesIO(resume_text.encode("utf-8")), "text/plain")}
    r = authed_client.post(f"/api/jobs/{job_id}/applicants/upload-resumes", files=files)
    assert r.status_code == 200, r.text
    applicant_id = r.json()[0]["id"]

    scheduled_at = (datetime.now(timezone.utc) + timedelta(minutes=minutes_from_now)).isoformat()
    r = authed_client.post(
        f"/api/jobs/applicants/{applicant_id}/schedule",
        json={"scheduled_at": scheduled_at, "stage": stage},
    )
    assert r.status_code == 200, r.text
    return applicant_id


# ─── Reminder-flag reset on reschedule (regression) ─────────────────────────────

def test_public_reschedule_rearms_a_reminder_already_sent(authed_client, db, mocked_externals):
    """The exact bug this was fixed for: a reminder fires, the candidate then
    reschedules, and the OLD reminder_sent_at must not permanently suppress all
    future reminders for the new time."""
    applicant_id = _schedule_applicant(authed_client, minutes_from_now=5)  # inside the reminder window

    r1 = run_reminders(db, dry_run=False)
    assert r1["candidates_found"] == 1
    db.expire_all()
    applicant = db.get(Applicant, uuid.UUID(applicant_id))
    assert applicant.screening_reminder_sent_at is not None
    scheduling_token = applicant.scheduling_token

    # Candidate reschedules to a new time, still within the window.
    new_time = (datetime.now(timezone.utc) + timedelta(minutes=6)).isoformat()
    r = authed_client.post(f"/api/public/reschedule/{scheduling_token}", json={"new_time": new_time})
    assert r.status_code == 200, r.text

    db.expire_all()
    applicant = db.get(Applicant, uuid.UUID(applicant_id))
    assert applicant.screening_reminder_sent_at is None, "reschedule must clear the stale reminder flag"

    r2 = run_reminders(db, dry_run=False)
    assert r2["candidates_found"] == 1, "the rescheduled interview must be able to fire a reminder again"
    assert len(mocked_externals.reminder_email_calls) == 2  # once before reschedule, once after


def test_recruiter_reschedule_rearms_a_reminder_already_sent(authed_client, db, mocked_externals):
    """Same bug, via the recruiter-driven reschedule path (POST .../schedule called
    a second time), and on the functional stage instead of screening."""
    applicant_id = _schedule_applicant(authed_client, minutes_from_now=5, stage="functional")

    r1 = run_reminders(db, dry_run=False)
    assert r1["candidates_found"] == 1
    db.expire_all()
    applicant = db.get(Applicant, uuid.UUID(applicant_id))
    assert applicant.functional_reminder_sent_at is not None

    new_time = (datetime.now(timezone.utc) + timedelta(minutes=6)).isoformat()
    r = authed_client.post(
        f"/api/jobs/applicants/{applicant_id}/schedule",
        json={"scheduled_at": new_time, "stage": "functional"},
    )
    assert r.status_code == 200, r.text

    db.expire_all()
    applicant = db.get(Applicant, uuid.UUID(applicant_id))
    assert applicant.functional_reminder_sent_at is None

    r2 = run_reminders(db, dry_run=False)
    assert r2["candidates_found"] == 1


# ─── Reminder window ─────────────────────────────────────────────────────────

def test_reminder_not_sent_when_scheduled_time_is_well_outside_the_window(authed_client, db, mocked_externals):
    _schedule_applicant(authed_client, minutes_from_now=settings.REMINDER_MINUTES_BEFORE + 15)

    result = run_reminders(db, dry_run=False)

    assert result["candidates_found"] == 0
    assert len(mocked_externals.reminder_email_calls) == 0


def test_reminder_sent_just_inside_the_window(authed_client, db, mocked_externals):
    _schedule_applicant(authed_client, minutes_from_now=settings.REMINDER_MINUTES_BEFORE - 1)

    result = run_reminders(db, dry_run=False)

    assert result["candidates_found"] == 1
    assert len(mocked_externals.reminder_email_calls) == 1


def test_reminder_not_sent_once_the_scheduled_time_has_already_passed(authed_client, db, mocked_externals):
    """If the job runs late (or was down) and the interview slot is already in the
    past, don't tell a candidate their already-started-or-missed interview 'starts
    in 30 minutes'."""
    applicant_id = _schedule_applicant(authed_client, minutes_from_now=10)
    applicant = db.get(Applicant, uuid.UUID(applicant_id))
    applicant.screening_scheduled_at = datetime.now(timezone.utc) - timedelta(minutes=5)
    db.add(applicant)
    db.commit()

    result = run_reminders(db, dry_run=False)

    assert result["candidates_found"] == 0
    assert len(mocked_externals.reminder_email_calls) == 0


# ─── Exclusion filters ───────────────────────────────────────────────────────

@pytest.mark.parametrize("status", [InterviewStatus.completed, InterviewStatus.slot_missed, InterviewStatus.incomplete])
def test_reminder_excludes_applicants_not_in_scheduled_status(authed_client, db, mocked_externals, status):
    applicant_id = _schedule_applicant(authed_client, minutes_from_now=5)
    applicant = db.get(Applicant, uuid.UUID(applicant_id))
    applicant.screening_status = status
    db.add(applicant)
    db.commit()

    result = run_reminders(db, dry_run=False)

    assert result["candidates_found"] == 0


def test_reminder_excludes_a_removed_applicant(authed_client, db, mocked_externals):
    applicant_id = _schedule_applicant(authed_client, minutes_from_now=5)
    applicant = db.get(Applicant, uuid.UUID(applicant_id))
    applicant.removed_at = datetime.now(timezone.utc)
    db.add(applicant)
    db.commit()

    result = run_reminders(db, dry_run=False)

    assert result["candidates_found"] == 0


# ─── Per-channel independence ────────────────────────────────────────────────

def test_email_failure_does_not_block_whatsapp_or_call_and_still_marks_sent(authed_client, db, mocked_externals, monkeypatch, caplog):
    applicant_id = _schedule_applicant(authed_client, minutes_from_now=5)

    def _boom(**kwargs):
        raise RuntimeError("Mailgun is down")

    monkeypatch.setattr("app.jobs.reminders.send_interview_reminder_email", _boom)

    with caplog.at_level("ERROR"):
        result = run_reminders(db, dry_run=False)

    assert result["emails_sent"] == 0
    assert result["whatsapp_sent"] == 1
    assert result["sms_sent"] == 1
    assert result["calls_placed"] == 1
    assert result["errors"] == 1
    assert "Reminder email failed" in caplog.text

    db.expire_all()
    applicant = db.get(Applicant, uuid.UUID(applicant_id))
    assert applicant.screening_reminder_sent_at is not None, "still marked sent — we don't retry a half-failed attempt"


def test_whatsapp_failure_does_not_block_email_or_call(authed_client, db, mocked_externals, monkeypatch, caplog):
    applicant_id = _schedule_applicant(authed_client, minutes_from_now=5)

    def _boom(*args, **kwargs):
        raise RuntimeError("Twilio 500")

    monkeypatch.setattr("app.jobs.reminders.send_whatsapp_message", _boom)

    with caplog.at_level("ERROR"):
        result = run_reminders(db, dry_run=False)

    assert result["emails_sent"] == 1
    assert result["whatsapp_sent"] == 0
    assert result["sms_sent"] == 1
    assert result["calls_placed"] == 1
    assert result["errors"] == 1
    assert "Reminder WhatsApp send failed" in caplog.text

    db.expire_all()
    applicant = db.get(Applicant, uuid.UUID(applicant_id))
    assert applicant.screening_reminder_sent_at is not None


def test_sms_failure_does_not_block_email_or_whatsapp_or_call(authed_client, db, mocked_externals, monkeypatch, caplog):
    applicant_id = _schedule_applicant(authed_client, minutes_from_now=5)

    def _boom(*args, **kwargs):
        raise RuntimeError("Twilio 500")

    monkeypatch.setattr("app.jobs.reminders.send_sms_message", _boom)

    with caplog.at_level("ERROR"):
        result = run_reminders(db, dry_run=False)

    assert result["emails_sent"] == 1
    assert result["whatsapp_sent"] == 1
    assert result["sms_sent"] == 0
    assert result["calls_placed"] == 1
    assert result["errors"] == 1
    assert "Reminder SMS send failed" in caplog.text

    db.expire_all()
    applicant = db.get(Applicant, uuid.UUID(applicant_id))
    assert applicant.screening_reminder_sent_at is not None


def test_call_failure_does_not_block_email_or_whatsapp(authed_client, db, mocked_externals, monkeypatch, caplog):
    applicant_id = _schedule_applicant(authed_client, minutes_from_now=5)

    def _boom(*args, **kwargs):
        raise RuntimeError("Twilio 500")

    monkeypatch.setattr("app.jobs.reminders.place_reminder_call", _boom)

    with caplog.at_level("ERROR"):
        result = run_reminders(db, dry_run=False)

    assert result["emails_sent"] == 1
    assert result["whatsapp_sent"] == 1
    assert result["sms_sent"] == 1
    assert result["calls_placed"] == 0
    assert result["errors"] == 1
    assert "Reminder call failed" in caplog.text

    db.expire_all()
    applicant = db.get(Applicant, uuid.UUID(applicant_id))
    assert applicant.screening_reminder_sent_at is not None


# ─── Twilio/phone no-op paths (zero-key path must keep working) ─────────────

def test_reminder_skips_twilio_channels_when_twilio_is_not_configured(authed_client, db, monkeypatch, caplog):
    """Exercises the REAL twilio_client functions (not the mocked_externals fixture)
    with Twilio deliberately unconfigured — both channels must no-op (return False,
    no network call, no exception), and email must still go out."""
    applicant_id = _schedule_applicant(authed_client, minutes_from_now=5)

    monkeypatch.setattr(settings, "TWILIO_ACCOUNT_SID", "")
    monkeypatch.setattr(settings, "TWILIO_AUTH_TOKEN", "")
    monkeypatch.setattr(settings, "TWILIO_API_KEY_SID", "")
    monkeypatch.setattr(settings, "TWILIO_API_KEY_SECRET", "")
    monkeypatch.setattr("app.jobs.reminders.send_interview_reminder_email", lambda **kwargs: None)

    with caplog.at_level("INFO"):
        result = run_reminders(db, dry_run=False)

    assert result["emails_sent"] == 1
    assert result["whatsapp_sent"] == 0
    assert result["sms_sent"] == 0
    assert result["calls_placed"] == 0
    assert result["errors"] == 0  # a configured-off Twilio is not an error condition
    assert "Twilio not configured" in caplog.text

    db.expire_all()
    applicant = db.get(Applicant, uuid.UUID(applicant_id))
    assert applicant.screening_reminder_sent_at is not None


def test_reminder_skips_twilio_channels_when_applicant_has_no_usable_phone(authed_client, db, monkeypatch):
    """Real twilio_client functions again, Twilio configured this time, but the
    applicant has no phone on file — must degrade gracefully, not crash the job."""
    applicant_id = _schedule_applicant(authed_client, minutes_from_now=5)
    applicant = db.get(Applicant, uuid.UUID(applicant_id))
    applicant.phone = None
    db.add(applicant)
    db.commit()

    monkeypatch.setattr(settings, "TWILIO_ACCOUNT_SID", "ACfaketestaccountsid00000000000000")
    monkeypatch.setattr(settings, "TWILIO_AUTH_TOKEN", "fake-auth-token")
    monkeypatch.setattr("app.jobs.reminders.send_interview_reminder_email", lambda **kwargs: None)

    result = run_reminders(db, dry_run=False)

    assert result["whatsapp_sent"] == 0
    assert result["sms_sent"] == 0
    assert result["calls_placed"] == 0
    assert result["errors"] == 0

    db.expire_all()
    applicant = db.get(Applicant, uuid.UUID(applicant_id))
    assert applicant.screening_reminder_sent_at is not None, "email-only reminder still counts as sent"


# ─── dry-run safety ──────────────────────────────────────────────────────────

def test_dry_run_sends_nothing_and_does_not_mark_sent(authed_client, db, mocked_externals):
    applicant_id = _schedule_applicant(authed_client, minutes_from_now=5)

    result = run_reminders(db, dry_run=True)

    assert result["candidates_found"] == 1
    assert any(s["applicant_id"] == applicant_id for s in result["sample"])
    assert len(mocked_externals.reminder_email_calls) == 0
    assert len(mocked_externals.reminder_whatsapp_calls) == 0
    assert len(mocked_externals.reminder_sms_calls) == 0
    assert len(mocked_externals.reminder_call_calls) == 0

    db.expire_all()
    applicant = db.get(Applicant, uuid.UUID(applicant_id))
    assert applicant.screening_reminder_sent_at is None

    # Dry-run deliberately leaves this applicant un-reminded and still inside the
    # window — select_due() is a global, unscoped query, so left as-is it would
    # leak into (and inflate the count for) any later test in this module that
    # also calls run_reminders(). Clean it up the same way a recruiter removing
    # a candidate would, now that this test is done with it.
    applicant.removed_at = datetime.now(timezone.utc)
    db.add(applicant)
    db.commit()


# ─── Per-run cap ─────────────────────────────────────────────────────────────

def test_run_reminders_caps_total_candidates_at_the_limit(authed_client, db, mocked_externals):
    """Documents current behaviour: the per-run limit is applied per stage in
    insertion order (screening, then functional) — a tight limit can fully starve
    the functional stage on a run where screening alone fills the quota. If this
    stage-priority behaviour ever changes, update this test rather than deleting it."""
    applicant_ids = [_schedule_applicant(authed_client, minutes_from_now=5, stage="screening") for _ in range(3)]
    applicant_ids.append(_schedule_applicant(authed_client, minutes_from_now=5, stage="functional"))

    result = run_reminders(db, dry_run=False, limit=2)

    assert result["candidates_found"] == 2
    assert result["emails_sent"] == 2

    # limit=2 leaves 2 of these 4 applicants permanently un-reminded (never even
    # fetched by select_due, same as the dry-run test above) — select_due() is a
    # global, unscoped query, so left in "scheduled" + still-due-now they'd leak
    # into (and inflate the count for) any later test/file in this same pytest
    # session that also calls run_reminders() against the shared DB (this bit
    # test_full_flow.py before this cleanup existed). Remove all four the same
    # way a recruiter removing a candidate would, regardless of which 2 were
    # actually consumed.
    for applicant_id in applicant_ids:
        applicant = db.get(Applicant, uuid.UUID(applicant_id))
        applicant.removed_at = datetime.now(timezone.utc)
        db.add(applicant)
    db.commit()
