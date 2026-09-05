from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query, Form, Body, Header
from sqlalchemy.orm import Session
from typing import Optional, List
from uuid import UUID
import shutil, os
from sqlalchemy import func
import logging

logger = logging.getLogger(__name__)
from app.config import settings

from app.database import get_db
from app.models.job import Job, JobStatus, JobType, JobCollaborator
from app.models.applicant import Applicant, ApplicantSource, InterviewStatus
from app.models.user import User, UserType
from app.schemas import (
    JobListOut, JobOut, JobDetailOut, JobSettingsIn,
    JobPipelineCounts, CollaboratorIn, AddApplicantIn, ApplicantOut, FunnelOut, FunnelStage,
    JobCreateIn, ApplicantUpdateIn, BulkApplicantsIn, OutgoingMessage, JobParametersIn,
    ScheduleInterviewIn
)
from app.websocket_manager import manager
from app.utils.auth import get_current_user, get_active_org_id
# Canonical upload-path helpers (shared with app/routers/public.py). Aliased to the
# historical private names so existing call sites in this module stay unchanged.
from app.utils.uploads import ensure_upload_dir as _ensure_upload_dir, safe_upload_path as _safe_upload_path

def _verify_job_access(job_id: UUID, current_user: User, active_org_id: Optional[UUID], db: Session) -> Job:
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
        
    if current_user.user_type == UserType.super_admin:
        if job.organisation_id != active_org_id:
            raise HTTPException(status_code=403, detail="Access denied")
    elif current_user.user_type == UserType.org_admin:
        if job.organisation_id != current_user.organisation_id:
            raise HTTPException(status_code=403, detail="Access denied")
    else: # Member
        if job.organisation_id != current_user.organisation_id:
            raise HTTPException(status_code=403, detail="Access denied")
        collab = db.query(JobCollaborator).filter(JobCollaborator.job_id == job_id, JobCollaborator.user_id == current_user.id).first()
        if not collab:
            raise HTTPException(status_code=403, detail="Access denied")
    return job

def _verify_applicant_access(applicant_id: UUID, current_user: User, active_org_id: Optional[UUID], db: Session) -> Applicant:
    applicant = db.query(Applicant).filter(Applicant.id == applicant_id).first()
    if not applicant:
        raise HTTPException(status_code=404, detail="Applicant not found")
    _verify_job_access(applicant.job_id, current_user, active_org_id, db)
    return applicant


router = APIRouter()


UPLOAD_DIR = "uploads/jd"
_ensure_upload_dir(UPLOAD_DIR)

# Throwaway "Launch test interview" candidates are tagged with this sentinel in
# `remarks` so they never surface in the recruiter funnel, roster, or analytics.
TEST_SESSION_REMARK = "__ih_test_session__"
TEST_SESSION_RESUME = (
    "Synthetic recruiter-preview profile. This record exists only to exercise "
    "the configured interview flow and is excluded from candidate analytics."
)


def _is_test_applicant(a: Applicant) -> bool:
    return (a.remarks or "") == TEST_SESSION_REMARK


def _build_job_out(job: Job, db: Session) -> dict:
    """Helper to build JobOut with pipeline counts."""
    applicants = [
        a for a in db.query(Applicant).filter(Applicant.job_id == job.id).all()
        if not _is_test_applicant(a)
    ]
    import json
    tags = []
    if job.tags:
        try:
            tags = json.loads(job.tags)
        except Exception:
            tags = [t.strip() for t in job.tags.split(",") if t.strip()]

    resume_cnt = 0
    screening_cnt = 0
    functional_cnt = 0
    for a in applicants:
        if a.decision in ("hired", "rejected"):
            continue
        if a.functional_status is not None:
            functional_cnt += 1
        elif a.screening_status is not None or a.decision == "shortlisted":
            screening_cnt += 1
        else:
            resume_cnt += 1

    return {
        **job.__dict__,
        "created_by_name": job.created_by.name if job.created_by else None,
        "tags": tags,
        "pipeline": JobPipelineCounts(
            total=len(applicants),
            resume=resume_cnt,
            screening=screening_cnt,
            functional=functional_cnt,
        ),
        "resume_parameters": json.loads(job.resume_parameters) if job.resume_parameters else None,
        "screening_parameters": json.loads(job.screening_parameters) if job.screening_parameters else None,
        "functional_parameters": json.loads(job.functional_parameters) if job.functional_parameters else None,
        "screening_questions": json.loads(job.screening_questions) if job.screening_questions else None,
        "interview_settings": json.loads(job.interview_settings) if job.interview_settings else None
    }



# ─── JOB LIST ────────────────────────────────────────────────────────────────

@router.get("", response_model=JobListOut)
def list_jobs(
    status: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    active_org_id: Optional[UUID] = Depends(get_active_org_id),
    db: Session = Depends(get_db)
):
    query = db.query(Job)
    if current_user.user_type == UserType.super_admin:
        query = query.filter(Job.organisation_id == active_org_id)
    elif current_user.user_type == UserType.org_admin:
        query = query.filter(Job.organisation_id == current_user.organisation_id)
    else: # Member
        query = query.filter(Job.organisation_id == current_user.organisation_id)
        query = query.join(Job.collaborators).filter(JobCollaborator.user_id == current_user.id)

    all_visible_jobs = query.all()
    
    if status and status != "all":
        query = query.filter(Job.status == status)
    jobs = query.order_by(Job.created_at.desc()).all()

    return JobListOut(
        jobs=[_build_job_out(j, db) for j in jobs],
        total=len(all_visible_jobs),
        published=sum(1 for j in all_visible_jobs if j.status == JobStatus.published),
        draft=sum(1 for j in all_visible_jobs if j.status == JobStatus.draft),
        archived=sum(1 for j in all_visible_jobs if j.status == JobStatus.archived),
    )


@router.post("", response_model=JobOut)
def create_job(
    data: JobCreateIn,
    current_user: User = Depends(get_current_user),
    active_org_id: Optional[UUID] = Depends(get_active_org_id),
    db: Session = Depends(get_db)
):
    import json
    org_id = active_org_id if current_user.user_type == UserType.super_admin else current_user.organisation_id
    if not org_id:
        raise HTTPException(status_code=400, detail="User does not belong to any organisation.")

    # Hiring pipeline (default) vs. exit-interview template. Coerce defensively so
    # an unexpected value can never leave the job in a broken enum state.
    job_kind = JobType.exit if str(data.job_kind or "hiring").strip().lower() == "exit" else JobType.hiring

    # Exit jobs ship with a default question spine so an exit interview has
    # something to ask out of the box; an authored blueprint always wins.
    functional_params = data.functional_parameters
    if job_kind == JobType.exit and not functional_params:
        from app.utils.exit_blueprint import DEFAULT_EXIT_BLUEPRINT
        functional_params = DEFAULT_EXIT_BLUEPRINT

    new_job = Job(
        title=data.title,
        role_name=data.role_name,
        experience_band=data.experience_band,
        custom_job_id=data.custom_job_id,
        status=data.status,
        job_kind=job_kind,
        created_by_id=current_user.id,
        organisation_id=org_id,
        resume_analysis_enabled=data.resume_analysis_enabled,
        recruiter_screening_enabled=data.recruiter_screening_enabled,
        functional_interview_enabled=data.functional_interview_enabled,
        description=data.description,
        resume_parameters=json.dumps(data.resume_parameters) if data.resume_parameters else None,
        screening_parameters=json.dumps(data.screening_parameters) if data.screening_parameters else None,
        functional_parameters=json.dumps(functional_params) if functional_params else None,
        screening_questions=json.dumps(data.screening_questions) if data.screening_questions else json.dumps([
            "Tell me about your professional background and key areas of expertise.",
            "Why are you interested in this position and why do you want to join our organization?",
            "What are your salary expectations, notice period, and preferred work arrangements?",
            "Describe a challenging situation in your previous job and how you resolved it."
        ])
    )
    db.add(new_job)
    db.commit()
    db.refresh(new_job)

    # Automatically make the creator a collaborator
    collab = JobCollaborator(job_id=new_job.id, user_id=current_user.id)
    db.add(collab)
    db.commit()
    db.refresh(new_job)

    return _build_job_out(new_job, db)


def clean_and_parse_json(text: str) -> dict:
    """Cleans markdown wrappers, leading/trailing non-JSON text, then parses it."""
    import re
    import json
    text = text.strip()
    # Find first '{' and last '}'
    first_brace = text.find('{')
    last_brace = text.rfind('}')
    if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
        text = text[first_brace:last_brace + 1]
    return json.loads(text)


def _build_structured_description(ai_data: dict, fallback_text: str) -> str:
    """
    Builds a clean, structured job description string from AI-extracted sections.
    Format:
        Job overview
        <overview text>

        Key responsibilities
        - item 1
        - item 2

        Requirements
        - item 1
        - item 2
    Falls back to legacy summary+description or raw file text if structured fields absent.
    """
    job_overview = (ai_data.get("job_overview") or ai_data.get("summary") or "").strip()
    responsibilities = ai_data.get("key_responsibilities") or []
    requirements = ai_data.get("requirements") or []

    # If no structured fields at all, fall back gracefully
    if not job_overview and not responsibilities and not requirements:
        legacy_desc = ai_data.get("description") or ""
        if job_overview or legacy_desc:
            return f"{job_overview}\n\n{legacy_desc}".strip() if legacy_desc else job_overview
        return fallback_text

    parts = []
    if job_overview:
        parts.append(f"Job overview\n{job_overview}")

    if responsibilities:
        bullet_list = "\n".join(f"- {r}" for r in responsibilities if r)
        parts.append(f"Key responsibilities\n{bullet_list}")

    if requirements:
        bullet_list = "\n".join(f"- {r}" for r in requirements if r)
        parts.append(f"Requirements\n{bullet_list}")

    return "\n\n".join(parts) if parts else fallback_text


# ─── CREATE JOB (file upload path) ───────────────────────────────────────────

@router.post("/upload-jd")
def upload_jd(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user)
):
    """Step 1 of Create Job — upload a PDF or DOCX job description."""
    if not file.filename.endswith((".pdf", ".docx")):
        raise HTTPException(status_code=400, detail="Only .pdf and .docx files are supported")
    file_path = _safe_upload_path(UPLOAD_DIR, file.filename)
    if not file_path:
        raise HTTPException(status_code=400, detail="Invalid filename")
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    return {"file_path": file_path, "filename": os.path.basename(file.filename)}


