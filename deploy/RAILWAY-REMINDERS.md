# Railway reminder cron

Create a **separate Railway service** from this repository named
`backend-reminders`. It intentionally starts, sends due reminders, and exits;
do not add a cron schedule to the always-on backend API service.

Configure the service as follows:

- Root directory: `/backend`
- Dockerfile: `/backend/Dockerfile`
- Build variable: `RUNTIME_TARGET=reminders`
- Cron schedule: `*/5 * * * *` (Railway schedules use UTC; every-five-minutes is
  timezone-independent and is Railway's minimum interval)
- Restart policy: Never
- No healthcheck

Give this cron service the same `DATABASE_URL`, email, Twilio, reminder, and URL
variables as the backend API. `INTERNAL_SERVICE_SECRET` is required by the HTTP
endpoint but the direct cron runner does not transmit it.

The canonical WhatsApp Content templates are:

## Confirmation template

`Hi {{1}}, your {{2}} interview for {{3}} at {{4}} is confirmed for {{5}} at {{6}}. Join here: {{7}}. Need to change the time? {{8}}`

Variable order:
`first_name,stage_name,job_title,org_name,date,time,interview_link,reschedule_link`

## Reminder template

`Hi {{1}}, your {{2}} interview for {{3}} starts in {{4}} minutes. Join here: {{5}}`

Variable order:
`first_name,stage_name,job_title,minutes_before,interview_link`

If an already-approved Twilio template uses a different order, set
`TWILIO_WHATSAPP_CONFIRMATION_VARIABLE_ORDER` and/or
`TWILIO_WHATSAPP_REMINDER_VARIABLE_ORDER` to match it. Use the protected
`GET /api/internal/integrations/status` endpoint with `x-internal-secret` to
confirm that every credential/sender/template setting is present without
exposing secret values.
