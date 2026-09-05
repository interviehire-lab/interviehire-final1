"""Twilio WhatsApp + Voice, called via raw HTTPS (`requests`) — same pattern as
`app/utils/email_sender.py`'s Resend integration: no `twilio` SDK dependency, just
`requests.post` against Twilio's REST API with HTTP Basic Auth.

Auth: prefers a scoped API Key (`TWILIO_API_KEY_SID`/`TWILIO_API_KEY_SECRET`, SID
starts "SK...") when both are set — Twilio's recommended credential for server-side
integrations, independently revocable/rotatable without touching the main Auth Token.
Falls back to the account's master `TWILIO_AUTH_TOKEN` otherwise. Either way,
`TWILIO_ACCOUNT_SID` (starts "AC...") is always required — it identifies the account
in the request URL path regardless of which credential authenticates the request.

Both send functions below are best-effort and NEVER raise — they log and return False
on any failure (missing config, network error, non-2xx response), matching the
"best-effort, log-and-continue" philosophy already used for email delivery. A failed
WhatsApp send or call must never break the caller's request/job.
"""
import json
import logging
from xml.sax.saxutils import escape as _xml_escape

import requests

from app.config import settings
from app.utils.phone import has_real_phone, to_e164

logger = logging.getLogger(__name__)

_TWILIO_API_BASE = "https://api.twilio.com/2010-04-01"
_REQUEST_TIMEOUT = 10  # seconds — matches the SMTP timeout convention in email_sender.py


def _twilio_configured() -> bool:
    return bool(settings.TWILIO_ACCOUNT_SID and (
        settings.TWILIO_AUTH_TOKEN or (settings.TWILIO_API_KEY_SID and settings.TWILIO_API_KEY_SECRET)
    ))


def _twilio_auth() -> tuple[str, str]:
    """Basic Auth credentials — API Key (preferred) or the Account's Auth Token."""
    if settings.TWILIO_API_KEY_SID and settings.TWILIO_API_KEY_SECRET:
        return (settings.TWILIO_API_KEY_SID, settings.TWILIO_API_KEY_SECRET)
    return (settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)


def send_whatsapp_message(
    to_phone: str | None,
    body: str | None = None,
    content_sid: str | None = None,
    content_variables: dict[str, str] | None = None,
) -> bool:
    """Send a WhatsApp message via Twilio's Messages API. Returns False (and logs)
    instead of raising when Twilio isn't configured, the phone number doesn't look
    real, or the request fails.

    Two modes:
    - Template (preferred for a business-initiated send like a confirmation or
      reminder): pass `content_sid` (a Twilio Content SID, "HX...") + `content_variables`
      (a dict of the template's numbered placeholders, e.g. `{"1": "Alex", "2": "..."}`).
      Sent as `ContentSid`/`ContentVariables` — this is what WhatsApp actually requires
      outside an open 24h session with the recipient.
    - Freeform (`body` only, no `content_sid`): sent as plain `Body`. Only reliable on
      the Twilio Sandbox number or as a reply within an active session — an approved
      production WhatsApp sender will likely reject this outside those cases.
    """
    if not _twilio_configured():
        logger.info("Twilio not configured (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN unset) — skipping WhatsApp send.")
        return False
    if not has_real_phone(to_phone):
        logger.info(f"Skipping WhatsApp send — no usable phone number ({to_phone!r}).")
        return False
    if not content_sid and not body:
        logger.error("send_whatsapp_message called with neither content_sid nor body — nothing to send.")
        return False
    normalized = to_e164(to_phone)

    url = f"{_TWILIO_API_BASE}/Accounts/{settings.TWILIO_ACCOUNT_SID}/Messages.json"
    data: dict[str, str] = {
        "From": f"whatsapp:{settings.TWILIO_WHATSAPP_FROM}",
        "To": f"whatsapp:{normalized}",
    }
    if content_sid:
        data["ContentSid"] = content_sid
        data["ContentVariables"] = json.dumps(content_variables or {})
    else:
        # Reachable only when content_sid is falsy, which (per the guard above) means
        # body must be truthy — but that guard doesn't narrow `body`'s type here, so
        # assert it explicitly for both Pyright and defensiveness.
        assert body is not None
        data["Body"] = body
    try:
        response = requests.post(
            url,
            data=data,
            auth=_twilio_auth(),
            timeout=_REQUEST_TIMEOUT,
        )
        if response.status_code in (200, 201):
            logger.info(f"WhatsApp message sent successfully via Twilio to {normalized}")
            return True
        logger.error(f"Failed to send WhatsApp message via Twilio: {response.status_code} {response.text}")
        return False
    except Exception as e:
        logger.error(f"Error sending WhatsApp message via Twilio to {normalized}: {e}")
        return False


