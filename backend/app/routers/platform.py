from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session
from typing import Optional
from uuid import UUID

from app.database import get_db
from app.models.organisation import Organisation, OrganisationStatus
from app.models.user import User, UserStatus, UserType
from app.models.job import Job
from app.models.applicant import Applicant
from app.utils.auth import get_current_user, require_super_admin
from app.utils.audit import record_audit
from app.models.compliance_audit_log import ComplianceAuditLog, AuditActorType
from app.routers.jobs import _is_test_applicant

router = APIRouter()

# Every list route here is platform-wide (no organisation_id filter) — pagination
# is load-bearing, not cosmetic, once there are more than a handful of orgs.
DEFAULT_LIMIT = 50
MAX_LIMIT = 200


def _clamp_limit(limit: int) -> int:
    return max(1, min(limit, MAX_LIMIT))


@router.get("/overview")
def get_platform_overview(
    current_user: User = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    """Platform-wide counts + a per-organisation table — the one view that doesn't
    exist anywhere else (every other view, even a super_admin's own, is scoped to
    exactly one organisation at a time via get_active_org_id)."""
    org_count = db.query(func.count(Organisation.id)).scalar() or 0
    user_count = db.query(func.count(User.id)).scalar() or 0
    job_count = db.query(func.count(Job.id)).scalar() or 0
    applicant_count = db.query(func.count(Applicant.id)).filter(Applicant.removed_at.is_(None)).scalar() or 0
    published_job_count = db.query(func.count(Job.id)).filter(Job.status == "published").scalar() or 0

    orgs = (
        db.query(
            Organisation.id,
            Organisation.org_name,
            Organisation.status,
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
            "status": (o.status.value if hasattr(o.status, "value") else o.status) or "active",
            "created_at": o.created_at.isoformat() if o.created_at else None,
            "job_count": o.job_count,
        }
        for o in orgs
    ]

    return {
        "organisation_count": org_count,
        "user_count": user_count,
        "job_count": job_count,
        "published_job_count": published_job_count,
        "applicant_count": applicant_count,
        "organisations": org_rows,
    }


@router.get("/organisations")
def list_platform_organisations(
    limit: int = Query(DEFAULT_LIMIT),
    offset: int = Query(0),
    current_user: User = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    """Cross-org list with counts — deliberately separate from GET /api/auth/organisations,
    which stays a bare ORM-row list feeding only the org-switcher dropdown."""
    limit = _clamp_limit(limit)
    total = db.query(func.count(Organisation.id)).scalar() or 0
    rows = (
        db.query(
            Organisation.id,
            Organisation.org_name,
            Organisation.status,
            Organisation.contact_email,
            Organisation.created_at,
            func.count(func.distinct(Job.id)).label("job_count"),
            func.count(func.distinct(User.id)).label("user_count"),
        )
        .outerjoin(Job, Job.organisation_id == Organisation.id)
        .outerjoin(User, User.organisation_id == Organisation.id)
        .group_by(Organisation.id)
        .order_by(Organisation.created_at.desc())
        .limit(limit)
        .offset(offset)
        .all()
    )
    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "organisations": [
            {
                "id": str(r.id),
                "name": r.org_name,
                "status": (r.status.value if hasattr(r.status, "value") else r.status) or "active",
                "contact_email": r.contact_email,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "job_count": r.job_count,
                "user_count": r.user_count,
            }
            for r in rows
        ],
    }


@router.patch("/organisations/{org_id}")
def update_platform_organisation_status(
    org_id: UUID,
    status: str = Query(..., pattern="^(active|suspended)$"),
    current_user: User = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    """The one platform-level org field that doesn't exist anywhere else. Every
    other org field (logo, career page, application questions) already has a full
    validated edit surface at PUT /api/organisation — this does not duplicate that."""
    org = db.query(Organisation).filter(Organisation.id == org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organisation not found.")
    old_status = org.status.value if org.status else None
    org.status = OrganisationStatus(status)
    db.commit()
    record_audit(
        db,
        action="platform.organisation.status_changed",
        actor_type=AuditActorType.admin,
        actor_id=str(current_user.id),
        organisation_id=org_id,
        entity_type="organisation",
        entity_id=org_id,
        detail={"old_status": old_status, "new_status": status},
    )
    return {"id": str(org.id), "status": status}


@router.get("/users")
def list_platform_users(
    limit: int = Query(DEFAULT_LIMIT),
    offset: int = Query(0),
    current_user: User = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    """Cross-org user list. Role changes / invites / removal stay on the existing
    Team tab (switch-context first) — that endpoint is already org-scoped-safe;
    this is read-only plus the one new cross-org action (status, below)."""
    limit = _clamp_limit(limit)
    total = db.query(func.count(User.id)).scalar() or 0
    rows = (
        db.query(User, Organisation.org_name)
        .outerjoin(Organisation, Organisation.id == User.organisation_id)
        .order_by(User.created_at.desc())
        .limit(limit)
        .offset(offset)
        .all()
    )
    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "users": [
            {
                "id": str(u.id),
                "name": u.name,
                "email": u.email,
                "user_type": u.user_type.value if u.user_type else None,
                "status": u.status.value if u.status else None,
                "organisation_id": str(u.organisation_id) if u.organisation_id else None,
                "organisation_name": org_name,
                "created_at": u.created_at.isoformat() if u.created_at else None,
            }
            for u, org_name in rows
        ],
    }


@router.patch("/users/{user_id}/status")
def update_platform_user_status(
    user_id: UUID,
    status: str = Query(..., pattern="^(active|inactive)$"),
    current_user: User = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="You cannot change your own status.")
    old_status = user.status.value if user.status else None
    user.status = UserStatus(status)
    db.commit()
    record_audit(
        db,
        action="platform.user.status_changed",
        actor_type=AuditActorType.admin,
        actor_id=str(current_user.id),
        organisation_id=user.organisation_id,
        entity_type="user",
        entity_id=user_id,
        detail={"old_status": old_status, "new_status": status, "email": user.email},
    )
    return {"id": str(user.id), "status": status}


@router.get("/jobs")
def list_platform_jobs(
    limit: int = Query(DEFAULT_LIMIT),
    offset: int = Query(0),
    current_user: User = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    """Cross-org job list — read-only. Editing a job (blueprints, pipeline config)
    stays behind switch-context + that org's own Jobs tab; too deep/stateful to
    safely duplicate as a second edit surface."""
    limit = _clamp_limit(limit)
    total = db.query(func.count(Job.id)).scalar() or 0
    rows = (
        db.query(Job, Organisation.org_name)
        .outerjoin(Organisation, Organisation.id == Job.organisation_id)
        .order_by(Job.created_at.desc())
        .limit(limit)
        .offset(offset)
        .all()
    )
    job_ids = [j.id for j, _ in rows]
    applicant_counts: dict = {}
    if job_ids:
        for job_id, count in (
            db.query(Applicant.job_id, func.count(Applicant.id))
            .filter(Applicant.job_id.in_(job_ids), Applicant.removed_at.is_(None))
            .group_by(Applicant.job_id)
            .all()
        ):
            applicant_counts[job_id] = count

    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "jobs": [
            {
                "id": str(j.id),
                "title": j.title,
                "role_name": j.role_name,
                "status": j.status.value if j.status else None,
                "organisation_id": str(j.organisation_id) if j.organisation_id else None,
                "organisation_name": org_name,
                "applicant_count": applicant_counts.get(j.id, 0),
                "created_at": j.created_at.isoformat() if j.created_at else None,
            }
            for j, org_name in rows
        ],
    }


@router.get("/interviews")
def list_platform_interviews(
    limit: int = Query(DEFAULT_LIMIT),
    offset: int = Query(0),
    current_user: User = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    """Cross-org interview/session list — read-only, no write-back. Deliberately
    does NOT replicate /candidates-table's mutating InterviewSession->Applicant
    sync loop (usage.py) platform-wide — that write-back belongs to the one org's
    own regular usage view; running it here too would risk racing it. This reads
    whatever's already synced onto Applicant, falling back to a live InterviewSession
    read only for status, using the same session-id==applicant-id shared-table
    pattern documented in CLAUDE.md."""
    limit = _clamp_limit(limit)
    total = db.query(func.count(Applicant.id)).filter(
        (Applicant.screening_status.isnot(None)) | (Applicant.functional_status.isnot(None)),
        Applicant.removed_at.is_(None),
    ).scalar() or 0
    rows = (
        db.query(Applicant, Job.role_name, Job.organisation_id, Organisation.org_name)
        .join(Job, Job.id == Applicant.job_id)
        .outerjoin(Organisation, Organisation.id == Job.organisation_id)
        .filter(
            (Applicant.screening_status.isnot(None)) | (Applicant.functional_status.isnot(None)),
            Applicant.removed_at.is_(None),
        )
        .order_by(Applicant.attempted_at.desc().nullslast())
        .limit(limit)
        .offset(offset)
        .all()
    )
    rows = [(a, role_name, org_id, org_name) for a, role_name, org_id, org_name in rows if not _is_test_applicant(a)]

    from app.models.ai_integration import InterviewSession
    session_ids = [str(a.id) for a, *_ in rows]
    sessions = db.query(InterviewSession).filter(InterviewSession.id.in_(session_ids)).all() if session_ids else []
    sessions_by_id = {s.id: s for s in sessions}

    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "interviews": [
            {
                "applicant_id": str(a.id),
                "candidate_name": a.name,
                "candidate_email": a.email,
                "job_title": role_name,
                "organisation_id": str(org_id) if org_id else None,
                "organisation_name": org_name,
                "screening_status": a.screening_status.value if a.screening_status else None,
                "screening_score": a.screening_score,
                "functional_status": a.functional_status.value if a.functional_status else None,
                "functional_score": a.functional_score,
                "session_status": sessions_by_id[str(a.id)].status.value if str(a.id) in sessions_by_id else None,
                "attempted_at": a.attempted_at.isoformat() if a.attempted_at else None,
            }
            for a, role_name, org_id, org_name in rows
        ],
    }


@router.get("/audit-log")
def list_platform_audit_log(
    limit: int = Query(DEFAULT_LIMIT),
    offset: int = Query(0),
    current_user: User = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    """Read-side companion to every PATCH above — record_audit() already wrote
    these rows via the existing DPDP-compliance audit log, this just surfaces
    the admin-actor slice of it."""
    limit = _clamp_limit(limit)
    query = db.query(ComplianceAuditLog).filter(ComplianceAuditLog.actor_type == AuditActorType.admin)
    total = query.count()
    rows = query.order_by(ComplianceAuditLog.created_at.desc()).limit(limit).offset(offset).all()
    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "entries": [
            {
                "id": str(r.id),
                "action": r.action,
                "actor_id": r.actor_id,
                "organisation_id": str(r.organisation_id) if r.organisation_id else None,
                "entity_type": r.entity_type,
                "entity_id": r.entity_id,
                "detail": r.detail,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ],
    }
