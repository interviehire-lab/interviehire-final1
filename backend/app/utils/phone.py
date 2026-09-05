"""Phone-number guard helpers.

`Applicant.phone` is optional and frequently junk: it can be `None`, blank, or the
literal placeholder `"+1 555-0199"` written by `app/routers/jobs.py` for bulk-uploaded
applicants whose resume had no extractable phone number. Any code path that sends a
WhatsApp message or places a call MUST check `has_real_phone()` first, so a malformed
or placeholder number fails loudly here rather than silently deep inside a Twilio call.

Deliberately not a full E.164 validator — just enough of a guard to catch obviously
junk values (None/blank/the placeholder/no leading '+').
"""

# Literal placeholder written for bulk-uploaded applicants with no extracted phone.
PLACEHOLDER_PHONE = "+1 555-0199"


def has_real_phone(phone: str | None) -> bool:
    """True when `phone` looks like a real, usable number (not None/blank/placeholder)."""
    if not phone:
        return False
    cleaned = phone.strip()
    if not cleaned:
        return False
    if cleaned == PLACEHOLDER_PHONE:
        return False
    return to_e164(cleaned) is not None


def to_e164(phone: str | None) -> str | None:
    """Best-effort normalize to E.164-ish form: strip whitespace, require a leading
    '+' followed by digits (spaces/dashes/parens inside are stripped). Returns None
    if the result doesn't look plausible — this is a guard, not a full validator."""
    if not phone:
        return None
    cleaned = phone.strip()
    if not cleaned.startswith("+"):
        return None
    digits = "".join(ch for ch in cleaned[1:] if ch.isdigit())
    if len(digits) < 8:
        return None
    return f"+{digits}"
