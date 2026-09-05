"""IST (Asia/Kolkata, UTC+05:30) helpers for interview scheduling.

Product decision: the whole app assumes IST for scheduling. A recruiter/candidate
picking "6:31 AM" in a datetime picker means 6:31 AM IST, not UTC or their device's
OS timezone — and every human-facing display of a scheduled time should show IST,
not UTC. All `Applicant.*_scheduled_at` / `InterviewSession.scheduledAt` columns
still store real UTC instants (`TIMESTAMP WITH TIME ZONE`); IST only applies at the
parse boundary (interpreting picker input) and the display boundary (formatting for
humans) — never change what's actually stored to anything but UTC.
"""
from datetime import datetime, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30))


def parse_scheduled_datetime(raw: str) -> datetime:
    """Parse a scheduled-time string from a picker/API payload into a UTC-aware
    datetime. If the string carries explicit timezone info (e.g. a 'Z'-suffixed or
    offset-bearing ISO string — what a correctly-fixed frontend now always sends,
    since it computes the real UTC instant from IST-interpreted input itself), trust
    it as-is. If it's naive (no offset — a defensive fallback for any caller that
    isn't timezone-aware), interpret the wall-clock numbers as IST and convert."""
    dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=IST)
    return dt.astimezone(timezone.utc)


def to_ist(dt: datetime) -> datetime:
    """Convert a UTC-aware (or naive-assumed-UTC) datetime to IST for display."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(IST)


def format_ist(dt: datetime, fmt: str) -> str:
    """Convenience: format a stored (UTC) datetime as IST wall-clock text."""
    return to_ist(dt).strftime(fmt)


def default_next_day_1pm_ist() -> datetime:
    """1 PM IST tomorrow, as a UTC-aware datetime — the auto-default proposed time
    when a recruiter confirms a slot with none set yet. Computed in IST first so
    "1 PM" means 1 PM for the candidate, not 1 PM UTC (6:30 PM IST)."""
    now_ist = datetime.now(IST)
    next_day_ist = (now_ist + timedelta(days=1)).replace(hour=13, minute=0, second=0, microsecond=0)
    return next_day_ist.astimezone(timezone.utc)
