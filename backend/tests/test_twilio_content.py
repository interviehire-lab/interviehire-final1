import pytest

from app.utils.twilio_client import build_content_variables


def test_content_variables_follow_configured_semantic_order():
    values = {"name": "Asha", "role": "Engineer", "link": "https://example.test/i/1"}
    assert build_content_variables("name,role,link", values) == {
        "1": "Asha",
        "2": "Engineer",
        "3": "https://example.test/i/1",
    }


def test_content_variables_reject_unknown_names():
    with pytest.raises(ValueError, match="Unknown Twilio Content variable"):
        build_content_variables("name,missing", {"name": "Asha"})
