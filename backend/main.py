from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.websocket_routes import router as websocket_router
from app.database import Base, engine
from app.routers import jobs, team, organisation, usage, settings as settings_router, deepseek, auth, public, leaderboard, invites, privacy, internal_jobs
from app.talent_finder.routes import router as talent_finder_router

# Import all models so SQLAlchemy registers them before create_all
import app.models  # noqa


def init_db():
    """Create tables + idempotent column migrations.

    Runs at startup (via lifespan), NOT at module import, and is non-fatal: a
    transient DB hiccup is logged and the app still boots and serves (the
    healthcheck at GET / is DB-free), instead of crash-looping the container.
    """
    # Create all tables
    Base.metadata.create_all(bind=engine)

    # Auto-migrate: Add parameters columns to jobs if they don't exist
    with engine.connect() as conn:
        from sqlalchemy import text
        conn.execute(text("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS resume_parameters TEXT;"))
        conn.execute(text("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS screening_parameters TEXT;"))
        conn.execute(text("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS functional_parameters TEXT;"))
        conn.execute(text("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS screening_questions TEXT;"))
        conn.execute(text("ALTER TABLE applicants ADD COLUMN IF NOT EXISTS recruiter_screening VARCHAR;"))
        conn.execute(text("ALTER TABLE applicants ADD COLUMN IF NOT EXISTS recruiter_screening_score FLOAT;"))
        conn.execute(text("ALTER TABLE applicants ADD COLUMN IF NOT EXISTS attempted_at TIMESTAMP;"))
        conn.execute(text("ALTER TABLE applicants ADD COLUMN IF NOT EXISTS match_score FLOAT;"))
        conn.execute(text("ALTER TABLE applicants ADD COLUMN IF NOT EXISTS resume_analysis_report TEXT;"))
        conn.execute(text("ALTER TABLE applicants ADD COLUMN IF NOT EXISTS resume_text TEXT;"))
        conn.execute(text("ALTER TABLE applicants ADD COLUMN IF NOT EXISTS resume_analysed BOOLEAN DEFAULT FALSE;"))
        conn.execute(text("ALTER TABLE applicants ADD COLUMN IF NOT EXISTS resume_shortlisted BOOLEAN DEFAULT FALSE;"))
        conn.execute(text("ALTER TABLE applicants ADD COLUMN IF NOT EXISTS resume_waitlisted BOOLEAN DEFAULT FALSE;"))
        conn.execute(text("ALTER TABLE applicants ADD COLUMN IF NOT EXISTS scheduling_token VARCHAR;"))
        conn.execute(text("ALTER TABLE applicants ADD COLUMN IF NOT EXISTS calendar_event_id VARCHAR;"))
        conn.execute(text("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS organisation_id UUID;"))
        conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS organisation_id UUID;"))
        conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS google_refresh_token VARCHAR;"))
        conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS google_client_id VARCHAR;"))
        conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS google_client_secret VARCHAR;"))
        conn.execute(text("ALTER TABLE applicants ADD COLUMN IF NOT EXISTS overall_interview_score FLOAT;"))
        conn.execute(text("ALTER TABLE applicants ADD COLUMN IF NOT EXISTS proctoring_severity_flag VARCHAR;"))
        conn.execute(text("ALTER TABLE applicants ADD COLUMN IF NOT EXISTS calendar_sequence INTEGER DEFAULT 0;"))
        conn.execute(text("ALTER TABLE applicants ADD COLUMN IF NOT EXISTS decision TEXT;"))
        conn.execute(text("ALTER TABLE applicants ADD COLUMN IF NOT EXISTS entry_method VARCHAR;"))
        conn.execute(text("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS screening_questions TEXT;"))
        conn.execute(text("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS interview_settings TEXT;"))
        # Exit-interview feature: hiring-vs-exit job flag + leaver metadata columns.
        # VARCHAR (not the native jobtype enum) so the ALTER never depends on the
        # enum type pre-existing on already-deployed DBs; DEFAULT keeps old jobs 'hiring'.
        conn.execute(text("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS job_kind VARCHAR DEFAULT 'hiring';"))
        conn.execute(text("ALTER TABLE applicants ADD COLUMN IF NOT EXISTS department VARCHAR;"))
        conn.execute(text("ALTER TABLE applicants ADD COLUMN IF NOT EXISTS manager_name VARCHAR;"))
        conn.execute(text("ALTER TABLE applicants ADD COLUMN IF NOT EXISTS tenure_months INTEGER;"))
        conn.execute(text("ALTER TABLE applicants ADD COLUMN IF NOT EXISTS separation_type VARCHAR;"))
        conn.execute(text("ALTER TABLE applicants ADD COLUMN IF NOT EXISTS last_working_day TIMESTAMP;"))
        conn.execute(text("ALTER TABLE applicants ADD COLUMN IF NOT EXISTS primary_reason VARCHAR;"))
        conn.execute(text("""ALTER TABLE "InterviewSession" ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}';"""))
        conn.execute(text("ALTER TABLE organisations ADD COLUMN IF NOT EXISTS career_subdomain VARCHAR;"))
        conn.execute(text("ALTER TABLE organisations ADD COLUMN IF NOT EXISTS career_intro TEXT;"))
        conn.execute(text('ALTER TABLE "InterviewSession" ADD COLUMN IF NOT EXISTS "inviteToken" VARCHAR;'))
        # DSAR / DPDP Act 2023: anonymisation markers on applicants + a consent-log
        # tombstone pointer. The compliance_audit_logs and data_subject_requests tables
        # are created by create_all (models registered in app/models/__init__.py).
        conn.execute(text("ALTER TABLE applicants ADD COLUMN IF NOT EXISTS anonymised_at TIMESTAMP;"))
        conn.execute(text("ALTER TABLE applicants ADD COLUMN IF NOT EXISTS erasure_request_id UUID;"))
        conn.execute(text('ALTER TABLE "ConsentLog" ADD COLUMN IF NOT EXISTS "erasedForRequestId" VARCHAR;'))
        # Direct-apply consent: candidate applied via the public career page / direct
        # link and agreed to the privacy policy (they hand us PII first-hand).
        conn.execute(text("ALTER TABLE applicants ADD COLUMN IF NOT EXISTS consent_given_at TIMESTAMP;"))
        conn.execute(text("ALTER TABLE applicants ADD COLUMN IF NOT EXISTS consent_version VARCHAR;"))
        # Custom application questions (public apply form): org-wide default +
        # per-job override (both JSON text), and the candidate's answers.
        conn.execute(text("ALTER TABLE organisations ADD COLUMN IF NOT EXISTS application_questions TEXT;"))
        conn.execute(text("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS application_questions TEXT;"))
        conn.execute(text("ALTER TABLE applicants ADD COLUMN IF NOT EXISTS application_answers TEXT;"))
        # Optional per-job deadline for the public apply link (NULL = no expiry).
        conn.execute(text("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS applications_close_at TIMESTAMP WITH TIME ZONE;"))
        conn.execute(text('ALTER TABLE "InterviewSession" ADD COLUMN IF NOT EXISTS "recordingDriveFileId" VARCHAR;'))
        conn.execute(text('ALTER TABLE "InterviewSession" ADD COLUMN IF NOT EXISTS "recordingDriveUrl" VARCHAR;'))
        # Pre-interview reminder job (email + WhatsApp + robocall, ~REMINDER_MINUTES_BEFORE
        # start): per-stage "already sent" markers so app/jobs/reminders.py never re-fires.
        conn.execute(text("ALTER TABLE applicants ADD COLUMN IF NOT EXISTS screening_reminder_sent_at TIMESTAMP WITH TIME ZONE;"))
        conn.execute(text("ALTER TABLE applicants ADD COLUMN IF NOT EXISTS functional_reminder_sent_at TIMESTAMP WITH TIME ZONE;"))
        conn.commit()

        # Backfill: repair legacy jobs with a NULL organisation_id by inheriting the
        # org of their creator. Deny-by-default access checks (leaderboard/jobs)
        # treat a null-org job as inaccessible, so this reconnects orphaned rows to
        # their rightful tenant. Idempotent — only touches still-null rows, and only
        # when the creator has a known org. Non-fatal (Postgres UPDATE ... FROM).
        try:
            conn.execute(text(
                """
                UPDATE jobs
                SET organisation_id = users.organisation_id
                FROM users
                WHERE jobs.organisation_id IS NULL
                  AND jobs.created_by_id = users.id
                  AND users.organisation_id IS NOT NULL;
                """
            ))
            conn.commit()
        except Exception as backfill_err:
            print(f"Backfill error (jobs.organisation_id): {backfill_err}")

        # Add 'super_admin' to usertype enum in postgresql
        try:
            conn.execute(text("COMMIT;"))  # ALTER TYPE cannot run inside a transaction block in PostgreSQL
            conn.execute(text("ALTER TYPE usertype ADD VALUE 'super_admin';"))
        except Exception:
            pass
        conn.commit()

        # Add 'exit' to applicantsource enum (exit-interview leavers)
        try:
            conn.execute(text("COMMIT;"))  # ALTER TYPE cannot run inside a transaction block in PostgreSQL
            conn.execute(text("ALTER TYPE applicantsource ADD VALUE 'exit';"))
        except Exception:
            pass
        conn.commit()

        # Rename / Migrate career_pages -> organisations
        try:
            is_postgres = settings.DATABASE_URL.startswith("postgresql")
            if is_postgres:
                check_career_pages = conn.execute(text("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'career_pages');")).scalar()
                check_organisations = conn.execute(text("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'organisations');")).scalar()
            else:
                check_career_pages = conn.execute(text("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='career_pages';")).scalar()
                check_organisations = conn.execute(text("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='organisations';")).scalar()

            if check_career_pages:
                if check_organisations:
                    count_orgs = conn.execute(text("SELECT count(*) FROM organisations;")).scalar()
                    if count_orgs == 0:
                        print("Migrating data from career_pages to organisations...")
                        conn.execute(text("""
                            INSERT INTO organisations (id, org_name, domain, contact_email, website_link, location, logo_url, description, created_at, updated_at)
                            SELECT id, org_name, domain, contact_email, website_link, location, logo_url, description, created_at, updated_at
                            FROM career_pages;
                        """))
                        conn.commit()
                print("Dropping legacy career_pages table...")
                conn.execute(text("DROP TABLE career_pages;"))
                conn.commit()
        except Exception as migration_err:
            print(f"Migration error (career_pages -> organisations): {migration_err}")

    # Backfill: every organisation needs a public career subdomain so its careers
    # page is addressable. Older orgs (created before subdomains were auto-assigned)
    # have NULL — give each a unique slug. Idempotent: orgs that already have one
    # are skipped.
    try:
        from app.database import SessionLocal
        from app.models.organisation import Organisation
        from app.utils.career import unique_career_subdomain

        db = SessionLocal()
        try:
            missing = db.query(Organisation).filter(Organisation.career_subdomain.is_(None)).all()
            for org in missing:
                org.career_subdomain = unique_career_subdomain(db, org.org_name, org.id)
                db.flush()  # make this slug visible to the next iteration's uniqueness check
            if missing:
                db.commit()
                print(f"Backfilled career_subdomain for {len(missing)} organisation(s).")
        finally:
            db.close()
    except Exception as backfill_err:
        print(f"Backfill error (career_subdomain): {backfill_err}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Schema setup at startup, not import. Non-fatal so a slow/unreachable DB at
    # boot doesn't crash the container — the app still serves and the healthcheck
    # passes; the idempotent migrations retry on the next boot.
    try:
        init_db()
    except Exception as e:
        print(f"[startup] init_db failed; serving without migration this boot. Fix DB/migrations: {e}")
    yield


app = FastAPI(title=settings.APP_NAME, lifespan=lifespan)

# CORS — allows Next.js frontend to talk to this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in str(settings.FRONTEND_URL).split(",") if o.strip()] + [
        "https://interviehire.com",
        "https://app.interviehire.com",
        "https://interview.interviehire.com",
        "http://127.0.0.1:3000",
        "http://localhost:3000",
        "http://127.0.0.1:3001",
        "http://localhost:3001",
        "http://localhost:3100",
    ],
    allow_credentials=True,
    # Narrowed from "*" — only the verbs/headers this API actually serves. The
    # origin list above is already an explicit allowlist.
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept", "Origin", "X-Requested-With"],
)

