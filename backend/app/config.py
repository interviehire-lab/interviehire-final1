import os
from dotenv import load_dotenv
from pydantic_settings import BaseSettings

# Explicitly load .env file from the parent directory of this file
_current_dir = os.path.dirname(os.path.abspath(__file__))
_env_path = os.path.join(_current_dir, "..", ".env")
load_dotenv(_env_path)


class Settings(BaseSettings):
    # Database
    DATABASE_URL: str = "postgresql://postgres:password@localhost:5432/hiring_dashboard"

    # App
    SECRET_KEY: str = "change-this-in-production"
    APP_NAME: str = "Hiring Dashboard"
 
    # CORS — the recruiter dashboard origin
    FRONTEND_URL: str = "https://interviehire.com"

    # The candidate interview room BASE URL (the engine web app). The link is
    # built as `{INTERVIEW_ROOM_URL}/interview?sessionId=…`, so this is the origin
    # only. The emailed calendar invite's "Enter Interview Room" link points here,
    # so it opens the SAME AI interview room that "Run test interview" uses.
    # Local: :3001.  Production: https://interviehire.com  (→ .../interview)
    INTERVIEW_ROOM_URL: str = "https://interview.interviehire.com"

    # Per-candidate unique interview invite links (`/i/{token}`).
    # INVITE_LINK_BASE is the origin that serves `GET /i/{token}` — this backend,
    # or whatever host/rewrite is put in front of it (e.g. app.interviehire.com/i/*
    # rewritten to the backend). The emailed link is `{INVITE_LINK_BASE}/i/{token}`.
    INVITE_LINK_BASE: str = "https://interviehire-backend-production-ca93.up.railway.app"
    # Dedicated transactional sender for interview invites — isolated from the
    # recruiting/cold-email From so it never touches that reputation pool.
    INVITE_FROM_EMAIL: str = "interviews@interviehire.com"
    # Days a freshly-minted invite link stays valid before it auto-expires.
    INVITE_TTL_DAYS: int = 7

    # Data-rights (DPDP Act 2023). DSAR_SLA_DAYS = statutory window to fulfil a Data
    # Principal request before it's flagged overdue (confirm against the current DPDP
    # Rules). DSAR_TOKEN_TTL_HOURS bounds self-serve verification / export-download links.
    # DPO_CONTACT_EMAIL is the published grievance-redressal contact (DPDP §13).
    DSAR_SLA_DAYS: int = 30
    DSAR_TOKEN_TTL_HOURS: int = 48
    DPO_CONTACT_EMAIL: str = "privacy@interviehire.com"

    # Backend -> interview-engine internal calls. The engine's on-disk transcripts /
    # recordings live on its own container (unreachable via the shared DB), so erasure
    # unlinks them through POST /internal/data-rights/erase-files, guarded by this secret.
    ENGINE_API_URL: str = "http://localhost:4000"
    INTERNAL_SERVICE_SECRET: str = "change-this-internal-secret"

    # Retention / auto-purge (DPDP §8). DISABLED while RETENTION_DAYS <= 0 (the default):
    # nothing is ever purged until you set it. When enabled, candidates whose retention
    # window has lapsed (and who aren't mid-pipeline) are anonymised in place — same path
    # as an erasure. RETENTION_MAX_PER_RUN bounds how many are processed per invocation.
    RETENTION_DAYS: int = 0
    RETENTION_MAX_PER_RUN: int = 500

    # SMTP Settings
    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_USERNAME: str | None = None
    SMTP_PASSWORD: str | None = None
    SMTP_FROM: str = "hr@interviehire.com"

    # Mailgun HTTP API (used in production — cloud hosts like Railway block SMTP ports).
    # When MAILGUN_API_KEY + MAILGUN_DOMAIN are set, mail is sent over HTTPS via Mailgun
    # (preserving the iCal invite); otherwise it falls back to SMTP (local dev).
    MAILGUN_API_KEY: str | None = None
    MAILGUN_DOMAIN: str | None = None
    MAILGUN_BASE_URL: str = "https://api.mailgun.net"

    # Google OAuth 2.0 Credentials
    GOOGLE_CLIENT_ID: str | None = None
    GOOGLE_CLIENT_SECRET: str | None = None
    GOOGLE_REFRESH_TOKEN: str | None = None
    GOOGLE_REDIRECT_URI: str = "https://interviehire-backend-production-ca93.up.railway.app/api/public/oauth2callback"
    ORGANIZER_CALENDAR_ID: str = "primary"
    GOOGLE_DRIVE_FOLDER_NAME: str = "Recordings"
    WEBHOOK_SECRET: str = "super-secret-webhook-key"

    # API Keys
    GROQ_API_KEY: str | None = None
    GROK_API_KEY: str | None = None
    XAI_API_KEY: str | None = None
    GEMINI_API_KEY: str | None = None
    DEEPSEEK_API_KEY: str | None = None
    RESEND_API_KEY: str | None = None

    # Twilio (WhatsApp confirmation + voice reminder calls), called via raw HTTPS
    # (`requests`) — same pattern as Resend above, no `twilio` SDK dependency. Blank
    # by default: `app/utils/twilio_client.py` no-ops (logs + returns False) whenever
    # TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN aren't set, so the feature is inert until
    # configured rather than a startup/runtime hazard. TWILIO_WHATSAPP_FROM is a bare
    # E.164 number (e.g. +14155238886) — the `whatsapp:` prefix is added in code.
    TWILIO_ACCOUNT_SID: str = ""
    TWILIO_AUTH_TOKEN: str = ""
    TWILIO_WHATSAPP_FROM: str = ""
    TWILIO_VOICE_FROM: str = ""

    # Optional: a scoped API Key (Twilio Console -> Account -> API keys & tokens,
    # SID starts "SK...") used INSTEAD of TWILIO_AUTH_TOKEN for authentication when
    # both are set — Twilio's recommended credential for server-side integrations,
    # since it can be individually revoked/rotated without touching the Auth Token
    # (which also gates full account/billing control). TWILIO_ACCOUNT_SID is still
    # required either way — it's used in the request URL, not for authentication.
    TWILIO_API_KEY_SID: str = ""
    TWILIO_API_KEY_SECRET: str = ""

    # WhatsApp Business API generally requires a pre-approved Content Template (not
    # freeform text) for a business-initiated message like a confirmation or reminder
    # — freeform only works within an open 24h customer-service session, or on the
    # Twilio Sandbox number. Set these to the Content SID (starts "HX...") of your
    # approved templates in the Twilio Console -> Content Editor, and
    # `twilio_client.py` will send via `ContentSid`/`ContentVariables` instead of
    # `Body`. Left blank, both fall back to freeform `Body` (fine for Sandbox testing,
    # likely to be rejected by WhatsApp on an approved production sender).
    TWILIO_WHATSAPP_CONFIRMATION_CONTENT_SID: str = ""
    TWILIO_WHATSAPP_REMINDER_CONTENT_SID: str = ""

    # Numbered Twilio Content variables are generated from these explicit semantic
    # orders. The approved templates must use the same order; changing a template
    # no longer requires a code deploy, only updating the corresponding order.
    TWILIO_WHATSAPP_CONFIRMATION_VARIABLE_ORDER: str = (
        "first_name,stage_name,job_title,org_name,date,time,interview_link,reschedule_link"
    )
    TWILIO_WHATSAPP_REMINDER_VARIABLE_ORDER: str = (
        "first_name,stage_name,job_title,minutes_before,interview_link"
    )

    # Interview reminder job (email + WhatsApp + robocall, ~REMINDER_MINUTES_BEFORE
    # the scheduled start). No global disable switch — email always attempts to send
    # regardless of Twilio config; only the Twilio-backed channels no-op individually
    # when unconfigured. See `app/jobs/reminders.py`.
    REMINDER_MINUTES_BEFORE: int = 30
    REMINDER_MAX_PER_RUN: int = 200

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
