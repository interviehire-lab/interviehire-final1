from fastapi import APIRouter, Depends, HTTPException, Body, Request, Form, File, UploadFile, Header
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy.orm import Session
from sqlalchemy import func
from uuid import UUID
from datetime import datetime, timedelta, timezone
from typing import Dict, Any, Optional, Tuple
import html
import json
import logging
import os
import shutil
import tempfile

from email_validator import validate_email, EmailNotValidError

from app.database import get_db
from app.models.applicant import Applicant, ApplicantSource, InterviewStatus
from app.models.job import Job, JobStatus
from app.models.user import User
from app.models.organisation import Organisation
from app.config import settings
from app.schemas import OutgoingMessage
from app.websocket_manager import manager
from app.utils.google_calendar import create_calendar_event, update_calendar_event
from app.utils.google_drive import upload_recording
from app.utils.email_sender import send_ical_invitation_email
from app.utils.resume_parser import extract_text_from_file
from app.utils.uploads import ensure_upload_dir, safe_upload_path
from app.utils.application_questions import resolve_questions, collect_answers
from app.routers.invites import _rate_limit

from google_auth_oauthlib.flow import Flow

logger = logging.getLogger(__name__)

router = APIRouter()

# Version stamp recorded on each direct-apply consent grant. Bump when the privacy
# policy shown on the apply form materially changes.
PRIVACY_POLICY_VERSION = "2026-07"

# Accepted resume file types (aligned with what extract_text_from_file can read).
ALLOWED_RESUME_EXTS = (".pdf", ".docx", ".txt")
MAX_RESUME_BYTES = 5 * 1024 * 1024  # 5 MB hard cap on the unauthenticated upload

# Attachments for `file`-type custom questions (broader than a resume, still bounded).
ALLOWED_ATTACHMENT_EXTS = (
    ".pdf", ".doc", ".docx", ".txt", ".rtf",
    ".png", ".jpg", ".jpeg", ".gif",
    ".csv", ".xls", ".xlsx", ".ppt", ".pptx",
)
MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024  # 10 MB hard cap per uploaded attachment

@router.get("/oauth/connect")
def oauth_connect(user_id: str):
    if not settings.GOOGLE_CLIENT_ID or not settings.GOOGLE_CLIENT_SECRET:
        raise HTTPException(status_code=400, detail="Google OAuth client credentials are not configured globally.")
        
    flow = Flow.from_client_config(
        {
            "web": {
                "client_id": settings.GOOGLE_CLIENT_ID,
                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
            }
        },
        scopes=["https://www.googleapis.com/auth/calendar", "https://www.googleapis.com/auth/drive.file"],
        autogenerate_code_verifier=False,
    )
    flow.redirect_uri = settings.GOOGLE_REDIRECT_URI
    authorization_url, state = flow.authorization_url(
        access_type='offline',
        prompt='consent',
        state=user_id
    )
    return RedirectResponse(authorization_url)

