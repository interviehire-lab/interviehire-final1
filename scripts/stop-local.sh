#!/usr/bin/env bash

set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/services.sh"

stop_process dashboard
stop_process candidate-web
stop_process fastapi-backend
stop_process voice-agent
stop_process interview-api

if [ "${1:-}" != "--keep-infra" ]; then
  require_command docker
  export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-interviehire-local}"
  compose stop postgres redis
  success "Stopped local Postgres and Redis (data volume retained)."
fi
