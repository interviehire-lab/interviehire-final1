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

# `railway logs` prints plain, uncolored text, which is hard to scan for
# errors/warnings in a fast-scrolling stream. Pipe it through a per-line
# colorizer keyed on common log-level/status keywords (Python logging,
# uvicorn, pino/Node all use these). Only colorize when stdout is a real
# terminal and NO_COLOR isn't set (https://no-color.org), so redirecting to
# a file or piping into grep/less etc. still gets clean, escape-code-free text.
colorize_logs() {
  if [ -n "${NO_COLOR:-}" ] || [ ! -t 1 ]; then
    cat
    return
  fi
  # $| = 1 (autoflush) so lines appear the instant they arrive instead of
  # sitting in a buffer during a long-running `railway logs -f` stream.
  perl -pe '
    BEGIN { $| = 1 }
    if (/\b(FATAL|CRITICAL|PANIC)\b/i)        { $_ = "\e[1;97;41m${_}\e[0m" }
    elsif (/\b(ERROR|ERR|EXCEPTION|FAILED)\b/i) { $_ = "\e[0;31m${_}\e[0m" }
    elsif (/\b(WARN|WARNING)\b/i)              { $_ = "\e[0;33m${_}\e[0m" }
    elsif (/\b(INFO|NOTICE)\b/i)               { $_ = "\e[0;36m${_}\e[0m" }
    elsif (/\b(DEBUG|TRACE)\b/i)               { $_ = "\e[2;37m${_}\e[0m" }
    elsif (/\b(READY|STARTED|SUCCESS|OK|LISTENING)\b/i) { $_ = "\e[0;32m${_}\e[0m" }
  '
}

info "Streaming live Railway logs (Ctrl+C to stop)…"
railway logs -f "$@" | colorize_logs
