from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from uuid import UUID
from typing import Optional, List
from datetime import datetime

from app.database import get_db
from app.models.job import Job, JobCollaborator
from app.models.applicant import Applicant
from app.models.user import User, UserType
from app.schemas import UsageStatsOut, JobTableRow
from app.utils.auth import get_current_user, get_active_org_id
from app.routers.jobs import _is_test_applicant

router = APIRouter()


def _get_visible_job_ids(current_user: User, active_org_id: Optional[UUID], db: Session) -> List[UUID]:
    org_id = active_org_id if current_user.user_type == UserType.super_admin else current_user.organisation_id
    if not org_id:
        return []
    
    query = db.query(Job).filter(Job.organisation_id == org_id)
    if current_user.user_type == UserType.member:
        query = query.join(Job.collaborators).filter(JobCollaborator.user_id == current_user.id)
    
    return [j.id for j in query.all()]


@router.get("/stats", response_model=UsageStatsOut)
def get_usage_stats(
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
    current_user: User = Depends(get_current_user),
    active_org_id: Optional[UUID] = Depends(get_active_org_id),
    db: Session = Depends(get_db)
):
    visible_job_ids = _get_visible_job_ids(current_user, active_org_id, db)
    if not visible_job_ids:
        return UsageStatsOut(
            total_applicants=0, career_page=0, bulk_upload=0, direct_link=0, ats=0, other=0,
            resume_reached=0, resume_analysed=0, resume_advanced=0, resume_rejected=0,
            screening_reached=0, screening_not_scheduled=0, screening_scheduled=0,
            screening_attempted=0, screening_advanced=0, screening_rejected=0,
            functional_reached=0, functional_not_scheduled=0, functional_scheduled=0,
            functional_attempted=0, functional_hired=0, functional_rejected=0,
        )

    query = db.query(Applicant).filter(Applicant.job_id.in_(visible_job_ids))
    if date_from:
        query = query.filter(Applicant.created_at >= date_from)
    if date_to:
        query = query.filter(Applicant.created_at <= date_to)

    applicants = query.all()
    applicants = [a for a in applicants if not _is_test_applicant(a) and a.removed_at is None]
    total = len(applicants)

    # Reached-stage flags mirror the dashboard's stage derivation (api.js
    # mapApplicantOutToCandidate) so the usage funnel agrees with the pipeline
    # tabs and is monotonic by construction: resume ⊇ screening ⊇ functional.
    def _reached_functional(a):
        return a.functional_status is not None or a.decision == "hired"

    def _reached_screening(a):
        return _reached_functional(a) or a.screening_status is not None or a.decision == "shortlisted"

    def _reached_resume(a):
        return _reached_screening(a) or bool(a.resume_analysed)

    # Stage "Attempted" signals. Recruiter-screening completion is NOT stored in
    # screening_status (nothing ever writes "completed"); it lives in the recruiter
    # feedback fields. Functional completion IS set "completed" by the engine webhook.
    def _screening_attempted(a):
        return a.recruiter_screening is not None or a.recruiter_screening_score is not None

    def _functional_attempted(a):
        return a.functional_status is not None and a.functional_status.value == "completed"

    functional_reached = sum(1 for a in applicants if _reached_functional(a))
    screening_reached = sum(1 for a in applicants if _reached_screening(a))
    resume_reached = sum(1 for a in applicants if _reached_resume(a))

    # How the candidate was actually added: entry_method matches the "Source"
    # column shown everywhere else in the UI. (`source` is the internal stage
    # router and mislabels e.g. a direct-link candidate as "scheduled".) `other`
    # absorbs NULL / functional / any unlisted method so the buckets reconcile.
    career_page = sum(1 for a in applicants if (a.entry_method or "") == "career_page")
    bulk_upload = sum(1 for a in applicants if (a.entry_method or "") == "bulk_upload")
    direct_link = sum(1 for a in applicants if (a.entry_method or "") == "direct_link")
    ats = sum(1 for a in applicants if (a.entry_method or "") == "ats")
    other = total - (career_page + bulk_upload + direct_link + ats)

    return UsageStatsOut(
        total_applicants=total,
        career_page=career_page,
        bulk_upload=bulk_upload,
        direct_link=direct_link,
        ats=ats,
        other=other,
        resume_reached=resume_reached,
        resume_analysed=resume_reached,
        resume_advanced=screening_reached,
        resume_rejected=sum(
            1 for a in applicants
            if _reached_resume(a) and not _reached_screening(a)
            and (a.decision == "rejected" or a.resume_waitlisted)
        ),
        # Screening — precedence partition over reached-screening so the five pills
        # sum to screening_reached: Advanced (reached functional) is terminal here,
        # then Rejected, then Attempted (recruiter feedback present), then Scheduled,
        # else Not Scheduled (reached the stage but still idle).
        screening_reached=screening_reached,
        screening_advanced=functional_reached,
        screening_rejected=sum(
            1 for a in applicants
            if _reached_screening(a) and not _reached_functional(a) and a.decision == "rejected"
        ),
        screening_attempted=sum(
            1 for a in applicants
            if _reached_screening(a) and not _reached_functional(a)
            and a.decision != "rejected" and _screening_attempted(a)
        ),
        screening_scheduled=sum(
            1 for a in applicants
            if _reached_screening(a) and not _reached_functional(a)
            and a.decision != "rejected" and not _screening_attempted(a)
            and a.screening_status is not None and a.screening_status.value == "scheduled"
        ),
        screening_not_scheduled=sum(
            1 for a in applicants
            if _reached_screening(a) and not _reached_functional(a)
            and a.decision != "rejected" and not _screening_attempted(a)
            and not (a.screening_status is not None and a.screening_status.value == "scheduled")
        ),
        # Functional — same precedence partition over reached-functional.
        functional_reached=functional_reached,
        functional_hired=sum(1 for a in applicants if a.decision == "hired"),
        functional_rejected=sum(
            1 for a in applicants
            if _reached_functional(a) and a.decision == "rejected"
        ),
        functional_attempted=sum(
            1 for a in applicants
            if _reached_functional(a) and a.decision not in ("hired", "rejected")
            and _functional_attempted(a)
        ),
        functional_scheduled=sum(
            1 for a in applicants
            if _reached_functional(a) and a.decision not in ("hired", "rejected")
            and not _functional_attempted(a)
            and a.functional_status is not None and a.functional_status.value == "scheduled"
        ),
        functional_not_scheduled=sum(
            1 for a in applicants
            if _reached_functional(a) and a.decision not in ("hired", "rejected")
            and not _functional_attempted(a)
            and not (a.functional_status is not None and a.functional_status.value == "scheduled")
        ),
    )


