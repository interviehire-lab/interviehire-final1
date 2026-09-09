"""Unit tests for SMS sending (app/utils/twilio_client.py's send_sms_message /
send_schedule_confirmation_sms) — no DB, no TEST_DATABASE_URL required.

Written TDD-first: these fail with ImportError/AttributeError until
send_sms_message / send_schedule_confirmation_sms / settings.TWILIO_SMS_MESSAGING_SERVICE_SID
exist. Mirrors the direct-HTTP-mocking style already used for the rest of
twilio_client.py's design (requests.post, HTTP Basic Auth, no Twilio SDK).

SMS is deliberately simpler than the WhatsApp path in one respect: it has no
Content Template / Meta-approval concept at all (that's a WhatsApp Business
Platform requirement, not a general SMS one) — every SMS send is freeform Body,
routed through a Messaging Service (required for Alphanumeric Sender ID
routing — SMS via a Messaging Service specifies `MessagingServiceSid`, never a
bare `From` number).
"""
import pytest

from app.config import settings
from app.utils import twilio_client


class _FakeResponse:
    def __init__(self, status_code: int, text: str = "", json_body: dict | None = None):
        self.status_code = status_code
        self.text = text
        self._json_body = json_body or {}

    def json(self):
        return self._json_body


@pytest.fixture
def configured_twilio(monkeypatch):
    """Full Twilio + SMS config — the 'everything is set up' baseline each
    success/failure-path test starts from, then deliberately un-sets one field."""
    monkeypatch.setattr(settings, "TWILIO_ACCOUNT_SID", "ACfaketestaccountsid00000000000000")
    monkeypatch.setattr(settings, "TWILIO_AUTH_TOKEN", "fake-auth-token")
    monkeypatch.setattr(settings, "TWILIO_API_KEY_SID", "")
    monkeypatch.setattr(settings, "TWILIO_API_KEY_SECRET", "")
    monkeypatch.setattr(settings, "TWILIO_SMS_MESSAGING_SERVICE_SID", "MGfaketestmessagingservice000000")


# ─── send_sms_message: no-op paths (must never raise, never call the network) ──

def test_returns_false_and_makes_no_request_when_twilio_not_configured(monkeypatch):
    monkeypatch.setattr(settings, "TWILIO_ACCOUNT_SID", "")
    monkeypatch.setattr(settings, "TWILIO_AUTH_TOKEN", "")
    monkeypatch.setattr(settings, "TWILIO_API_KEY_SID", "")
    monkeypatch.setattr(settings, "TWILIO_API_KEY_SECRET", "")
    monkeypatch.setattr(settings, "TWILIO_SMS_MESSAGING_SERVICE_SID", "MGfaketestmessagingservice000000")

    called = []
    monkeypatch.setattr("requests.post", lambda *a, **k: called.append((a, k)))

    assert twilio_client.send_sms_message("+14155550123", "Your interview is confirmed.") is False
    assert called == []


def test_returns_false_and_makes_no_request_when_sms_service_sid_not_set(monkeypatch):
    """Twilio itself is configured (account/auth), but no Messaging Service SID —
    distinct from the general 'Twilio not configured' case, since SMS specifically
    needs a Messaging Service for Alphanumeric Sender routing (unlike WhatsApp,
    which just needs a bare TWILIO_WHATSAPP_FROM number)."""
    monkeypatch.setattr(settings, "TWILIO_ACCOUNT_SID", "ACfaketestaccountsid00000000000000")
    monkeypatch.setattr(settings, "TWILIO_AUTH_TOKEN", "fake-auth-token")
    monkeypatch.setattr(settings, "TWILIO_SMS_MESSAGING_SERVICE_SID", "")

    called = []
    monkeypatch.setattr("requests.post", lambda *a, **k: called.append((a, k)))

    assert twilio_client.send_sms_message("+14155550123", "Your interview is confirmed.") is False
    assert called == []


def test_returns_false_and_makes_no_request_when_phone_is_not_real(configured_twilio, monkeypatch):
    called = []
    monkeypatch.setattr("requests.post", lambda *a, **k: called.append((a, k)))

    assert twilio_client.send_sms_message("+1 555-0199", "Your interview is confirmed.") is False
    assert called == []


# ─── send_sms_message: success path ────────────────────────────────────────────

def test_sends_via_messaging_service_sid_not_a_bare_from_number(configured_twilio, monkeypatch):
    """The whole point of routing through a Messaging Service is Alphanumeric
    Sender ID support — asserting MessagingServiceSid is sent (and `From` is NOT)
    is the one thing that actually distinguishes this from a bare-number send."""
    captured = {}

    def _fake_post(url, data=None, auth=None, timeout=None):
        captured["url"] = url
        captured["data"] = data
        captured["auth"] = auth
        return _FakeResponse(201)

    monkeypatch.setattr("requests.post", _fake_post)

    result = twilio_client.send_sms_message("+1 (415) 555-0123", "Your interview starts in 30 minutes.")

    assert result is True
    assert captured["url"].endswith("/Messages.json")
    assert captured["data"]["MessagingServiceSid"] == "MGfaketestmessagingservice000000"
    assert "From" not in captured["data"]
    assert captured["data"]["To"] == "+14155550123"
    assert captured["data"]["Body"] == "Your interview starts in 30 minutes."


def test_returns_false_on_non_2xx_response(configured_twilio, monkeypatch):
    monkeypatch.setattr("requests.post", lambda *a, **k: _FakeResponse(400, text="bad request"))
    assert twilio_client.send_sms_message("+14155550123", "hi") is False


def test_returns_false_instead_of_raising_on_network_exception(configured_twilio, monkeypatch):
    def _boom(*a, **k):
        raise ConnectionError("network is down")

    monkeypatch.setattr("requests.post", _boom)
    assert twilio_client.send_sms_message("+14155550123", "hi") is False


# ─── send_schedule_confirmation_sms ─────────────────────────────────────────────

def test_confirmation_sms_body_includes_every_field():
    captured = {}

    def _fake_send(phone, body):
        captured["phone"] = phone
        captured["body"] = body
        return True

    result = _call_confirmation_sms(_fake_send)

    assert result is True
    assert captured["phone"] == "+14155550123"
    body = captured["body"]
    assert "Alex" in body
    assert "Functional Interview" in body
    assert "Backend Engineer" in body
    assert "Acme Corp" in body
    assert "September 11, 2001" in body
    assert "3:30 PM IST" in body
    assert "https://interviehire.com/interview/sample" in body
    assert "https://interviehire.com/reschedule/sample" in body


def test_confirmation_sms_never_uses_a_content_sid(monkeypatch):
    """SMS has no Meta/Content-Template concept — send_sms_message only ever
    takes (phone, body), never content_sid/content_variables like the WhatsApp
    path does. This test exists mainly to lock in that simpler signature."""
    import inspect

    sig = inspect.signature(twilio_client.send_sms_message)
    assert list(sig.parameters) == ["to_phone", "body"]


def _call_confirmation_sms(fake_send, monkeypatch=None):
    import unittest.mock as mock

    with mock.patch("app.utils.twilio_client.send_sms_message", side_effect=fake_send):
        return twilio_client.send_schedule_confirmation_sms(
            phone="+14155550123",
            first_name="Alex",
            stage_name="Functional Interview",
            job_title="Backend Engineer",
            org_name="Acme Corp",
            date_str="September 11, 2001",
            time_str="3:30 PM IST",
            interview_link="https://interviehire.com/interview/sample",
            reschedule_link="https://interviehire.com/reschedule/sample",
        )
