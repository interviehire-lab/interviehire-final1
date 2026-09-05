"""Boots the REAL interview-engine Fastify API (apps/api) as a subprocess and hits it
over real HTTP — a genuine, if partial, end-to-end check that the candidate portal's
backing API actually serves what the backend's `sync_applicant_to_ai` wrote.

Kept separate from test_full_flow.py so the core suite stays fast/hermetic even in an
environment without Node/npm available — this file's fixture is heavier (spawns a real
process) and more environment-dependent by nature.

Requires everything test_full_flow.py requires (TEST_DATABASE_URL, Prisma schema
already pushed — see conftest.py's module docstring), PLUS a working `npm`/Node
toolchain with interview-engine's dependencies already installed
(`@interviehire/shared` built, Prisma client generated — both already true in this
repo as of this session; see interview-engine/README or CLAUDE.md if not).
"""
import os
import subprocess
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import requests

from tests.conftest import signup_and_onboard, TEST_DB

ENGINE_ROOT = Path(__file__).resolve().parents[2] / "interview-engine"
ENGINE_PORT = 4099  # distinct from the real dev port (4000) so this never collides
ENGINE_BASE_URL = f"http://127.0.0.1:{ENGINE_PORT}"


def _wait_for_health(base_url: str, timeout_s: float = 20.0) -> bool:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            r = requests.get(f"{base_url}/health", timeout=1.0)
            if r.status_code == 200 and r.json().get("ok") is True:
                return True
        except requests.RequestException:
            pass
        time.sleep(0.5)
    return False


@pytest.fixture(scope="module")
def engine_process(db_engine):
    if not TEST_DB:
        pytest.skip("set TEST_DATABASE_URL — see conftest.py")
    if not ENGINE_ROOT.exists():
        pytest.skip(f"interview-engine not found at {ENGINE_ROOT}")

    env = {**os.environ, "DATABASE_URL": TEST_DB, "PORT": str(ENGINE_PORT)}
    proc = subprocess.Popen(
        ["npm", "run", "dev", "-w", "apps/api"],
        cwd=str(ENGINE_ROOT),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    try:
        if not _wait_for_health(ENGINE_BASE_URL, timeout_s=25.0):
            proc.terminate()
            try:
                out, _ = proc.communicate(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                out = "(process killed, no output captured)"
            pytest.fail(f"interview-engine apps/api did not become healthy in time.\n--- output ---\n{out}")
        yield ENGINE_BASE_URL
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5)


def test_health(engine_process):
    r = requests.get(f"{engine_process}/health", timeout=5)
    assert r.status_code == 200
    assert r.json() == {"ok": True, "service": "interviehire-api"}


def test_demo_session_idempotent(engine_process):
    r1 = requests.get(f"{engine_process}/api/interview/demo-session", timeout=10)
    assert r1.status_code == 200
    sid1 = r1.json()["sessionId"]
    assert sid1

    r2 = requests.get(f"{engine_process}/api/interview/demo-session", timeout=10)
    assert r2.status_code == 200
    assert r2.json()["sessionId"] == sid1


def test_unknown_session_returns_null_body(engine_process):
    # Documented gotcha: an unknown id is 200 with a `null` body, not 404.
    r = requests.get(f"{engine_process}/api/interview/sessions/does-not-exist", timeout=10)
    assert r.status_code == 200
    assert r.json() is None


def test_session_reflects_synced_schedule(engine_process, client, mocked_externals):
    recruiter_email = f"recruiter-{uuid.uuid4().hex[:8]}@example.com"
    org_name = f"Acme Engine Co {uuid.uuid4().hex[:8]}"
    signup_and_onboard(client, recruiter_email, "S3curePass!", org_name)

    r = client.post("/api/jobs", json={"title": "Data Scientist", "role_name": "Data Scientist"})
    assert r.status_code == 200, r.text
    job_id = r.json()["id"]

    candidate_email = f"candidate-{uuid.uuid4().hex[:8]}@example.com"
    import io
    resume_text = f"Sam Sample\nEmail: {candidate_email}\nPhone: +1 415 555 0199\n\nData scientist."
    files = {"files": ("sam_resume.txt", io.BytesIO(resume_text.encode("utf-8")), "text/plain")}
    r = client.post(f"/api/jobs/{job_id}/applicants/upload-resumes", files=files)
    assert r.status_code == 200, r.text
    applicant_id = r.json()[0]["id"]

    scheduled_at = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    r = client.post(
        f"/api/jobs/applicants/{applicant_id}/schedule",
        json={"scheduled_at": scheduled_at, "stage": "screening"},
    )
    assert r.status_code == 200, r.text

    # Now ask the REAL, live engine process for this session — no token needed since
    # schedule_interview (unlike the separate /api/invites flow) never sets inviteToken.
    r = requests.get(f"{engine_process}/api/interview/sessions/{applicant_id}", timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert body is not None, "engine returned a null session — sync_applicant_to_ai's write wasn't visible to it"
    assert body["id"] == str(applicant_id)
    assert body["candidate"]["email"] == candidate_email
    assert body["jobRole"]["title"] == "Data Scientist"
