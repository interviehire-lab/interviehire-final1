#!/usr/bin/env bash
# Redeploy Railway-hosted services with the latest pushed code. Thin wrapper
# around the official `railway` CLI, mirroring logs-railway.sh's shape.
#
# Usage:
#   ./scripts/deploy-railway.sh                  # redeploy every app service (backend, engine, voice-agent)
#   ./scripts/deploy-railway.sh backend           # just one service (name shown by `railway status`)
#   ./scripts/deploy-railway.sh backend engine    # a specific list
#
# Pulls and deploys the LATEST commit from each service's configured source
# (--from-source) rather than just re-running the existing build — use this
# right after `git push` to actually ship new code. `reminders-cron`,
# `Postgres`, and `Redis` are deliberately not in the default set — a cron
# job's "deploy" is just its next scheduled run picking up the new image, and
# the databases aren't deployable app code.
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

DEFAULT_SERVICES=(backend engine voice-agent)
if [ "$#" -gt 0 ]; then
  SERVICES=("$@")
else
  SERVICES=("${DEFAULT_SERVICES[@]}")
fi

for svc in "${SERVICES[@]}"; do
  info "Redeploying '$svc' from latest source…"
  railway redeploy -s "$svc" --from-source -y
done

success "Redeploy triggered for: ${SERVICES[*]} — check status with: railway status  (or ./scripts/logs-railway.sh -s <service>)"
