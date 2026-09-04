"""Integration tests for the DPDP data-rights engine (erase / rectify / export).

These exercise the REAL functions against a real Postgres, with only the cross-service
engine HTTP hop mocked. They prove the destructive logic actually does the right thing on
disposable data before it ever runs against real candidates.

Requires a THROWAWAY Postgres — the fixture runs create_all / drop_all, so never point it
at a real database. Set TEST_DATABASE_URL; without it, every test skips.

    # disposable DB (example)
    docker run --rm -d -e POSTGRES_PASSWORD=pass -e POSTGRES_DB=ih_test -p 5433:5432 postgres:16
    cd backend && pip install -r requirements.txt pytest
    TEST_DATABASE_URL=postgresql://postgres:pass@localhost:5433/ih_test pytest tests/test_data_rights.py -v
"""
import os
import sys
import uuid

import pytest

# Make the backend package importable no matter where pytest is invoked from.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.models.data_subject_request import DSARScope, DSARStatus, DSARType

TEST_DB = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not TEST_DB, reason="set TEST_DATABASE_URL to a disposable Postgres to run these"
)

if TEST_DB:
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    import app.models  # noqa: F401 — registers every model on Base
    from app.database import Base
    from app.models.organisation import Organisation
    from app.models.job import Job
    from app.models.applicant import Applicant
    from app.models.interview_report import InterviewReport
    from app.models.interview_invite import InterviewInvite, InviteStatus
    from app.models.ai_integration import (
        Company, Candidate, JobRole, InterviewSession, ProctoringLog, ConsentLog, Severity,
    )
    from app.models.compliance_audit_log import ComplianceAuditLog
    from app.models.data_subject_request import DataSubjectRequest
    from app.utils import data_rights, data_export

    _engine = create_engine(TEST_DB)
    _Session = sessionmaker(bind=_engine)


@pytest.fixture
def db():
    Base.metadata.create_all(bind=_engine)
    session = _Session()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=_engine)


def _seed_subject(db, email="jane@example.com", with_engine=True):
    """Seed one Data Principal end to end: backend org/job/applicant (+report) and, if
    requested, the engine Company/JobRole/Candidate/Session/ConsentLog/ProctoringLog.
    Returns the ids needed for assertions. InterviewSession.id == str(applicant.id)."""
    org = Organisation(org_name="Acme")
    db.add(org); db.flush()
    job = Job(title="Backend Engineer", role_name="Backend Engineer", organisation_id=org.id)
    db.add(job); db.flush()

    applicant = Applicant(
        name="Jane Doe", email=email, phone="+91-99999", job_id=job.id,
        resume_text="secret resume text", resume_url=None,
        screening_score=7.5, overall_interview_score=8.0,
    )
    db.add(applicant); db.flush()
    sid = str(applicant.id)

    db.add(InterviewReport(applicant_id=applicant.id, summary="great", transcript="Q/A...",
                           video_url="http://x/v.mp4", detailed_scores={"comm": 8}))
    db.add(InterviewInvite(token=uuid.uuid4().hex, applicant_id=applicant.id, job_id=job.id,
                           candidate_email=email, candidate_name="Jane Doe",
                           status=InviteStatus.completed))

    candidate_id = None
    if with_engine:
        company = Company(id="cmp_" + uuid.uuid4().hex[:8], name="Acme", slug="acme-" + uuid.uuid4().hex[:6])
        db.add(company); db.flush()
        role = JobRole(id="rol_" + uuid.uuid4().hex[:8], companyId=company.id, title="BE",
                       description="d", requirements="r", primaryCriteria=[], secondaryCriteria=[],
                       atsScoringWeights={})
        db.add(role); db.flush()
        candidate = Candidate(id="can_" + uuid.uuid4().hex[:8], companyId=company.id,
                              fullName="Jane Doe", email=email, phone="+91-99999",
                              resumeText="engine resume PII")
        db.add(candidate); db.flush()
        candidate_id = candidate.id
        db.add(InterviewSession(id=sid, companyId=company.id, candidateId=candidate.id,
                                jobRoleId=role.id, transcript=[], evaluation={"overallScore": 8}))
        db.add(ProctoringLog(id="prc_" + uuid.uuid4().hex[:8], sessionId=sid,
                             eventType="gaze", severity=Severity.LOW))
        db.add(ConsentLog(id="con_" + uuid.uuid4().hex[:8], sessionId=sid, action="granted",
                          consentVersion="1", candidateEmail=email, candidateName="Jane Doe",
                          ipAddress="1.2.3.4", userAgent="UA"))
    db.commit()
    return {"org_id": org.id, "applicant_id": applicant.id, "sid": sid,
            "candidate_id": candidate_id, "email": email}