@router.get("/oauth2callback")
def oauth2callback(code: str, state: str, db: Session = Depends(get_db)):
    if not settings.GOOGLE_CLIENT_ID or not settings.GOOGLE_CLIENT_SECRET:
        raise HTTPException(status_code=400, detail="Google OAuth client credentials are not configured globally.")
        
    user_id = state
    flow = Flow.from_client_config(
        {
            "web": {
                "client_id": settings.GOOGLE_CLIENT_ID,
                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
            }
        },
        scopes=["https://www.googleapis.com/auth/calendar", "https://www.googleapis.com/auth/drive.file"],
        autogenerate_code_verifier=False,
    )
    flow.redirect_uri = settings.GOOGLE_REDIRECT_URI
    flow.fetch_token(code=code)
    credentials = flow.credentials
    
    try:
        user_uuid = UUID(user_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user ID in state.")
        
    user = db.query(User).filter(User.id == user_uuid).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
        
    user.google_refresh_token = credentials.refresh_token
    user.google_client_id = settings.GOOGLE_CLIENT_ID
    user.google_client_secret = settings.GOOGLE_CLIENT_SECRET
    db.commit()
    
    return HTMLResponse(content="""
    <html>
        <head>
            <title>Connection Successful</title>
            <style>
                body { font-family: 'Segoe UI', sans-serif; background-color: #0b0f19; color: #f3f4f6; text-align: center; padding: 100px 20px; }
                .container { max-width: 500px; margin: 0 auto; background: #1e293b; padding: 40px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.08); }
                h1 { color: #10b981; }
                p { font-size: 18px; color: #94a3b8; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>Google Calendar Connected!</h1>
                <p>Your calendar has been successfully connected to IntervieHire.</p>
                <p>You can close this tab now.</p>
            </div>
        </body>
    </html>
    """)

@router.get("/schedule/{token}")
def get_public_schedule_info(token: str, request: Request, db: Session = Depends(get_db)):
    # Unauthenticated PII lookup — throttle per-IP to blunt token probing/scraping.
    _rate_limit(request, limit=60, window=60.0)
    applicant = db.query(Applicant).filter(Applicant.scheduling_token == token).first()
    if not applicant:
        raise HTTPException(status_code=404, detail="Invalid or expired scheduling token.")
        
    job = db.query(Job).filter(Job.id == applicant.job_id).first()
    job_title = job.role_name or job.title if job else "General Position"
    
    stage = "Resume"
    scheduled_at = None
    if applicant.functional_status is not None:
        stage = "Functional Interview"
        scheduled_at = applicant.functional_scheduled_at
    elif applicant.screening_status is not None:
        stage = "Recruiter Screening"
        scheduled_at = applicant.screening_scheduled_at
        
    return {
        "candidate_name": applicant.name,
        "email": applicant.email,
        "job_title": job_title,
        "stage": stage,
        "scheduled_at": scheduled_at.isoformat() if scheduled_at else None
    }

@router.get("/interview-session/{session_id}")
def get_public_interview_session_info(session_id: UUID, request: Request, db: Session = Depends(get_db)):
    # Unauthenticated PII lookup by applicant id — throttle per-IP against enumeration.
    _rate_limit(request, limit=60, window=60.0)
    applicant = db.query(Applicant).filter(Applicant.id == session_id).first()
    if not applicant:
        raise HTTPException(status_code=404, detail="Session not found.")
        
    job = db.query(Job).filter(Job.id == applicant.job_id).first()
    job_title = job.role_name or job.title if job else "General Position"
    
    stage = "Resume"
    scheduled_at = None
    if applicant.functional_status is not None:
        stage = "Functional Interview"
        scheduled_at = applicant.functional_scheduled_at
    elif applicant.screening_status is not None:
        stage = "Recruiter Screening"
        scheduled_at = applicant.screening_scheduled_at
        
    return {
        "candidate_name": applicant.name,
        "email": applicant.email,
        "job_title": job_title,
        "stage": stage,
        "scheduled_at": scheduled_at.isoformat() if scheduled_at else None
    }

@router.get("/confirm/{token}", response_class=HTMLResponse)
def confirm_interview_slot(token: str, request: Request, db: Session = Depends(get_db)):
    # Unauthenticated state-changing token endpoint — throttle per-IP.
    _rate_limit(request, limit=30, window=60.0)
    applicant = db.query(Applicant).filter(Applicant.scheduling_token == token).first()
    if not applicant:
        raise HTTPException(status_code=404, detail="Invalid or expired scheduling token.")
        
    job = db.query(Job).filter(Job.id == applicant.job_id).first()
    job_title = job.role_name or job.title if job else "General Position"
    recruiter_id = job.created_by_id if job else None
    
    # Resolve organizer name and email from Organisation
    from app.models.organisation import Organisation
    organizer_name = "IntervieHire Host"
    organizer_email = settings.SMTP_FROM or "hr@interviehire.com"
    if job and job.organisation_id:
        org = db.query(Organisation).filter(Organisation.id == job.organisation_id).first()
        if org:
            if org.org_name:
                organizer_name = org.org_name
            if org.contact_email:
                organizer_email = org.contact_email

    stage = "Interview"
    proposed_time = None
    from app.utils.timezones import default_next_day_1pm_ist, to_ist
    if applicant.functional_status is not None:
        stage = "Functional Interview"
        if not applicant.functional_scheduled_at:
            # Set default timer to 1 PM next day, IST
            applicant.functional_scheduled_at = default_next_day_1pm_ist()
        proposed_time = applicant.functional_scheduled_at
        applicant.functional_status = InterviewStatus.scheduled
        try:
            from app.utils.ai_sync import sync_applicant_to_ai
            sync_applicant_to_ai(db, applicant)
        except Exception as sync_err:
            logger.error(f"Failed to sync applicant to AI database: {sync_err}")
    elif applicant.screening_status is not None:
        stage = "Recruiter Screening"
        if not applicant.screening_scheduled_at:
            # Set default timer to 1 PM next day, IST
            applicant.screening_scheduled_at = default_next_day_1pm_ist()
        proposed_time = applicant.screening_scheduled_at
        applicant.screening_status = InterviewStatus.scheduled
        
    if not proposed_time:
        raise HTTPException(status_code=400, detail="No proposed time is set for the interview.")

    # Reset sequence to 0 on initial confirm
    applicant.calendar_sequence = 0

    # Create google calendar event
    summary = f"{stage} - {applicant.name}"
    desc = f"Interview scheduled for the {job_title} role at IntervieHire."
    
    try:
        event_id = create_calendar_event(
            summary=summary,
            description=desc,
            candidate_email=applicant.email,
            start_time=proposed_time,
            recruiter_id=recruiter_id,
            db=db
        )
        applicant.calendar_event_id = event_id
    except Exception as cal_err:
        logger.error(f"Failed to create Google Calendar event: {cal_err}")
        
    db.commit()
    db.refresh(applicant)
    
    # Send custom MIME/iCalendar confirmation email
    reschedule_link = f"{settings.FRONTEND_URL}/reschedule.html?token={applicant.scheduling_token}"
    _job_qs = f"&jobId={applicant.job_id}" if applicant.job_id else ""
    interview_link = f"{settings.INTERVIEW_ROOM_URL.rstrip('/')}/interviewcandidateroom?sessionId={applicant.id}{_job_qs}"
    uid = f"interview-{stage.lower().replace(' ', '-')}-{applicant.id}@interviehire.com"
    
    try:
        send_ical_invitation_email(
            candidate_name=applicant.name,
            candidate_email=applicant.email,
            job_title=job_title,
            stage_name=stage,
            start_time=proposed_time,
            duration_minutes=30,
            uid=uid,
            sequence=0,
            organizer_email=organizer_email,
            reschedule_link=reschedule_link,
            interview_link=interview_link,
            organizer_name=organizer_name
        )
    except Exception as mail_err:
        logger.error(f"Failed to send confirmation email: {mail_err}")
        
    time_str = to_ist(proposed_time).strftime("%B %d, %Y at %I:%M %p IST")
    
    return f"""
    <html>
        <head>
            <title>Interview Confirmed</title>
            <style>
                body {{
                    font-family: 'Segoe UI', sans-serif;
                    background-color: #0b0f19;
                    color: #f3f4f6;
                    text-align: center;
                    padding: 80px 20px;
                    margin: 0;
                }}
                .container {{
                    max-width: 500px;
                    margin: 0 auto;
                    background: linear-gradient(135deg, rgba(15, 23, 42, 0.9) 0%, rgba(30, 41, 59, 0.8) 100%);
                    border: 1px solid rgba(255, 255, 255, 0.08);
                    border-radius: 16px;
                    padding: 40px;
                    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6);
                }}
                h1 {{ color: #38bdf8; margin-bottom: 20px; }}
                p {{ font-size: 16px; line-height: 1.6; color: #94a3b8; }}
                .time {{
                    font-size: 18px;
                    font-weight: bold;
                    color: #f3f4f6;
                    background: rgba(56, 189, 248, 0.05);
                    padding: 15px;
                    border-radius: 8px;
                    margin: 20px 0;
                    border: 1px solid rgba(56, 189, 248, 0.2);
                }}
                .btn {{
                    display: inline-block;
                    background-color: #38bdf8;
                    color: #0f172a;
                    text-decoration: none;
                    padding: 12px 30px;
                    font-weight: bold;
                    border-radius: 8px;
                    margin-top: 20px;
                }}
                .btn:hover {{ background-color: #7dd3fc; }}
            </style>
        </head>
        <body>
            <div class="container">
                <h1>Interview Confirmed!</h1>
                <p>Thank you. Your {stage} has been scheduled for the following time:</p>
                <div class="time">{time_str}</div>
                <p>A calendar invitation has been sent to your email with details and the join link.</p>
                <a href="{interview_link}" class="btn">Go to Interview Room</a>
            </div>
        </body>
    </html>
    """

@router.post("/reschedule/{token}")
def public_reschedule_interview(
    token: str,
    request: Request,
    new_time: str = Body(..., embed=True),
    db: Session = Depends(get_db)
):
    # Unauthenticated state-changing token endpoint — throttle per-IP.
    _rate_limit(request, limit=30, window=60.0)
    applicant = db.query(Applicant).filter(Applicant.scheduling_token == token).first()
    if not applicant:
        raise HTTPException(status_code=404, detail="Invalid or expired scheduling token.")
        
    try:
        from app.utils.timezones import parse_scheduled_datetime
        parsed_time = parse_scheduled_datetime(new_time)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ISO datetime format.")
        
    job = db.query(Job).filter(Job.id == applicant.job_id).first()
    job_title = job.role_name or job.title if job else "General Position"
    recruiter_id = job.created_by_id if job else None

    # Resolve organizer name and email from Organisation
    from app.models.organisation import Organisation
    organizer_name = "IntervieHire Host"
    organizer_email = settings.SMTP_FROM or "hr@interviehire.com"
    if job and job.organisation_id:
        org = db.query(Organisation).filter(Organisation.id == job.organisation_id).first()
        if org:
            if org.org_name:
                organizer_name = org.org_name
            if org.contact_email:
                organizer_email = org.contact_email

    stage = "Interview"
    if applicant.functional_status is not None:
        stage = "Functional Interview"
        applicant.functional_scheduled_at = parsed_time
        applicant.functional_status = InterviewStatus.scheduled
        try:
            from app.utils.ai_sync import sync_applicant_to_ai
            sync_applicant_to_ai(db, applicant)
        except Exception as sync_err:
            logger.error(f"Failed to sync rescheduled applicant to AI database: {sync_err}")
    elif applicant.screening_status is not None:
        stage = "Recruiter Screening"
        applicant.screening_scheduled_at = parsed_time
        applicant.screening_status = InterviewStatus.scheduled
        try:
            from app.utils.ai_sync import sync_applicant_to_ai
            sync_applicant_to_ai(db, applicant)
        except Exception as sync_err:
            logger.error(f"Failed to sync rescheduled applicant to AI database: {sync_err}")
    
    # Increment sequence counter for updates
    applicant.calendar_sequence = (applicant.calendar_sequence or 0) + 1
    
    if applicant.calendar_event_id:
        try:
            update_calendar_event(
                applicant.calendar_event_id,
                parsed_time,
                recruiter_id=recruiter_id,
                db=db
            )
        except Exception as cal_err:
            logger.error(f"Failed to update Google Calendar event: {cal_err}")
        
    db.commit()
    db.refresh(applicant)
    
    reschedule_link = f"{settings.FRONTEND_URL}/reschedule.html?token={applicant.scheduling_token}"
    _job_qs = f"&jobId={applicant.job_id}" if applicant.job_id else ""
    interview_link = f"{settings.INTERVIEW_ROOM_URL.rstrip('/')}/interviewcandidateroom?sessionId={applicant.id}{_job_qs}"
    uid = f"interview-{stage.lower().replace(' ', '-')}-{applicant.id}@interviehire.com"

    try:
        send_ical_invitation_email(
            candidate_name=applicant.name,
            candidate_email=applicant.email,
            job_title=job_title,
            stage_name=stage,
            start_time=parsed_time,
            duration_minutes=30,
            uid=uid,
            sequence=applicant.calendar_sequence,
            organizer_email=organizer_email,
            reschedule_link=reschedule_link,
            interview_link=interview_link,
            organizer_name=organizer_name
        )
    except Exception as mail_err:
        logger.error(f"Failed to send rescheduled confirmation email: {mail_err}")

    # WhatsApp confirmation — additive alongside the email confirmation above (does
    # NOT touch or duplicate it). Own try/except so a WhatsApp failure can never
    # affect the email send or this endpoint's response; no-ops when Twilio isn't
    # configured or applicant.phone isn't a real number (see twilio_client.py).
    try:
        from app.utils.twilio_client import send_schedule_confirmation_whatsapp
        from app.utils.timezones import to_ist
        first_name = (applicant.name or "").strip().split(" ")[0] or "there"
        parsed_time_ist = to_ist(parsed_time)
        send_schedule_confirmation_whatsapp(
            phone=applicant.phone,
            first_name=first_name,
            stage_name=stage,
            job_title=job_title,
            org_name=organizer_name,
            date_str=parsed_time_ist.strftime("%B %d, %Y"),
            time_str=parsed_time_ist.strftime("%I:%M %p IST"),
            interview_link=interview_link,
            reschedule_link=reschedule_link,
        )
    except Exception as wa_err:
        logger.error(f"Failed to send WhatsApp interview confirmation: {wa_err}")

    return {"status": "success", "new_scheduled_time": parsed_time.isoformat()}


@router.get("/careers/{subdomain}")
def public_careers(subdomain: str, db: Session = Depends(get_db)):
    org = db.query(Organisation).filter(Organisation.career_subdomain == subdomain).first()
    if not org:
        raise HTTPException(status_code=404, detail="Career page not found")
    jobs = (
        db.query(Job)
        .filter(
            Job.organisation_id == org.id,
            Job.is_job_listed == True,
            Job.status == JobStatus.published,
        )
        .all()
    )
    return {
        "organisation": {
            "org_name": org.org_name,
            "logo_url": org.logo_url,
            "career_intro": org.career_intro,
            "career_subdomain": org.career_subdomain,
        },
        "jobs": [
            {
                "id": str(j.id),
                "title": j.title or j.role_name,
                "role_name": j.role_name,
                "location": j.location,
                "job_type": j.job_type,
                "experience_band": j.experience_band,
                "description": j.description,
            }
            for j in jobs
        ],
    }


# ─── DIRECT APPLY (public candidate self-application) ──────────────────────────
#
# Two front doors, one code path:
#   • Careers page  → GET/POST /api/public/careers/{subdomain}/apply/{job_id}  (career_page)
#   • Direct link   → GET/POST /api/public/apply/{job_id}                       (direct_link)
# The candidate submits their own details + resume; a new Applicant lands straight
# in the recruiter pipeline (screening pending). No recruiter/company middleman.


def _resolve_org_job(db: Session, job_id: UUID, subdomain: Optional[str] = None) -> Tuple[Organisation, Job]:
    """Resolve the (org, job) a public application targets, or 404.

    A job only accepts applications while it is actually live — the same
    `is_job_listed && published` gate the careers listing uses. When a subdomain
    is given the job must also belong to that org.
    """
    org = None
    if subdomain is not None:
        org = db.query(Organisation).filter(Organisation.career_subdomain == subdomain).first()
        if not org:
            raise HTTPException(status_code=404, detail="Career page not found")

    q = db.query(Job).filter(
        Job.id == job_id,
        Job.is_job_listed == True,
        Job.status == JobStatus.published,
    )
    if org is not None:
        q = q.filter(Job.organisation_id == org.id)
    job = q.first()
    if not job:
        raise HTTPException(status_code=404, detail="This job is not open for applications.")

    if org is None:
        org = db.query(Organisation).filter(Organisation.id == job.organisation_id).first()
    return org, job


def _save_and_extract_resume(resume: Optional[UploadFile]) -> Tuple[str, Optional[str]]:
    """Persist an uploaded resume and pull its text. Resume is REQUIRED.

    Returns (resume_url, resume_text). Raises 400 on a missing file, an
    unsupported type, or a file over the size cap. resume_text is None when the
    extracted text is too short to be useful (scanned/garbled).
    """
    if not resume or not resume.filename:
        raise HTTPException(status_code=400, detail="A resume is required to apply.")

    ext = os.path.splitext(resume.filename)[1].lower()
    if ext not in ALLOWED_RESUME_EXTS:
        raise HTTPException(status_code=400, detail="Please upload a PDF, DOCX, or TXT file.")

    resume_dir = "uploads/resumes"
    ensure_upload_dir(resume_dir)
    path = safe_upload_path(resume_dir, resume.filename)
    if not path:
        raise HTTPException(status_code=400, detail="Invalid resume file name.")

    # Stream to disk with a hard size cap — this endpoint is unauthenticated, so
    # bound the write instead of trusting Content-Length.
    written = 0
    try:
        with open(path, "wb") as buf:
            while True:
                chunk = resume.file.read(1024 * 1024)
                if not chunk:
                    break
                written += len(chunk)
                if written > MAX_RESUME_BYTES:
                    buf.close()
                    if os.path.exists(path):
                        os.remove(path)
                    raise HTTPException(status_code=400, detail="Resume is too large (max 5 MB).")
                buf.write(chunk)
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover - disk/IO failure
        logger.error(f"Failed to save uploaded resume: {exc}")
        raise HTTPException(status_code=400, detail="Could not read the uploaded resume.")

    if written == 0:
        if os.path.exists(path):
            os.remove(path)
        raise HTTPException(status_code=400, detail="A resume is required to apply.")

    text = None
    try:
        text = extract_text_from_file(path)
    except Exception as exc:
        logger.error(f"Failed to extract resume text from {path}: {exc}")
    if text and len(text.strip()) < 50:
        text = None  # extraction likely failed (scanned/garbled) — don't store junk
    return path, text


def _broadcast_new_candidate(job: Job, applicant: Applicant) -> None:
    """Fire the same live pipeline update the recruiter-side add-applicant path uses."""
    import asyncio
    message = OutgoingMessage(
        type="candidate_update",
        content=f"New application: {applicant.name} applied for {job.role_name}",
        sender="System",
    ).model_dump_json()
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(manager.broadcast(message, room_id="global"))
    except RuntimeError:
        pass


def _valid_email(email: str) -> bool:
    try:
        validate_email(email, check_deliverability=False)
        return True
    except EmailNotValidError:
        return False


def _applications_closed(job: Job) -> bool:
    """True when the job set a public apply deadline that has already passed.

    NULL deadline → never closed on this axis (the job stays open as long as it is
    published + listed, enforced separately in `_resolve_org_job`). Tolerates a
    naive timestamp (SQLite dev) by treating it as UTC.
    """
    close_at = getattr(job, "applications_close_at", None)
    if not close_at:
        return False
    if close_at.tzinfo is None:
        close_at = close_at.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) >= close_at


