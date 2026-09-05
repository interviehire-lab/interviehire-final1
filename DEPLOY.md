# Deploying IntervieHire to production (interviehire.com)

Goal: the whole product is public with a native animated AI interviewer that
requires no GPU streaming host or external avatar service.

## Architecture (what goes where)

| Piece | Host | Public URL |
|---|---|---|
| Candidate room + animated AI assistant (`interview-engine/apps/web`) | **Vercel** | `interview.interviehire.com` |
| Recruiter dashboard (`dashboard`) | **Vercel** | `app.interviehire.com` |
| Interview engine — Fastify (`interview-engine`) | **Render** | `interviehire-engine.onrender.com` |
| Backend — FastAPI (`backend`) | **Railway** | `interviehire-backend-production.up.railway.app` (deploy config in `backend/railway.json`; `render.yaml` is a Render alternative) |
| Postgres (shared) | **Railway** | both services set `DATABASE_URL` to it (`sync: false`) |

---

## 2. Backend + Engine + Postgres → Render (one Blueprint)

1. Push this repo to GitHub.
2. Render → **New → Blueprint** → pick the repo. It reads [`render.yaml`](render.yaml) and creates `interviehire-backend` + `interviehire-engine`. Postgres is **not** provisioned here — it lives on **Railway** now.
3. When prompted for `sync: false` secrets, paste:
   - **both services** → `DATABASE_URL` = the **Railway** Postgres connection string (the public/external URL). Use the **same** value for backend and engine — they share one DB.
   - **interviehire-backend** → `FRONTEND_URL` = `https://app.interviehire.com`
   - **interviehire-engine** → `DEEPGRAM_API_KEY`, `OPENROUTER_API_KEY`, `DEEPSEEK_API_KEY` (the OpenRouter key works for both `OPENROUTER_API_KEY` and `DEEPSEEK_API_KEY`).
4. First deploy runs Prisma migrations automatically (engine `startCommand`).
5. **Seed the admin + demo data** once: Render → `interviehire-backend` → Shell → `python seed.py`.
   (The engine's demo interview also self-seeds on first `GET /api/interview/demo-session`.)
6. Note the two service URLs.

> Render free tier sleeps after inactivity (first request is slow) and has an
> **ephemeral disk** — that's fine here: transcripts live in Postgres
> (`TranscriptEvent`) and the `.txt` is rebuilt on demand by `finalize`/download.

---

## 3. Front-ends → Vercel (two projects)

Both are Next apps in this monorepo (npm workspaces + the `@interviehire/shared` package).

### 3a. Candidate room → interview.interviehire.com
- Vercel → New Project → this repo. **This is a SEPARATE Vercel project from the dashboard** — the room owns `/interview`, the dashboard does not.
- **Root Directory:** `interview-engine/apps/web` → enable **"Include source files outside of the Root Directory"** (so `packages/shared` is available).
- It picks up [`apps/web/vercel.json`](interview-engine/apps/web/vercel.json) (install/build run from the workspace root).
- **Environment Variables** (Production) — see [`.env.production.example`](interview-engine/apps/web/.env.production.example):
  - `NEXT_PUBLIC_API_URL` = `https://interviehire-engine.onrender.com`
  - `NEXT_PUBLIC_WS_URL` = `wss://interviehire-engine.onrender.com/ws`
- **Domain:** add `interview.interviehire.com`. Verify `curl -I https://interview.interviehire.com/interview` returns **200** before pointing the dashboard at it.

### 3b. Dashboard → app.interviehire.com
- Vercel → New Project → this repo → **Root Directory:** `dashboard`.
- **Environment Variables** — see [`dashboard/.env.production.example`](dashboard/.env.production.example):
  - `NEXT_PUBLIC_API_URL` = `https://interviehire-backend.onrender.com/api`
  - `NEXT_PUBLIC_ENGINE_WEB_URL` = `https://interview.interviehire.com`
- **Domain:** add `app.interviehire.com`.

After both are live, double-check the backend's `FRONTEND_URL` on Render equals the
dashboard origin (`https://app.interviehire.com`) — that drives CORS + the
cross-site auth cookie (already configured `SameSite=None; Secure` via
`COOKIE_SAMESITE`/`COOKIE_SECURE` in `render.yaml`).

---

## 4. Smoke test

1. `https://interview.interviehire.com/interviewcandidateroom` → animated orb loads immediately.
2. `https://app.interviehire.com` → log in (`admin@interviehire.com`) → "Run test interview".
3. Take the interview from another device → the orb moves through listening,
   thinking, and speaking → End → transcript `.txt` + report generate.

## Quick reference — what each env var does

| Service | Var | Value |
|---|---|---|
| engine | `DEEPGRAM_API_KEY` | preferred server-side candidate STT |
| engine | `OPENROUTER_API_KEY` / `DEEPSEEK_API_KEY` | LLM report (same OpenRouter key) |
| engine + backend | `DATABASE_URL` | **Railway** Postgres — same URL for both (shared DB) |
| backend | `FRONTEND_URL` | `https://app.interviehire.com` |
| backend | `COOKIE_SAMESITE=none`, `COOKIE_SECURE=true` | cross-site auth cookie |
| backend | `INTERVIEW_ROOM_URL` | **the room's own origin** — `https://interview.interviehire.com` (NOT `interviehire.com`, which serves the dashboard → `/interviewcandidateroom` 404s there) |
| backend | `INVITE_LINK_BASE` | *optional* — backend's own public origin for `/i/{token}`. **Auto-derived from `RAILWAY_PUBLIC_DOMAIN` / `RENDER_EXTERNAL_URL` when unset**, so usually no need to set it. |
| backend | `INVITE_FROM_EMAIL` | *optional* — transactional sender for interview invites (`interviews@interviehire.com`) |
| web | `NEXT_PUBLIC_API_URL` / `_WS_URL` | engine on Render |
| dashboard | `NEXT_PUBLIC_API_URL` | backend on Render |
| dashboard | `NEXT_PUBLIC_ENGINE_WEB_URL` | `https://interview.interviehire.com` |

## Reminder automation on Railway

The reminder runner is packaged as a short-lived Docker target. Follow
[`deploy/RAILWAY-REMINDERS.md`](deploy/RAILWAY-REMINDERS.md) to add the separate
five-minute Railway cron service and configure the canonical Twilio templates.
