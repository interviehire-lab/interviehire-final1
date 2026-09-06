from sqlalchemy import Column, String, DateTime, Enum, Float, ForeignKey, Text, Boolean, Integer, JSON, Index
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum

from app.database import Base

class RoleType(str, enum.Enum):
    CONSULTING = "CONSULTING"
    PRODUCT_MANAGEMENT = "PRODUCT_MANAGEMENT"
    BUSINESS_ANALYST = "BUSINESS_ANALYST"
    FOUNDERS_OFFICE = "FOUNDERS_OFFICE"
    GENERAL = "GENERAL"

class Difficulty(str, enum.Enum):
    EASY = "EASY"
    MEDIUM = "MEDIUM"
    HARD = "HARD"

class SessionStatus(str, enum.Enum):
    SCHEDULED = "SCHEDULED"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    EVALUATED = "EVALUATED"
    CANCELLED = "CANCELLED"

class Severity(str, enum.Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class Company(Base):
    __tablename__ = 'Company'

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    slug = Column(String, unique=True, nullable=False)
    description = Column(Text, nullable=True)
    logoUrl = Column(String, nullable=True)
    primaryColor = Column(String, default="#0f766e", nullable=False)
    settings = Column(JSONB, default=dict, nullable=False)
    webhooks = Column(JSONB, default=dict, nullable=False)
    reportEmail = Column(String, nullable=True)
    createdAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updatedAt = Column(DateTime(timezone=True), server_default=func.now(), default=func.now(), onupdate=func.now(), nullable=False)

    jobRoles = relationship("JobRole", back_populates="company", cascade="all, delete-orphan")
    candidates = relationship("Candidate", back_populates="company", cascade="all, delete-orphan")
    questions = relationship("Question", back_populates="company", cascade="all, delete-orphan")
    sessions = relationship("InterviewSession", back_populates="company", cascade="all, delete-orphan")


class Candidate(Base):
    __tablename__ = 'Candidate'

    id = Column(String, primary_key=True)
    companyId = Column(String, ForeignKey('Company.id', ondelete='CASCADE'), nullable=False)
    fullName = Column(String, nullable=False)
    email = Column(String, nullable=False)
    phone = Column(String, nullable=True)
    resumeText = Column(Text, nullable=True)
    parsedResume = Column(JSONB, default=dict, nullable=False)
    atsScore = Column(Float, default=0.0, nullable=False)
    atsBreakdown = Column(JSONB, default=dict, nullable=False)
    createdAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updatedAt = Column(DateTime(timezone=True), server_default=func.now(), default=func.now(), onupdate=func.now(), nullable=False)

    company = relationship("Company", back_populates="candidates")
    sessions = relationship("InterviewSession", back_populates="candidate", cascade="all, delete-orphan")


class JobRole(Base):
    __tablename__ = 'JobRole'

    id = Column(String, primary_key=True)
    companyId = Column(String, ForeignKey('Company.id', ondelete='CASCADE'), nullable=False)
    title = Column(String, nullable=False)
    roleType = Column(Enum(RoleType, name="RoleType"), default=RoleType.GENERAL, nullable=False)
    description = Column(Text, nullable=False)
    requirements = Column(Text, nullable=False)
    primaryCriteria = Column(ARRAY(String), nullable=False)
    secondaryCriteria = Column(ARRAY(String), nullable=False)
    atsScoringWeights = Column(JSONB, nullable=False)
    evaluationCriteria = Column(JSONB, default=dict, nullable=False)
    createdAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updatedAt = Column(DateTime(timezone=True), server_default=func.now(), default=func.now(), onupdate=func.now(), nullable=False)

    company = relationship("Company", back_populates="jobRoles")
    questions = relationship("Question", back_populates="jobRole")
    sessions = relationship("InterviewSession", back_populates="jobRole", cascade="all, delete-orphan")


class Question(Base):
    __tablename__ = 'Question'

    id = Column(String, primary_key=True)
    companyId = Column(String, ForeignKey('Company.id', ondelete='CASCADE'), nullable=False)
    jobRoleId = Column(String, ForeignKey('JobRole.id', ondelete='SET NULL'), nullable=True)
    text = Column(Text, nullable=False)
    roleApplicability = Column(ARRAY(Enum(RoleType, name="RoleType")), nullable=False)
    difficulty = Column(Enum(Difficulty, name="Difficulty"), default=Difficulty.MEDIUM, nullable=False)
    topicCategories = Column(ARRAY(String), nullable=False)
    estimatedMinutes = Column(Integer, default=4, nullable=False)
    aiEvaluationGuidance = Column(Text, nullable=False)
    effectivenessRating = Column(Float, default=0.0, nullable=False)
    version = Column(Integer, default=1, nullable=False)
    isActive = Column(Boolean, default=True, nullable=False)
    createdAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updatedAt = Column(DateTime(timezone=True), server_default=func.now(), default=func.now(), onupdate=func.now(), nullable=False)

    company = relationship("Company", back_populates="questions")
    jobRole = relationship("JobRole", back_populates="questions")


class InterviewSession(Base):
    __tablename__ = 'InterviewSession'

    id = Column(String, primary_key=True)
    companyId = Column(String, ForeignKey('Company.id', ondelete='CASCADE'), nullable=False)
    candidateId = Column(String, ForeignKey('Candidate.id', ondelete='CASCADE'), nullable=False)
    jobRoleId = Column(String, ForeignKey('JobRole.id', ondelete='CASCADE'), nullable=False)
    status = Column(Enum(SessionStatus, name="SessionStatus"), default=SessionStatus.SCHEDULED, nullable=False)
    websocketId = Column(String, nullable=True)
    ueSocketId = Column(String, nullable=True)
    startedAt = Column(DateTime(timezone=True), nullable=True)
    completedAt = Column(DateTime(timezone=True), nullable=True)
    scheduledAt = Column(DateTime(timezone=True), nullable=True)
    transcript = Column(JSONB, default=list, nullable=False)
    avatarProvider = Column(String, default="ue5_pixel_streaming", nullable=False)
    evaluation = Column(JSONB, nullable=True)
    reportUrl = Column(String, nullable=True)
    # Where the full-interview recording landed after the engine forwarded it to this
    # backend's Drive-upload webhook (see routers/public.py upload_interview_recording).
    recordingDriveFileId = Column(String, nullable=True)
    recordingDriveUrl = Column(String, nullable=True)
    # B2 (S3-compatible) object key — replaces the two Drive columns above for
    # new recordings (see app/utils/backblaze.py). Not a URL: the bucket is
    # private, so playback needs a presigned URL minted fresh per read.
    recordingB2Key = Column(String, nullable=True)
    # Per-candidate invite token (shared with the engine). When set, the engine
    # requires a matching token to fetch the session + register on the WS, so only
    # the invited candidate can enter. Null = open (legacy/scheduled/demo path).
    inviteToken = Column(String, nullable=True)
    settings = Column(JSONB, default=dict, nullable=False)  # per-job interview settings synced from the backend Job
    createdAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updatedAt = Column(DateTime(timezone=True), server_default=func.now(), default=func.now(), onupdate=func.now(), nullable=False)

    company = relationship("Company", back_populates="sessions")
    candidate = relationship("Candidate", back_populates="sessions")
    jobRole = relationship("JobRole", back_populates="sessions")
    proctoringLogs = relationship("ProctoringLog", back_populates="session", cascade="all, delete-orphan")


class ProctoringLog(Base):
    __tablename__ = 'ProctoringLog'

    id = Column(String, primary_key=True)
    sessionId = Column(String, ForeignKey('InterviewSession.id', ondelete='CASCADE'), nullable=False)
    eventType = Column(String, nullable=False)
    severity = Column(Enum(Severity, name="Severity"), nullable=False)
    meta_data = Column('metadata', JSONB, default=dict, nullable=False)
    occurredAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    createdAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    session = relationship("InterviewSession", back_populates="proctoringLogs")


class ConsentLog(Base):
    """Immutable audit trail ("security log") of candidate consent decisions.

    Mirrors the interview engine's Prisma ``ConsentLog`` model on the shared DB.
    Rows are written by the engine from the candidate room's consent gate BEFORE
    any capture starts (biometric / recording+AI / 18+ / privacy-policy / cookies
    consent). The backend only reads these for recruiter/audit surfacing.

    Deliberately has NO ForeignKey to ``InterviewSession``: a consent/security log
    must outlive deletion of the interview data, so ``sessionId`` is a plain
    indexed string rather than a cascading relation.
    """
    __tablename__ = 'ConsentLog'

    id = Column(String, primary_key=True)
    sessionId = Column(String, nullable=False)
    action = Column(String, nullable=False)  # 'granted' | 'declined'
    consentVersion = Column(String, nullable=False)
    # { age18Plus, dataProcessing, biometric, privacyPolicy, cookies }
    scopes = Column(JSONB, default=dict, nullable=False)
    candidateEmail = Column(String, nullable=True)
    candidateName = Column(String, nullable=True)
    inviteToken = Column(String, nullable=True)
    userAgent = Column(String, nullable=True)
    ipAddress = Column(String, nullable=True)
    locale = Column(String, nullable=True)
    # DSAR tombstone: set to the data_subject_requests.id when this consent row's
    # identifiers were anonymised by an erasure (row KEPT as proof, PII stripped).
    erasedForRequestId = Column('erasedForRequestId', String, nullable=True)
    createdAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Index name matches the Prisma migration so create_all() and
    # `prisma migrate deploy` never fight over it, whichever runs first.
    __table_args__ = (
        Index('ConsentLog_sessionId_createdAt_idx', 'sessionId', 'createdAt'),
    )
