from sqlalchemy import Column, Enum, String, Text, DateTime
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
import enum
import uuid

from app.database import Base


class OrganisationStatus(str, enum.Enum):
    active = "active"
    # No "deleted" — an org cascades to jobs/users/applicants/sessions across three
    # services (backend, engine, dashboard), so there's no soft-delete concept for it
    # anywhere in this codebase. "suspended" (set by a superadmin) is the only other
    # state; it's enforced in app/utils/auth.py's get_current_user, not just at login.
    suspended = "suspended"


class Organisation(Base):
    __tablename__ = "organisations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_name = Column(String, nullable=False)
    status = Column(Enum(OrganisationStatus), default=OrganisationStatus.active)
    domain = Column(String, nullable=True)
    contact_email = Column(String, nullable=True)
    website_link = Column(String, nullable=True)
    location = Column(String, nullable=True)
    logo_url = Column(String, nullable=True)
    description = Column(Text, nullable=True)
    career_subdomain = Column(String, nullable=True)   # public /careers/<slug>
    career_intro = Column(Text, nullable=True)          # hero headline line
    # Company-default custom application questions (JSON text) asked on the public
    # apply form. A Job may override this with its own set (jobs.application_questions).
    application_questions = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