def _make_request(db, email, org_id, rtype=DSARType.erasure, scope=DSARScope.company):
    req = DataSubjectRequest(subject_email=email, request_type=rtype, scope=scope,
                             organisation_id=org_id, status=DSARStatus.verified)
    db.add(req); db.commit()
    return req


def test_erasure_anonymises_across_stores(db, monkeypatch):
    seeded = _seed_subject(db)
    # Only the cross-service engine HTTP hop is mocked; everything else is real.
    monkeypatch.setattr(data_rights, "_erase_engine_files", lambda ids, rid: {"count": len(ids)})
    req = _make_request(db, seeded["email"], seeded["org_id"])

    manifest = data_rights.erase_subject(db, req)

    # Backend applicant reduced to a non-identifying stub, scores kept.
    a = db.get(Applicant, seeded["applicant_id"])
    assert a is not None, "applicant row is KEPT as a stub (not deleted)"
    assert a.name == "[erased]"
    assert a.email.startswith("erased+") and a.email.endswith("@erased.invalid")
    assert a.phone is None and a.resume_text is None
    assert a.anonymised_at is not None
    assert a.overall_interview_score == 8.0, "numeric scores survive"

    # Report free-text stripped, numeric scores retained.
    rep = db.query(InterviewReport).filter_by(applicant_id=seeded["applicant_id"]).first()
    assert rep.transcript is None and rep.summary is None
    assert rep.detailed_scores == {"comm": 8}

    # Invite gone.
    assert db.query(InterviewInvite).filter_by(applicant_id=seeded["applicant_id"]).count() == 0

    # Engine Candidate deleted -> DB cascade removed its Session and ProctoringLog.
    assert db.query(Candidate).filter_by(id=seeded["candidate_id"]).count() == 0
    assert db.query(InterviewSession).filter_by(id=seeded["sid"]).count() == 0
    assert db.query(ProctoringLog).filter_by(sessionId=seeded["sid"]).count() == 0

    # ConsentLog SURVIVES but is anonymised (proof kept, identifiers stripped).
    c = db.query(ConsentLog).filter_by(sessionId=seeded["sid"]).first()
    assert c is not None and c.action == "granted"
    assert c.candidateEmail is None and c.ipAddress is None
    assert c.erasedForRequestId == str(req.id)

    # Request fulfilled + audit trail written.
    assert req.status == DSARStatus.fulfilled
    assert db.query(ComplianceAuditLog).filter_by(
        action="dsar.erasure.fulfilled", subject_email=seeded["email"]).count() == 1
    assert manifest["candidates_deleted"] == 1


def test_rectification_rekeys_email_across_stores(db):
    seeded = _seed_subject(db)
    new_email = "jane.new@example.com"
    data_rights.rectify_subject(
        db, seeded["email"], seeded["org_id"], DSARScope.company,
        {"name": "Jane New", "email": new_email},
    )
    a = db.get(Applicant, seeded["applicant_id"])
    assert a.name == "Jane New" and a.email == new_email
    cand = db.get(Candidate, seeded["candidate_id"])
    assert cand.fullName == "Jane New" and cand.email == new_email
    inv = db.query(InterviewInvite).filter_by(applicant_id=seeded["applicant_id"]).first()
    assert inv.candidate_email == new_email


def test_export_gathers_and_zips(db):
    seeded = _seed_subject(db)
    pkg = data_export.build_export_package(db, seeded["email"], seeded["org_id"], DSARScope.company)
    assert pkg["manifest"]["counts"]["applications"] == 1
    assert pkg["manifest"]["counts"]["candidate_records"] == 1
    assert pkg["manifest"]["counts"]["consent_records"] == 1

    import io, json, zipfile
    raw = data_export.zip_export_package(pkg)
    z = zipfile.ZipFile(io.BytesIO(raw))
    assert set(["manifest.json", "data.json", "summary.md"]).issubset(set(z.namelist()))
    data = json.loads(z.read("data.json"))
    assert data["subject_email"] == seeded["email"]
    assert data["applications"][0]["resume_text"] == "secret resume text"
