#!/usr/bin/env bash
# Stream live logs from a Railway-hosted service (backend or interview-engine
# apps/api — see DEPLOY.md). Thin wrapper around the official `railway` CLI,
# mirroring logs-containers.sh's shape for the local docker-compose stack.
#
# Usage:
#   ./scripts/logs-railway.sh                 # logs for the currently linked/selected service
#   ./scripts/logs-railway.sh -s backend       # a specific service (name shown by `railway status`)
#   ./scripts/logs-railway.sh -s engine -e production
#
# One-time setup this script won't do for you (both are interactive):
#   npm i -g @railway/cli   # or: curl -fsSL https://railway.com/install.sh | sh
#   railway login           # opens a browser
#   railway link            # pick this project/environment from your account

set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/services.sh"

command -v railway >/dev/null 2>&1 || fail "Railway CLI not found. Install: npm i -g @railway/cli  (or: curl -fsSL https://railway.com/install.sh | sh)"

railway whoami >/dev/null 2>&1 || fail "Not logged in to Railway. Run: railway login"
railway status >/dev/null 2>&1 || fail "This checkout isn't linked to a Railway project. Run: railway link"

info "Streaming live Railway logs (Ctrl+C to stop)…"
railway logs -f "$@"