def send_schedule_confirmation_whatsapp(
    phone: str | None,
    first_name: str,
    stage_name: str,
    job_title: str,
    org_name: str,
    date_str: str,
    time_str: str,
    interview_link: str,
    reschedule_link: str,
) -> bool:
    """Build + send the short plain-text WhatsApp confirmation sent when a time slot
    is set (recruiter schedule, or candidate self-reschedule) — additive alongside the
    existing iCal email confirmation, never a substitute for it. Shared by
    `app/routers/jobs.py::schedule_interview` and
    `app/routers/public.py::public_reschedule_interview` so the message format stays
    identical between both call sites. WhatsApp doesn't render HTML, so the freeform
    fallback is plain text. Best-effort: delegates to `send_whatsapp_message`, which
    never raises."""
    body = (
        f"Hi {first_name}, your {stage_name} interview for {job_title} at {org_name} "
        f"is confirmed for {date_str} at {time_str}.\n"
        f"Join here: {interview_link}\n"
        f"Need to change the time? {reschedule_link}"
    )
    content_sid = settings.TWILIO_WHATSAPP_CONFIRMATION_CONTENT_SID
    if content_sid:
        # ⚠️ Variable positions (1-4) must match your approved template's actual
        # order in the Twilio Content Editor — this is a guessed default (name, role,
        # date+time, link); verify/reorder against the real template before relying
        # on it. `org_name`/`reschedule_link` aren't included below since a 4-variable
        # template is the common case — add a "5" here if your template carries more.
        variables = {
            "1": first_name,
            "2": f"{stage_name} interview for {job_title}",
            "3": f"{date_str} at {time_str}",
            "4": interview_link,
        }
        return send_whatsapp_message(phone, content_sid=content_sid, content_variables=variables)
    return send_whatsapp_message(phone, body=body)


def place_reminder_call(to_phone: str | None, say_message: str) -> bool:
    """Place an automated voice call via Twilio's Calls API using inline TwiML (the
    `Twiml` param) — no public webhook endpoint needed to serve TwiML for the call.
    Returns False (and logs) instead of raising when Twilio isn't configured, the
    phone number doesn't look real, or the request fails."""
    if not _twilio_configured():
        logger.info("Twilio not configured (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN unset) — skipping reminder call.")
        return False
    if not has_real_phone(to_phone):
        logger.info(f"Skipping reminder call — no usable phone number ({to_phone!r}).")
        return False
    normalized = to_e164(to_phone)

    escaped_message = _xml_escape(say_message)
    twiml = f'<Response><Say voice="Polly.Joanna">{escaped_message}</Say></Response>'

    url = f"{_TWILIO_API_BASE}/Accounts/{settings.TWILIO_ACCOUNT_SID}/Calls.json"
    data = {
        "From": settings.TWILIO_VOICE_FROM,
        "To": normalized,
        "Twiml": twiml,
    }
    try:
        response = requests.post(
            url,
            data=data,
            auth=_twilio_auth(),
            timeout=_REQUEST_TIMEOUT,
        )
        if response.status_code in (200, 201):
            logger.info(f"Reminder call placed successfully via Twilio to {normalized}")
            return True
        logger.error(f"Failed to place reminder call via Twilio: {response.status_code} {response.text}")
        return False
    except Exception as e:
        logger.error(f"Error placing reminder call via Twilio to {normalized}: {e}")
        return False