# Routers
app.include_router(websocket_router)  # existing WS routes
app.include_router(auth.router,             prefix="/api/auth",     tags=["Auth"])
app.include_router(jobs.router,             prefix="/api/jobs",     tags=["Jobs"])
app.include_router(team.router,             prefix="/api/team",     tags=["Team"])
app.include_router(organisation.router,     prefix="/api/organisation", tags=["Organisation"])
app.include_router(usage.router,            prefix="/api/usage",    tags=["Usage"])
app.include_router(settings_router.router,  prefix="/api/settings", tags=["Settings"])
app.include_router(deepseek.router,         prefix="/api/deepseek", tags=["DeepSeek"])
app.include_router(public.router,           prefix="/api/public",   tags=["Public"])
app.include_router(leaderboard.router,      prefix="/api/leaderboard", tags=["Leaderboard"])
app.include_router(talent_finder_router,    prefix="/api/talent-finder", tags=["Talent Finder"])
app.include_router(invites.router,          prefix="/api/invites", tags=["Invites"])
app.include_router(invites.public_link_router, tags=["Invites"])  # public GET /i/{token}
app.include_router(privacy.router,          prefix="/api/privacy", tags=["Privacy / Data Rights"])
app.include_router(internal_jobs.router,    prefix="/api/internal", tags=["Internal Jobs"])


@app.get("/")
def root():
    return {"status": "ok", "app": settings.APP_NAME}
 