@router.post("/extract-jd")
def extract_jd(
    file: UploadFile = File(...),
    prompt: Optional[str] = Form(None),
    current_user: User = Depends(get_current_user)
):
    """Parses an uploaded PDF/DOCX job description and extracts details, refined by prompt guidelines."""
    import time
    
    # Validate extension
    if not file.filename.endswith((".pdf", ".docx", ".txt")):
        raise HTTPException(status_code=400, detail="Only .pdf, .docx, and .txt files are supported")
    
    # Save file
    file_path = _safe_upload_path(UPLOAD_DIR, file.filename)
    if not file_path:
        raise HTTPException(status_code=400, detail="Invalid filename")
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    # Extract text from file using robust utility
    from app.utils.resume_parser import extract_text_from_file
    file_text = extract_text_from_file(file_path)
        
    if not file_text or len(file_text.strip()) < 30:
        raise HTTPException(
            status_code=422,
            detail="The uploaded file appears to be empty, scanned, or contains no readable text. Please use the 'Paste Text' option instead."
        )

    # Check if Groq, Grok, or Gemini API key exists
    import os
    from dotenv import load_dotenv
    load_dotenv()
    
    grok_key = os.getenv("GROK_API_KEY") or os.getenv("XAI_API_KEY")
    groq_key = os.getenv("GROQ_API_KEY")
    gemini_key = os.getenv("GEMINI_API_KEY")
    deepseek_key = os.getenv("DEEPSEEK_API_KEY")

    prompt_schema_instructions = f"""
You MUST extract and output a JSON object matching this EXACT format (no other text, markdown formatting, or explanations):
{{
  "role_name": "The official role title (e.g. Senior Frontend Engineer). For placement/university documents, extract the specific project/role title (e.g., 'Automation of Model Monitoring Developer' or 'Phy Systems Engineer').",
  "card_name": "A short, visual card title for the board (e.g. Next.js Core Lead Developer)",
  "experience_band": "Choose one of these: 'Upto 2 Years', '1-4 Years', '3-6 Years', '5+ Years'",
  "job_overview": "A concise 2-3 sentence overview of the role and goals. Plain text only, no bullet points.",
  "key_responsibilities": ["Responsibility 1", "Responsibility 2", "Responsibility 3", "Responsibility 4", "Responsibility 5"],
  "requirements": ["Requirement 1", "Requirement 2", "Requirement 3", "Requirement 4", "Requirement 5"],
  "skills": "Comma-separated key technical skills (e.g. React, Next.js, TypeScript, Python, Tableau)",
  "screening_questions": [
    "Recruiter screening question 1",
    "Recruiter screening question 2",
    "Recruiter screening question 3"
  ],
  "functional_questions": [
    "Technical/functional assessment question 1",
    "Technical/functional assessment question 2",
    "Technical/functional assessment question 3"
  ],
  "resume_parameters": {{
     "must_have": ["Must-have requirement 1 (e.g. 3+ years experience with React)", "Must-have requirement 2", "Must-have requirement 3"],
     "red_flags": ["Red flag 1 (e.g. Lacks JavaScript core understanding)", "Red flag 2", "Red flag 3"],
     "good_to_have": ["Good-to-have skill 1 (e.g. Familiar with Webpack)", "Good-to-have skill 2", "Good-to-have skill 3"],
     "mustHave": ["Must-have requirement 1", "Must-have requirement 2", "Must-have requirement 3"],
     "redFlags": ["Red flag 1", "Red flag 2", "Red flag 3"],
     "goodToHave": ["Good-to-have skill 1", "Good-to-have skill 2", "Good-to-have skill 3"]
  }},
  "screening_parameters": {{
     "experience": [
        {{"parameter": "Total Experience", "preferred_response": "5+ years", "required": true}},
        {{"parameter": "Relevant Experience", "preferred_response": "3+ years", "required": true}}
     ],
     "academic": [
        {{"parameter": "Minimum CGPA", "preferred_response": "7.0 and above", "required": true}},
        {{"parameter": "Eligible Branches", "preferred_response": "A3, A8, AA, A7", "required": true}}
     ],
     "location": [
        {{"parameter": "Current Location", "preferred_response": "Mumbai/Pune/Remote", "required": false}},
        {{"parameter": "Ready to relocate", "preferred_response": "Yes", "required": true}}
     ],
     "compensation": [
        {{"parameter": "Current CTC", "preferred_response": "Market competitive", "required": false}},
        {{"parameter": "Expected CTC", "preferred_response": "Within budget", "required": false}},
        {{"parameter": "Stipend", "preferred_response": "INR 45,000 / month", "required": true}}
     ]
  }},
  "functional_parameters": {{
     "topics": [
        {{
           "name": "React Lifecycle & Render Optimization",
           "type": "Theoretical",
           "difficulty": "Medium",
           "questions": [
              "Explain the difference between Server Components and Client Components.",
              "How does useMemo prevent child re-renders?"
           ]
        }},
        {{
           "name": "Frontend Systems Design",
           "type": "Experiential",
           "difficulty": "Hard",
           "questions": [
              "How would you design a frontend cache for high-frequency stock price feeds?",
              "Describe your strategy for managing complex global state without causing unnecessary re-renders."
           ]
        }}
     ]
  }}
}}
"""

    if deepseek_key:
        import urllib.request
        import json
        
        deepseek_prompt = f"""
You are an expert AI recruiting coordinator and talent partner.
Your task is to analyze the provided Job Description text and combine it with the USER EXTRA INSTRUCTIONS to generate a structured job description metadata object in JSON.

GUIDELINES:
1. If the USER EXTRA INSTRUCTIONS request a different role, domain, style, seniority, or completely override the job description text (for example: "okay an HR" or "make it for a Product Manager"), you MUST generate the details for that new requested role from scratch, ignoring the original Job Description text.
2. Provide realistic and professional content for the role, card visual name, experience level, summary description, key skills (comma-separated), screening questions, and functional assessment questions suitable for the final role.
3. Ensure the JSON is valid and fits the schema exactly.
4. If the document is a university placement/practice school sheet (e.g. from BITS Pilani Practice School Division, Standard Chartered, Intel, etc.):
   - Under 'role_name' and 'card_name', extract the specific project title or role being hired for (e.g., 'Automation of Model Monitoring Developer' or 'Phy Systems Engineer'). If the user prompt asks to focus on a specific project or role (e.g. 'project 1'), extract that project's title and details.
   - Do NOT use generic titles like 'Senior Software Engineer' or placeholders if a specific project or role is mentioned in the document.
   - Extract academic constraints (like CGPA cutoff, e.g. '7 and above', branches/disciplines, e.g. 'A3, A8, AA, A7') and stipend details (e.g. 'INR 45,000 per month') and map them to 'screening_parameters'. Specifically: CGPA cutoffs and eligible branches should go under the 'academic' key as custom parameters, and stipend details should go under 'compensation' as a 'Stipend' parameter.
5. For each parameter in 'screening_parameters', you MUST determine whether it is required (mandatory) or optional/preferred based on the job description and user instructions. Include a boolean '"required": true' if mandatory, or '"required": false' if optional/preferred.

JOB DESCRIPTION TEXT:
\"\"\"
{file_text}
\"\"\"

USER EXTRA INSTRUCTIONS / PROMPT:
\"\"\"
{prompt if prompt else "None"}
\"\"\"

{prompt_schema_instructions}
"""
        try:
            url = "https://api.deepseek.com/v1/chat/completions"
            payload = {
                "model": "deepseek-chat",
                "messages": [
                    {
                        "role": "system",
                        "content": "You are a professional recruiting coordinator. You must return ONLY a JSON object matching the requested schema. Do not write markdown blocks or explanations."
                    },
                    {
                        "role": "user",
                        "content": deepseek_prompt
                    }
                ],
                "response_format": {"type": "json_object"}
            }
            
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {deepseek_key}"
                },
                method="POST"
            )
            
            with urllib.request.urlopen(req, timeout=30) as response:
                res_data = json.loads(response.read().decode("utf-8"))
                text_response = res_data["choices"][0]["message"]["content"].strip()
                ai_data = clean_and_parse_json(text_response)
                
                return {
                    "role_name": ai_data.get("role_name", "Senior Software Engineer"),
                    "card_name": ai_data.get("card_name", "Full Stack Core Architect"),
                    "experience_band": ai_data.get("experience_band", "3-6 Years"),
                    "description": _build_structured_description(ai_data, file_text),
                    "skills": ai_data.get("skills", "Python, React"),
                    "screening_questions": ai_data.get("screening_questions", []),
                    "functional_questions": ai_data.get("functional_questions", []),
                    "resume_parameters": ai_data.get("resume_parameters", {
                        "must_have": [],
                        "red_flags": [],
                        "good_to_have": []
                    }),
                    "screening_parameters": ai_data.get("screening_parameters", {
                        "experience": [],
                        "location": [],
                        "compensation": []
                    }),
                    "functional_parameters": ai_data.get("functional_parameters", {
                        "topics": []
                    }),
                    "file_path": file_path
                }
        except Exception as err:
            print(f"DeepSeek API failure, falling back: {err}")

    if groq_key:
        import urllib.request
        import json
        
        groq_prompt = f"""
You are an expert AI recruiting coordinator and talent partner.
Your task is to analyze the provided Job Description text and combine it with the USER EXTRA INSTRUCTIONS to generate a structured job description metadata object in JSON.

GUIDELINES:
1. If the USER EXTRA INSTRUCTIONS request a different role, domain, style, seniority, or completely override the job description text (for example: "okay an HR" or "make it for a Product Manager"), you MUST generate the details for that new requested role from scratch, ignoring the original Job Description text.
2. Provide realistic and professional content for the role, card visual name, experience level, summary description, key skills (comma-separated), screening questions, and functional assessment questions suitable for the final role.
3. Ensure the JSON is valid and fits the schema exactly.
4. If the document is a university placement/practice school sheet (e.g. from BITS Pilani Practice School Division, Standard Chartered, Intel, etc.):
   - Under 'role_name' and 'card_name', extract the specific project title or role being hired for (e.g., 'Automation of Model Monitoring Developer' or 'Phy Systems Engineer'). If the user prompt asks to focus on a specific project or role (e.g. 'project 1'), extract that project's title and details.
   - Do NOT use generic titles like 'Senior Software Engineer' or placeholders if a specific project or role is mentioned in the document.
   - Extract academic constraints (like CGPA cutoff, e.g. '7 and above', branches/disciplines, e.g. 'A3, A8, AA, A7') and stipend details (e.g. 'INR 45,000 per month') and map them to 'screening_parameters'. Specifically: CGPA cutoffs and eligible branches should go under the 'academic' key as custom parameters, and stipend details should go under 'compensation' as a 'Stipend' parameter.
5. For each parameter in 'screening_parameters', you MUST determine whether it is required (mandatory) or optional/preferred based on the job description and user instructions. Include a boolean '"required": true' if mandatory, or '"required": false' if optional/preferred.

JOB DESCRIPTION TEXT:
\"\"\"
{file_text}
\"\"\"

USER EXTRA INSTRUCTIONS / PROMPT:
\"\"\"
{prompt if prompt else "None"}
\"\"\"

{prompt_schema_instructions}
"""
        try:
            url = "https://api.groq.com/openai/v1/chat/completions"
            payload = {
                "model": "llama-3.1-8b-instant",
                "messages": [
                    {
                        "role": "system",
                        "content": "You are a professional recruiting coordinator. You must return ONLY a JSON object matching the requested schema. Do not write markdown blocks or explanations."
                    },
                    {
                        "role": "user",
                        "content": groq_prompt
                    }
                ],
                "response_format": {"type": "json_object"}
            }
            
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {groq_key}",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                },
                method="POST"
            )
            
            with urllib.request.urlopen(req, timeout=12) as response:
                res_data = json.loads(response.read().decode("utf-8"))
                text_response = res_data["choices"][0]["message"]["content"].strip()
                ai_data = clean_and_parse_json(text_response)
                
                return {
                    "role_name": ai_data.get("role_name", "Senior Software Engineer"),
                    "card_name": ai_data.get("card_name", "Full Stack Core Architect"),
                    "experience_band": ai_data.get("experience_band", "3-6 Years"),
                    "description": _build_structured_description(ai_data, file_text),
                    "skills": ai_data.get("skills", "Python, React"),
                    "screening_questions": ai_data.get("screening_questions", []),
                    "functional_questions": ai_data.get("functional_questions", []),
                    "resume_parameters": ai_data.get("resume_parameters", {
                        "must_have": [],
                        "red_flags": [],
                        "good_to_have": []
                    }),
                    "screening_parameters": ai_data.get("screening_parameters", {
                        "experience": [],
                        "location": [],
                        "compensation": []
                    }),
                    "functional_parameters": ai_data.get("functional_parameters", {
                        "topics": []
                    }),
                    "file_path": file_path
                }
        except Exception as err:
            print(f"Groq API failure, falling back: {err}")

    if grok_key:
        import urllib.request
        import json
        
        grok_prompt = f"""
You are an expert AI recruiting coordinator and talent partner.
Your task is to analyze the provided Job Description text and combine it with the USER EXTRA INSTRUCTIONS to generate a structured job description metadata object in JSON.

GUIDELINES:
1. If the USER EXTRA INSTRUCTIONS request a different role, domain, style, seniority, or completely override the job description text (for example: "okay an HR" or "make it for a Product Manager"), you MUST generate the details for that new requested role from scratch, ignoring the original Job Description text.
2. Provide realistic and professional content for the role, card visual name, experience level, summary description, key skills (comma-separated), screening questions, and functional assessment questions suitable for the final role.
3. Ensure the JSON is valid and fits the schema exactly.
4. If the document is a university placement/practice school sheet (e.g. from BITS Pilani Practice School Division, Standard Chartered, Intel, etc.):
   - Under 'role_name' and 'card_name', extract the specific project title or role being hired for (e.g., 'Automation of Model Monitoring Developer' or 'Phy Systems Engineer'). If the user prompt asks to focus on a specific project or role (e.g. 'project 1'), extract that project's title and details.
   - Do NOT use generic titles like 'Senior Software Engineer' or placeholders if a specific project or role is mentioned in the document.
   - Extract academic constraints (like CGPA cutoff, e.g. '7 and above', branches/disciplines, e.g. 'A3, A8, AA, A7') and stipend details (e.g. 'INR 45,000 per month') and map them to 'screening_parameters'. Specifically: CGPA cutoffs and eligible branches should go under the 'academic' key as custom parameters, and stipend details should go under 'compensation' as a 'Stipend' parameter.
5. For each parameter in 'screening_parameters', you MUST determine whether it is required (mandatory) or optional/preferred based on the job description and user instructions. Include a boolean '"required": true' if mandatory, or '"required": false' if optional/preferred.

JOB DESCRIPTION TEXT:
\"\"\"
{file_text}
\"\"\"

USER EXTRA INSTRUCTIONS / PROMPT:
\"\"\"
{prompt if prompt else "None"}
\"\"\"

{prompt_schema_instructions}
"""
        try:
            url = "https://api.xai.com/v1/chat/completions"
            payload = {
                "model": "grok-beta",
                "messages": [
                    {
                        "role": "system",
                        "content": "You are a professional recruiting coordinator. You must return ONLY a JSON object matching the requested schema. Do not write markdown blocks or explanations."
                    },
                    {
                        "role": "user",
                        "content": grok_prompt
                    }
                ],
                "response_format": {"type": "json_object"}
            }
            
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {grok_key}"
                },
                method="POST"
            )
            
            with urllib.request.urlopen(req, timeout=12) as response:
                res_data = json.loads(response.read().decode("utf-8"))
                text_response = res_data["choices"][0]["message"]["content"].strip()
                ai_data = clean_and_parse_json(text_response)
                
                return {
                    "role_name": ai_data.get("role_name", "Senior Software Engineer"),
                    "card_name": ai_data.get("card_name", "Full Stack Core Architect"),
                    "experience_band": ai_data.get("experience_band", "3-6 Years"),
                    "description": _build_structured_description(ai_data, file_text),
                    "skills": ai_data.get("skills", "Python, React"),
                    "screening_questions": ai_data.get("screening_questions", []),
                    "functional_questions": ai_data.get("functional_questions", []),
                    "resume_parameters": ai_data.get("resume_parameters", {
                        "must_have": [],
                        "red_flags": [],
                        "good_to_have": []
                    }),
                    "screening_parameters": ai_data.get("screening_parameters", {
                        "experience": [],
                        "location": [],
                        "compensation": []
                    }),
                    "functional_parameters": ai_data.get("functional_parameters", {
                        "topics": []
                    }),
                    "file_path": file_path
                }
        except Exception as err:
            print(f"Grok API failure, falling back: {err}")

    if gemini_key:
        import urllib.request
        import json
        
        gemini_prompt = f"""
You are an expert AI recruiting coordinator and talent partner.
Your task is to analyze the provided Job Description text and combine it with the USER EXTRA INSTRUCTIONS to generate a structured job description metadata object in JSON.

GUIDELINES:
1. If the USER EXTRA INSTRUCTIONS request a different role, domain, style, seniority, or completely override the job description text (for example: "okay an HR" or "make it for a Product Manager"), you MUST generate the details for that new requested role from scratch, ignoring the original Job Description text.
2. Provide realistic and professional content for the role, card visual name, experience level, summary description, key skills (comma-separated), screening questions, and functional assessment questions suitable for the final role.
3. Ensure the JSON is valid and fits the schema exactly.
4. If the document is a university placement/practice school sheet (e.g. from BITS Pilani Practice School Division, Standard Chartered, Intel, etc.):
   - Under 'role_name' and 'card_name', extract the specific project title or role being hired for (e.g., 'Automation of Model Monitoring Developer' or 'Phy Systems Engineer'). If the user prompt asks to focus on a specific project or role (e.g. 'project 1'), extract that project's title and details.
   - Do NOT use generic titles like 'Senior Software Engineer' or placeholders if a specific project or role is mentioned in the document.
   - Extract academic constraints (like CGPA cutoff, e.g. '7 and above', branches/disciplines, e.g. 'A3, A8, AA, A7') and stipend details (e.g. 'INR 45,000 per month') and map them to 'screening_parameters'. Specifically: CGPA cutoffs and eligible branches should go under the 'academic' key as custom parameters, and stipend details should go under 'compensation' as a 'Stipend' parameter.
5. For each parameter in 'screening_parameters', you MUST determine whether it is required (mandatory) or optional/preferred based on the job description and user instructions. Include a boolean '"required": true' if mandatory, or '"required": false' if optional/preferred.

JOB DESCRIPTION TEXT:
\"\"\"
{file_text}
\"\"\"

USER EXTRA INSTRUCTIONS / PROMPT:
\"\"\"
{prompt if prompt else "None"}
\"\"\"

{prompt_schema_instructions}
"""
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={gemini_key}"
            payload = {
                "contents": [
                    {
                        "parts": [
                            {"text": gemini_prompt}
                        ]
                    }
                ],
                "generationConfig": {
                    "responseMimeType": "application/json"
                }
            }
            
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                },
                method="POST"
            )
            
            with urllib.request.urlopen(req, timeout=10) as response:
                res_data = json.loads(response.read().decode("utf-8"))
                text_response = res_data["candidates"][0]["content"]["parts"][0]["text"].strip()
                ai_data = clean_and_parse_json(text_response)
                
                return {
                    "role_name": ai_data.get("role_name", "Senior Software Engineer"),
                    "card_name": ai_data.get("card_name", "Full Stack Core Architect"),
                    "experience_band": ai_data.get("experience_band", "3-6 Years"),
                    "description": _build_structured_description(ai_data, file_text),
                    "skills": ai_data.get("skills", "Python, React"),
                    "screening_questions": ai_data.get("screening_questions", []),
                    "functional_questions": ai_data.get("functional_questions", []),
                    "resume_parameters": ai_data.get("resume_parameters", {
                        "must_have": [],
                        "red_flags": [],
                        "good_to_have": []
                    }),
                    "screening_parameters": ai_data.get("screening_parameters", {
                        "experience": [],
                        "location": [],
                        "compensation": []
                    }),
                    "functional_parameters": ai_data.get("functional_parameters", {
                        "topics": []
                    }),
                    "file_path": file_path
                }
        except Exception as err:
            print(f"Gemini API failure, falling back to heuristics: {err}")

    # Analyze filename/prompt to customize the output
    content_key = file.filename.lower()
    prompt_key = prompt.lower() if prompt else ""
    
    # Parse the header of the PDF or clean the filename to get the job title
    import os, re
    
    def extract_job_title_from_pdf_or_filename(text, filename):
        # Clean filename first
        base = os.path.splitext(filename)[0]
        base_clean = base.replace("_", " ").replace("-", " ").strip()
        base_clean = re.sub(r"\b(jd|job description|job|hiring|description|req|specification|spec|pdf|docx|txt)\b", "", base_clean, flags=re.IGNORECASE)
        base_clean = " ".join(base_clean.split())
        fallback_title = " ".join([w.capitalize() for w in base_clean.split()]) if base_clean else "Software Engineer"

        # Try to extract from first line of text
        if text:
            # Clean up double spaces, newlines, etc.
            lines = [l.strip() for l in text.split("\n") if l.strip()]
            if not lines:
                # Split by other dividers if it's a single line
                lines = [l.strip() for l in re.split(r"[\r\n\t]+", text) if l.strip()]
            
            for line in lines[:3]:
                # If the line is short, doesn't contain PDF formatting junk, and looks like a title
                line_clean = re.sub(r"[^\w\s\-\&\/\+\.]", "", line).strip()
                words = line_clean.split()
                if 2 <= len(words) <= 8 and not any(w.lower() in ["%pdf", "obj", "endobj", "stream", "xref"] for w in words):
                    return " ".join([w.capitalize() for w in words])
        
        return fallback_title

    extracted_title = extract_job_title_from_pdf_or_filename(file_text, file.filename)
    role_name = extracted_title
    card_name = extracted_title
    experience_band = "3-6 Years"
    description = f"We are seeking a talented {role_name} to help build and maintain our high-performance applications, design robust APIs, and support our growing team."
    skills = "Python, PostgreSQL, React, TypeScript, Docker, AWS"
    
    screening_questions = [
        "Explain the difference between microservices and a monolithic architecture.",
        "How do you handle race conditions and concurrency in a database-driven system?",
        "Describe a challenging bug you debugged and how you resolved it."
    ]
    
    functional_questions = [
        "Design a rate-limiting middleware for an API that handles 10,000 requests per minute.",
        "How would you optimize a slow database query with millions of records?",
        "Implement a thread-safe singleton pattern in your language of choice."
    ]
    
    # Determine domain match by prioritizing prompt_key, then content_key
    domain = None
    if "hr" in prompt_key or "people" in prompt_key or "recruiter" in prompt_key or "talent" in prompt_key or "recruitment" in prompt_key:
        domain = "hr"
    elif "data" in prompt_key or "ml" in prompt_key or "machine" in prompt_key:
        domain = "ml"
    elif "product" in prompt_key or "pm" in prompt_key or "manager" in prompt_key:
        domain = "pm"
    elif "frontend" in prompt_key or "next" in prompt_key or "react" in prompt_key or "ui" in prompt_key or "front" in prompt_key:
        domain = "frontend"
    elif "hr" in content_key or "people" in content_key or "recruiter" in content_key or "talent" in content_key or "recruitment" in content_key:
        domain = "hr"
    elif "data" in content_key or "ml" in content_key or "machine" in content_key:
        domain = "ml"
    elif "product" in content_key or "pm" in content_key or "manager" in content_key:
        domain = "pm"
    elif "frontend" in content_key or "next" in content_key or "react" in content_key or "ui" in content_key:
        domain = "frontend"

    # Heuristic matching: Data Scientist / ML
    if domain == "ml":
        role_name = "Senior Machine Learning Engineer"
        card_name = "ML & Data Intelligence Lead"
        experience_band = "5+ Years"
        description = "We are looking for a Senior Machine Learning Engineer to lead the design and deployment of large-scale predictive models, fine-tune neural nets, and implement advanced analytics."
        skills = "Python, PyTorch, TensorFlow, Pandas, Kubernetes, SQL"
        screening_questions = [
            "Explain the difference between bagging and boosting algorithms.",
            "How do you handle class imbalance in classification datasets?",
            "What strategies do you use to deploy model updates with zero downtime?"
        ]
        functional_questions = [
            "How would you optimize the memory footprint of a custom DataLoader for massive image files?",
            "Write a script to compute precision-recall curves for a multi-class model output.",
            "Describe how you would design an automated feature engineering pipeline in Spark."
        ]
        
    # Heuristic matching: Product Manager
    elif domain == "pm":
        role_name = "Lead Product Manager"
        card_name = "Requisition & Growth Architect"
        experience_band = "5+ Years"
        description = "We are looking for a Lead Product Manager to own our core onboarding and requisition pipelines, define strategic feature roadmaps, and align cross-functional teams."
        skills = "Product Strategy, Roadmap Design, Agile/Scrum, Mixpanel, SQL"
        screening_questions = [
            "How do you prioritize features when multiple stakeholders have conflicting demands?",
            "Describe a product feature you launched that failed, and what you learned from it.",
            "What metrics would you track to measure the success of an AI resume-screening assistant?"
        ]
        functional_questions = [
            "Write a detailed PRD section for a new collaborative hiring dashboard feature.",
            "How would you design a feedback loop to improve user retention by 15% within a quarter?",
            "Sketch a wireframe flow for candidates completing a self-paced video interview."
        ]
        
    # Heuristic matching: Frontend / React / Next.js
    elif domain == "frontend":
        role_name = "Senior Frontend Architect"
        card_name = "Next.js Core Lead Developer"
        experience_band = "5+ Years"
        description = "We are seeking a Senior Frontend Architect to lead the implementation of our Next.js App Router applications, structure design systems, and maximize PageSpeed scores."
        skills = "React, Next.js, TypeScript, HSL CSS, Tailwind, Webpack"
        screening_questions = [
            "Explain the rendering lifecycle difference between Next.js Server Components and Client Components.",
            "How do you approach core web vitals optimization in a high-traffic Next.js site?",
            "Describe your strategy for managing complex global state without causing unnecessary re-renders."
        ]
        functional_questions = [
            "Implement a custom React hook that throttles inputs for search query API calls.",
            "Explain the difference between JSI and bridge architecture, or how to resolve a rendering bottleneck.",
            "Write a webpack/next.config override to split large utility libraries into separate chunks."
        ]
        
    # Heuristic matching: HR / Recruiter / People Operations
    elif domain == "hr":
        role_name = "HR Operations Coordinator"
        card_name = "Talent & Culture Coordinator"
        experience_band = "1-4 Years"
        description = "We are seeking an HR Operations Coordinator to manage candidate onboarding, handle organizational policy updates, and coordinate cross-functional hiring initiatives."
        skills = "HR Operations, Onboarding, Recruiting, ATS Management, Communication"
        screening_questions = [
            "How do you handle confidential employee or candidate information?",
            "Describe your experience coordinating interviews across multiple timezones.",
            "How do you resolve conflicts between team members or hiring managers?"
        ]
        functional_questions = [
            "Write a standard welcome email and onboarding checklist for a new engineering hire.",
            "How would you structure a monthly metrics report on hiring time-to-fill for leadership?",
            "Detail the steps you would take to resolve an incomplete candidate application."
        ]
        
    # Prompt refinement overrides
    if "senior" in prompt_key or "architect" in prompt_key or "lead" in prompt_key:
        experience_band = "5+ Years"
        role_name = "Lead " + role_name.replace("Senior ", "")
        description = description.replace("seeking a", "seeking a Lead").replace("seeking", "seeking a Lead")
        # Make questions more senior
        screening_questions[0] = "What architectural patterns do you implement to ensure high scalability and disaster recovery?"
        functional_questions[0] = "Design a system architecture to handle real-time sync across 100k connected websockets."
        
    if "junior" in prompt_key or "associate" in prompt_key:
        experience_band = "Upto 2 Years"
        role_name = "Junior " + role_name.replace("Senior ", "").replace("Lead ", "")
        description = description.replace("seeking a", "seeking a Junior").replace("seeking", "seeking a Junior")
        
    if "mobile" in prompt_key or "react native" in prompt_key:
        role_name = role_name.replace("Frontend", "Mobile").replace("Software", "Mobile")
        card_name = "React Native Mobile Architect"
        skills = "React Native, Swift, Kotlin, React, Redux, Fastlane"
        description = "We are looking for a Mobile Architect to build native iOS/Android experiences using React Native, bridge native modules, and manage app store deployments."
        screening_questions[1] = "How do you manage platform-specific styling and layout issues in React Native?"
        functional_questions[1] = "Explain the rendering improvements of the new React Native Architecture (Fabric & TurboModules)."
        
    if "kubernetes" in prompt_key or "cloud" in prompt_key or "devops" in prompt_key:
        skills += ", Kubernetes, Terraform, CI/CD, AWS EKS"
        description += " Focus will include building Kubernetes deployments and designing infrastructure as code using Terraform."
        screening_questions[2] = "Describe your experience setting up multi-stage CI/CD pipelines in Gitlab or Github Actions."
        functional_questions[2] = "Write a Kubernetes deployment yaml with resource limits, liveness/readiness probes, and horizontal scaling."
        
    # Construct fallback parameters based on domain
    if domain == "ml":
        resume_parameters = {
            "must_have": [
                "Expertise in PyTorch, TensorFlow, or Pandas",
                "Strong SQL and data modeling fundamentals",
                "5+ years of ML engineering experience"
            ],
            "red_flags": [
                "No experience with Python or ML libraries",
                "Lacks statistics or linear algebra fundamentals",
                "Only general software background without ML/Data focus"
            ],
            "good_to_have": [
                "Experience with Kubernetes and Docker",
                "Familiarity with NLP, Transformers, or GenAI",
                "Contributions to open-source ML repositories"
            ]
        }
        screening_parameters = {
            "experience": [
                {"parameter": "Total Experience", "preferred_response": "5+ Years", "required": True},
                {"parameter": "Relevant Experience", "preferred_response": "3+ Years ML", "required": True}
            ],
            "location": [
                {"parameter": "Current Location", "preferred_response": "Mumbai/Pune/Remote", "required": False},
                {"parameter": "Ready to relocate", "preferred_response": "Yes", "required": True}
            ],
            "compensation": [
                {"parameter": "Current CTC", "preferred_response": "Market competitive", "required": False},
                {"parameter": "Expected CTC", "preferred_response": "Within budget", "required": False}
            ]
        }
        functional_parameters = {
            "topics": [
                {
                    "name": "Machine Learning Core Theory",
                    "type": "Theoretical",
                    "difficulty": "Medium",
                    "questions": [
                        screening_questions[0] if len(screening_questions) > 0 else "Explain bagging vs boosting.",
                        screening_questions[1] if len(screening_questions) > 1 else "How do you handle class imbalance?"
                    ]
                },
                {
                    "name": "DataLoader & Feature Pipelines",
                    "type": "Experiential",
                    "difficulty": "Hard",
                    "questions": [
                        functional_questions[0] if len(functional_questions) > 0 else "Optimize memory of custom DataLoader.",
                        functional_questions[1] if len(functional_questions) > 1 else "Compute precision-recall curves."
                    ]
                }
            ]
        }
    elif domain == "pm":
        resume_parameters = {
            "must_have": [
                "Product strategy and roadmap design",
                "Experience running Agile/Scrum processes",
                "5+ years product management experience"
            ],
            "red_flags": [
                "No experience with analytics tools like Mixpanel or Amplitude",
                "Lacks leadership or stakeholder management skills",
                "Only engineering experience without product ownership"
            ],
            "good_to_have": [
                "Experience scaling B2B SaaS applications",
                "Background in UI/UX wireframing",
                "Technical background or engineering degree"
            ]
        }
        screening_parameters = {
            "experience": [
                {"parameter": "Total Experience", "preferred_response": "5+ Years", "required": True},
                {"parameter": "Relevant Experience", "preferred_response": "3+ Years PM", "required": True}
            ],
            "location": [
                {"parameter": "Current Location", "preferred_response": "Mumbai/Pune/Remote", "required": False},
                {"parameter": "Ready to relocate", "preferred_response": "Yes", "required": True}
            ],
            "compensation": [
                {"parameter": "Current CTC", "preferred_response": "Market competitive", "required": False},
                {"parameter": "Expected CTC", "preferred_response": "Within budget", "required": False}
            ]
        }
        functional_parameters = {
            "topics": [
                {
                    "name": "Product Strategy & Metrics",
                    "type": "Theoretical",
                    "difficulty": "Medium",
                    "questions": [
                        screening_questions[0] if len(screening_questions) > 0 else "How do you prioritize features?",
                        screening_questions[1] if len(screening_questions) > 1 else "Describe a feature that failed."
                    ]
                },
                {
                    "name": "PRD & Wireframe Scenarios",
                    "type": "Experiential",
                    "difficulty": "Hard",
                    "questions": [
                        functional_questions[0] if len(functional_questions) > 0 else "Write a detailed PRD section.",
                        functional_questions[1] if len(functional_questions) > 1 else "How would you design a feedback loop?"
                    ]
                }
            ]
        }
    elif domain == "hr":
        resume_parameters = {
            "must_have": [
                "HR Operations and Policy Management",
                "Recruiting and ATS tracking expertise",
                "Excellent interpersonal communication"
            ],
            "red_flags": [
                "No experience with confidentiality guidelines",
                "Lacks structured organization skills",
                "Unable to manage multi-timezone scheduling"
            ],
            "good_to_have": [
                "Familiarity with labor laws and compliance regulations",
                "Experience with HRIS software tools",
                "Background in talent acquisition and onboarding"
            ]
        }
        screening_parameters = {
            "experience": [
                {"parameter": "Total Experience", "preferred_response": "2+ Years", "required": True},
                {"parameter": "Relevant Experience", "preferred_response": "1+ Years HR", "required": True}
            ],
            "location": [
                {"parameter": "Current Location", "preferred_response": "Mumbai/Pune/Remote", "required": False},
                {"parameter": "Ready to relocate", "preferred_response": "Yes", "required": True}
            ],
            "compensation": [
                {"parameter": "Current CTC", "preferred_response": "Market competitive", "required": False},
                {"parameter": "Expected CTC", "preferred_response": "Within budget", "required": False}
            ]
        }
        functional_parameters = {
            "topics": [
                {
                    "name": "Employee Relations & Scheduling",
                    "type": "Theoretical",
                    "difficulty": "Medium",
                    "questions": [
                        screening_questions[0] if len(screening_questions) > 0 else "How do you handle confidential info?",
                        screening_questions[1] if len(screening_questions) > 1 else "How do you resolve conflicts?"
                    ]
                },
                {
                    "name": "Onboarding & HR metrics reports",
                    "type": "Experiential",
                    "difficulty": "Medium",
                    "questions": [
                        functional_questions[0] if len(functional_questions) > 0 else "Write standard welcome email.",
                        functional_questions[1] if len(functional_questions) > 1 else "Structure monthly metrics report."
                    ]
                }
            ]
        }
    elif domain == "frontend":
        resume_parameters = {
            "must_have": [
                "Expertise in React and Next.js App Router",
                "Proficiency in TypeScript and HSL/Tailwind CSS",
                "5+ years frontend architect experience"
            ],
            "red_flags": [
                "Lacks rendering lifecycle understanding",
                "No core web vitals optimization experience",
                "Only general HTML/CSS experience without JS frameworks"
            ],
            "good_to_have": [
                "Familiar with Webpack and next.config overrides",
                "Experience setting up global state machines",
                "Contributions to design system implementations"
            ]
        }
        screening_parameters = {
            "experience": [
                {"parameter": "Total Experience", "preferred_response": "5+ Years", "required": True},
                {"parameter": "Relevant Experience", "preferred_response": "3+ Years Frontend", "required": True}
            ],
            "location": [
                {"parameter": "Current Location", "preferred_response": "Mumbai/Pune/Remote", "required": False},
                {"parameter": "Ready to relocate", "preferred_response": "Yes", "required": True}
            ],
            "compensation": [
                {"parameter": "Current CTC", "preferred_response": "Market competitive", "required": False},
                {"parameter": "Expected CTC", "preferred_response": "Within budget", "required": False}
            ]
        }
        functional_parameters = {
            "topics": [
                {
                    "name": "React Hooks & Lifecycle Optimizations",
                    "type": "Theoretical",
                    "difficulty": "Medium",
                    "questions": [
                        screening_questions[0] if len(screening_questions) > 0 else "Explain Server Components vs Client Components.",
                        screening_questions[1] if len(screening_questions) > 1 else "How do you approach Core Web Vitals optimization?"
                    ]
                },
                {
                    "name": "Performance & Custom Webpack Overrides",
                    "type": "Experiential",
                    "difficulty": "Hard",
                    "questions": [
                        functional_questions[0] if len(functional_questions) > 0 else "Implement custom search query React hook.",
                        functional_questions[1] if len(functional_questions) > 1 else "Explain JSI vs bridge architecture."
                    ]
                }
            ]
        }
    else:  # General
        import re
        guessed = ""
        
        # Check if BITS Pilani or similar university placement sheet
        if "birla institute of technology" in file_text.lower() or "practice school" in file_text.lower():
            # Search for Project X Title: ...
            project_match = re.search(r'(?i)Project\s+\d+\s+Title\s*:\s*([^.\n\r]+)', file_text)
            if project_match:
                guessed = project_match.group(1).strip()
            else:
                # Look for role after Job Description for Software Roles or similar
                role_match = re.search(r'(?i)Job\s+Description\s+for\s+Software\s+Roles\s*[\r\n]+\s*([^.\r\n]+)', file_text)
                if role_match:
                    guessed = role_match.group(1).strip()
                else:
                    company_match = re.search(r'(?i)at\s+([^,\r\n]+)', file_text)
                    if company_match:
                        guessed = "Software Intern at " + company_match.group(1).strip()
        
        if not guessed:
            # Try to parse from description text first
            lines = [line.strip() for line in file_text.split("\n") if line.strip()]
            for line in lines[:15]:
                match = re.search(r'(?i)\b(job\s+title|role|position|title)\s*:\s*(.+)', line)
                if match:
                    val = match.group(2).strip()
                    val = re.sub(r'[^\w\s\-\(\)\&]', '', val).strip()
                    if val and len(val) < 60:
                        guessed = val
                        break
        
        if not guessed:
            # Look for We are looking/seeking a ... pattern
            match = re.search(r'(?i)\b(looking\s+for\s+a|seeking\s+a|hiring\s+a|hiring\s+for\s+a)\s+([^.\n,]+)', file_text)
            if match:
                val = match.group(2).strip()
                val = re.split(r'(?i)\b(to|who|with|at|for)\b', val)[0].strip()
                val = re.sub(r'[^\w\s\-\(\)\&]', '', val).strip()
                if val and len(val) < 60:
                    guessed = val
                    
        if not guessed:
            # Look for fallback to filename
            guessed = file.filename
            guessed = re.sub(r"\.[^.]+$", "", guessed)
            guessed = re.sub(r"[_\-.]", " ", guessed)
            guessed = re.sub(r"(?i)\b(resume|cv|jd|job description|recruitment|profile|hiring)\b", "", guessed)
            guessed = guessed.strip()
            
        if guessed:
            role_name = " ".join([w.capitalize() for w in guessed.split()])
            card_name = role_name
        else:
            role_name = "Senior Software Engineer"
            card_name = "Full Stack Core Architect"

        resume_parameters = {
            "must_have": [
                "Proficiency in Python and PostgreSQL",
                "Strong API and server-side architecture background",
                "3+ years software engineering experience"
            ],
            "red_flags": [
                "No experience with docker or containers",
                "Lacks database optimization skills",
                "Unable to write asynchronous code"
            ],
            "good_to_have": [
                "Familiarity with AWS cloud solutions",
                "Experience with testing frameworks (pytest)",
                "Contributions to microservice infrastructures"
            ],
            "mustHave": [
                "Proficiency in Python and PostgreSQL",
                "Strong API and server-side architecture background",
                "3+ years software engineering experience"
            ],
            "redFlags": [
                "No experience with docker or containers",
                "Lacks database optimization skills",
                "Unable to write asynchronous code"
            ],
            "goodToHave": [
                "Familiarity with AWS cloud solutions",
                "Experience with testing frameworks (pytest)",
                "Contributions to microservice infrastructures"
            ]
        }

        # Extract CGPA Cutoff from text if present
        cgpa_cutoff = "7.0 and above"
        cgpa_match = re.search(r'(?i)CGPA\s+cutoff\s*:\s*([^.\r\n]+)', file_text)
        if cgpa_match:
            cgpa_cutoff = cgpa_match.group(1).strip()
            
        # Extract Stipend from text if present
        stipend_val = "INR 45,000 / month"
        stipend_match = re.search(r'(?i)Stipend\s+(?:per\s+month\s+)?\(INR\)\s*:\s*([^.\r\n]+)', file_text)
        if stipend_match:
            stipend_val = "INR " + stipend_match.group(1).strip() + " / month"

        screening_parameters = {
            "experience": [
                {"parameter": "Total Experience", "preferred_response": "3+ Years", "required": True},
                {"parameter": "Relevant Experience", "preferred_response": "2+ Years API", "required": True}
            ],
            "academic": [
                {"parameter": "Minimum CGPA", "preferred_response": cgpa_cutoff, "required": True},
                {"parameter": "Eligible Branches", "preferred_response": "A3, A8, AA, A7", "required": True}
            ],
            "location": [
                {"parameter": "Current Location", "preferred_response": "Mumbai/Pune/Remote", "required": False},
                {"parameter": "Ready to relocate", "preferred_response": "Yes", "required": True}
            ],
            "compensation": [
                {"parameter": "Current CTC", "preferred_response": "Market competitive", "required": False},
                {"parameter": "Expected CTC", "preferred_response": "Within budget", "required": False},
                {"parameter": "Stipend", "preferred_response": stipend_val, "required": True}
            ]
        }
        functional_parameters = {
            "topics": [
                {
                    "name": "API Middleware & Optimization",
                    "type": "Theoretical",
                    "difficulty": "Medium",
                    "questions": [
                        screening_questions[0] if len(screening_questions) > 0 else "Explain microservices vs monolith.",
                        screening_questions[1] if len(screening_questions) > 1 else "How do you handle race conditions?"
                    ]
                },
                {
                    "name": "Database Queries & Threads",
                    "type": "Experiential",
                    "difficulty": "Hard",
                    "questions": [
                        functional_questions[0] if len(functional_questions) > 0 else "Design a rate-limiting middleware.",
                        functional_questions[1] if len(functional_questions) > 1 else "Optimize a slow database query."
                    ]
                }
            ]
        }

    # Add simulated processing delay (1.2 seconds) for UX feel
    time.sleep(1.2)
    
    return {
        "role_name": role_name,
        "card_name": card_name,
        "experience_band": experience_band,
        "description": file_text,
        "skills": skills,
        "screening_questions": screening_questions,
        "functional_questions": functional_questions,
        "resume_parameters": resume_parameters,
        "screening_parameters": screening_parameters,
        "functional_parameters": functional_parameters,
        "file_path": file_path
    }


