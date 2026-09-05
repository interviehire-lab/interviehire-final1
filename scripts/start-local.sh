#!/usr/bin/env bash

set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/services.sh"

require_command curl
require_command docker
docker info >/dev/null 2>&1 || fail "Docker is not running (local Postgres and Redis use Docker)."

"$SCRIPT_DIR/setup-local.sh"

load_env_file "$REPO_ROOT/backend/.env"
load_env_file "$REPO_ROOT/interview-engine/.env"

export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-interviehire-local}"
export POSTGRES_PORT="${POSTGRES_PORT:-5433}"
export REDIS_PORT="${REDIS_PORT:-6379}"
export DATABASE_URL="${LOCAL_DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:$POSTGRES_PORT/interviehire}"
export REDIS_URL="${LOCAL_REDIS_URL:-redis://127.0.0.1:$REDIS_PORT}"
export DASHBOARD_PORT="${DASHBOARD_PORT:-3000}"
export CANDIDATE_PORT="${CANDIDATE_PORT:-3001}"
export ENGINE_API_PORT="${ENGINE_API_PORT:-4000}"
export BACKEND_PORT="${BACKEND_PORT:-8000}"

assert_process_port_available interview-api "$ENGINE_API_PORT"
assert_process_port_available fastapi-backend "$BACKEND_PORT"
assert_process_port_available candidate-web "$CANDIDATE_PORT"
assert_process_port_available dashboard "$DASHBOARD_PORT"

info "Starting local infrastructure..."
compose up -d --wait postgres redis

info "Applying interview-engine database migrations..."
(cd "$REPO_ROOT/interview-engine" && npx prisma migrate deploy --schema apps/api/prisma/schema.prisma)

start_process interview-api "$REPO_ROOT/interview-engine" \
  env FORCE_COLOR=1 DATABASE_URL="$DATABASE_URL" REDIS_URL="$REDIS_URL" PORT="$ENGINE_API_PORT" \
  npm run dev -w apps/api

start_process fastapi-backend "$REPO_ROOT/backend" \
  env FORCE_COLOR=1 DATABASE_URL="$DATABASE_URL" SECRET_KEY="${BACKEND_SECRET_KEY:-local-development-secret-change-me}" \
  FRONTEND_URL="http://localhost:$DASHBOARD_PORT" INTERVIEW_ROOM_URL="http://localhost:$CANDIDATE_PORT" \
  ENGINE_API_URL="http://127.0.0.1:$ENGINE_API_PORT" INTERNAL_SERVICE_SECRET="${INTERNAL_SERVICE_SECRET:-local-development-internal-secret}" \
  COOKIE_SAMESITE=lax COOKIE_SECURE=false \
  "$REPO_ROOT/backend/.venv/bin/python" -m uvicorn main:app --host 0.0.0.0 --port "$BACKEND_PORT" --reload --use-colors

start_process candidate-web "$REPO_ROOT/interview-engine/apps/web" \
  env FORCE_COLOR=1 NEXT_PUBLIC_API_URL="http://localhost:$ENGINE_API_PORT" NEXT_PUBLIC_WS_URL="ws://localhost:$ENGINE_API_PORT/ws" \
  npx next dev -p "$CANDIDATE_PORT"

start_process dashboard "$REPO_ROOT/dashboard" \
  env FORCE_COLOR=1 NEXT_PUBLIC_API_URL=/api BACKEND_ORIGIN="http://127.0.0.1:$BACKEND_PORT" PORT="$DASHBOARD_PORT" \
  npm run dev -- -p "$DASHBOARD_PORT"

failed=0
wait_for_url "Interview API" "http://127.0.0.1:$ENGINE_API_PORT/health" 90 || failed=1
wait_for_url "FastAPI backend" "http://127.0.0.1:$BACKEND_PORT/" 90 || failed=1
wait_for_url "Candidate web" "http://127.0.0.1:$CANDIDATE_PORT/" 120 || failed=1
wait_for_url "Dashboard" "http://127.0.0.1:$DASHBOARD_PORT/" 120 || failed=1

if [ "$failed" -ne 0 ]; then
  warn "One or more services did not become ready. Inspect $LOG_DIR/*.log."
  exit 1
fi

success "All local services are running. Use scripts/logs-local.sh to follow logs or scripts/stop-local.sh to stop them."