async def _handle_apply_submit(
    request: Request, db: Session, job: Job, org: Optional[Organisation],
    source: ApplicantSource, entry_method: str,
) -> HTMLResponse:
    """Parse the multipart apply form (fixed fields + dynamic custom questions +
    resume file), validate, and hand off to _process_application."""
    if _applications_closed(job):
        raise HTTPException(status_code=410, detail="Applications for this role are closed.")
    form = await request.form()
    name = (form.get("name") or "").strip()
    email = (form.get("email") or "").strip().lower()
    phone = (form.get("phone") or "").strip() or None
    consent = str(form.get("consent") or "").strip().lower() in ("true", "on", "1", "yes")
    resume = form.get("resume")  # Starlette UploadFile, or None/"" when absent

    if not name:
        raise HTTPException(status_code=400, detail="Your name is required.")
    if not _valid_email(email):
        raise HTTPException(status_code=400, detail="A valid email address is required.")

    # Collect answers to the client's custom questions (job override → org default).
    questions = resolve_questions(job, org)
    answers, missing = collect_answers(form, questions)
    if missing:
        raise HTTPException(status_code=400, detail=f"Please answer: {missing[0]}")

    # Persist any `file`-type question uploads and attach their saved URL to the
    # matching answer (collect_answers only captured the original filename).
    _save_question_files(form, questions, answers)

    return _process_application(
        db, job, org, source, entry_method,
        name, email, phone, consent, resume, answers,
    )