# ─── JOB DETAIL ──────────────────────────────────────────────────────────────

def _build_job_detail_out(job: Job) -> dict:
    import json
    tags = []
    if job.tags:
        try:
            tags = json.loads(job.tags)
        except Exception:
            tags = [t.strip() for t in job.tags.split(",") if t.strip()]
    return {
        "id": job.id,
        "custom_job_id": job.custom_job_id,
        "title": job.title,
        "role_name": job.role_name,
        "status": job.status,
        "description": job.description,
        "location": job.location,
        "job_type": job.job_type,
        "job_kind": job.job_kind,
        "experience_band": job.experience_band,
        "is_job_listed": job.is_job_listed,
        "resume_analysis_enabled": job.resume_analysis_enabled,
        "recruiter_screening_enabled": job.recruiter_screening_enabled,
        "functional_interview_enabled": job.functional_interview_enabled,
        "created_at": job.created_at,
        "resume_parameters": json.loads(job.resume_parameters) if job.resume_parameters else None,
        "screening_parameters": json.loads(job.screening_parameters) if job.screening_parameters else None,
        "functional_parameters": json.loads(job.functional_parameters) if job.functional_parameters else None,
        "screening_questions": json.loads(job.screening_questions) if job.screening_questions else None,
        "interview_settings": json.loads(job.interview_settings) if job.interview_settings else None,
        "application_questions": json.loads(job.application_questions) if job.application_questions else None,
        "applications_close_at": job.applications_close_at,
        "tags": tags
    }

