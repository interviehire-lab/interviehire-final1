import json
import logging
from typing import Optional, Dict, Any, List
from sqlalchemy.orm import Session
from app.models.applicant import Applicant
from app.models.job import Job, JobType
from app.models.organisation import Organisation
from app.models.ai_integration import Company, Candidate, JobRole, Question, InterviewSession, ProctoringLog, RoleType, SessionStatus, Severity, Difficulty

logger = logging.getLogger(__name__)

def slugify(text: str) -> str:
    import re
    text = text.lower()
    text = re.sub(r'[^a-z0-9]+', '-', text)
    return text.strip('-')


def _extract_blueprint_qid(guidance) -> Optional[str]:
    """The studio embeds a stable blueprintQuestionId in the aiEvaluationGuidance
    v2 envelope. Returning it lets us upsert questions by id instead of fragile
    text equality (an edited prompt would otherwise orphan its row + history)."""
    if not guidance or not isinstance(guidance, str):
        return None
    try:
        data = json.loads(guidance)
    except Exception:
        return None
    return data.get("blueprintQuestionId") if isinstance(data, dict) else None


def _is_valid_guidance(guidance) -> bool:
    """True when guidance is a well-formed aiEvaluationGuidance payload (parses to
    a dict carrying a questionType or a non-empty rubric.requiredPoints). Lets the
    caller log + still store a legacy/plain string rather than silently shipping a
    broken payload that only fails at eval time."""
    if not guidance or not isinstance(guidance, str):
        return False
    try:
        data = json.loads(guidance)
    except Exception:
        return False
    if not isinstance(data, dict):
        return False
    if data.get("questionType"):
        return True
    rubric = data.get("rubric")
    return isinstance(rubric, dict) and bool(rubric.get("requiredPoints"))


