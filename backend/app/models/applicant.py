from sqlalchemy import Column, String, DateTime, Enum, Float, ForeignKey, Text, Boolean, Integer
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
import enum

from app.database import Base


class InterviewStatus(str, enum.Enum):
    pending = "pending"
    scheduled = "scheduled"
    completed = "completed"
    slot_missed = "slot_missed"
    incomplete = "incomplete"


class CheatProbability(str, enum.Enum):
    low = "low"
    medium = "medium"
    high = "high"


class ApplicantSource(str, enum.Enum):
    career_page = "career_page"
    bulk_upload = "bulk_upload"
    direct_link = "direct_link"
    scheduled = "scheduled"
    ats = "ats"
    functional = "functional"
    exit = "exit"


class Applicant(Base):
    __tablename__ = "applicants"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False)
    email = Column(String, nullable=False, index=True)
    phone = Column(String, nullable=True)
    source = Column(Enum(ApplicantSource), nullable=True)
    # How the candidate was added (bulk_upload | ats | direct_link | career_page).
    # Independent of `source` above, which routes the applicant to a stage.
    entry_method = Column(String, nullable=True)
    resume_url = Column(String, nullable=True)
    remarks = Column(Text, nullable=True)

    job_id = Column(UUID(as_uuid=True), ForeignKey("jobs.id"), nullable=False)

    # Resume Analysis stage
    resume_analysed = Column(Boolean, default=False)
    resume_shortlisted = Column(Boolean, default=False)
    resume_waitlisted = Column(Boolean, default=False)

    # Recruiter Screening stage
    screening_status = Column(Enum(InterviewStatus), nullable=True)
    screening_score = Column(Float, nullable=True)
    screening_scheduled_at = Column(DateTime(timezone=True), nullable=True)
    # Set once the pre-interview reminder (email/WhatsApp/call, ~REMINDER_MINUTES_BEFORE
    # start) has fired for this stage's scheduled slot; NULL = not sent yet. Guards
    # against re-sending the reminder on every job run. See app/jobs/reminders.py.
    screening_reminder_sent_at = Column(DateTime(timezone=True), nullable=True)

    # Functional Interview stage
    functional_status = Column(Enum(InterviewStatus), nullable=True)
    functional_score = Column(Float, nullable=True)
    functional_scheduled_at = Column(DateTime(timezone=True), nullable=True)
    functional_reminder_sent_at = Column(DateTime(timezone=True), nullable=True)
    cheat_probability = Column(Enum(CheatProbability), nullable=True)
    report_url = Column(String, nullable=True)
    
    recruiter_screening = Column(String, nullable=True)
    recruiter_screening_score = Column(Float, nullable=True)
    attempted_at = Column(DateTime(timezone=True), nullable=True)
    match_score = Column(Float, nullable=True)
    resume_analysis_report = Column(Text, nullable=True)
    resume_text = Column(Text, nullable=True)
    # Recruiter's resume-stage call: 'shortlisted' | 'rejected' | 'hired'. Separate
    # from screening/functional_status so recording it never spins up an interview.
    decision = Column(String, nullable=True)
    scheduling_token = Column(String, nullable=True, index=True)
    calendar_event_id = Column(String, nullable=True)
    overall_interview_score = Column(Float, nullable=True)
    proctoring_severity_flag = Column(String, nullable=True)
    calendar_sequence = Column(Integer, default=0, nullable=False)

    # Exit-interview (leaver) metadata — only populated when the parent Job is an
    # exit-interview template (job_kind == 'exit'); NULL for hiring applicants.
    department = Column(String, nullable=True)
    manager_name = Column(String, nullable=True)
    tenure_months = Column(Integer, nullable=True)
    separation_type = Column(String, nullable=True)          # "voluntary" | "involuntary"
    last_working_day = Column(DateTime(timezone=True), nullable=True)
    primary_reason = Column(String, nullable=True)

    # DSAR / DPDP anonymisation marker — set when an erasure request has reduced this row
    # to a non-identifying stub (PII/free-text scrubbed, scores/status kept); NULL for
    # live candidates. erasure_request_id -> data_subject_requests.id (no FK, so the audit
    # trail and the request record both survive the stub).
    anonymised_at = Column(DateTime(timezone=True), nullable=True)
    erasure_request_id = Column(UUID(as_uuid=True), nullable=True)

    # Direct-apply consent — set when a candidate applies through the public career
    # page / direct link (they hand us PII first-hand, so we are the data controller
    # at that step). NULL for applicants added by a recruiter (bulk/ATS/scheduled).
    consent_given_at = Column(DateTime(timezone=True), nullable=True)
    consent_version = Column(String, nullable=True)

    # Answers to the client's custom application questions (JSON text: a list of
    # {id, question, type, answer}). NULL when the job/org asked no extra questions.
    application_answers = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    job = relationship("Job", back_populates="applicants")