@router.get("/{job_id}", response_model=JobDetailOut)
def get_job(
    job_id: UUID,
    current_user: User = Depends(get_current_user),
    active_org_id: Optional[UUID] = Depends(get_active_org_id),
    db: Session = Depends(get_db)
):
    job = _verify_job_access(job_id, current_user, active_org_id, db)
    return _build_job_detail_out(job)


@router.patch("/{job_id}/settings", response_model=JobDetailOut)
def update_job_settings(
    job_id: UUID,
    data: JobSettingsIn,
    current_user: User = Depends(get_current_user),
    active_org_id: Optional[UUID] = Depends(get_active_org_id),
    db: Session = Depends(get_db)
):
    job = _verify_job_access(job_id, current_user, active_org_id, db)
    for key, value in data.model_dump(exclude_unset=True).items():
        if key == "tags" and value is not None:
            import json
            setattr(job, key, json.dumps(value))
        elif key == "screening_questions" and value is not None:
            import json
            setattr(job, key, json.dumps(value))
        elif key == "job_kind" and value is not None:
            setattr(job, key, JobType.exit if str(value).strip().lower() == "exit" else JobType.hiring)
        else:
            setattr(job, key, value)
    db.commit()
    db.refresh(job)
    return _build_job_detail_out(job)


@router.post("/{job_id}/duplicate", response_model=JobDetailOut)
def duplicate_job(
    job_id: UUID,
    current_user: User = Depends(get_current_user),
    active_org_id: Optional[UUID] = Depends(get_active_org_id),
    db: Session = Depends(get_db)
):
    """Deep-copy a job into a new, independent draft. Copies all job config plus a
    full snapshot of every applicant (reports/scores/stage statuses intact). The
    copy starts as draft/unlisted but is a real backend job, so it can be published
    and edited like any other. Live single-use handles (scheduling_token,
    calendar_event_id) are reset so the copy never shares a source's scheduling link
    or calendar event."""
    src = _verify_job_access(job_id, current_user, active_org_id, db)

    # Copy every job column except identity, audit timestamps, and the fields we
    # explicitly override below. Stored JSON-as-text columns copy verbatim.
    job_skip = {"id", "title", "status", "is_job_listed", "custom_job_id",
                "created_by_id", "created_at", "updated_at"}
    job_data = {c.name: getattr(src, c.name)
                for c in Job.__table__.columns if c.name not in job_skip}
    new_job = Job(
        **job_data,
        title=f"{src.title} (Copy)",
        status=JobStatus.draft,
        is_job_listed=False,
        custom_job_id=None,
        created_by_id=current_user.id,
    )
    db.add(new_job)
    db.flush()  # assign new_job.id before linking applicants/collaborator

    # Mirror create_job: creator becomes a collaborator on the copy.
    db.add(JobCollaborator(job_id=new_job.id, user_id=current_user.id))

    # Full-state applicant snapshot. Copy every column except identity, linkage,
    # audit timestamp, and live single-use external handles.
    applicant_skip = {"id", "job_id", "created_at", "scheduling_token", "calendar_event_id"}
    src_applicants = db.query(Applicant).filter(Applicant.job_id == src.id).all()
    for a in src_applicants:
        data = {c.name: getattr(a, c.name)
                for c in Applicant.__table__.columns if c.name not in applicant_skip}
        db.add(Applicant(**data, job_id=new_job.id))

    db.commit()
    db.refresh(new_job)
    return _build_job_detail_out(new_job)


