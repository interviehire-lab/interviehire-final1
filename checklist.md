# External Services Checklist

Manual checklist for verifying every third-party service this platform depends
on. Run `python3 scripts/check-credits.py` first — it automates the balance
checks marked 🤖 below and will save you the manual login for those rows.

Update this file's ⚠️ notes as issues get resolved; don't delete the row, just
flip it to ✅ so the history of what was checked stays visible.

---

## AI / LLM providers

| Service | Used by | Key location | Check | Status |
|---|---|---|---|---|
| **DeepSeek** | Backend (screening eval) + Engine (Aviral evaluator) | `DEEPSEEK_API_KEY` in both `.env`s | 🤖 Balance via script, or [platform.deepseek.com](https://platform.deepseek.com/usage) | ⚠️ $4.64 remaining as of 2026-09-07 — top up before it hits zero |
| **OpenAI** | Engine (ASR fallback, `OPENAI_ASR_MODEL`) | `OPENAI_API_KEY` in `interview-engine/.env` | 🤖 Script confirms key validity only (no balance API for project keys) — check spend at [platform.openai.com/usage](https://platform.openai.com/usage) | ☐ |
| **Gemini (Google AI Studio)** | Engine (optional semantic evaluation fallback) | `GEMINI_API_KEY` — currently **empty** in `.env` | Not configured — zero-key path falls back to DeepSeek/deterministic evaluator, by design | N/A (unconfigured) |
| **Groq** | Engine (unused code path currently) | `GROQ_API_KEY` — currently empty | Not configured | N/A (unconfigured) |
| **xAI / Grok** | Backend (unused code path currently) | `XAI_API_KEY` / `GROK_API_KEY` — currently empty | Not configured | N/A (unconfigured) |

## Voice interview stack

| Service | Used by | Key location | Check | Status |
|---|---|---|---|---|
| **LiveKit Cloud** | Voice-agent (worker registration) + Engine (room token minting) | `LIVEKIT_URL`/`LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` in `interview-engine/.env` + Railway `engine`/`voice-agent` services | Log into [cloud.livekit.io](https://cloud.livekit.io) → confirm project active, check concurrent-session/minutes usage against plan limit | ☐ |
| **Deepgram** | Engine (`DEEPGRAM_MODEL`) + Voice-agent (STT) | `DEEPGRAM_API_KEY` in `interview-engine/.env` | 🤖 Script attempts balance read — **this key currently lacks `billing:read` scope** (403 `INSUFFICIENT_PERMISSIONS`). Check manually at [console.deepgram.com](https://console.deepgram.com) → Billing, or grant the key that scope so the script can read it going forward | ⚠️ Can't verify balance — grant `billing:read` or check dashboard directly |
| **Cartesia** | Voice-agent (TTS, `CARTESIA_VOICE_ID`/`CARTESIA_MODEL`) | `CARTESIA_API_KEY` in `interview-engine/.env` | No public balance API — check [play.cartesia.ai](https://play.cartesia.ai) → Billing | ☐ |

## Communication

| Service | Used by | Key location | Check | Status |
|---|---|---|---|---|
| **Twilio** | Backend (`TWILIO_*` — WhatsApp interview reminders/confirmations, voice calls) | `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/`TWILIO_API_KEY_SID`/`TWILIO_API_KEY_SECRET` in `backend/.env` | 🤖 Balance via script, or [console.twilio.com](https://console.twilio.com) | 🔴 **$0.00 balance as of 2026-09-07 — reminders/calls will fail until topped up** |
| **Resend** | Backend + Engine (transactional email — invites, reports) | `RESEND_API_KEY` in both `.env`s | No public balance API — check [resend.com/emails](https://resend.com/emails) → usage against plan's monthly send limit | ☐ |
| **SMTP (Gmail)** | Backend + Engine (fallback/primary mail send, `SMTP_HOST=smtp.gmail.com`) | `SMTP_USERNAME`/`SMTP_PASSWORD` (backend), `SMTP_USER`/`SMTP_PASS` (engine — **note the different var names for the same credential**, see below) in respective `.env`s | Confirm the Gmail account's app-password is still valid (Google can silently revoke these) — send a real test email through each service | ☐ |
| **Zoho Mail** | Company inbox for `@interviehire.com` (MX records only, not called by app code) | N/A — DNS-level | Confirm mail is still routing: send a test email to `hr@interviehire.com` | ☐ |
| **AWS SES** | Bounce/feedback handling for `send.interviehire.com` (MX/TXT records, not called by app code directly — likely used by a mailer provider) | N/A — DNS-level | Confirm SES sending identity is still verified in the AWS console if this is actively used | ☐ |

⚠️ **SMTP variable-name mismatch, already fixed in code but re-verify after your next deploy**: the engine's Fastify code reads `SMTP_USER`/`SMTP_PASS`, but Railway/`.env` historically only had `SMTP_USERNAME`/`SMTP_PASSWORD` set — both names now carry the same value on Railway's `engine` service, but confirm this stays true if the SMTP credential is ever rotated (update both var names, not just one).

## Storage

| Service | Used by | Key location | Check | Status |
|---|---|---|---|---|
| **Backblaze B2** | Backend (`proctoring-videos` bucket — interview recordings) | `B2_KEY_ID`/`B2_APPLICATION_KEY`/`B2_BUCKET_NAME` in `backend/.env` + Railway `backend` service | No balance API — check [secure.backblaze.com](https://secure.backblaze.com) → Caps & Alerts for spend. Also **confirm the bucket actually has objects in it** after your next successful test interview (it was empty as of 2026-09-06) | ⚠️ Bucket was empty as of 2026-09-06 — re-check after the recording pipeline fixes land |
| **Google Drive** | Backend (`google_drive.py` — legacy recording storage, pre-B2-switch sessions only) | `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REFRESH_TOKEN` in `backend/.env` | Confirm the OAuth refresh token hasn't expired — Google refresh tokens can go stale after long inactivity or a security event on the account. Old recordings (pre-B2) depend on this still working | ☐ |

## Infrastructure

| Service | Used by | Check | Status |
|---|---|---|---|
| **Railway** | Hosts `backend`, `engine`, `voice-agent`, Postgres, Redis (project "interviehire") | [railway.com/dashboard](https://railway.com/dashboard) → confirm usage against plan limits, no services sleeping/crashed | ☐ |
| **Vercel** | Hosts dashboard (`interviehire-final1`) + candidate room (`interviehire-interview`) | [vercel.com/dashboard](https://vercel.com/dashboard) → confirm both projects on an active plan, no build-minute/bandwidth caps hit | ☐ |
| **Cloudflare** | DNS for `interviehire.com` | [dash.cloudflare.com](https://dash.cloudflare.com) → confirm zone is active, nameservers still pointed here | ☐ |
| **GitHub** | Source repo (`interviehire-lab/interviehire-final1`), Railway/Vercel auto-deploy source | Confirm both Railway and Vercel still have valid, non-expired access to the repo (a revoked GitHub App install silently breaks auto-deploy) | ☐ |

⚠️ **Known open issue, not service-health related**: `app.interviehire.com` and `interview.interviehire.com` are currently claimed by a Vercel team you don't have access to — production is running on the raw `.vercel.app` URLs (`interviehire-final1.vercel.app`, `interviehire-interview.vercel.app`) until that's resolved. See the "Path forward" discussion from 2026-09-06 for options.

---

## How to re-run the automated portion

```bash
python3 scripts/check-credits.py
```

Reads `backend/.env` and `interview-engine/.env` directly — no setup needed
beyond having those files populated. Add a new checker function to the script
if a provider you rely on later exposes a balance API it doesn't cover yet.
