"""Per-candidate unique interview invite links (`/i/{token}`).

Each candidate gets an unguessable `uuid4().hex` token bound to their applicant
row. Opening `GET /i/{token}` validates the token (single-use lifecycle), flips
it `pending -> started`, and 302-redirects into the AI interview room keyed on
the applicant id (the engine session id). Because the emailed link carries the
unguessable token — not the bare applicant id — only the candidate who received
it can enter, and expired/completed links are rejected at this gate.

The lifecycle gate lives in one place (`_transition_for_entry`) so switching
from single-use to slot-based later is a localized change.
"""

from fastapi import APIRouter, Depends, HTTPException, Body, Request
from fastapi.responses import RedirectResponse, HTMLResponse
from sqlalchemy.orm import Session
from uuid import UUID
from datetime import datetime, timedelta, timezone
from typing import Optional, List, Tuple
import uuid
import os
import time
import threading
import logging

from app.database import get_db
from app.config import settings
from app.models.applicant import Applicant, InterviewStatus
from app.models.job import Job
from app.models.user import User
from app.models.interview_invite import InterviewInvite, InviteStatus
from app.utils.auth import get_current_user, get_active_org_id
from app.utils.email_sender import send_interview_invite_email
from app.routers.jobs import _verify_applicant_access, _verify_job_access, _is_test_applicant

logger = logging.getLogger(__name__)

# Authed CRUD surface for recruiters — mounted at /api/invites.
router = APIRouter()
# The public candidate-facing link — mounted at root so the URL is /i/{token}.
public_link_router = APIRouter()


# Basic in-memory per-IP fixed-window limiter for the PUBLIC token endpoints —
# defense-in-depth against token probing (the 128-bit token already makes
# enumeration impractical). Best-effort: per-process, resets on restart.
_RL_LOCK = threading.Lock()
_RL_BUCKETS: dict = {}  # ip -> (count, window_start_monotonic)


def _rate_limit(request: Optional[Request], *, limit: int, window: float = 60.0, key: Optional[str] = None) -> None:
    # Bucket on the caller IP by default; pass an explicit `key` (e.g.
    # "login:email:<addr>") to throttle a different dimension such as the target
    # account, so credential-stuffing across IPs is still capped per-account.
    if key is not None:
        bucket_key = key
    else:
        bucket_key = (request.client.host if request and request.client else "unknown")
    now = time.monotonic()
    with _RL_LOCK:
        # Opportunistic prune so the dict can't grow unbounded.
        if len(_RL_BUCKETS) > 5000:
            for stale in [k for k, v in _RL_BUCKETS.items() if now - v[1] > window]:
                _RL_BUCKETS.pop(stale, None)
        count, start = _RL_BUCKETS.get(bucket_key, (0, now))
        if now - start > window:
            count, start = 0, now
        count += 1
        _RL_BUCKETS[bucket_key] = (count, start)
        if count > limit:
            raise HTTPException(status_code=429, detail="Too many requests. Please slow down and try again shortly.")


# ---------------------------------------------------------------------------
# Service helpers
# ---------------------------------------------------------------------------

def build_invite_link(token: str) -> str:
    """Public invite URL for `GET /i/{token}` (served by this backend).

    Resolution order so production links work with zero extra config:
    1. an explicit, non-localhost ``INVITE_LINK_BASE``;
    2. else the platform-provided public origin — Railway sets
       ``RAILWAY_PUBLIC_DOMAIN``, Render sets ``RENDER_EXTERNAL_URL``;
    3. else the configured default (localhost in dev).
    """
    base = (settings.INVITE_LINK_BASE or "").strip()
    if not base or "localhost" in base or "127.0.0.1" in base:
        railway_domain = os.getenv("RAILWAY_PUBLIC_DOMAIN")
        render_url = os.getenv("RENDER_EXTERNAL_URL")
        if railway_domain:
            base = f"https://{railway_domain}"
        elif render_url:
            base = render_url
    if not base:
        base = "http://localhost:8000"
    return f"{base.rstrip('/')}/i/{token}"