def _process_application(
    db: Session, job: Job, org: Optional[Organisation],
    source: ApplicantSource, entry_method: str,
    name: str, email: str, phone: Optional[str], consent: bool,
    resume: Optional[UploadFile], answers: Optional[list] = None,
) -> HTMLResponse:
    if not consent:
        raise HTTPException(status_code=400, detail="You must agree to the privacy policy to apply.")

    name = (name or "").strip()
    email = (email or "").strip().lower()

    # Save + read the resume BEFORE touching the DB so a bad file fails cleanly.
    resume_url, resume_text = _save_and_extract_resume(resume)

    # Dedupe by email within this job so a re-application updates rather than
    # duplicates (mirrors the recruiter upload-resumes existing-applicant branch).
    applicant = db.query(Applicant).filter(
        Applicant.job_id == job.id,
        func.lower(Applicant.email) == email,
    ).first()

    if applicant is None:
        applicant = Applicant(
            name=name or "Candidate",
            email=email,
            phone=phone,
            job_id=job.id,
            source=source,
            entry_method=entry_method,
        )
        db.add(applicant)
    else:
        # Returning applicant re-applies: refresh contact + resume, keep stage state.
        if name:
            applicant.name = name
        if phone:
            applicant.phone = phone
        if not applicant.source:
            applicant.source = source
        if not applicant.entry_method:
            applicant.entry_method = entry_method

    if resume_url:
        applicant.resume_url = resume_url
    if resume_text:
        applicant.resume_text = resume_text

    # Store answers to the client's custom application questions (overwrites on
    # re-application). Snapshot includes the question label so it displays even if
    # the recruiter later edits the questions.
    if answers:
        applicant.application_answers = json.dumps(answers)

    # Auto-enter the pipeline at Recruiter Screening (pending). Don't clobber a
    # candidate who is already further along and happens to re-apply.
    if not applicant.screening_status and not applicant.functional_status:
        applicant.screening_status = InterviewStatus.pending

    applicant.consent_given_at = datetime.utcnow()
    applicant.consent_version = PRIVACY_POLICY_VERSION

    db.commit()
    db.refresh(applicant)

    _broadcast_new_candidate(job, applicant)
    return HTMLResponse(content=_apply_success_html(org, job))