@router.delete("/{job_id}")
def delete_job(
    job_id: UUID,
    current_user: User = Depends(get_current_user),
    active_org_id: Optional[UUID] = Depends(get_active_org_id),
    db: Session = Depends(get_db)
):
    job = _verify_job_access(job_id, current_user, active_org_id, db)
    
    db.query(Applicant).filter(Applicant.job_id == job_id).delete(synchronize_session=False)
    db.query(JobCollaborator).filter(JobCollaborator.job_id == job_id).delete(synchronize_session=False)
    
    db.delete(job)
    db.commit()
    return {"message": f"Job {job_id} successfully deleted"}


@router.patch("/{job_id}/parameters", response_model=JobDetailOut)
def update_job_parameters(
    job_id: UUID,
    data: JobParametersIn,
    current_user: User = Depends(get_current_user),
    active_org_id: Optional[UUID] = Depends(get_active_org_id),
    db: Session = Depends(get_db)
):
    job = _verify_job_access(job_id, current_user, active_org_id, db)
    import json
    if data.resume_parameters is not None:
        job.resume_parameters = json.dumps(data.resume_parameters)
    if data.screening_parameters is not None:
        job.screening_parameters = json.dumps(data.screening_parameters)
    if data.functional_parameters is not None:
        job.functional_parameters = json.dumps(data.functional_parameters)
    if data.screening_questions is not None:
        job.screening_questions = json.dumps(data.screening_questions)
    if data.interview_settings is not None:
        job.interview_settings = json.dumps(data.interview_settings)
    if data.application_questions is not None:
        from app.utils.application_questions import normalize_questions
        normalized = normalize_questions(data.application_questions)
        # Empty → store NULL (not "[]") so the job falls back to the org-wide default;
        # a non-empty list is an explicit per-job override.
        job.application_questions = json.dumps(normalized) if normalized else None
    db.commit()
    db.refresh(job)
    return _build_job_detail_out(job)


# ─── TEST INTERVIEW (dev launcher) ────────────────────────────────────────────

@router.post("/{job_id}/test-session")
def create_test_session(
    job_id: UUID,
    current_user: User = Depends(get_current_user),
    active_org_id: Optional[UUID] = Depends(get_active_org_id),
    db: Session = Depends(get_db)
):
    """Spin up a throwaway functional interview from this job's blueprint so the
    recruiter can run it end-to-end while developing. Reuses one tagged test
    candidate per job (excluded from funnel/analytics via TEST_SESSION_REMARK)
    and resets its InterviewSession to SCHEDULED-now so the candidate room can
    start immediately without waiting on a scheduled slot. The session id is the
    applicant id (matching sync_applicant_to_ai). Returns {session_id}."""
    from datetime import datetime, timedelta, timezone
    from app.utils.ai_sync import sync_applicant_to_ai

    job = _verify_job_access(job_id, current_user, active_org_id, db)

    test_applicant = db.query(Applicant).filter(
        Applicant.job_id == job_id,
        Applicant.remarks == TEST_SESSION_REMARK
    ).first()
    # The test applicant carries the recruiter's own name so the avatar greets the
    # account running the preview (P6) — never a hardcoded/placeholder candidate name.
    tester_name = (current_user.name or "").strip() or "Test Candidate"
    if not test_applicant:
        test_applicant = Applicant(
            job_id=job_id,
            name=tester_name,
            email=f"test-session+{job_id}@interviehire.local",
            source=ApplicantSource.direct_link,
            remarks=TEST_SESSION_REMARK,
        )
        db.add(test_applicant)
    else:
        # Reuse: refresh the name in case the signed-in account changed since last test.
        test_applicant.name = tester_name

    # Test sessions inherit the job's real interview settings, including the
    # default requireCv=true policy. Give the synthetic preview candidate a
    # clearly-labelled synthetic résumé so the launcher can exercise that flow
    # without weakening CV enforcement for any real candidate.
    test_applicant.resume_text = TEST_SESSION_RESUME

    # Schedule a minute in the past so the engine never treats it as locked/early.
    now = datetime.now(timezone.utc) - timedelta(minutes=1)
    test_applicant.functional_status = InterviewStatus.scheduled
    test_applicant.functional_scheduled_at = now
    db.commit()
    db.refresh(test_applicant)

    session = sync_applicant_to_ai(db, test_applicant)
    if not session:
        raise HTTPException(
            status_code=500,
            detail="Could not create a test interview from this job's blueprint. Make sure the job has functional questions authored."
        )

    return {"session_id": str(test_applicant.id)}


@router.get("/{job_id}/test-report")
def get_test_report(
    job_id: UUID,
    current_user: User = Depends(get_current_user),
    active_org_id: Optional[UUID] = Depends(get_active_org_id),
    db: Session = Depends(get_db)
):
    """Read-only: return the report for this job's throwaway "Run test interview"
    session so the recruiter can review it in Deep Analysis. The test applicant is
    deliberately excluded from the funnel, responses tabs and analytics, so this
    dedicated endpoint surfaces only its evaluation (no pollution of those counts).
    Returns {exists, evaluated, status, report}."""
    _verify_job_access(job_id, current_user, active_org_id, db)
    test_applicant = db.query(Applicant).filter(
        Applicant.job_id == job_id,
        Applicant.remarks == TEST_SESSION_REMARK
    ).first()
    if not test_applicant:
        return {"exists": False, "evaluated": False, "status": "none", "report": None}
    from app.utils.ai_sync import get_applicant_full_report
    full = get_applicant_full_report(db, str(test_applicant.id))
    return {"exists": True, **full}



# ─── RESPONSES (candidates for a job) ────────────────────────────────────────

def _proctoring_flag_for_session(db: Session, session_id: str) -> Optional[str]:
    """Derive a proctoring severity flag (critical/high/medium/None) from the
    session's ProctoringLog rows — same buckets as the completion webhook so the
    autonomous reconcile path produces identical cheat-probability data."""
    from app.models.ai_integration import ProctoringLog, Severity
    logs = db.query(ProctoringLog).filter(ProctoringLog.sessionId == session_id).all()
    if not logs:
        return None
    critical = [l for l in logs if l.severity == Severity.CRITICAL]
    high = [l for l in logs if l.severity == Severity.HIGH]
    if len(critical) > 0:
        return "critical"
    if len(high) > 0:
        return "high"
    if any(l.severity == Severity.MEDIUM for l in logs):
        return "medium"
    return "low"