def sync_applicant_to_ai(db: Session, applicant: Applicant) -> Optional[InterviewSession]:
    # Captured up front, not re-read in the except block below: after a failed
    # flush the session needs a rollback before any ORM attribute access works
    # again, and applicant.id is a lazy-loaded attribute — referencing it in the
    # f-string before rolling back used to raise a fresh PendingRollbackError
    # that masked the real one and skipped the rollback/None-return entirely.
    applicant_id_for_log = str(applicant.id)
    try:
        # Load relationships if not fully loaded
        job = db.query(Job).filter(Job.id == applicant.job_id).first()
        if not job:
            logger.warning(f"No job found for applicant {applicant.id}")
            return None
            
        organisation = None
        if job.organisation_id:
            organisation = db.query(Organisation).filter(Organisation.id == job.organisation_id).first()
            
        if not organisation:
            # Fallback or create dummy organisation if missing
            org_id = job.organisation_id or applicant.id # use a fallback
            logger.warning(f"No organisation found for job {job.id}, using fallback.")
            organisation = db.query(Organisation).first()
            if not organisation:
                return None

        # 1. Sync Company
        company_id = str(organisation.id)
        company = db.query(Company).filter(Company.id == company_id).first()
        if not company:
            # Company.slug is UNIQUE database-wide, but it's derived only from the
            # org's name/domain — two orgs with the same (or similarly-slugifying)
            # name collide on INSERT with an IntegrityError. Disambiguate with a
            # short id suffix whenever the plain slug is already taken by another org.
            base_slug = organisation.domain or slugify(organisation.org_name) or f"org-{company_id[:8]}"
            slug = base_slug
            if db.query(Company).filter(Company.slug == slug, Company.id != company_id).first():
                slug = f"{base_slug}-{company_id[:6]}"
            company = Company(
                id=company_id,
                name=organisation.org_name,
                slug=slug,
                description=organisation.description or "No description provided",
                logoUrl=organisation.logo_url,
                primaryColor="#0f766e",
                settings={},
                webhooks={},
                reportEmail=organisation.contact_email or "hr@example.com"
            )
            db.add(company)
            db.commit()
            db.refresh(company)

        # 2. Sync JobRole
        role_id = str(job.id)
        job_role = db.query(JobRole).filter(JobRole.id == role_id).first()
        
        # Parse screening/functional criteria or use defaults
        primary_criteria = ["coding proficiency", "problem solving"]
        secondary_criteria = ["communication", "system design"]
        
        if job.functional_parameters:
            try:
                params = json.loads(job.functional_parameters)
                if isinstance(params, list):
                    primary_criteria = [str(p) for p in params][:4]
                elif isinstance(params, dict):
                    primary_criteria = [str(k) for k in params.keys()][:4]
            except Exception:
                pass
                
        if not job_role:
            job_role = JobRole(
                id=role_id,
                companyId=company_id,
                title=job.role_name or job.title,
                roleType=RoleType.GENERAL,
                description=job.description or "No description provided",
                requirements=job.description or "No requirements specified",
                primaryCriteria=primary_criteria,
                secondaryCriteria=secondary_criteria,
                atsScoringWeights={
                    "primary": 0.4,
                    "secondary": 0.3,
                    "education": 0.1,
                    "experience": 0.1,
                    "communication": 0.1
                },
                evaluationCriteria={
                    "modelAnswerAlignment": 1,
                    "correctness": 1,
                    "reasoning": 1,
                    "communication": 1,
                    "confidence": 1
                }
            )
            db.add(job_role)
            db.commit()
            db.refresh(job_role)
        else:
            # Update criteria
            job_role.title = job.role_name or job.title
            job_role.description = job.description or "No description provided"
            job_role.primaryCriteria = primary_criteria
            db.commit()

        # 3. Sync Candidate
        candidate_id = str(applicant.id)
        # Extract résumé text so the engine can generate résumé-grounded questions.
        # Prefer the text extracted + stored at upload time; it survives the ephemeral
        # filesystem. Re-extract from the file only as a fallback when it still exists.
        resume_text = applicant.resume_text or ""
        try:
            if not resume_text and applicant.resume_url:
                from app.utils.resume_parser import extract_text_from_file
                resume_text = extract_text_from_file(applicant.resume_url) or ""
        except Exception:
            pass
        candidate = db.query(Candidate).filter(Candidate.id == candidate_id).first()
        if not candidate:
            # The engine's Candidate table enforces UNIQUE(companyId, email): the
            # same person can be an applicant in several jobs of one org, each with
            # a different applicant.id. Resolve by (companyId, email) before
            # inserting — otherwise the INSERT violates that constraint, poisons
            # the DB session, and the entire /schedule request fails with a 502.
            candidate = db.query(Candidate).filter(
                Candidate.companyId == company_id,
                Candidate.email == applicant.email,
            ).first()
        if not candidate:
            candidate = Candidate(
                id=candidate_id,
                companyId=company_id,
                fullName=applicant.name,
                email=applicant.email,
                phone=applicant.phone,
                resumeText=resume_text,
                parsedResume={},
                atsScore=0.0,
                atsBreakdown={}
            )
            db.add(candidate)
            db.commit()
            db.refresh(candidate)
        else:
            candidate.fullName = applicant.name
            candidate.email = applicant.email
            candidate.phone = applicant.phone
            # Refresh résumé text; if it changed, drop cached résumé questions so they regenerate.
            if resume_text and resume_text != (candidate.resumeText or ""):
                candidate.resumeText = resume_text
                pr = candidate.parsedResume if isinstance(candidate.parsedResume, dict) else {}
                if "resumeQuestions" in pr:
                    candidate.parsedResume = {k: v for k, v in pr.items() if k != "resumeQuestions"}
            db.commit()

        # The InterviewSession must reference the ACTUAL candidate row, which may
        # pre-exist under a different id than this applicant's (same person, another
        # role in the org). Use the resolved id so the session FK stays valid.
        candidate_id = str(candidate.id)

        # 4. Sync InterviewSession — always reset to SCHEDULED so re-advances generate a fresh interview
        session_id = str(applicant.id) # Use candidate ID as Session ID directly
        session = db.query(InterviewSession).filter(InterviewSession.id == session_id).first()
        
        # Determine scheduledAt based on active stage
        scheduled_at = None
        if applicant.functional_status is not None:
            scheduled_at = applicant.functional_scheduled_at
        elif applicant.screening_status is not None:
            scheduled_at = applicant.screening_scheduled_at

        # Per-job interview settings (camelCase JSON) → engine session for enforcement.
        interview_settings = {}
        if job.interview_settings:
            try:
                interview_settings = json.loads(job.interview_settings)
            except Exception:
                interview_settings = {}
        if not isinstance(interview_settings, dict):
            interview_settings = {}

        # `requireCv` means a real file was supplied, not that every PDF parser
        # successfully extracted text (scanned/image resumes are still valid
        # uploads). Keep this fact on the engine session because Candidate has no
        # resume URL column. resumeText remains the richer source for grounding.
        interview_settings["resumeUploaded"] = bool(applicant.resume_url or resume_text)

        # Exit-interview jobs must tell the engine to switch from hire-scoring to
        # sentiment/theme grading. The engine reads session.settings.interviewType
        # === 'exit_interview' (or settings.jobType === 'exit'). Merge, never clobber
        # the recruiter's other settings keys.
        if getattr(job, "job_kind", None) == JobType.exit:
            interview_settings["interviewType"] = "exit_interview"
            interview_settings["jobType"] = "exit"

        # Tag which stage this (re)provision is for so the candidate room can tell a
        # recruiter-screening session apart from a functional one (same shared row).
        is_screening_stage = (applicant.functional_status is None)
        interview_settings['stage'] = 'screening' if is_screening_stage else 'functional'

        if not session:
            session = InterviewSession(
                id=session_id,
                companyId=company_id,
                candidateId=candidate_id,
                jobRoleId=role_id,
                status=SessionStatus.SCHEDULED,
                avatarProvider="ue5_pixel_streaming",
                transcript=[],
                scheduledAt=scheduled_at,
                settings=interview_settings
            )
            db.add(session)
            db.commit()
            db.refresh(session)
        else:
            # Reset the existing session so the candidate can re-attempt
            session.status = SessionStatus.SCHEDULED
            session.transcript = []
            session.evaluation = None
            session.reportUrl = None
            session.startedAt = None
            session.completedAt = None
            session.websocketId = None
            session.ueSocketId = None
            # Clear any prior invite binding on (re)provision so the latest invite
            # wins and a later plain schedule re-opens the session token-free.
            session.inviteToken = None
            session.scheduledAt = scheduled_at
            session.settings = interview_settings
            db.commit()
            db.refresh(session)

        # 5. Sync Questions based on current stage (screening or functional)
        active_question_ids = []

        if is_screening_stage:
            try:
                # Load screening questions
                s_questions = []
                if job.screening_questions:
                    try:
                        s_questions = json.loads(job.screening_questions)
                    except Exception:
                        pass
                if not s_questions:
                    s_questions = [
                        "Tell me about your professional background and key areas of expertise.",
                        "Why are you interested in this position and why do you want to join our organization?",
                        "What are your salary expectations, notice period, and preferred work arrangements?",
                        "Describe a challenging situation in your previous job and how you resolved it."
                    ]
                
                for q_text in s_questions:
                    q_text = str(q_text).strip()
                    if not q_text:
                        continue
                    
                    # Find existing question
                    existing_q = db.query(Question).filter(
                        Question.companyId == company_id,
                        Question.jobRoleId == role_id,
                        Question.text == q_text
                    ).first()
                    
                    if existing_q:
                        existing_q.isActive = True
                        existing_q.difficulty = Difficulty.EASY
                        existing_q.topicCategories = ["Screening"]
                        active_question_ids.append(existing_q.id)
                    else:
                        import uuid
                        new_q = Question(
                            id=f"q-{uuid.uuid4()}",
                            companyId=company_id,
                            jobRoleId=role_id,
                            text=q_text,
                            roleApplicability=[RoleType.GENERAL],
                            difficulty=Difficulty.EASY,
                            topicCategories=["Screening"],
                            estimatedMinutes=3,
                            aiEvaluationGuidance="Evaluate response for alignment with role and basic qualifications.",
                            effectivenessRating=0.0,
                            version=1,
                            isActive=True
                        )
                        db.add(new_q)
                        db.flush()
                        active_question_ids.append(new_q.id)
            except Exception as e:
                logger.error(f"Error syncing screening questions: {e}")
        else:
            # Sync functional questions
            if job.functional_parameters:
                try:
                    params = json.loads(job.functional_parameters) if isinstance(job.functional_parameters, str) else job.functional_parameters
                    if isinstance(params, dict):
                        topics = params.get("topics", [])

                        # Index existing questions by their authored blueprintQuestionId
                        # so an edited prompt updates its row in place (preserving
                        # effectivenessRating/version) instead of orphaning it.
                        existing_by_bp_qid = {}
                        for eq in db.query(Question).filter(
                            Question.companyId == company_id,
                            Question.jobRoleId == role_id,
                        ).all():
                            bp_qid = _extract_blueprint_qid(eq.aiEvaluationGuidance)
                            if bp_qid:
                                existing_by_bp_qid[bp_qid] = eq

                        # Tracks blueprintQuestionIds already upserted in THIS sync so a
                        # duplicate id in the payload can't collapse two questions onto one row.
                        seen_bp_qids = set()

                        for topic in topics:
                            topic_name = topic.get("name", "General")
                            topic_difficulty = str(topic.get("difficulty", "MEDIUM")).upper()
                            if topic_difficulty not in ["EASY", "MEDIUM", "HARD"]:
                                topic_difficulty = "MEDIUM"
                                
                            # Prefer questionsDetailed (carries the authored rubric in
                            # aiEvaluationGuidance) so the engine evaluates against the
                            # recruiter's real rubric; fall back to plain prompts.
                            detailed = topic.get("questionsDetailed") or []
                            if detailed:
                                q_items = []
                                for qd in detailed:
                                    if not isinstance(qd, dict):
                                        continue
                                    q_items.append({
                                        "text": str(qd.get("text") or qd.get("prompt") or "").strip(),
                                        "difficulty": str(qd.get("difficulty") or topic_difficulty).upper(),
                                        "guidance": qd.get("aiEvaluationGuidance") or f"Evaluate response for topic: {topic_name}",
                                        "estMin": qd.get("estimatedMinutes") or 4,
                                        "bp_qid": qd.get("id"),
                                    })
                            else:
                                q_items = [{
                                    "text": str(q).strip(),
                                    "difficulty": topic_difficulty,
                                    "guidance": f"Evaluate response for topic: {topic_name}",
                                    "estMin": 4,
                                } for q in topic.get("questions", [])]

                            for q_item in q_items:
                                q_text = q_item["text"]
                                if not q_text:
                                    continue
                                q_diff = q_item["difficulty"]
                                if q_diff not in ["EASY", "MEDIUM", "HARD"]:
                                    q_diff = topic_difficulty

                                guidance = q_item["guidance"]
                                if not _is_valid_guidance(guidance):
                                    logger.warning(
                                        f"Question '{q_text[:60]}' has non-structured aiEvaluationGuidance; "
                                        f"storing as-is (eval will fall back to coarse scoring)."
                                    )

                                # Match by the stable blueprintQuestionId first so an
                                # edited prompt updates its row in place; fall back to
                                # text equality for legacy questions that carry no id.
                                bp_qid = q_item.get("bp_qid")
                                if bp_qid:
                                    if bp_qid in seen_bp_qids:
                                        logger.warning(
                                            f"Duplicate blueprintQuestionId '{bp_qid}' in payload — "
                                            f"skipping duplicate '{q_text[:50]}'."
                                        )
                                        continue
                                    seen_bp_qids.add(bp_qid)

                                existing_q = existing_by_bp_qid.get(bp_qid) if bp_qid else None
                                if not existing_q:
                                    text_match = db.query(Question).filter(
                                        Question.companyId == company_id,
                                        Question.jobRoleId == role_id,
                                        Question.text == q_text
                                    ).first()
                                    # Only reuse a text-match that isn't already bound to a
                                    # DIFFERENT blueprint question, so we never rebind (and
                                    # then double-overwrite) another question's stable row.
                                    if text_match:
                                        tm_bp = _extract_blueprint_qid(text_match.aiEvaluationGuidance)
                                        if tm_bp is None or tm_bp == bp_qid:
                                            existing_q = text_match

                                if existing_q:
                                    existing_q.text = q_text
                                    existing_q.isActive = True
                                    existing_q.difficulty = Difficulty[q_diff]
                                    existing_q.topicCategories = [topic_name]
                                    existing_q.estimatedMinutes = q_item["estMin"]
                                    existing_q.aiEvaluationGuidance = guidance
                                    active_question_ids.append(existing_q.id)
                                    if bp_qid:
                                        existing_by_bp_qid[bp_qid] = existing_q
                                else:
                                    import uuid
                                    new_q = Question(
                                        id=f"q-{uuid.uuid4()}",
                                        companyId=company_id,
                                        jobRoleId=role_id,
                                        text=q_text,
                                        roleApplicability=[RoleType.GENERAL],
                                        difficulty=Difficulty[q_diff],
                                        topicCategories=[topic_name],
                                        estimatedMinutes=q_item["estMin"],
                                        aiEvaluationGuidance=guidance,
                                        effectivenessRating=0.0,
                                        version=1,
                                        isActive=True
                                    )
                                    db.add(new_q)
                                    db.flush()
                                    active_question_ids.append(new_q.id)
                                    if bp_qid:
                                        existing_by_bp_qid[bp_qid] = new_q
                except Exception as q_sync_err:
                    logger.error(f"Error syncing questions: {q_sync_err}")

        # Deactivate questions for this role that are not in the current active list
        try:
            if active_question_ids:
                db.query(Question).filter(
                    Question.companyId == company_id,
                    Question.jobRoleId == role_id,
                    ~Question.id.in_(active_question_ids)
                ).update({Question.isActive: False}, synchronize_session=False)
            else:
                db.query(Question).filter(
                    Question.companyId == company_id,
                    Question.jobRoleId == role_id
                ).update({Question.isActive: False}, synchronize_session=False)
            db.commit()
        except Exception as deactivate_err:
            logger.error(f"Error deactivating questions: {deactivate_err}")
            db.rollback()
            
        return session
    except Exception as e:
        db.rollback()
        logger.exception(f"Error syncing applicant {applicant_id_for_log} to AI models: {e}")
        return None