# ─── Apply routes ─────────────────────────────────────────────────────────────

@router.get("/careers/{subdomain}/apply/{job_id}", response_class=HTMLResponse)
def career_apply_form(subdomain: str, job_id: UUID, request: Request, db: Session = Depends(get_db)):
    _rate_limit(request, limit=30, window=60.0)
    org, job = _resolve_org_job(db, job_id, subdomain=subdomain)
    return HTMLResponse(content=_apply_form_html(org, job, action=request.url.path))


@router.post("/careers/{subdomain}/apply/{job_id}", response_class=HTMLResponse)
async def career_apply_submit(subdomain: str, job_id: UUID, request: Request, db: Session = Depends(get_db)):
    _rate_limit(request, limit=10, window=60.0)
    org, job = _resolve_org_job(db, job_id, subdomain=subdomain)
    return await _handle_apply_submit(request, db, job, org, ApplicantSource.career_page, "career_page")


@router.get("/apply/{job_id}", response_class=HTMLResponse)
def direct_apply_form(job_id: UUID, request: Request, db: Session = Depends(get_db)):
    _rate_limit(request, limit=30, window=60.0)
    org, job = _resolve_org_job(db, job_id)
    return HTMLResponse(content=_apply_form_html(org, job, action=request.url.path))


@router.post("/apply/{job_id}", response_class=HTMLResponse)
async def direct_apply_submit(job_id: UUID, request: Request, db: Session = Depends(get_db)):
    _rate_limit(request, limit=10, window=60.0)
    org, job = _resolve_org_job(db, job_id)
    return await _handle_apply_submit(request, db, job, org, ApplicantSource.direct_link, "direct_link")


