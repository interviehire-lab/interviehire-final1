"""Unit tests for app/utils/timezones.py — the IST parse/display boundary.

Product decision: interview scheduling assumes IST (Asia/Kolkata) everywhere. A
naive (no-offset) datetime string from a picker means IST wall-clock; storage stays
real UTC; every human-facing display converts back to IST. Pure logic, no DB needed.
"""
from datetime import datetime, timezone

from app.utils.timezones import (
    default_next_day_1pm_ist,
    format_ist,
    parse_scheduled_datetime,
    to_ist,
)


def test_naive_input_is_interpreted_as_ist():
    # A candidate/recruiter typing "6:31 AM" means 6:31 AM IST = 01:01 UTC.
    result = parse_scheduled_datetime("2026-09-05T06:31:00")
    assert result == datetime(2026, 9, 5, 1, 1, 0, tzinfo=timezone.utc)


def test_explicit_utc_offset_is_trusted_as_is():
    # A frontend that's already computed the real UTC instant (Z-suffixed) must not
    # be re-interpreted as IST on top — that would double-shift it.
    result = parse_scheduled_datetime("2026-09-05T01:01:00Z")
    assert result == datetime(2026, 9, 5, 1, 1, 0, tzinfo=timezone.utc)


def test_explicit_non_utc_offset_is_also_trusted_as_is():
    result = parse_scheduled_datetime("2026-09-05T06:31:00+05:30")
    assert result == datetime(2026, 9, 5, 1, 1, 0, tzinfo=timezone.utc)


def test_to_ist_converts_stored_utc_for_display():
    stored_utc = datetime(2026, 9, 5, 1, 1, 0, tzinfo=timezone.utc)
    ist = to_ist(stored_utc)
    assert (ist.hour, ist.minute) == (6, 31)
    assert ist.day == 5


def test_format_ist_matches_intended_wall_clock():
    stored_utc = datetime(2026, 9, 5, 1, 1, 0, tzinfo=timezone.utc)
    assert format_ist(stored_utc, "%I:%M %p IST") == "06:31 AM IST"


def test_parse_then_format_round_trips_to_original_wall_clock():
    # The exact bug this fixes: whatever a human types should be what they see back.
    typed = "2026-09-05T06:31:00"
    stored = parse_scheduled_datetime(typed)
    assert format_ist(stored, "%I:%M %p") == "06:31 AM"


def test_default_next_day_1pm_ist_is_1pm_in_ist_not_utc():
    result = default_next_day_1pm_ist()
    ist = to_ist(result)
    assert (ist.hour, ist.minute) == (13, 0)
    # 1 PM IST is 07:30 UTC, not 13:00 UTC.
    assert (result.hour, result.minute) == (7, 30)
