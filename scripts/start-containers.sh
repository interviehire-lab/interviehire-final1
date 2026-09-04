#!/usr/bin/env bash

set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/services.sh"

require_command curl
require_command docker
docker info >/dev/null 2>&1 || fail "Docker is not running."

export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-interviehire}"
export POSTGRES_PORT="${POSTGRES_PORT:-5432}"
export REDIS_PORT="${REDIS_PORT:-6379}"
export DASHBOARD_PORT="${DASHBOARD_PORT:-3000}"
export CANDIDATE_PORT="${CANDIDATE_PORT:-3001}"
export ENGINE_API_PORT="${ENGINE_API_PORT:-4000}"
export BACKEND_PORT="${BACKEND_PORT:-8000}"
export ENGINE_PUBLIC_URL="${ENGINE_PUBLIC_URL:-http://localhost:$ENGINE_API_PORT}"
export ENGINE_WS_PUBLIC_URL="${ENGINE_WS_PUBLIC_URL:-ws://localhost:$ENGINE_API_PORT/ws}"

info "Building and starting all containers..."
compose up --build -d

failed=0
wait_for_url "Interview API" "http://127.0.0.1:$ENGINE_API_PORT/health" 120 || failed=1
wait_for_url "FastAPI backend" "http://127.0.0.1:$BACKEND_PORT/" 120 || failed=1
wait_for_url "Candidate web" "http://127.0.0.1:$CANDIDATE_PORT/" 120 || failed=1
wait_for_url "Dashboard" "http://127.0.0.1:$DASHBOARD_PORT/" 120 || failed=1

compose ps
if [ "$failed" -ne 0 ]; then
  warn "One or more containers did not become ready. Run scripts/logs-containers.sh."
  exit 1
fi

success "All containers are running. Use scripts/stop-containers.sh to stop them."