def _persist_interview_report(db: Session, applicant, session, ev: dict) -> bool:
    """Durably upsert the dashboard-owned InterviewReport row from an EVALUATED
    session's stored evaluation, so the report survives independently of the
    engine's session and the Interview Analysis tab has a stable store to read.
    Idempotent: returns True only when a row was created or its summary changed."""
    import json
    from app.models.interview_report import InterviewReport
    transcript_list = session.transcript or []
    if isinstance(transcript_list, str):
        try:
            transcript_list = json.loads(transcript_list)
        except Exception:
            transcript_list = []
    transcript_text = ""
    video_url = None
    if isinstance(transcript_list, list):
        recordings = [t for t in transcript_list if isinstance(t, dict) and t.get("type") == "recording"]
        if recordings:
            video_url = recordings[-1].get("url")
        for entry in transcript_list:
            if isinstance(entry, dict):
                speaker = entry.get("speaker") or entry.get("type") or "Participant"
                text = entry.get("text") or ""
                if text:
                    transcript_text += f"{speaker}: {text}\n"

    summary = ev.get("summary") or ""
    detailed_scores = ev  # the full canonical CandidateReport (incl. .structured)
    report = db.query(InterviewReport).filter(InterviewReport.applicant_id == applicant.id).first()
    if not report:
        db.add(InterviewReport(
            applicant_id=applicant.id,
            summary=summary,
            transcript=transcript_text,
            video_url=video_url,
            detailed_scores=detailed_scores,
        ))
        return True
    # Refresh stored copy if the evaluation summary changed (re-evaluation).
    if report.summary != summary:
        report.summary = summary
        report.transcript = transcript_text
        report.video_url = video_url
        report.detailed_scores = detailed_scores
        return True
    return False


def _reconcile_functional_from_sessions(db: Session, applicants: list) -> None:
    """Reflect completed AI interviews in the recruiter view: an EVALUATED
    InterviewSession (written by the interview engine into the shared DB) marks
    the applicant completed, copies its score, derives the proctoring/cheat flag,
    and durably persists the InterviewReport — so the dashboard's Deep Analysis
    and Interview Analysis tab see real, saved results fully autonomously (no
    manual step, no dependency on the completion webhook)."""
    from app.models.ai_integration import InterviewSession, SessionStatus
    from app.models.applicant import InterviewStatus, CheatProbability
    changed = False
    for a in applicants:
        session = db.query(InterviewSession).filter(InterviewSession.id == str(a.id)).first()
        if not session:
            continue
        if session.status == SessionStatus.EVALUATED:
            ev = session.evaluation or {}
            score = ev.get("overallScore")
            if a.functional_status != InterviewStatus.completed:
                a.functional_status = InterviewStatus.completed
                changed = True
            if score is not None and a.functional_score != float(score):
                a.functional_score = float(score)
                a.overall_interview_score = float(score)
                changed = True
            if session.reportUrl and a.report_url != session.reportUrl:
                a.report_url = session.reportUrl
                changed = True
            # Proctoring → cheat probability (only set once, when not already known).
            if a.proctoring_severity_flag is None:
                flag = _proctoring_flag_for_session(db, str(a.id))
                if flag is not None:
                    a.proctoring_severity_flag = flag
                    a.cheat_probability = (
                        CheatProbability.high if flag in ("critical", "high")
                        else CheatProbability.medium if flag == "medium"
                        else CheatProbability.low
                    )
                    changed = True
            # Durable, dashboard-owned report storage.
            try:
                if _persist_interview_report(db, a, session, ev):
                    changed = True
            except Exception:
                pass
        elif session.status == SessionStatus.IN_PROGRESS and a.functional_status is None:
            a.functional_status = InterviewStatus.scheduled
            changed = True
    if changed:
        try:
            db.commit()
        except Exception:
            db.rollback()


@router.get("/{job_id}/responses")
def get_responses(
    job_id: UUID,
    tab: Optional[str] = Query("overview"),  # overview | resume | screening | functional
    current_user: User = Depends(get_current_user),
    active_org_id: Optional[UUID] = Depends(get_active_org_id),
    db: Session = Depends(get_db)
):
    job = _verify_job_access(job_id, current_user, active_org_id, db)

    applicants = [
        a for a in db.query(Applicant).filter(Applicant.job_id == job_id).all()
        if not _is_test_applicant(a)
    ]
    _reconcile_functional_from_sessions(db, applicants)

    if tab == "overview":
        return _build_funnel(applicants)
    elif tab == "resume":
        return [a for a in applicants]
    elif tab == "screening":
        return [a for a in applicants if a.screening_status is not None]
    elif tab == "functional":
        return [a for a in applicants if a.functional_status is not None]
    return applicants


@router.get("/{job_id}/interview-analysis")
def get_interview_analysis(
    job_id: UUID,
    current_user: User = Depends(get_current_user),
    active_org_id: Optional[UUID] = Depends(get_active_org_id),
    db: Session = Depends(get_db),
):
    """Job-level Interview Analysis listing: every applicant whose AI interview has
    been EVALUATED, with a compact summary read from the stored evaluation. The
    reconcile pass first persists scores/proctoring/InterviewReport autonomously,
    so the list reflects reports the moment the candidate finishes — no manual
    transcript→LLM→upload step. The full report is fetched per-row on open via
    GET /applicants/{id}/functional-report."""
    from app.models.ai_integration import InterviewSession, SessionStatus

    job = _verify_job_access(job_id, current_user, active_org_id, db)
    applicants = [
        a for a in db.query(Applicant).filter(Applicant.job_id == job_id).all()
        if not _is_test_applicant(a)
    ]
    _reconcile_functional_from_sessions(db, applicants)

    out = []
    for a in applicants:
        session = db.query(InterviewSession).filter(InterviewSession.id == str(a.id)).first()
        if not session or session.status != SessionStatus.EVALUATED or not session.evaluation:
            continue
        ev = session.evaluation or {}
        structured = ev.get("structured") or {}
        breakdown = ev.get("questionBreakdown") or structured.get("questionBreakdown") or []
        proctoring = structured.get("proctoring") or ev.get("proctoring") or {}
        violations = proctoring.get("violations") if isinstance(proctoring, dict) else None
        out.append({
            "applicant_id": str(a.id),
            "name": a.name,
            "email": a.email,
            "status": session.status.value,
            "overall_score": ev.get("overallScore"),
            "recommendation": ev.get("recommendation") or structured.get("recommendation"),
            "summary": ev.get("summary") or structured.get("summary") or "",
            "question_count": len(breakdown),
            "proctoring_severity": a.proctoring_severity_flag,
            "cheat_probability": a.cheat_probability.value if a.cheat_probability else None,
            "violation_count": len(violations) if isinstance(violations, list) else 0,
            "has_structured": bool(structured),
            "report_url": session.reportUrl,
            "evaluated_at": session.completedAt.isoformat() if session.completedAt else None,
            "source": a.source.value if a.source else None,
        })

    # Most recently evaluated first.
    out.sort(key=lambda r: r.get("evaluated_at") or "", reverse=True)
    return out


def _build_funnel(applicants: list) -> dict:
    total = len(applicants)
    resume = 0
    screening = 0
    functional = 0
    for a in applicants:
        if a.decision in ("hired", "rejected"):
            continue
        if a.functional_status is not None:
            functional += 1
        elif a.screening_status is not None or a.decision == "shortlisted":
            screening += 1
        else:
            resume += 1

    completed = sum(1 for a in applicants if a.functional_status and a.functional_status.value == "completed")
    qualified = sum(1 for a in applicants if a.decision == "hired")

    def conv(n, base):
        return round((n / base) * 100) if base else 0

    # Score distribution buckets
    scores = [a.functional_score for a in applicants if a.functional_score is not None]
    distribution = {"0-20": 0, "20-40": 0, "40-60": 0, "60-80": 0, "80-100": 0}
    for s in scores:
        if s <= 20: distribution["0-20"] += 1
        elif s <= 40: distribution["20-40"] += 1
        elif s <= 60: distribution["40-60"] += 1
        elif s <= 80: distribution["60-80"] += 1
        else: distribution["80-100"] += 1

    return {
        "stages": [
            {"label": "Total Candidates", "count": total, "conversion": None},
            {"label": "Resume Analysis", "count": resume, "conversion": conv(resume, total)},
            {"label": "Recruiter Screening", "count": screening, "conversion": conv(screening, total)},
            {"label": "Functional Interview", "count": functional, "conversion": conv(functional, screening)},
            {"label": "Completed", "count": completed, "conversion": conv(completed, functional)},
            {"label": "Qualified", "count": qualified, "conversion": conv(qualified, completed)},
        ],
        "score_distribution": distribution,
    }


# ─── COLLABORATORS ────────────────────────────────────────────────────────────

