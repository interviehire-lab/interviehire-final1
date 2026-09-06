from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from uuid import UUID
from typing import List, Dict, Any

from app.database import get_db
from app.models.applicant import Applicant
from app.models.job import Job
from app.models.ai_integration import InterviewSession, ProctoringLog
from app.routers.auth import get_current_user, get_active_org_id
from app.routers.jobs import _verify_job_access
from app.models.user import User

router = APIRouter()

@router.get("/jobs/{job_id}")
def get_job_leaderboard(
    job_id: UUID,
    current_user: User = Depends(get_current_user),
    active_org_id: UUID = Depends(get_active_org_id),
    db: Session = Depends(get_db)
):
    # Deny-by-default org ownership check (reuses the same helper as jobs.py).
    # This closes the IDOR where a null-org job bypassed the old inline guard and
    # leaked another org's candidate PII/scores. Raises 404 if missing, 403 if the
    # job isn't in the caller's active org.
    _verify_job_access(job_id, current_user, active_org_id, db)

    applicants = db.query(Applicant).filter(
        Applicant.job_id == job_id, Applicant.removed_at.is_(None)
    ).all()
    
    leaderboard = []
    for app in applicants:
        resume_score = app.match_score or 0.0
        if resume_score <= 10.0:
            resume_score = resume_score * 10.0
            
        screening_score = app.screening_score or app.recruiter_screening_score or 0.0
        functional_score = app.functional_score or 0.0
        
        overall_score = round(resume_score * 0.2 + screening_score * 0.3 + functional_score * 0.5, 1)
        
        warning_count = db.query(ProctoringLog).filter(ProctoringLog.sessionId == str(app.id)).count()
        
        rubrics = {}
        pros_count = 0
        cons_count = 0
        session = db.query(InterviewSession).filter(InterviewSession.id == str(app.id)).first()
        if session and session.evaluation:
            eval_data = session.evaluation
            pros_count = len(eval_data.get("strengths") or [])
            cons_count = len(eval_data.get("weaknesses") or [])
            
            dimension_scores = eval_data.get("dimensionScores") or {}
            for key, dim in dimension_scores.items():
                if isinstance(dim, dict) and "score" in dim:
                    label = key.replace("_", " ").title()
                    rubrics[label] = dim["score"]
                    
        if not rubrics and (app.functional_score is not None):
            rubrics = {
                "Technical Fit": app.functional_score,
                "Communication": app.functional_score,
                "Problem Solving": app.functional_score,
                "Culture Fit": app.functional_score
            }

        leaderboard.append({
            "candidate_id": str(app.id),
            "name": app.name,
            "email": app.email,
            "phone": app.phone or "—",
            "overall_score": overall_score,
            "resume_match_score": app.match_score or 0.0,
            "screening_score": screening_score,
            "functional_score": functional_score,
            "cheat_probability": app.cheat_probability.value if app.cheat_probability else "low",
            "proctoring_warnings": warning_count,
            "pros_count": pros_count,
            "cons_count": cons_count,
            "rubrics": rubrics,
            "status": app.remarks or (
                "Functional Stage" if app.functional_status else (
                    "Screening Stage" if app.screening_status else "Resume Stage"
                )
            )
        })
        
    leaderboard.sort(key=lambda x: x["overall_score"], reverse=True)
    return leaderboard
