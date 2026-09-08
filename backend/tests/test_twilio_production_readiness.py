"""Live readiness check against a DEPLOYED backend's
GET /api/internal/integrations/status.

test_reminders.py already proves, hermetically, that OUR CODE calls Twilio
correctly when it's configured (mocked_externals). This file checks the other
half: is Twilio actually configured on the target deployment at all? A real
incident slipped through exactly that gap — TWILIO_ACCOUNT_SID was unset on
Railway (both `backend` and `reminders-cron`) while every OTHER Twilio
variable (AUTH_TOKEN, VOICE_FROM, WHATSAPP_FROM, the confirmation template
SID) was populated. `_twilio_configured()` requires ACCOUNT_SID unconditionally
(app/utils/twilio_client.py), so it silently returned False for every call and
WhatsApp send — reminders-cron reported "SUCCESS" on every run while placing
zero real calls or messages, with nothing anywhere logging why.

Skipped by default — this makes a real network call to a real deployment, not
part of the fast local/CI suite. Run deliberately with:

    PROD_BASE_URL=https://backend-production-4daf.up.railway.app \\
    PROD_INTERNAL_SERVICE_SECRET=<the real x-internal-secret> \\
    pytest backend/tests/test_twilio_production_readiness.py -v

Re-run after any Twilio credential/variable change on Railway to confirm it
actually took (this only reads the deployment's OWN live settings — it can't
be fooled by a stale local .env or a Railway MCP tool that redacts values).
"""
import os

import pytest
import requests

BASE_URL = os.environ.get("PROD_BASE_URL", "").rstrip("/")
SECRET = os.environ.get("PROD_INTERNAL_SERVICE_SECRET", "")

pytestmark = pytest.mark.skipif(
    not BASE_URL or not SECRET,
    reason="set PROD_BASE_URL + PROD_INTERNAL_SERVICE_SECRET to run this against a real deployment",
)


@pytest.fixture(scope="module")
def status():
    r = requests.get(
        f"{BASE_URL}/api/internal/integrations/status",
        headers={"x-internal-secret": SECRET},
        timeout=10,
    )
    assert r.status_code == 200, r.text
    return r.json()["twilio"]


def test_twilio_account_sid_is_set(status):
    assert status["account_configured"] is True, (
        "TWILIO_ACCOUNT_SID is unset on this deployment. Every Twilio call and "
        "WhatsApp send silently no-ops regardless of any other Twilio variable "
        "(see _twilio_configured() in app/utils/twilio_client.py) — this is the "
        "exact failure mode behind reminders-cron reporting SUCCESS while placing "
        "zero real calls. Fix: railway variables --set TWILIO_ACCOUNT_SID=<sid> "
        "--service backend --service reminders-cron"
    )


def test_twilio_authentication_is_configured(status):
    assert status["authentication_configured"] is True, (
        "Neither TWILIO_AUTH_TOKEN nor a TWILIO_API_KEY_SID/SECRET pair is set."
    )


def test_twilio_voice_sender_is_configured(status):
    assert status["voice_sender_configured"] is True, (
        "TWILIO_VOICE_FROM is unset — place_reminder_call() would send Calls.json "
        "with an empty From number and Twilio would reject it."
    )


def test_twilio_whatsapp_sender_is_configured(status):
    assert status["whatsapp_sender_configured"] is True, (
        "TWILIO_WHATSAPP_FROM is unset — every WhatsApp send (confirmation and "
        "reminder) would be sent from a blank `whatsapp:` address."
    )


def test_twilio_confirmation_whatsapp_template_is_configured(status):
    assert status["confirmation_template_configured"] is True, (
        "TWILIO_WHATSAPP_CONFIRMATION_CONTENT_SID is unset — schedule/reschedule "
        "confirmations fall back to freeform WhatsApp Body, which Meta generally "
        "rejects outside an open 24h customer-service session on a production sender."
    )


def test_twilio_reminder_whatsapp_template_is_configured(status):
    if not status["reminder_template_configured"]:
        pytest.skip(
            "TWILIO_WHATSAPP_REMINDER_CONTENT_SID is unset — reminder WhatsApp "
            "messages fall back to freeform Body (likely rejected by Meta outside "
            "an open session). Not hard-failing: voice and email reminders are "
            "independent of this and still work. Wire in the interview_reminder_v2 "
            "Content SID once Meta approves it (currently 'pending' — Twilio "
            "Console > Content Editor)."
        )