@router.post("/{job_id}/collaborators")
def add_collaborator(
    job_id: UUID,
    data: CollaboratorIn,
    current_user: User = Depends(get_current_user),
    active_org_id: Optional[UUID] = Depends(get_active_org_id),
    db: Session = Depends(get_db)
):
    job = _verify_job_access(job_id, current_user, active_org_id, db)
    user = db.query(User).filter(User.id == data.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
        
    # Check if collaborator already exists
    existing = db.query(JobCollaborator).filter_by(job_id=job_id, user_id=data.user_id).first()
    if existing:
        return {"message": "Collaborator already added"}

    collab = JobCollaborator(job_id=job_id, user_id=data.user_id)
    db.add(collab)
    db.commit()
    return {"message": "Collaborator added"}


@router.delete("/{job_id}/collaborators/{user_id}")
def remove_collaborator(
    job_id: UUID,
    user_id: UUID,
    current_user: User = Depends(get_current_user),
    active_org_id: Optional[UUID] = Depends(get_active_org_id),
    db: Session = Depends(get_db)
):
    job = _verify_job_access(job_id, current_user, active_org_id, db)
    collab = db.query(JobCollaborator).filter(
        JobCollaborator.job_id == job_id,
        JobCollaborator.user_id == user_id
    ).first()
    if not collab:
        raise HTTPException(status_code=404, detail="Collaborator not found")
    db.delete(collab)
    db.commit()
    return {"message": "Collaborator removed"}



# ─── ADD APPLICANTS ───────────────────────────────────────────────────────────

@router.post("/{job_id}/applicants", response_model=ApplicantOut)
def add_applicant(
    job_id: UUID,
    data: AddApplicantIn,
    current_user: User = Depends(get_current_user),
    active_org_id: Optional[UUID] = Depends(get_active_org_id),
    db: Session = Depends(get_db)
):
    job = _verify_job_access(job_id, current_user, active_org_id, db)
    applicant = Applicant(**data.model_dump(), job_id=job_id)
    if applicant.source == ApplicantSource.scheduled:
        applicant.screening_status = InterviewStatus.pending
    elif applicant.source in (ApplicantSource.functional, ApplicantSource.exit):
        applicant.functional_status = InterviewStatus.pending
    db.add(applicant)
    db.commit()
    db.refresh(applicant)

    # Broadcast updates via WebSocket
    message = OutgoingMessage(
        type="candidate_update",
        content=f"New Candidate: {applicant.name} applied for {job.role_name}",
        sender="System"
    ).model_dump_json()
    import asyncio
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(manager.broadcast(message, room_id="global"))
    except RuntimeError:
        pass

    return applicant


@router.post("/{job_id}/applicants/bulk", response_model=List[ApplicantOut])
def add_applicants_bulk(
    job_id: UUID,
    data: BulkApplicantsIn,
    current_user: User = Depends(get_current_user),
    active_org_id: Optional[UUID] = Depends(get_active_org_id),
    db: Session = Depends(get_db)
):
    job = _verify_job_access(job_id, current_user, active_org_id, db)
    
    created_applicants = []
    for app_in in data.applicants:
        applicant = Applicant(**app_in.model_dump(), job_id=job_id)
        if applicant.source == ApplicantSource.scheduled:
            applicant.screening_status = InterviewStatus.pending
        elif applicant.source in (ApplicantSource.functional, ApplicantSource.exit):
            applicant.functional_status = InterviewStatus.pending
        db.add(applicant)
        created_applicants.append(applicant)
        
    db.commit()
    for app in created_applicants:
        db.refresh(app)
        
    # Broadcast updates via WebSocket
    message = OutgoingMessage(
        type="candidate_update",
        content=f"Imported {len(created_applicants)} candidates for {job.role_name}",
        sender="System"
    ).model_dump_json()
    import asyncio
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(manager.broadcast(message, room_id="global"))
    except RuntimeError:
        pass
        
    return created_applicants


@router.post("/{job_id}/applicants/upload-resumes", response_model=List[ApplicantOut])
def upload_resumes(
    job_id: UUID,
    files: List[UploadFile] = File(...),
    source: Optional[ApplicantSource] = None,
    current_user: User = Depends(get_current_user),
    active_org_id: Optional[UUID] = Depends(get_active_org_id),
    db: Session = Depends(get_db)
):
    job = _verify_job_access(job_id, current_user, active_org_id, db)
        
    resume_dir = "uploads/resumes"
    _ensure_upload_dir(resume_dir)

    created_applicants = []
    files_to_process = []

    for file in files:
        if file.filename.lower().endswith('.zip'):
            import zipfile
            import tempfile
            # Create a temp directory inside resume_dir
            temp_dir = tempfile.mkdtemp(dir=resume_dir)
            # basename the archive name too — a crafted zip filename must not
            # steer where we drop the uploaded archive.
            zip_path = os.path.join(temp_dir, os.path.basename(file.filename))
            with open(zip_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)

            try:
                with zipfile.ZipFile(zip_path) as z:
                    for zip_info in z.infolist():
                        if zip_info.is_dir():
                            continue
                        filename = os.path.basename(zip_info.filename)
                        if not filename or filename.startswith('.') or filename.startswith('__MACOSX'):
                            continue
                        if filename.lower().endswith(('.pdf', '.docx', '.txt')):
                            # zip-slip defense: reject any entry that would resolve
                            # outside resume_dir (basename above already strips
                            # traversal, this is the belt-and-suspenders check).
                            target_path = _safe_upload_path(resume_dir, filename)
                            if not target_path:
                                continue
                            source_file = z.open(zip_info)
                            with open(target_path, "wb") as target_buffer:
                                shutil.copyfileobj(source_file, target_buffer)
                            files_to_process.append((target_path, filename))
            except Exception as e:
                print(f"Error unzipping {file.filename}: {e}")
        else:
            # Sanitize the client-supplied filename before writing — a name like
            # "../../evil" would otherwise escape resume_dir.
            file_path = _safe_upload_path(resume_dir, file.filename)
            if not file_path:
                continue
            with open(file_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)
            files_to_process.append((file_path, os.path.basename(file.filename)))

    from dotenv import load_dotenv
    load_dotenv()
    deepseek_key = os.getenv("DEEPSEEK_API_KEY")

    for file_path, filename in files_to_process:
        from app.utils.resume_parser import parse_resume_with_deepseek, extract_text_from_file
        parsed_info = parse_resume_with_deepseek(file_path, filename, deepseek_key)

        # Persist the raw resume text so re-analysis survives an ephemeral-filesystem
        # wipe (Railway clears uploads/ on restart, leaving resume_url dangling).
        resume_text = None
        try:
            resume_text = extract_text_from_file(file_path)
        except Exception as parse_err:
            print(f"Error extracting resume text from {file_path}: {parse_err}")
        if resume_text and len(resume_text.strip()) < 50:
            resume_text = None  # extraction likely failed (scanned/garbled) — don't poison analysis with junk

        parsed_name = parsed_info.get("name")
        parsed_email = parsed_info.get("email")
        parsed_phone = parsed_info.get("phone")
        resume_text = extract_text_from_file(file_path)  # store the real text for analysis
        if resume_text and len(resume_text.strip()) < 50:
            resume_text = None  # extraction likely failed (scanned/garbled) — don't poison analysis with junk
        
        # Look for an existing candidate in this job pipeline with a matching email or name
        existing_applicant = None
        # Only check by email if it's a real email (not a dummy one ending in @candidate.io)
        if parsed_email and not parsed_email.lower().endswith("@candidate.io"):
            existing_applicant = db.query(Applicant).filter(
                Applicant.job_id == job_id,
                func.lower(Applicant.email) == parsed_email.lower()
            ).first()
            
        # Only check by name if name is provided, not "Candidate", and not empty
        if not existing_applicant and parsed_name and parsed_name.lower() != "candidate":
            existing_applicant = db.query(Applicant).filter(
                Applicant.job_id == job_id,
                func.lower(Applicant.name) == parsed_name.lower()
            ).first()
            
        if existing_applicant:
            # Map resume to the existing candidate record
            existing_applicant.resume_url = file_path
            if resume_text:
                existing_applicant.resume_text = resume_text
            
            # Preserve the source: do not overwrite existing source if already set
            if not existing_applicant.source and source:
                existing_applicant.source = source
                
            # If the source is scheduled, ensure screening_status is set
            if existing_applicant.source == ApplicantSource.scheduled and not existing_applicant.screening_status:
                existing_applicant.screening_status = InterviewStatus.pending
            # If the source is functional, ensure functional_status is set
            if existing_applicant.source in (ApplicantSource.functional, ApplicantSource.exit) and not existing_applicant.functional_status:
                existing_applicant.functional_status = InterviewStatus.pending
                
            # Update candidate details if they were defaults or unset
            if parsed_email and ("@candidate.io" in existing_applicant.email or not existing_applicant.email):
                existing_applicant.email = parsed_email
            if parsed_phone and (existing_applicant.phone == "+1 555-0199" or not existing_applicant.phone):
                existing_applicant.phone = parsed_phone
            if parsed_name and (existing_applicant.name == "Candidate" or not existing_applicant.name):
                existing_applicant.name = parsed_name
                
            db.add(existing_applicant)
            created_applicants.append(existing_applicant)
        else:
            # Create new applicant profile using parsed details
            import uuid
            email_val = parsed_email or f"candidate.{uuid.uuid4().hex[:6]}@candidate.io"
            applicant = Applicant(
                name=parsed_name or "Candidate",
                email=email_val,
                phone=parsed_phone or "+1 555-0199",
                source=source or ApplicantSource.bulk_upload,
                entry_method="bulk_upload",
                resume_url=file_path,
                resume_text=resume_text or None,
                job_id=job_id,
                resume_analysed=False
            )
            if applicant.source == ApplicantSource.scheduled:
                applicant.screening_status = InterviewStatus.pending
            elif applicant.source in (ApplicantSource.functional, ApplicantSource.exit):
                applicant.functional_status = InterviewStatus.pending
            db.add(applicant)
            created_applicants.append(applicant)
        
    db.commit()
    for app in created_applicants:
        db.refresh(app)
        
    # Broadcast updates via WebSocket
    message = OutgoingMessage(
        type="candidate_update",
        content=f"Analyzed & added {len(created_applicants)} resumes for {job.role_name}",
        sender="System"
    ).model_dump_json()
    import asyncio
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(manager.broadcast(message, room_id="global"))
    except RuntimeError:
        pass
        
    return created_applicants


@router.get("/applicants/{applicant_id}/application")
def get_applicant_application(
    applicant_id: UUID,
    current_user: User = Depends(get_current_user),
    active_org_id: Optional[UUID] = Depends(get_active_org_id),
    db: Session = Depends(get_db)
):
    """Display-on-command: a candidate's answers to the client's custom application
    questions, plus the effective question set for the job (job override → org
    default). Auth + org ownership enforced via _verify_applicant_access."""
    from app.models.organisation import Organisation
    from app.utils.application_questions import parse_answers, resolve_questions

    applicant = _verify_applicant_access(applicant_id, current_user, active_org_id, db)
    job = db.query(Job).filter(Job.id == applicant.job_id).first()
    org = db.query(Organisation).filter(Organisation.id == job.organisation_id).first() if job else None
    return {
        "applicant_id": str(applicant.id),
        "answers": parse_answers(applicant.application_answers),
        "questions": resolve_questions(job, org),
    }


@router.patch("/applicants/{applicant_id}", response_model=ApplicantOut)
def update_applicant(
    applicant_id: UUID,
    data: ApplicantUpdateIn,
    current_user: User = Depends(get_current_user),
    active_org_id: Optional[UUID] = Depends(get_active_org_id),
    db: Session = Depends(get_db)
):
    applicant = _verify_applicant_access(applicant_id, current_user, active_org_id, db)
    has_screening_update = 'screening_status' in data.model_dump(exclude_unset=True)
    has_functional_update = 'functional_status' in data.model_dump(exclude_unset=True)

    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(applicant, key, value)
    db.commit()
    db.refresh(applicant)

    # Auto-revoke any live interview link when a candidate is rejected: expire the
    # backend invites AND rotate the engine session's bound token to a fresh,
    # never-shared value so a saved room URL stops working immediately.
    if applicant.decision == "rejected":
        try:
            import uuid as _uuid
            from app.models.interview_invite import InterviewInvite, InviteStatus
            db.query(InterviewInvite).filter(
                InterviewInvite.applicant_id == applicant.id,
                InterviewInvite.status.in_([InviteStatus.pending, InviteStatus.started]),
            ).update({InterviewInvite.status: InviteStatus.expired}, synchronize_session=False)
            from app.models.ai_integration import InterviewSession as _EngineSession
            sess = db.query(_EngineSession).filter(_EngineSession.id == str(applicant.id)).first()
            if sess is not None and sess.inviteToken:
                sess.inviteToken = _uuid.uuid4().hex
            db.commit()
        except Exception as revoke_err:
            logger.error(f"Failed to auto-revoke invites for rejected applicant {applicant.id}: {revoke_err}")

    # 1. Always regenerate a fresh token on every advance so a new interview link is generated
    if (has_screening_update and applicant.screening_status) or (has_functional_update and applicant.functional_status):
        import uuid
        applicant.scheduling_token = str(uuid.uuid4())  # always fresh — allows re-testing
        db.commit()
        db.refresh(applicant)

    # Sync to AI for both screening and functional advances so interview session is always fresh
    if (has_screening_update and applicant.screening_status) or (has_functional_update and applicant.functional_status):
        from app.utils.ai_sync import sync_applicant_to_ai
        sync_applicant_to_ai(db, applicant)

    # Broadcast updates via WebSocket
    job = db.query(Job).filter(Job.id == applicant.job_id).first()
    role_name = job.role_name if job else "the position"
    message = OutgoingMessage(
        type="candidate_update",
        content=f"Candidate {applicant.name} updated for {role_name}",
        sender="System"
    ).model_dump_json()
    import asyncio
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(manager.broadcast(message, room_id="global"))
    except RuntimeError:
        pass

    return applicant


@router.post("/applicants/{applicant_id}/schedule", response_model=ApplicantOut)
def schedule_interview(
    applicant_id: UUID,
    data: ScheduleInterviewIn,
    current_user: User = Depends(get_current_user),
    active_org_id: Optional[UUID] = Depends(get_active_org_id),
    db: Session = Depends(get_db)
):
    """Schedule an interview for a candidate and send calendar invite + interview link."""
    import uuid as uuid_lib
    from datetime import datetime
    from app.utils.email_sender import send_ical_invitation_email

    applicant = _verify_applicant_access(applicant_id, current_user, active_org_id, db)
    stage = data.stage  # 'screening' or 'functional'
    scheduled_at_raw = data.scheduled_at

    if not scheduled_at_raw:
        raise HTTPException(status_code=400, detail="scheduled_at is required")

    # Parse ISO datetime string. A naive (no-offset) value means the picker's typed
    # wall-clock is IST (see app/utils/timezones.py) — never blindly UTC.
    try:
        if isinstance(scheduled_at_raw, str):
            from app.utils.timezones import parse_scheduled_datetime
            scheduled_at = parse_scheduled_datetime(scheduled_at_raw)
        else:
            scheduled_at = scheduled_at_raw
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid scheduled_at format")

    # Always generate a fresh token
    applicant.scheduling_token = str(uuid_lib.uuid4())

    if stage == "screening":
        applicant.screening_scheduled_at = scheduled_at
        applicant.screening_status = InterviewStatus.scheduled
        stage_name = "Recruiter Screening"
    else:
        applicant.functional_scheduled_at = scheduled_at
        applicant.functional_status = InterviewStatus.scheduled
        stage_name = "Functional Interview"

    db.commit()
    db.refresh(applicant)

    job = db.query(Job).filter(Job.id == applicant.job_id).first()
    job_title = job.role_name or job.title if job else "General Position"
    recruiter_id = job.created_by_id if job else None

    # Resolve organizer from Organisation
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

    # Interview-room + reschedule links. Built BEFORE the calendar call so the
    # join link can be embedded in the event DESCRIPTION — the Google Calendar
    # invite email (sendUpdates='all') is the delivery channel now that Railway
    # blocks the SMTP iCal email, so the link must live in the event itself.
    # FRONTEND_URL may be a comma-separated list; take the first origin.
    _frontend = (settings.FRONTEND_URL or "").split(",")[0].strip().rstrip("/")
    reschedule_link = f"{_frontend}/reschedule.html?token={applicant.scheduling_token}"
    _job_qs = f"&jobId={applicant.job_id}" if applicant.job_id else ""
    interview_link = f"{settings.INTERVIEW_ROOM_URL.rstrip('/')}/interviewcandidateroom?sessionId={applicant.id}{_job_qs}"

    # Create/update Google Calendar event
    try:
        from app.utils.google_calendar import create_calendar_event, update_calendar_event
        summary = f"{stage_name} - {applicant.name}"
        desc = (
            f"Interview for the {job_title} role at IntervieHire.\n\n"
            f"Join your interview here: {interview_link}\n\n"
            f"Need a different time? Reschedule: {reschedule_link}"
        )
        if not applicant.calendar_event_id:
            applicant.calendar_sequence = 0
            event_id = create_calendar_event(
                summary=summary,
                description=desc,
                candidate_email=applicant.email,
                start_time=scheduled_at,
                recruiter_id=recruiter_id,
                db=db
            )
            applicant.calendar_event_id = event_id
        else:
            applicant.calendar_sequence = (applicant.calendar_sequence or 0) + 1
            update_calendar_event(
                applicant.calendar_event_id,
                scheduled_at,
                summary=summary,
                description=desc,
                recruiter_id=recruiter_id,
                db=db
            )
        db.commit()
        db.refresh(applicant)
    except Exception as cal_err:
        logger.error(f"Failed to update Google Calendar event: {cal_err}")

    # Send confirmation email with calendar invite and interview link.
    # (reschedule_link + interview_link were computed above and embedded in the
    # calendar event; this SMTP path is skipped on Railway — see email_sender.)
    try:
        uid = f"interview-{stage_name.lower().replace(' ', '-')}-{applicant.id}@interviehire.com"
        send_ical_invitation_email(
            candidate_name=applicant.name,
            candidate_email=applicant.email,
            job_title=job_title,
            stage_name=stage_name,
            start_time=scheduled_at,
            duration_minutes=30,
            uid=uid,
            sequence=applicant.calendar_sequence or 0,
            organizer_email=organizer_email,
            reschedule_link=reschedule_link,
            interview_link=interview_link,
            organizer_name=organizer_name
        )
    except Exception as mail_err:
        logger.error(f"Failed to send interview confirmation email: {mail_err}")

    # WhatsApp confirmation — additive alongside the email confirmation above (does
    # NOT touch or duplicate it). Own try/except so a WhatsApp failure can never
    # affect the email send or this endpoint's response; no-ops when Twilio isn't
    # configured or applicant.phone isn't a real number (see twilio_client.py).
    try:
        from app.utils.twilio_client import send_schedule_confirmation_whatsapp
        from app.utils.timezones import to_ist
        first_name = (applicant.name or "").strip().split(" ")[0] or "there"
        scheduled_at_ist = to_ist(scheduled_at)
        send_schedule_confirmation_whatsapp(
            phone=applicant.phone,
            first_name=first_name,
            stage_name=stage_name,
            job_title=job_title,
            org_name=organizer_name,
            date_str=scheduled_at_ist.strftime("%B %d, %Y"),
            time_str=scheduled_at_ist.strftime("%I:%M %p IST"),
            interview_link=interview_link,
            reschedule_link=reschedule_link,
        )
    except Exception as wa_err:
        logger.error(f"Failed to send WhatsApp interview confirmation: {wa_err}")

    # Sync to AI backend
    try:
        from app.utils.ai_sync import sync_applicant_to_ai
        sync_applicant_to_ai(db, applicant)
    except Exception as sync_err:
        logger.error(f"Failed to sync to AI: {sync_err}")

    # Broadcast WebSocket update
    message = OutgoingMessage(
        type="candidate_update",
        content=f"Candidate {applicant.name} scheduled for {stage_name}",
        sender="System"
    ).model_dump_json()
    import asyncio
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(manager.broadcast(message, room_id="global"))
    except RuntimeError:
        pass

    return applicant


@router.delete("/applicants/{applicant_id}")
def delete_applicant(
    applicant_id: UUID,
    current_user: User = Depends(get_current_user),
    active_org_id: Optional[UUID] = Depends(get_active_org_id),
    db: Session = Depends(get_db)
):
    applicant = _verify_applicant_access(applicant_id, current_user, active_org_id, db)
    job = db.query(Job).filter(Job.id == applicant.job_id).first()
    role_name = job.role_name if job else "the position"
    applicant_name = applicant.name
    
    from app.utils.data_rights import anonymise_applicant
    from app.models.compliance_audit_log import AuditActorType
    # Recruiter "delete" = DSAR anonymise-in-place: the row is reduced to a non-identifying
    # stub (scores/status kept) rather than removed, so pipeline analytics stay intact and
    # every removal is audited. Cleans up this applicant's invites + engine session + files.
    anonymise_applicant(
        db, applicant,
        actor_type=AuditActorType.recruiter,
        actor_id=str(current_user.id),
    )
    
    # Broadcast deletion update via WebSocket
    message = OutgoingMessage(
        type="candidate_update",
        content=f"Candidate {applicant_name} was removed from {role_name}",
        sender="System"
    ).model_dump_json()
    import asyncio
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(manager.broadcast(message, room_id="global"))
    except RuntimeError:
        pass

    return {"message": "Applicant data anonymised (records retained as a non-identifying stub)"}


@router.get("/applicants/{applicant_id}/resume-text")
def get_applicant_resume_text(
    applicant_id: UUID,
    current_user: User = Depends(get_current_user),
    active_org_id: Optional[UUID] = Depends(get_active_org_id),
    db: Session = Depends(get_db)
):
    applicant = _verify_applicant_access(applicant_id, current_user, active_org_id, db)
    # Prefer the text extracted at upload time: it lives in the DB and survives the
    # ephemeral filesystem (Railway has no persistent disk by default, so uploads/ is
    # wiped on every redeploy/restart). Only re-extract from the file if we never stored it.
    if applicant.resume_text:
        return {"text": applicant.resume_text}
    if applicant.resume_url and os.path.exists(applicant.resume_url):
        from app.utils.resume_parser import extract_text_from_file
        return {"text": extract_text_from_file(applicant.resume_url)}
    return {"text": ""}


@router.get("/applicants/{applicant_id}/screening-report")
def get_screening_report(
    applicant_id: UUID,
    current_user: User = Depends(get_current_user),
    active_org_id: Optional[UUID] = Depends(get_active_org_id),
    db: Session = Depends(get_db)
):
    applicant = _verify_applicant_access(applicant_id, current_user, active_org_id, db)
    from app.utils.ai_sync import get_applicant_screening_report
    return get_applicant_screening_report(db, applicant)


@router.get("/applicants/{applicant_id}/functional-vetting")
def get_functional_vetting(
    applicant_id: UUID,
    current_user: User = Depends(get_current_user),
    active_org_id: Optional[UUID] = Depends(get_active_org_id),
    db: Session = Depends(get_db)
):
    applicant = _verify_applicant_access(applicant_id, current_user, active_org_id, db)
    from app.utils.ai_sync import get_applicant_vetting
    return get_applicant_vetting(db, str(applicant_id))


@router.get("/applicants/{applicant_id}/functional-report")
def get_functional_report(
    applicant_id: UUID,
    current_user: User = Depends(get_current_user),
    active_org_id: Optional[UUID] = Depends(get_active_org_id),
    db: Session = Depends(get_db)
):
    # Full canonical CandidateReport (raw InterviewSession.evaluation) for the
    # recruiter dashboard's Deep Analysis. evaluated=False until the engine scores it.
    applicant = _verify_applicant_access(applicant_id, current_user, active_org_id, db)
    from app.utils.ai_sync import get_applicant_full_report
    return get_applicant_full_report(db, str(applicant_id))


@router.get("/applicants/{applicant_id}/transcript-download")
def download_interview_transcript(
    applicant_id: UUID,
    current_user: User = Depends(get_current_user),
    active_org_id: Optional[UUID] = Depends(get_active_org_id),
    db: Session = Depends(get_db)
):
    """Download the full interview transcript as plain text. Reads the projected
    transcript from the shared InterviewSession (candidate + AI interviewer turns)."""
    from fastapi import Response
    applicant = _verify_applicant_access(applicant_id, current_user, active_org_id, db)
    from app.models.ai_integration import InterviewSession
    session = db.query(InterviewSession).filter(InterviewSession.id == str(applicant_id)).first()
    turns = (session.transcript if session else None) or []
    if not turns:
        raise HTTPException(status_code=404, detail="No transcript recorded for this interview yet.")

    def speaker_label(s: str) -> str:
        s = (s or "").lower()
        if s in ("ai", "interviewer", "assistant"):
            return "Interviewer"
        if s in ("candidate", "user", "human"):
            return "Candidate"
        return (s or "Speaker").title()

    lines = [f"Interview transcript — {applicant.name}", "=" * 48, ""]
    for t in turns:
        text = (t.get("text") if isinstance(t, dict) else str(t)) or ""
        if not str(text).strip():
            continue
        spk = speaker_label(t.get("speaker") if isinstance(t, dict) else "")
        lines.append(f"{spk}: {str(text).strip()}")
    body = "\n".join(lines) + "\n"
    safe_name = "".join(c for c in (applicant.name or "candidate") if c.isalnum() or c in " -_").strip().replace(" ", "_")
    return Response(
        content=body,
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="transcript_{safe_name}.txt"'},
    )

from fastapi import Header

@router.post("/webhooks/interview-completed")
def interview_completed_webhook(
    payload: dict = Body(...),
    x_webhook_secret: str = Header(..., alias="X-Webhook-Secret"),
    db: Session = Depends(get_db)
):
    # 1. Verify webhook secret
    secret = getattr(settings, "WEBHOOK_SECRET", None) or "super-secret-webhook-key"
    if x_webhook_secret != secret:
        raise HTTPException(status_code=401, detail="Invalid webhook secret")
        
    session_id = payload.get("sessionId")
    if not session_id:
        raise HTTPException(status_code=400, detail="sessionId is required")
        
    try:
        session_uuid = UUID(session_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid UUID format for sessionId")
        
    # 2. Query applicant and interview session
    applicant = db.query(Applicant).filter(Applicant.id == session_uuid).first()
    if not applicant:
        raise HTTPException(status_code=404, detail="Applicant not found")
        
    from app.models.ai_integration import InterviewSession, ProctoringLog, Severity
    session = db.query(InterviewSession).filter(InterviewSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Interview session not found")
        
    # 3. Extract evaluation and proctoring info
    eval_data = session.evaluation or {}
    overall_score = eval_data.get("overallScore")
    if overall_score is not None:
        try:
            overall_score = float(overall_score)
        except Exception:
            overall_score = None
            
    # Determine proctoring severity flag based on ProctoringLog entries
    logs = db.query(ProctoringLog).filter(ProctoringLog.sessionId == session_id).all()
    critical_logs = [l for l in logs if l.severity in [Severity.CRITICAL, Severity.HIGH]]
    proctoring_flag = "low"
    if any(l.severity == Severity.CRITICAL for l in logs):
        proctoring_flag = "critical"
    elif len(critical_logs) > 0:
        proctoring_flag = "high"
    elif any(l.severity == Severity.MEDIUM for l in logs):
        proctoring_flag = "medium"
        
    from app.models.applicant import CheatProbability
    # Update applicant slim storage fields
    applicant.overall_interview_score = overall_score
    applicant.proctoring_severity_flag = proctoring_flag
    applicant.functional_score = overall_score
    applicant.cheat_probability = (
        CheatProbability.high if proctoring_flag in ["critical", "high"]
        else CheatProbability.medium if proctoring_flag == "medium"
        else CheatProbability.low
    )
    applicant.functional_status = InterviewStatus.completed
    applicant.report_url = session.reportUrl

    # Mark this candidate's unique interview invite completed (single-use terminal
    # state) — same transaction as the applicant update below.
    try:
        from app.models.interview_invite import InterviewInvite, InviteStatus
        from datetime import datetime, timezone
        invite = (
            db.query(InterviewInvite)
            .filter(
                InterviewInvite.applicant_id == applicant.id,
                InterviewInvite.status != InviteStatus.completed,
            )
            .order_by(InterviewInvite.created_at.desc())
            .first()
        )
        if invite:
            invite.status = InviteStatus.completed
            invite.completed_at = datetime.now(timezone.utc)
    except Exception as invite_err:
        logger.error(f"Failed to mark interview invite completed for {applicant.id}: {invite_err}")

    # 4. Extract video url from transcript or use uploads
    video_url = None
    transcript_list = session.transcript or []
    import json
    if isinstance(transcript_list, str):
        try:
            transcript_list = json.loads(transcript_list)
        except Exception:
            transcript_list = []
            
    # Look for recording entries
    if isinstance(transcript_list, list):
        recordings = [t for t in transcript_list if isinstance(t, dict) and t.get("type") == "recording"]
        if recordings:
            video_url = recordings[-1].get("url") # Use latest recording
            
    # Standardize transcript as a readable string
    transcript_text = ""
    if isinstance(transcript_list, list):
        for entry in transcript_list:
            if isinstance(entry, dict):
                speaker = entry.get("speaker") or entry.get("type") or "Participant"
                text = entry.get("text") or ""
                if text:
                    transcript_text += f"{speaker}: {text}\n"

    # 5. Write to interview_reports table (Heavy unstructured storage)
    from app.models.interview_report import InterviewReport
    report = db.query(InterviewReport).filter(InterviewReport.applicant_id == applicant.id).first()
    detailed_scores = eval_data.get("dimensionScores") or eval_data
    
    if not report:
        report = InterviewReport(
            applicant_id=applicant.id,
            summary=eval_data.get("summary") or "",
            transcript=transcript_text,
            video_url=video_url,
            detailed_scores=detailed_scores
        )
        db.add(report)
    else:
        report.summary = eval_data.get("summary") or ""
        report.transcript = transcript_text
        report.video_url = video_url
        report.detailed_scores = detailed_scores
        
    db.commit()
    db.refresh(applicant)
    
    # 6. Broadcast updates via WebSocket global channel
    job = db.query(Job).filter(Job.id == applicant.job_id).first()
    role_name = job.role_name if job else "the position"
    
    from app.schemas import OutgoingMessage
    from app.websocket_manager import manager
    message = OutgoingMessage(
        type="candidate_update",
        content=f"Candidate {applicant.name} evaluation completed for {role_name} with score {overall_score}",
        sender="System"
    ).model_dump_json()
    
    import asyncio
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(manager.broadcast(message, room_id="global"))
    except RuntimeError:
        pass
        
    return {"status": "synced", "applicant_id": str(applicant.id)}