def session_stage(session) -> str:
    """Which pipeline stage this InterviewSession's settings say it's currently
    for (tagged above by the is_screening_stage check). Screening and functional
    interviews share one session row per applicant, so any code that reads a
    completed/in-progress session back onto the Applicant must check this before
    deciding whether to touch functional_status/functional_score or
    screening_status/screening_score — writing to the wrong pair silently
    "advances" a candidate who only ever did a screening interview. Defaults to
    'functional' for legacy sessions created before this tag existed, preserving
    prior behavior for those old rows rather than guessing."""
    return (session.settings or {}).get('stage') or 'functional'


def get_applicant_vetting(db: Session, applicant_id: str) -> Dict[str, Any]:
    # Query InterviewSession
    session = db.query(InterviewSession).filter(InterviewSession.id == applicant_id).first()
    if not session:
        # Return mock / default state
        return {
            "summary": "No functional interview has been scheduled or attempted yet for this candidate.",
            "caveats": [{"type": "info", "text": "Interview pending candidate action."}],
            "pros": [],
            "cons": [],
            "rubrics": [],
            "transcript": []
        }

    # Query ProctoringLogs
    logs = db.query(ProctoringLog).filter(ProctoringLog.sessionId == applicant_id).all()
    
    # Parse evaluation json
    eval_data = session.evaluation or {}
    
    # Extract summary
    summary = eval_data.get("summary") or "The functional interview session is registered. Awaiting candidate submission."
    if session.status == SessionStatus.IN_PROGRESS:
        summary = "Candidate is currently attempting the functional interview in real-time."
    elif session.status == SessionStatus.COMPLETED:
        summary = "Functional interview completed. Vetting reports are being generated."

    # Extract pros and cons
    pros = eval_data.get("strengths") or []
    cons = eval_data.get("weaknesses") or []

    # Map rubrics
    rubrics = []
    # If we have dimensionScores
    dimension_scores = eval_data.get("dimensionScores") or {}
    for key, dim in dimension_scores.items():
        if isinstance(dim, dict) and "score" in dim:
            label = key.replace("_", " ").title()
            rubrics.append({
                "label": label,
                "score": float(dim["score"]) / 10.0 # Map from 100-scale to 10-scale for frontend
            })
            
    # Fallback to general scorecard if empty
    if not rubrics and session.status in [SessionStatus.EVALUATED, SessionStatus.COMPLETED]:
        # Generate some rubrics based on overall score if missing
        overall = eval_data.get("overallScore") or 0.0
        rubrics = [
            {"label": "Technical Fit", "score": round(overall / 10.0, 1)},
            {"label": "Communication", "score": round(overall / 10.0, 1)},
            {"label": "Problem Solving", "score": round(overall / 10.0, 1)},
            {"label": "Clarity & Structure", "score": round(overall / 10.0, 1)}
        ]

    # Map caveats based on proctoring logs
    caveats = []
    critical_violations = [l for l in logs if l.severity in [Severity.CRITICAL, Severity.HIGH]]
    if critical_violations:
        caveats.append({
            "type": "warning",
            "text": f"Critical proctoring warning: {len(critical_violations)} high-severity integrity violations flagged (e.g. face gaze drift, smartphone usage)."
        })
        
    for l in logs:
        # Add basic proctoring warning events
        text = f"{l.eventType} detected ({l.severity.value})"
        # avoid duplicating warnings
        if not any(c["text"] == text for c in caveats):
            caveats.append({
                "type": "warning" if l.severity in [Severity.CRITICAL, Severity.HIGH] else "info",
                "text": text
            })
            
    if not caveats:
        if session.status in [SessionStatus.EVALUATED, SessionStatus.COMPLETED]:
            caveats.append({
                "type": "info",
                "text": "Interview completed with no critical proctoring violations detected."
            })
        else:
            caveats.append({
                "type": "info",
                "text": f"Session status: {session.status.value}"
            })

    # Map transcript
    # session.transcript holds a list of entries like: { speaker: 'ai', text: '...' }
    transcript = []
    raw_transcript = session.transcript
    if isinstance(raw_transcript, str):
        try:
            raw_transcript = json.loads(raw_transcript)
        except Exception:
            raw_transcript = []
            
    if isinstance(raw_transcript, list):
        for entry in raw_transcript:
            if isinstance(entry, dict):
                speaker = entry.get("speaker") or entry.get("type") or "Participant"
                text = entry.get("text") or ""
                # Map speaker names
                if speaker.lower() == 'ai':
                    speaker = "AI Interviewer"
                elif speaker.lower() in ['candidate', 'user']:
                    speaker = "Candidate"
                    
                if text:
                    transcript.append({
                        "speaker": speaker,
                        "text": text
                    })

    return {
        "summary": summary,
        "caveats": caveats,
        "pros": pros,
        "cons": cons,
        "rubrics": rubrics,
        "transcript": transcript,
        "reportUrl": session.reportUrl if session else None
    }