def _invite_job_description(db: Session, invite: InterviewInvite) -> Optional[str]:
    """The real JD text for an invite's email, when the invite is bound to a
    real Job row (``invite.job_id``). Standalone invites minted with just a
    free-text ``role`` string (no ``job_id``) have no JD to show."""
    if not invite.job_id:
        return None
    job = db.query(Job).filter(Job.id == invite.job_id).first()
    return job.description if job else None


def create_invite(
    db: Session,
    *,
    candidate_email: str,
    candidate_name: Optional[str] = None,
    role: Optional[str] = None,
    applicant: Optional[Applicant] = None,
    job_id: Optional[UUID] = None,
    stage: Optional[str] = None,
    ttl_days: Optional[int] = None,
) -> Tuple[InterviewInvite, str]:
    """Mint an invite row + its public link. Returns ``(invite, link)``.

    `token = uuid4().hex` — 32 hex chars, unguessable, URL-clean. Bound to an
    `applicant` when provided so the completed interview's score flows back onto
    that candidate's pipeline card; `applicant_id` is left null for standalone
    invites.
    """
    ttl = ttl_days if ttl_days is not None else settings.INVITE_TTL_DAYS
    now = datetime.now(timezone.utc)

    # One active link per applicant+stage: supersede prior un-opened (pending)
    # links so a candidate can't accumulate multiple live tokens. An already
    # `started` link is left alone so an in-progress interview is never severed.
    if applicant is not None:
        db.query(InterviewInvite).filter(
            InterviewInvite.applicant_id == applicant.id,
            InterviewInvite.stage == stage,
            InterviewInvite.status == InviteStatus.pending,
        ).update({InterviewInvite.status: InviteStatus.expired}, synchronize_session=False)

    invite = InterviewInvite(
        token=uuid.uuid4().hex,
        applicant_id=(applicant.id if applicant else None),
        job_id=(job_id or (applicant.job_id if applicant else None)),
        candidate_email=candidate_email,
        candidate_name=candidate_name or (applicant.name if applicant else None),
        role=role,
        stage=stage,
        status=InviteStatus.pending,
        expires_at=now + timedelta(days=ttl),
    )
    db.add(invite)
    db.commit()
    db.refresh(invite)
    return invite, build_invite_link(invite.token)


def invite_candidates(
    db: Session,
    candidates: List[dict],
    *,
    send: bool = True,
    ttl_days: Optional[int] = None,
) -> List[dict]:
    """Batch-mint standalone invites and (optionally) email them.

    `candidates` is a list of ``{email, name?, role?}``. Returns
    ``[{email, token, link}]``.
    """
    results: List[dict] = []
    for c in candidates:
        email = (c.get("email") or "").strip()
        if not email:
            continue
        invite, link = create_invite(
            db,
            candidate_email=email,
            candidate_name=c.get("name"),
            role=c.get("role"),
            ttl_days=ttl_days,
        )
        if send:
            try:
                send_interview_invite_email(
                    invite.candidate_name, invite.candidate_email, invite.role, link, invite.expires_at,
                    job_description=_invite_job_description(db, invite),
                )
            except Exception as mail_err:
                logger.error(f"Failed to send invite email to {email}: {mail_err}")
        results.append({"email": invite.candidate_email, "token": invite.token, "link": link})
    return results


def _transition_for_entry(db: Session, invite: InterviewInvite) -> Optional[Tuple[int, str]]:
    """Single-use lifecycle gate (the one place to change for slot-based later).

    Returns ``None`` when entry is allowed (after flipping ``pending -> started``),
    or ``(status_code, detail)`` to reject the open.
    """
    now = datetime.now(timezone.utc)

    if invite.status == InviteStatus.completed:
        return (410, "This interview has already been completed.")

    exp = invite.expires_at
    if exp is not None:
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if now > exp:
            if invite.status != InviteStatus.expired:
                invite.status = InviteStatus.expired
                db.commit()
            return (410, "This interview link has expired.")

    if invite.status == InviteStatus.expired:
        return (410, "This interview link has expired.")

    if invite.status == InviteStatus.pending:
        invite.status = InviteStatus.started
        invite.started_at = now
        db.commit()
    # An already-`started` invite is re-enterable (candidate reconnects after a drop).
    return None


