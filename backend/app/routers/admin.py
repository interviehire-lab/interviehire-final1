from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session
from typing import List

from app.database import get_db
from app.models.organisation import Organisation
from app.models.user import User, UserType
from app.models.job import Job
from app.models.applicant import Applicant
from app.utils.auth import get_current_user

router = APIRouter()


def _require_super_admin(current_user: User) -> None:
    # Same gate already used by GET /api/auth/organisations and
    # POST /api/auth/switch-context (auth.py) — kept identical for consistency.
    if current_user.user_type != UserType.super_admin:
        raise HTTPException(status_code=403, detail="Only Super Admins can access this.")


@router.get("/overview")
def get_admin_overview(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Platform-wide counts across every organisation — the one view a
    super_admin has that a regular recruiter's org-scoped dashboard doesn't.
    No existing endpoint aggregates across orgs (the regular dashboard, and
    even a super_admin's own view of it via get_active_org_id, is always
    scoped to exactly one organisation at a time) — this is genuinely new."""
    _require_super_admin(current_user)

    org_count = db.query(func.count(Organisation.id)).scalar() or 0
    user_count = db.query(func.count(User.id)).scalar() or 0
    job_count = db.query(func.count(Job.id)).scalar() or 0
    applicant_count = db.query(func.count(Applicant.id)).scalar() or 0
    published_job_count = db.query(func.count(Job.id)).filter(Job.status == "published").scalar() or 0

    orgs = (
        db.query(
            Organisation.id,
            Organisation.org_name,
            Organisation.created_at,
            func.count(func.distinct(Job.id)).label("job_count"),
        )
        .outerjoin(Job, Job.organisation_id == Organisation.id)
        .group_by(Organisation.id)
        .order_by(Organisation.created_at.desc())
        .all()
    )
    org_rows = [
        {
            "id": str(o.id),
            "name": o.org_name,
            "created_at": o.created_at.isoformat() if o.created_at else None,
            "job_count": o.job_count,
        }
        for o in orgs
    ]

    recent_users = (
        db.query(User)
        .order_by(User.created_at.desc())
        .limit(10)
        .all()
    )
    recent_user_rows = [
        {
            "id": str(u.id),
            "name": u.name,
            "email": u.email,
            "user_type": u.user_type.value if u.user_type else None,
            "created_at": u.created_at.isoformat() if u.created_at else None,
        }
        for u in recent_users
    ]

    return {
        "organisation_count": org_count,
        "user_count": user_count,
        "job_count": job_count,
        "published_job_count": published_job_count,
        "applicant_count": applicant_count,
        "organisations": org_rows,
        "recent_users": recent_user_rows,
    }
