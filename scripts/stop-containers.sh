#!/usr/bin/env bash

set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/services.sh"

require_command docker
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-interviehire}"
compose down --remove-orphans
success "Stopped application containers. Database and upload volumes were retained."