def _mask_email(email: str) -> str:
    """`jane@acme.com` -> `j***@acme.com` for candidate-facing confirmation copy."""
    try:
        local, _, domain = (email or "").partition("@")
        if not domain:
            return "your email"
        return f"{(local[0] if local else '')}***@{domain}"
    except Exception:
        return "your email"


def _invite_error_html(title: str, message: str, request_token: Optional[str] = None) -> str:
    action = (
        f'<form method="POST" action="/i/{request_token}/request-new" style="margin-top:24px;">'
        f'<button type="submit" class="btn">Email me a new link</button>'
        f'</form>'
        if request_token
        else ""
    )
    return f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{title}</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap');
        body {{ font-family:'Poppins',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; background:#f4f4f6; color:#17171F; margin:0; padding:100px 20px; text-align:center; }}
        .card {{ max-width:460px; margin:0 auto; background:#fff; border:1px solid #ECECF1; border-radius:18px; padding:44px 36px; box-shadow:0 8px 30px rgba(23,23,31,0.06); }}
        h1 {{ font-size:20px; font-weight:700; margin:0 0 12px; }}
        p {{ font-size:15px; line-height:1.6; color:#6B6B76; margin:0; }}
        .dot {{ width:46px; height:46px; border-radius:50%; background:#FCE9E4; color:#F5542E; font-weight:700; font-size:22px; line-height:46px; margin:0 auto 20px; }}
        .btn {{ display:inline-block; background:#F5542E; color:#fff; border:none; font-weight:600; font-size:14px; padding:12px 26px; border-radius:10px; cursor:pointer; font-family:inherit; }}
    </style>
</head>
<body>
    <div class="card">
        <div class="dot">!</div>
        <h1>{title}</h1>
        <p>{message}</p>
        {action}
    </div>
</body>
</html>"""


def _provision_invite_for_applicant(
    db: Session, applicant: Applicant, *, stage: Optional[str] = None, send: bool = False
) -> dict:
    """Validate, provision (stage + engine session + token binding) and mint a
    unique invite for one applicant. Shared by the single + bulk endpoints.
    Raises HTTPException(400) for test applicants / missing email."""
    if _is_test_applicant(applicant):
        raise HTTPException(status_code=400, detail="Cannot create an interview invite for a test applicant.")
    if not (applicant.email or "").strip():
        raise HTTPException(status_code=400, detail="This applicant has no email address to send an invite to.")

    stage = (stage or "").lower().strip()
    if stage not in ("screening", "functional"):
        stage = "functional" if applicant.functional_status is not None else "screening"

    # Provision the stage + engine session so the room has questions when the
    # candidate opens the link (mirrors the schedule flow).
    now = datetime.now(timezone.utc)
    if stage == "screening":
        if applicant.screening_status is None:
            applicant.screening_status = InterviewStatus.scheduled
        if not applicant.screening_scheduled_at:
            applicant.screening_scheduled_at = now
    else:
        if applicant.functional_status is None:
            applicant.functional_status = InterviewStatus.scheduled
        if not applicant.functional_scheduled_at:
            applicant.functional_scheduled_at = now
    db.commit()

    job = db.query(Job).filter(Job.id == applicant.job_id).first()
    role_title = (job.role_name or job.title) if job else None

    invite, link = create_invite(
        db,
        candidate_email=applicant.email,
        candidate_name=applicant.name,
        role=role_title,
        applicant=applicant,
        job_id=applicant.job_id,
        stage=stage,
    )

    # Provision the engine InterviewSession (questions/rubric) for this applicant.
    try:
        from app.utils.ai_sync import sync_applicant_to_ai
        sync_applicant_to_ai(db, applicant)
    except Exception as sync_err:
        logger.error(f"Failed to sync applicant to AI for invite {invite.token}: {sync_err}")

    # Bind the token onto the shared InterviewSession so the engine enforces it at
    # the room + WebSocket layer (only this candidate's token gets in). sync clears
    # inviteToken on (re)provision, so the latest link always wins.
    try:
        from app.models.ai_integration import InterviewSession as _EngineSession
        sess = db.query(_EngineSession).filter(_EngineSession.id == str(applicant.id)).first()
        if sess is not None:
            sess.inviteToken = invite.token
            db.commit()
    except Exception as bind_err:
        logger.error(f"Failed to bind invite token to session for {invite.token}: {bind_err}")

    sent = False
    if send:
        try:
            sent = send_interview_invite_email(
                invite.candidate_name, invite.candidate_email, invite.role, link, invite.expires_at,
                job_description=_invite_job_description(db, invite),
            )
        except Exception as mail_err:
            logger.error(f"Failed to send invite email for {invite.token}: {mail_err}")

    return {
        "token": invite.token,
        "link": link,
        "status": invite.status.value,
        "applicant_id": str(applicant.id),
        "candidate_email": invite.candidate_email,
        "candidate_name": invite.candidate_name,
        "role": invite.role,
        "stage": invite.stage,
        "expires_at": invite.expires_at.isoformat() if invite.expires_at else None,
        "sent": sent,
    }


# ---------------------------------------------------------------------------
# Authed routes (recruiter dashboard) — /api/invites
# ---------------------------------------------------------------------------

@router.post("")
def create_interview_invite(
    data: dict = Body(...),
    current_user: User = Depends(get_current_user),
    active_org_id: Optional[UUID] = Depends(get_active_org_id),
    db: Session = Depends(get_db),
):
    """Mint (and optionally email) a unique interview link for one applicant.

    Body: ``{ applicant_id: str, stage?: 'screening'|'functional', send?: bool }``.
    """
    applicant_id = data.get("applicant_id")
    if not applicant_id:
        raise HTTPException(status_code=400, detail="applicant_id is required")
    try:
        applicant_uuid = UUID(str(applicant_id))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid applicant_id")

    applicant = _verify_applicant_access(applicant_uuid, current_user, active_org_id, db)
    return _provision_invite_for_applicant(
        db, applicant, stage=data.get("stage"), send=bool(data.get("send", False))
    )


@router.get("")
def list_interview_invites(
    applicant_id: Optional[str] = None,
    job_id: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    active_org_id: Optional[UUID] = Depends(get_active_org_id),
    db: Session = Depends(get_db),
):
    """List invites + statuses (newest first) for one candidate (`applicant_id`) or
    a whole job (`job_id`) so the dashboard can show link status without re-minting.
    Exactly one of the two query params is required."""
    q = db.query(InterviewInvite)
    if applicant_id:
        try:
            applicant_uuid = UUID(str(applicant_id))
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid applicant_id")
        _verify_applicant_access(applicant_uuid, current_user, active_org_id, db)
        q = q.filter(InterviewInvite.applicant_id == applicant_uuid)
    elif job_id:
        try:
            job_uuid = UUID(str(job_id))
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid job_id")
        _verify_job_access(job_uuid, current_user, active_org_id, db)
        q = q.filter(InterviewInvite.job_id == job_uuid)
    else:
        raise HTTPException(status_code=400, detail="applicant_id or job_id query param is required")

    rows = q.order_by(InterviewInvite.created_at.desc()).all()
    return {
        "invites": [
            {
                "token": r.token,
                "link": build_invite_link(r.token),
                "status": r.status.value,
                "stage": r.stage,
                "applicant_id": str(r.applicant_id) if r.applicant_id else None,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "expires_at": r.expires_at.isoformat() if r.expires_at else None,
                "started_at": r.started_at.isoformat() if r.started_at else None,
                "completed_at": r.completed_at.isoformat() if r.completed_at else None,
            }
            for r in rows
        ],
        "count": len(rows),
    }


@router.post("/bulk")
def create_interview_invites_bulk(
    data: dict = Body(...),
    current_user: User = Depends(get_current_user),
    active_org_id: Optional[UUID] = Depends(get_active_org_id),
    db: Session = Depends(get_db),
):
    """Batch-mint standalone invites. Body: ``{ candidates: [{email,name?,role?}], send?: bool }``."""
    candidates = data.get("candidates") or []
    if not isinstance(candidates, list) or not candidates:
        raise HTTPException(status_code=400, detail="candidates must be a non-empty list")
    send = bool(data.get("send", True))
    results = invite_candidates(db, candidates, send=send)
    return {"invited": results, "count": len(results)}


@router.post("/applicants")
def create_interview_invites_for_applicants(
    data: dict = Body(...),
    current_user: User = Depends(get_current_user),
    active_org_id: Optional[UUID] = Depends(get_active_org_id),
    db: Session = Depends(get_db),
):
    """Bulk-mint per-applicant invites (e.g. "invite all shortlisted").
    Body: ``{ applicant_ids: [str], stage?: 'screening'|'functional', send?: bool }``.
    A per-applicant failure is collected in `errors` instead of aborting the batch."""
    ids = data.get("applicant_ids") or []
    if not isinstance(ids, list) or not ids:
        raise HTTPException(status_code=400, detail="applicant_ids must be a non-empty list")
    stage = data.get("stage")
    send = bool(data.get("send", False))

    results: List[dict] = []
    errors: List[dict] = []
    for raw in ids:
        try:
            applicant_uuid = UUID(str(raw))
        except Exception:
            errors.append({"applicant_id": str(raw), "error": "Invalid applicant_id"})
            continue
        try:
            applicant = _verify_applicant_access(applicant_uuid, current_user, active_org_id, db)
            results.append(_provision_invite_for_applicant(db, applicant, stage=stage, send=send))
        except HTTPException as he:
            errors.append({"applicant_id": str(raw), "error": he.detail})
        except Exception as e:
            db.rollback()
            logger.error(f"Bulk invite failed for applicant {raw}: {e}")
            errors.append({"applicant_id": str(raw), "error": "Failed to create invite"})
    return {"invited": results, "errors": errors, "count": len(results)}


@router.post("/{token}/send")
def send_existing_invite(
    token: str,
    current_user: User = Depends(get_current_user),
    active_org_id: Optional[UUID] = Depends(get_active_org_id),
    db: Session = Depends(get_db),
):
    """Email an already-minted invite to its candidate — reuses the SAME link, so
    it never re-mints/invalidates a link the recruiter already copied."""
    invite = db.query(InterviewInvite).filter(InterviewInvite.token == token).first()
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found")
    # Authorise against the bound candidate's job (when the invite is bound).
    if invite.applicant_id:
        _verify_applicant_access(invite.applicant_id, current_user, active_org_id, db)

    link = build_invite_link(invite.token)
    try:
        sent = send_interview_invite_email(
            invite.candidate_name, invite.candidate_email, invite.role, link, invite.expires_at,
            job_description=_invite_job_description(db, invite),
        )
    except Exception as mail_err:
        logger.error(f"Failed to send invite {token}: {mail_err}")
        raise HTTPException(status_code=502, detail="Failed to send invite email")
    return {"token": invite.token, "link": link, "sent": bool(sent), "candidate_email": invite.candidate_email}


@router.post("/{token}/revoke")
def revoke_invite(
    token: str,
    current_user: User = Depends(get_current_user),
    active_org_id: Optional[UUID] = Depends(get_active_org_id),
    db: Session = Depends(get_db),
):
    """Immediately kill a link (sets status=expired). No-op if already completed.
    Use when a link leaks or a candidate is withdrawn."""
    invite = db.query(InterviewInvite).filter(InterviewInvite.token == token).first()
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found")
    if invite.applicant_id:
        _verify_applicant_access(invite.applicant_id, current_user, active_org_id, db)
    if invite.status != InviteStatus.completed:
        invite.status = InviteStatus.expired
        db.commit()
    return {"token": invite.token, "status": invite.status.value}


@router.get("/{token}")
def resolve_invite(token: str, request: Request, db: Session = Depends(get_db)):
    """Read-only resolution of a token → its room session id + status. Public so
    the interview room (or status checks) can look it up without auth. Does NOT
    transition the lifecycle."""
    _rate_limit(request, limit=60, window=60.0)
    invite = db.query(InterviewInvite).filter(InterviewInvite.token == token).first()
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found")
    return {
        "token": invite.token,
        "status": invite.status.value,
        "candidate_name": invite.candidate_name,
        "role": invite.role,
        "stage": invite.stage,
        "session_id": str(invite.applicant_id) if invite.applicant_id else None,
        "expires_at": invite.expires_at.isoformat() if invite.expires_at else None,
    }


# ---------------------------------------------------------------------------
# Public candidate link — GET /i/{token}
# ---------------------------------------------------------------------------

@public_link_router.get("/i/{token}")
def open_invite(token: str, request: Request, db: Session = Depends(get_db)):
    """Resolve + guard a candidate's unique link, then drop them into their room."""
    _rate_limit(request, limit=30, window=60.0)
    invite = db.query(InterviewInvite).filter(InterviewInvite.token == token).first()
    if not invite:
        return HTMLResponse(
            _invite_error_html(
                "Link not found",
                "This interview link is invalid. Please check the link in your invitation email.",
            ),
            status_code=404,
        )

    rejection = _transition_for_entry(db, invite)
    if rejection:
        code, detail = rejection
        # Offer a self-serve re-request only for expired (not completed) links.
        req_tok = invite.token if invite.status == InviteStatus.expired else None
        return HTMLResponse(_invite_error_html("Link unavailable", detail, request_token=req_tok), status_code=code)

    if not invite.applicant_id:
        return HTMLResponse(
            _invite_error_html(
                "Interview not ready",
                "This interview hasn't been set up yet. Please reach out to your recruiter.",
            ),
            status_code=409,
        )

    # Key the room on the applicant id (the engine session id); carry the token
    # for traceability and future WS-level hardening. `jobId` lets the avatar
    # orchestrator launch THIS job's dedicated Lina build (per-job exe) for an
    # independent, parallel stream — no effect when the orchestrator is unset.
    job_qs = f"&jobId={invite.job_id}" if invite.job_id else ""
    room = (
        f"{settings.INTERVIEW_ROOM_URL.rstrip('/')}/interviewcandidateroom"
        f"?sessionId={invite.applicant_id}&ih_invite={invite.token}{job_qs}"
    )
    return RedirectResponse(room, status_code=302)


@public_link_router.post("/i/{token}/request-new")
def request_new_invite(token: str, request: Request, db: Session = Depends(get_db)):
    """Self-serve: a candidate whose link has expired can request a fresh one,
    emailed to the SAME address. Not available once the interview is completed."""
    _rate_limit(request, limit=5, window=300.0)
    invite = db.query(InterviewInvite).filter(InterviewInvite.token == token).first()
    if not invite:
        return HTMLResponse(
            _invite_error_html("Link not found", "We couldn't find that interview link."),
            status_code=404,
        )
    if invite.status == InviteStatus.completed:
        return HTMLResponse(
            _invite_error_html("Already completed", "This interview has already been completed, so a new link can't be issued."),
            status_code=410,
        )

    try:
        if invite.applicant_id:
            applicant = db.query(Applicant).filter(Applicant.id == invite.applicant_id).first()
            if not applicant:
                raise ValueError("bound applicant no longer exists")
            _provision_invite_for_applicant(db, applicant, stage=invite.stage, send=True)
        else:
            new_invite, link = create_invite(
                db,
                candidate_email=invite.candidate_email,
                candidate_name=invite.candidate_name,
                role=invite.role,
                job_id=invite.job_id,
            )
            send_interview_invite_email(
                new_invite.candidate_name, new_invite.candidate_email, new_invite.role, link, new_invite.expires_at,
                job_description=_invite_job_description(db, new_invite),
            )
    except Exception as e:
        logger.error(f"Failed to re-issue invite for {token}: {e}")
        return HTMLResponse(
            _invite_error_html("Something went wrong", "We couldn't send a new link right now. Please contact your recruiter."),
            status_code=500,
        )

    return HTMLResponse(
        _invite_error_html(
            "New link sent",
            f"We've emailed a fresh interview link to {_mask_email(invite.candidate_email)}. "
            f"Check your inbox (and spam) in a few minutes.",
        ),
        status_code=200,
    )