@router.get("/jobs-table")
def get_jobs_table(
    current_user: User = Depends(get_current_user),
    active_org_id: Optional[UUID] = Depends(get_active_org_id),
    db: Session = Depends(get_db)
):
    org_id = active_org_id if current_user.user_type == UserType.super_admin else current_user.organisation_id
    if not org_id:
        return []

    query = db.query(Job).filter(Job.organisation_id == org_id)
    if current_user.user_type == UserType.member:
        query = query.join(Job.collaborators).filter(JobCollaborator.user_id == current_user.id)

    jobs = query.all()
    return [
        {
            "id": str(j.id),
            "custom_job_id": j.custom_job_id,
            "role_name": j.role_name,
            "title": j.title,
            "experience_band": j.experience_band,
            "tags": j.tags,
            "created_by_name": j.created_by.name if j.created_by else None,
        }
        for j in jobs
    ]


@router.get("/candidates-table")
def get_candidates_table(
    current_user: User = Depends(get_current_user),
    active_org_id: Optional[UUID] = Depends(get_active_org_id),
    db: Session = Depends(get_db)
):
    visible_job_ids = _get_visible_job_ids(current_user, active_org_id, db)
    if not visible_job_ids:
        return []

    applicants = db.query(Applicant).filter(Applicant.job_id.in_(visible_job_ids)).all()
    applicants = [a for a in applicants if not _is_test_applicant(a) and a.removed_at is None]

    # Sync with InterviewSession
    from app.models.ai_integration import InterviewSession, SessionStatus, Severity
    from app.models.applicant import InterviewStatus, CheatProbability
    from app.utils.ai_sync import session_stage

    session_ids = [str(a.id) for a in applicants]
    sessions = db.query(InterviewSession).filter(InterviewSession.id.in_(session_ids)).all()
    sessions_by_id = {s.id: s for s in sessions}

    for a in applicants:
        s = sessions_by_id.get(str(a.id))
        if s:
            updated = False
            # Screening and functional interviews share one session row per
            # applicant — without this check, a completed SCREENING session
            # would silently set functional_status/functional_score instead
            # (this was a real bug: this loop used to write functional_* for
            # every session unconditionally).
            is_functional = session_stage(s) == 'functional'
            status_attr = 'functional_status' if is_functional else 'screening_status'
            score_attr = 'functional_score' if is_functional else 'screening_score'
            # Sync status
            if s.status == SessionStatus.EVALUATED:
                if getattr(a, status_attr) != InterviewStatus.completed:
                    setattr(a, status_attr, InterviewStatus.completed)
                    updated = True
            elif s.status == SessionStatus.IN_PROGRESS:
                if getattr(a, status_attr) != InterviewStatus.scheduled:
                    setattr(a, status_attr, InterviewStatus.scheduled)
                    updated = True

            # Sync score
            if s.evaluation and isinstance(s.evaluation, dict):
                score = s.evaluation.get("overallScore")
                if score is not None:
                    score = float(score)
                    if getattr(a, score_attr) != score:
                        setattr(a, score_attr, score)
                        updated = True

                # Sync report URL
                if s.reportUrl and a.report_url != s.reportUrl:
                    a.report_url = s.reportUrl
                    updated = True

                # Sync cheat probability based on proctoring logs
                from app.models.ai_integration import ProctoringLog
                p_logs = db.query(ProctoringLog).filter(ProctoringLog.sessionId == s.id).all()
                critical_count = sum(1 for log in p_logs if log.severity in [Severity.CRITICAL, Severity.HIGH])
                med_count = sum(1 for log in p_logs if log.severity == Severity.MEDIUM)

                new_cheat = CheatProbability.low
                if critical_count > 0:
                    new_cheat = CheatProbability.high
                elif med_count > 0:
                    new_cheat = CheatProbability.medium

                if a.cheat_probability != new_cheat:
                    a.cheat_probability = new_cheat
                    updated = True

                # Sync attempted_at/completed_at
                completed_at = s.completedAt or s.updatedAt
                if completed_at and a.attempted_at != completed_at:
                    a.attempted_at = completed_at
                    updated = True

            if updated:
                db.add(a)

    if applicants:
        db.commit()

    return [
        {
            "id": str(a.id),
            "name": a.name,
            "email": a.email,
            "phone": a.phone,
            "source": a.source,
            "job_id": str(a.job_id),
            "screening_status": a.screening_status,
            "screening_score": a.screening_score,
            "functional_status": a.functional_status,
            "functional_score": a.functional_score,
            "cheat_probability": a.cheat_probability,
            "recruiter_screening": a.recruiter_screening,
            "recruiter_screening_score": a.recruiter_screening_score,
            "attempted_at": a.attempted_at.isoformat() if a.attempted_at else None,
            "created_at": a.created_at.isoformat() if a.created_at else None,
            "resume_url": a.resume_url,
            "resume_analysed": a.resume_analysed,
            "match_score": a.match_score,
            "resume_analysis_report": a.resume_analysis_report,
        }
        for a in applicants
    ]