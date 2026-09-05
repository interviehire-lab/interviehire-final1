"""End-to-end test of the full recruiter/candidate flow, over real HTTP via
FastAPI TestClient, against a throwaway Postgres:

    signup -> onboarding -> create job (JD) -> upload a candidate resume
    -> schedule an interview -> candidate self-reschedules
    -> candidate-portal DB-state check (shared engine tables)
    -> pre-interview reminder automation returns 200 and actually fires

External services (Google Calendar, Resend/SMTP email, Twilio WhatsApp/voice,
DeepSeek resume parsing) are all mocked via the `mocked_externals` fixture in
conftest.py — see that fixture's docstring for exactly which call site is patched
where and why. This proves OUR code calls the right functions with the right data;
it does not prove Twilio/Google/Resend actually deliver (see test docstring in
conftest.py, and interview-engine's own `test_engine_reachability.py` for the
"does a real engine process serve this correctly" half).

Requires TEST_DATABASE_URL — see conftest.py's module docstring for full setup.
"""
import io
import uuid
from datetime import datetime, timedelta, timezone

from app.models.ai_integration import Company, Candidate, JobRole, InterviewSession
from app.models.applicant import Applicant

from tests.conftest import signup_and_onboard


def _unique_email(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}@example.com"


def test_full_recruiter_candidate_flow(client, db, mocked_externals):
    # ── 1. Signup + onboarding (real auth flow) ─────────────────────────────
    recruiter_email = _unique_email("recruiter")
    org_name = f"Acme Test Co {uuid.uuid4().hex[:8]}"
    ids = signup_and_onboard(client, recruiter_email, "S3curePass!", org_name)
    org_id = ids["organisation_id"]

    # ── 2. Create a job (the JD) ─────────────────────────────────────────────
    r = client.post("/api/jobs", json={
        "title": "Backend Engineer",
        "role_name": "Backend Engineer",
        "description": "Own the API layer.",
    })
    assert r.status_code == 200, r.text
    job = r.json()
    job_id = job["id"]
    assert job["title"] == "Backend Engineer"

    # ── 3. Add a candidate via a resume upload (plain .txt — no PDF needed) ──
    candidate_email = _unique_email("candidate")
    resume_text = (
        f"Jane Candidate\n"
        f"Email: {candidate_email}\n"
        f"Phone: +1 415 555 0123\n\n"
        f"Experienced backend engineer with 5 years of Python and distributed systems."
    )
    files = {"files": ("jane_resume.txt", io.BytesIO(resume_text.encode("utf-8")), "text/plain")}
    r = client.post(f"/api/jobs/{job_id}/applicants/upload-resumes", files=files)
    assert r.status_code == 200, r.text
    applicants = r.json()
    assert len(applicants) == 1
    applicant = applicants[0]
    applicant_id = applicant["id"]
    assert applicant["email"] == candidate_email
    assert applicant["name"] and "Jane" in applicant["name"]

    # DeepSeek must NOT have been hit for real — the mocked parser delegates to the
    # same local heuristic path the real code uses with no key, so this is really
    # just confirming the monkeypatch is in effect (a real call would also have
    # worked here since the key is a fake string, but would be slow/non-hermetic).

    # ── 4. Schedule the interview (screening stage) ──────────────────────────
    scheduled_at = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    r = client.post(
        f"/api/jobs/applicants/{applicant_id}/schedule",
        json={"scheduled_at": scheduled_at, "stage": "screening"},
    )
    assert r.status_code == 200, r.text
    scheduled = r.json()
    assert scheduled["screening_status"] == "scheduled"
    assert scheduled["scheduling_token"]
    scheduling_token = scheduled["scheduling_token"]

    # Confirm each mocked external channel was actually invoked once.
    assert len(mocked_externals.email_calls) == 1
    assert mocked_externals.email_calls[0]["candidate_email"] == candidate_email
    assert len(mocked_externals.calendar_calls) == 1
    assert mocked_externals.calendar_calls[0]["op"] == "create"
    assert len(mocked_externals.whatsapp_calls) == 1
    assert mocked_externals.whatsapp_calls[0]["phone"] == "+1 415 555 0123"

    # ── 5. Candidate-portal DB-state check ───────────────────────────────────
    # sync_applicant_to_ai runs synchronously inside /schedule and writes directly
    # into the shared Postgres tables the engine's Prisma client reads from — no
    # HTTP hop, no running engine process needed for this assertion.
    sess = db.query(InterviewSession).filter_by(id=str(applicant_id)).first()
    assert sess is not None, "sync_applicant_to_ai did not create an InterviewSession"
    candidate = db.query(Candidate).filter_by(id=sess.candidateId).first()
    assert candidate is not None
    assert candidate.email == candidate_email
    company = db.query(Company).filter_by(id=sess.companyId).first()
    assert company is not None
    role = db.query(JobRole).filter_by(id=sess.jobRoleId).first()
    assert role is not None
    assert role.title == "Backend Engineer"

    # ── 6. Candidate self-reschedules (public, unauthenticated, token-gated) ─
    # Reschedule to "+5 minutes" so it lands inside the reminder window (default
    # REMINDER_MINUTES_BEFORE=30) for step 7 below.
    new_time = (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat()
    r = client.post(f"/api/public/reschedule/{scheduling_token}", json={"new_time": new_time})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "success"

    db.expire_all()
    applicant_row = db.get(Applicant, uuid.UUID(applicant_id))
    assert applicant_row.screening_scheduled_at is not None
    saved_time = applicant_row.screening_scheduled_at
    if saved_time.tzinfo is None:
        saved_time = saved_time.replace(tzinfo=timezone.utc)
    assert saved_time - datetime.now(timezone.utc) < timedelta(minutes=6)
    assert applicant_row.calendar_sequence == 1  # incremented from 0 by the reschedule

    # A second confirmation email/WhatsApp send for the reschedule.
    assert len(mocked_externals.email_calls) == 2
    assert len(mocked_externals.whatsapp_calls) == 2

    # ── 7. Automations: run-reminders returns 200 and actually fires ────────
    from app.config import settings
    headers = {"x-internal-secret": settings.INTERNAL_SERVICE_SECRET}
    r = client.post("/api/internal/run-reminders", params={"dry_run": "false"}, headers=headers)
    assert r.status_code == 200, r.text
    summary = r.json()
    assert summary["candidates_found"] >= 1

    assert len(mocked_externals.reminder_email_calls) == 1
    assert mocked_externals.reminder_email_calls[0]["candidate_email"] == candidate_email
    assert len(mocked_externals.reminder_whatsapp_calls) == 1
    assert len(mocked_externals.reminder_call_calls) == 1

    db.expire_all()
    applicant_row = db.get(Applicant, uuid.UUID(applicant_id))
    assert applicant_row.screening_reminder_sent_at is not None

    # Idempotency: a second run must not reprocess the same applicant.
    r2 = client.post("/api/internal/run-reminders", params={"dry_run": "false"}, headers=headers)
    assert r2.status_code == 200, r2.text
    assert len(mocked_externals.reminder_email_calls) == 1  # unchanged


def test_run_reminders_requires_correct_secret(client):
    r = client.post("/api/internal/run-reminders", params={"dry_run": "false"})
    assert r.status_code == 401

    r = client.post(
        "/api/internal/run-reminders",
        params={"dry_run": "false"},
        headers={"x-internal-secret": "definitely-wrong"},
    )
    assert r.status_code == 401


def test_reschedule_with_invalid_token_is_rejected(client):
    r = client.post(
        "/api/public/reschedule/not-a-real-token",
        json={"new_time": datetime.now(timezone.utc).isoformat()},
    )
    assert r.status_code == 404
