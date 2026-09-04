"""Talent Finder tests — scoring, dedup, compliance, hard filters, bias.

Pure-logic tests (no DB). Run with pytest, or directly:
    backend> ./venv/Scripts/python.exe tests/test_talent_finder.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.talent_finder.matching import compute_fit, hard_filters, match_skills, bias_check  # noqa: E402
from app.talent_finder.dedup import deduplicate, dedup_key  # noqa: E402
from app.talent_finder.adapters import REGISTRY  # noqa: E402
from app.talent_finder.adapters.base import AdapterContext  # noqa: E402
from app.talent_finder.adapters.disabled import LinkedInAdapter, InternshalaAdapter  # noqa: E402
from app.talent_finder.adapters.web import PublicWebAdapter, ApprovedAPIAdapter  # noqa: E402


BRIEF = {
    "title": "B2B SaaS Sales Executive",
    "location": "Bangalore",
    "experience_min": 2, "experience_max": 6,
    "must_have_skills": ["B2B", "SaaS", "CRM", "outbound prospecting", "HR-tech"],
    "good_to_have_skills": ["Salesforce", "negotiation"],
    "exclude_keywords": ["intern"],
    "jd_text": "We need a B2B SaaS sales executive with outbound prospecting and CRM experience.",
}

STRONG = {
    "id": "c1", "full_name": "Asha Rao", "current_title": "SaaS Sales Manager",
    "current_company": "CloudCo", "location": "Bangalore", "years_of_experience": 4,
    "skills": ["B2B", "SaaS", "CRM", "outbound prospecting", "Salesforce"],
    "previous_companies": ["SalesTech"], "email": "asha@example.com",
    "source_permission_status": "permissioned",
}
WEAK = {
    "id": "c2", "full_name": "Tim Intern", "current_title": "Marketing Intern",
    "current_company": "Shop", "location": "Delhi", "years_of_experience": 0,
    "skills": ["SEO"], "source_permission_status": "permissioned",
}


# ── scoring ────────────────────────────────────────────────────────────────
def test_scoring_strong_beats_weak():
    strong = compute_fit(STRONG, BRIEF)
    weak = compute_fit(WEAK, BRIEF)
    assert strong["totalScore"] > weak["totalScore"]
    assert strong["totalScore"] >= 55
    assert "CRM" in strong["matchedMustHaves"]
    assert "HR-tech" in strong["missingMustHaves"]  # honestly reports the gap
    assert strong["recommendation"] in ("strong_fit", "good_fit")
    assert isinstance(strong["reasoning"], str) and strong["reasoning"]


def test_scoring_output_shape():
    fit = compute_fit(STRONG, BRIEF)
    for k in ("totalScore", "mustHaveScore", "experienceScore", "semanticScore",
              "locationScore", "goodToHaveScore", "riskPenalty", "matchedMustHaves",
              "missingMustHaves", "matchedGoodToHaves", "reasoning", "recommendation"):
        assert k in fit


def test_skill_synonyms_match():
    matched, missing = match_skills(["javascript", "k8s"], ["js", "kubernetes", "rust"])
    assert "js" in matched and "kubernetes" in matched and "rust" in missing


# ── hard filters ───────────────────────────────────────────────────────────
def test_hard_filter_excludes_keyword_and_location():
    passed, reasons = hard_filters(WEAK, BRIEF)
    assert passed is False
    assert any("location" in r for r in reasons)


def test_hard_filter_passes_good_candidate():
    passed, reasons = hard_filters(STRONG, BRIEF)
    assert passed is True, reasons


# ── dedup ──────────────────────────────────────────────────────────────────
def test_dedup_merges_and_preserves_sources():
    a = {"full_name": "Asha Rao", "email": "asha@example.com", "skills": ["B2B"],
         "source_name": "Internal", "source_type": "internal_db"}
    b = {"full_name": "Asha Rao", "email": "asha@example.com", "current_title": "SaaS Sales Manager",
         "skills": ["CRM"], "source_name": "CSV", "source_type": "uploaded_csv"}
    merged = deduplicate([a, b])
    assert len(merged) == 1
    m = merged[0]
    assert set(m["skills"]) == {"B2B", "CRM"}                  # unioned
    assert m["current_title"] == "SaaS Sales Manager"          # filled from b
    assert len(m["_sources"]) == 2                              # both sources preserved


def test_dedup_keeps_distinct_people():
    a = {"full_name": "A", "email": "a@x.com"}
    b = {"full_name": "B", "email": "b@x.com"}
    assert len(deduplicate([a, b])) == 2


# ── compliance ─────────────────────────────────────────────────────────────
def test_restricted_adapters_refuse():
    ctx = AdapterContext()
    for cls in (LinkedInAdapter, InternshalaAdapter):
        ok, reason = cls(ctx).validate_permissions()
        assert ok is False
        assert "permission" in reason.lower() or "api" in reason.lower()
        # and they never return candidates
        cands, note = cls(ctx).run(BRIEF)
        assert cands == []


def test_public_web_enabled_with_compliance_guards():
    ok, reason = PublicWebAdapter(AdapterContext()).validate_permissions()
    assert ok is True and reason == "ok"
    assert PublicWebAdapter.rate_limit_config["respect_robots"] is True


def test_approved_api_requires_credentials():
    ok, reason = ApprovedAPIAdapter(AdapterContext()).validate_permissions()
    assert ok is False


def test_restricted_in_registry_but_disabled():
    assert "linkedin" in REGISTRY and "internshala" in REGISTRY
    assert REGISTRY["linkedin"](AdapterContext()).is_enabled is False


# ── bias ───────────────────────────────────────────────────────────────────
def test_bias_check_flags_sensitive_brief():
    biased = dict(BRIEF, jd_text="Looking for a young male candidate")
    flags = bias_check(biased, STRONG)
    assert any("sensitive" in f for f in flags)


def test_contact_only_from_permissioned_source():
    from app.talent_finder.adapters.base import normalize_common
    pub = normalize_common({"name": "X", "email": "x@y.com"}, "Public", "public_web", "public_allowed")
    assert pub["email"] is None      # public source must not carry contact info
    perm = normalize_common({"name": "X", "email": "x@y.com"}, "Internal", "internal_db", "permissioned")
    assert perm["email"] == "x@y.com"


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    passed = 0
    for fn in fns:
        fn()
        print(f"  ok  {fn.__name__}")
        passed += 1
    print(f"\n{passed}/{len(fns)} tests passed")
