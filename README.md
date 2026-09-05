# IntervieHire — Final

An AI-driven hiring platform: recruiters author rubric-grade interview blueprints, an AI avatar runs the interview, and candidates are scored against the recruiter's own rubric into a structured evaluation report.

This repo stitches three pieces into one working MVP:

| Component | Dir | Role |
|-----------|-----|------|
| **Recruiter dashboard** | [`dashboard/`](dashboard/) | The product surface — job pipelines, the **Interview Blueprint Studio** (authors questions + graded rubrics), and **Deep Analysis** (post-interview candidate intelligence). Leads the contract. |
| **AI interview engine** | [`interview-engine/`](interview-engine/) | Fastify API (`:4000`) + candidate interview room (Next.js) + the **Aviral evaluation engine** (`apps/api/src/aviral-eval/`). Runs the interview and scores it with DeepSeek. |
| **Backend** | [`backend/`](backend/) | FastAPI (`:8000`) over Supabase Postgres — jobs, applicants, auth, and the bridge that feeds blueprints to the engine and serves reports back. |

## How it fits together

```
Recruiter (dashboard :3000)
   │  authors blueprint + rubric in the Blueprint Studio
   ▼
FastAPI backend (:8000)  ──persists──►  Supabase Postgres
   │  on schedule: syncs the job's questions + rubric into the engine's tables
   ▼
Candidate interview room (interview-engine web)
   │  text/voice answers  →  Fastify engine (:4000)
   ▼
Aviral evaluation engine + DeepSeek
   │  grades each answer against the recruiter's rubric → CandidateReport
   ▼
Supabase  ──►  FastAPI serves the report  ──►  Deep Analysis renders it
```

The dashboard, engine, and backend integrate through a **shared Supabase database** — the FastAPI backend mirrors the engine's tables, so a blueprint authored in the dashboard reaches the interview, and the resulting `CandidateReport` flows straight back to Deep Analysis.

### Evaluation

Scoring uses the **Aviral evaluation engine** (`interview-engine/apps/api/src/aviral-eval/`): for each answer it builds a rubric-grounded prompt, asks DeepSeek to grade it, validates the result, and aggregates a canonical `CandidateReport` (overall score, recommendation, per-dimension skill scores, per-question breakdown, red flags). Without a `DEEPSEEK_API_KEY` it falls back to a deterministic evaluator, so an interview still runs and scores with **zero API keys**.

## Start the complete stack

The root scripts use the same ports in both modes:

| Service | URL |
|---|---|
| Recruiter dashboard | `http://localhost:3000` |
| Candidate interview room | `http://localhost:3001` |
| Interview API | `http://localhost:4000/health` |
| FastAPI backend | `http://localhost:8000` |

For native development, application services run on the host with hot reload;
Postgres and Redis run in Docker. The first start installs missing dependencies,
applies Prisma migrations, and writes process logs under `.runtime/logs/`.

```bash
./scripts/start-local.sh
./scripts/logs-local.sh            # follow all local logs with colored service prefixes
./scripts/stop-local.sh
```

To build and run every service in Docker, including the dashboard and FastAPI:

```bash
./scripts/start-containers.sh
./scripts/logs-containers.sh       # optional: follow logs
./scripts/stop-containers.sh
```

The complete container topology is defined in the root [`compose.yml`](compose.yml).

Ports can be overridden for either mode, for example:

```bash
POSTGRES_PORT=5433 DASHBOARD_PORT=3100 ./scripts/start-containers.sh
```

Native mode always uses its local Postgres by default. Set `LOCAL_DATABASE_URL`
only when you intentionally want native services to use a different database.

Stopping containers retains the Postgres and backend-upload volumes. To use API
keys or SMTP locally, create `backend/.env` and/or `interview-engine/.env` from
their examples; checked-in development defaults work without paid API keys.

## Manual quick start

Each component has its own `.env.example` — copy it to `.env` (or `.env.local` for the dashboard) and fill in the values. The three services share one Supabase database.

**1. Backend (FastAPI, `:8000`)**
```bash
cd backend
python -m venv venv && venv/Scripts/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                                  # fill DATABASE_URL, SECRET_KEY
python -m uvicorn main:app --port 8000 --reload
```

**2. Interview engine (Fastify `:4000` + candidate web `:3001`)**
```bash
cd interview-engine
npm install
cp .env.example .env                                  # fill DATABASE_URL (+ DEEPSEEK_API_KEY for LLM scoring)
npm run build -w packages/shared
npm run db:generate -w apps/api
npm run dev                                           # api :4000 + web
```
A keyless **test interview** is available immediately at `/interview` (it seeds a demo session via `GET /api/interview/demo-session`).

**3. Dashboard (Next.js, `:3000`)**
```bash
cd dashboard
npm install
cp .env.example .env.local
npm run dev
```
The dashboard runs on localStorage by default. Flip it to the live backend with `IHApi.setDataSource('api')` in the browser console (it then hydrates jobs, persists authored blueprints, and renders live reports in Deep Analysis).

## Authentication

The dashboard is gated by a login. Auth is the existing **FastAPI backend** (`backend/app/routers/auth.py`) over the shared Supabase/Postgres database — **email + password**, bcrypt-hashed, with a 7-day JWT in an httpOnly cookie.

- **Sign in:** `/login` (email + password). **Sign up:** `/signup` (name + email + password) — new recruiters become an org admin of a fresh workspace.
- **Admin:** the seeded `super_admin` is `admin@interviehire.com` (password set by your team's seed).
- **Flow:** `/dashboard` is guarded and redirects to `/login` when there's no valid session. The sidebar profile shows the signed-in user; the logout button ends the session and returns to `/login`.

Because the dashboard calls the backend directly, **auth requires the FastAPI backend running** (`:8000`) with a reachable `DATABASE_URL`. Point the dashboard at the API with `NEXT_PUBLIC_API_URL`. For a cross-site production deploy, the backend's auth cookie must be sent cross-site (`SameSite=None; Secure`).

## Notes

- **Secrets** live only in `.env` files, which are gitignored. Never commit real keys or database URLs.
- The recruiter dashboard is the source of truth for the `CandidateReport` shape; the engine and backend conform to it.
- The candidate room supports proctoring (gaze/face/object) and voice, but a typed text interview needs no paid voice keys.
