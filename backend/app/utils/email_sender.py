import os
import smtplib
import logging
import base64
import requests
from datetime import datetime
from html import escape as _esc
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from app.config import settings

logger = logging.getLogger(__name__)

# ────────────────────────────────────────────────────────────────────────
# Shared branded shell for every transactional email below.
#
# Brand colors/font are pulled from the actual product, not invented for
# email: teal #2dd4bf + indigo #64a0dc (dashboard/src/styles/dashboard/
# 01-tokens.css's --color-gold/--color-indigo) and 'Outfit' display font
# (var(--font-display)), same wordmark split as the sidebar's .logo-text/
# .logo-highlight (dashboard/src/styles/dashboard/03-sidebar.css) and the
# same up-right arrow glyph as the landing page's <Logo> component
# (dashboard/src/landing/ui/Logo.jsx). Two solid-colored spans rather than
# a CSS gradient-clip wordmark — gradients on backgrounds (the CTA button)
# render fine across clients, but gradient *text* silently breaks in
# Outlook desktop, so the wordmark itself stays two plain colors.
# ────────────────────────────────────────────────────────────────────────
_BRAND_TEAL = "#2dd4bf"
_BRAND_INDIGO = "#64a0dc"
_BRAND_INK = "#17171F"


def _email_shell(preheader: str, body_html: str) -> str:
    """Wrap template-specific body HTML in the shared wordmark-header /
    card / footer shell so every email in this file shares one visual
    identity instead of each function inlining its own (previously
    inconsistent) styling. `preheader` is the hidden preview text most
    inboxes show next to the subject line."""
    return f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>IntervieHire</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&display=swap');
  body {{ margin:0; padding:32px 16px; background:#F0F1F4; font-family:'Outfit',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; }}
  .preheader {{ display:none !important; visibility:hidden; max-height:0; max-width:0; opacity:0; overflow:hidden; mso-hide:all; }}
  .wrap {{ max-width:560px; margin:0 auto; }}
  .card {{ background:#ffffff; border:1px solid #ECECF1; border-radius:20px; overflow:hidden; box-shadow:0 12px 40px rgba(23,23,31,0.07); }}
  .brand-header {{ padding:26px 40px; border-bottom:1px solid #F0F0F3; }}
  .brand-mark {{ font-size:20px; font-weight:800; letter-spacing:-0.02em; text-decoration:none; }}
  .brand-ink {{ color:{_BRAND_INK}; }}
  .brand-accent {{ color:{_BRAND_TEAL}; }}
  .brand-body {{ padding:40px; }}
  h1 {{ font-size:21px; font-weight:700; color:{_BRAND_INK}; margin:0 0 16px; letter-spacing:-0.01em; }}
  p {{ font-size:15px; line-height:1.65; color:#3A3A45; margin:0 0 16px; }}
  strong {{ color:{_BRAND_INK}; }}
  .detail-box {{ background:linear-gradient(135deg, rgba(45,212,191,0.08), rgba(100,160,220,0.08)); border-left:3px solid {_BRAND_TEAL}; border-radius:0 12px 12px 0; padding:18px 22px; margin:24px 0; }}
  .detail-label {{ font-size:11px; text-transform:uppercase; letter-spacing:0.08em; color:#8A8A96; margin-bottom:4px; font-weight:600; }}
  .detail-value {{ font-size:17px; font-weight:700; color:{_BRAND_INK}; }}
  .cta {{ text-align:center; margin:30px 0 6px; }}
  .btn {{ display:inline-block; background-color:{_BRAND_TEAL}; background-image:linear-gradient(135deg,{_BRAND_TEAL},{_BRAND_INDIGO}); color:#ffffff !important; text-decoration:none; font-weight:600; font-size:15px; padding:14px 34px; border-radius:10px; margin:6px; }}
  .btn-secondary {{ display:inline-block; background:#ffffff; color:#3A3A45 !important; text-decoration:none; font-weight:600; font-size:15px; padding:12.5px 32px; border-radius:10px; margin:6px; border:1.5px solid #E2E2E8; }}
  .link {{ font-size:13px; color:#8A8A96; word-break:break-all; margin-top:0; }}
  .meta {{ font-size:13px; color:#8A8A96; }}
  .brand-footer {{ background:#FAFAFB; padding:22px 40px; text-align:center; border-top:1px solid #F0F0F3; }}
  .brand-footer p {{ font-size:12px; color:#9A9AA5; margin:0; line-height:1.6; }}
</style>
</head>
<body>
  <span class="preheader">{_esc(preheader)}</span>
  <div class="wrap">
    <div class="card">
      <div class="brand-header">
        <span class="brand-mark"><span class="brand-ink">Intervie</span><span class="brand-accent">Hire</span></span>
      </div>
      <div class="brand-body">
        {body_html}
      </div>
      <div class="brand-footer">
        <p>Sent by IntervieHire — AI-driven interviews, evaluated against your rubric.<br>If you weren't expecting this email, you can safely ignore it.</p>
      </div>
    </div>
  </div>
</body>
</html>"""


def _smtp_blocked() -> bool:
    """Railway (and similar PaaS) block outbound SMTP: `smtplib.SMTP()` to
    gmail:587 fails with "[Errno 101] Network is unreachable" and, with no
    timeout, can stall the whole request (e.g. POST /schedule hangs on the
    invite send). When running on Railway we skip the direct SMTP send entirely
    — interview invites are delivered by Google Calendar (sendUpdates='all').
    """
    return bool(os.getenv("RAILWAY_ENVIRONMENT") or os.getenv("RAILWAY_ENVIRONMENT_NAME"))

def send_email_via_resend(to_email: str, subject: str, html_content: str, attachment_content: str | None = None, attachment_name: str | None = None, from_override: str | None = None) -> bool:
    if not settings.RESEND_API_KEY:
        raise RuntimeError("Resend API Key is not configured.")

    # Resend can only send "from" an address on a domain verified in the Resend
    # dashboard; anything else (incl. an unverified custom domain, or a personal
    # gmail.com address) is rejected with a 403 validation_error at send time.
    # Fall back to Resend's always-verified sandbox address when SMTP_FROM isn't
    # configured to a real, verified sender.
    from_email = settings.SMTP_FROM or "onboarding@resend.dev"

    headers = {
        "Authorization": f"Bearer {settings.RESEND_API_KEY}",
        "Content-Type": "application/json"
    }

    payload = {
        "from": from_override or from_email,
        "to": [to_email],
        "subject": subject,
        "html": html_content
    }

    if attachment_content and attachment_name:
        encoded_content = base64.b64encode(attachment_content.encode('utf-8')).decode('utf-8')
        payload["attachments"] = [
            {
                "content": encoded_content,
                "filename": attachment_name
            }
        ]

    try:
        response = requests.post("https://api.resend.com/emails", json=payload, headers=headers)
        if response.status_code in [200, 201]:
            logger.info(f"Email sent successfully via Resend API to {to_email}")
            return True
        else:
            logger.error(f"Failed to send email via Resend API: {response.text}")
            raise RuntimeError(f"Resend API error: {response.text}")
    except Exception as e:
        logger.error(f"Error sending email via Resend to {to_email}: {e}")
        raise e

def send_html_email(to_email: str, subject: str, html_content: str, from_email: str | None = None, plain_content: str | None = None) -> bool:
    if settings.RESEND_API_KEY:
        return send_email_via_resend(to_email, subject, html_content, from_override=from_email)

    sender = from_email or settings.SMTP_FROM or "hr@interviehire.com"

    if not settings.SMTP_USERNAME or not settings.SMTP_PASSWORD:
        logger.warning(f"SMTP credentials not configured. Email to {to_email} will run in SIMULATION mode.")
        body_preview = f"\nBody:\n{plain_content}" if plain_content else ""
        print(f"\n==================== [SIMULATION EMAIL] ====================\nFrom: {sender}\nTo: {to_email}\nSubject: {subject}{body_preview}\n============================================================\n")
        return True

    msg = MIMEMultipart('alternative')
    msg['Subject'] = subject
    msg['From'] = sender
    msg['To'] = to_email

    # text/plain first so the HTML part is the preferred alternative (RFC 2046).
    if plain_content:
        msg.attach(MIMEText(plain_content, 'plain'))
    msg.attach(MIMEText(html_content, 'html'))

    if _smtp_blocked():
        logger.info(f"SMTP blocked on this host (Railway) — skipping direct send to {to_email} (invite is delivered via Google Calendar).")
        return True
    try:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as server:
            server.starttls()
            server.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
            server.sendmail(sender, to_email, msg.as_string())
        logger.info(f"Email sent successfully to {to_email}")
        return True
    except Exception as e:
        logger.error(f"Error sending email to {to_email}: {e}")
        logger.info(f"[FALLBACK SIMULATION EMAIL] To: {to_email}\nSubject: {subject}\nContent:\n{html_content}\n")
        return True

def send_stage_invitation_email(
    candidate_name: str,
    candidate_email: str,
    job_title: str,
    stage_name: str,
    proposed_time: datetime,
    confirm_link: str,
    reschedule_link: str
) -> bool:
    if not settings.SMTP_USERNAME or not settings.SMTP_PASSWORD:
        box = f"""
#################################################################
# [SIMULATION EMAIL INVITATION]
# Candidate: {candidate_name} ({candidate_email})
# Stage: {stage_name} for {job_title}
# Proposed Time: {proposed_time.strftime('%B %d, %Y at %I:%M %p UTC')}
#
# Confirm Link:
# {confirm_link}
#
# Reschedule Link:
# {reschedule_link}
#################################################################
"""
        print(box)

    subject = f"Action Required: Confirm or Reschedule your {stage_name} for {job_title}"
    time_str = proposed_time.strftime("%B %d, %Y at %I:%M %p UTC")

    body = f"""
        <h1>Schedule your {_esc(stage_name)}</h1>
        <p>Dear {_esc(candidate_name)},</p>
        <p>Congratulations! Your profile has been advanced to the <strong>{_esc(stage_name)}</strong> round for the <strong>{_esc(job_title)}</strong> position.</p>
        <p>We have proposed the following interview slot for you:</p>
        <div class="detail-box">
            <div class="detail-label">Proposed date &amp; time</div>
            <div class="detail-value">{_esc(time_str)}</div>
        </div>
        <p>Please choose one of the options below to confirm this slot or select a different time that works for you:</p>
        <div class="cta">
            <a href="{confirm_link}" class="btn">Confirm proposed slot</a>
            <a href="{reschedule_link}" class="btn-secondary">Reschedule slot</a>
        </div>
    """
    html = _email_shell(f"Confirm or reschedule your {stage_name} for {job_title}", body)
    return send_html_email(candidate_email, subject, html)

def send_ical_invitation_email(
    candidate_name: str,
    candidate_email: str,
    job_title: str,
    stage_name: str,
    start_time: datetime,
    duration_minutes: int,
    uid: str,
    sequence: int,
    organizer_email: str,
    reschedule_link: str,
    interview_link: str,
    organizer_name: str = "IntervieHire Host"
) -> bool:
    subject = f"Confirmed: {stage_name} Scheduled - {job_title}"
    from app.utils.timezones import to_ist
    time_str = to_ist(start_time).strftime("%B %d, %Y at %I:%M %p IST")
    
    ical_body = f"""
        <h1>{_esc(stage_name)} confirmed</h1>
        <p>Dear {_esc(candidate_name)},</p>
        <p>Your <strong>{_esc(stage_name)}</strong> for the <strong>{_esc(job_title)}</strong> role has been confirmed and scheduled on your calendar. Details are below:</p>
        <div class="detail-box">
            <div class="detail-label">Interview date &amp; time</div>
            <div class="detail-value">{_esc(time_str)}</div>
        </div>
        <p>To join the interactive interview at the scheduled time, use the button below:</p>
        <div class="cta">
            <a href="{interview_link}" class="btn">Enter interview room</a>
            <a href="{reschedule_link}" class="btn-secondary">Reschedule interview</a>
        </div>
        <p class="meta">A calendar invitation is attached to this email if you'd rather check the details there.</p>
    """
    html_content = _email_shell(f"Your {stage_name} for {job_title} is confirmed", ical_body)

    from datetime import timedelta
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText
    import smtplib

    end_time = start_time + timedelta(minutes=duration_minutes)
    
    def format_ical_date(dt: datetime) -> str:
        return dt.strftime("%Y%m%dT%H%M%SZ")

    dtstamp = format_ical_date(datetime.utcnow())
    dtstart = format_ical_date(start_time)
    dtend = format_ical_date(end_time)

    # iCalendar body (RFC 5545 formatted, using CRLF lines)
    ical_lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//IntervieHire//NONSGML Interview Platform//EN",
        "METHOD:REQUEST",
        "BEGIN:VEVENT",
        f"UID:{uid}",
        f"SEQUENCE:{sequence}",
        "STATUS:CONFIRMED",
        f"DTSTAMP:{dtstamp}",
        f"DTSTART:{dtstart}",
        f"DTEND:{dtend}",
        f"SUMMARY:{stage_name} - {candidate_name} ({job_title})",
        f"DESCRIPTION:Join your interactive AI interview session directly at: {interview_link}",
        f"LOCATION:{interview_link}",
        f"ORGANIZER;CN=\"{organizer_name}\":mailto:{organizer_email}",
        f"ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=\"{candidate_name}\":mailto:{candidate_email}",
        "END:VEVENT",
        "END:VCALENDAR"
    ]
    ical_string = "\r\n".join(ical_lines)

    if settings.RESEND_API_KEY:
        return send_email_via_resend(
            candidate_email,
            subject,
            html_content,
            attachment_content=ical_string,
            attachment_name="invite.ics"
        )

    if not settings.SMTP_USERNAME or not settings.SMTP_PASSWORD:
        box = f"""
#################################################################
# [SIMULATION iCAL CONFIRMATION]
# Candidate: {candidate_name} ({candidate_email})
# Stage: {stage_name} for {job_title}
# Start Time: {start_time.strftime('%B %d, %Y at %I:%M %p UTC')}
#
# Interview Link:
# {interview_link}
#
# Reschedule Link:
# {reschedule_link}
#################################################################
"""
        print(box)
        logger.warning(f"SMTP credentials not configured. iCalendar Email to {candidate_email} will run in SIMULATION mode.")
        print(f"\n==================== [SIMULATION iCAL EMAIL] ====================\nTo: {candidate_email}\nSubject: {subject}\n=================================================================\n")
        return True

    msg = MIMEMultipart('alternative')
    msg['Subject'] = subject
    from_email = settings.SMTP_FROM or "hr@interviehire.com"
    msg['From'] = f"{organizer_name} <{from_email}>"
    msg['To'] = candidate_email

    # Plain text alternative
    plain_text = f"Confirmed: {stage_name} for {job_title} on {time_str}.\nJoin using: {interview_link}\nReschedule using: {reschedule_link}"
    msg.attach(MIMEText(plain_text, 'plain'))
    
    # HTML alternative
    msg.attach(MIMEText(html_content, 'html'))

    # Calendar attachment
    part_cal = MIMEText(ical_string, 'calendar; method=REQUEST')
    part_cal.set_param('method', 'REQUEST')
    part_cal.set_param('name', 'invite.ics')
    part_cal.add_header('Content-Class', 'urn:content-classes:calendarmessage')
    msg.attach(part_cal)

    if _smtp_blocked():
        logger.info(f"SMTP blocked on this host (Railway) — skipping iCal email to {candidate_email} (invite is delivered via Google Calendar).")
        return True
    try:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as server:
            server.starttls()
            server.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
            server.sendmail(settings.SMTP_FROM or "hr@interviehire.com", candidate_email, msg.as_string())
        logger.info(f"iCalendar Email sent successfully to {candidate_email}")
        return True
    except Exception as e:
        logger.error(f"Error sending iCalendar email to {candidate_email}: {e}")
        return False

def send_interview_reminder_email(
    candidate_name: str,
    candidate_email: str,
    job_title: str,
    stage_name: str,
    start_time: datetime,
    interview_link: str,
) -> bool:
    """Reminder email sent ~REMINDER_MINUTES_BEFORE the scheduled interview
    start (see `app/jobs/reminders.py`). No `.ics` attachment — that was
    already sent at confirmation time. Routes through `send_html_email`
    (Resend/SMTP-blocked-on-Railway), same as every other transactional
    email in this file."""
    subject = f"Starting soon: {stage_name} in 30 minutes"
    from app.utils.timezones import to_ist
    time_str = to_ist(start_time).strftime("%B %d, %Y at %I:%M %p IST")

    body = f"""
        <h1>Your {_esc(stage_name)} starts soon</h1>
        <p>Dear {_esc(candidate_name)},</p>
        <p>This is a reminder that your <strong>{_esc(stage_name)}</strong> for the <strong>{_esc(job_title)}</strong> role is starting soon.</p>
        <div class="detail-box">
            <div class="detail-label">Interview date &amp; time</div>
            <div class="detail-value">{_esc(time_str)}</div>
        </div>
        <p>Please join a few minutes early to make sure your camera and microphone are working.</p>
        <div class="cta">
            <a href="{interview_link}" class="btn">Join interview</a>
        </div>
    """
    html = _email_shell(f"Your {stage_name} for {job_title} starts soon", body)
    return send_html_email(candidate_email, subject, html)


def send_reschedule_confirmation_email(candidate_name: str, candidate_email: str, job_title: str, stage_name: str, new_time_str: str) -> bool:
    # Deprecated/Fallback: Redirecting reschedules directly through multi-part RFC invites above
    subject = f"Confirmed: Your {stage_name} has been rescheduled"
    body = f"""
        <h1>Interview confirmed</h1>
        <p>Dear {_esc(candidate_name)},</p>
        <p>Your <strong>{_esc(stage_name)}</strong> for the <strong>{_esc(job_title)}</strong> position has been scheduled. Details are below:</p>
        <div class="detail-box">
            <div class="detail-label">Interview time</div>
            <div class="detail-value">{_esc(new_time_str)}</div>
        </div>
        <p>A calendar invitation has also been sent to your email. We look forward to speaking with you.</p>
    """
    html = _email_shell(f"Your {stage_name} for {job_title} has been rescheduled", body)
    return send_html_email(candidate_email, subject, html)


def send_interview_invite_email(
    candidate_name: str,
    candidate_email: str,
    role: str | None,
    interview_link: str,
    expires_at: datetime | None = None,
) -> bool:
    """Transactional per-candidate interview invite carrying the unique link.

    Sent from the dedicated ``INVITE_FROM_EMAIL`` sender (isolated from the
    recruiting/cold-email From so it never touches that reputation pool).
    Plain-text + HTML alternative, via the shared ``_email_shell`` brand
    styling. Transport selection and the SMTP-less simulation fallback are
    handled by ``send_html_email``.
    """
    greeting_name = _esc(candidate_name) if candidate_name else "there"
    role_label = _esc(role) if role else "the role"
    expiry_str = expires_at.strftime("%B %d, %Y") if expires_at else None
    subject = f"Your interview invitation — {role}" if role else "Your interview invitation"

    # Plain-text alternative (kept in sync with the HTML below).
    plain_lines = [
        f"Hi {candidate_name or 'there'},",
        "",
        f"You've been invited to an AI-led interview for {role or 'the role'} with IntervieHire.",
        "",
        f"Your private interview link: {interview_link}",
    ]
    if expiry_str:
        plain_lines.append(f"This link is unique to you and expires on {expiry_str}.")
    else:
        plain_lines.append("This link is unique to you — please don't share it.")
    plain_lines += [
        "",
        "Before you begin: find a quiet spot and make sure your camera and microphone are on.",
        "",
        "— The IntervieHire Team",
    ]
    plain_content = "\n".join(plain_lines)

    expiry_html = (
        f'<p class="meta">This link is unique to you and expires on <strong>{expiry_str}</strong>.</p>'
        if expiry_str
        else '<p class="meta">This link is unique to you — please don\'t share it.</p>'
    )

    body = f"""
        <h1>You're invited to your interview</h1>
        <p>Hi {greeting_name},</p>
        <p>You've been invited to an AI-led interview for <strong>{role_label}</strong> with IntervieHire.</p>
        <div class="cta">
            <a href="{interview_link}" class="btn">Start your interview</a>
        </div>
        <p class="link">{interview_link}</p>
        {expiry_html}
        <p class="meta">Before you begin: find a quiet spot and make sure your <strong>camera and microphone</strong> are on.</p>
    """
    html = _email_shell(f"Your interview invitation for {role or 'your application'}", body)

    return send_html_email(
        candidate_email,
        subject,
        html,
        from_email=settings.INVITE_FROM_EMAIL,
        plain_content=plain_content,
    )


def send_team_invite_email(
    invitee_name: str,
    invitee_email: str,
    org_name: str | None,
    inviter_name: str | None,
    role: str | None,
    accept_link: str,
) -> bool:
    """Team-member invitation: invites a colleague to join an organisation on
    IntervieHire. The link points at the signup page (email prefilled); the
    invitee sets a password there and `POST /api/auth/signup` activates their
    already-provisioned account (status invited -> active) into the org with the
    role assigned at invite time. Transport + SMTP-less simulation are handled by
    ``send_html_email`` (Resend when configured; Railway blocks direct SMTP)."""
    greeting_name = _esc(invitee_name) if invitee_name else "there"
    org_label = _esc(org_name) if org_name else "the team"
    inviter_label = _esc(inviter_name) if inviter_name else "A teammate"
    role_label = _esc(role) if role else "team member"
    subject = f"You've been invited to join {org_name} on IntervieHire" if org_name else "You've been invited to IntervieHire"

    plain_content = "\n".join([
        f"Hi {invitee_name or 'there'},",
        "",
        f"{inviter_name or 'A teammate'} has invited you to join {org_name or 'the team'} on IntervieHire as {role or 'a team member'}.",
        "",
        f"Accept your invitation and set your password: {accept_link}",
        "",
        "Use this email address when you sign up so your invitation is recognised.",
        "",
        "— The IntervieHire Team",
    ])

    body = f"""
        <h1>You're invited to join {org_label}</h1>
        <p>Hi {greeting_name},</p>
        <p>{inviter_label} has invited you to join <strong>{org_label}</strong> on IntervieHire as <strong>{role_label}</strong>.</p>
        <div class="cta">
            <a href="{accept_link}" class="btn">Accept invitation</a>
        </div>
        <p class="link">{accept_link}</p>
        <p class="meta">Use <strong>{_esc(invitee_email)}</strong> when you sign up so your invitation is recognised, and choose a password to finish.</p>
    """
    html = _email_shell(f"{inviter_label} invited you to join {org_label} on IntervieHire", body)

    return send_html_email(
        invitee_email,
        subject,
        html,
        from_email=settings.INVITE_FROM_EMAIL,
        plain_content=plain_content,
    )