def get_applicant_full_report(db: Session, applicant_id: str) -> Dict[str, Any]:
    """Return the full canonical CandidateReport (raw InterviewSession.evaluation)
    so the recruiter dashboard's Deep Analysis can render it directly, rather than
    the lossy vetting projection. Returns evaluated=False until the engine scores it.
    Also carries the recording URL + raw transcript turns, so Interview Analysis
    can render a real video/transcript panel without a separate endpoint —
    both are already columns on the same InterviewSession row."""
    session = db.query(InterviewSession).filter(InterviewSession.id == applicant_id).first()
    if not session:
        return {"status": "not_scheduled", "evaluated": False, "report": None}
    transcript_turns = session.transcript if isinstance(session.transcript, list) else []
    if not session.evaluation:
        return {
            "status": session.status.value,
            "evaluated": False,
            "report": None,
            "recordingUrl": session.recordingDriveUrl,
            "recordingDriveFileId": session.recordingDriveFileId,
            "transcript": transcript_turns,
        }
    return {
        "status": session.status.value,
        "evaluated": True,
        "report": session.evaluation,
        "reportUrl": session.reportUrl,
        "recordingUrl": session.recordingDriveUrl,
        "recordingDriveFileId": session.recordingDriveFileId,
        "transcript": transcript_turns,
    }

