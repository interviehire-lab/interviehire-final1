import os
import smtplib
import logging
import base64
import requests
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from app.config import settings

logger = logging.getLogger(__name__)


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

from datetime import datetime

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
    
    html = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <title>Interview Scheduling Invitation</title>
        <style>
            body {{
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background-color: #0b0f19;
                color: #f3f4f6;
                margin: 0;
                padding: 40px 0;
            }}
            .card {{
                max-width: 600px;
                margin: 0 auto;
                background: linear-gradient(135deg, rgba(15, 23, 42, 0.9) 0%, rgba(30, 41, 59, 0.8) 100%);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 16px;
                padding: 40px;
                box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6);
            }}
            h2 {{
                color: #fbbf24;
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                padding-bottom: 15px;
                margin-top: 0;
                font-size: 24px;
            }}
            p {{
                line-height: 1.6;
                font-size: 15px;
            }}
            .time-box {{
                background: rgba(251, 191, 36, 0.05);
                border-left: 4px solid #fbbf24;
                padding: 20px;
                margin: 25px 0;
                border-radius: 0 12px 12px 0;
            }}
            .time-label {{
                font-size: 12px;
                text-transform: uppercase;
                letter-spacing: 0.05em;
                color: #94a3b8;
                margin-bottom: 5px;
            }}
            .time-value {{
                font-size: 18px;
                font-weight: bold;
                color: #f3f4f6;
            }}
            .btn-group {{
                margin: 30px 0;
                text-align: center;
            }}
            .btn {{
                display: inline-block;
                background-color: #fbbf24;
                color: #0f172a;
                text-decoration: none;
                padding: 12px 24px;
                font-weight: bold;
                border-radius: 8px;
                margin: 10px;
                text-align: center;
                transition: all 0.2s ease;
            }}
            .btn:hover {{
                background-color: #fcd34d;
                transform: translateY(-2px);
            }}
            .btn-secondary {{
                background-color: rgba(255, 255, 255, 0.05);
                color: #f3f4f6;
                border: 1px solid rgba(255, 255, 255, 0.1);
            }}
            .btn-secondary:hover {{
                background-color: rgba(255, 255, 255, 0.1);
            }}
            .footer {{
                font-size: 12px;
                color: #64748b;
                margin-top: 40px;
                border-top: 1px solid rgba(255, 255, 255, 0.1);
                padding-top: 20px;
            }}
        </style>
    </head>
    <body>
        <div class="card">
            <h2>Schedule your {stage_name}</h2>
            <p>Dear {candidate_name},</p>
            <p>Congratulations! Your profile has been advanced to the <strong>{stage_name}</strong> round for the <strong>{job_title}</strong> position.</p>
            <p>We have proposed the following interview slot for you:</p>
            
            <div class="time-box">
                <div class="time-label">Proposed Date & Time</div>
                <div class="time-value">{time_str}</div>
            </div>
            
            <p>Please click one of the options below to confirm this slot or select a different time that works for you:</p>
            
            <div class="btn-group">
                <a href="{confirm_link}" class="btn">Confirm Proposed Slot</a>
                <a href="{reschedule_link}" class="btn btn-secondary">Reschedule Slot</a>
            </div>
            
            <div class="footer">
                <p>This is an automated message from the IntervieHire Recruitment Platform.</p>
            </div>
        </div>
    </body>
    </html>
    """
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
    
    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <title>Interview Confirmed</title>
        <style>
            body {{
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background-color: #0b0f19;
                color: #f3f4f6;
                margin: 0;
                padding: 40px 0;
            }}
            .card {{
                max-width: 600px;
                margin: 0 auto;
                background: linear-gradient(135deg, rgba(15, 23, 42, 0.9) 0%, rgba(30, 41, 59, 0.8) 100%);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 16px;
                padding: 40px;
                box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6);
            }}
            h2 {{
                color: #38bdf8;
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                padding-bottom: 15px;
                margin-top: 0;
                font-size: 24px;
            }}
            p {{
                line-height: 1.6;
                font-size: 15px;
            }}
            .time-box {{
                background: rgba(56, 189, 248, 0.05);
                border-left: 4px solid #38bdf8;
                padding: 20px;
                margin: 25px 0;
                border-radius: 0 12px 12px 0;
            }}
            .time-label {{
                font-size: 12px;
                text-transform: uppercase;
                letter-spacing: 0.05em;
                color: #94a3b8;
                margin-bottom: 5px;
            }}
            .time-value {{
                font-size: 18px;
                font-weight: bold;
                color: #f3f4f6;
            }}
            .btn-group {{
                margin: 30px 0;
                text-align: center;
            }}
            .btn {{
                display: inline-block;
                background-color: #38bdf8;
                color: #0f172a;
                text-decoration: none;
                padding: 12px 30px;
                font-weight: bold;
                border-radius: 8px;
                margin: 10px;
                text-align: center;
                transition: all 0.2s ease;
            }}
            .btn:hover {{
                background-color: #7dd3fc;
                transform: translateY(-2px);
            }}
            .btn-secondary {{
                background-color: rgba(255, 255, 255, 0.05);
                color: #f3f4f6;
                border: 1px solid rgba(255, 255, 255, 0.1);
            }}
            .btn-secondary:hover {{
                background-color: rgba(255, 255, 255, 0.1);
            }}
            .footer {{
                font-size: 12px;
                color: #64748b;
                margin-top: 40px;
                border-top: 1px solid rgba(255, 255, 255, 0.1);
                padding-top: 20px;
            }}
        </style>
    </head>
    <body>
        <div class="card">
            <h2>{stage_name} Confirmed</h2>
            <p>Dear {candidate_name},</p>
            <p>Your <strong>{stage_name}</strong> for the <strong>{job_title}</strong> role has been confirmed and scheduled on your calendar. Details are listed below:</p>
            
            <div class="time-box">
                <div class="time-label">Interview Date & Time</div>
                <div class="time-value">{time_str}</div>
            </div>
            
            <p>To join the interactive interview at the scheduled time, please use the button below:</p>
            
            <div class="btn-group">
                <a href="{interview_link}" class="btn">Enter Interview Room</a>
                <a href="{reschedule_link}" class="btn btn-secondary">Reschedule Interview</a>
            </div>

            <p>If you need to check details directly in your calendar, an interactive invitation has been attached to this email.</p>

            <div class="footer">
                <p>This is an automated message from the IntervieHire AI Recruitment Platform.</p>
            </div>
        </div>
    </body>
    </html>
    """

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
    """Reminder email sent ~REMINDER_MINUTES_BEFORE the scheduled interview start
    (see `app/jobs/reminders.py`). Reuses the dark-theme card styling from
    `send_ical_invitation_email` for visual consistency. No `.ics` attachment —
    that was already sent at confirmation time. Routes through `send_html_email`
    (Resend/SMTP-blocked-on-Railway), same as every other transactional email here."""
    subject = f"Starting soon: {stage_name} in 30 minutes"
    from app.utils.timezones import to_ist
    time_str = to_ist(start_time).strftime("%B %d, %Y at %I:%M %p IST")

    html = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <title>Interview Starting Soon</title>
        <style>
            body {{
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background-color: #0b0f19;
                color: #f3f4f6;
                margin: 0;
                padding: 40px 0;
            }}
            .card {{
                max-width: 600px;
                margin: 0 auto;
                background: linear-gradient(135deg, rgba(15, 23, 42, 0.9) 0%, rgba(30, 41, 59, 0.8) 100%);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 16px;
                padding: 40px;
                box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6);
            }}
            h2 {{
                color: #38bdf8;
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                padding-bottom: 15px;
                margin-top: 0;
                font-size: 24px;
            }}
            p {{
                line-height: 1.6;
                font-size: 15px;
            }}
            .time-box {{
                background: rgba(56, 189, 248, 0.05);
                border-left: 4px solid #38bdf8;
                padding: 20px;
                margin: 25px 0;
                border-radius: 0 12px 12px 0;
            }}
            .time-label {{
                font-size: 12px;
                text-transform: uppercase;
                letter-spacing: 0.05em;
                color: #94a3b8;
                margin-bottom: 5px;
            }}
            .time-value {{
                font-size: 18px;
                font-weight: bold;
                color: #f3f4f6;
            }}
            .btn-group {{
                margin: 30px 0;
                text-align: center;
            }}
            .btn {{
                display: inline-block;
                background-color: #38bdf8;
                color: #0f172a;
                text-decoration: none;
                padding: 12px 30px;
                font-weight: bold;
                border-radius: 8px;
                margin: 10px;
                text-align: center;
                transition: all 0.2s ease;
            }}
            .btn:hover {{
                background-color: #7dd3fc;
                transform: translateY(-2px);
            }}
            .footer {{
                font-size: 12px;
                color: #64748b;
                margin-top: 40px;
                border-top: 1px solid rgba(255, 255, 255, 0.1);
                padding-top: 20px;
            }}
        </style>
    </head>
    <body>
        <div class="card">
            <h2>Your {stage_name} starts soon</h2>
            <p>Dear {candidate_name},</p>
            <p>This is a reminder that your <strong>{stage_name}</strong> for the <strong>{job_title}</strong> role is starting soon.</p>

            <div class="time-box">
                <div class="time-label">Interview Date & Time</div>
                <div class="time-value">{time_str}</div>
            </div>

            <p>Please join a few minutes early to make sure your camera and microphone are working.</p>

            <div class="btn-group">
                <a href="{interview_link}" class="btn">Join Interview</a>
            </div>

            <div class="footer">
                <p>This is an automated message from the IntervieHire AI Recruitment Platform.</p>
            </div>
        </div>
    </body>
    </html>
    """
    return send_html_email(candidate_email, subject, html)


def send_reschedule_confirmation_email(candidate_name: str, candidate_email: str, job_title: str, stage_name: str, new_time_str: str) -> bool:
    # Deprecated/Fallback: Redirecting reschedules directly through multi-part RFC invites above
    subject = f"Confirmed: Your {stage_name} has been rescheduled"
    html = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <title>Interview Reschedule Confirmation</title>
        <style>
            body {{ font-family: Arial, sans-serif; background-color: #0d0d0d; color: #e0e0e0; margin: 0; padding: 40px 0; }}
            .card {{ max-width: 600px; margin: 0 auto; background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 12px; padding: 30px; }}
            h2 {{ color: #22c55e; border-bottom: 1px solid rgba(255, 255, 255, 0.1); padding-bottom: 10px; margin-top: 0; }}
            p {{ line-height: 1.6; font-size: 15px; }}
            .time-box {{ background: rgba(255, 255, 255, 0.05); border-left: 4px solid #22c55e; padding: 15px; margin: 20px 0; border-radius: 0 6px 6px 0; font-size: 16px; font-weight: bold; }}
            .footer {{ font-size: 12px; color: #888888; margin-top: 30px; border-top: 1px solid rgba(255, 255, 255, 0.1); padding-top: 15px; }}
        </style>
    </head>
    <body>
        <div class="card">
            <h2>Interview Confirmed</h2>
            <p>Dear {candidate_name},</p>
            <p>Your <strong>{stage_name}</strong> for the <strong>{job_title}</strong> position has been scheduled. Details are below:</p>
            <div class="time-box">
                Interview Time: {new_time_str}
            </div>
            <p>A calendar invitation has also been sent to your email. We look forward to speaking with you.</p>
            <div class="footer">
                <p>This is an automated message from IntervieHire Recruitment Platform.</p>
            </div>
        </div>
    </body>
    </html>
    """
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
    Plain-text + HTML alternative, brand styling (Poppins, coral CTA #F5542E,
    ink #17171F). Transport selection and the SMTP-less simulation fallback are
    handled by ``send_html_email``.
    """
    from html import escape as _esc

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

    html = f"""<!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Your interview invitation</title>
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap');
            body {{ font-family: 'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:#f4f4f6; color:#17171F; margin:0; padding:40px 0; }}
            .card {{ max-width:560px; margin:0 auto; background:#ffffff; border:1px solid #ECECF1; border-radius:18px; padding:44px 40px; box-shadow:0 8px 30px rgba(23,23,31,0.06); }}
            h1 {{ font-size:22px; font-weight:700; color:#17171F; margin:0 0 18px; }}
            p {{ font-size:15px; line-height:1.65; color:#3A3A45; margin:0 0 16px; }}
            .role {{ font-weight:600; color:#17171F; }}
            .cta {{ text-align:center; margin:32px 0 18px; }}
            .btn {{ display:inline-block; background:#F5542E; color:#ffffff !important; text-decoration:none; font-weight:600; font-size:15px; padding:14px 34px; border-radius:10px; }}
            .link {{ font-size:13px; color:#6B6B76; word-break:break-all; margin-top:0; }}
            .meta {{ font-size:13px; color:#6B6B76; }}
            .footer {{ font-size:12px; color:#9A9AA5; margin-top:36px; border-top:1px solid #ECECF1; padding-top:20px; text-align:center; }}
        </style>
    </head>
    <body>
        <div class="card">
            <h1>You're invited to your interview</h1>
            <p>Hi {greeting_name},</p>
            <p>You've been invited to an AI-led interview for <span class="role">{role_label}</span> with IntervieHire.</p>
            <div class="cta">
                <a href="{interview_link}" class="btn">Start your interview</a>
            </div>
            <p class="link">{interview_link}</p>
            {expiry_html}
            <p class="meta">Before you begin: find a quiet spot and make sure your <strong>camera and microphone</strong> are on.</p>
            <div class="footer">This invitation was sent by IntervieHire. If you weren't expecting it, you can safely ignore this email.</div>
        </div>
    </body>
    </html>
    """

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
    from html import escape as _esc

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

    html = f"""<!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>You're invited to IntervieHire</title>
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap');
            body {{ font-family: 'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:#f4f4f6; color:#17171F; margin:0; padding:40px 0; }}
            .card {{ max-width:560px; margin:0 auto; background:#ffffff; border:1px solid #ECECF1; border-radius:18px; padding:44px 40px; box-shadow:0 8px 30px rgba(23,23,31,0.06); }}
            h1 {{ font-size:22px; font-weight:700; color:#17171F; margin:0 0 18px; }}
            p {{ font-size:15px; line-height:1.65; color:#3A3A45; margin:0 0 16px; }}
            .role {{ font-weight:600; color:#17171F; }}
            .cta {{ text-align:center; margin:32px 0 18px; }}
            .btn {{ display:inline-block; background:#F5542E; color:#ffffff !important; text-decoration:none; font-weight:600; font-size:15px; padding:14px 34px; border-radius:10px; }}
            .link {{ font-size:13px; color:#6B6B76; word-break:break-all; margin-top:0; }}
            .meta {{ font-size:13px; color:#6B6B76; }}
            .footer {{ font-size:12px; color:#9A9AA5; margin-top:36px; border-top:1px solid #ECECF1; padding-top:20px; text-align:center; }}
        </style>
    </head>
    <body>
        <div class="card">
            <h1>You're invited to join {org_label}</h1>
            <p>Hi {greeting_name},</p>
            <p>{inviter_label} has invited you to join <span class="role">{org_label}</span> on IntervieHire as <span class="role">{role_label}</span>.</p>
            <div class="cta">
                <a href="{accept_link}" class="btn">Accept invitation</a>
            </div>
            <p class="link">{accept_link}</p>
            <p class="meta">Use <strong>{_esc(invitee_email)}</strong> when you sign up so your invitation is recognised, and choose a password to finish.</p>
            <div class="footer">This invitation was sent by IntervieHire. If you weren't expecting it, you can safely ignore this email.</div>
        </div>
    </body>
    </html>
    """

    return send_html_email(
        invitee_email,
        subject,
        html,
        from_email=settings.INVITE_FROM_EMAIL,
        plain_content=plain_content,
    )

