"""End-to-end tests for the /api/privacy router (Phase C) via FastAPI TestClient.

Drives the REAL HTTP endpoints against a throwaway Postgres, with only the mailer and the
cross-service engine hop stubbed. Proves the full self-serve flow: intake -> token verify
-> erasure double-confirm (and export download / grievance / admin) actually work over HTTP.

Requires a THROWAWAY Postgres (create_all/drop_all per test) — set TEST_DATABASE_URL; the
tests skip without it. TestClient needs httpx:  pip install httpx

    TEST_DATABASE_URL=postgresql://postgres:pass@localhost:5433/ih_test pytest tests/test_privacy_api.py -v
"""
import io
import os
import sys
import uuid
import zipfile

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

TEST_DB = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not TEST_DB, reason="set TEST_DATABASE_URL to a disposable Postgres to run these"
)

if TEST_DB:
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from fastapi.testclient import TestClient

    import app.models  # noqa: F401 — registers models on Base
    from app.database import Base, get_db
    from main import app
    from app.routers import privacy
    from app.utils import data_rights
    from app.utils.auth import get_current_user, get_active_org_id
    from app.models.organisation import Organisation
    from app.models.job import Job
    from app.models.applicant import Applicant
    from app.models.ai_integration import Company, Candidate, JobRole, InterviewSession, ConsentLog
    from app.models.data_subject_request import DataSubjectRequest, DSARStatus

    # Own engine bound to the throwaway DB; override get_db so it's used regardless of
    # whatever the app's real engine points at (import-order-safe).
    _engine = create_engine(TEST_DB)
    _TestingSession = sessionmaker(bind=_engine)

    # Only drop the backend-owned tables between tests — never the Prisma-owned engine
    # tables. Postgres refuses to drop InterviewSession (etc.) once the real Prisma
    # schema is pushed: it also owns TranscriptEvent/InterviewTranscript, which
    # FK-reference InterviewSession and aren't in SQLAlchemy's Base.metadata at all,
    # so a plain drop_all() hits "DependentObjectsStillExist".
    _PRISMA_OWNED = {"Company", "Candidate", "JobRole", "Question", "InterviewSession", "ProctoringLog", "ConsentLog"}
    _backend_only_tables = [t for name, t in Base.metadata.tables.items() if name not in _PRISMA_OWNED]

    def _override_get_db():
        db = _TestingSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _override_get_db


def _seed(email):
    """Seed a full subject on the test DB (backend applicant + engine graph)."""
    db = _TestingSession()
    org = Organisation(org_name="Acme"); db.add(org); db.flush()
    job = Job(title="BE", role_name="BE", organisation_id=org.id); db.add(job); db.flush()
    a = Applicant(name="Jane", email=email, job_id=job.id, resume_text="secret"); db.add(a); db.flush()
    sid = str(a.id)
    company = Company(id="cmp_" + uuid.uuid4().hex[:8], name="Acme", slug="acme-" + uuid.uuid4().hex[:6])
    db.add(company); db.flush()
    role = JobRole(id="rol_" + uuid.uuid4().hex[:8], companyId=company.id, title="BE", description="d",
                   requirements="r", primaryCriteria=[], secondaryCriteria=[], atsScoringWeights={})
    db.add(role); db.flush()
    cand = Candidate(id="can_" + uuid.uuid4().hex[:8], companyId=company.id, fullName="Jane", email=email)
    db.add(cand); db.flush()
    db.add(InterviewSession(id=sid, companyId=company.id, candidateId=cand.id, jobRoleId=role.id))
    db.add(ConsentLog(id="con_" + uuid.uuid4().hex[:8], sessionId=sid, action="granted",
                      consentVersion="1", candidateEmail=email))
    db.commit()
    out = {"org_id": org.id, "applicant_id": a.id, "candidate_id": cand.id, "sid": sid, "email": email}
    db.close()
    return out


