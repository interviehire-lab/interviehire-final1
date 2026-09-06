"""Internal, fully-permissioned adapters that search data we already hold:
the existing applicants table (people who applied to this org's jobs) and their
previously-uploaded resumes. No external calls, no compliance risk.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List

from .base import SourceAdapter, AdapterContext

TEST_REMARK = "__ih_test_session__"

# Small common-skills lexicon to pull skills out of free-text resumes.
COMMON_SKILLS = [
    "python", "java", "javascript", "typescript", "react", "node", "go", "rust", "c++", "c#",
    "sql", "postgresql", "mongodb", "aws", "gcp", "azure", "docker", "kubernetes", "django",
    "fastapi", "flask", "spring", "machine learning", "nlp", "data analysis", "excel", "tableau",
    "power bi", "salesforce", "hubspot", "crm", "sales", "b2b", "saas", "marketing", "seo",
    "product management", "figma", "ui", "ux", "communication", "leadership", "project management",
]


def _extract_skills(text: str, extra: List[str]) -> List[str]:
    blob = (text or "").lower()
    found = []
    for s in COMMON_SKILLS + [str(x).lower() for x in (extra or [])]:
        if s and s in blob and s not in found:
            found.append(s)
    return found


def _years_from_text(text: str):
    m = re.search(r"(\d+(?:\.\d+)?)\s*\+?\s*years", (text or "").lower())
    return float(m.group(1)) if m else None


class InternalCandidateAdapter(SourceAdapter):
    source_name = "Internal Applicant Database"
    source_type = "internal_db"
    permission_mode = "permissioned"
    is_enabled = True

    def search_candidates(self, brief: Dict[str, Any]) -> List[Dict[str, Any]]:
        db = self.ctx.db
        if db is None:
            return []
        from app.models.applicant import Applicant
        from app.models.job import Job
        q = db.query(Applicant).join(Job, Applicant.job_id == Job.id).filter(Applicant.removed_at.is_(None))
        if self.ctx.organisation_id:
            q = q.filter(Job.organisation_id == self.ctx.organisation_id)
        rows = q.limit(2000).all()

        want = [str(s).lower() for s in (brief.get("must_have_skills") or []) + (brief.get("good_to_have_skills") or [])]
        want += [str(brief.get("title") or "").lower()]
        out: List[Dict[str, Any]] = []
        for a in rows:
            if (a.remarks or "") == TEST_REMARK:
                continue  # exclude throwaway test-session candidates
            text = " ".join(filter(None, [a.name, a.resume_text, a.resume_analysis_report]))
            out.append({
                "full_name": a.name,
                "email": a.email,
                "phone": a.phone,
                "resume_url": a.resume_url,
                "resume_text": a.resume_text or "",
                "skills": _extract_skills(text, want),
                "years_of_experience": _years_from_text(a.resume_text or ""),
                "profile_url": None,
                "_applicant_id": str(a.id),
            })
        return out


class ResumeDatabaseAdapter(SourceAdapter):
    """Searches previously-uploaded resumes (applicants that have resume_text),
    keyword-ranked against the brief. Same permissioned data, resume-first lens."""
    source_name = "Resume Database"
    source_type = "resume_db"
    permission_mode = "permissioned"
    is_enabled = True

    def search_candidates(self, brief: Dict[str, Any]) -> List[Dict[str, Any]]:
        db = self.ctx.db
        if db is None:
            return []
        from app.models.applicant import Applicant
        from app.models.job import Job
        q = db.query(Applicant).join(Job, Applicant.job_id == Job.id).filter(
            Applicant.resume_text.isnot(None), Applicant.removed_at.is_(None)
        )
        if self.ctx.organisation_id:
            q = q.filter(Job.organisation_id == self.ctx.organisation_id)
        rows = q.limit(2000).all()

        terms = [str(s).lower() for s in (brief.get("must_have_skills") or []) + (brief.get("good_to_have_skills") or [])]
        out: List[Dict[str, Any]] = []
        for a in rows:
            if (a.remarks or "") == TEST_REMARK:
                continue
            blob = (a.resume_text or "").lower()
            if terms and not any(t in blob for t in terms):
                continue  # resume must mention at least one wanted skill
            out.append({
                "full_name": a.name,
                "email": a.email,
                "phone": a.phone,
                "resume_url": a.resume_url,
                "resume_text": a.resume_text or "",
                "skills": _extract_skills(a.resume_text or "", terms),
                "years_of_experience": _years_from_text(a.resume_text or ""),
            })
        return out