# ─── HTML ─────────────────────────────────────────────────────────────────────

def _apply_page_shell(title: str, inner: str) -> str:
    return f"""
    <html>
        <head>
            <title>{html.escape(title)}</title>
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <style>
                body {{ font-family: 'Segoe UI', sans-serif; background-color: #0b0f19; color: #f3f4f6; margin: 0; padding: 60px 20px; }}
                .container {{ max-width: 560px; margin: 0 auto; background: linear-gradient(135deg, rgba(15,23,42,0.9) 0%, rgba(30,41,59,0.8) 100%); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 40px; box-shadow: 0 10px 40px rgba(0,0,0,0.6); }}
                h1 {{ color: #38bdf8; margin: 0 0 6px; font-size: 24px; }}
                .sub {{ color: #94a3b8; font-size: 15px; margin-bottom: 24px; }}
                label {{ display: block; font-size: 14px; color: #cbd5e1; margin: 16px 0 6px; }}
                input[type=text], input[type=email], input[type=tel], input[type=file], input[type=number], input[type=date], textarea, select {{ width: 100%; box-sizing: border-box; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.12); background: rgba(2,6,23,0.6); color: #f3f4f6; font-size: 15px; font-family: inherit; }}
                textarea {{ min-height: 90px; resize: vertical; }}
                .aq-checkgroup {{ display: flex; flex-direction: column; gap: 8px; margin-top: 4px; }}
                .aq-check {{ display: flex; align-items: center; gap: 8px; margin: 0; font-size: 14px; color: #f3f4f6; cursor: pointer; }}
                .aq-check input {{ width: auto; margin: 0; }}
                .consent {{ display: flex; align-items: flex-start; gap: 10px; margin: 22px 0; font-size: 13px; color: #94a3b8; }}
                .consent input {{ margin-top: 3px; }}
                .btn {{ display: inline-block; width: 100%; box-sizing: border-box; background-color: #38bdf8; color: #0f172a; border: none; text-align: center; padding: 14px 30px; font-weight: bold; font-size: 15px; border-radius: 8px; cursor: pointer; margin-top: 8px; }}
                .btn:hover {{ background-color: #7dd3fc; }}
                a {{ color: #38bdf8; }}
            </style>
        </head>
        <body>
            <div class="container">{inner}</div>
        </body>
    </html>
    """


def _save_question_files(form: Any, questions: list, answers: list) -> None:
    """Persist uploads from `file`-type custom questions.

    For each answered file question, streams the upload to `uploads/attachments/`
    with the same traversal/zip-slip defense and a hard size cap used for resumes,
    then records the saved path as `url` on the matching answer dict (in place).
    The unauthenticated caller means every write is bounded and extension-checked.
    """
    file_ids = {q.get("id") for q in questions if (q.get("type") == "file")}
    if not file_ids:
        return
    by_id = {a.get("id"): a for a in answers}
    attach_dir = "uploads/attachments"
    for qid in file_ids:
        answer = by_id.get(qid)
        if not answer:
            continue  # not answered (optional + skipped)
        upload = form.get(f"aq__{qid}")
        filename = getattr(upload, "filename", "") or ""
        if not filename:
            continue

        ext = os.path.splitext(filename)[1].lower()
        if ext not in ALLOWED_ATTACHMENT_EXTS:
            raise HTTPException(status_code=400, detail=f"Unsupported file type for \"{answer.get('question') or qid}\".")

        ensure_upload_dir(attach_dir)
        path = safe_upload_path(attach_dir, filename)
        if not path:
            raise HTTPException(status_code=400, detail="Invalid attachment file name.")

        written = 0
        try:
            with open(path, "wb") as buf:
                while True:
                    chunk = upload.file.read(1024 * 1024)
                    if not chunk:
                        break
                    written += len(chunk)
                    if written > MAX_ATTACHMENT_BYTES:
                        buf.close()
                        if os.path.exists(path):
                            os.remove(path)
                        raise HTTPException(status_code=400, detail="Attachment is too large (max 10 MB).")
                    buf.write(chunk)
        except HTTPException:
            raise
        except Exception as exc:  # pragma: no cover - disk/IO failure
            logger.error(f"Failed to save question attachment {filename}: {exc}")
            raise HTTPException(status_code=400, detail="Could not read the uploaded attachment.")

        if written == 0:
            if os.path.exists(path):
                os.remove(path)
            continue
        answer["url"] = path


