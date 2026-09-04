#!/usr/bin/env bash

set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/services.sh"

require_command node
require_command npm
require_command python3

if [ ! -d "$REPO_ROOT/dashboard/node_modules" ]; then
  info "Installing dashboard dependencies..."
  (cd "$REPO_ROOT/dashboard" && npm ci)
fi

if [ ! -d "$REPO_ROOT/interview-engine/node_modules" ]; then
  info "Installing interview-engine dependencies..."
  (cd "$REPO_ROOT/interview-engine" && npm ci)
fi

if [ ! -x "$REPO_ROOT/backend/.venv/bin/python" ]; then
  info "Creating the backend Python environment..."
  python3 -m venv "$REPO_ROOT/backend/.venv"
fi

if ! "$REPO_ROOT/backend/.venv/bin/python" -m pip --version >/dev/null 2>&1; then
  info "Bootstrapping pip in the backend Python environment..."
  "$REPO_ROOT/backend/.venv/bin/python" -m ensurepip --upgrade
fi

info "Synchronizing backend Python dependencies..."
"$REPO_ROOT/backend/.venv/bin/python" -m pip install -q -r "$REPO_ROOT/backend/requirements.txt"

info "Generating Prisma client and building the shared engine package..."
(cd "$REPO_ROOT/interview-engine" && npm run db:generate && npm run build -w packages/shared)

success "Local dependencies are ready."
