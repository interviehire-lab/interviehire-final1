"""Shared pytest fixtures for backend/tests/.

Requires a THROWAWAY Postgres — set TEST_DATABASE_URL; every DB-backed test in this
suite skips without it (same convention the existing test_*.py files already use):

    docker run --rm -d --name ih-test-pg -e POSTGRES_PASSWORD=pass -e POSTGRES_DB=ih_test -p 5433:5432 postgres:16
    export TEST_DATABASE_URL=postgresql://postgres:pass@localhost:5433/ih_test

The engine-side tables (Company/Candidate/JobRole/Question/InterviewSession/...) must
exist with Prisma's exact schema BEFORE running — push it once per fresh DB:

    cd interview-engine/apps/api
    DATABASE_URL=postgresql://postgres:pass@localhost:5433/ih_test npx prisma db push --skip-generate --accept-data-loss

Then: `pytest backend/tests -v` from `backend/`.
"""
import os
import sys
from dataclasses import dataclass, field

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

TEST_DB = os.environ.get("TEST_DATABASE_URL")
_SKIP_REASON = (
    "set TEST_DATABASE_URL to a disposable Postgres (with the engine's Prisma schema "
    "already pushed — see this file's module docstring) to run these"
)

if TEST_DB:
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from fastapi.testclient import TestClient

    import app.models  # noqa: F401 — registers every model (incl. ai_integration) on Base
    from app.database import Base, get_db
    from main import app

    # Own engine bound to the throwaway DB; override get_db so it's used regardless of
    # whatever the real app's engine points at (import-order-safe) — same pattern as
    # the existing test_privacy_api.py / test_data_rights.py / test_retention.py.
    _engine = create_engine(TEST_DB)
    _TestingSession = sessionmaker(bind=_engine)

    def _override_get_db():
        db = _TestingSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _override_get_db


@pytest.fixture(scope="session")
def db_engine():
    if not TEST_DB:
        pytest.skip(_SKIP_REASON)
    Base.metadata.create_all(bind=_engine)
    yield _engine
    # Deliberately no drop_all: the engine-side tables were created by `prisma db push`,
    # not create_all, so dropping them here would require re-pushing before the next
    # run. Tests use unique emails/ids per run instead of relying on a clean slate.


@pytest.fixture
def db(db_engine):
    session = _TestingSession()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client(db_engine):
    return TestClient(app)


@dataclass
class CallRecorder:
    """Records every mocked external-service call so tests can assert on count/args,
    not just 'the endpoint didn't crash'."""
    email_calls: list = field(default_factory=list)
    calendar_calls: list = field(default_factory=list)
    whatsapp_calls: list = field(default_factory=list)
    reminder_email_calls: list = field(default_factory=list)
    reminder_whatsapp_calls: list = field(default_factory=list)
    reminder_call_calls: list = field(default_factory=list)


@pytest.fixture
def mocked_externals(monkeypatch):
    """Patch every external-service call site touched by the schedule/reschedule/reminder
    flow, at the exact import path each caller actually resolves it from:

    - schedule_interview (app/routers/jobs.py) imports email/calendar/WhatsApp LOCALLY
      inside the function body -> patch the ORIGIN modules.
    - public_reschedule_interview (app/routers/public.py) imports calendar/email at
      MODULE TOP -> must patch the name as bound in app.routers.public's own namespace;
      WhatsApp is imported locally there too -> origin-module patch works for it.
    - run_reminders (app/jobs/reminders.py) imports all three send functions at MODULE
      TOP -> patch as bound in app.jobs.reminders.
    - upload_resumes (app/routers/jobs.py) imports DeepSeek resume parsing locally.

    backend/.env has real-looking Twilio/Google/Resend/DeepSeek keys already populated,
    so these patches are load-bearing — without them this test would attempt real
    network calls to all four providers.
    """
    rec = CallRecorder()

    def _fake_ical_email(**kwargs):
        rec.email_calls.append(kwargs)
        return True

    def _fake_create_event(**kwargs):
        rec.calendar_calls.append({"op": "create", **kwargs})
        return "evt_fake_1"

    def _fake_update_event(*args, **kwargs):
        rec.calendar_calls.append({"op": "update", "args": args, **kwargs})
        return True

    def _fake_whatsapp_confirmation(**kwargs):
        rec.whatsapp_calls.append(kwargs)
        return True

    def _fake_reminder_email(**kwargs):
        rec.reminder_email_calls.append(kwargs)

    def _fake_reminder_whatsapp(*args, **kwargs):
        rec.reminder_whatsapp_calls.append({"args": args, **kwargs})
        return True

    def _fake_reminder_call(*args, **kwargs):
        rec.reminder_call_calls.append({"args": args, **kwargs})
        return True

    def _fake_deepseek_parse(file_path, filename, api_key=None):
        # Same fallback the real function uses when no key is configured — deterministic,
        # no network call, still exercises the real regex-based name/email/phone extraction.
        from app.utils.resume_parser import parse_resume_local_heuristics, extract_text_from_file
        return parse_resume_local_heuristics(extract_text_from_file(file_path), filename)

    monkeypatch.setattr("app.utils.email_sender.send_ical_invitation_email", _fake_ical_email)
    monkeypatch.setattr("app.utils.google_calendar.create_calendar_event", _fake_create_event)
    monkeypatch.setattr("app.utils.google_calendar.update_calendar_event", _fake_update_event)
    monkeypatch.setattr("app.utils.twilio_client.send_schedule_confirmation_whatsapp", _fake_whatsapp_confirmation)

    monkeypatch.setattr("app.routers.public.update_calendar_event", _fake_update_event)
    monkeypatch.setattr("app.routers.public.send_ical_invitation_email", _fake_ical_email)

    monkeypatch.setattr("app.jobs.reminders.send_interview_reminder_email", _fake_reminder_email)
    monkeypatch.setattr("app.jobs.reminders.send_whatsapp_message", _fake_reminder_whatsapp)
    monkeypatch.setattr("app.jobs.reminders.place_reminder_call", _fake_reminder_call)

    monkeypatch.setattr("app.utils.resume_parser.parse_resume_with_deepseek", _fake_deepseek_parse)

    return rec


def signup_and_onboard(client: "TestClient", email: str, password: str, org_name: str) -> dict:
    """Real POST /api/auth/signup -> POST /api/auth/onboarding flow. Cookies persist
    automatically on the given TestClient instance, so the client is authenticated for
    every subsequent call. Returns {"user_id": str, "organisation_id": str}."""
    r = client.post("/api/auth/signup", json={"name": "Test Recruiter", "email": email, "password": password})
    assert r.status_code == 200, r.text
    user_id = r.json()["user"]["id"]

    r = client.post("/api/auth/onboarding", json={"org_name": org_name})
    assert r.status_code == 200, r.text
    org_id = r.json()["organisation"]["id"]
    return {"user_id": user_id, "organisation_id": org_id}