def _render_question_field(q: dict) -> str:
    """Render one custom application question as a labeled form control.

    Field name is `aq__<id>` (matched by collect_answers on submit).
    """
    qid = q.get("id") or ""
    name = html.escape(f"aq__{qid}")
    label = html.escape(q.get("label") or "")
    req = "required" if q.get("required") else ""
    star = ' <span style="color:#f87171;">*</span>' if q.get("required") else ""
    qtype = q.get("type") or "short_text"

    if qtype == "long_text":
        field = f'<textarea name="{name}" {req}></textarea>'
    elif qtype == "boolean":
        field = (
            f'<select name="{name}" {req}>'
            f'<option value="" disabled selected>Select…</option>'
            f'<option value="Yes">Yes</option>'
            f'<option value="No">No</option>'
            f'</select>'
        )
    elif qtype == "select":
        opts = "".join(
            f'<option value="{html.escape(str(o))}">{html.escape(str(o))}</option>'
            for o in (q.get("options") or [])
        )
        field = (
            f'<select name="{name}" {req}>'
            f'<option value="" disabled selected>Select…</option>'
            f'{opts}</select>'
        )
    elif qtype == "multi_select":
        # Each option is its own checkbox sharing the field name; collect_answers
        # reads them all via getlist. HTML `required` can't span a checkbox group,
        # so required multi-selects are enforced server-side (missing → 400).
        boxes = "".join(
            f'<label class="aq-check"><input type="checkbox" name="{name}" value="{html.escape(str(o))}" /> {html.escape(str(o))}</label>'
            for o in (q.get("options") or [])
        )
        field = f'<div class="aq-checkgroup">{boxes}</div>'
    elif qtype == "number":
        field = f'<input type="number" name="{name}" {req} />'
    elif qtype == "date":
        field = f'<input type="date" name="{name}" {req} />'
    elif qtype == "file":
        accept = ",".join(ALLOWED_ATTACHMENT_EXTS)
        field = f'<input type="file" name="{name}" accept="{accept}" {req} />'
    else:  # short_text
        field = f'<input type="text" name="{name}" {req} />'

    return f'<label>{label}{star}</label>{field}'


def _apply_closed_html(org: Optional[Organisation], job: Job) -> str:
    org_name = html.escape(org.org_name) if org and org.org_name else "the team"
    role = html.escape(job.role_name or job.title or "this role")
    inner = f"""
        <h1>Applications closed</h1>
        <div class="sub">Thanks for your interest in {role} at {org_name}.</div>
        <p style="color:#94a3b8; line-height:1.6;">The application window for this role has closed, so we're no longer accepting new applications. Please check back for future openings.</p>
    """
    return _apply_page_shell("Applications closed", inner)


def _apply_form_html(org: Optional[Organisation], job: Job, action: str) -> str:
    # Deadline passed → show the closed page instead of the form (both GET routes).
    if _applications_closed(job):
        return _apply_closed_html(org, job)

    org_name = html.escape(org.org_name) if org and org.org_name else "IntervieHire"
    role = html.escape(job.role_name or job.title or "this role")
    location = html.escape(job.location) if job.location else ""
    where = f" · {location}" if location else ""

    questions = resolve_questions(job, org)
    questions_html = "".join(_render_question_field(q) for q in questions)

    inner = f"""
        <h1>Apply — {role}</h1>
        <div class="sub">{org_name}{where}</div>
        <form method="post" action="{html.escape(action)}" enctype="multipart/form-data">
            <label for="name">Full name</label>
            <input type="text" id="name" name="name" required />
            <label for="email">Email</label>
            <input type="email" id="email" name="email" required />
            <label for="phone">Phone (optional)</label>
            <input type="tel" id="phone" name="phone" />
            <label for="resume">Resume (PDF, DOCX, or TXT — required)</label>
            <input type="file" id="resume" name="resume" accept=".pdf,.docx,.txt" required />
            {questions_html}
            <div class="consent">
                <input type="checkbox" id="consent" name="consent" value="true" required />
                <label for="consent" style="margin:0;">I agree that {org_name} and IntervieHire may store and process my personal data for this application, per the <a href="/privacy" target="_blank">privacy policy</a>.</label>
            </div>
            <button class="btn" type="submit">Submit application</button>
        </form>
    """
    return _apply_page_shell(f"Apply — {job.role_name or job.title or 'Role'}", inner)


def _apply_success_html(org: Optional[Organisation], job: Job) -> str:
    org_name = html.escape(org.org_name) if org and org.org_name else "the team"
    role = html.escape(job.role_name or job.title or "this role")
    inner = f"""
        <h1>Application received</h1>
        <div class="sub">Thanks for applying to {role} at {org_name}.</div>
        <p style="color:#94a3b8; line-height:1.6;">We've recorded your details and resume. If you're a match for the next stage, you'll receive an email with a link to your AI interview. You can close this tab.</p>
    """
    return _apply_page_shell("Application received", inner)