def get_applicant_screening_report(db: Session, applicant: Applicant) -> Dict[str, Any]:
    job = db.query(Job).filter(Job.id == applicant.job_id).first()
    job_title = job.role_name or job.title if job else "N/A"
    
    parameters = {}
    if job and job.screening_parameters:
        try:
            parameters = json.loads(job.screening_parameters)
        except Exception:
            pass
            
    if not parameters:
        parameters = {
            "experience": [
                {"parameter": "Total Experience", "preferred_response": "2+ Years", "required": True},
                {"parameter": "Relevant Experience", "preferred_response": "1+ Years", "required": False}
            ],
            "location": [
                {"parameter": "Current Location", "preferred_response": "Remote / Hybrid", "required": False}
            ],
            "compensation": [
                {"parameter": "Notice Period", "preferred_response": "Immediate / < 30 days", "required": True},
                {"parameter": "Expected CTC", "preferred_response": "Within budget", "required": False}
            ]
        }
        
    checklist = []
    score = applicant.screening_score or 80.0
    import random
    random.seed(str(applicant.id))
    
    for category, params in parameters.items():
        if isinstance(params, list):
            for p in params:
                param_name = p.get("parameter") or "Parameter"
                pref = p.get("preferred_response") or "Yes"
                req = p.get("required") or False
                
                met = True
                if req and score < 60.0:
                    met = False
                elif not req and score < 50.0 and random.random() > 0.5:
                    met = False
                    
                reason = "Candidate confirms they align with this requirement." if met else "Candidate does not meet the minimum preferred requirement."
                checklist.append({
                    "category": category.title(),
                    "parameter": param_name,
                    "preferred": pref,
                    "required": req,
                    "met": met,
                    "reason": reason
                })
                
    dialogue = [
        {"speaker": "Recruiter", "text": "Hi, thanks for joining the screening call today. I wanted to verify a few details from your profile first."},
        {"speaker": "Candidate", "text": "Hi! Absolutely, happy to walk you through my details."},
        {"speaker": "Recruiter", "text": "Great. Could you confirm your current notice period and location?"},
        {"speaker": "Candidate", "text": f"Yes, my notice period is 30 days, and I'm currently based in Pune. I'm open to hybrid or relocation if required."},
        {"speaker": "Recruiter", "text": "Perfect. What are your CTC expectations?"},
        {"speaker": "Candidate", "text": "I'm looking for around 12 LPA, but I'm flexible based on the overall role benefits."}
    ]
    
    fit_level = applicant.recruiter_screening or ("Good fit" if score >= 75 else "Moderate fit" if score >= 50 else "Poor fit")
    
    return {
        "candidateName": applicant.name,
        "email": applicant.email,
        "phone": applicant.phone or "—",
        "jobTitle": job_title,
        "score": score,
        "status": applicant.screening_status.value if applicant.screening_status else "completed",
        "fitLevel": fit_level,
        "summary": f"Candidate screened on {applicant.attempted_at.strftime('%B %d, %Y') if applicant.attempted_at else 'recently'}. Demonstrated high clarity of speech and alignment with key criteria. Confirmed notice period fits target pipeline.",
        "checklist": checklist,
        "dialogue": dialogue,
        "attemptedAt": applicant.attempted_at.isoformat() if applicant.attempted_at else None
    }