@pytest.fixture
def client(monkeypatch):
    Base.metadata.create_all(bind=_engine)
    # No real emails; deterministic token; no cross-service HTTP hop; no rate-limiting
    # (the in-process limiter buckets by IP, and the whole suite hits it from one "IP").
    monkeypatch.setattr(privacy, "send_html_email", lambda *a, **k: True)
    monkeypatch.setattr(privacy, "generate_token", lambda: "tok-fixed")
    monkeypatch.setattr(privacy, "_rate_limit", lambda *a, **k: None)
    monkeypatch.setattr(data_rights, "_erase_engine_files", lambda ids, rid: {"count": len(ids)})
    yield TestClient(app)
    app.dependency_overrides.pop(get_current_user, None)
    app.dependency_overrides.pop(get_active_org_id, None)
    # metadata.drop_all(tables=...) still sweeps ALL Postgres ENUM types across the
    # whole metadata regardless of the tables filter (a SQLAlchemy/PG quirk), which
    # re-triggers the same DependentObjectsStillExist error on RoleType/Difficulty/
    # SessionStatus (owned by the excluded Prisma tables) and rolls back the entire
    # drop. Per-table .drop() in reverse dependency order sidesteps that sweep.
    for table in reversed(Base.metadata.sorted_tables):
        if table in _backend_only_tables:
            table.drop(bind=_engine, checkfirst=True)


def test_erasure_flow_over_http(client):
    s = _seed("erase@example.com")
    r = client.post("/api/privacy/requests", json={
        "email": s["email"], "request_type": "erasure", "scope": "company",
        "organisation_id": str(s["org_id"])})
    assert r.status_code == 200, r.text
    rid = r.json()["request_id"]

    v = client.get("/api/privacy/requests/verify", params={"rid": rid, "token": "tok-fixed"})
    assert v.status_code == 200 and "erase" in v.text.lower()

    c = client.post(f"/api/privacy/requests/{rid}/confirm", params={"token": "tok-fixed"})
    assert c.status_code == 200 and "erased" in c.text.lower()

    db = _TestingSession()
    a = db.get(Applicant, s["applicant_id"])
    assert a.name == "[erased]" and a.anonymised_at is not None
    assert db.query(Candidate).filter_by(id=s["candidate_id"]).count() == 0
    assert db.get(DataSubjectRequest, uuid.UUID(rid)).status == DSARStatus.fulfilled
    db.close()


def test_export_download_over_http(client):
    s = _seed("export@example.com")
    rid = client.post("/api/privacy/requests", json={
        "email": s["email"], "request_type": "access_export",
        "organisation_id": str(s["org_id"])}).json()["request_id"]

    v = client.get("/api/privacy/requests/verify", params={"rid": rid, "token": "tok-fixed"})
    assert v.status_code == 200 and "download" in v.text.lower()

    d = client.get(f"/api/privacy/exports/{rid}", params={"token": "tok-fixed"})
    assert d.status_code == 200
    assert d.headers["content-type"] == "application/zip"
    z = zipfile.ZipFile(io.BytesIO(d.content))
    assert "data.json" in z.namelist()


def test_bad_token_is_rejected(client):
    s = _seed("nope@example.com")
    rid = client.post("/api/privacy/requests", json={
        "email": s["email"], "request_type": "erasure",
        "organisation_id": str(s["org_id"])}).json()["request_id"]
    v = client.get("/api/privacy/requests/verify", params={"rid": rid, "token": "WRONG"})
    assert v.status_code == 400 and "invalid" in v.text.lower()


def test_grievance(client):
    r = client.post("/api/privacy/grievances", json={"email": "g@example.com", "message": "help"})
    assert r.status_code == 200 and r.json()["ok"] is True


def test_admin_list(client):
    s = _seed("admin@example.com")
    client.post("/api/privacy/requests", json={
        "email": s["email"], "request_type": "erasure", "organisation_id": str(s["org_id"])})
    app.dependency_overrides[get_current_user] = lambda: object()
    app.dependency_overrides[get_active_org_id] = lambda: s["org_id"]
    r = client.get("/api/privacy/admin/requests")
    assert r.status_code == 200
    assert s["email"] in [x["subject_email"] for x in r.json()]