@router.post("/interview-session/{session_id}/recording")
def upload_interview_recording(
    session_id: str,
    file: UploadFile = File(...),
    x_webhook_secret: str | None = Header(default=None, alias="X-Webhook-Secret"),
    db: Session = Depends(get_db),
):
    # Server-to-server call from the engine only (carries large binary uploads, no
    # candidate-facing auth otherwise) — gate it with the shared webhook secret.
    if settings.WEBHOOK_SECRET and x_webhook_secret != settings.WEBHOOK_SECRET:
        raise HTTPException(status_code=403, detail="Invalid webhook secret.")

    # A real scheduled interview's session id IS the applicant's UUID (see
    # ai_sync.sync_applicant_to_ai); demo/test-room sessions use the engine's
    # default Prisma CUID instead, which has no matching Applicant row.
    applicant = None
    try:
        applicant_uuid = UUID(session_id)
        applicant = db.query(Applicant).filter(Applicant.id == applicant_uuid).first()
    except ValueError:
        pass
    job = db.query(Job).filter(Job.id == applicant.job_id).first() if applicant else None
    job_title = (job.role_name or job.title) if job else "Interview"
    candidate_name = applicant.name if applicant else str(session_id)
    filename = f"{candidate_name} - {job_title} - {session_id}.webm"

    tmp = tempfile.NamedTemporaryFile(suffix=".webm", delete=False)
    try:
        shutil.copyfileobj(file.file, tmp)
        tmp.close()
        result = upload_recording(
            tmp.name,
            filename,
            mime_type=file.content_type or "video/webm",
            recruiter_id=job.created_by_id if job else None,
            db=db,
        )
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass

    if not result:
        return {"ok": False, "simulated": True}
    return {"ok": True, "driveFileId": result["id"], "driveUrl": result["webViewLink"]}


# Maps the engine's aviral-eval recommendation onto the fit vocabulary the dashboard
# already renders (`report-page.js` renderScreeningPane, `deep-analysis.js` screeningBlock
# + funnel dots all key off exactly these three strings).
_RECOMMENDATION_TO_FIT_LABEL = {
    "strong_proceed": "Good fit",
    "proceed": "Good fit",
    "hold": "Moderate fit",
    "needs_human_review": "Moderate fit",
    "reject": "Poor fit",
}


@router.post("/interview-session/{session_id}/screening-outcome")
def screening_outcome(
    session_id: UUID,
    x_webhook_secret: str | None = Header(default=None, alias="X-Webhook-Secret"),
    db: Session = Depends(get_db),
):
    """Called (server-to-server, from the engine) right after a recruiter-screening
    interview is scored. Reads the ALREADY-PERSISTED evaluation off the shared engine
    session (never trusts anything the browser claims), records the real screening
    verdict onto the applicant, and — only on a fit — auto-provisions + emails the
    functional-interview invite via the existing, unmodified invite flow."""
    if settings.WEBHOOK_SECRET and x_webhook_secret != settings.WEBHOOK_SECRET:
        raise HTTPException(status_code=403, detail="Invalid webhook secret.")

    applicant = db.query(Applicant).filter(Applicant.id == session_id).first()
    if not applicant:
        raise HTTPException(status_code=404, detail="Applicant not found.")

    # Idempotent replay: this applicant already advanced to functional (either via this
    # same call earlier, or a recruiter manually moved them) — never re-provision, which
    # would reset an in-progress/completed functional session. Hand back the existing link.
    if applicant.functional_status is not None:
        from app.models.interview_invite import InterviewInvite
        from app.routers.invites import build_invite_link

        invite = (
            db.query(InterviewInvite)
            .filter(InterviewInvite.applicant_id == applicant.id, InterviewInvite.stage == "functional")
            .order_by(InterviewInvite.created_at.desc())
            .first()
        )
        return {
            "fits": True,
            "alreadyAdvanced": True,
            "link": build_invite_link(invite.token) if invite else None,
        }

    from app.models.ai_integration import InterviewSession as EngineSession

    engine_session = db.query(EngineSession).filter(EngineSession.id == str(session_id)).first()
    if not engine_session or not engine_session.evaluation:
        raise HTTPException(status_code=409, detail="Screening evaluation is not ready yet.")

    evaluation = engine_session.evaluation or {}
    recommendation = evaluation.get("recommendation")
    overall_score = evaluation.get("overallScore")
    fit_label = _RECOMMENDATION_TO_FIT_LABEL.get(recommendation, "Moderate fit")

    applicant.screening_status = InterviewStatus.completed
    if overall_score is not None:
        try:
            applicant.screening_score = float(overall_score)
        except (TypeError, ValueError):
            pass
    applicant.recruiter_screening = fit_label
    applicant.recruiter_screening_score = applicant.screening_score
    if not applicant.attempted_at:
        applicant.attempted_at = datetime.now(timezone.utc)
    db.commit()

    if fit_label != "Good fit":
        return {"fits": False, "fitLabel": fit_label}

    from app.routers.invites import _provision_invite_for_applicant

    result = _provision_invite_for_applicant(db, applicant, stage="functional", send=True)
    return {"fits": True, "link": result["link"], "sent": result["sent"]}

